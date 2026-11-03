import { describe, expect, it } from 'vitest';
import { MAX_APPLIED_CONSTRAINTS, provisionalLabel } from '../../shared/constraints.js';
import { claimsAgainst } from '../../e2e/support/claims.js';
import { lintText } from '../src/brief/lint.js';
import { detectConflicts, quantitiesIn, withConflicts } from '../src/constraints/conflicts.js';
import { appliedFor, compileConstraints, reachOf } from '../src/constraints/enforce.js';
import { evaluateGate } from '../src/constraints/gate.js';
import { refreshSet } from '../src/constraints/refresh.js';
import {
  NOW,
  constraintOf,
  gateWorld,
  setOf,
  ALTERNATIVES,
} from './support/constraint-fixtures.js';

const BAN = { kind: 'block' } as const;
const gate = (
  constraints: Parameters<typeof setOf>[0],
  world = gateWorld(),
  set: Parameters<typeof setOf>[1] = {},
) => evaluateGate(setOf(constraints, set), world, NOW);

describe('the coverage gate: blocked', () => {
  it.each(['legal', 'regulatory', 'safety'] as const)(
    'stops a hard %s constraint that nobody has settled, and says what to do about it',
    (category) => {
      const result = gate([
        constraintOf({ category, hardness: 'hard', validation: 'unvalidated', review: 'proposed' }),
      ]);
      expect(result.status).toBe('blocked');
      expect(result.blockedBy).toHaveLength(1);
      expect(result.blockedBy[0]).toMatchObject({
        reason: 'unresolved-high-stakes',
        constraintId: 'c-0001',
      });
      expect(result.blockedBy[0]?.text).toMatch(
        /confirm it, set it aside, mark it unknown or choose to assume it/u,
      );
    },
  );

  it('lets each way of settling it through: confirmed, assumed, unknown, set aside, rejected', () => {
    const hard = { category: 'legal', hardness: 'hard' } as const;
    for (const state of [
      { validation: 'confirmed' },
      { validation: 'assumed' },
      { validation: 'unknown' },
      { validation: 'unvalidated', review: 'excluded' },
      { validation: 'rejected', review: 'removed' },
    ] as const) {
      const result = gate([constraintOf({ ...hard, ...state })]);
      expect(result.status, JSON.stringify(state)).not.toBe('blocked');
    }
  });

  it('does not stop a hard constraint of a kind that is not high-stakes, or a soft one of a kind that is', () => {
    expect(
      gate([
        constraintOf({ category: 'budget', hardness: 'hard', validation: 'unvalidated' }),
        constraintOf({
          id: 'c-0002',
          category: 'legal',
          statement: 'Counsel prefers a slower start.',
          hardness: 'soft',
          validation: 'unvalidated',
        }),
      ]).status,
    ).toBe('provisional');
  });

  it('stops a comparison with nothing to compare, when a hard ban covers every alternative', () => {
    const result = gate([
      constraintOf({
        category: 'legal',
        hardness: 'hard',
        effects: [BAN],
      }),
    ]);
    expect(result.status).toBe('blocked');
    expect(result.blockedBy.map((item) => item.reason)).toEqual(['violated-by-every-alternative']);
    expect(result.violations.map((item) => item.alternativeId)).toEqual(
      ALTERNATIVES.map(({ id }) => id),
    );
  });

  it('names an alternative a hard ban rules out and carries on when another is left', () => {
    const result = gate([
      constraintOf({
        category: 'legal',
        hardness: 'hard',
        effects: [BAN],
        affectedAlternativeIds: ['proposed-change'],
      }),
    ]);
    expect(result.status).not.toBe('blocked');
    expect(result.violations).toEqual([
      expect.objectContaining({ alternativeId: 'proposed-change', constraintIds: ['c-0001'] }),
    ]);
  });

  it('does not call a block that names actors, holds only for a window, is soft or is unknown a ban', () => {
    for (const change of [
      { affectedActorIds: ['regulator'] },
      { window: { fromRound: 1, toRound: 4, text: 'first quarter' } },
      { hardness: 'soft' as const },
      { validation: 'unknown' as const },
      { review: 'proposed' as const },
    ]) {
      const result = gate([
        constraintOf({ category: 'legal', hardness: 'hard', effects: [BAN], ...change }),
      ]);
      expect(result.violations, JSON.stringify(change)).toEqual([]);
    }
  });
});

