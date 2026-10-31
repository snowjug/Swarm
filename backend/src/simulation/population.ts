import type { Variant } from '../../../shared/analysis.js';
import type { Actor, TraitKey } from '../../../shared/stakeholders.js';
import {
  ADOPTION_WEIGHT,
  GROUP_SPREAD,
  NOISE,
  RATE_MIN,
  RATE_SPAN,
  TRUST_WEIGHT,
} from './parameters.js';
import { derive, normalQuantile, truncatedNormalSampler, uniformAt } from './random.js';

/** Raised when a spec is well formed but names things that are not in it, so no run can honour it. */
export class SimulationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SimulationInputError';
  }
}

/**
 * The traits drawn for each member, in the order of their slot in the member's stream of draws. The
 * slots are part of what makes a seed reproducible, so a trait keeps its slot if another is added
 * later (slot 10 is kept for `authority`, which only responders use, at the actor level).
 */
const SAMPLED = [
  'priorStance',
  'impact',
  'influence',
  'openness',
  'sensitivity',
  'riskTolerance',
  'switchingCost',
  'trust',
  'adoptionTendency',
  'reactivity',
] as const satisfies readonly TraitKey[];
const SLOTS_PER_MEMBER = 16;
const PRIOR = 0;
const IMPACT = 1;
const INFLUENCE = 2;
const OPENNESS = 3;
const SENSITIVITY = 4;
const RISK_TOLERANCE = 5;
const SWITCHING_COST = 6;
const TRUST = 7;
const ADOPTION = 8;
const REACTIVITY = 9;

const TRAIT_NAMES: ReadonlySet<string> = new Set<string>([...SAMPLED, 'authority']);
const isSigned = (trait: string): boolean => trait === 'priorStance' || trait === 'impact';
const clampTo = (value: number, trait: string): number =>
  Math.min(1, Math.max(isSigned(trait) ? -1 : 0, value));

/** An actor's traits once the variant's edits and impact override are applied. */
export interface ResolvedActor {
  value: Record<TraitKey, number>;
  spread: Record<TraitKey, number>;
}

export function resolveActor(
  actor: Actor,
  variant: Variant,
  edits: ReadonlyMap<string, ReadonlyMap<string, number>>,
): ResolvedActor {
  const value = {} as Record<TraitKey, number>;
  const spread = {} as Record<TraitKey, number>;
  const own = edits.get(actor.id);
  for (const key of Object.keys(actor.traits) as TraitKey[]) {
    const trait = actor.traits[key];
    value[key] = clampTo(own?.get(key) ?? trait.value, key);
    spread[key] = trait.spread;
  }
  const override = variant.impactOverrides[actor.id];
  if (override !== undefined) value.impact = clampTo(override, 'impact');
  return { value, spread };
}

/** Variant edits by actor and trait, checked against the cast. The last edit to a trait wins. */
export function indexEdits(
  actors: readonly Actor[],
  variant: Variant,
): Map<string, Map<string, number>> {
  const known = new Set(actors.map((actor) => actor.id));
  for (const id of Object.keys(variant.impactOverrides)) {
    if (!known.has(id)) {
      throw new SimulationInputError(
        `The variant sets an impact for "${id}", who is not in the cast.`,
      );
    }
  }
  const edits = new Map<string, Map<string, number>>();
  for (const edit of variant.traitEdits) {
    if (!known.has(edit.actorId)) {
      throw new SimulationInputError(
        `The variant edits a trait of "${edit.actorId}", who is not in the cast.`,
      );
    }
    if (!TRAIT_NAMES.has(edit.trait)) {
      throw new SimulationInputError(`The variant edits "${edit.trait}", which is not a trait.`);
    }
    const own = edits.get(edit.actorId) ?? new Map<string, number>();
    own.set(edit.trait, edit.value);
    edits.set(edit.actorId, own);
  }
  return edits;
}

/** The members of every actor, as flat arrays: the state a run keeps and updates. */
export interface Population {
  actorCount: number;
  memberCount: number;
  /** `start[a]` is the first member of actor a and `start[a + 1]` one past its last. */
  start: Int32Array;
  /** The stance of each member now. */
  stance: Float64Array;
  /** The stance each member starts at and is anchored to when nothing is pushing on it. */
  prior: Float64Array;
  influence: Float64Array;
  openness: Float64Array;
  /** `sensitivity x impact x` how trust and readiness to take something new scale it, per member. */
  landing: Float64Array;
  /** The share of the gap to its anchored stance that a member closes each round. */
  rate: Float64Array;
  /** Half-width of the member's seeded noise on a stance, per round. */
  noiseAmp: Float64Array;
  riskTolerance: Float64Array;
  switchingCost: Float64Array;
  /** The stream of noise draws of each actor. */
  noiseStream: Uint32Array;
  /** How strongly each actor, as a group, reacts to the change in this run (about 1). */
  group: Float64Array;
  resolved: ResolvedActor[];
}

