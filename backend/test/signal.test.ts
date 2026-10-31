import { describe, expect, it } from 'vitest';
import type { SimulationSpec, Variant } from '../../shared/analysis.js';
import { actorSetFixture, FIXTURE_VARIANTS } from '../../shared/lab-fixtures.js';
import {
  actorsWithDirection,
  changeCanMoveAnyone,
  directionNotice,
  effectiveTrait,
  NO_DIRECTION_NOTICE,
  UNDIRECTED_NOTICE,
} from '../../shared/signal.js';
import { TRAIT_KEYS, type Actor } from '../../shared/stakeholders.js';
import { indexEdits, resolveActor } from '../src/simulation/population.js';
import { simulate } from '../src/simulation/simulate.js';

const cast = actorSetFixture().actors;
const variants = FIXTURE_VARIANTS;
const [baseline, proposed] = variants as [Variant, Variant];

/** Nobody is helped or harmed, and no member of any group differs in it: the change has nothing to land on. */
const neutral = cast.map((actor): Actor => ({
  ...actor,
  traits: { ...actor.traits, impact: { ...actor.traits.impact, value: 0, spread: 0 } },
}));

const withSpread = (id: string, spread: number): Actor[] =>
  neutral.map((actor) =>
    actor.id === id
      ? { ...actor, traits: { ...actor.traits, impact: { ...actor.traits.impact, spread } } }
      : actor,
  );

const change = (edits: Partial<Variant>): Variant[] => [baseline, { ...proposed, ...edits }];
const cohort = cast.find((actor) => actor.kind === 'cohort')!;
const single = cast.find((actor) => actor.kind === 'key')!;

describe('whether a change can move anyone', () => {
  it('can when some actor is affected by a scenario that has an intensity', () => {
    expect(changeCanMoveAnyone(cast, variants)).toBe(true);
  });

  it('cannot when no actor is helped or harmed and no member differs in it, however strong the scenario', () => {
    expect(changeCanMoveAnyone(neutral, variants)).toBe(false);
    expect(changeCanMoveAnyone(neutral, change({ intensity: 1 }))).toBe(false);
  });

  it('can again when the scenario itself sets an impact on an actor', () => {
    const first = neutral[0]!.id;
    expect(changeCanMoveAnyone(neutral, change({ impactOverrides: { [first]: -0.4 } }))).toBe(true);
  });

  it('cannot when the only scenario with an effect has no intensity, or is the baseline', () => {
    const quiet = variants.map((variant) => ({ ...variant, intensity: 0 }));
    expect(changeCanMoveAnyone(cast, quiet)).toBe(false);
    const baselineOnly = variants.filter((variant) => variant.kind === 'baseline');
    expect(changeCanMoveAnyone(cast, baselineOnly)).toBe(false);
  });

  it('can when nobody has a direction but the members of a cohort differ in how the change lands on them', () => {
    expect(changeCanMoveAnyone(withSpread(cohort.id, 0.5), variants)).toBe(true);
    // The same spread on a key actor, which is one member at its value, moves no one.
    expect(changeCanMoveAnyone(withSpread(single.id, 0.5), variants)).toBe(false);
    // And nothing lands when the change has no strength.
    expect(changeCanMoveAnyone(withSpread(cohort.id, 0.5), change({ intensity: 0 }))).toBe(false);
  });

  it('can when the scenario edits the impact of an actor, whatever the cast says', () => {
    const edits = [{ actorId: neutral[0]!.id, trait: 'impact', value: -1 }];
    expect(changeCanMoveAnyone(neutral, change({ traitEdits: edits }))).toBe(true);
    // An actor that the scenario names with an impact of 0 is not moved by it.
    expect(changeCanMoveAnyone(neutral, change({ traitEdits: [{ ...edits[0]!, value: 0 }] }))).toBe(
      false,
    );
  });

  it('can when an edit sets any trait differently from no change, and cannot when it sets nothing different', () => {
    const [target] = neutral;
    const own = target!.traits.switchingCost.value;
    for (const trait of ['switchingCost', 'priorStance', 'sensitivity', 'authority']) {
      const edits = [{ actorId: target!.id, trait, value: 0.9 }];
      expect(changeCanMoveAnyone(neutral, change({ traitEdits: edits })), trait).toBe(true);
    }
    const same = [{ actorId: target!.id, trait: 'switchingCost', value: own }];
    expect(changeCanMoveAnyone(neutral, change({ traitEdits: same }))).toBe(false);
    // Edits that the no-change scenario carries too are not something the change does.
    const both = [baseline, proposed].map((variant) => ({
      ...variant,
      traitEdits: [{ actorId: target!.id, trait: 'switchingCost', value: 0.9 }],
    }));
    expect(changeCanMoveAnyone(neutral, both)).toBe(false);
  });

  it('reads an actor whose kind it is not told as a cohort, so that it only says it cannot when it is sure', () => {
    const bare = withSpread(cohort.id, 0.5).map(({ id, traits }) => ({ id, traits }));
    expect(changeCanMoveAnyone(bare, variants)).toBe(true);
  });
});

