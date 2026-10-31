import { describe, expect, it } from 'vitest';
import { runOutcomeSchema, type Finding, type SensitivityRow } from '../../../shared/analysis';
import { FIXTURE_VARIANTS, actorSetFixture, analysisFixture } from '../../../shared/lab-fixtures';
import {
  ORIGIN,
  STABILITY,
  adverseShare,
  chainOf,
  describeEdit,
  durationText,
  estimateText,
  holdsText,
  intervalText,
  percentText,
  quantile,
  setupProblems,
  signedNumber,
  signedPoints,
  stanceAxis,
  unsupportedSensitive,
  variantDistributions,
} from './analysis';

const finding = (patch: Partial<Finding> = {}): Finding => ({
  id: 'f',
  kind: 'majority-response',
  variantId: 'proposed-change',
  actorId: 'subscribers',
  statement:
    'In 6 of 10 seeded runs, the largest group of simulated members of Subscribers ended up waiting.',
  predicate: 'x',
  holdsIn: 6,
  of: 10,
  interval: { lo: 0.31, hi: 0.83 },
  classification: 'unstable',
  ...patch,
});

describe('numbers shown as simulated shares', () => {
  it('rounds shares to whole points and signs the shifts', () => {
    expect(percentText(0.456)).toBe('46%');
    expect(percentText(0)).toBe('0%');
    expect(signedPoints(0.124)).toBe('+12');
    expect(signedPoints(-0.07)).toBe('-7');
    expect(signedPoints(0)).toBe('0');
    expect(signedNumber(0.5)).toBe('+0.50');
    expect(signedNumber(-0.123)).toBe('-0.12');
    expect(
      adverseShare({
        adopt: 0,
        'accept-with-conditions': 0,
        wait: 0.4,
        'adapt-defensively': 0.1,
        switch: 0.3,
        resist: 0.2,
      }),
    ).toBeCloseTo(0.5, 10);
  });

  it('says how long something took in the unit a person reads', () => {
    expect(durationText(40)).toBe('40 ms');
    expect(durationText(4_200)).toBe('4.2 s');
    expect(durationText(72_000)).toBe('1 min 12 s');
  });

  it('takes quantiles by linear interpolation', () => {
    expect(quantile([10, 20, 30, 40, 50], 0.1)).toBeCloseTo(14, 10);
    expect(quantile([10, 20, 30, 40, 50], 0.9)).toBeCloseTo(46, 10);
    expect(quantile([], 0.5)).toBe(0);
    expect(quantile([5], 0.9)).toBe(5);
  });
});

describe('what each variant shows', () => {
  it('averages the final responses over the runs and gives the spread of the adverse share', () => {
    const distributions = variantDistributions(analysisFixture());
    expect(distributions.map((item) => item.variantId)).toEqual(['baseline', 'proposed-change']);
    for (const item of distributions) {
      expect(Object.values(item.shares).reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 6);
      expect(item.runs).toBe(10);
      expect(item.adverse.p10).toBeLessThanOrEqual(item.adverse.p50);
      expect(item.adverse.p50).toBeLessThanOrEqual(item.adverse.p90);
    }
    const [baseline, proposed] = distributions;
    expect(proposed!.adverse.p50).toBeGreaterThan(baseline!.adverse.p50);
    expect(adverseShare(proposed!.shares)).toBeCloseTo(0.45, 1);
  });

  it('leaves out a scenario that has no runs', () => {
    const analysis = analysisFixture();
    analysis.variants = analysis.variants.slice(0, 1);
    expect(variantDistributions(analysis).map((item) => item.variantId)).toEqual(['baseline']);
  });
});

describe('what a finding says about how often it held', () => {
  it('states the count, the runs and the interval in whole points', () => {
    expect(intervalText(finding())).toBe('31–83%');
    expect(holdsText(finding())).toBe('holds in 6 of 10 seeded runs (95% interval 31–83%)');
    expect(holdsText(finding({ holdsIn: 27, of: 30, interval: { lo: 0.7438, hi: 0.9654 } }))).toBe(
      'holds in 27 of 30 seeded runs (95% interval 74–97%)',
    );
  });

  it('explains every class in plain words, and warns that few runs never earn "repeatable"', () => {
    expect(STABILITY.repeatable.explain(30)).toContain('80%');
    expect(STABILITY.unstable.explain(30)).toContain('do not lean on it');
    expect(STABILITY.rare.explain(30)).toContain('exception');
    expect(STABILITY['mostly-repeatable'].explain(8)).toContain(
      'only 8 runs nothing is called repeatable',
    );
    expect(STABILITY['mostly-repeatable'].explain(30)).not.toContain('only');
    for (const stability of Object.values(STABILITY)) {
      expect(stability.explain(30)).not.toMatch(/\bwill\b/u);
    }
  });
});

describe('where an assumption came from', () => {
  const row = (patch: Partial<SensitivityRow>): SensitivityRow => ({
    ...analysisFixture().sensitivity[0]!,
    ...patch,
  });

  it('names the origin of each kind, and counts a supplied one as evidenced', () => {
    expect(ORIGIN['system-assumption'].label).toBe('System assumption: no evidence supplied');
    expect(ORIGIN.evidence.evidenced).toBe(true);
    expect(ORIGIN.user.evidenced).toBe(false);
  });

  it('picks out the sensitive assumptions that nothing supplied backs', () => {
    const rows = [
      row({ id: 'a', assumptionOrigin: 'system-assumption' }),
      row({ id: 'b', assumptionOrigin: 'evidence' }),
      row({ id: 'c', assumptionOrigin: 'model' }),
      row({ id: 'd', assumptionOrigin: 'system-assumption', classification: 'robust' }),
      row({ id: 'e', assumptionOrigin: 'user' }),
    ];
    expect(unsupportedSensitive(rows).map((item) => item.id)).toEqual(['a', 'c']);
  });
});

