import { describe, expect, it } from 'vitest';
import {
  MIN_RUNS_FOR_REPEATABLE,
  classifyStability,
  mean,
  pairedDifferences,
  quantile,
  standardDeviation,
  standardError,
  wilson,
} from '../src/analysis/stats.js';

// Reference values were worked out separately, by solving the quadratic that defines the Wilson
// interval instead of using its closed form, and agree with published tables for a 95% interval.
const KNOWN: [number, number, number, number][] = [
  [27, 30, 0.7438, 0.9654],
  [0, 10, 0, 0.2775],
  [10, 10, 0.7225, 1],
  [5, 10, 0.2366, 0.7634],
  [1, 3, 0.0615, 0.7923],
  [29, 30, 0.8333, 0.9941],
  [28, 30, 0.7868, 0.9815],
  [50, 100, 0.4038, 0.5962],
];

describe('the Wilson interval', () => {
  it.each(KNOWN)('gives %i of %i runs the interval %f to %f', (holdsIn, of, lo, hi) => {
    const interval = wilson(holdsIn, of);
    expect(interval.lo).toBeCloseTo(lo, 4);
    expect(interval.hi).toBeCloseTo(hi, 4);
  });

  it('stays inside 0 to 1 and contains the observed share, for every count', () => {
    for (const of of [1, 2, 3, 10, 30, 100, 200]) {
      for (let holdsIn = 0; holdsIn <= of; holdsIn += 1) {
        const { lo, hi } = wilson(holdsIn, of);
        expect(lo).toBeGreaterThanOrEqual(0);
        expect(hi).toBeLessThanOrEqual(1);
        expect(lo).toBeLessThanOrEqual(holdsIn / of + 1e-12);
        expect(hi).toBeGreaterThanOrEqual(holdsIn / of - 1e-12);
      }
    }
  });

  it('narrows as the number of runs grows, for the same share', () => {
    const width = (of: number) => {
      const { lo, hi } = wilson(of / 2, of);
      return hi - lo;
    };
    expect(width(10)).toBeGreaterThan(width(30));
    expect(width(30)).toBeGreaterThan(width(100));
    expect(width(100)).toBeGreaterThan(width(200));
  });

  it('refuses a count that is not a whole number of runs, or more than there were', () => {
    expect(() => wilson(1, 0)).toThrow(RangeError);
    expect(() => wilson(-1, 10)).toThrow(RangeError);
    expect(() => wilson(11, 10)).toThrow(RangeError);
    expect(() => wilson(1.5, 10)).toThrow(RangeError);
    expect(() => wilson(1, 10.5)).toThrow(RangeError);
  });
});

describe('the repeatability classes', () => {
  it('uses the documented cut-offs on the interval, at and either side of each', () => {
    // A lower bound of 0.80 or more.
    expect(classifyStability(16, 16)).toBe('repeatable');
    expect(classifyStability(15, 15)).toBe('mostly-repeatable');
    expect(classifyStability(29, 30)).toBe('repeatable');
    expect(classifyStability(28, 30)).toBe('mostly-repeatable');
    // A lower bound of 0.50 or more.
    expect(classifyStability(21, 30)).toBe('mostly-repeatable');
    expect(classifyStability(20, 30)).toBe('unstable');
    // An upper bound below 0.20.
    expect(classifyStability(0, 16)).toBe('rare');
    expect(classifyStability(0, 15)).toBe('unstable');
    expect(classifyStability(1, 30)).toBe('rare');
    expect(classifyStability(2, 30)).toBe('unstable');
  });

  it('calls a finding unstable when the runs are split', () => {
    expect(classifyStability(15, 30)).toBe('unstable');
    expect(classifyStability(5, 10)).toBe('unstable');
  });

  it('never calls a finding repeatable on fewer than 10 runs, even when all of them agree', () => {
    expect(MIN_RUNS_FOR_REPEATABLE).toBe(10);
    for (let of = 1; of < MIN_RUNS_FOR_REPEATABLE; of += 1) {
      for (let holdsIn = 0; holdsIn <= of; holdsIn += 1) {
        expect(classifyStability(holdsIn, of), `${holdsIn} of ${of}`).not.toBe('repeatable');
      }
    }
    expect(classifyStability(10, 10)).toBe('mostly-repeatable');
  });

  it('needs all of at least 16 runs to be repeatable, and 29 of 30', () => {
    const smallest = (of: number): number | null => {
      for (let holdsIn = 0; holdsIn <= of; holdsIn += 1) {
        if (classifyStability(holdsIn, of) === 'repeatable') return holdsIn;
      }
      return null;
    };
    expect(smallest(15)).toBeNull();
    expect(smallest(16)).toBe(16);
    expect(smallest(30)).toBe(29);
    expect(smallest(100)).toBe(88);
  });
});

describe('the summary statistics', () => {
  it('computes the mean, the sample standard deviation and the standard error', () => {
    const values = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(mean(values)).toBe(5);
    expect(standardDeviation(values)).toBeCloseTo(Math.sqrt(32 / 7), 10);
    expect(standardError(values)).toBeCloseTo(Math.sqrt(32 / 7) / Math.sqrt(8), 10);
    expect(mean([])).toBe(0);
    expect(standardDeviation([3])).toBe(0);
    expect(standardError([3])).toBe(0);
    expect(standardError([1, 1, 1, 1])).toBe(0);
  });

  it('computes quantiles by linear interpolation between ranks', () => {
    const values = [10, 20, 30, 40, 50];
    expect(quantile(values, 0)).toBe(10);
    expect(quantile(values, 0.5)).toBe(30);
    expect(quantile(values, 1)).toBe(50);
    expect(quantile(values, 0.1)).toBeCloseTo(14, 10);
    expect(quantile(values, 0.9)).toBeCloseTo(46, 10);
    expect(quantile([5, 1, 3], 0.5)).toBe(3);
    expect(quantile([4, 8], 0.5)).toBe(6);
    expect(quantile([7], 0.9)).toBe(7);
    expect(quantile([], 0.5)).toBe(0);
  });

  it('pairs runs by seed, and refuses unequal series', () => {
    expect(pairedDifferences([3, 5, 8], [1, 5, 9])).toEqual([2, 0, -1]);
    expect(() => pairedDifferences([1, 2], [1])).toThrow(RangeError);
  });
});
