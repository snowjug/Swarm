import { registerSecret } from './secrets.js';

/**
 * A person's own key, in the memory of this process, for as long as a run of theirs may need it. A run is a queued job
 * and can start after the request that asked for it has been answered, so the key cannot live only in that request. It
 * is **memory and nothing else**: it is never written to the database, a log, a file or a response; it is forgotten when
 * the person says so, when they sign out, when their account is deleted, after it has not been used for a while, after
 * a fixed time whatever it is used for, and when the process stops.
 *
 * There is one key per person (per workspace): the last one the page sent.
 */
export interface HeldKey {
  key: string;
  model: string | null;
}

interface Entry extends HeldKey {
  since: number;
  last: number;
}

export interface EphemeralKeysOptions {
  /** Forgotten after this long without being used. */
  idleMs?: number;
  /** Forgotten this long after it was first seen, whatever it is used for. */
  absoluteMs?: number;
  /** The most people holding one at once; the least recently used is forgotten first. */
  max?: number;
  now?: () => number;
}

export class EphemeralKeys {
  private readonly held = new Map<string, Entry>();
  private readonly idleMs: number;
  private readonly absoluteMs: number;
  private readonly max: number;
  private readonly now: () => number;

  constructor(options: EphemeralKeysOptions = {}) {
    this.idleMs = options.idleMs ?? 90 * 60_000;
    this.absoluteMs = options.absoluteMs ?? 4 * 60 * 60_000;
    this.max = options.max ?? 5_000;
    this.now = options.now ?? Date.now;
  }

  /** Holds the key the page sent with a request: a new one starts its own lifetime, the same one only counts as used. */
  put(workspaceId: string, key: string, model: string | null): void {
    const at = this.now();
    registerSecret(key, at);
    const previous = this.held.get(workspaceId);
    this.held.delete(workspaceId);
    this.held.set(workspaceId, {
      key,
      model,
      since: previous && previous.key === key ? previous.since : at,
      last: at,
    });
    while (this.held.size > this.max) {
      const oldest = this.held.keys().next().value;
      if (oldest === undefined) break;
      this.held.delete(oldest);
    }
  }

  /** The key a run of this workspace may use, or null: never sent, forgotten, or too old. Using it keeps it. */
  get(workspaceId: string): HeldKey | null {
    const entry = this.held.get(workspaceId);
    if (!entry) return null;
    const at = this.now();
    if (at - entry.last > this.idleMs || at - entry.since > this.absoluteMs) {
      this.held.delete(workspaceId);
      return null;
    }
    entry.last = at;
    return { key: entry.key, model: entry.model };
  }

  has(workspaceId: string): boolean {
    return this.get(workspaceId) !== null;
  }

  /** "Forget key", sign-out and the end of an account. */
  forget(workspaceId: string): boolean {
    return this.held.delete(workspaceId);
  }

  /** The process is stopping. */
  forgetAll(): void {
    this.held.clear();
  }

  /** Forgets what has expired. */
  sweep(): number {
    const at = this.now();
    let forgotten = 0;
    for (const [workspaceId, entry] of this.held) {
      if (at - entry.last > this.idleMs || at - entry.since > this.absoluteMs) {
        this.held.delete(workspaceId);
        forgotten += 1;
      }
    }
    return forgotten;
  }

  get size(): number {
    return this.held.size;
  }
}
