import { describe, expect, it } from 'vitest';
import { actorSetFixture } from '../../shared/lab-fixtures.js';
import { analysisSchema } from '../../shared/analysis.js';
import { DECISION_STATUSES, STATUS_RULES, type DecisionStatus } from '../../shared/decision.js';
import { buildCanvas } from '../src/decision/build.js';
import { deriveStatus, type StatusInput } from '../src/decision/status.js';
import { Guard } from '../src/decision/words.js';
import { constraintOf } from './support/constraint-fixtures.js';
import {
  OPTIONS,
  citedActors,
  controlledInputs,
  counterfactualOf,
  counterfactualSet,
  critiqueOf,
  critiqueSet,
  sensitivityRow,
  type ControlledOptions,
  type OptionSpec,
} from './support/decision-fixtures.js';

/** One option clearly better than no change on every lens: low resistance for everyone, wide support from the key actors. */
const WINNER: OptionSpec[] = [
  OPTIONS.baseline(0.4, { favourable: 0.3 }),
  OPTIONS.proposed(0.2, { favourable: 0.6 }),
];
const CALM = [sensitivityRow('small-move', 0.01)];

const canvasOf = (options: OptionSpec[], config: ControlledOptions = {}) =>
  buildCanvas(controlledInputs(options, { sensitivity: CALM, ...config }));