describe('the value that governs a run', () => {
  const actor = cast[0]!;
  const id = actor.id;

  it('is the last edit of a trait, else the actor’s own, kept to the scale of the trait', () => {
    expect(effectiveTrait(actor, proposed, 'trust')).toBe(actor.traits.trust.value);
    const edits = [
      { actorId: id, trait: 'trust', value: 0.2 },
      { actorId: 'someone-else', trait: 'trust', value: 0.9 },
      { actorId: id, trait: 'trust', value: 0.8 },
    ];
    expect(effectiveTrait(actor, { ...proposed, traitEdits: edits }, 'trust')).toBe(0.8);
    const below = [{ actorId: id, trait: 'trust', value: -0.5 }];
    expect(effectiveTrait(actor, { ...proposed, traitEdits: below }, 'trust')).toBe(0);
    const impact = [{ actorId: id, trait: 'impact', value: -0.5 }];
    expect(effectiveTrait(actor, { ...proposed, traitEdits: impact }, 'impact')).toBe(-0.5);
  });

  it('is the scenario’s override for an impact, which wins over an edit', () => {
    const scenario = {
      ...proposed,
      impactOverrides: { [id]: 0.3 },
      traitEdits: [{ actorId: id, trait: 'impact', value: -1 }],
    };
    expect(effectiveTrait(actor, scenario, 'impact')).toBe(0.3);
  });

  it('is what the simulator resolves, for every trait and every kind of setting', () => {
    const scenarios: Variant[] = [
      proposed,
      { ...proposed, impactOverrides: { [id]: -0.7 } },
      { ...proposed, traitEdits: [{ actorId: id, trait: 'impact', value: 0.4 }] },
      {
        ...proposed,
        impactOverrides: { [id]: 0.1 },
        traitEdits: [
          { actorId: id, trait: 'impact', value: -1 },
          { actorId: id, trait: 'priorStance', value: -0.6 },
          { actorId: id, trait: 'switchingCost', value: 0.2 },
          { actorId: id, trait: 'switchingCost', value: 1 },
          { actorId: id, trait: 'trust', value: -0.4 },
          { actorId: id, trait: 'authority', value: 0.55 },
        ],
      },
    ];
    for (const scenario of scenarios) {
      const resolved = resolveActor(actor, scenario, indexEdits(cast, scenario));
      for (const trait of TRAIT_KEYS) {
        expect(
          effectiveTrait(actor, scenario, trait),
          `${trait} under ${JSON.stringify(scenario)}`,
        ).toBe(resolved.value[trait]);
      }
    }
  });
});

describe('who has an expected direction of impact', () => {
  it('is whoever some scenario other than the baseline sets an impact that is not 0 for', () => {
    expect(actorsWithDirection(neutral, variants)).toEqual([]);
    const first = neutral[0]!.id;
    expect(
      actorsWithDirection(neutral, change({ impactOverrides: { [first]: -0.4 } })).map(
        (actor) => actor.id,
      ),
    ).toEqual([first]);
    const edited = change({ traitEdits: [{ actorId: first, trait: 'impact', value: 0.5 }] });
    expect(actorsWithDirection(neutral, edited).map((actor) => actor.id)).toEqual([first]);
    // An actor with an impact of its own that every scenario overrides to nothing has none.
    const quiet = change({ impactOverrides: Object.fromEntries(cast.map((a) => [a.id, 0])) });
    expect(actorsWithDirection(cast, quiet)).toEqual([]);
    // The baseline is the reference, and sets no one's direction.
    expect(
      actorsWithDirection(neutral, [{ ...baseline, impactOverrides: { [first]: 1 } }]),
    ).toEqual([]);
  });
});

