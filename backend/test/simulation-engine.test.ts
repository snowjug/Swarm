import { describe, expect, it } from 'vitest';
import {
  RESPONSE_CATEGORIES,
  runOutcomeSchema,
  simulationSpecSchema,
  type RunOutcome,
  type SimulationSpec,
} from '../../shared/analysis.js';
import {
  RELATION_TYPES,
  STAKEHOLDER_CATEGORIES,
  TRAIT_KEYS,
  type TraitKey,
} from '../../shared/stakeholders.js';
import { derive, stream } from '../src/simulation/random.js';
import { localRound } from '../src/agents/local.js';
import { buildPopulation } from '../src/simulation/population.js';
import { simulate, simulateValidated, SimulationInputError } from '../src/simulation/simulate.js';
import { settingsSchema, type Agent } from '../../shared/types.js';
import { actor, key, spec, variant } from './support/simulation-cast.js';

const finalOf = (outcome: RunOutcome, id: string) => {
  const found = outcome.final.byActor.find((entry) => entry.actorId === id);
  if (!found) throw new Error(`No actor ${id} in the outcome.`);
  return found;
};
const adverseShare = (outcome: RunOutcome, id: string): number => {
  const shares = finalOf(outcome, id).responseShares;
  return shares['adapt-defensively'] + shares.switch + shares.resist;
};
const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);
const mean = (values: number[]): number => sum(values) / values.length;
const sd = (values: number[]): number =>
  Math.sqrt(sum(values.map((value) => (value - mean(values)) ** 2)) / (values.length - 1));
const seeds = (count: number, from = 1): number[] =>
  Array.from({ length: count }, (_, at) => from + at);

const harmedAndBenefited = () => [
  actor('alpha', 'cost-bearer', { traits: { impact: -0.5, sensitivity: 0.7 } }),
  actor('delta', 'beneficiary', { traits: { impact: 0.5, sensitivity: 0.7 } }),
];

/** Everything an outcome must satisfy whatever the spec: the schema, finite numbers, shares of one. */
function expectWellFormed(outcome: RunOutcome, input: SimulationSpec, seed: number): void {
  expect(() => runOutcomeSchema.parse(outcome)).not.toThrow();
  expect(JSON.stringify(outcome)).not.toMatch(/null|NaN|Infinity/u);
  expect(outcome.seed).toBe(seed);
  expect(outcome.variantId).toBe(input.variant.id);
  expect(outcome.rounds.map((round) => round.round)).toEqual(seeds(input.rounds));
  const shareSets = [
    outcome.final.responseShares,
    ...outcome.rounds.map((round) => round.responseShares),
    ...outcome.final.byActor.map((entry) => entry.responseShares),
  ];
  for (const shares of shareSets) {
    expect(sum(RESPONSE_CATEGORIES.map((category) => shares[category]))).toBeCloseTo(1, 9);
  }
  expect(outcome.final.byActor.map((entry) => entry.actorId)).toEqual(
    input.actors.map((entry) => entry.id),
  );
  expect(outcome.work.members).toBe(sum(outcome.final.byActor.map((entry) => entry.members)));
  expect(outcome.work.updates).toBe(outcome.work.members * input.rounds);
  expect(outcome.events.length).toBeLessThanOrEqual(200);
}