describe('the coverage gate: provisional and clear', () => {
  it('is clear, and says that nothing found is not proof, when there is nothing and nothing is asked', () => {
    const result = gate([]);
    expect(result.status).toBe('clear');
    expect(result.label).toBeNull();
    expect(result.summary).toMatch(/not proof/u);
    expect(result.reviewed).toBe(true);
  });

  it('is clear when everything is confirmed and every hard constraint is one the simulation can apply', () => {
    const result = gate([
      constraintOf({ hardness: 'hard', effects: [{ kind: 'delay', rounds: 2 }] }),
      constraintOf({ id: 'c-0002', category: 'time', statement: 'A decision is due soon.' }),
    ]);
    expect(result.status).toBe('clear');
    expect(result.needsConfirmation).toEqual([]);
    expect(result.known.map((item) => item.id)).toEqual(['c-0001']);
    expect(result.summary).toMatch(/every constraint is confirmed/u);
  });

  it('is provisional for everything a person has not settled, and counts each in its label', () => {
    const result = gate(
      [
        constraintOf({ id: 'c-0001', validation: 'unvalidated', review: 'proposed' }),
        constraintOf({
          id: 'c-0002',
          category: 'time',
          statement: 'Sooner.',
          validation: 'assumed',
        }),
        constraintOf({
          id: 'c-0003',
          category: 'staffing',
          statement: 'Few.',
          validation: 'unknown',
        }),
        constraintOf({
          id: 'c-0004',
          category: 'capacity',
          statement: 'Limited.',
          hardness: 'hard',
          validation: 'confirmed',
        }),
      ],
      gateWorld(),
      {
        clarifications: [
          {
            id: 'q-privacy',
            category: 'privacy',
            question: 'Does the change touch personal data?',
            why: 'Rules on personal data can limit what may be kept.',
            status: 'open',
            answer: null,
            constraintId: null,
          },
        ],
      },
    );
    expect(result.status).toBe('provisional');
    expect(result.reviewed).toBe(false);
    expect(result.unvalidated.map((item) => item.id)).toEqual(['c-0001']);
    expect(result.assumed.map((item) => item.id)).toEqual(['c-0002']);
    expect(result.unknown.map((item) => item.id)).toEqual(['c-0003']);
    expect(result.missing).toEqual([
      expect.objectContaining({ clarificationId: 'q-privacy', category: 'privacy' }),
    ]);
    // A hard constraint with no effect is read, not run, and the label says so.
    expect(result.interpretive.map((item) => item.id).sort()).toEqual(
      ['c-0001', 'c-0002', 'c-0003', 'c-0004'].sort(),
    );
    expect(result.label).toBe(
      provisionalLabel({
        unvalidated: 1,
        assumed: 1,
        unknown: 1,
        missing: 1,
        conflicting: 0,
        notModelledHard: 1,
      }),
    );
    expect(result.label).toMatch(/^Provisional/u);
    expect(result.needsConfirmation).toHaveLength(3);
  });

  it('puts every open question in the gate, though a person is asked three at a time', () => {
    const questions = ['budget', 'time', 'capacity', 'privacy', 'reversibility'].map(
      (category) => ({
        id: `q-${category}`,
        category: category as 'budget',
        question: `Is there a limit of the ${category} kind?`,
        why: 'It could change which alternative comes out ahead.',
        status: 'open' as const,
        answer: null,
        constraintId: null,
      }),
    );
    const result = gate([], gateWorld(), { clarifications: questions });
    expect(result.status).toBe('provisional');
    expect(result.missing).toHaveLength(5);
  });

  it('is provisional once the scenario or the actors have changed since the constraints were read', () => {
    const constraint = constraintOf();
    const scenario = gate([constraint], gateWorld({ stale: { scenario: true, actors: false } }));
    expect(scenario.status).toBe('provisional');
    expect(scenario.reasons.join(' ')).toMatch(/earlier version of the scenario\./u);
    const both = gate([constraint], gateWorld({ stale: { scenario: true, actors: true } }));
    expect(both.reasons.join(' ')).toMatch(/the scenario and the actors/u);
  });

  it('is provisional for a constraint that names an actor, a scenario or an assumption that is gone', () => {
    for (const change of [
      { affectedActorIds: ['ghost'] },
      { affectedAlternativeIds: ['ghost'] },
      { assumptionId: 'ghost', validation: 'assumed' as const },
      {
        effects: [{ kind: 'require-approval' as const, approverActorId: 'ghost', threshold: 0.2 }],
      },
    ]) {
      const result = gate([constraintOf(change)]);
      expect(
        result.dangling.map((item) => item.id),
        JSON.stringify(change),
      ).toEqual(['c-0001']);
      expect(result.status).toBe('provisional');
    }
    // With no cast, nothing can be dangling from it yet.
    expect(
      gate([constraintOf({ affectedActorIds: ['ghost'] })], gateWorld({ actors: [] })).dangling,
    ).toEqual([]);
  });

  it('lists who is affected, by how many constraints, the approver and the actors a sequence waits for included', () => {
    const result = gate([
      constraintOf({ id: 'c-0001', affectedActorIds: ['regulator', 'provider'] }),
      constraintOf({
        id: 'c-0002',
        category: 'regulatory',
        statement: 'Approval is needed first.',
        effects: [{ kind: 'require-approval', approverActorId: 'regulator', threshold: 0.1 }],
        affectedActorIds: ['subscribers'],
      }),
      constraintOf({
        id: 'c-0003',
        category: 'sequencing',
        statement: 'Resellers hear first.',
        affectedActorIds: ['subscribers'],
        effects: [{ kind: 'force-sequencing', beforeActorIds: ['resellers'], gapRounds: 2 }],
      }),
      constraintOf({
        id: 'c-0004',
        category: 'time',
        statement: 'Removed.',
        review: 'removed',
        validation: 'rejected',
        affectedActorIds: ['provider'],
      }),
    ]);
    expect(result.affectedActors.map((item) => [item.actorId, item.constraintIds])).toEqual([
      ['regulator', ['c-0001', 'c-0002']],
      ['subscribers', ['c-0002', 'c-0003']],
      ['provider', ['c-0001']],
      ['resellers', ['c-0003']],
    ]);
  });

  it('is rules over the constraints and the scenario: the same inputs give the same answer, and no sensitivity is measured', () => {
    const constraints = [
      constraintOf({ validation: 'unvalidated', review: 'proposed' }),
      constraintOf({
        id: 'c-0002',
        category: 'legal',
        statement: 'The law says so.',
        hardness: 'hard',
        validation: 'confirmed',
      }),
    ];
    const first = gate(constraints);
    expect(JSON.stringify(gate(constraints))).toBe(JSON.stringify(first));
    expect(first.largestSensitivity).toBeNull();
    expect(JSON.stringify(first)).toBe(
      JSON.stringify(refreshSet(setOf(constraints), gateWorld(), NOW).coverage),
    );
  });

  it('is not reviewed until a person has been through it, and not while a constraint waits for a first look', () => {
    expect(gate([constraintOf()], gateWorld(), { reviewedAt: null }).reviewed).toBe(false);
    expect(gate([constraintOf({ review: 'proposed', validation: 'unvalidated' })]).reviewed).toBe(
      false,
    );
    expect(gate([constraintOf()]).reviewed).toBe(true);
  });

  it('writes its own copy without a promise, a forecast or a figure', () => {
    const states = [
      gate([]),
      gate([
        constraintOf({
          category: 'legal',
          hardness: 'hard',
          validation: 'unvalidated',
          review: 'proposed',
        }),
      ]),
      gate([
        constraintOf({ validation: 'assumed' }),
        constraintOf({ id: 'c-0002', validation: 'unknown', statement: 'Few.' }),
      ]),
      gate([constraintOf({ category: 'legal', hardness: 'hard', effects: [BAN] })]),
      gate(
        [constraintOf({ hardness: 'hard' })],
        gateWorld({ stale: { scenario: true, actors: true } }),
      ),
    ];
    const copy = states.flatMap((state) => [
      state.summary,
      state.label ?? '',
      ...state.reasons,
      ...state.blockedBy.map((item) => item.text),
    ]);
    for (const line of copy) {
      expect(lintText(line), line).toEqual([]);
      expect(claimsAgainst(line), line).toEqual([]);
    }
  });
});

