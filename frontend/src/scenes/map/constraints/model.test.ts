import { describe, expect, it } from 'vitest';
import {
  constraintSchema,
  constraintSetSchema,
  counterfactualSetSchema,
  type Constraint,
  type ConstraintCoverage,
  type ConstraintEffect,
} from '../../../../../shared/constraints';
import {
  APPLIED_WORDS,
  CHOICE_WORDS,
  appliedStateOf,
  choicesOf,
  consideredWords,
  draftOfConstraint,
  draftOfEffect,
  effectOfDraft,
  gateTone,
  hasChanges,
  inputOfDraft,
  namesOf,
  patchOfDraft,
  pointsWords,
  problemWith,
  sectionsOf,
  tallyOf,
  viewRowsOf,
  waitingOf,
  windowWords,
  NO_EFFECT,
} from './model';

const minimal = {
  id: 'c-0001',
  category: 'budget',
  statement: 'Spending on the change is capped.',
  source: 'user',
  hardness: 'soft',
  confidenceBasis: { kind: 'user-entry' },
  uncertainty: { level: 'low', reason: 'You stated it.' },
  validation: 'confirmed',
  review: 'accepted',
};
const constraintOf = (change: Partial<Constraint> = {}): Constraint =>
  constraintSchema.parse({ ...minimal, ...change });

const coverage = (change: Partial<ConstraintCoverage> = {}): ConstraintCoverage => ({
  status: 'provisional',
  reviewed: false,
  evaluatedAt: '2026-03-01T09:00:00.000Z',
  summary: 'Provisional: a simulation may run, and says so.',
  label: null,
  known: [],
  assumed: [],
  unvalidated: [],
  unknown: [],
  conflicting: [],
  missing: [],
  violations: [],
  affectedActors: [],
  interpretive: [],
  dangling: [],
  needsConfirmation: [],
  blockedBy: [],
  largestSensitivity: null,
  reasons: [],
  ...change,
});

describe('what the page puts in each section', () => {
  it('lists what is live by how hard it is, what waits first, and keeps what was set aside apart', () => {
    const set = {
      constraints: [
        constraintOf({ id: 'c-a', category: 'time', hardness: 'hard' }),
        constraintOf({
          id: 'c-b',
          category: 'budget',
          hardness: 'hard',
          review: 'proposed',
          validation: 'unvalidated',
        }),
        constraintOf({ id: 'c-c', category: 'legal', hardness: 'hard', validation: 'assumed' }),
        constraintOf({ id: 'c-d', category: 'market', hardness: 'soft' }),
        constraintOf({
          id: 'c-e',
          category: 'cultural',
          hardness: 'hard',
          review: 'removed',
          validation: 'rejected',
        }),
        constraintOf({ id: 'c-f', category: 'customer', hardness: 'soft', review: 'excluded' }),
      ],
    };
    const { hard, soft, setAside } = sectionsOf(set);
    // Waiting first, then what is not confirmed, then what is, each in the order of the kinds of limit.
    expect(hard.map((item) => item.id)).toEqual(['c-b', 'c-c', 'c-a']);
    expect(soft.map((item) => item.id)).toEqual(['c-d']);
    expect(setAside.map((item) => item.id).sort()).toEqual(['c-e', 'c-f']);
    expect(waitingOf(set)).toBe(1);
  });

  it('is calm about an empty set', () => {
    expect(sectionsOf({ constraints: [] })).toEqual({ hard: [], soft: [], setAside: [] });
  });
});

describe('what the gate says, as the page reads it', () => {
  it('turns each status into one tone and one word, and the lists into five numbers', () => {
    expect(gateTone('clear')).toBe('favor');
    expect(gateTone('provisional')).toBe('caution');
    expect(gateTone('blocked')).toBe('critical');
    const ref = { id: 'c-a', category: 'legal', hardness: 'hard', statement: 'x' } as const;
    const tally = tallyOf(
      coverage({
        known: [ref],
        assumed: [ref, ref],
        conflicting: [{ ids: ['c-a', 'c-b'], basis: 'Two ceilings.' }],
        missing: [
          { clarificationId: 'q-1', category: 'time', text: 'When?' },
          { clarificationId: 'q-2', category: 'budget', text: 'How much?' },
          { clarificationId: null, category: 'privacy', text: 'Is it personal?' },
        ],
        violations: [],
      }),
    );
    expect(tally.map((item) => [item.id, item.count])).toEqual([
      ['known', 1],
      ['assumed', 2],
      ['conflicting', 1],
      ['missing', 3],
      ['violated', 0],
    ]);
    for (const item of tally) expect(item.hint.length).toBeGreaterThan(10);
  });
});

