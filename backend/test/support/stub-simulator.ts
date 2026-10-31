import {
  emptyResponseShares,
  type ResponseCategory,
  type ResponseShares,
  type RunOutcome,
  type SimEvent,
  type SimulationSpec,
  type Simulator,
} from '../../../shared/analysis.js';
import type { Actor } from '../../../shared/stakeholders.js';

/**
 * A deterministic stand-in for the simulation engine, for tests of everything built on the
 * `Simulator` type. It is not a model of anything: it has the properties the analysis relies on and
 * nothing else.
 *
 * - The same spec and seed give the same outcome.
 * - Each actor's random draw depends on the seed and the actor only, so two variants run on one seed
 *   share their noise (paired runs), and changing one actor's trait leaves every other actor's draw alone.
 * - The final stance falls as intensity, sensitivity and the harm of the impact rise, and rises with trust.
 * - A competitor and a regulator react to an adverse mood, and a harmed group follows the competitor.
 */

const NOISE = 0.1;
const GAIN = 2;

const clamp = (value: number, low = -1, high = 1): number => Math.min(high, Math.max(low, value));

/** A repeatable number in [0, 1) for a seed and a label. */
function unit(seed: number, label: string): number {
  let hash = (seed ^ 0x9e3779b9) >>> 0;
  for (let index = 0; index < label.length; index += 1) {
    hash = Math.imul(hash ^ label.charCodeAt(index), 0x45d9f3b) >>> 0;
    hash ^= hash >>> 15;
  }
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35) >>> 0;
  return ((hash ^ (hash >>> 16)) >>> 0) / 2 ** 32;
}

export function stubResponse(stance: number, switchingCost: number): ResponseCategory {
  if (stance >= 0.35) return 'adopt';
  if (stance >= 0.1) return 'accept-with-conditions';
  if (stance > -0.1) return 'wait';
  if (stance > -0.35) return 'adapt-defensively';
  return switchingCost < 0.5 ? 'switch' : 'resist';
}

interface ActorState {
  actor: Actor;
  members: number;
  /** The stance the actor's members centre on at the end of the run. */
  end: number;
}

function endStance(actor: Actor, spec: SimulationSpec, seed: number): number {
  const impact = spec.variant.impactOverrides[actor.id] ?? actor.traits.impact.value;
  const push =
    GAIN *
    spec.variant.intensity *
    actor.traits.sensitivity.value *
    impact *
    (1 - 0.5 * actor.traits.trust.value);
  const noise = (unit(seed, actor.id) - 0.5) * 2 * NOISE;
  return clamp(actor.traits.priorStance.value + push + noise);
}

function sharesAt(state: ActorState, stance: number): ResponseShares {
  const shares = emptyResponseShares();
  const members = state.members;
  const reach = 4 * state.actor.traits.impact.spread;
  for (let member = 0; member < members; member += 1) {
    const offset = members === 1 ? 0 : ((member + 0.5) / members - 0.5) * reach;
    shares[stubResponse(clamp(stance + offset), state.actor.traits.switchingCost.value)] +=
      1 / members;
  }
  return shares;
}

const average = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

function meanShares(all: readonly ResponseShares[]): ResponseShares {
  const result = emptyResponseShares();
  for (const key of Object.keys(result) as ResponseCategory[]) {
    result[key] = average(all.map((shares) => shares[key]));
  }
  return result;
}

export const stubSimulator: Simulator = (spec, seed) => {
  const states: ActorState[] = spec.actors.map((actor) => ({
    actor,
    members: actor.kind === 'key' ? 1 : actor.sampleSize,
    end: endStance(actor, spec, seed),
  }));
  const { variant } = spec;
  const progress = (round: number) =>
    round < variant.round ? 0 : Math.min(1, (round - variant.round + 1) / 3);
  const stanceAt = (state: ActorState, round: number) =>
    state.actor.traits.priorStance.value +
    (state.end - state.actor.traits.priorStance.value) * progress(round);

  const rounds = Array.from({ length: spec.rounds }, (_, index) => {
    const round = index + 1;
    const stances = states.map((state) => stanceAt(state, round));
    return {
      round,
      stanceMean: average(stances),
      responseShares: meanShares(states.map((state, at) => sharesAt(state, stances[at] ?? 0))),
      byActor: states.map((state, at) => ({
        actorId: state.actor.id,
        stanceMean: stances[at] ?? 0,
      })),
      signals: {},
    };
  });

  const byActor = states.map((state) => ({
    actorId: state.actor.id,
    members: state.members,
    stanceMean: state.end,
    responseShares: sharesAt(state, state.end),
  }));
  const final = {
    stanceMean: average(byActor.map((item) => item.stanceMean)),
    responseShares: meanShares(byActor.map((item) => item.responseShares)),
    byActor,
  };

  const adverse = final.responseShares.switch + final.responseShares.resist;
  const events: SimEvent[] = [];
  const competitor = spec.actors.find((actor) => actor.category === 'competitor');
  const regulator = spec.actors.find((actor) => actor.category === 'regulator');
  const harmed = spec.actors.find((actor) => actor.traits.impact.value < 0);
  if (competitor && adverse >= 0.12) {
    events.push({
      id: 'event-1',
      round: Math.min(spec.rounds, variant.round + 1 + (seed % 2)),
      kind: 'counter-move',
      actorId: competitor.id,
      description: 'A simulated counter-move followed the rise in adverse responses.',
      causedBy: ['adverse-share'],
    });
    if (harmed) {
      events.push({
        id: 'event-2',
        round: Math.min(spec.rounds, variant.round + 2 + (seed % 2)),
        kind: 'switching-pressure',
        actorId: harmed.id,
        description: 'Switching became cheaper for the simulated members who were harmed.',
        causedBy: ['event-1'],
      });
    }
  }
  if (regulator && adverse >= 0.18) {
    events.push({
      id: 'event-3',
      round: Math.min(spec.rounds, variant.round + 2),
      kind: 'scrutiny',
      actorId: regulator.id,
      description: 'A simulated review of the change began.',
      causedBy: ['adverse-share'],
    });
  }

  const members = states.reduce((sum, state) => sum + state.members, 0);
  const outcome: RunOutcome = {
    seed,
    variantId: variant.id,
    rounds,
    final,
    events,
    work: { members, updates: members * spec.rounds },
  };
  return outcome;
};

/** Wraps a simulator and counts its calls, with the seeds it was given for each variant. */
export function countingSimulator(inner: Simulator = stubSimulator) {
  const calls: { seed: number; variantId: string }[] = [];
  const simulator: Simulator = (spec, seed, options) => {
    calls.push({ seed, variantId: spec.variant.id });
    return inner(spec, seed, options);
  };
  return { simulator, calls };
}