describe('the decision status: every one of the six, reached on purpose and explained', () => {
  it('names a robust option only when nothing it was tried against reverses it and every check is clear', () => {
    const canvas = canvasOf(WINNER);
    expect(canvas.status.status).toBe('robust-option');
    expect(canvas.status.rule).toBe('robust');
    expect(canvas.status.conditions).toEqual([]);
    expect(canvas.answer.preferredAlternativeId).toBe('proposed-change');
    expect(canvas.lenses.every((lens) => lens.verdict === 'clear-leader')).toBe(true);
    expect(canvas.lenses.every((lens) => lens.leaderId === 'proposed-change')).toBe(true);
    expect(canvas.alternatives.map((option) => [option.id, option.verdict])).toEqual([
      ['baseline', 'weak'],
      ['proposed-change', 'preferred'],
    ]);
    expect(canvas.answer.recommendation.kind).toBe('proceed');
  });

  it('is a conditional option when the same option leads but the gate is provisional', () => {
    const canvas = canvasOf(WINNER, {
      constraints: [
        constraintOf({ id: 'c-0001', statement: 'Spending on the change is capped.' }),
        constraintOf({
          id: 'c-0002',
          category: 'capacity',
          hardness: 'hard',
          statement: 'The team can take on one change at a time.',
          validation: 'unvalidated',
        }),
      ],
      recorded: {
        revision: 1,
        status: 'provisional',
        label: 'Provisional: the simulation ran with 1 constraint not yet validated.',
        reasons: [],
        applied: [],
        notApplied: [],
        impacts: [],
      },
    });
    expect(canvas.status.status).toBe('conditional-option');
    expect(canvas.answer.preferredAlternativeId).toBe('proposed-change');
    expect(canvas.constraints.gate).toBe('provisional');
    expect(canvas.status.conditions.join(' ')).toMatch(/Provisional/u);
    expect(canvas.constraints.hard[0]).toMatchObject({ id: 'c-0002', provisional: true });
    // The sentence at the top of the page says which measure the option leads on, not "the headline lens".
    expect(canvas.status.headline).toMatch(
      /^“Proposed change” is ahead on “Least resistance overall”, on conditions\./u,
    );
  });

  it('is conditional when a counterfactual view larger than the lead could reverse it, and says so', () => {
    const canvas = canvasOf(WINNER, {
      counterfactuals: counterfactualSet([
        counterfactualOf('without-budget', 0.25),
        counterfactualOf('delayed-implementation', -0.01),
      ]),
    });
    expect(canvas.status.status).toBe('conditional-option');
    expect(canvas.status.conditions[0]).toMatch(/could stop leading/u);
    expect(canvas.status.conditions[0]).toMatch(/other options were not re-run/u);
    const view = canvas.changes.counterfactuals.views.find(
      (entry) => entry.id === 'without-budget',
    );
    expect(view?.couldChangeAnswer).toBe(true);
    expect(
      canvas.changes.counterfactuals.views.find((entry) => entry.id === 'delayed-implementation')
        ?.couldChangeAnswer,
    ).toBe(false);
    expect(canvas.answer.recommendation.invalidatedBy.items[0]?.text).toMatch(
      /could stop leading/u,
    );
  });

  it('is conditional when one sensitive assumption could reverse it, and lists it as critical', () => {
    const canvas = canvasOf(WINNER, { sensitivity: [sensitivityRow('trust-down', 0.3), ...CALM] });
    expect(canvas.status.status).toBe('conditional-option');
    expect(canvas.changes.assumptions[0]).toMatchObject({
      flipsAnswer: true,
      origin: 'system-assumption',
    });
    expect(canvas.drivers[0]).toMatchObject({ kind: 'assumption', flipsAnswer: true });
    expect(
      canvas.validation.items.find((item) => item.source === 'flipping-assumption'),
    ).toMatchObject({
      kind: 'assumption',
      priority: 'high',
    });
  });

  it('is a multiple of plausible options when two options differ by less than the least that is told apart', () => {
    const canvas = canvasOf([OPTIONS.baseline(0.3), OPTIONS.proposed(0.34)]);
    expect(canvas.status.status).toBe('multiple-plausible-options');
    expect(canvas.status.rule).toBe('no-clear-leader');
    expect(canvas.answer.preferredAlternativeId).toBeNull();
    expect(canvas.alternatives.every((option) => option.verdict !== 'preferred')).toBe(true);
    expect(canvas.answer.recommendation.kind).toBe('hold');
    expect(canvas.status.headline).toMatch(/does not pick one/u);
  });

  it('does not call a gap a lead when it lies within the run-to-run spread', () => {
    const level = canvasOf([
      OPTIONS.baseline(0.3, { jitter: 0.25 }),
      OPTIONS.proposed(0.37, { jitter: 0.25 }),
    ]);
    expect(level.status.status).toBe('multiple-plausible-options');
    const clear = canvasOf([OPTIONS.baseline(0.3), OPTIONS.proposed(0.37)]);
    expect(clear.lenses[0]).toMatchObject({ verdict: 'clear-leader', leaderId: 'baseline' });
  });

  it('does not tell options apart from fewer than ten seeded runs, and says why', () => {
    const canvas = canvasOf([OPTIONS.baseline(0.4), OPTIONS.proposed(0.1)], { runs: 6 });
    expect(canvas.status.status).toBe('multiple-plausible-options');
    expect(canvas.lenses[0]?.note).toMatch(/at least 10 are needed/u);
    expect(canvas.futures).toMatchObject({ supported: false, items: [] });
  });

  it('is insufficient evidence when no source is attached and no actor cites one', () => {
    const canvas = canvasOf(WINNER, {
      documents: [],
      actors: actorSetFixture().actors,
    });
    expect(canvas.status.status).toBe('insufficient-evidence');
    expect(canvas.status.rule).toBe('evidence-insufficient');
    expect(canvas.evidence.level).toBe('insufficient');
    expect(canvas.answer.recommendation.kind).toBe('gather-evidence');
    expect(canvas.validation.items.some((item) => item.source === 'missing-evidence')).toBe(true);
  });

  it('is insufficient evidence when the grounding review abstains', () => {
    const canvas = canvasOf(WINNER, {
      ledger: {
        conflicts: [],
        sufficiency: {
          level: 'insufficient',
          reasons: ['Only 1 directly supported finding; at least 3 are needed.'],
        },
      },
    });
    expect(canvas.status.status).toBe('insufficient-evidence');
    expect(canvas.status.why[0]).toMatch(/grounding review abstains/u);
  });

  it('is insufficient evidence when the change cannot move anyone, because nobody has a direction of impact', () => {
    const flat = citedActors().map((actor) => ({
      ...actor,
      traits: {
        ...actor.traits,
        impact: { ...actor.traits.impact, value: 0, spread: 0 },
      },
    }));
    const canvas = canvasOf([OPTIONS.baseline(0.3), OPTIONS.proposed(0.3)], { actors: flat });
    expect(canvas.status.status).toBe('insufficient-evidence');
    expect(canvas.status.rule).toBe('no-direction');
  });

  it('is blocked when the gate is blocked by a hard constraint nobody has settled', () => {
    const canvas = canvasOf(WINNER, {
      constraints: [
        constraintOf({
          id: 'c-0003',
          category: 'legal',
          hardness: 'hard',
          statement: 'The change needs a licence.',
          validation: 'unvalidated',
        }),
      ],
    });
    expect(canvas.status.status).toBe('blocked-by-hard-constraint');
    expect(canvas.status.rule).toBe('gate-blocked');
    expect(canvas.constraints.gate).toBe('blocked');
    expect(canvas.answer.preferredAlternativeId).toBeNull();
    expect(canvas.answer.recommendation.kind).toBe('resolve-constraint');
    expect(canvas.validation.items[0]).toMatchObject({ kind: 'constraint', priority: 'high' });
  });

  it('rules out only the alternative a confirmed hard constraint bans, and never prefers it', () => {
    const canvas = canvasOf(
      [
        OPTIONS.baseline(0.4, { favourable: 0.3 }),
        OPTIONS.proposed(0.2, { favourable: 0.6 }),
        OPTIONS.smaller(0.1, { favourable: 0.8 }),
      ],
      {
        constraints: [
          constraintOf({
            id: 'c-0004',
            category: 'budget',
            hardness: 'hard',
            statement: 'A smaller rise is not permitted.',
            affectedAlternativeIds: ['smaller-rise'],
            effects: [{ kind: 'block' }],
          }),
        ],
      },
    );
    const smaller = canvas.alternatives.find((option) => option.id === 'smaller-rise');
    expect(smaller).toMatchObject({
      verdict: 'blocked',
      violationConfirmed: true,
      violatedConstraintIds: ['c-0004'],
    });
    expect(canvas.answer.preferredAlternativeId).toBe('proposed-change');
    expect(canvas.lenses[0]?.leaderId).toBe('proposed-change');
  });

  it('needs a human decision when two lenses each have a different clear leader', () => {
    const canvas = canvasOf([
      OPTIONS.baseline(
        { provider: 0.2, 'rival-provider': 0.2, regulator: 0.2, subscribers: 0.5, resellers: 0.5 },
        { favourable: { provider: 0.6, 'rival-provider': 0.6, regulator: 0.6 } },
      ),
      OPTIONS.proposed(
        { provider: 0.3, 'rival-provider': 0.3, regulator: 0.3, subscribers: 0.1, resellers: 0.1 },
        { favourable: { provider: 0.3, 'rival-provider': 0.3, regulator: 0.3 } },
      ),
    ]);
    expect(canvas.status.status).toBe('needs-human-decision');
    expect(canvas.status.rule).toBe('value-tradeoff');
    expect(canvas.lensAgreement.state).toBe('disagree');
    expect(canvas.lensAgreement.statement).toMatch(/does not average it away/u);
    expect(canvas.answer.preferredAlternativeId).toBeNull();
    expect(new Set(canvas.lenses.map((lens) => lens.leaderId)).size).toBe(2);
    expect(canvas.answer.recommendation.kind).toBe('decide');
    expect(
      canvas.validation.items.some(
        (item) => item.source === 'status' && item.kind === 'stakeholder',
      ),
    ).toBe(true);
  });

  it('needs a human decision when two confirmed hard constraints cannot hold together', () => {
    const canvas = canvasOf(WINNER, {
      constraints: [
        constraintOf({
          id: 'c-0005',
          category: 'budget',
          hardness: 'hard',
          statement: 'Spending is capped at $100,000.',
        }),
        constraintOf({
          id: 'c-0006',
          category: 'budget',
          hardness: 'hard',
          statement: 'Spending is at least $200,000.',
        }),
      ],
    });
    expect(canvas.status.status).toBe('needs-human-decision');
    expect(canvas.status.rule).toBe('hard-conflict');
    expect(canvas.status.why[0]).toMatch(/caps it at/u);
  });

  it('reaches every status, and the rules table names each exactly as the code does', () => {
    const reached = new Set<DecisionStatus>([
      canvasOf(WINNER).status.status,
      canvasOf([OPTIONS.baseline(0.3), OPTIONS.proposed(0.31)]).status.status,
      canvasOf(WINNER, { documents: [], actors: actorSetFixture().actors }).status.status,
      canvasOf(WINNER, { critiques: null }).status.status,
    ]);
    expect(reached).toEqual(
      new Set([
        'robust-option',
        'multiple-plausible-options',
        'insufficient-evidence',
        'conditional-option',
      ]),
    );
    expect(new Set(STATUS_RULES.map((rule) => rule.status))).toEqual(new Set(DECISION_STATUSES));
    expect(STATUS_RULES.map((rule) => rule.id)).toEqual([
      'no-analysis',
      'gate-blocked',
      'all-violate',
      'no-direction',
      'evidence-insufficient',
      'hard-conflict',
      'value-tradeoff',
      'no-clear-leader',
      'robust',
      'conditional',
    ]);
  });
});

