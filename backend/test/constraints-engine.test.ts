import { describe, expect, it } from 'vitest';
import {
  simulationSpecSchema,
  type ResponseShares,
  type RunOutcome,
  type SimulationSpec,
} from '../../shared/analysis.js';
import type { AppliedConstraint } from '../../shared/constraint-effects.js';
import { claimsAgainst } from '../../e2e/support/claims.js';
import { lintText } from '../src/brief/lint.js';
import { openResponse } from '../src/simulation/response.js';
import { simulate, SimulationInputError } from '../src/simulation/simulate.js';
import { actor, CHAIN_RELATIONS, chainCast, key, spec } from './support/simulation-cast.js';

/** One constraint as the engine takes it. */
const constraint = (
  effect: AppliedConstraint['effect'],
  options: Partial<Omit<AppliedConstraint, 'effect'>> = {},
): AppliedConstraint => ({
  id: 'c-test',
  effect,
  actorIds: [],
  fromRound: null,
  toRound: null,
  ...options,
});

const with_ = (input: SimulationSpec, ...constraints: AppliedConstraint[]): SimulationSpec => ({
  ...input,
  constraints,
});

const of = (outcome: RunOutcome, id: string) => {
  const found = outcome.final.byActor.find((entry) => entry.actorId === id);
  if (!found) throw new Error(`No actor ${id}.`);
  return found;
};
const stanceAt = (outcome: RunOutcome, round: number, id: string): number =>
  outcome.rounds[round - 1]?.byActor.find((entry) => entry.actorId === id)?.stanceMean ??
  Number.NaN;
const sumOf = (shares: ResponseShares) => Object.values(shares).reduce((a, b) => a + b, 0);

/**
 * Two cohorts that listen to no one but themselves, and no responder: each moves alone, so what one
 * limit does to one actor is read off that actor, and what it does not touch is exactly what it was.
 */
const apart = () => [
  actor('alpha', 'cost-bearer', {
    traits: { impact: -0.7, sensitivity: 0.8, switchingCost: 0.3, riskTolerance: 0.3 },
  }),
  actor('delta', 'beneficiary', {
    traits: { impact: 0.6, sensitivity: 0.8, adoptionTendency: 0.5 },
  }),
];
const world = (variant: Partial<SimulationSpec['variant']> = {}, rounds = 12) =>
  spec(apart(), { rounds, variant: { intensity: 0.8, round: 2, ...variant } });

const SEED = 4242;

