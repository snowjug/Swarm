/**
 * What the loop of a crawl decides after a pass, as plain functions of numbers, so that the rules that keep
 * it from sleeping with work left can be read, and tested, without a clock or a network. `crawl.ts` does
 * what they say: it starts what can be started, reads the clock once for the whole pass, and then asks
 * these two things.
 */

/** What a pass of the loop found, after it started everything it could start. */
export interface Found {
  /** Reads that are going on: the end of one wakes the crawl. */
  reading: number;
  /** Addresses waiting to be read. */
  queued: number;
  /**
   * How long the nearest of them has to wait for a place on its site, by the reading of the clock the pass
   * decided by: 0 for one that could be read at once, and Infinity when none of them is waiting for time alone
   * (every site they are queued on is held by a read).
   */
  ready: number;
}

/**
 * How a pass ends. A crawl is always in one of these, and the last is the one that must not be:
 *
 * - `reading`: something is being read, and the end of the read wakes the crawl;
 * - `done`: nothing is waiting, and nothing is being read;
 * - `waiting`: nothing is being read, and an address is waiting for time alone, which is a wait to ask for;
 * - `stuck`: addresses are queued, nothing is being read, and none of them is waiting for time: every site
 *   they are on is held, and nothing is reading, so nothing would ever let go of it.
 */
export type PassEnd = 'reading' | 'done' | 'waiting' | 'stuck';

export function passEnd({ reading, queued, ready }: Found): PassEnd {
  if (reading > 0) return 'reading';
  if (queued === 0) return 'done';
  return Number.isFinite(ready) ? 'waiting' : 'stuck';
}

/**
 * The times, in milliseconds from now, after which a crawl that has nothing to start wakes by itself: the
 * time limit of the run, always, and the wait for the next place on a site when there is one.
 *
 * That wait is asked for, and for a millisecond at least, whenever nothing is being read (nothing else
 * would wake the crawl), however little of it is left: it can be none at all by the time it is asked for,
 * and a crawl that then asked for nothing would sleep to its time limit with an address waiting. When reads
 * are going on and an address could be read at once, the places are all taken: the end of a read wakes the
 * crawl, and a timer for it would only wake it again and again.
 */
export function wakeAfter({
  ready,
  reading,
  timeLeft,
}: {
  ready: number;
  reading: number;
  timeLeft: number;
}): number[] {
  const waits = [Math.max(1, timeLeft)];
  if (Number.isFinite(ready) && (ready > 0 || reading === 0)) waits.push(Math.max(1, ready));
  return waits;
}