describe('what a person is told before anything is read into a comparison', () => {
  it('is the notice that the change cannot move anyone only where it provably cannot', () => {
    expect(directionNotice(neutral, variants)).toBe(NO_DIRECTION_NOTICE);
    expect(NO_DIRECTION_NOTICE).toContain('cannot move anyone');
  });

  it('says only that nobody has a direction where members can still move, and never calls it noise', () => {
    expect(directionNotice(withSpread(cohort.id, 0.5), variants)).toBe(UNDIRECTED_NOTICE);
    expect(UNDIRECTED_NOTICE).toContain('No stakeholder has an expected direction of impact');
    expect(UNDIRECTED_NOTICE).not.toMatch(/cannot move anyone|\bnoise\b/u);
    expect(UNDIRECTED_NOTICE).toContain('Say who is helped or harmed in the stakeholder review');
  });

  it('is nothing when someone has a direction', () => {
    expect(directionNotice(cast, variants)).toBeNull();
    const first = neutral[0]!.id;
    expect(directionNotice(neutral, change({ impactOverrides: { [first]: -0.4 } }))).toBeNull();
    // A change with no strength is not a missing direction.
    expect(directionNotice(cast, change({ intensity: 0 }))).toBeNull();
  });
});

describe('what the guard claims, against what the simulator does', () => {
  const seeds = [7, 8, 9, 10, 11];
  const spec = (actors: Actor[], variant: Variant): SimulationSpec => ({
    actors,
    relations: [],
    rounds: 8,
    variant,
  });
  const outcomes = (actors: Actor[], variant: Variant) =>
    seeds.map((seed) => {
      const { final, rounds, events } = simulate(spec(actors, variant), seed);
      return JSON.stringify({ final, rounds, events });
    });
  const same = (actors: Actor[], scenarios: Variant[]): boolean => {
    const [reference, ...changes] = scenarios as [Variant, ...Variant[]];
    const base = outcomes(actors, reference);
    return changes.every((variant) => outcomes(actors, variant).join() === base.join());
  };

  it('gives the very same outcome with the change as without it, on every seed, wherever it says it cannot move anyone', () => {
    expect(changeCanMoveAnyone(neutral, variants)).toBe(false);
    expect(same(neutral, variants)).toBe(true);
    expect(same(neutral, change({ intensity: 1 }))).toBe(true);
    const quiet = variants.map((variant) => ({ ...variant, intensity: 0 }));
    expect(changeCanMoveAnyone(cast, quiet)).toBe(false);
    expect(same(cast, quiet)).toBe(true);
  });

  it('leaves alone a benefit that a scenario with no strength gives, and does not claim that a harm it gives moves no one', () => {
    // Members who start against the change, so that someone who is harmed has something others react to.
    const against = neutral.map((actor): Actor => ({
      ...actor,
      traits: { ...actor.traits, priorStance: { ...actor.traits.priorStance, value: -0.5 } },
    }));
    const subscribers = cohort.id;
    const benefit = change({ intensity: 0, impactOverrides: { [subscribers]: 0.9 } });
    expect(changeCanMoveAnyone(against, benefit)).toBe(false);
    expect(same(against, benefit)).toBe(true);
    const harm = change({ intensity: 0, impactOverrides: { [subscribers]: -0.9 } });
    expect(changeCanMoveAnyone(against, harm)).toBe(true);
    expect(same(against, harm)).toBe(false);
  });

  it('gives a different outcome somewhere wherever it says the change can move someone but nobody has a direction', () => {
    const spread = withSpread(cohort.id, 0.5);
    expect(changeCanMoveAnyone(spread, variants)).toBe(true);
    expect(same(spread, variants)).toBe(false);

    const edited = change({
      traitEdits: [{ actorId: neutral[0]!.id, trait: 'impact', value: -1 }],
    });
    expect(changeCanMoveAnyone(neutral, edited)).toBe(true);
    expect(same(neutral, edited)).toBe(false);
  });
});