describe('constraints in the engine: what each effect does', () => {
  it('block keeps the change from the actors in scope, and the run is the one where it never landed', () => {
    const base = world();
    const none = simulate(world({ intensity: 0 }), SEED);
    const blocked = simulate(with_(base, constraint({ kind: 'block' })), SEED);
    expect(blocked.rounds).toEqual(none.rounds);
    expect(blocked.final).toEqual(none.final);
    expect(blocked.constraintEvents).toEqual([
      expect.objectContaining({ constraintId: 'c-test', kind: 'held', round: 2 }),
    ]);
    // The change, left to itself, does move them.
    expect(of(simulate(base, SEED), 'alpha').stanceMean).toBeLessThan(
      of(blocked, 'alpha').stanceMean - 0.2,
    );
  });

  it('block holds back only the actors it names, and leaves the others exactly as they were', () => {
    const base = world();
    const free = simulate(base, SEED);
    const none = simulate(world({ intensity: 0 }), SEED);
    const part = simulate(
      with_(base, constraint({ kind: 'block' }, { actorIds: ['alpha'] })),
      SEED,
    );
    expect(of(part, 'alpha')).toEqual(of(none, 'alpha'));
    expect(of(part, 'delta')).toEqual(of(free, 'delta'));
  });

  it('block in a window is the change landing when the window ends', () => {
    const through4 = simulate(with_(world(), constraint({ kind: 'block' }, { toRound: 4 })), SEED);
    const landsIn5 = simulate(world({ round: 5 }), SEED);
    expect(through4.rounds).toEqual(landsIn5.rounds);
    expect(through4.constraintEvents?.[0]?.description).toContain('until round 5');
    // A window that has ended before the change lands holds nothing back and says nothing.
    const early = simulate(
      with_(world({ round: 6 }), constraint({ kind: 'block' }, { toRound: 3 })),
      SEED,
    );
    expect(early.rounds).toEqual(simulate(world({ round: 6 }), SEED).rounds);
    expect(early.constraintEvents).toEqual([]);
  });

  it('delay lands the change later for the actor it names, and the actor is as if the change came then', () => {
    const delayed = simulate(
      with_(world(), constraint({ kind: 'delay', rounds: 3 }, { actorIds: ['alpha'] })),
      SEED,
    );
    const later = simulate(world({ round: 5 }), SEED);
    expect(of(delayed, 'alpha')).toEqual(of(later, 'alpha'));
    expect(stanceAt(delayed, 4, 'alpha')).toBeGreaterThan(
      stanceAt(simulate(world(), SEED), 4, 'alpha') + 0.1,
    );
    expect(of(delayed, 'delta')).toEqual(of(simulate(world(), SEED), 'delta'));
    expect(delayed.constraintEvents?.[0]).toMatchObject({
      kind: 'delayed',
      actorIds: ['alpha'],
      description: 'The change reaches Alpha from round 5 instead of round 2.',
    });
  });

  it('delay past the last round means the change never reaches them, and the run says so', () => {
    const out = simulate(
      with_(world({}, 6), constraint({ kind: 'delay', rounds: 9 }, { actorIds: ['alpha'] })),
      SEED,
    );
    const none = simulate(world({ intensity: 0 }, 6), SEED);
    expect(of(out, 'alpha')).toEqual(of(none, 'alpha'));
    expect(out.constraintEvents?.[0]?.description).toMatch(
      /does not reach Alpha within the 6 rounds/u,
    );
  });

  it('delay names a responder and it responds later: its event comes the delay later, on the same seed', () => {
    const input = spec(chainCast(), { relations: CHAIN_RELATIONS, rounds: 16 });
    const base = simulate(input, SEED);
    const first = base.events.find((event) => event.actorId === 'beta');
    expect(first, 'the competitor acts in the run it is compared with').toBeDefined();
    const slow = simulate(
      with_(input, constraint({ kind: 'delay', rounds: 2 }, { actorIds: ['beta'] })),
      SEED,
    );
    const slowed = slow.events.find((event) => event.actorId === 'beta');
    expect(slowed?.round).toBeGreaterThan(first!.round);
    // Delaying everything is not a slower responder: what it watches already comes later.
    const all = simulate(with_(input, constraint({ kind: 'delay', rounds: 2 })), SEED);
    const watching = all.events.find((event) => event.actorId === 'beta');
    expect(watching?.round).toBeGreaterThanOrEqual(first!.round);
  });

  it('force-sequencing reaches the later actor the gap after the earlier one: the same as a delay of that size', () => {
    const sequenced = simulate(
      with_(
        world(),
        constraint(
          { kind: 'force-sequencing', beforeActorIds: ['delta'], gapRounds: 3 },
          { actorIds: ['alpha'] },
        ),
      ),
      SEED,
    );
    const delayed = simulate(
      with_(world(), constraint({ kind: 'delay', rounds: 3 }, { actorIds: ['alpha'] })),
      SEED,
    );
    expect(sequenced.rounds).toEqual(delayed.rounds);
    expect(sequenced.constraintEvents?.[0]?.kind).toBe('sequenced');
    // With a delay on the earlier actor too, the later one follows it.
    const both = simulate(
      with_(
        world(),
        constraint({ kind: 'delay', rounds: 2 }, { id: 'c-first', actorIds: ['delta'] }),
        constraint(
          { kind: 'force-sequencing', beforeActorIds: ['delta'], gapRounds: 1 },
          { id: 'c-then', actorIds: ['alpha'] },
        ),
      ),
      SEED,
    );
    expect(of(both, 'alpha')).toEqual(of(simulate(world({ round: 5 }), SEED), 'alpha'));
  });

  it('reduce-influence makes an actor weigh less with those who listen to it', () => {
    const cast = [
      actor('voice', 'cost-bearer', {
        size: 1_000,
        traits: { impact: -0.9, sensitivity: 0.9, influence: 0.9 },
      }),
      actor('listener', 'end-user', {
        traits: { impact: 0, openness: 1, influence: 0.3, reactivity: 0 },
      }),
    ];
    const input = spec(cast, {
      relations: [{ from: 'voice', to: 'listener', type: 'influences', strength: 0.9 }],
      rounds: 14,
      variant: { intensity: 0.9 },
    });
    const heard = simulate(input, SEED);
    const quieter = simulate(
      with_(input, constraint({ kind: 'reduce-influence', amount: 0.8 }, { actorIds: ['voice'] })),
      SEED,
    );
    expect(of(heard, 'listener').stanceMean).toBeLessThan(-0.1);
    expect(of(quieter, 'listener').stanceMean).toBeGreaterThan(
      of(heard, 'listener').stanceMean + 0.04,
    );
    // The voice itself is where it was: only what others make of it changes.
    expect(of(quieter, 'voice').stanceMean).toBeCloseTo(of(heard, 'voice').stanceMean, 2);
    expect(quieter.constraintEvents?.[0]).toMatchObject({ kind: 'influence-reduced', round: 1 });
  });

  it('add-cost on switching turns looking for an alternative into resisting, and moves no stance', () => {
    const input = world();
    const free = simulate(input, SEED);
    const costly = simulate(
      with_(
        input,
        constraint({ kind: 'add-cost', target: 'switching', amount: 0.5 }, { actorIds: ['alpha'] }),
      ),
      SEED,
    );
    expect(of(free, 'alpha').responseShares.switch).toBeGreaterThan(0.3);
    expect(of(costly, 'alpha').responseShares.switch).toBeLessThan(
      of(free, 'alpha').responseShares.switch,
    );
    expect(of(costly, 'alpha').responseShares.resist).toBeGreaterThan(
      of(free, 'alpha').responseShares.resist,
    );
    expect(of(costly, 'alpha').stanceMean).toBe(of(free, 'alpha').stanceMean);
    expect(of(costly, 'delta')).toEqual(of(free, 'delta'));
  });

  it('add-cost on taking the change up makes a benefit land less and a harm land more', () => {
    const input = world();
    const free = simulate(input, SEED);
    const rough = simulate(
      with_(input, constraint({ kind: 'add-cost', target: 'adoption', amount: 0.5 })),
      SEED,
    );
    expect(of(rough, 'delta').stanceMean).toBeLessThan(of(free, 'delta').stanceMean);
    expect(of(rough, 'alpha').stanceMean).toBeLessThan(of(free, 'alpha').stanceMean);
    expect(rough.constraintEvents?.map((event) => event.kind)).toEqual(['friction-added']);
  });

  it('limit-actions reads a stance as the nearest response left, and moves no stance', () => {
    const input = world();
    const free = simulate(input, SEED);
    const shares = (o: RunOutcome) => of(o, 'alpha').responseShares;
    const noSwitch = simulate(
      with_(
        input,
        constraint({ kind: 'limit-actions', forbid: ['switch'] }, { actorIds: ['alpha'] }),
      ),
      SEED,
    );
    expect(shares(noSwitch).switch).toBe(0);
    expect(shares(noSwitch).resist).toBeCloseTo(shares(free).resist + shares(free).switch, 12);
    expect(of(noSwitch, 'alpha').stanceMean).toBe(of(free, 'alpha').stanceMean);

    const meek = simulate(
      with_(
        input,
        constraint(
          { kind: 'limit-actions', forbid: ['switch', 'resist'] },
          { actorIds: ['alpha'] },
        ),
      ),
      SEED,
    );
    expect(shares(meek).switch + shares(meek).resist).toBe(0);
    expect(shares(meek)['adapt-defensively']).toBeCloseTo(
      shares(free)['adapt-defensively'] + shares(free).switch + shares(free).resist,
      12,
    );

    const noAdopt = simulate(
      with_(
        input,
        constraint({ kind: 'limit-actions', forbid: ['adopt'] }, { actorIds: ['delta'] }),
      ),
      SEED,
    );
    expect(of(noAdopt, 'delta').responseShares.adopt).toBe(0);
    expect(of(noAdopt, 'delta').responseShares['accept-with-conditions']).toBeCloseTo(
      of(free, 'delta').responseShares['accept-with-conditions'] +
        of(free, 'delta').responseShares.adopt,
      12,
    );
    for (const outcome of [noSwitch, meek, noAdopt]) {
      expect(sumOf(outcome.final.responseShares)).toBeCloseTo(1, 9);
    }
  });

  it('limit-actions in a window limits only those rounds', () => {
    const input = world();
    const windowed = simulate(
      with_(
        input,
        constraint(
          { kind: 'limit-actions', forbid: ['switch'] },
          { actorIds: ['alpha'], fromRound: 3, toRound: 5 },
        ),
      ),
      SEED,
    );
    const free = simulate(input, SEED);
    expect(windowed.rounds[1]).toEqual(free.rounds[1]);
    expect(windowed.rounds[3]?.responseShares.switch).toBeLessThan(
      free.rounds[3]?.responseShares.switch ?? 0,
    );
    expect(windowed.rounds[9]).toEqual(free.rounds[9]);
  });

  it('add-risk weighs on members who accept little risk, for as long as it is active', () => {
    const input = world();
    const none = simulate(input, SEED);
    const wary = simulate(
      with_(input, constraint({ kind: 'add-risk', amount: 0.9 }, { actorIds: ['alpha'] })),
      SEED,
    );
    const brief = simulate(
      with_(
        input,
        constraint(
          { kind: 'add-risk', amount: 0.9 },
          { actorIds: ['alpha'], fromRound: 3, toRound: 5 },
        ),
      ),
      SEED,
    );
    expect(of(wary, 'alpha').stanceMean).toBeLessThan(of(none, 'alpha').stanceMean - 0.03);
    // Taken away after round 5, the stance relaxes back toward where it would have been.
    expect(of(brief, 'alpha').stanceMean).toBeGreaterThan(of(wary, 'alpha').stanceMean);
    expect(of(brief, 'alpha').stanceMean).toBeLessThanOrEqual(of(none, 'alpha').stanceMean);
    expect(of(wary, 'delta')).toEqual(of(none, 'delta'));
    expect(wary.constraintEvents?.[0]).toMatchObject({ kind: 'risk-added', round: 1 });
    expect(brief.constraintEvents?.[0]).toMatchObject({ kind: 'risk-added', round: 3 });
  });
});

