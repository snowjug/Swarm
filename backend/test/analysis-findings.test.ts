import { describe, expect, it } from 'vitest';
import {
  emptyResponseShares,
  type Finding,
  type ResponseShares,
  type Variant,
} from '../../shared/analysis.js';
import { actorFixture } from '../../shared/lab-fixtures.js';
import type { Actor } from '../../shared/stakeholders.js';
import {
  FINDINGS_LIMIT,
  generateFindings,
  type FindingsInput,
  type RunRecord,
} from '../src/analysis/findings.js';
import { runAnalysis } from '../src/analysis/runset.js';
import { classifyStability, round4, wilson } from '../src/analysis/stats.js';
import { BASELINE, MILD, PROPOSED, clock, inputs } from './support/analysis-world.js';
import { stubSimulator } from './support/stub-simulator.js';

const shares = (partial: Partial<ResponseShares>): ResponseShares => ({
  ...emptyResponseShares(),
  ...partial,
});

interface ActorState {
  stance: number;
  shares?: Partial<ResponseShares>;
  members?: number;
}

/** One run, written out: what each actor ended as, and what happened on the way. */
function run(
  seed: number,
  states: Record<string, ActorState>,
  extra: { stance?: number; events?: string[]; peak?: number } = {},
): RunRecord {
  const byActor = Object.entries(states).map(([actorId, state]) => ({
    actorId,
    members: state.members ?? 10,
    stanceMean: state.stance,
    responseShares: shares(state.shares ?? { wait: 1 }),
  }));
  const stances = byActor.map((actor) => actor.stanceMean);
  return {
    summary: {
      seed,
      stanceMean: extra.stance ?? stances.reduce((sum, value) => sum + value, 0) / stances.length,
      responseShares: shares({ wait: 1 }),
      byActor,
    },
    actors: new Map(byActor.map((actor) => [actor.actorId, actor])),
    rounds: [],
    eventKinds: extra.events ?? [],
    peakAdverse: extra.peak ?? 0,
  };
}

const named = (
  id: string,
  name: string,
  influence = 0.5,
  overrides: Partial<Actor> = {},
): Actor => {
  const actor = actorFixture(id, 'cost-bearer', { name, ...overrides });
  actor.traits.influence.value = influence;
  return actor;
};

const ADVERSE = { switch: 0.4, resist: 0.3, wait: 0.3 };
const WAITING = { wait: 0.6, 'adapt-defensively': 0.1, switch: 0.2, resist: 0.1 };

function input(
  records: Record<string, RunRecord[]>,
  overrides: Partial<FindingsInput> = {},
): FindingsInput {
  return {
    actors: [named('subscribers', 'Subscribers', 0.9)],
    variants: [BASELINE, PROPOSED],
    records: new Map(Object.entries(records)),
    ...overrides,
  };
}

const find = (findings: Finding[], kind: Finding['kind'], variantId: string): Finding => {
  const found = findings.find((item) => item.kind === kind && item.variantId === variantId);
  if (!found) throw new Error(`No ${kind} finding for ${variantId}.`);
  return found;
};

