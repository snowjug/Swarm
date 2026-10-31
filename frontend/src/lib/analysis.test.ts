import { describe, expect, it } from 'vitest';
import {
  runOutcomeSchema,
  type Analysis,
  type Finding,
  type SensitivityRow,
} from '../../../shared/analysis';
import { FIXTURE_VARIANTS, actorSetFixture, analysisFixture } from '../../../shared/lab-fixtures';
import {
  ESTIMATE_BASIS,
  NO_EFFECT_TO_TEST,
  ORIGIN,
  SHOWN_ASSUMPTIONS,
  SHOWN_FINDINGS,
  STABILITY,
  adverseShare,
  cannotMoveAnyone,
  chainOf,
  comparisonSummary,
  describeEdit,
  durationRangeText,
  durationText,
  estimateRunMs,
  estimateText,
  estimateWallText,
  holdsText,
  intervalText,
  percentText,
  quantile,
  rankFindings,
  sensitivityView,
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
  const typical = {
    variants: 3,
    runsPerVariant: 30,
    sensitivity: true,
    perturbations: 38,
    members: 600,
    rounds: 12,
  };

  it('counts the runs, with the sensitivity runs apart, and says no model is called', () => {
    const text = estimateText(typical, null);
    expect(text).toContain('90 simulated runs (3 scenarios × 30 seeds)');
    expect(text).toContain(
      '1,140 for sensitivity (30 seeds, 38 assumptions moved one at a time): 1,230 in all',
    );
    expect(text).toContain('No model is called');
    const plain = estimateText({ ...typical, runsPerVariant: 10, sensitivity: false }, 4_200);
    expect(plain).not.toContain('sensitivity');
    expect(plain).toContain('The last comparison on this project took 4.2 s.');
  });

  it('says how long it takes from the measured speed of the engine, scaled to the size of the cast', () => {
    // 1,230 runs at 2 to 3 ms a run, for a cast that is no bigger than the typical one.
    expect(estimateText(typical, null)).toContain('server time only, about 2 to 4 seconds.');
    // A smaller cast is not counted as faster than that: what a run costs apart from its members stays.
    expect(estimateText({ ...typical, members: 160 }, null)).toContain(
      'server time only, about 2 to 4 seconds.',
    );
    // Ten times the member updates of the typical cast takes ten times as long.
    expect(estimateText({ ...typical, members: 12_000 }, null)).toContain(
      'server time only, about 20 to 40 seconds.',
    );
    // Without the size of the cast there is nothing to scale, so no time is claimed.
    const unknown = estimateText({ ...typical, members: 0 }, null);
    expect(unknown).toContain('server time only.');
    expect(unknown).not.toMatch(/\babout \d/u);
  });

  it('takes a typical cast at about 2 to 3 ms a run, as the benchmark measured it, and a larger one in proportion', () => {
    expect(estimateRunMs(600, 24)).toEqual({ low: 2, high: 3 });
    expect(estimateRunMs(600, 12)).toEqual({ low: 2, high: 3 });
    expect(estimateRunMs(160, 12)).toEqual({ low: 2, high: 3 });
    expect(estimateRunMs(12_000, 12)).toEqual({ low: 20, high: 30 });
    expect(estimateRunMs(12_000, 36)).toEqual({ low: 60, high: 90 });
  });

  it('holds the times that the real engine took inside what it says', () => {
    // The Copilot in Teams example in rules mode, through the real routes: 25 actors, 334 simulated
    // members, 12 rounds, 2 scenarios of 30 runs and 38 moves on 30 seeds. Two comparisons took 3.3 s
    // and 3.8 s for 1,201 runs.
    const said = estimateWallText({
      variants: 2,
      runsPerVariant: 30,
      sensitivity: true,
      perturbations: 38,
      members: 334,
      rounds: 12,
    });
    expect(said).toBe('about 2 to 4 seconds');
    // 12,000 members over 12 rounds ran at 17 to 18.5 ms a run in whole comparisons on a quieter
    // machine: the range is not below that, and its low end is within a fifth of it.
    const large = estimateRunMs(12_000, 12);
    expect(large.high).toBeGreaterThanOrEqual(18.5);
    expect(large.low).toBeLessThanOrEqual(17 * 1.2);
  });

  it('says a span of time roughly, in whole seconds or minutes, and never in false precision', () => {
    expect(durationRangeText(400, 900)).toBe('under a second');
    expect(durationRangeText(400, 1_200)).toBe('under 2 seconds');
    expect(durationRangeText(1_400, 2_800)).toBe('about 1 to 3 seconds');
    expect(durationRangeText(3_000, 3_000)).toBe('about 3 seconds');
    expect(durationRangeText(1_000, 1_000)).toBe('about 1 second');
    expect(durationRangeText(12_000, 28_000)).toBe('about 10 to 30 seconds');
    expect(durationRangeText(70_000, 130_000)).toBe('about 1 to 3 minutes');
    expect(durationRangeText(60_000, 60_000)).toBe('about 1 minute');
  });

  it('says in one line that the time is measured and not assumed', () => {
    expect(ESTIMATE_BASIS).toContain('measured speed');
    expect(ESTIMATE_BASIS).toContain('not an assumed one');
    expect(ESTIMATE_BASIS).toContain('about 2 to 3 ms a run');
    expect(ESTIMATE_BASIS).not.toContain('\n');
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

/** The comparison with no stakeholder given an expected direction of impact: nothing can move. */
const withoutDirection = (analysis: Analysis): Analysis => ({
  ...analysis,
  actors: analysis.actors.map((actor) => ({
    ...actor,
    traits: { ...actor.traits, impact: { ...actor.traits.impact, value: 0 } },
  })),
});

describe('a change that cannot move anyone', () => {
  it('is told from the comparison’s own cast and scenarios', () => {
    expect(cannotMoveAnyone(analysisFixture())).toBe(false);
    const flat = withoutDirection(analysisFixture());
    expect(cannotMoveAnyone(flat)).toBe(true);
    // A scenario that sets its own impact on someone can move them, whatever the cast says.
    const named = {
      ...flat,
      config: {
        ...flat.config,
        variants: flat.config.variants.map((variant) =>
          variant.kind === 'baseline'
            ? variant
            : { ...variant, impactOverrides: { [flat.actors[0]!.id]: -0.4 } },
        ),
      },
    };
    expect(cannotMoveAnyone(named)).toBe(false);
  });

  it('does not let “robust” read as a finding there, and leaves every other result alone', () => {
    expect(sensitivityView('robust', false).label).toBe('Robust');
    expect(sensitivityView('robust', true)).toBe(NO_EFFECT_TO_TEST);
    expect(NO_EFFECT_TO_TEST.label).toBe('No effect to test');
    expect(NO_EFFECT_TO_TEST.tone).toBe('neutral');
    expect(NO_EFFECT_TO_TEST.explain).toContain('not evidence that the result is robust');
    expect(sensitivityView('assumption-sensitive', true).label).toBe('Sensitive');
    expect(sensitivityView('inconclusive', true).label).toBe('Inconclusive');
  });
});

describe('the findings in the order to read them', () => {
  const at = (id: string, patch: Partial<Finding>): Finding => finding({ id, ...patch });

  it('puts the repeatable and the rare-but-material first, then the mostly repeatable, then the unstable', () => {
    const findings = [
      at('unstable', { classification: 'unstable' }),
      at('repeatable', { classification: 'repeatable', holdsIn: 10 }),
      at('mostly', { classification: 'mostly-repeatable' }),
      at('rare-material', { classification: 'rare', kind: 'threshold-crossing', holdsIn: 2 }),
      at('rare-ordering', { classification: 'rare', kind: 'ordering', holdsIn: 2 }),
      at('rare-baseline', {
        classification: 'rare',
        kind: 'threshold-crossing',
        holdsIn: 2,
        variantId: 'baseline',
      }),
      at('rare-never-crossed', { classification: 'rare', kind: 'threshold-crossing', holdsIn: 0 }),
      at('rare-event', { classification: 'rare', kind: 'second-order-event', holdsIn: 1 }),
      at('repeatable-later', { classification: 'repeatable', holdsIn: 10 }),
    ];
    const before = findings.map((item) => item.id);
    const ranked = rankFindings(findings, FIXTURE_VARIANTS);
    expect(ranked.map((item) => item.id)).toEqual([
      'repeatable',
      'rare-material',
      'rare-never-crossed',
      'rare-event',
      'repeatable-later',
      'mostly',
      'unstable',
      'rare-ordering',
      'rare-baseline',
    ]);
    // Nothing is dropped or changed, and the list that was given is left as it was.
    expect(findings.map((item) => item.id)).toEqual(before);
    expect(ranked.every((item) => findings.includes(item))).toBe(true);
  });

  it('keeps the order the server gave within each group, so that the change comes before its alternatives', () => {
    const findings = ['a', 'b', 'c', 'd'].map((id) =>
      at(id, { classification: 'mostly-repeatable' }),
    );
    expect(rankFindings(findings, FIXTURE_VARIANTS).map((item) => item.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('shows eight findings and six assumptions before the rest', () => {
    expect(SHOWN_FINDINGS).toBe(8);
    expect(SHOWN_ASSUMPTIONS).toBe(6);
  });
});

describe('what the comparison says, in three lines', () => {
  it('names what was compared, then the finding that states the direction, then whether it is repeatable', () => {
    expect(comparisonSummary(analysisFixture())).toEqual([
      'Compared No change and Proposed change: 10 seeded runs of each, on the same seeds.',
      'Under the proposed change, simulated members ended less favourable than under no change in 10 of 10 runs.',
      'Mostly repeatable: it holds in 10 of 10 seeded runs (95% interval 72–100%).',
    ]);
  });

  it('is made of nothing that the findings do not already state', () => {
    const base = analysisFixture();
    const unstable = {
      ...base,
      findings: base.findings.map((item) =>
        item.kind === 'direction-vs-baseline'
          ? {
              ...item,
              holdsIn: 6,
              interval: { lo: 0.31, hi: 0.83 },
              classification: 'unstable' as const,
            }
          : item,
      ),
    };
    const [, headline, repeatable] = comparisonSummary(unstable);
    expect(headline).toBe(base.findings[0]!.statement);
    expect(repeatable).toBe('Unstable: it holds in 6 of 10 seeded runs (95% interval 31–83%).');
  });

  it('says so, and does not invent a direction, when no finding states one', () => {
    const lines = comparisonSummary({ ...analysisFixture(), findings: [] });
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe(
      'No finding sets the proposed change against the baseline on the same seeds.',
    );
  });

  it('says that nothing can move anyone, rather than a direction, where the cast has none', () => {
    const lines = comparisonSummary(withoutDirection(analysisFixture()));
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('Nothing in the change can move anyone');
    expect(lines[1]).toContain('noise');
    expect(lines.join(' ')).not.toContain('Repeatable');
    expect(lines.join(' ')).not.toContain('holds in');
  });

  it('names the first three of many scenarios, and counts the others', () => {
    const base = analysisFixture();
    const many = {
      ...base,
      config: {
        ...base.config,
        variants: [
          ...base.config.variants,
          ...['Second', 'Third', 'Fourth', 'Fifth'].map((label, index) => ({
            ...base.config.variants[1]!,
            id: `alt-${index}`,
            label,
          })),
        ],
      },
    };
    expect(comparisonSummary(many)[0]).toBe(
      'Compared No change, Proposed change, Second and 3 more: 10 seeded runs of each, on the same seeds.',
    );
  });
});
