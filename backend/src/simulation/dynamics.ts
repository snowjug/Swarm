/**
 * Stance dynamics. Each member of each actor holds a stance x in [-1, 1] (-1 against the change, 0
 * undecided, 1 in favour) and every round all members are updated at once from the state of the round
 * before. For a member i of actor A in round t:
 *
 *   x_i(t) = clamp( x_i(t-1) + social + change + events + noise )
 *
 *   social = SOCIAL_RATE * openness_i * (T_A - x_i)
 *            T_A is the influence-weighted stance of what A listens to: its own cohort (when it has more
 *            than one member) and the actors related to it, each weighted by relation strength,
 *            influence and (log-scaled) population. Rivalry (`competes-with`, `substitutes-for`) is not
 *            a channel of influence. This is the pull of the existing opinion-dynamics engine,
 *            openness * (peerMean - x), with the rate scaled down so that a cohort does not collapse
 *            to a single view within a run.
 *   change = intensity * PERSISTENCE^(t - r) * sensitivity_i * impact_i * trustAdoption_i,   for t >= r
 *            r is the round in which the variant's change lands. It is felt in full that round and the
 *            push fades by PERSISTENCE each round after; what it moved stays moved (no reversion).
 *            impact comes from the actor's trait unless the variant overrides it; trust and readiness to
 *            take something new scale a harm down (or a benefit up) when high:
 *            trustAdoption = 1 + sign(impact) * (0.8 * (trust - 0.5) + 0.4 * (adoptionTendency - 0.5)).
 *   events = (ENABLE_LIFT * lift_A - SWITCH_PULL * pullSwitch_A) * max(0, -x_i)
 *            - SCRUTINY_PULL * scrutiny_A * (1 - riskTolerance_i)
 *            The pressures are what external responders' events have added to A; they fade by
 *            PERSISTENCE each round (see responders.ts). Discontented members are drawn toward leaving by
 *            an alternative that has appeared, or lifted back toward neutral by help; scrutiny weighs
 *            on members in proportion to how little risk they will accept.
 *   noise  = NOISE * (0.5 + reactivity_i) * (2u - 1),   u a seeded uniform draw for (actor, member, round)
 *
 * All coefficients are in parameters.ts. Every term is bounded and every division is guarded, so a
 * stance can neither leave [-1, 1] nor become NaN. Without events the update is monotone: raising any
 * stance never lowers a stance in the next round, because the coefficient on every stance is
 * non-negative. So when the change harms every member it touches, or leaves them alone, a stronger
 * change never leaves anyone more favourable on the same seed. Responders act on thresholds, so with
 * them present that holds for the average over seeds and not for each seed.
 *
 * The response of a member in each round is read from its stance by `classifyIndex`; its switching
 * cost is its own cost less the relief that alternatives have brought to its actor.
 */
import type { Actor, ActorRelation } from '../../../shared/stakeholders.js';
import {
  ADVERSE_AT,
  COHORT_TIE,
  ENABLE_LIFT,
  PERSISTENCE,
  RISK_AVERSE_BELOW,
  SCRUTINY_PULL,
  SOCIAL_RATE,
  SWITCH_PULL,
  sizeWeight,
} from './parameters.js';
import type { Population } from './population.js';
import { CATEGORY_COUNT, classifyIndex } from './response.js';
import { uniformAt } from './random.js';

/** Counters and means of one round, per actor. Reused from round to round. */
export interface RoundStats {
  /** `counts[actor * CATEGORY_COUNT + category]` members whose response is that category. */
  counts: Int32Array;
  /** Members at a stance of -0.1 or lower. */
  adverse: Int32Array;
  /** Adverse members who tolerate little risk. */
  worried: Int32Array;
  /** Plain mean stance of the actor's members: what is reported. */
  mean: Float64Array;
  /** Influence-weighted mean stance: what others listen to. */
  heard: Float64Array;
}