describe('a run', () => {
  it('is byte-identical for the same spec and seed, from a copy or from JSON, and has no memory', () => {
    const input = spec(
      [
        ...harmedAndBenefited(),
        key('omega', 'regulator', { impact: 0, authority: 0.9 }),
        key('sigma', 'competitor', { impact: 0 }),
      ],
      {
        rounds: 14,
        relations: [
          { from: 'alpha', to: 'delta', type: 'influences', strength: 0.5 },
          { from: 'omega', to: 'alpha', type: 'regulates', strength: 0.6 },
        ],
      },
    );
    const first = JSON.stringify(simulate(input, 42));
    expect(JSON.stringify(simulate(input, 7))).not.toBe(first);
    expect(JSON.stringify(simulate(input, 42))).toBe(first);
    expect(JSON.stringify(simulate(structuredClone(input), 42))).toBe(first);
    expect(JSON.stringify(simulate(JSON.parse(JSON.stringify(input)) as SimulationSpec, 42))).toBe(
      first,
    );
    expect(JSON.stringify(simulateValidated(input, 42))).toBe(first);
    expectWellFormed(simulate(input, 42), input, 42);
  });

  it('differs between seeds: for a cohort through its members, for a lone actor through the noise', () => {
    const input = spec(harmedAndBenefited(), { rounds: 6 });
    const outcomes = seeds(8).map((seed) => JSON.stringify(simulate(input, seed)));
    expect(new Set(outcomes).size).toBe(8);
    // A key actor has no spread; its runs still differ, through the seeded noise on its stance.
    const lone = spec([key('solo', 'other', { priorStance: 0.2 })], { rounds: 6 });
    const stances = seeds(5).map((seed) => simulate(lone, seed).final.stanceMean);
    expect(new Set(stances).size).toBe(5);
  });

  it('reports each actor once, in the order of the cast, with the rounds numbered from one', () => {
    const input = spec([...harmedAndBenefited(), key('omega', 'other')], { rounds: 9 });
    const outcome = simulate(input, 5);
    expectWellFormed(outcome, input, 5);
    expect(outcome.rounds).toHaveLength(9);
    const last = outcome.rounds[8]!;
    expect(last.stanceMean).toBe(outcome.final.stanceMean);
    expect(last.responseShares).toEqual(outcome.final.responseShares);
    expect(last.byActor.map((entry) => entry.stanceMean)).toEqual(
      outcome.final.byActor.map((entry) => entry.stanceMean),
    );
  });

  it('never leaves its bounds or produces a number that is not a number, whatever the spec', () => {
    const next = stream(derive(2026, 'fuzz'));
    const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
    let eventsSeen = 0;
    for (let round = 0; round < 150; round += 1) {
      const count = 1 + Math.floor(next() * 8);
      const actors = Array.from({ length: count }, (_, at) => {
        const traits = {} as Record<TraitKey, { value: number; spread: number }>;
        for (const trait of TRAIT_KEYS) {
          const signed = trait === 'priorStance' || trait === 'impact';
          const edge = next();
          const value =
            edge < 0.08 ? (signed ? -1 : 0) : edge < 0.16 ? 1 : signed ? next() * 2 - 1 : next();
          const wide = next();
          traits[trait] = { value, spread: wide < 0.15 ? 0 : wide < 0.3 ? 0.5 : next() * 0.5 };
        }
        return actor(`actor-${at}`, pick(STAKEHOLDER_CATEGORIES), {
          kind: next() < 0.3 ? 'key' : 'cohort',
          size: 1 + Math.floor(next() * 1_000_000),
          sampleSize: 1 + Math.floor(next() * 25),
          traits,
        });
      });
      const ids = [...actors.map((entry) => entry.id), 'ghost'];
      const relations = Array.from({ length: Math.floor(next() * 13) }, () => ({
        from: pick(ids),
        to: pick(ids),
        type: pick(RELATION_TYPES),
        strength: next() < 0.1 ? 0 : next() < 0.1 ? 1 : next(),
      }));
      const rounds = 3 + Math.floor(next() * 10);
      const input = spec(actors, {
        relations,
        rounds,
        variant: {
          intensity: next() < 0.1 ? 0 : next() < 0.15 ? 1 : next(),
          round: 1 + Math.floor(next() * 14),
          impactOverrides: next() < 0.5 ? { [pick(actors).id]: next() * 2 - 1 } : {},
          traitEdits:
            next() < 0.5
              ? [{ actorId: pick(actors).id, trait: pick(TRAIT_KEYS), value: next() * 2 - 1 }]
              : [],
        },
      });
      const seed = pick([1, 2_147_483_647, 1 + Math.floor(next() * 2_147_483_646)]);
      const options = {
        sampleSizeCap: next() < 0.5 ? 1 + Math.floor(next() * 10) : undefined,
        signals: next() < 0.7,
      };
      const outcome = simulate(input, seed, options);
      expectWellFormed(outcome, input, seed);
      eventsSeen += outcome.events.length;
    }
    expect(eventsSeen).toBeGreaterThan(20);
  });

  it('refuses what it cannot honour, in words, rather than guessing', () => {
    const input = spec(harmedAndBenefited());
    for (const seed of [0, -3, 1.5, 2_147_483_648, Number.NaN]) {
      expect(() => simulate(input, seed)).toThrow(SimulationInputError);
    }
    expect(() => simulate(input, 1, { sampleSizeCap: 0 })).toThrow(/cap/u);
    expect(() => simulate(input, 1, { sampleSizeCap: 2.5 })).toThrow(SimulationInputError);
    expect(() => simulate({ ...input, rounds: 2 }, 1)).toThrow();
    expect(() => simulate({ ...input, actors: [] }, 1)).toThrow();
    expect(() => simulate(spec([actor('a', 'other'), actor('a', 'other')]), 1)).toThrow(
      /share an id/u,
    );
    expect(() =>
      simulate(spec(harmedAndBenefited(), { variant: { impactOverrides: { ghost: 0.5 } } }), 1),
    ).toThrow(/"ghost", who is not in the cast/u);
    expect(() =>
      simulate(
        spec(harmedAndBenefited(), {
          variant: { traitEdits: [{ actorId: 'ghost', trait: 'impact', value: 0 }] },
        }),
        1,
      ),
    ).toThrow(/"ghost", who is not in the cast/u);
    expect(() =>
      simulate(
        spec(harmedAndBenefited(), {
          variant: { traitEdits: [{ actorId: 'alpha', trait: 'mood', value: 0 }] },
        }),
        1,
      ),
    ).toThrow(/"mood", which is not a trait/u);
  });
});