describe('the largest group of final responses of an actor', () => {
  it('counts the runs in which it was the largest group, and words it as simulated members', () => {
    const proposed = Array.from({ length: 30 }, (_, index) =>
      run(index, { subscribers: { stance: -0.4, shares: index < 27 ? ADVERSE : WAITING } }),
    );
    const baseline = Array.from({ length: 30 }, (_, index) =>
      run(index, { subscribers: { stance: 0, shares: { wait: 1 } } }),
    );
    const findings = generateFindings(input({ baseline: baseline, 'proposed-change': proposed }));
    const finding = find(findings, 'majority-response', 'proposed-change');
    expect(finding.actorId).toBe('subscribers');
    expect(finding.holdsIn).toBe(27);
    expect(finding.of).toBe(30);
    expect(finding.statement).toBe(
      'In 27 of 30 seeded runs, the largest group of simulated members of Subscribers ended up looking for an alternative or resisting under Proposed change.',
    );
    expect(finding.interval.lo).toBeCloseTo(0.7438, 4);
    expect(finding.interval.hi).toBeCloseTo(0.9654, 4);
    expect(finding.classification).toBe('mostly-repeatable');
    expect(finding.predicate).toContain('is the largest of the four response groups');
  });

  it('settles a tie for the more adverse group, and names a single actor as one simulated actor', () => {
    const records = Array.from({ length: 12 }, (_, index) =>
      run(index, {
        subscribers: { stance: -0.1, shares: { switch: 0.5, wait: 0.5 } },
        regulator: { stance: -0.5, members: 1, shares: { resist: 1 } },
      }),
    );
    const findings = generateFindings(
      input(
        { baseline: records, 'proposed-change': records },
        { actors: [named('subscribers', 'Subscribers'), named('regulator', 'Regulator')] },
      ),
    );
    const subscribers = findings.find(
      (item) => item.kind === 'majority-response' && item.actorId === 'subscribers',
    )!;
    expect(subscribers.statement).toContain('looking for an alternative or resisting');
    const regulator = findings.find(
      (item) => item.kind === 'majority-response' && item.actorId === 'regulator',
    )!;
    expect(regulator.statement).toContain('the simulated Regulator ended up');
    expect(regulator.statement).not.toContain('largest group');
  });
});

describe('the direction against the baseline, paired by seed', () => {
  it('compares each seed with the baseline of the same seed, not with the baseline on average', () => {
    // The baseline swings widely from seed to seed; the change is always 0.1 below it.
    const baseline = Array.from({ length: 30 }, (_, index) =>
      run(index, { subscribers: { stance: index % 2 === 0 ? 0.5 : -0.5 } }),
    );
    const proposed = baseline.map((item, index) =>
      run(index, { subscribers: { stance: item.summary.stanceMean - 0.1 } }),
    );
    const finding = find(
      generateFindings(input({ baseline, 'proposed-change': proposed })),
      'direction-vs-baseline',
      'proposed-change',
    );
    expect(finding.holdsIn).toBe(30);
    expect(finding.classification).toBe('repeatable');
    expect(finding.statement).toBe(
      'In 30 of 30 seeded runs, simulated members ended up less favourable under Proposed change than under No change on the same seed (overall stance lower by more than 0.01).',
    );
  });

  it('says more favourable when the change raised the stance, and about the same when it did not move it', () => {
    const baseline = Array.from({ length: 12 }, (_, index) =>
      run(index, { subscribers: { stance: 0 } }),
    );
    const higher = baseline.map((_, index) => run(index, { subscribers: { stance: 0.3 } }));
    const up = find(
      generateFindings(input({ baseline, 'proposed-change': higher })),
      'direction-vs-baseline',
      'proposed-change',
    );
    expect(up.statement).toContain('more favourable under Proposed change than under No change');
    expect(up.statement).toContain('higher by more than');
    const same = find(
      generateFindings(input({ baseline, 'proposed-change': baseline })),
      'direction-vs-baseline',
      'proposed-change',
    );
    expect(same.statement).toContain('about the same under Proposed change as under No change');
    expect(same.holdsIn).toBe(12);
  });

  it('counts only the seeds where the difference is in the stated direction', () => {
    const baseline = Array.from({ length: 20 }, (_, index) =>
      run(index, { subscribers: { stance: 0 } }),
    );
    const proposed = baseline.map((_, index) =>
      run(index, { subscribers: { stance: index < 14 ? -0.2 : 0.2 } }),
    );
    const finding = find(
      generateFindings(input({ baseline, 'proposed-change': proposed })),
      'direction-vs-baseline',
      'proposed-change',
    );
    // The mean difference is negative (-0.08), so the finding is about "lower", and holds in 14 of 20.
    expect(finding.holdsIn).toBe(14);
    expect(finding.of).toBe(20);
    expect(finding.classification).toBe('unstable');
  });
});