describe('each condition, on its own, keeps a leading option from being robust', () => {
  const cases: [string, ControlledOptions, RegExp][] = [
    ['no constraints were reviewed', { constraints: null }, /No constraints were reviewed/u],
    [
      'the independent review has not been run',
      { critiques: null },
      /independent review has not been run/u,
    ],
    [
      'the independent review belongs to another comparison',
      { critiques: critiqueSet([], 'analysis-other') },
      /different comparison/u,
    ],
    [
      'a blocking objection stands',
      { critiques: critiqueSet([critiqueOf({ severity: 'blocking', status: 'open' })]) },
      /blocking objection/u,
    ],
    [
      'no counterfactual view was run',
      { counterfactuals: null },
      /No counterfactual view was run against it, so no change to the situation was tried/u,
    ],
    [
      'the counterfactual views no longer describe the project',
      { counterfactualsCurrent: false },
      /No counterfactual view was run/u,
    ],
    ['sensitivity was not run', { sensitivity: [] }, /Sensitivity to assumptions was not run/u],
    [
      'a constraint changed after the comparison',
      { revisionsNow: { scenario: 1, stakeholders: 1, actors: 1, constraints: 2 } },
      /before the constraints changed/u,
    ],
    [
      'the comparison did not record what it was made from',
      { revisions: null },
      /saved before Swarm recorded/u,
    ],
    [
      'a source conflict is open',
      {
        ledger: {
          conflicts: [
            {
              id: 'k1',
              topic: 'the size of the fee',
              status: 'detected',
              left: {
                passageId: 'S1',
                documentId: 'doc-1',
                documentName: 'a.md',
                start: 0,
                end: 10,
                quote: null,
                contentHash: 'h',
                role: 'supports',
              },
              right: {
                passageId: 'S2',
                documentId: 'doc-1',
                documentName: 'a.md',
                start: 20,
                end: 30,
                quote: null,
                contentHash: 'h',
                role: 'contradicts',
              },
              leftValue: '10',
              rightValue: '12',
            },
          ],
          sufficiency: null,
        },
      },
      /evidence is limited/u,
    ],
  ];
  it.each(cases)('%s', (_name, config, pattern) => {
    const canvas = canvasOf(WINNER, config);
    expect(canvas.status.status).toBe('conditional-option');
    expect(canvas.status.conditions.join('\n')).toMatch(pattern);
  });

  it('does not count a lens that cannot tell the leader apart as agreeing, and says which', () => {
    const canvas = canvasOf([
      OPTIONS.baseline(0.4, { favourable: 0.3 }),
      OPTIONS.proposed(0.2, { favourable: 0.31 }),
    ]);
    expect(canvas.status.status).toBe('conditional-option');
    expect(canvas.lensAgreement.state).toBe('agree');
    expect(canvas.status.conditions.join(' ')).toMatch(/Broadest support among key actors/u);
  });
});