describe('what the simulation can apply of a set of constraints', () => {
  const world = {
    actorIds: new Set(['provider', 'regulator', 'subscribers']),
    variantIds: new Set(['baseline', 'proposed-change', 'smaller-rise']),
  };

  it('reads a constraint with no effect, never runs a soft ban and says when what it names is gone', () => {
    expect(reachOf(constraintOf(), world)).toBe('interpretive');
    expect(reachOf(constraintOf({ effects: [BAN] }), world)).toBe('soft-block');
    expect(reachOf(constraintOf({ hardness: 'hard', effects: [BAN] }), world)).toBe('applicable');
    expect(
      reachOf(
        constraintOf({ effects: [{ kind: 'delay', rounds: 2 }], affectedActorIds: ['ghost'] }),
        world,
      ),
    ).toBe('dangling');
    // Naming one actor that is gone and one that is there still leaves something to apply it to.
    expect(
      reachOf(
        constraintOf({
          effects: [{ kind: 'delay', rounds: 2 }],
          affectedActorIds: ['ghost', 'provider'],
        }),
        world,
      ),
    ).toBe('applicable');
    expect(
      reachOf(
        constraintOf({
          effects: [{ kind: 'require-approval', approverActorId: 'ghost', threshold: 0 }],
        }),
        world,
      ),
    ).toBe('dangling');
  });

  it('applies what a person has looked at, and says why it did not apply the rest', () => {
    const compiled = compileConstraints(
      [
        constraintOf({ id: 'c-a', statement: 'Delay a.', effects: [{ kind: 'delay', rounds: 2 }] }),
        constraintOf({
          id: 'c-b',
          statement: 'Proposed b.',
          review: 'proposed',
          validation: 'unvalidated',
          effects: [{ kind: 'delay', rounds: 2 }],
        }),
        constraintOf({
          id: 'c-c',
          statement: 'Unknown c.',
          validation: 'unknown',
          effects: [{ kind: 'delay', rounds: 2 }],
        }),
        constraintOf({
          id: 'c-d',
          statement: 'Excluded d.',
          review: 'excluded',
          effects: [{ kind: 'delay', rounds: 2 }],
        }),
        constraintOf({
          id: 'c-e',
          statement: 'Removed e.',
          review: 'removed',
          validation: 'rejected',
          effects: [{ kind: 'delay', rounds: 2 }],
        }),
        constraintOf({ id: 'c-f', statement: 'Read f.' }),
        constraintOf({ id: 'c-g', statement: 'Soft ban g.', effects: [BAN] }),
        constraintOf({
          id: 'c-h',
          statement: 'Gone h.',
          effects: [{ kind: 'delay', rounds: 2 }],
          affectedActorIds: ['ghost'],
        }),
        constraintOf({ id: 'c-i', statement: 'Hard ban i.', hardness: 'hard', effects: [BAN] }),
      ],
      world,
    );
    expect(compiled.applied.map((item) => item.constraintId)).toEqual(['c-a', 'c-i']);
    expect(compiled.notApplied.map((item) => [item.constraintId, item.reason])).toEqual([
      ['c-c', 'unknown'],
      ['c-d', 'excluded'],
      ['c-f', 'interpretive'],
      ['c-g', 'soft-block'],
      ['c-h', 'dangling'],
    ]);
  });

  it('keeps a window only for the effects the engine reads one for, and says so for the rest', () => {
    const window = { fromRound: 3, toRound: 6, text: 'rounds three to six' };
    const compiled = compileConstraints(
      [
        constraintOf({ id: 'c-a', statement: 'Ban a.', hardness: 'hard', effects: [BAN], window }),
        constraintOf({
          id: 'c-b',
          statement: 'Delay b.',
          effects: [{ kind: 'delay', rounds: 2 }],
          window,
        }),
      ],
      world,
    );
    const [ban, delay] = compiled.applied;
    expect(ban).toMatchObject({ fromRound: 3, toRound: 6 });
    expect(ban?.note).toBeUndefined();
    expect(delay).toMatchObject({ fromRound: null, toRound: null });
    expect(delay?.note).toMatch(/window is not modelled/u);
  });

  it('applies at most the engine ceiling, and lists the rest as over the limit', () => {
    const many = Array.from({ length: MAX_APPLIED_CONSTRAINTS + 3 }, (_, at) =>
      constraintOf({
        id: `c-${at}`,
        statement: `Delay number ${at}.`,
        effects: [{ kind: 'delay', rounds: 2 }],
      }),
    );
    const compiled = compileConstraints(many, world);
    expect(compiled.applied).toHaveLength(MAX_APPLIED_CONSTRAINTS);
    expect(compiled.notApplied.map((item) => item.reason)).toEqual([
      'over-limit',
      'over-limit',
      'over-limit',
    ]);
  });

  it('gives a scenario only the constraints that are about it, and the baseline the ones about everything', () => {
    const compiled = compileConstraints(
      [
        constraintOf({ id: 'c-all', statement: 'All.', effects: [{ kind: 'delay', rounds: 2 }] }),
        constraintOf({
          id: 'c-one',
          statement: 'One.',
          effects: [{ kind: 'delay', rounds: 2 }],
          affectedAlternativeIds: ['proposed-change'],
        }),
      ],
      world,
    );
    expect(appliedFor(compiled.applied, 'proposed-change').map((item) => item.id)).toEqual([
      'c-all',
      'c-one',
    ]);
    expect(appliedFor(compiled.applied, 'smaller-rise').map((item) => item.id)).toEqual(['c-all']);
    expect(appliedFor(compiled.applied, 'baseline').map((item) => item.id)).toEqual(['c-all']);
  });

  it('labels each constraint enforced or interpretive from the cast, not from what anyone typed', () => {
    const set = refreshSet(
      setOf([
        constraintOf({
          id: 'c-a',
          statement: 'Delay a.',
          enforcement: 'enforced',
          effects: [{ kind: 'delay', rounds: 2 }],
        }),
        constraintOf({ id: 'c-b', statement: 'Read b.', enforcement: 'enforced' }),
      ]),
      gateWorld(),
      NOW,
    );
    expect(set.constraints.map((item) => [item.id, item.enforcement])).toEqual([
      ['c-a', 'enforced'],
      ['c-b', 'interpretive'],
    ]);
    const gone = refreshSet(
      setOf([
        constraintOf({
          enforcement: 'enforced',
          effects: [{ kind: 'delay', rounds: 2 }],
          affectedActorIds: ['ghost'],
        }),
      ]),
      gateWorld(),
      NOW,
    );
    expect(gone.constraints[0]?.enforcement).toBe('interpretive');
  });
});