describe('whether the simulation runs under a constraint, and what is said when it does not', () => {
  const run = { kind: 'delay', rounds: 2 } as const;
  it('tells applied, waiting, unknown, read and set aside apart', () => {
    expect(appliedStateOf(constraintOf({ enforcement: 'enforced', effects: [run] }))).toBe(
      'applied',
    );
    expect(
      appliedStateOf(
        constraintOf({
          enforcement: 'enforced',
          effects: [run],
          review: 'proposed',
          validation: 'unvalidated',
        }),
      ),
    ).toBe('waiting');
    expect(
      appliedStateOf(
        constraintOf({ enforcement: 'enforced', effects: [run], validation: 'unknown' }),
      ),
    ).toBe('unknown');
    expect(appliedStateOf(constraintOf({ enforcement: 'interpretive' }))).toBe('read');
    expect(appliedStateOf(constraintOf({ review: 'excluded' }))).toBe('set-aside');
    // What is only read says so in its words, and never that it changed a run.
    expect(APPLIED_WORDS.read).toBe('Read, not modelled');
  });

  it('says where a constraint that is read was taken into account, and never that it changed anything', () => {
    const read = constraintOf({
      enforcement: 'interpretive',
      consideredIn: ['gate', 'critic', 'analysis-record'],
    });
    expect(consideredWords(read)).toBe(
      'The simulation does not apply it, and does not change because of it. Taken into account in the gate, the independent review and the comparison’s record.',
    );
    expect(consideredWords(constraintOf({ enforcement: 'interpretive' }))).toBe(
      'The simulation does not apply it, and does not change because of it.',
    );
    expect(consideredWords(constraintOf({ enforcement: 'enforced', effects: [run] }))).toBe('');
  });

  it('says a window in rounds and in the person’s own words', () => {
    expect(windowWords({ fromRound: 3, toRound: 6, text: '' })).toBe('Rounds 3 to 6');
    expect(windowWords({ fromRound: 3, toRound: null, text: '' })).toBe('From round 3');
    expect(windowWords({ fromRound: null, toRound: 6, text: 'until the audit' })).toBe(
      'Until round 6 · until the audit',
    );
    expect(windowWords({ fromRound: null, toRound: null, text: '' })).toBe('');
  });

  it('names what it can and leaves out what is gone', () => {
    const names = new Map([
      ['a', 'Regulator'],
      ['b', 'Resellers'],
    ]);
    expect(namesOf(['b', 'ghost', 'a'], names)).toEqual(['Resellers', 'Regulator']);
  });
});

describe('what a person can do with a constraint', () => {
  it.each([
    [
      'proposed',
      { review: 'proposed', validation: 'unvalidated' },
      ['accept', 'confirm'],
      ['edit', 'mark-unknown', 'use-assumption', 'exclude', 'remove'],
    ],
    [
      'accepted and not confirmed',
      { review: 'accepted', validation: 'unvalidated' },
      ['confirm'],
      ['edit', 'mark-unknown', 'use-assumption', 'exclude', 'remove'],
    ],
    [
      'confirmed',
      { review: 'accepted', validation: 'confirmed' },
      [],
      ['edit', 'mark-unknown', 'exclude', 'remove'],
    ],
    [
      'assumed',
      { review: 'accepted', validation: 'assumed' },
      ['confirm'],
      ['edit', 'mark-unknown', 'exclude', 'remove'],
    ],
    [
      'unknown',
      { review: 'accepted', validation: 'unknown' },
      ['confirm'],
      ['edit', 'use-assumption', 'exclude', 'remove'],
    ],
    ['removed', { review: 'removed', validation: 'rejected' }, ['restore'], []],
    ['excluded', { review: 'excluded', validation: 'confirmed' }, ['restore'], []],
  ] as const)('offers the right choices for one that is %s', (_name, state, primary, more) => {
    expect(choicesOf(constraintOf(state))).toEqual({ primary, more });
  });

  it('has words for every choice', () => {
    for (const choice of [
      'accept',
      'confirm',
      'edit',
      'mark-unknown',
      'use-assumption',
      'exclude',
      'remove',
      'restore',
    ] as const) {
      expect(CHOICE_WORDS[choice]).toMatch(/^[A-Z]/u);
    }
  });
});