describe('constraints in the engine: an approver', () => {
  const approverWorld = (impact: number, rounds = 16) =>
    spec(
      [
        key('board', 'governance', { impact, sensitivity: 0.9, reactivity: 0.8, priorStance: 0 }),
        actor('public', 'cost-bearer', {
          traits: { impact: -0.7, sensitivity: 0.8, switchingCost: 0.3 },
        }),
      ],
      { rounds, variant: { intensity: 0.9, round: 2 } },
    );
  const needs = (threshold: number) =>
    constraint(
      { kind: 'require-approval', approverActorId: 'board', threshold },
      { actorIds: ['public'] },
    );

  it('lets the change reach the others the round after the approver’s stance gets there, and not before', () => {
    const input = approverWorld(0.8);
    const approved = simulate(with_(input, needs(0.3)), SEED);
    const granted = approved.constraintEvents?.find((event) => event.kind === 'approval-granted');
    expect(granted, 'the approver reaches the threshold').toBeDefined();
    expect(granted!.round).toBeGreaterThan(2);
    // The change lands on the public in the round of the approval, as if it had been proposed then.
    const proposedThen = simulate(
      { ...input, variant: { ...input.variant, round: granted!.round } },
      SEED,
    );
    expect(of(approved, 'public')).toEqual(of(proposedThen, 'public'));
    // Held back until then, they have not moved.
    expect(stanceAt(approved, granted!.round - 1, 'public')).toBeGreaterThan(
      stanceAt(simulate(input, SEED), granted!.round - 1, 'public'),
    );
  });

  it('never lets it reach them when the approver does not get there, and says so', () => {
    const input = approverWorld(-0.8);
    const withheld = simulate(with_(input, needs(0.3)), SEED);
    const none = simulate({ ...input, variant: { ...input.variant, intensity: 0 } }, SEED);
    expect(of(withheld, 'public')).toEqual(of(none, 'public'));
    expect(withheld.constraintEvents).toEqual([
      expect.objectContaining({ kind: 'approval-withheld', round: 16, actorIds: ['board'] }),
    ]);
    // A threshold below where the approver stands is met as soon as it has read the change.
    const lenient = simulate(with_(input, needs(-1)), SEED);
    expect(lenient.constraintEvents?.[0]).toMatchObject({ kind: 'approval-granted', round: 3 });
  });

  it('does not gate the approver, so that it cannot wait on itself', () => {
    const input = approverWorld(0.8);
    const everyone = simulate(
      with_(
        input,
        constraint({ kind: 'require-approval', approverActorId: 'board', threshold: 0.3 }),
      ),
      SEED,
    );
    const alone = simulate(with_(input, needs(0.3)), SEED);
    expect(everyone.rounds).toEqual(alone.rounds);
  });

  it('a threshold that is only read after the change lands, at the end of a round, is not met by the prior alone', () => {
    const input = spec(
      [
        key('board', 'governance', { impact: 0, priorStance: 0.9 }),
        actor('public', 'cost-bearer', { traits: { impact: -0.7, sensitivity: 0.8 } }),
      ],
      { rounds: 10, variant: { intensity: 0.9, round: 4 } },
    );
    const out = simulate(with_(input, needs(0.5)), SEED);
    expect(out.constraintEvents?.[0]).toMatchObject({ kind: 'approval-granted', round: 5 });
  });
});

