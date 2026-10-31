import { createHash } from 'node:crypto';
import { sourceProvenanceSchema, type SourceProvenance } from '../../../../shared/scenario.js';

const MAX_URL = 2_048;
const SECRET_NAMES = new Set(['key', 'sig', 'code', 'auth', 'pwd', 'pass', 'sid', 'jwt', 'otp']);
const SECRET_PARTS = [
  'token',
  'secret',
  'password',
  'passwd',
  'signature',
  'session',
  'credential',
  'authorization',
  'bearer',
];

export const sha256 = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex');

/** Whether a query parameter's value is likely to be a credential, so it is not kept. */
export function isSecretParameter(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.startsWith('x-amz-')) return true;
  const squeezed = lower.replace(/[-_.[\]]/gu, '');
  return (
    SECRET_NAMES.has(squeezed) ||
    squeezed.endsWith('key') ||
    SECRET_PARTS.some((part) => squeezed.includes(part))
  );
}

function redactPair(pair: string): string {
  const equals = pair.indexOf('=');
  const rawName = equals < 0 ? pair : pair.slice(0, equals);
  let name = rawName;
  try {
    name = decodeURIComponent(rawName.replace(/\+/gu, ' '));
  } catch {
    // A name that is not valid percent-encoding is judged as written.
  }
  return isSecretParameter(name) ? `${rawName}=[redacted]` : pair;
}

/**
 * The address as it may be kept: no fragment, and the value of every secret-looking query
 * parameter replaced by `[redacted]`. Secrets in the path itself cannot be told from the rest of it.
 */
export function redactUrl(address: string): string {
  const withoutFragment = address.split('#')[0] ?? '';
  const mark = withoutFragment.indexOf('?');
  if (mark < 0) return withoutFragment.slice(0, MAX_URL);
  const base = withoutFragment.slice(0, mark);
  const query = withoutFragment
    .slice(mark + 1)
    .split('&')
    .map(redactPair)
    .join('&');
  const redacted = `${base}?${query}`;
  // A longer value would break the stored contract; dropping the query is safer than cutting it mid-secret.
  return redacted.length <= MAX_URL ? redacted : base.slice(0, MAX_URL);
}

export interface RetrievedPage {
  /** The address that was asked for, and the one the page was read from after any redirects. */
  url: string;
  finalUrl: string;
  contentType: string;
  /** The text kept as the document: what the hash is of. */
  text: string;
  title: string | null;
  retrievedAt?: Date;
}

/** What the server itself vouches for about a page it fetched. Only this code sets `fetchedByServer`. */
export function buildProvenance(page: RetrievedPage): SourceProvenance {
  const title = page.title?.slice(0, 300);
  return sourceProvenanceSchema.parse({
    kind: 'url',
    url: redactUrl(page.url),
    finalUrl: redactUrl(page.finalUrl),
    retrievedAt: (page.retrievedAt ?? new Date()).toISOString(),
    contentType: page.contentType.slice(0, 120),
    sha256: sha256(page.text),
    ...(title ? { title } : {}),
    fetchedByServer: true,
  });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The pages this server fetched for a person recently. "Retrieved public evidence" is a claim about
 * where text came from, so it is made only for text whose hash this server recorded for the same
 * person: a client that sends `fetchedByServer: true` with text of its own gets pasted text instead.
 * It is kept in memory and for an hour, so a restart, or another replica, loses it, and the page then
 * counts as pasted. That fails toward saying less.
 */
export class FetchRegistry {
  private readonly entries = new Map<string, { provenance: SourceProvenance; expires: number }>();

  constructor(
    private readonly ttlMs = 3_600_000,
    private readonly capacity = 1_000,
    private readonly now: () => number = Date.now,
  ) {}

  record(scope: string, provenance: SourceProvenance): void {
    if (!provenance.sha256) return;
    const key = `${scope}\n${provenance.sha256}`;
    this.sweep();
    this.entries.delete(key);
    this.entries.set(key, { provenance, expires: this.now() + this.ttlMs });
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= this.capacity) break;
      this.entries.delete(oldest);
    }
  }

  vouched(scope: string, hash: string): SourceProvenance | undefined {
    this.sweep();
    return this.entries.get(`${scope}\n${hash}`)?.provenance;
  }

  /**
   * Looks at the `documents` of a project that is about to be created. A document that claims to
   * have been fetched (kind `url`, or `fetchedByServer`) keeps the provenance this server recorded
   * for its exact text, or becomes pasted text. Other provenance is left as it is.
   */
  attest(scope: string, documents: unknown): void {
    if (!Array.isArray(documents)) return;
    for (const document of documents) {
      if (!isRecord(document) || !isRecord(document.provenance)) continue;
      const claim = document.provenance;
      if (claim.kind !== 'url' && claim.fetchedByServer !== true) continue;
      const content = typeof document.content === 'string' ? document.content.trim() : '';
      document.provenance = this.vouched(scope, sha256(content)) ?? { kind: 'paste' };
    }
  }

  private sweep(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expires <= now) this.entries.delete(key);
    }
  }
}