export function createStats(actorCount: number): RoundStats {
  return {
    counts: new Int32Array(actorCount * CATEGORY_COUNT),
    adverse: new Int32Array(actorCount),
    worried: new Int32Array(actorCount),
    mean: new Float64Array(actorCount),
    heard: new Float64Array(actorCount),
  };
}

/** The means before the first round, from the members' prior stances. */
export function initialiseHeard(population: Population, stats: RoundStats): void {
  const { start, stance, influence } = population;
  for (let actor = 0; actor < population.actorCount; actor += 1) {
    const first = start[actor] ?? 0;
    const end = start[actor + 1] ?? first;
    let sum = 0;
    let weighted = 0;
    let weight = 0;
    for (let at = first; at < end; at += 1) {
      const x = stance[at] ?? 0;
      sum += x;
      weighted += (influence[at] ?? 0) * x;
      weight += influence[at] ?? 0;
    }
    stats.mean[actor] = sum / (end - first);
    stats.heard[actor] = weight > 0 ? weighted / weight : (stats.mean[actor] ?? 0);
  }
}

/** What each actor listens to, as a compressed list per actor. */
export interface Ties {
  /** `from[a]` to `from[a + 1]` index `source` and `weight` for actor a. */
  from: Int32Array;
  source: Int32Array;
  weight: Float64Array;
  /** The weight of an actor's own cohort in what it listens to; 0 for a single member. */
  own: Float64Array;
}

const NOT_A_CHANNEL: ReadonlySet<string> = new Set(['competes-with', 'substitutes-for']);
const ONE_WAY: ReadonlySet<string> = new Set(['influences', 'regulates']);

/**
 * Who listens to whom. A relation is a channel in both directions, except `influences` and
 * `regulates`, which carry one way (from the first actor to the second), and rivalry, which carries
 * none. An actor's voice is its influence times its population weight.
 */
export function buildTies(
  actors: readonly Actor[],
  population: Population,
  relations: readonly ActorRelation[],
  index: ReadonlyMap<string, number>,
): Ties {
  const voice = actors.map(
    (actor, at) => (population.resolved[at]?.value.influence ?? 0) * sizeWeight(actor.size),
  );
  const listens = actors.map(() => new Map<number, number>());
  const add = (listener: number, source: number, weight: number): void => {
    const heard = listens[listener];
    if (heard) heard.set(source, (heard.get(source) ?? 0) + weight);
  };
  for (const relation of relations) {
    if (NOT_A_CHANNEL.has(relation.type) || !(relation.strength > 0)) continue;
    const from = index.get(relation.from);
    const to = index.get(relation.to);
    if (from === undefined || to === undefined || from === to) continue;
    add(to, from, relation.strength * (voice[from] ?? 0));
    if (!ONE_WAY.has(relation.type)) add(from, to, relation.strength * (voice[to] ?? 0));
  }
  const total = listens.reduce((sum, heard) => sum + heard.size, 0);
  const ties: Ties = {
    from: new Int32Array(actors.length + 1),
    source: new Int32Array(total),
    weight: new Float64Array(total),
    own: new Float64Array(actors.length),
  };
  let next = 0;
  listens.forEach((heard, actor) => {
    ties.from[actor] = next;
    for (const [source, weight] of heard) {
      ties.source[next] = source;
      ties.weight[next] = weight;
      next += 1;
    }
    const members = (population.start[actor + 1] ?? 0) - (population.start[actor] ?? 0);
    ties.own[actor] = members > 1 ? COHORT_TIE * (voice[actor] ?? 0) : 0;
  });
  ties.from[actors.length] = next;
  return ties;
}

