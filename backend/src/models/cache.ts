import { createHash } from 'node:crypto';
import type { ModelRole } from './task.js';

/**
 * A process-local cache of validated structured answers, off unless an operator turns it on.
 *
 * What makes it safe to turn on: an entry belongs to one tenant, and a lookup that does not name the
 * tenant finds nothing, so an answer never crosses from one tenant to another; the key is made of
 * the tenant, role, task, schema version, deployment and a hash of the input, so a changed schema,
 * deployment or input is a different entry; only an answer that passed the schema and every check is
 * ever stored (never a refusal, a failure or a rules answer: the caller decides that, and this refuses
 * what it cannot read as plain JSON); it keeps the hash and the validated value and never the prompt;
 * and it is bounded in entries, in bytes per entry, in bytes in all, and in time.
 */
export interface CacheScope {
  tenantId: string;
  role: ModelRole;
  taskName: string;
  schemaVersion: string;
  deployment: string;
}

export interface CacheOptions {
  maxEntries?: number;
  maxBytes?: number;
  maxEntryBytes?: number;
  ttlMs?: number;
  now?: () => number;
}

export interface CacheStats {
  entries: number;
  bytes: number;
  hits: number;
  misses: number;
  evictions: number;
}

interface Entry {
  json: string;
  bytes: number;
  until: number;
  tenantId: string;
}

const MAX_TENANT_ID = 200;
const MAX_DEPTH = 32;

/**
 * A hash of what a model would be asked: the instructions and the data, with object keys put in order
 * so that the same content is the same hash however it was built. Null when the data holds something
 * that does not survive as plain JSON (a map, a function, a cycle): such an input is not cached, since
 * two different inputs could share one hash.
 */
export function fingerprint(instructions: string, data: unknown): string | null {
  const canonical = (value: unknown, depth: number): string | null => {
    if (depth > MAX_DEPTH) return null;
    if (value === null || typeof value === 'boolean' || typeof value === 'string') {
      return JSON.stringify(value);
    }
    if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : null;
    if (Array.isArray(value)) {
      const items = value.map((item) => canonical(item, depth + 1));
      return items.includes(null) ? null : `[${items.join(',')}]`;
    }
    if (typeof value === 'object') {
      const prototype: unknown = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) return null;
      const entries: string[] = [];
      for (const key of Object.keys(value).sort()) {
        const item = (value as Record<string, unknown>)[key];
        if (item === undefined) continue;
        const text = canonical(item, depth + 1);
        if (text === null) return null;
        entries.push(`${JSON.stringify(key)}:${text}`);
      }
      return `{${entries.join(',')}}`;
    }
    return null;
  };
  const body = canonical(data, 0);
  if (body === null) return null;
  return createHash('sha256')
    .update(JSON.stringify([instructions, body]))
    .digest('hex');
}

export class TaskCache {
  private readonly entries = new Map<string, Entry>();
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly maxEntryBytes: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private bytes = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(options: CacheOptions = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? 256);
    this.maxBytes = Math.max(1, options.maxBytes ?? 16 * 1024 * 1024);
    this.maxEntryBytes = Math.max(1, options.maxEntryBytes ?? 256 * 1024);
    this.ttlMs = Math.max(1, options.ttlMs ?? 900_000);
    this.now = options.now ?? Date.now;
  }

  private key(scope: CacheScope, input: string): string | null {
    if (!scope.tenantId || scope.tenantId.length > MAX_TENANT_ID) return null;
    return JSON.stringify([
      scope.tenantId,
      scope.role,
      scope.taskName,
      scope.schemaVersion,
      scope.deployment,
      input,
    ]);
  }

  /** The stored value, as a fresh copy, or undefined. A caller can change what it gets without changing the cache. */
  get(scope: CacheScope, input: string): unknown {
    const key = this.key(scope, input);
    const entry = key === null ? undefined : this.entries.get(key);
    if (key === null || !entry) {
      this.misses += 1;
      return undefined;
    }
    if (entry.until <= this.now()) {
      this.remove(key);
      this.misses += 1;
      return undefined;
    }
    // Most recently used goes last, and the oldest is what is dropped first.
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hits += 1;
    return JSON.parse(entry.json) as unknown;
  }

  /** Stores a validated value. Returns false when it was not stored: too large, not plain JSON, or no tenant. */
  set(scope: CacheScope, input: string, value: unknown): boolean {
    const key = this.key(scope, input);
    if (key === null) return false;
    let json: string | undefined;
    try {
      json = JSON.stringify(value);
    } catch {
      return false;
    }
    if (json === undefined) return false;
    const bytes = Buffer.byteLength(json) + key.length;
    if (bytes > this.maxEntryBytes) return false;
    this.remove(key);
    this.entries.set(key, {
      json,
      bytes,
      until: this.now() + this.ttlMs,
      tenantId: scope.tenantId,
    });
    this.bytes += bytes;
    this.trim();
    return true;
  }

  /** Forgets one entry: a hit that no longer passes its checks must not be offered again. */
  delete(scope: CacheScope, input: string): void {
    const key = this.key(scope, input);
    if (key !== null) this.remove(key);
  }

  /** Forgets everything of a tenant, or everything. */
  clear(tenantId?: string): void {
    for (const [key, entry] of [...this.entries]) {
      if (tenantId === undefined || entry.tenantId === tenantId) this.remove(key);
    }
  }

  stats(): CacheStats {
    return {
      entries: this.entries.size,
      bytes: this.bytes,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
    };
  }

  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.bytes -= entry.bytes;
  }

  private trim(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.until > now) break;
      this.remove(key);
    }
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) return;
      this.remove(oldest);
      this.evictions += 1;
    }
  }
}