/** How many members an actor simulates: one for a key actor, otherwise its sample size up to the cap. */
export function memberCountOf(actor: Actor, cap: number): number {
  return actor.kind === 'key' ? 1 : Math.min(actor.sampleSize, cap);
}

/**
 * How strongly an actor as a whole reacts to the change in this run: 1 plus a draw from a normal
 * distribution with the standard deviation `GROUP_SPREAD`, kept between 0.5 and 1.5. It depends only on
 * the seed and the actor's id, so it is the same in every variant run on the seed.
 */
export function groupFactor(seed: number, actorId: string): number {
  const draw = uniformAt(derive(seed, 'group', actorId), 0);
  return Math.min(1.5, Math.max(0.5, 1 + GROUP_SPREAD * normalQuantile(draw)));
}

/**
 * Draw the members. A cohort member's trait is a truncated normal around the actor's trait value with
 * the trait's spread, from the draw addressed by (seed, actor id, member, trait). A key actor is one
 * member at the trait values. Nothing here depends on any other actor, so changing one actor leaves
 * every other actor's members as they were.
 */
export function buildPopulation(
  actors: readonly Actor[],
  variant: Variant,
  seed: number,
  cap: number,
): Population {
  const edits = indexEdits(actors, variant);
  const counts = actors.map((actor) => memberCountOf(actor, cap));
  const memberCount = counts.reduce((sum, count) => sum + count, 0);
  const start = new Int32Array(actors.length + 1);
  const population: Population = {
    actorCount: actors.length,
    memberCount,
    start,
    stance: new Float64Array(memberCount),
    prior: new Float64Array(memberCount),
    influence: new Float64Array(memberCount),
    openness: new Float64Array(memberCount),
    landing: new Float64Array(memberCount),
    rate: new Float64Array(memberCount),
    noiseAmp: new Float64Array(memberCount),
    riskTolerance: new Float64Array(memberCount),
    switchingCost: new Float64Array(memberCount),
    noiseStream: new Uint32Array(actors.length),
    group: new Float64Array(actors.length),
    resolved: [],
  };
  const drawn = new Float64Array(SAMPLED.length);
  let next = 0;
  actors.forEach((actor, index) => {
    const resolved = resolveActor(actor, variant, edits);
    population.resolved.push(resolved);
    population.noiseStream[index] = derive(seed, 'noise', actor.id);
    population.group[index] = groupFactor(seed, actor.id);
    const count = counts[index] ?? 1;
    const first = next;
    start[index] = first;
    next += count;
    const traitStream = derive(seed, 'traits', actor.id);
    const samplers = SAMPLED.map((key) =>
      truncatedNormalSampler(
        resolved.value[key],
        actor.kind === 'key' ? 0 : resolved.spread[key],
        isSigned(key) ? -1 : 0,
        1,
      ),
    );
    for (let member = 0; member < count; member += 1) {
      const base = member * SLOTS_PER_MEMBER;
      for (let slot = 0; slot < SAMPLED.length; slot += 1) {
        drawn[slot] = samplers[slot]?.(uniformAt(traitStream, base + slot)) ?? 0;
      }
      const at = first + member;
      const impact = drawn[IMPACT] ?? 0;
      const trust = drawn[TRUST] ?? 0.5;
      const adoption = drawn[ADOPTION] ?? 0.5;
      const reactivity = drawn[REACTIVITY] ?? 0;
      population.stance[at] = drawn[PRIOR] ?? 0;
      population.prior[at] = drawn[PRIOR] ?? 0;
      population.influence[at] = drawn[INFLUENCE] ?? 0;
      population.openness[at] = drawn[OPENNESS] ?? 0;
      population.riskTolerance[at] = drawn[RISK_TOLERANCE] ?? 0;
      population.switchingCost[at] = drawn[SWITCHING_COST] ?? 0;
      population.rate[at] = RATE_MIN + RATE_SPAN * reactivity;
      population.noiseAmp[at] = NOISE * (0.5 + reactivity);
      population.landing[at] =
        (drawn[SENSITIVITY] ?? 0) *
        impact *
        (1 +
          Math.sign(impact) * (TRUST_WEIGHT * (trust - 0.5) + ADOPTION_WEIGHT * (adoption - 0.5)));
    }
  });
  start[actors.length] = next;
  return population;
}