describe('writing and changing a constraint', () => {
  it('turns what a person typed into an effect the engine can read, and says what is wrong when it is not', () => {
    expect(effectOfDraft(NO_EFFECT)).toEqual({ effect: null, problem: null });
    expect(effectOfDraft({ ...NO_EFFECT, kind: 'block' }).effect).toEqual({ kind: 'block' });
    expect(effectOfDraft({ ...NO_EFFECT, kind: 'delay', rounds: '3' }).effect).toEqual({
      kind: 'delay',
      rounds: 3,
    });
    expect(effectOfDraft({ ...NO_EFFECT, kind: 'delay', rounds: '2.5' }).problem).toMatch(
      /whole number from 1 to 36/u,
    );
    expect(effectOfDraft({ ...NO_EFFECT, kind: 'delay', rounds: '' }).problem).toMatch(
      /whole number/u,
    );
    expect(
      effectOfDraft({ ...NO_EFFECT, kind: 'add-cost', target: 'switching', amount: '0.3' }).effect,
    ).toEqual({
      kind: 'add-cost',
      target: 'switching',
      amount: 0.3,
    });
    expect(effectOfDraft({ ...NO_EFFECT, kind: 'add-cost', amount: '0.9' }).problem).toMatch(
      /between 0.05 and 0.5/u,
    );
    expect(
      effectOfDraft({ ...NO_EFFECT, kind: 'reduce-influence', amount: '0.01' }).problem,
    ).toMatch(/0.05 and 0.9/u);
    expect(effectOfDraft({ ...NO_EFFECT, kind: 'add-risk', amount: '2' }).problem).toMatch(
      /0.05 and 1/u,
    );
    expect(effectOfDraft({ ...NO_EFFECT, kind: 'limit-actions', forbid: [] }).problem).toMatch(
      /at least one/u,
    );
    expect(
      effectOfDraft({ ...NO_EFFECT, kind: 'limit-actions', forbid: ['adopt'] }).effect,
    ).toEqual({
      kind: 'limit-actions',
      forbid: ['adopt'],
    });
    expect(effectOfDraft({ ...NO_EFFECT, kind: 'require-approval' }).problem).toMatch(
      /who approves/u,
    );
    expect(
      effectOfDraft({
        ...NO_EFFECT,
        kind: 'require-approval',
        approver: 'regulator',
        threshold: '0.1',
      }).effect,
    ).toEqual({
      kind: 'require-approval',
      approverActorId: 'regulator',
      threshold: 0.1,
    });
    expect(effectOfDraft({ ...NO_EFFECT, kind: 'force-sequencing' }).problem).toBe(
      'Choose who has to hear first.',
    );
    expect(
      effectOfDraft({ ...NO_EFFECT, kind: 'force-sequencing', before: ['resellers'], rounds: '2' })
        .effect,
    ).toEqual({
      kind: 'force-sequencing',
      beforeActorIds: ['resellers'],
      gapRounds: 2,
    });
  });

  it('reads an effect back into a draft, so that changing a constraint starts from what it is', () => {
    const effects: ConstraintEffect[] = [
      { kind: 'block' },
      { kind: 'limit-actions', forbid: ['switch', 'resist'] },
      { kind: 'delay', rounds: 4 },
      { kind: 'reduce-influence', amount: 0.3 },
      { kind: 'add-cost', target: 'switching', amount: 0.25 },
      { kind: 'require-approval', approverActorId: 'regulator', threshold: -0.2 },
      { kind: 'add-risk', amount: 0.4 },
      { kind: 'force-sequencing', beforeActorIds: ['a', 'b'], gapRounds: 3 },
    ];
    for (const effect of effects) {
      expect(effectOfDraft(draftOfEffect(effect)).effect).toEqual(effect);
    }
    expect(draftOfEffect(undefined)).toEqual(NO_EFFECT);
  });

  it('checks a draft before it is sent', () => {
    const base = draftOfConstraint(undefined, 'time');
    expect(base.category).toBe('time');
    expect(problemWith(base)).toBe('Say what the limit is, in a sentence.');
    expect(problemWith({ ...base, statement: 'A decision is due by spring.' })).toBeNull();
    expect(problemWith({ ...base, statement: 'x'.repeat(401) })).toBe('Keep it to 400 characters.');
    expect(problemWith({ ...base, statement: 'A limit.', fromRound: '0' })).toMatch(
      /whole number from 1 to 36/u,
    );
    expect(problemWith({ ...base, statement: 'A limit.', fromRound: '5', toRound: '3' })).toBe(
      'A window ends in or after the round it starts.',
    );
    expect(
      problemWith({
        ...base,
        statement: 'A limit.',
        effect: { ...NO_EFFECT, kind: 'delay', rounds: 'x' },
      }),
    ).toMatch(/Rounds/u);
  });

  it('writes a constraint of the person’s own without a word of where it came from', () => {
    const input = inputOfDraft({
      ...draftOfConstraint(undefined, 'staffing'),
      statement: '  Two people cover the desk at night.  ',
      hardness: 'hard',
      actorIds: ['provider'],
      fromRound: '2',
      toRound: '6',
      windowText: 'the first quarter',
      effect: { ...NO_EFFECT, kind: 'delay', rounds: '2' },
      validation: 'assumed',
    });
    expect(input).toMatchObject({
      category: 'staffing',
      statement: 'Two people cover the desk at night.',
      hardness: 'hard',
      affectedActorIds: ['provider'],
      window: { fromRound: 2, toRound: 6, text: 'the first quarter' },
      effects: [{ kind: 'delay', rounds: 2 }],
      validation: 'assumed',
    });
    for (const forbidden of [
      'source',
      'evidenceRefs',
      'enforcement',
      'review',
      'conflict',
      'consideredIn',
      'id',
    ]) {
      expect(input, forbidden).not.toHaveProperty(forbidden);
    }
  });

  it('sends an edit that says only what changed, and nothing when nothing did', () => {
    const original = constraintOf({
      statement: 'Spending is capped.',
      source: 'extracted',
      affectedActorIds: ['provider'],
    });
    const same = draftOfConstraint(original);
    expect(patchOfDraft(same, original)).toEqual({});
    expect(hasChanges(patchOfDraft(same, original))).toBe(false);
    const changed = patchOfDraft(
      {
        ...same,
        statement: 'Spending is capped at the board’s figure.',
        hardness: 'hard',
        effect: { ...NO_EFFECT, kind: 'add-cost', amount: '0.2' },
      },
      original,
    );
    expect(changed).toEqual({
      statement: 'Spending is capped at the board’s figure.',
      hardness: 'hard',
      effects: [{ kind: 'add-cost', target: 'adoption', amount: 0.2 }],
    });
    // There is no way to say where it came from in a patch.
    expect(Object.keys(patchOfDraft({ ...same, category: 'time' }, original))).toEqual([
      'category',
    ]);
  });
});