/** The stance each actor is pulled toward this round, from what was heard at the end of the last. */
export function listenTargets(ties: Ties, stats: RoundStats, targets: Float64Array): void {
  for (let actor = 0; actor < targets.length; actor += 1) {
    const own = stats.heard[actor] ?? 0;
    const weightOwn = ties.own[actor] ?? 0;
    let total = weightOwn * own;
    let weight = weightOwn;
    const end = ties.from[actor + 1] ?? 0;
    for (let at = ties.from[actor] ?? 0; at < end; at += 1) {
      const w = ties.weight[at] ?? 0;
      total += w * (stats.heard[ties.source[at] ?? 0] ?? 0);
      weight += w;
    }
    targets[actor] = weight > 0 ? total / weight : own;
  }
}

/** What external responders' events have added to each actor so far. */
export interface Effects {
  /** How far alternatives have lowered the cost of switching. Does not fade. */
  relief: Float64Array;
  /** Pressures that fade by PERSISTENCE each round. */
  pullSwitch: Float64Array;
  lift: Float64Array;
  scrutiny: Float64Array;
}

export function createEffects(actorCount: number): Effects {
  return {
    relief: new Float64Array(actorCount),
    pullSwitch: new Float64Array(actorCount),
    lift: new Float64Array(actorCount),
    scrutiny: new Float64Array(actorCount),
  };
}

export function fadeEffects(effects: Effects): void {
  for (const pressure of [effects.pullSwitch, effects.lift, effects.scrutiny]) {
    for (let actor = 0; actor < pressure.length; actor += 1) {
      pressure[actor] = (pressure[actor] ?? 0) * PERSISTENCE;
    }
  }
}

/**
 * One round for every member of every actor. `push` is the change's strength this round,
 * `intensity * PERSISTENCE^(t - r)`, or 0 before it lands.
 */
export function stepRound(
  population: Population,
  effects: Effects,
  stats: RoundStats,
  targets: Float64Array,
  round: number,
  push: number,
): void {
  const { start, stance, influence, openness, landing, noiseAmp, riskTolerance, switchingCost } =
    population;
  stats.counts.fill(0);
  for (let actor = 0; actor < population.actorCount; actor += 1) {
    const first = start[actor] ?? 0;
    const end = start[actor + 1] ?? first;
    const target = targets[actor] ?? 0;
    const relief = effects.relief[actor] ?? 0;
    const discontent =
      ENABLE_LIFT * (effects.lift[actor] ?? 0) - SWITCH_PULL * (effects.pullSwitch[actor] ?? 0);
    const scrutiny = SCRUTINY_PULL * (effects.scrutiny[actor] ?? 0);
    const noise = population.noiseStream[actor] ?? 0;
    const base = actor * CATEGORY_COUNT;
    let sum = 0;
    let weighted = 0;
    let weight = 0;
    let adverse = 0;
    let worried = 0;
    for (let at = first; at < end; at += 1) {
      const x = stance[at] ?? 0;
      const tolerance = riskTolerance[at] ?? 0;
      const draw = uniformAt(noise, (at - first) * 64 + round);
      const moved =
        x +
        SOCIAL_RATE * (openness[at] ?? 0) * (target - x) +
        push * (landing[at] ?? 0) +
        (x < 0 ? -x * discontent : 0) -
        scrutiny * (1 - tolerance) +
        (noiseAmp[at] ?? 0) * (2 * draw - 1);
      const next = moved > 1 ? 1 : moved < -1 ? -1 : moved;
      stance[at] = next;
      const category = base + classifyIndex(next, (switchingCost[at] ?? 0) - relief);
      stats.counts[category] = (stats.counts[category] ?? 0) + 1;
      const influenceHere = influence[at] ?? 0;
      sum += next;
      weighted += influenceHere * next;
      weight += influenceHere;
      if (next <= ADVERSE_AT) {
        adverse += 1;
        if (tolerance < RISK_AVERSE_BELOW) worried += 1;
      }
    }
    const members = end - first;
    const mean = sum / members;
    stats.mean[actor] = mean;
    stats.heard[actor] = weight > 0 ? weighted / weight : mean;
    stats.adverse[actor] = adverse;
    stats.worried[actor] = worried;
  }
}
