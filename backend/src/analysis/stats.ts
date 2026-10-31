import type { StabilityClass } from '../../../shared/analysis.js';

/**
 * The statistics behind the repeatability of a finding and the noise in a sensitivity shift. They are
 * plain, documented and checked against known values: see docs/analysis/methodology.md.
 */

/** The standard normal quantile for a two-sided 95% interval. */
export const WILSON_Z = 1.959963984540054;

export interface Interval {
  lo: number;
  hi: number;
}

/**
 * The Wilson score interval for a share: `holdsIn` of `of` runs. It stays inside 0 to 1, is not empty
 * at 0 of n or n of n, and behaves for the small counts that a comparison of 10 to 100 runs has.
 */
export function wilson(holdsIn: number, of: number, z: number = WILSON_Z): Interval {
  if (
    !Number.isInteger(of) ||
    of < 1 ||
    !Number.isInteger(holdsIn) ||
    holdsIn < 0 ||
    holdsIn > of
  ) {
    throw new RangeError(`A share needs a whole number of runs from 0 to ${of}, got ${holdsIn}.`);
  }
  const share = holdsIn / of;
  const z2 = z * z;
  const denominator = 1 + z2 / of;
  const centre = (share + z2 / (2 * of)) / denominator;
  const half = (z * Math.sqrt((share * (1 - share)) / of + z2 / (4 * of * of))) / denominator;
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

/** The sample standard deviation (n - 1); 0 for fewer than two values. */
export function standardDeviation(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const centre = mean(values);
  let squares = 0;
  for (const value of values) squares += (value - centre) ** 2;
  return Math.sqrt(squares / (values.length - 1));
}

export function standardError(values: readonly number[]): number {
  return values.length < 2 ? 0 : standardDeviation(values) / Math.sqrt(values.length);
}

/** A quantile by linear interpolation between the closest ranks (the method most packages call type 7). */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const below = Math.floor(position);
  const above = Math.ceil(position);
  const low = sorted[below] ?? 0;
  const high = sorted[above] ?? low;
  return low + (position - below) * (high - low);
}

/** `a[i] - b[i]` for runs that share seed i. The two series must be the same length. */
export function pairedDifferences(a: readonly number[], b: readonly number[]): number[] {
  if (a.length !== b.length) {
    throw new RangeError('Paired runs need the same number of seeds on both sides.');
  }
  return a.map((value, index) => value - (b[index] ?? 0));
}

/** Cut-offs on the Wilson interval of a finding's share of runs. */
export const REPEATABLE_LOWER_BOUND = 0.8;
export const MOSTLY_REPEATABLE_LOWER_BOUND = 0.5;
export const RARE_UPPER_BOUND = 0.2;
/** Fewer runs than this never earn more than `mostly-repeatable`, however many of them agree. */
export const MIN_RUNS_FOR_REPEATABLE = 10;

/**
 * How repeatable a finding is, from how many seeded runs it held in. It measures repeatability under
 * the model's own randomness, never the probability of anything happening in the world.
 */
export function classifyStability(holdsIn: number, of: number): StabilityClass {
  const { lo, hi } = wilson(holdsIn, of);
  if (lo >= REPEATABLE_LOWER_BOUND) {
    return of < MIN_RUNS_FOR_REPEATABLE ? 'mostly-repeatable' : 'repeatable';
  }
  if (lo >= MOSTLY_REPEATABLE_LOWER_BOUND) return 'mostly-repeatable';
  if (hi < RARE_UPPER_BOUND) return 'rare';
  return 'unstable';
}

/** Rounds to four decimals, so that stored results stay compact; never returns -0. */
export function round4(value: number): number {
  const rounded = Math.round(value * 10_000) / 10_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}