describe('the views of the proposed change', () => {
  it('says a difference in points with its sign, and a view that was not run with its reason', () => {
    expect(pointsWords(0.126)).toBe('+13 points');
    expect(pointsWords(-0.084)).toBe('−8 points');
    expect(pointsWords(0.001)).toBe('No difference');
    expect(pointsWords(null)).toBe('');
    const set = counterfactualSetSchema.parse({
      version: 1,
      generatedAt: '2026-03-01T09:00:00.000Z',
      variantId: 'proposed-change',
      variantLabel: 'Proposed change',
      metric:
        'Simulated share of members ending in switch or resist (each actor counts equally), 12 paired seeds',
      seeds: 12,
      baseMean: 0.4,
      inputs: { constraints: 3, actors: 2, scenario: 1 },
      views: [
        {
          id: 'without-budget',
          label: 'Without the budget constraint',
          change: 'The budget constraints the simulation applies are taken away.',
          applicable: true,
          deltaVsBase: 0.126,
          standardError: 0.01,
          classification: 'material',
          driver: 'Budget constraint: Spending is capped.',
          driverConstraintIds: ['c-a'],
        },
        {
          id: 'dependency-fails',
          label: 'A critical dependency fails',
          change: 'What the change depends on fails.',
          applicable: false,
          reason: 'No dependency is among the constraints, so there is nothing that can fail.',
          driver: '',
        },
      ],
    });
    expect(viewRowsOf(set)).toEqual([
      expect.objectContaining({
        id: 'without-budget',
        applicable: true,
        points: '+13 points',
        classification: 'material',
      }),
      expect.objectContaining({
        id: 'dependency-fails',
        applicable: false,
        points: '',
        reason: expect.stringContaining('nothing that can fail'),
      }),
    ]);
  });

  it('builds the schema it reads, so that a stored set is shown as it was stored', () => {
    expect(() =>
      constraintSetSchema.parse({
        version: 1,
        constraints: [constraintOf()],
        generatedAt: '2026-03-01T09:00:00.000Z',
        mode: 'rules',
        scenarioRevision: 1,
        actorsRevision: 1,
      }),
    ).not.toThrow();
  });
});