describe('the status function on its own: precedence and the cases real data cannot make', () => {
  const guard = (): Guard => new Guard();
  const options = [
    { id: 'baseline', label: 'No change', kind: 'baseline' as const },
    { id: 'a', label: 'Option A', kind: 'alternative' as const },
    { id: 'b', label: 'Option B', kind: 'alternative' as const },
  ];
  const lens = (
    id: StatusInput['lenses'][number]['id'],
    leaderId: string | null,
    extra: Partial<StatusInput['lenses'][number]> = {},
  ) => ({
    id,
    name: id,
    question: 'q',
    measure: 'm',
    direction: 'lower' as const,
    computable: true,
    note: null,
    results: ['baseline', 'a', 'b'].map((alternativeId) => ({
      alternativeId,
      value: 0.3,
      low: 0.2,
      high: 0.4,
      runs: 20,
      standing: alternativeId === leaderId ? ('leads' as const) : ('behind' as const),
      detail: null,
    })),
    leaderId,
    levelIds: [],
    margin: 0.1,
    verdict: leaderId ? ('clear-leader' as const) : ('tie' as const),
    ...extra,
  });
  const base = (): StatusInput => ({
    options,
    hasRuns: true,
    gate: { status: 'clear', blockedBy: [], label: null, hardConflicts: [] },
    confirmedViolations: new Map(),
    unconfirmedViolations: new Map(),
    comparison: { constraints: 'clear' },
    signal: 'clear',
    headlineId: 'a',
    baselineId: 'baseline',
    evidence: { level: 'adequate', reasons: [] },
    lenses: [
      lens('overall-resistance', 'a'),
      lens('key-actor-support', 'a'),
      lens('decision-maker-resistance', 'a'),
      lens('worst-affected-downside', 'a'),
    ],
    flipsFor: () => [],
    examined: { counterfactuals: true, sensitivity: true },
    stale: null,
    critics: { reviewed: true, current: true, blockingOpen: 0 },
  });

  it('has no answer when there is no comparison, or only one option in it', () => {
    expect(deriveStatus({ ...base(), hasRuns: false }, guard()).reading).toMatchObject({
      status: 'insufficient-evidence',
      rule: 'no-analysis',
    });
    expect(
      deriveStatus({ ...base(), options: options.slice(0, 1) }, guard()).reading.why[0],
    ).toMatch(/only one option/u);
  });

  it('is blocked when every alternative violates a confirmed hard constraint, even with a clear gate', () => {
    const result = deriveStatus(
      {
        ...base(),
        confirmedViolations: new Map([
          ['a', ['A hard rule.']],
          ['b', ['A hard rule.']],
        ]),
      },
      guard(),
    );
    expect(result.reading).toMatchObject({
      status: 'blocked-by-hard-constraint',
      rule: 'all-violate',
    });
    expect(result.preferredId).toBeNull();
  });

  it('is not blocked when only some alternatives are ruled out', () => {
    const result = deriveStatus(
      { ...base(), confirmedViolations: new Map([['b', ['A hard rule.']]]) },
      guard(),
    );
    expect(result.reading.status).toBe('robust-option');
  });

  it('puts a blocked gate before everything, and missing evidence before a trade-off', () => {
    const blocked = deriveStatus(
      {
        ...base(),
        gate: {
          status: 'blocked',
          blockedBy: ['A hard legal constraint is not settled.'],
          label: null,
          hardConflicts: ['x'],
        },
        evidence: { level: 'insufficient', reasons: ['No source.'] },
      },
      guard(),
    );
    expect(blocked.reading.rule).toBe('gate-blocked');
    const thin = deriveStatus(
      {
        ...base(),
        evidence: { level: 'insufficient', reasons: ['No source.'] },
        lenses: [lens('overall-resistance', 'a'), lens('key-actor-support', 'b')],
      },
      guard(),
    );
    expect(thin.reading.rule).toBe('evidence-insufficient');
    const traded = deriveStatus(
      { ...base(), lenses: [lens('overall-resistance', 'a'), lens('key-actor-support', 'b')] },
      guard(),
    );
    expect(traded.reading).toMatchObject({
      status: 'needs-human-decision',
      rule: 'value-tradeoff',
    });
  });

  it('does not take a lens that cannot be computed, or a tie, for a disagreement', () => {
    const lenses = [
      lens('overall-resistance', 'a'),
      lens('key-actor-support', null),
      {
        ...lens('decision-maker-resistance', null),
        computable: false,
        verdict: 'not-assessed' as const,
      },
    ];
    const result = deriveStatus({ ...base(), lenses }, guard());
    expect(result.reading.status).toBe('conditional-option');
    expect(result.reading.conditions.join(' ')).toMatch(/could not be computed/u);
    expect(result.reading.conditions.join(' ')).toMatch(
      /Fewer than two lenses|cannot be told apart/u,
    );
  });

  it('will not call the change robust when the comparison could not tell it from no change', () => {
    const result = deriveStatus({ ...base(), signal: 'no-difference' }, guard());
    expect(result.reading).toMatchObject({
      status: 'multiple-plausible-options',
      rule: 'no-clear-leader',
    });
    expect(result.reading.why[0]).toMatch(/no measurable difference/u);
    const elsewhere = deriveStatus(
      { ...base(), signal: 'no-difference', headlineId: 'b', baselineId: 'baseline' },
      guard(),
    );
    expect(elsewhere.reading.status).toBe('robust-option');
  });

  it('keeps the explanation to words a person reads and never to a score', () => {
    for (const input of [
      base(),
      {
        ...base(),
        gate: {
          status: 'provisional' as const,
          blockedBy: [],
          label: 'Provisional: x.',
          hardConflicts: [],
        },
      },
    ]) {
      const { reading } = deriveStatus(input, guard());
      expect(JSON.stringify(reading)).not.toMatch(/confidence|probab|%|will /iu);
    }
  });

  it('is deterministic', () => {
    const first = deriveStatus(base(), guard());
    expect(deriveStatus(base(), guard())).toEqual(first);
    expect(analysisSchema).toBeDefined();
  });
});
