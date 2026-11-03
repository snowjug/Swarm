import type { Verdict } from './errors.js';
import type { CrawlTuning } from './types.js';

/**
 * How long to wait before trying again: exponential from `backoffBaseMs`, never over `backoffMaxMs`, and
 * a random share of it taken off so that requests that failed together do not return together. The
 * randomness is the caller's `random`, so a crawl that is given the same numbers waits the same times.
 */
export function backoffMs(attempt: number, tuning: CrawlTuning, random: () => number): number {
  const ceiling = Math.min(tuning.backoffMaxMs, tuning.backoffBaseMs * 2 ** attempt);
  return Math.round(ceiling * (0.5 + 0.5 * Math.min(0.999999, Math.max(0, random()))));
}

/**
 * Whether a failure is tried again, and after how long. Only a failure that may pass is (a timeout, a
 * closed connection, a server that answers 5xx or asks to be left for a while), never a refusal, a
 * robots.txt, or a 4xx. A site that asks to be left longer than `retryAfterCapMs` is left, not waited for.
 */
export function retryAfterMs(
  verdict: Verdict,
  attempt: number,
  tuning: CrawlTuning,
  random: () => number,
): number | null {
  if (!verdict.transient || attempt >= tuning.maxRetries) return null;
  const own = backoffMs(attempt, tuning, random);
  if (verdict.retryAfterMs === null) return own;
  if (verdict.retryAfterMs > tuning.retryAfterCapMs) return null;
  return Math.max(own, verdict.retryAfterMs);
}
