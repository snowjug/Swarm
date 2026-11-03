/** Counting, intervals and percentiles: the arithmetic every other measure-*.ts rests on. */

const Z95 = 1.959964;

export interface Rate {
  successes: number;
  total: number;
  /** `null` when nothing was measured: a rate over zero cases is not 0 and not 1. */
  rate: number | null;
  /** Wilson 95% score interval. */
  low: number | null;
  high: number | null;
}

/** The Wilson score interval, which stays inside [0, 1] and is honest for small counts. */
export function wilson(successes: number, total: number): { low: number; high: number } | null {
  if (total <= 0) return null;
  if (successes < 0 || successes > total) throw new RangeError('successes must be within 0..total');
  const p = successes / total;
  const z2 = Z95 * Z95;
  const denominator = 1 + z2 / total;
  const centre = (p + z2 / (2 * total)) / denominator;
  const half = (Z95 * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denominator;
  // At k = 0 the lower bound is exactly 0 and at k = n the upper is exactly 1; rounding must not say otherwise.
  return {
    low: successes === 0 ? 0 : Math.max(0, centre - half),
    high: successes === total ? 1 : Math.min(1, centre + half),
  };
}

export function rateOf(successes: number, total: number): Rate {
  const interval = wilson(successes, total);
  return {
    successes,
    total,
    rate: total > 0 ? successes / total : null,
    low: interval?.low ?? null,
    high: interval?.high ?? null,
  };
}

/** Counts a list: the share of items for which the test holds. */
export function rateWhere<T>(items: readonly T[], test: (item: T) => boolean): Rate {
  return rateOf(items.filter(test).length, items.length);
}

export const pooled = (rates: readonly Rate[]): Rate =>
  rateOf(
    rates.reduce((sum, rate) => sum + rate.successes, 0),
    rates.reduce((sum, rate) => sum + rate.total, 0),
  );

/** Nearest-rank percentile: the smallest value with at least p percent of the values at or below it. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  if (p < 0 || p > 100) throw new RangeError('p must be within 0..100');
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] ?? null;
}

export const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

export const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : sum(values) / values.length;

const fixed = (value: number, digits: number): string => value.toFixed(digits);

/** `0.93 (13/14; 95% CI 0.69 to 0.99)`, or `n/a (0 cases)`. */
export function describeRate(rate: Rate, digits = 2): string {
  if (rate.rate === null || rate.low === null || rate.high === null) return 'n/a (0 cases)';
  return `${fixed(rate.rate, digits)} (${rate.successes}/${rate.total}; 95% CI ${fixed(rate.low, digits)} to ${fixed(rate.high, digits)})`;
}

/** The same, as a percentage with no decimals, for tables. */
export function percentOf(rate: Rate): string {
  if (rate.rate === null || rate.low === null || rate.high === null) return 'n/a (0 cases)';
  const pct = (value: number): string => `${Math.round(value * 100)}%`;
  return `${pct(rate.rate)} (${rate.successes}/${rate.total}; ${pct(rate.low)}–${pct(rate.high)})`;
}

export interface Latency {
  n: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
}

export function latencyOf(milliseconds: readonly number[]): Latency {
  return {
    n: milliseconds.length,
    p50: percentile(milliseconds, 50),
    p95: percentile(milliseconds, 95),
    max: milliseconds.length === 0 ? null : Math.max(...milliseconds),
  };
}

/** Folds case, accents and runs of white space, so two copies of a sentence compare equal. */
export const normaliseText = (text: string): string =>
  text
    .normalize('NFKC')
    .replaceAll(/[\u2018\u2019]/gu, "'")
    .replaceAll(/[\u201c\u201d]/gu, '"')
    .replaceAll(/\s+/gu, ' ')
    .trim()
    .toLowerCase();

export const occursIn = (needle: string, haystack: string): boolean => {
  const wanted = normaliseText(needle);
  return wanted.length > 0 && normaliseText(haystack).includes(wanted);
};

const words = (text: string): string[] =>
  normaliseText(text)
    .replaceAll(/[^\p{L}\p{N}'-]+/gu, ' ')
    .split(' ')
    .filter(Boolean);

export const wordsOf = words;

/** The length, in words, of the longest run of words the two texts share. */
function longestSharedRun(a: readonly string[], b: readonly string[]): number {
  let best = 0;
  let previous: number[] = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const current: number[] = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        current[j] = (previous[j - 1] ?? 0) + 1;
        if ((current[j] ?? 0) > best) best = current[j] ?? 0;
      }
    }
    previous = current;
  }
  return best;
}

/**
 * Two quotes of one document overlap when one holds the other, or when they share a run of six words
 * (or of the whole shorter quote, when it is shorter than six). A quote cut at another sentence
 * boundary than the label's still overlaps its label; two different sentences do not.
 */
export function quotesOverlap(a: string, b: string): boolean {
  const wa = words(a);
  const wb = words(b);
  if (wa.length === 0 || wb.length === 0) return false;
  return longestSharedRun(wa, wb) >= Math.min(6, wa.length, wb.length);
}