describe('common random numbers', () => {
  const cast = (sensitivity: number, extra = false) => [
    actor('a', 'cost-bearer', { traits: { impact: -0.5, sensitivity } }),
    actor('b', 'cost-bearer', { traits: { impact: -0.5 } }),
    key('c', 'other', { impact: -0.2 }),
    ...(extra ? [actor('d', 'end-user', { traits: { impact: 0.3 } })] : []),
  ];

  it('leave an unrelated actor exactly as it was when another actor changes', () => {
    const before = simulate(spec(cast(0.5), { rounds: 10 }), 9);
    const after = simulate(spec(cast(0.9), { rounds: 10 }), 9);
    expect(finalOf(after, 'a')).not.toEqual(finalOf(before, 'a'));
    expect(finalOf(after, 'b')).toEqual(finalOf(before, 'b'));
    expect(finalOf(after, 'c')).toEqual(finalOf(before, 'c'));
    before.rounds.forEach((round, at) => {
      expect(after.rounds[at]!.byActor[1]).toEqual(round.byActor[1]);
      expect(after.rounds[at]!.byActor[2]).toEqual(round.byActor[2]);
    });
  });

  it('hold for a change a variant makes, for an actor added, and for the order of the cast', () => {
    const base = simulate(spec(cast(0.5), { rounds: 10 }), 9);
    const edited = simulate(
      spec(cast(0.5), {
        rounds: 10,
        variant: { traitEdits: [{ actorId: 'a', trait: 'switchingCost', value: 0.1 }] },
      }),
      9,
    );
    expect(finalOf(edited, 'a')).not.toEqual(finalOf(base, 'a'));
    expect(finalOf(edited, 'b')).toEqual(finalOf(base, 'b'));
    const longer = simulate(spec(cast(0.5, true), { rounds: 10 }), 9);
    for (const id of ['a', 'b', 'c']) expect(finalOf(longer, id)).toEqual(finalOf(base, id));
    const reversed = simulate(spec([...cast(0.5)].reverse(), { rounds: 10 }), 9);
    for (const id of ['a', 'b', 'c']) expect(finalOf(reversed, id)).toEqual(finalOf(base, id));
  });

  it('make a paired comparison far steadier than a comparison of independent runs', () => {
    const final = (sensitivity: number, seed: number): number =>
      finalOf(simulate(spec(cast(sensitivity), { rounds: 10 }), seed), 'a').stanceMean;
    const paired = seeds(30).map((seed) => final(0.6, seed) - final(0.5, seed));
    const independent = seeds(30).map((seed) => final(0.6, seed + 1_000) - final(0.5, seed));
    expect(mean(paired)).toBeLessThan(-0.02);
    expect(sd(paired)).toBeLessThan(0.3 * sd(independent));
  });

  it('give a capped cohort the first members of the full one, so that a cap only drops members', () => {
    const cohort = [actor('a', 'other', { sampleSize: 40 })];
    const full = buildPopulation(cohort, variant(), 9, 200);
    const capped = buildPopulation(cohort, variant(), 9, 15);
    expect(full.memberCount).toBe(40);
    expect(capped.memberCount).toBe(15);
    for (const array of ['stance', 'openness', 'landing', 'noiseAmp', 'switchingCost'] as const) {
      expect([...capped[array]]).toEqual([...full[array].slice(0, 15)]);
    }
  });
});

