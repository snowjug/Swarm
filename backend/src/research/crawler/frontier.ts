import type { DiscoveredBy } from './types.js';

/** An address waiting to be read, with what is known of it. */
export interface Candidate {
  /** The address to fetch: as the page wrote it, without tracking parameters or a fragment. */
  url: string;
  /** What it is called when two spellings are one page. */
  key: string;
  depth: number;
  parentUrl: string | null;
  discoveredBy: DiscoveredBy;
  score: number;
  /** The words of the question that the link carried. */
  matched: string[];
  host: string;
  /** The registrable domain of the host. */
  domain: string;
  /** The origin robots.txt is kept under. */
  origin: string;
  seq: number;
}

const MAX_SEEN = 20_000;

/**
 * The addresses waiting to be read, best first: by score, and among equals in the order they were found, so
 * that a crawl given the same pages reads them in the same order. An address is queued once, however
 * it is spelled; when the line is full the lowest ranked is let go.
 */
export class Frontier {
  private items: Candidate[] = [];
  private readonly seen = new Set<string>();
  private next = 0;

  constructor(private readonly capacity: number) {}

  get size(): number {
    return this.items.length;
  }

  /** Whether an address has been queued, read or turned away already. */
  has(key: string): boolean {
    return this.seen.has(key);
  }

  /** Marks an address as dealt with without queueing it, such as the one a redirect arrived at. */
  mark(key: string): void {
    if (this.seen.size < MAX_SEEN) this.seen.add(key);
  }

  /** Queues a candidate unless its address is known or it ranks below everything in a full line. */
  add(candidate: Omit<Candidate, 'seq'>): boolean {
    if (this.seen.has(candidate.key) || this.seen.size >= MAX_SEEN) return false;
    const entry: Candidate = { ...candidate, seq: this.next };
    this.next += 1;
    let low = 0;
    let high = this.items.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((this.items[middle] as Candidate).score >= entry.score) low = middle + 1;
      else high = middle;
    }
    if (low >= this.capacity) return false;
    this.seen.add(entry.key);
    this.items.splice(low, 0, entry);
    if (this.items.length > this.capacity) this.items.pop();
    return true;
  }

  /** Takes the best candidate that `ready` accepts. */
  take(ready: (candidate: Candidate) => boolean): Candidate | null {
    const at = this.items.findIndex(ready);
    if (at < 0) return null;
    return this.items.splice(at, 1)[0] ?? null;
  }

  /** The hosts of what is waiting, best first, each once. */
  hosts(): string[] {
    return [...new Set(this.items.map((candidate) => candidate.host))];
  }

  peek(): readonly Candidate[] {
    return this.items;
  }
}