describe('crossing a share at some round', () => {
  it('counts the runs whose adverse share reached the threshold, and states the threshold', () => {
    const baseline = Array.from({ length: 30 }, (_, index) =>
      run(index, { subscribers: { stance: 0 } }, { peak: 0.05 }),
    );
    const proposed = Array.from({ length: 30 }, (_, index) =>
      run(index, { subscribers: { stance: -0.3 } }, { peak: index < 12 ? 0.35 : 0.2 }),
    );
    const findings = generateFindings(input({ baseline, 'proposed-change': proposed }));
    const finding = find(findings, 'threshold-crossing', 'proposed-change');
    expect(finding.holdsIn).toBe(12);
    expect(finding.statement).toBe(
      'In 12 of 30 seeded runs, at least 30% of simulated members were looking for an alternative or resisting at some round under Proposed change.',
    );
    expect(finding.classification).toBe('unstable');
    expect(find(findings, 'threshold-crossing', 'baseline').holdsIn).toBe(0);
    const stricter = generateFindings(
      input({ baseline, 'proposed-change': proposed }, { adverseThreshold: 0.5 }),
    );
    const none = find(stricter, 'threshold-crossing', 'proposed-change');
    expect(none.holdsIn).toBe(0);
    expect(none.statement).toContain('at least 50%');
  });
});

describe('who is affected most, and in which order', () => {
  const cast = [
    named('alpha', 'Alpha'),
    named('beta', 'Beta'),
    named('gamma', 'Gamma'),
    named('delta', 'Delta'),
  ];
  const baseline = Array.from({ length: 30 }, (_, index) =>
    run(index, {
      alpha: { stance: 0 },
      beta: { stance: 0 },
      gamma: { stance: 0 },
      delta: { stance: 0 },
    }),
  );

  it('finds the actor whose stance fell furthest from the baseline, and the order of the first three', () => {
    const proposed = baseline.map((_, index) =>
      run(index, {
        alpha: { stance: -0.5 },
        beta: { stance: -0.3 },
        gamma: { stance: -0.1 },
        delta: { stance: 0.1 },
      }),
    );
    const findings = generateFindings(
      input({ baseline, 'proposed-change': proposed }, { actors: cast }),
    );
    const ordering = findings.filter(
      (item) => item.kind === 'ordering' && item.variantId === 'proposed-change',
    );
    expect(ordering).toHaveLength(2);
    expect(ordering.find((item) => item.actorId === 'alpha')!.statement).toBe(
      'In 30 of 30 seeded runs, simulated Alpha showed the least favourable change in stance compared with No change under Proposed change.',
    );
    const sequence = ordering.find((item) => item.actorId === null)!;
    expect(sequence.statement).toBe(
      'In 30 of 30 seeded runs, the three simulated groups with the least favourable change in stance compared with No change were, in order, Alpha, Beta and Gamma, under Proposed change.',
    );
    expect(sequence.classification).toBe('repeatable');
  });

  it('reports an order that flips as less repeatable than the actor that is always first', () => {
    const proposed = baseline.map((_, index) =>
      run(index, {
        alpha: { stance: -0.5 },
        beta: { stance: index < 12 ? -0.3 : -0.2 },
        gamma: { stance: index < 12 ? -0.2 : -0.3 },
        delta: { stance: 0.1 },
      }),
    );
    const ordering = generateFindings(
      input({ baseline, 'proposed-change': proposed }, { actors: cast }),
    ).filter((item) => item.kind === 'ordering');
    expect(ordering.find((item) => item.actorId === 'alpha')!.holdsIn).toBe(30);
    expect(ordering.find((item) => item.actorId === null)!.holdsIn).toBe(18);
    expect(ordering.find((item) => item.actorId === null)!.classification).toBe('unstable');
  });

  it('is left out when there is only one actor to put in order', () => {
    const alone = [run(0, { subscribers: { stance: 0 } })];
    const findings = generateFindings(input({ baseline: alone, 'proposed-change': alone }));
    expect(findings.some((item) => item.kind === 'ordering')).toBe(false);
  });
});