describe('the existing opinion-dynamics engine', () => {
  /** Twelve agents spread across the scale, run with an intervention that pushes toward `stance`. */
  function existingMean(strength: number, stance: number): number {
    let agents: Agent[] = Array.from({ length: 12 }, (_, at) => ({
      id: `agent-${at + 1}`,
      name: `Agent ${at + 1}`,
      role: 'Synthetic observer',
      persona: 'Fictional stakeholder proxy used to compare two engines.',
      topicIds: ['t'],
      initialOpinion: -0.3 + at * 0.05,
      opinion: -0.3 + at * 0.05,
      influence: 0.8,
      openness: 0.4,
      memory: [],
      sourceIds: [],
    }));
    const settings = settingsSchema.parse({
      agentCount: 12,
      rounds: 8,
      seed: 5,
      intervention: strength
        ? { round: 2, label: 'Assume that the change lands', stance, strength }
        : null,
    });
    for (let round = 1; round <= settings.rounds; round += 1) {
      agents = localRound(agents, settings, round).agents;
    }
    return mean(agents.map((agent) => agent.opinion));
  }

  it('moves in the same direction, and further the stronger the push, as this one does', () => {
    const strengths = [0, 0.3, 0.6, 0.9];
    const existing = strengths.map((strength) => existingMean(strength, -1));
    const here = strengths.map(
      (strength) =>
        finalOf(
          simulate(
            spec([actor('a', 'cost-bearer', { traits: { impact: -0.6, sensitivity: 0.8 } })], {
              rounds: 8,
              variant: { round: 2, intensity: strength },
            }),
            5,
          ),
          'a',
        ).stanceMean,
    );
    for (const series of [existing, here]) {
      series.forEach((value, at) => {
        if (at > 0) expect(value).toBeLessThan(series[at - 1]!);
        expect(value).toBeGreaterThanOrEqual(-1);
        expect(value).toBeLessThanOrEqual(1);
      });
    }
    // And the same for a push toward the favourable end.
    const upward = [0, 0.3, 0.6, 0.9].map((strength) => existingMean(strength, 1));
    upward.forEach((value, at) => {
      if (at > 0) expect(value).toBeGreaterThan(upward[at - 1]!);
    });
  });
});

