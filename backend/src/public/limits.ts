/**
 * A sliding window per key: at most `max` hits in any `windowMs`. In this process, which is exact with the one replica the
 * public edition runs (see DECISIONS-FOR-OWNER.md, decision 4), and bounded: the keys are forgotten when their window has
 * passed, and the least recently used is forgotten first if there are too many.
 */
export class WindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 20_000,
  ) {}

  /** Counts a hit, and says whether it is within the limit. A hit that is refused is not counted. */
  allow(key: string): boolean {
    const at = this.now();
    const recent = (this.hits.get(key) ?? []).filter((time) => at - time < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.delete(key);
      this.hits.set(key, recent);
      return false;
    }
    recent.push(at);
    this.hits.delete(key);
    this.hits.set(key, recent);
    while (this.hits.size > this.maxKeys) {
      const oldest = this.hits.keys().next().value;
      if (oldest === undefined) break;
      this.hits.delete(oldest);
    }
    return true;
  }

  /** How long until the key may be counted again, in milliseconds; 0 when it may now. */
  retryAfterMs(key: string): number {
    const at = this.now();
    const recent = (this.hits.get(key) ?? []).filter((time) => at - time < this.windowMs);
    if (recent.length < this.max) return 0;
    return Math.max(0, this.windowMs - (at - (recent[0] ?? at)));
  }

  get size(): number {
    return this.hits.size;
  }
}