describe('events that followed from the change', () => {
  it('counts the runs in which each kind of event occurred, beside how often the baseline had it', () => {
    const baseline = Array.from({ length: 30 }, (_, index) =>
      run(index, { subscribers: { stance: 0 } }, { events: index < 3 ? ['counter-move'] : [] }),
    );
    const proposed = Array.from({ length: 30 }, (_, index) =>
      run(
        index,
        { subscribers: { stance: -0.3 } },
        { events: index < 24 ? ['counter-move', 'scrutiny'] : ['scrutiny'] },
      ),
    );
    const findings = generateFindings(input({ baseline, 'proposed-change': proposed }));
    const events = findings.filter((item) => item.kind === 'second-order-event');
    const counter = events.find((item) => item.statement.includes('counter-move'))!;
    expect(counter.statement).toBe(
      'In 24 of 30 seeded runs, a simulated “counter-move” event occurred under Proposed change (under No change: 3 of 30).',
    );
    expect(counter.holdsIn).toBe(24);
    // 24 of 30 has a lower bound of 0.63: mostly repeatable, not repeatable.
    expect(counter.classification).toBe('mostly-repeatable');
    const scrutiny = events.find((item) => item.statement.includes('scrutiny'))!;
    expect(scrutiny.holdsIn).toBe(30);
    expect(scrutiny.classification).toBe('repeatable');
    // The more frequent kind comes first.
    expect(events[0]).toBe(scrutiny);
  });

  it('reports at most three kinds of event for a variant, and none when nothing occurred', () => {
    const many = Array.from({ length: 10 }, (_, index) =>
      run(index, { subscribers: { stance: 0 } }, { events: ['a', 'b', 'c', 'd', 'e'] }),
    );
    const none = Array.from({ length: 10 }, (_, index) =>
      run(index, { subscribers: { stance: 0 } }),
    );
    const findings = generateFindings(input({ baseline: none, 'proposed-change': many }));
    expect(findings.filter((item) => item.kind === 'second-order-event')).toHaveLength(3);
    const quiet = generateFindings(input({ baseline: none, 'proposed-change': none }));
    expect(quiet.some((item) => item.kind === 'second-order-event')).toBe(false);
  });
});

describe('every finding', () => {
  const eight: Variant[] = [
    BASELINE,
    ...Array.from({ length: 7 }, (_, index) => ({
      ...MILD,
      id: `alternative-${index}`,
      label: `Alternative ${index}`,
    })),
  ];
  const actors = Array.from({ length: 60 }, (_, index) =>
    named(`actor-${String(index).padStart(2, '0')}`, `Actor ${index}`, 1 - index / 100),
  );
  const records = Object.fromEntries(
    eight.map((variant, rank) => [
      variant.id,
      Array.from({ length: 30 }, (_, seed) =>
        run(
          seed,
          Object.fromEntries(
            actors.map((actor, position) => [
              actor.id,
              { stance: -0.02 * rank - 0.001 * position, shares: { wait: 1 } },
            ]),
          ),
          { events: seed % 2 === 0 ? ['counter-move'] : [], peak: 0.1 * rank },
        ),
      ),
    ]),
  );

  it('is limited to the most informative, with the comparisons with the baseline always kept', () => {
    const findings = generateFindings({
      actors,
      variants: eight,
      records: new Map(Object.entries(records)),
    });
    expect(findings).toHaveLength(FINDINGS_LIMIT);
    expect(findings.filter((item) => item.kind === 'direction-vs-baseline')).toHaveLength(7);
    expect(findings.filter((item) => item.kind === 'threshold-crossing')).toHaveLength(8);
    // Ordered by importance: the kinds never go back to an earlier one.
    const rank = [
      'direction-vs-baseline',
      'threshold-crossing',
      'ordering',
      'second-order-event',
      'majority-response',
    ];
    const ranks = findings.map((item) => rank.indexOf(item.kind));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    // Within the comparisons, the change comes first, then its alternatives in the order given.
    expect(
      findings
        .filter((item) => item.kind === 'direction-vs-baseline')
        .map((item) => item.variantId),
    ).toEqual(eight.slice(1).map((variant) => variant.id));
  });

  it('carries its counts, the Wilson interval and the class that follows from them, under a unique id', () => {
    const findings = generateFindings({
      actors,
      variants: eight,
      records: new Map(Object.entries(records)),
    });
    expect(new Set(findings.map((item) => item.id)).size).toBe(findings.length);
    for (const item of findings) {
      expect(item.id.length).toBeLessThanOrEqual(80);
      expect(item.holdsIn).toBeGreaterThanOrEqual(0);
      expect(item.holdsIn).toBeLessThanOrEqual(item.of);
      const interval = wilson(item.holdsIn, item.of);
      expect(item.interval).toEqual({ lo: round4(interval.lo), hi: round4(interval.hi) });
      expect(item.classification).toBe(classifyStability(item.holdsIn, item.of));
      expect(item.predicate.length).toBeGreaterThan(10);
    }
  });

  it('is the same list for the same runs', () => {
    const make = () =>
      generateFindings({ actors, variants: eight, records: new Map(Object.entries(records)) });
    expect(JSON.stringify(make())).toBe(JSON.stringify(make()));
  });
});