describe('what the change does', () => {
  it('leaves an actor near its prior when the change has no intensity', () => {
    const priors = { alpha: -0.4, delta: 0.5, omega: 0.1 };
    for (const seed of seeds(10)) {
      const outcome = simulate(
        spec(
          [
            actor('alpha', 'cost-bearer', { sampleSize: 30, traits: { priorStance: -0.4 } }),
            actor('delta', 'beneficiary', { sampleSize: 30, traits: { priorStance: 0.5 } }),
            key('omega', 'other', { priorStance: 0.1 }),
          ],
          { rounds: 24, variant: { intensity: 0 } },
        ),
        seed,
      );
      expect(Math.abs(finalOf(outcome, 'alpha').stanceMean - priors.alpha)).toBeLessThan(0.1);
      expect(Math.abs(finalOf(outcome, 'delta').stanceMean - priors.delta)).toBeLessThan(0.1);
      expect(Math.abs(finalOf(outcome, 'omega').stanceMean - priors.omega)).toBeLessThan(0.25);
      expect(outcome.events).toEqual([]);
    }
  });

  it('moves harmed actors down and benefited ones up, and stronger changes move them further', () => {
    const intensities = [0, 0.2, 0.4, 0.6, 0.8, 1];
    const adverse: number[][] = intensities.map(() => []);
    for (const seed of seeds(25)) {
      const outcomes = intensities.map((intensity) =>
        simulate(spec(harmedAndBenefited(), { rounds: 12, variant: { intensity } }), seed),
      );
      outcomes.forEach((outcome, at) => {
        adverse[at]!.push(adverseShare(outcome, 'alpha'));
        if (at === 0) return;
        const previous = outcomes[at - 1]!;
        expect(finalOf(outcome, 'alpha').stanceMean).toBeLessThanOrEqual(
          finalOf(previous, 'alpha').stanceMean,
        );
        expect(finalOf(outcome, 'delta').stanceMean).toBeGreaterThanOrEqual(
          finalOf(previous, 'delta').stanceMean,
        );
        expect(finalOf(outcome, 'delta').responseShares.adopt).toBeGreaterThanOrEqual(
          finalOf(previous, 'delta').responseShares.adopt,
        );
      });
    }
    const means = adverse.map(mean);
    means.forEach((value, at) => {
      if (at > 0) expect(value).toBeGreaterThanOrEqual(means[at - 1]!);
    });
    expect(means[0]!).toBeLessThan(0.3);
    expect(means[5]!).toBeGreaterThan(0.95);
  });

  it('lands only from its round and fades by half each round after', () => {
    const lone = () => [key('solo', 'other', { impact: -1, sensitivity: 1, reactivity: 0 })];
    const outcome = simulate(spec(lone(), { rounds: 9, variant: { round: 4, intensity: 0.4 } }), 3);
    const stances = outcome.rounds.map((round) => round.stanceMean);
    // Nothing happens before round 4; from then on each round adds 0.4 * 0.5^(round - 4) of a push.
    for (const stance of stances.slice(0, 3)) expect(Math.abs(stance)).toBeLessThan(0.05);
    let expected = 0;
    stances.slice(3).forEach((stance, after) => {
      expected -= 0.4 * 0.5 ** after;
      expect(Math.abs(stance - expected), `round ${after + 4}`).toBeLessThan(0.07);
    });
    const quiet = simulate(spec(lone(), { rounds: 9, variant: { round: 4, intensity: 0 } }), 3);
    expect(quiet.rounds.every((round) => Math.abs(round.stanceMean) < 0.1)).toBe(true);
    const never = simulate(spec(lone(), { rounds: 9, variant: { round: 10, intensity: 1 } }), 3);
    expect(never.rounds.every((round) => Math.abs(round.stanceMean) < 0.1)).toBe(true);
  });

  it('applies an impact override instead of the trait, and edits to traits in range', () => {
    const base = simulate(spec(harmedAndBenefited(), { rounds: 12 }), 4);
    const none = simulate(
      spec(harmedAndBenefited(), { rounds: 12, variant: { impactOverrides: { alpha: 0 } } }),
      4,
    );
    const worse = simulate(
      spec(harmedAndBenefited(), { rounds: 12, variant: { impactOverrides: { alpha: -1 } } }),
      4,
    );
    expect(Math.abs(finalOf(none, 'alpha').stanceMean)).toBeLessThan(0.1);
    expect(finalOf(worse, 'alpha').stanceMean).toBeLessThan(finalOf(base, 'alpha').stanceMean);
    expect(finalOf(none, 'delta')).toEqual(finalOf(base, 'delta'));

    const costly = [
      actor('alpha', 'cost-bearer', { traits: { impact: -0.6, switchingCost: 0.9 } }),
    ];
    const stuck = simulate(spec(costly, { rounds: 12 }), 4);
    const free = simulate(
      spec(costly, {
        rounds: 12,
        variant: { traitEdits: [{ actorId: 'alpha', trait: 'switchingCost', value: 0.1 }] },
      }),
      4,
    );
    expect(finalOf(stuck, 'alpha').responseShares.resist).toBeGreaterThan(0.9);
    expect(finalOf(free, 'alpha').responseShares.switch).toBeGreaterThan(0.9);
    const clamped = simulate(
      spec(costly, {
        rounds: 12,
        variant: { traitEdits: [{ actorId: 'alpha', trait: 'switchingCost', value: -0.7 }] },
      }),
      4,
    );
    expect(finalOf(clamped, 'alpha')).toEqual(
      finalOf(
        simulate(
          spec(costly, {
            rounds: 12,
            variant: { traitEdits: [{ actorId: 'alpha', trait: 'switchingCost', value: 0 }] },
          }),
          4,
        ),
        'alpha',
      ),
    );
  });

  it('is shaped by trust and by readiness to take something new, which soften a harm', () => {
    const final = (trust: number, adoptionTendency: number) =>
      finalOf(
        simulate(
          spec(
            [actor('alpha', 'cost-bearer', { traits: { impact: -0.5, trust, adoptionTendency } })],
            {
              rounds: 8,
            },
          ),
          6,
        ),
        'alpha',
      ).stanceMean;
    expect(final(0.9, 0.5)).toBeGreaterThan(final(0.1, 0.5));
    expect(final(0.5, 0.9)).toBeGreaterThan(final(0.5, 0.1));
  });
});

