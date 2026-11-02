import { describe, expect, it } from 'vitest';
import { analysisFixture } from '../../../../shared/lab-fixtures';
import type { Analysis } from '../../../../shared/analysis';
import { directionFindingOf, gapOf, scenariosOf, verdictOf } from './scenarios';
import {
  MINUS,
  listText,
  pointsPhrase,
  precisionOf,
  rangeText,
  seedsText,
  shareText,
  signed,
} from './format';

/** The shared fixture's two scenarios plus a third, so that a pair other than baseline and change can be read. */
function threeScenarios(): Analysis {
  const base = analysisFixture();
  const extra = structuredClone(base.variants[1]!);
  extra.variantId = 'larger';
  for (const run of extra.runs) {
    run.responseShares = { ...run.responseShares, resist: 0.4, switch: 0.4 };
  }
  return {
    ...base,
    config: {
      ...base.config,
      variants: [
        ...base.config.variants,
        { ...base.config.variants[1]!, id: 'larger', label: 'Larger change' },
      ],
    },
    variants: [...base.variants, extra],
  };
}

describe('the scenarios of a comparison', () => {
  it('reads each scenario once, in the order it was set up', () => {
    const scenarios = scenariosOf(analysisFixture());
    expect(scenarios.map((scenario) => scenario.id)).toEqual(['baseline', 'proposed-change']);
    const [baseline, change] = scenarios;
    expect(baseline!.runs).toBe(10);
    expect(change!.adverse).toBeGreaterThan(baseline!.adverse);
    // The share looking for an alternative or resisting is the two responses added.
    expect(change!.adverse).toBeCloseTo(change!.shares.switch + change!.shares.resist, 10);
    expect(change!.spread.p10).toBeLessThanOrEqual(change!.spread.p50);
    expect(change!.spread.p50).toBeLessThanOrEqual(change!.spread.p90);
  });

  it('leaves out a scenario that has no runs rather than showing it as nothing', () => {
    const analysis = analysisFixture();
    analysis.variants[1]!.runs = [];
    expect(scenariosOf(analysis).map((scenario) => scenario.id)).toEqual(['baseline']);
  });
});

describe('one scenario set against another', () => {
  it('pairs the runs by seed and takes the difference of each pair', () => {
    const analysis = analysisFixture();
    const [a, b] = scenariosOf(analysis);
    const gap = gapOf(analysis, a!, b!);
    expect(gap.paired).toBe(10);
    // The mean of the paired differences is the difference of the means when every seed ran in both.
    expect(gap.delta).toBeCloseTo(b!.adverse - a!.adverse, 10);
    expect(gap.higher).toBe(10);
    expect(gap.deltaSpread.p10).toBeLessThanOrEqual(gap.deltaSpread.p90);
    expect(gap.verdict).toBe('less');
  });

  it('pairs only the seeds both scenarios ran', () => {
    const analysis = analysisFixture();
    analysis.variants[1]!.runs = analysis.variants[1]!.runs.slice(0, 4);
    const [a, b] = scenariosOf(analysis);
    expect(gapOf(analysis, a!, b!).paired).toBe(4);
  });

  it('says so when no seed was shared, instead of pairing nothing', () => {
    const analysis = analysisFixture();
    analysis.variants[1]!.runs = analysis.variants[1]!.runs.map((run) => ({
      ...run,
      seed: run.seed + 500,
    }));
    const [a, b] = scenariosOf(analysis);
    const gap = gapOf(analysis, a!, b!);
    expect(gap.paired).toBe(0);
    expect(gap.delta).toBeCloseTo(b!.adverse - a!.adverse, 10);
  });

  it('reads a pair that is not the baseline against the change', () => {
    const analysis = threeScenarios();
    const scenarios = scenariosOf(analysis);
    const gap = gapOf(analysis, scenarios[1]!, scenarios[2]!);
    expect(gap.delta).toBeGreaterThan(0);
    expect(gap.b.id).toBe('larger');
  });

  it('calls a stance difference under a hundredth no direction, as the engine does', () => {
    expect(verdictOf(-0.011)).toBe('less');
    expect(verdictOf(0.011)).toBe('more');
    expect(verdictOf(0.01)).toBe('same');
    expect(verdictOf(-0.01)).toBe('same');
    expect(verdictOf(0)).toBe('same');
  });

  it('finds the engine’s own direction finding only against the baseline', () => {
    const analysis = analysisFixture();
    const [baseline, change] = scenariosOf(analysis);
    expect(directionFindingOf(analysis.findings, baseline!, change!)?.id).toBe('f1');
    expect(directionFindingOf(analysis.findings, change!, baseline!)).toBeNull();
  });
});

describe('the way numbers are said', () => {
  it('uses a real minus sign and no sign for nothing', () => {
    expect(signed(-0.07)).toBe(`${MINUS}0.07`);
    expect(signed(0.12)).toBe('+0.12');
    expect(signed(-0.001)).toBe('0.00');
    expect(signed(-0.0012, 3)).toBe(`${MINUS}0.001`);
  });

  it('never shows a share that is not nothing as 0%', () => {
    expect(shareText(0.004, 0)).toBe('<1%');
    expect(shareText(0.004, 1)).toBe('0.4%');
    expect(shareText(0.00004, 1)).toBe('<0.1%');
    expect(shareText(0, 1)).toBe('0.0%');
    expect(shareText(0.158, 0)).toBe('16%');
  });

  it('keeps a decimal for every share when one of them is small', () => {
    expect(precisionOf([0.004, 0.093])).toBe(1);
    expect(precisionOf([0.004, 0.158])).toBe(1);
    expect(precisionOf([0, 0.158])).toBe(0);
    expect(precisionOf([0.12, 0.3])).toBe(0);
  });

  it('says a shift with its unit, in the singular for exactly one', () => {
    expect(pointsPhrase(0.089, 1)).toBe('+8.9 points');
    expect(pointsPhrase(0.09, 0)).toBe('+9 points');
    expect(pointsPhrase(0.01, 0)).toBe('+1 point');
    expect(pointsPhrase(-0.004, 1)).toBe(`${MINUS}0.4 points`);
    expect(pointsPhrase(0, 0)).toBe('0 points');
  });

  it('says ranges, lists and seeds plainly', () => {
    expect(rangeText(0.073, 0.113, 1)).toBe('7.3–11.3%');
    expect(rangeText(0.07, 0.11)).toBe('7–11%');
    expect(listText(['a'])).toBe('a');
    expect(listText(['a', 'b'])).toBe('a and b');
    expect(listText(['a', 'b', 'c'])).toBe('a, b and c');
    expect(seedsText(42, 30)).toBe('seeds 42 to 71');
    expect(seedsText(7, 1)).toBe('seed 7');
  });
});