/** What may not appear in a statement: a promise, or a rate that reads as a real-world one. */
function wordingProblems(text: string): string[] {
  const problems: string[] = [];
  if (!/\bsimulated\b/u.test(text)) problems.push('does not say "simulated"');
  if (/\b(?:will|shall|going to)\b/iu.test(text)) problems.push('promises an outcome');
  if (/\b(?:customers?|users?|people|employees?|citizens?|consumers?|residents?)\b/iu.test(text)) {
    problems.push('names a real population');
  }
  for (const match of text.matchAll(/\d+(?:\.\d+)?%\s+(?!of simulated\b)/gu)) {
    problems.push(`a percentage that is not of simulated members: ${match[0]}`);
  }
  return problems;
}

describe('the wording of findings', () => {
  it('lets the lint catch a statement that promises or reads as a real rate', () => {
    expect(wordingProblems('58% of customers will churn.')).toEqual(
      expect.arrayContaining([
        'does not say "simulated"',
        'promises an outcome',
        'names a real population',
        'a percentage that is not of simulated members: 58% ',
      ]),
    );
    expect(
      wordingProblems('In 7 of 12 seeded runs, at least 30% of simulated members were waiting.'),
    ).toEqual([]);
  });

  it('says simulated, never promises, and never states a rate of a real population', async () => {
    const analysis = await runAnalysis(inputs({ runsPerVariant: 20 }), stubSimulator, {
      now: clock,
    });
    expect(analysis.findings.length).toBeGreaterThan(5);
    const kinds = new Set(analysis.findings.map((item) => item.kind));
    expect(kinds).toEqual(
      new Set([
        'direction-vs-baseline',
        'threshold-crossing',
        'ordering',
        'second-order-event',
        'majority-response',
      ]),
    );
    for (const item of analysis.findings) {
      expect(wordingProblems(item.statement), item.statement).toEqual([]);
      expect(wordingProblems(`simulated ${item.predicate}`), item.predicate).toEqual([]);
      expect(item.statement).toMatch(/^In \d+ of 20 seeded runs, /u);
    }
  });

  it('puts the change on the same seeds as the baseline, so the stub shows the paired result', async () => {
    const analysis = await runAnalysis(inputs({ runsPerVariant: 20 }), stubSimulator, {
      now: clock,
    });
    const direction = analysis.findings.find(
      (item) => item.kind === 'direction-vs-baseline' && item.variantId === 'proposed-change',
    )!;
    expect(direction.statement).toContain(
      'less favourable under Proposed change than under No change',
    );
    expect(direction.holdsIn).toBe(20);
    expect(direction.classification).toBe('repeatable');
  });

  it('never calls a finding repeatable on fewer than 10 runs, even when every run agrees', async () => {
    const analysis = await runAnalysis(inputs({ runsPerVariant: 6 }), stubSimulator, {
      now: clock,
    });
    const direction = analysis.findings.find(
      (item) => item.kind === 'direction-vs-baseline' && item.variantId === 'proposed-change',
    )!;
    expect(direction.holdsIn).toBe(6);
    expect(direction.classification).toBe('mostly-repeatable');
    expect(analysis.findings.some((item) => item.classification === 'repeatable')).toBe(false);
  });
});