describe('who listens to whom', () => {
  const pair = (type: SimulationSpec['relations'][number]['type'] | null) =>
    spec(
      [
        actor('a', 'influencer', { traits: { priorStance: 0.8, impact: 0 } }),
        actor('b', 'end-user', { traits: { priorStance: -0.5, impact: 0, openness: 0.9 } }),
      ],
      {
        rounds: 20,
        relations: type ? [{ from: 'a', to: 'b', type, strength: 1 }] : [],
        variant: { intensity: 0 },
      },
    );

  it('pulls an actor toward those who influence it, and only the one it listens to', () => {
    const alone = simulate(pair(null), 2);
    const linked = simulate(pair('influences'), 2);
    expect(finalOf(linked, 'b').stanceMean).toBeGreaterThan(finalOf(alone, 'b').stanceMean + 0.1);
    expect(finalOf(linked, 'b').stanceMean).toBeLessThan(finalOf(linked, 'a').stanceMean);
    expect(finalOf(linked, 'a')).toEqual(finalOf(alone, 'a'));
    const mutual = simulate(pair('partners-with'), 2);
    expect(finalOf(mutual, 'a').stanceMean).toBeLessThan(finalOf(alone, 'a').stanceMean);
  });

  it('does not treat rivalry as a channel of influence, or listen to an actor that is not there', () => {
    const alone = JSON.stringify(simulate(pair(null), 2));
    expect(JSON.stringify(simulate(pair('competes-with'), 2))).toBe(alone);
    expect(JSON.stringify(simulate(pair('substitutes-for'), 2))).toBe(alone);
    const dangling = spec(pair(null).actors, {
      rounds: 20,
      relations: [
        { from: 'a', to: 'ghost', type: 'influences', strength: 1 },
        { from: 'a', to: 'a', type: 'influences', strength: 1 },
      ],
      variant: { intensity: 0 },
    });
    expect(JSON.stringify(simulate(dangling, 2))).toBe(alone);
  });

  it('listens more to a larger population and never reports it', () => {
    const cast = (size: number) =>
      spec(
        [
          actor('a', 'influencer', { size, traits: { priorStance: 0.8, impact: 0 } }),
          actor('b', 'end-user', {
            size: 10,
            traits: { priorStance: -0.5, impact: 0, openness: 0.9 },
          }),
        ],
        {
          rounds: 20,
          relations: [{ from: 'a', to: 'b', type: 'influences', strength: 1 }],
          variant: { intensity: 0 },
        },
      );
    const small = simulate(cast(1), 2);
    const large = simulate(cast(1_000_000), 2);
    expect(finalOf(large, 'b').stanceMean).toBeGreaterThan(finalOf(small, 'b').stanceMean);
    expect(JSON.stringify(large)).not.toMatch(/1000000|"size"/u);
    // Without relations the population is not used at all.
    const lone = (size: number) =>
      JSON.stringify(simulate(spec([actor('a', 'other', { size })], { rounds: 6 }), 2));
    expect(lone(1)).toBe(lone(900_000));
  });
});