describe('constraints in the engine: determinism, scope and refusal', () => {
  const several = () =>
    with_(
      world(),
      constraint({ kind: 'delay', rounds: 2 }, { id: 'c-delay', actorIds: ['alpha'] }),
      constraint({ kind: 'add-risk', amount: 0.4 }, { id: 'c-risk' }),
      constraint(
        { kind: 'limit-actions', forbid: ['resist'] },
        { id: 'c-limit', actorIds: ['alpha'] },
      ),
      constraint({ kind: 'add-cost', target: 'switching', amount: 0.2 }, { id: 'c-cost' }),
    );

  it('gives the same outcome for the same spec and seed, from a copy or from JSON, and another for another seed', () => {
    const first = JSON.stringify(simulate(several(), SEED));
    expect(JSON.stringify(simulate(several(), SEED))).toBe(first);
    expect(JSON.stringify(simulate(structuredClone(several()), SEED))).toBe(first);
    expect(
      JSON.stringify(simulate(JSON.parse(JSON.stringify(several())) as SimulationSpec, SEED)),
    ).toBe(first);
    expect(JSON.stringify(simulate(several(), SEED + 1))).not.toBe(first);
  });

  it('keeps the shape of an outcome, and its events in the order they happened, each of them in range', () => {
    const outcome = simulate(several(), SEED);
    expect(sumOf(outcome.final.responseShares)).toBeCloseTo(1, 9);
    const rounds = outcome.constraintEvents?.map((event) => event.round) ?? [];
    expect(rounds.length).toBeGreaterThanOrEqual(4);
    for (const event of outcome.constraintEvents ?? []) {
      expect(event.round).toBeGreaterThanOrEqual(1);
      expect(event.round).toBeLessThanOrEqual(12);
      expect(event.description.length).toBeLessThanOrEqual(300);
    }
    expect(JSON.stringify(outcome)).not.toMatch(/NaN|Infinity/u);
  });

  it('says what it did in words that make no forecast and claim nothing about the world', () => {
    const outcome = simulate(
      with_(
        approverWorldSpec(),
        constraint(
          { kind: 'require-approval', approverActorId: 'board', threshold: 0.3 },
          { actorIds: ['public'] },
        ),
        constraint({ kind: 'block' }, { id: 'c-block', actorIds: ['public'], toRound: 3 }),
        constraint({ kind: 'delay', rounds: 2 }, { id: 'c-delay' }),
        constraint({ kind: 'limit-actions', forbid: ['switch', 'resist'] }, { id: 'c-limit' }),
        constraint({ kind: 'add-risk', amount: 0.3 }, { id: 'c-risk' }),
        constraint({ kind: 'reduce-influence', amount: 0.3 }, { id: 'c-inf' }),
        constraint({ kind: 'add-cost', target: 'adoption', amount: 0.3 }, { id: 'c-cost' }),
        constraint(
          { kind: 'force-sequencing', beforeActorIds: ['board'], gapRounds: 1 },
          { id: 'c-seq', actorIds: ['public'] },
        ),
      ),
      SEED,
    );
    expect(
      new Set(outcome.constraintEvents?.map((event) => event.kind)).size,
    ).toBeGreaterThanOrEqual(6);
    for (const event of outcome.constraintEvents ?? []) {
      expect(lintText(event.description), event.description).toEqual([]);
      expect(claimsAgainst(event.description), event.description).toEqual([]);
    }
  });

  it('says nothing of holding back a change that has no strength to land', () => {
    const baseline = simulate(
      with_(
        world({ intensity: 0 }),
        constraint({ kind: 'block' }),
        constraint({ kind: 'delay', rounds: 2 }),
      ),
      SEED,
    );
    expect(baseline.constraintEvents).toEqual([]);
    const afterTheEnd = simulate(
      with_(world({ round: 12 }, 6), constraint({ kind: 'block' })),
      SEED,
    );
    expect(afterTheEnd.constraintEvents).toEqual([]);
  });

  it('refuses a constraint that names someone who is not in the cast, as it refuses a variant that does', () => {
    for (const bad of [
      constraint({ kind: 'delay', rounds: 1 }, { actorIds: ['nobody'] }),
      constraint({ kind: 'require-approval', approverActorId: 'nobody', threshold: 0 }),
      constraint({ kind: 'force-sequencing', beforeActorIds: ['nobody'], gapRounds: 1 }),
    ]) {
      expect(() => simulate(with_(world(), bad), SEED)).toThrow(SimulationInputError);
    }
  });

  it('refuses a spec whose constraint the schema does not accept', () => {
    expect(() =>
      simulationSpecSchema.parse(with_(world(), constraint({ kind: 'delay', rounds: 0 }))),
    ).toThrow();
    expect(() =>
      simulate(with_(world(), constraint({ kind: 'block' }, { fromRound: 5, toRound: 2 })), SEED),
    ).toThrow();
  });

  it('applies a constraint in a run that is explained, and in one without its second-order parts', () => {
    const input = spec(chainCast(), { relations: CHAIN_RELATIONS, rounds: 16 });
    const constrained = with_(
      input,
      constraint({ kind: 'add-risk', amount: 0.5 }, { actorIds: ['alpha'] }),
    );
    const explained = simulate(constrained, SEED, { explain: true });
    expect(explained.explained).toBe(true);
    expect(explained.constraintEvents?.[0]?.kind).toBe('risk-added');
    expect(simulate(constrained, SEED, { signals: false }).events).toEqual([]);
    expect(simulate(constrained, SEED, { signals: false }).constraintEvents).toHaveLength(1);
  });

  it('reads a response taken away as the nearest one left, and leaves the three that cannot be taken', () => {
    expect([0, 1, 2, 3, 4, 5].map((index) => openResponse(index, 0))).toEqual([0, 1, 2, 3, 4, 5]);
    expect([0, 1, 2, 3, 4, 5].map((index) => openResponse(index, 1))).toEqual([1, 1, 2, 3, 4, 5]);
    expect([0, 1, 2, 3, 4, 5].map((index) => openResponse(index, 2))).toEqual([0, 1, 2, 3, 5, 5]);
    expect([0, 1, 2, 3, 4, 5].map((index) => openResponse(index, 4))).toEqual([0, 1, 2, 3, 4, 3]);
    expect([0, 1, 2, 3, 4, 5].map((index) => openResponse(index, 7))).toEqual([1, 1, 2, 3, 3, 3]);
  });
});

function approverWorldSpec(): SimulationSpec {
  return spec(
    [
      key('board', 'governance', { impact: 0.8, sensitivity: 0.9, reactivity: 0.8 }),
      actor('public', 'cost-bearer', { traits: { impact: -0.7, sensitivity: 0.8 } }),
    ],
    { rounds: 16, variant: { intensity: 0.9, round: 2 } },
  );
}
