import {
  BYOK_HEADERS,
  BYOK_PROVIDER,
  BYOK_STORAGE_KEYS,
  type ByokModel,
} from '../../../shared/public';

/**
 * The person's own model key, for as long as this browser tab lives.
 *
 * It is kept in this module's memory and in `sessionStorage`, which the browser empties when the tab closes. It is never
 * put in `localStorage`, in an address, in a log line, in a message or in a toast. The one way out of this module is a
 * request header, and only on the requests that may use a model (`byokHeaders`).
 */

interface Held {
  key: string;
  model: string | null;
  /** What the key can use, as the last check said. Names only; nothing in it is secret. */
  models: ByokModel[];
}

// The list of models is kept beside the key and the model, under a name of its own: the contract names only those two.
const MODELS_STORAGE_KEY = 'swarm.byok.models';
const MAX_MODELS = 200;

// undefined: the tab's storage has not been read yet. It is read on first use, never at start-up, so the pilot never
// touches it.
let held: Held | null | undefined;
let version = 0;
const listeners = new Set<() => void>();

function tabStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readModels(store: Storage): ByokModel[] {
  try {
    const parsed: unknown = JSON.parse(store.getItem(MODELS_STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.flatMap((item: unknown) =>
          typeof item === 'object' &&
          item !== null &&
          'id' in item &&
          'label' in item &&
          typeof item.id === 'string' &&
          typeof item.label === 'string'
            ? [{ id: item.id, label: item.label }]
            : [],
        )
      : [];
  } catch {
    return [];
  }
}

function current(): Held | null {
  if (held !== undefined) return held;
  held = null;
  try {
    const store = tabStorage();
    const key = store?.getItem(BYOK_STORAGE_KEYS.key);
    if (store && key) {
      held = { key, model: store.getItem(BYOK_STORAGE_KEYS.model), models: readModels(store) };
    }
  } catch {
    // The tab's storage cannot be read: no key is held.
  }
  return held;
}

function notify(): void {
  version += 1;
  for (const listener of [...listeners]) listener();
}

function writeThrough(next: Held | null): void {
  try {
    const store = tabStorage();
    if (!store) return;
    if (next) {
      store.setItem(BYOK_STORAGE_KEYS.key, next.key);
      if (next.model) store.setItem(BYOK_STORAGE_KEYS.model, next.model);
      else store.removeItem(BYOK_STORAGE_KEYS.model);
      store.setItem(MODELS_STORAGE_KEY, JSON.stringify(next.models));
    } else {
      store.removeItem(BYOK_STORAGE_KEYS.key);
      store.removeItem(BYOK_STORAGE_KEYS.model);
      store.removeItem(MODELS_STORAGE_KEY);
    }
  } catch {
    // The tab's storage refuses: the key stays in memory only.
  }
}

export function holdsByokKey(): boolean {
  return current() !== null;
}

export function byokModel(): string | null {
  return current()?.model ?? null;
}

export function byokModels(): ByokModel[] {
  return current()?.models ?? [];
}

/** "…1234": the last four characters, which is all of a key that is ever shown. */
export function lastFour(key: string): string {
  return `…${key.slice(-4)}`;
}

export function byokHint(): string | null {
  const key = current()?.key;
  return key ? lastFour(key) : null;
}

/** For the one call that checks the key with the server, and for nothing else. */
export function heldByokKey(): string | null {
  return current()?.key ?? null;
}

export function setByokKey(key: string, model: string | null, models: ByokModel[] = []): void {
  const next = { key, model, models: models.slice(0, MAX_MODELS) };
  held = next;
  writeThrough(next);
  notify();
}

export function setByokModel(model: string | null): void {
  const now = current();
  if (!now) return;
  const next = { ...now, model };
  held = next;
  writeThrough(next);
  notify();
}

export function clearByok(): void {
  const had = current() !== null;
  held = null;
  writeThrough(null);
  if (had) notify();
}

export function subscribeByok(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function byokVersion(): number {
  return version;
}

// Visible characters only: a key with a space or a line break in it would not be a valid header either.
const KEY_SHAPE = /^[\x21-\x7e]{8,512}$/u;

/** What is wrong with a pasted key before anything is sent, or null. */
export function keyProblem(key: string): string | null {
  if (!key) return 'Paste your key first.';
  return KEY_SHAPE.test(key)
    ? null
    : 'That does not look like a key. Copy the whole key from Google AI Studio, with no spaces.';
}

const CHANGES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// The reads that say what the person's funding is and can do: what a request would be paid by, and the model chip.
const FUNDING_READS = new Set(['/api/usage', '/api/provider/status']);
// The key and the provider for this call are the ones in the field, not the ones held.
const CONNECT_PATH = '/api/byok/connect';

/**
 * The headers that carry the held key: on every change, which is where the server may use a model, and on the two reads
 * that say what the person's funding is (their usage, and the model chip). On no other read, and nowhere but this site.
 */
export function byokHeaders(method: string | undefined, path: string): Record<string, string> {
  if (!path.startsWith('/') || path.startsWith('//')) return {};
  const now = current();
  if (!now) return {};
  const verb = (method ?? 'GET').toUpperCase();
  const route = path.split('?')[0] ?? path;
  const wanted = CHANGES.has(verb)
    ? route !== CONNECT_PATH
    : verb === 'GET' && FUNDING_READS.has(route);
  if (!wanted) return {};
  return {
    [BYOK_HEADERS.provider]: BYOK_PROVIDER,
    [BYOK_HEADERS.key]: now.key,
    ...(now.model ? { [BYOK_HEADERS.model]: now.model } : {}),
  };
}