describe('what is reported', () => {
  it('gives each actor the same weight, whatever its population or its number of members', () => {
    const input = spec(
      [
        actor('crowd', 'end-user', {
          size: 1_000_000,
          sampleSize: 50,
          traits: { priorStance: 0.6, impact: 0 },
        }),
        key('single', 'decision-maker', { priorStance: -0.6, impact: 0 }),
      ],
      { rounds: 8, variant: { intensity: 0 } },
    );
    const outcome = simulate(input, 11);
    for (const round of outcome.rounds) {
      expect(round.stanceMean).toBeCloseTo(
        mean(round.byActor.map((entry) => entry.stanceMean)),
        12,
      );
    }
    expect(outcome.final.stanceMean).toBeCloseTo(
      (finalOf(outcome, 'crowd').stanceMean + finalOf(outcome, 'single').stanceMean) / 2,
      12,
    );
    for (const category of RESPONSE_CATEGORIES) {
      expect(outcome.final.responseShares[category]).toBeCloseTo(
        (finalOf(outcome, 'crowd').responseShares[category] +
          finalOf(outcome, 'single').responseShares[category]) /
          2,
        12,
      );
    }
  });

  it('counts the members it simulated, scaled by the cohort and held back by the cap', () => {
    const input = spec(
      [
        actor('big', 'other', { sampleSize: 40 }),
        actor('small', 'other', { sampleSize: 10 }),
        key('one', 'other'),
        actor('also-one', 'other', { kind: 'key', sampleSize: 30 }),
      ],
      { rounds: 6 },
    );
    const full = simulate(input, 1);
    expect(full.work).toEqual({ members: 40 + 10 + 1 + 1, updates: 52 * 6 });
    expect(full.final.byActor.map((entry) => entry.members)).toEqual([40, 10, 1, 1]);
    const capped = simulate(input, 1, { sampleSizeCap: 15 });
    expect(capped.work).toEqual({ members: 15 + 10 + 1 + 1, updates: 27 * 6 });
    expect(capped.final.byActor.map((entry) => entry.members)).toEqual([15, 10, 1, 1]);
    const tiny = simulate(input, 1, { sampleSizeCap: 1 });
    expect(tiny.work.members).toBe(4);
    expect(simulate(input, 1, { sampleSizeCap: 500 }).work).toEqual(full.work);
    const long = simulate(spec(input.actors, { rounds: 20 }), 1);
    expect(long.work).toEqual({ members: 52, updates: 52 * 20 });
  });

  it('derives its signals from the members: each is about the actors the change harms or benefits', () => {
    const input = spec(
      [...harmedAndBenefited(), key('omega', 'other', { impact: 0, priorStance: -0.9 })],
      { rounds: 12 },
    );
    const outcome = simulate(input, 8);
    const last = outcome.rounds[11]!.signals;
    expect(Object.keys(last).sort()).toEqual(
      ['adoption', 'adverse-share', 'risk-concern', 'switching-pressure'].sort(),
    );
    for (const value of Object.values(last)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    // Omega is against the change but not harmed by it, so it is not part of what is measured.
    expect(last['adverse-share']).toBeCloseTo(adverseShare(outcome, 'alpha'), 12);
    expect(last['switching-pressure']).toBeCloseTo(
      finalOf(outcome, 'alpha').responseShares.switch,
      12,
    );
    expect(last.adoption).toBeCloseTo(finalOf(outcome, 'delta').responseShares.adopt, 12);
    expect(outcome.rounds[0]!.signals['adverse-share']).toBeLessThan(0.5);
    const unaffected = simulate(spec([key('omega', 'other', { impact: 0 })], { rounds: 4 }), 8);
    expect(unaffected.rounds[3]!.signals).toEqual({
      'adverse-share': 0,
      'switching-pressure': 0,
      adoption: 0,
      'risk-concern': 0,
    });
  });

  it('leaves signals and events out when asked, and nothing else changes without responders', () => {
    const input = spec(harmedAndBenefited(), { rounds: 8 });
    const without = simulate(input, 5, { signals: false });
    expect(without.events).toEqual([]);
    expect(without.rounds.every((round) => Object.keys(round.signals).length === 0)).toBe(true);
    const withSignals = simulate(input, 5);
    expect(withSignals.rounds.map((round) => ({ ...round, signals: {} }))).toEqual(without.rounds);
    expect(withSignals.final).toEqual(without.final);
  });

  it('is built from a variant that names itself', () => {
    const outcome = simulate(spec(harmedAndBenefited(), { variant: { id: 'smaller-rise' } }), 3);
    expect(outcome.variantId).toBe('smaller-rise');
    expect(variant().id).toBe('change');
    expect(simulationSpecSchema.parse(spec(harmedAndBenefited()))).toBeTruthy();
  });
});