describe('reading a chain of events back', () => {
  const run = runOutcomeSchema.parse({
    seed: 12,
    variantId: 'proposed-change',
    rounds: [
      {
        round: 1,
        stanceMean: 0,
        responseShares: {
          adopt: 0,
          'accept-with-conditions': 0,
          wait: 1,
          'adapt-defensively': 0,
          switch: 0,
          resist: 0,
        },
        byActor: [],
        signals: {},
      },
    ],
    final: {
      stanceMean: -0.2,
      responseShares: {
        adopt: 0,
        'accept-with-conditions': 0,
        wait: 1,
        'adapt-defensively': 0,
        switch: 0,
        resist: 0,
      },
      byActor: [],
    },
    events: [
      {
        id: 'event-2',
        round: 4,
        kind: 'switching-pressure',
        actorId: 'subscribers',
        description: 'Switching became cheaper.',
        causedBy: ['event-1'],
      },
      {
        id: 'event-1',
        round: 3,
        kind: 'counter-move',
        actorId: 'rival-provider',
        description: 'A simulated counter-move followed.',
        causedBy: ['adverse-share'],
      },
    ],
    work: { members: 10, updates: 10 },
  });

  it('puts the events in the order they happened and says what each followed from', () => {
    const steps = chainOf(run, actorSetFixture().actors);
    expect(steps.map((step) => step.id)).toEqual(['event-1', 'event-2']);
    expect(steps[0]).toMatchObject({
      round: 3,
      actor: 'Rival provider',
      because: [{ kind: 'signal', text: 'the “adverse-share” signal' }],
    });
    expect(steps[1]!.because).toEqual([{ kind: 'event', text: 'the counter-move in round 3' }]);
  });
});

describe('editing a scenario', () => {
  const original = { intensity: 0.7, round: 2 };
  const description =
    'The change as framed: raise the fee. Intensity 0.7 from round 2 is a system assumption: edit it to say how strongly the change lands.';

  it('leaves the description alone while the intensity and round are as the system set them', () => {
    expect(describeEdit({ description, ...original }, original)).toBe(description);
  });

  it('replaces the sentence about a system assumption once a person has set the value', () => {
    const edited = describeEdit({ description, intensity: 0.4, round: 3 }, original);
    expect(edited).toBe(
      'The change as framed: raise the fee. Intensity 0.4 from round 3 was set by you.',
    );
    expect(edited).not.toContain('system assumption');
  });

  it('is left alone for a scenario the system did not make', () => {
    expect(describeEdit({ description: 'Mine.', intensity: 0.9, round: 2 }, undefined)).toBe(
      'Mine.',
    );
  });
});

describe('what a comparison will cost, said before it starts', () => {
  it('counts the runs, with the sensitivity runs apart, and says no model is called', () => {
    const text = estimateText(
      { variants: 3, runsPerVariant: 30, sensitivity: true, perturbations: 38 },
      null,
    );
    expect(text).toContain('90 simulated runs (3 scenarios × 30 seeds)');
    expect(text).toContain('1,140 for sensitivity (30 seeds, 38 assumptions moved one at a time)');
    expect(text).toContain('No model is called');
    const plain = estimateText(
      { variants: 3, runsPerVariant: 10, sensitivity: false, perturbations: 38 },
      4_200,
    );
    expect(plain).not.toContain('sensitivity');
    expect(plain).toContain('The last comparison on this project took 4.2 s.');
  });

  it('lists what stops it from starting, each once', () => {
    const baseline = FIXTURE_VARIANTS[0]!;
    const proposed = FIXTURE_VARIANTS[1]!;
    expect(setupProblems([baseline, proposed], 30, true, 38, 12)).toEqual([]);
    expect(setupProblems([baseline], 30, true, 38, 12)).toEqual([
      'Keep at least one alternative to compare with the baseline.',
    ]);
    expect(setupProblems([baseline, { ...proposed, label: ' ' }], 30, true, 38, 12)).toContain(
      'Give every scenario a name.',
    );
    expect(setupProblems([baseline, { ...proposed, intensity: 1.5 }], 30, true, 38, 12)).toEqual([
      '“Proposed change”: intensity is from 0 to 1.',
    ]);
    expect(
      setupProblems([baseline, { ...proposed, intensity: Number.NaN }], 30, true, 38, 12),
    ).toHaveLength(1);
    expect(setupProblems([baseline, { ...proposed, round: 13 }], 30, true, 38, 12)).toEqual([
      '“Proposed change”: the change starts in a round from 1 to 12.',
    ]);
    const many = Array.from({ length: 7 }, (_, index) => ({ ...proposed, id: `a-${index}` }));
    const problems = setupProblems([baseline, ...many], 200, true, 38, 12);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('limit is 2,400');
    expect(setupProblems([baseline, ...many], 200, false, 38, 12)).toEqual([]);
  });
});

describe('the axis of a chart of stance', () => {
  it('frames the data in steps of a quarter, within the scale of -1 to 1', () => {
    expect(stanceAxis([-0.31, -0.02, 0.1])).toEqual({
      min: -0.5,
      max: 0.25,
      ticks: [-0.5, -0.25, 0, 0.25],
    });
    const wide = stanceAxis([-1, 1]);
    expect(wide.min).toBe(-1);
    expect(wide.max).toBe(1);
    expect(wide.ticks).toHaveLength(9);
  });

  it('never makes a range narrower than half a point, and copes with no data', () => {
    const flat = stanceAxis([0.1, 0.11]);
    expect(flat.max - flat.min).toBeGreaterThanOrEqual(0.5);
    expect(stanceAxis([]).min).toBe(-1);
  });
});
