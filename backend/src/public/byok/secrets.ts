import { Writable } from 'node:stream';

/**
 * Where a person's own provider key must never be seen: logs, error messages, responses, audit detail and telemetry.
 * Nothing in the server writes a key on purpose, so this is the layer that holds when something does by mistake. It
 * knows a key two ways: **exactly**, for every key the server has been handed (the first thing that happens to a key is
 * that it is registered here, before anything can log it), and by **shape**, for a key it has not been handed
 * (the shape of Google's keys, a bearer token, a header or a query parameter that names a key).
 */

const MASK = '[key removed]';
/** More than the longest a key is held (see `EphemeralKeys`): after this nobody has it, so it need not be recognised. */
const KEEP_MS = 6 * 60 * 60_000;
/** A hostile caller cannot make this grow without end by sending keys. */
const MAX_LIVE = 2_000;
/** The shortest and longest a secret may be to be tracked: a short value would mask ordinary text. */
const MIN_LENGTH = 8;
const MAX_LENGTH = 512;

const live = new Map<string, number>();

/** The forms a value takes when it is written into a URL or into JSON text, besides the value itself. */
const variants = (value: string): string[] =>
  [
    ...new Set([
      value,
      encodeURIComponent(value),
      JSON.stringify(value).slice(1, -1),
      Buffer.from(value, 'utf8').toString('base64'),
    ]),
  ].filter((form) => form.length >= MIN_LENGTH);

/** Makes the server recognise this value, wherever it turns up, for as long as anyone could be holding it. */
export function registerSecret(value: string, now: number = Date.now()): void {
  if (value.length < MIN_LENGTH || value.length > MAX_LENGTH) return;
  for (const form of variants(value)) {
    live.delete(form);
    live.set(form, now + KEEP_MS);
  }
  while (live.size > MAX_LIVE) {
    const oldest = live.keys().next().value;
    if (oldest === undefined) break;
    live.delete(oldest);
  }
}

function liveSecrets(now: number): string[] {
  const secrets: string[] = [];
  for (const [value, until] of live) {
    if (until <= now) live.delete(value);
    else secrets.push(value);
  }
  return secrets;
}

/** Shapes that are a key whether or not the server was handed it. Each keeps what names it and removes the value. */
const SHAPES: readonly (readonly [RegExp, string])[] = [
  [/\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/gu, MASK],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/giu, `$1${MASK}`],
  [/\b(x-swarm-provider-key|x-goog-api-key)(["']?\s*[:=]\s*["']?)[^\s"',;}]{6,}/giu, `$1$2${MASK}`],
  [/([?&](?:key|api_?key|access_token)=)[^&\s"']{6,}/giu, `$1${MASK}`],
];

/** The text with every key in it removed. */
export function redactSecrets(text: string, now: number = Date.now()): string {
  if (text.length === 0) return text;
  let out = text;
  for (const secret of liveSecrets(now)) {
    if (out.includes(secret)) out = out.split(secret).join(MASK);
  }
  for (const [shape, replacement] of SHAPES) out = out.replace(shape, replacement);
  return out;
}

/** Whether this text holds a key: what `redactSecrets` would remove. */
export const holdsSecret = (text: string, now: number = Date.now()): boolean =>
  redactSecrets(text, now) !== text;

const MAX_DEPTH = 6;

/** A copy of a plain value with every string in it redacted. For audit detail and telemetry attributes. */
export function scrub<T>(value: T, depth = 0): T {
  if (typeof value === 'string') return redactSecrets(value) as T;
  if (value === null || typeof value !== 'object' || depth >= MAX_DEPTH) return value;
  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1)) as T;
  const copy: Record<string, unknown> = {};
  for (const [name, item] of Object.entries(value as Record<string, unknown>)) {
    copy[name] = scrub(item, depth + 1);
  }
  return copy as T;
}

/**
 * A log destination that removes keys from each line before it is written to `target`. The logger writes whole lines,
 * so a key cannot be split across two chunks.
 */
export function redactingStream(target: { write(chunk: string): unknown }): Writable {
  return new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      try {
        target.write(redactSecrets(typeof chunk === 'string' ? chunk : chunk.toString('utf8')));
        callback();
      } catch (error) {
        callback(error instanceof Error ? error : new Error('The log destination failed.'));
      }
    },
  });
}

/** Test hook: forgets every registered value, so one test's key is not another's. */
export function forgetAllSecrets(): void {
  live.clear();
}
