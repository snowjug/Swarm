import { describe, expect, it } from 'vitest';
import type { RunSummary } from '../../shared/analysis.js';
import { pairShares } from '../src/brief/measures.js';

const run = (seed: number, adverse: number): RunSummary => ({
  seed,
  stanceMean: 0,
  responseShares: {
    adopt: 1 - adverse,
    'accept-with-conditions': 0,
    wait: 0,
    'adapt-defensively': 0,
    switch: adverse,
    resist: 0,
  },
  byActor: [],
});

describe('a variant against the baseline on the same seeds', () => {
  it('pairs the runs by seed, not by their place in the list, and leaves a seed with no partner out', () => {
    // The baseline's runs are listed in the other order, and seed 3 was run under the change only.
    const baseline = [run(2, 0.05), run(1, 0.4)];
    const variant = [run(1, 0.3), run(2, 0.5), run(3, 0.9)];
    const pairing = pairShares(variant, baseline);
    expect(pairing.pairs).toBe(2);
    // Seed 1: 0.3 against 0.4 is lower; seed 2: 0.5 against 0.05 is higher. By place it would be two higher.
    expect(pairing.higher).toBe(1);
    expect(pairing.lower).toBe(1);
    expect(pairing.delta).toBeCloseTo(0.175, 6);
    expect(pairing.standardError).toBeCloseTo(0.275, 6);
    expect(pairing.variantMean).toBeCloseTo(0.4, 6);
    expect(pairing.baselineMean).toBeCloseTo(0.225, 6);
  });
});
