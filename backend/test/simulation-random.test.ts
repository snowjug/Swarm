import { describe, expect, it } from 'vitest';
import {
  derive,
  hashLabel,
  normalCdf,
  normalQuantile,
  stream,
  truncatedNormalSampler,
  uniformAt,
} from '../src/simulation/random.js';

const draws = (streamSeed: number, count: number): number[] =>
  Array.from({ length: count }, (_, at) => uniformAt(streamSeed, at));

function correlation(left: number[], right: number[]): number {
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const [ml, mr] = [mean(left), mean(right)];
  let cross = 0;
  let sl = 0;
  let sr = 0;
  left.forEach((value, at) => {
    const dl = value - ml;
    const dr = (right[at] ?? 0) - mr;
    cross += dl * dr;
    sl += dl * dl;
    sr += dr * dr;
  });
  return cross / Math.sqrt(sl * sr);
}

describe('seeded streams', () => {
  it('give the same number for the same seed and labels, and others for others', () => {
    const one = derive(7, 'actor', 'alpha', 3);
    expect(derive(7, 'actor', 'alpha', 3)).toBe(one);
    expect(uniformAt(one, 5)).toBe(uniformAt(one, 5));
    expect(new Set([derive(8, 'actor', 'alpha', 3), derive(7, 'actor', 'beta', 3)]).size).toBe(2);
    expect(derive(7, 'actor', 'alpha', 4)).not.toBe(one);
  });

  it('treat the order and the type of labels as part of the label', () => {
    expect(derive(1, 'a', 'b')).not.toBe(derive(1, 'b', 'a'));
    expect(derive(1, 'a', 1)).not.toBe(derive(1, 1, 'a'));
    expect(derive(1, 1)).not.toBe(derive(1, '1'));
    expect(derive(1, 'a')).not.toBe(derive(1, 'a', 'a'));
    expect(derive(1)).not.toBe(derive(2));
  });

  it('are addressed rather than advanced, so one entity never shifts the draws of another', () => {
    const first = derive(3, 'noise', 'first');
    const second = derive(3, 'noise', 'second');
    const alone = uniformAt(second, 11);
    for (let at = 0; at < 1_000; at += 1) uniformAt(first, at);
    expect(uniformAt(second, 11)).toBe(alone);
    const next = stream(second);
    const sequence = Array.from({ length: 12 }, () => next());
    expect(sequence[11]).toBe(alone);
  });

  it('stay strictly inside (0, 1) even for the lowest seeds and counters', () => {
    for (const seed of [0, 1, 2 ** 31 - 1, 2 ** 32 - 1]) {
      for (const counter of [0, 1, 2 ** 31, 2 ** 32 - 1]) {
        const value = uniformAt(seed, counter);
        expect(value).toBeGreaterThan(0);
        expect(value).toBeLessThan(1);
      }
    }
    expect(hashLabel('')).not.toBe(hashLabel(' '));
  });

  it('look uniform and unrelated to one another', () => {
    const values = draws(derive(12, 'uniform'), 100_000);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance =
      values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.006);
    expect(Math.abs(variance - 1 / 12)).toBeLessThan(0.002);
    const deciles = new Array<number>(10).fill(0);
    for (const value of values)
      deciles[Math.floor(value * 10)] = (deciles[Math.floor(value * 10)] ?? 0) + 1;
    for (const count of deciles) expect(Math.abs(count - 10_000)).toBeLessThan(500);
    expect(Math.abs(correlation(values.slice(1), values.slice(0, -1)))).toBeLessThan(0.012);
    const other = draws(derive(12, 'other'), 20_000);
    expect(Math.abs(correlation(values.slice(0, 20_000), other))).toBeLessThan(0.025);
    const neighbour = draws(derive(12, 'uniform', 1), 20_000);
    const base = draws(derive(12, 'uniform', 0), 20_000);
    expect(Math.abs(correlation(base, neighbour))).toBeLessThan(0.025);
  });
});

describe('the normal distribution', () => {
  it('has a distribution function and an inverse that match known values', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1)).toBeCloseTo(0.8413447460685429, 6);
    expect(normalCdf(-1.96)).toBeCloseTo(0.024997895148220435, 6);
    expect(normalCdf(8)).toBeCloseTo(1, 12);
    expect(normalQuantile(0.5)).toBe(0);
    expect(normalQuantile(0.975)).toBeCloseTo(1.959963984540054, 7);
    expect(normalQuantile(0.001)).toBeCloseTo(-3.090232306167813, 7);
    expect(normalQuantile(1 - 1e-9)).toBeCloseTo(5.997807019601638, 5);
    expect(normalQuantile(0)).toBe(-Infinity);
    expect(normalQuantile(1)).toBe(Infinity);
    expect(normalQuantile(2)).toBeNaN();
    for (const p of [1e-8, 0.01, 0.2, 0.5, 0.77, 0.99, 1 - 1e-8]) {
      expect(normalCdf(normalQuantile(p))).toBeCloseTo(p, 6);
    }
  });

  it('samples a truncated normal that stays inside its bounds and has the right mean', () => {
    const cases: [number, number, number, number][] = [
      [0.5, 0.5, 0, 1],
      [0, 0.5, 0, 1],
      [1, 0.3, 0, 1],
      [0.05, 0.001, 0, 1],
      [-0.9, 0.4, -1, 1],
    ];
    for (const [mean, spread, lo, hi] of cases) {
      const sampler = truncatedNormalSampler(mean, spread, lo, hi);
      for (const u of draws(derive(4, 'truncated'), 3_000)) {
        const value = sampler(u);
        expect(value).toBeGreaterThanOrEqual(lo);
        expect(value).toBeLessThanOrEqual(hi);
      }
    }
    // The mean of a normal cut at 0 and 1, by the formula, against an even sweep of the uniform.
    const [mean, spread] = [0.05, 0.3];
    const sampler = truncatedNormalSampler(mean, spread, 0, 1);
    const sweep = Array.from({ length: 20_000 }, (_, at) => sampler((at + 0.5) / 20_000));
    const phi = (x: number) => Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI);
    const [a, b] = [(0 - mean) / spread, (1 - mean) / spread];
    const expected = mean + (spread * (phi(a) - phi(b))) / (normalCdf(b) - normalCdf(a));
    expect(sweep.reduce((sum, value) => sum + value, 0) / sweep.length).toBeCloseTo(expected, 3);
  });

  it('gives the mean when there is no spread', () => {
    expect(truncatedNormalSampler(0.4, 0, 0, 1)(0.123)).toBe(0.4);
    expect(truncatedNormalSampler(1.5, 0, 0, 1)(0.5)).toBe(1);
  });

  it('moves smoothly and in step with the draw, which is what keeps paired runs close', () => {
    const low = truncatedNormalSampler(0.5, 0.1, 0, 1);
    const high = truncatedNormalSampler(0.6, 0.1, 0, 1);
    let previous = -Infinity;
    for (let at = 1; at < 200; at += 1) {
      const u = at / 200;
      const value = low(u);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
      expect(high(u)).toBeGreaterThan(value);
      expect(Math.abs(high(u) - value - 0.1)).toBeLessThan(0.02);
    }
  });
});