describe('conflicts between constraints', () => {
  it('finds a limit stated twice in different amounts, or a ceiling below a floor, and nothing else', () => {
    expect(quantitiesIn('Spending is capped at $50,000 and at least 3 people are needed.')).toEqual(
      [
        { comparator: 'max', value: 50_000, unit: '$' },
        { comparator: 'min', value: 3, unit: 'people' },
      ],
    );
    const ceilings = detectConflicts([
      constraintOf({ id: 'c-a', statement: 'Spending is capped at $50,000.' }),
      constraintOf({ id: 'c-b', statement: 'Spending is capped at $80,000.' }),
    ]);
    expect(ceilings).toEqual([expect.objectContaining({ ids: ['c-a', 'c-b'] })]);
    expect(ceilings[0]?.basis).toMatch(/two different ceilings/u);
    expect(
      detectConflicts([
        constraintOf({ id: 'c-a', statement: 'No more than 10 staff.' }),
        constraintOf({ id: 'c-b', statement: 'At least 20 staff are needed.' }),
      ])[0]?.basis,
    ).toMatch(/caps it at 10 staff and the other asks for at least 20 staff/u);
    // A different unit, a different kind, one that is set aside, or one about other actors: not a conflict.
    expect(
      detectConflicts([
        constraintOf({ id: 'c-a', statement: 'Spending is capped at $50,000.' }),
        constraintOf({ id: 'c-b', statement: 'Spending is capped at 50 days.' }),
        constraintOf({ id: 'c-c', category: 'time', statement: 'Spending is capped at $80,000.' }),
        constraintOf({
          id: 'c-d',
          statement: 'Spending is capped at $90,000.',
          review: 'removed',
          validation: 'rejected',
        }),
      ]),
    ).toEqual([]);
    expect(
      detectConflicts([
        constraintOf({
          id: 'c-e',
          statement: 'Spending is capped at $60,000.',
          affectedActorIds: ['provider'],
        }),
        constraintOf({
          id: 'c-f',
          statement: 'Spending is capped at $70,000.',
          affectedActorIds: ['regulator'],
        }),
      ]),
    ).toEqual([]);
  });

  it('works out `conflict` on each constraint from the set, never from what a client sent', () => {
    const forged = constraintOf({
      id: 'c-a',
      statement: 'Spending is capped at $50,000.',
      conflict: ['conflicts-with:c-zzz'],
    });
    const other = constraintOf({ id: 'c-b', statement: 'Spending is capped at $80,000.' });
    const [a, b] = withConflicts([forged, other]);
    expect(a?.conflict).toEqual(['conflicts-with:c-b']);
    expect(b?.conflict).toEqual(['conflicts-with:c-a']);
    expect(withConflicts([forged])[0]?.conflict).toEqual([]);
    const result = gate([forged, other]);
    expect(result.status).toBe('provisional');
    expect(result.conflicting).toEqual([expect.objectContaining({ ids: ['c-a', 'c-b'] })]);
  });
});
