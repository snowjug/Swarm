/**
 * The population simulator: one scenario variant, one seed, in, an aggregate-only outcome out.
 *
 * A run is pure and deterministic. The cast's members are drawn from the actors' trait distributions
 * (population.ts), then for every round the stances are updated (dynamics.ts), the round is summed up,
 * and external responders see what happened some rounds ago and may act (responders.ts). Anything that
 * makes two runs differ comes from the seed, through addressed draws (random.ts), so runs on the same
 * seed with one assumption changed share every draw that the assumption does not touch.
 *
 * What is reported, and how it is weighted:
 *  - Individual members are never kept; only what they add up to.
 *  - Every overall figure gives each ACTOR the same weight, whatever its population (`size`) or how many
 *    members it simulated. `size` is a modelling assumption: it only sets how much an actor's stance
 *    counts in what other actors listen to and what responders watch (see parameters.ts), and it is
 *    never reported. Nothing in an outcome is a count of real people.
 *  - A response share is the share of an actor's simulated members in a category. The outcome is a
 *    mechanical consequence of the declared assumptions, not a forecast.
 */
import {
  emptyResponseShares,
  RESPONSE_CATEGORIES,
  simulationSpecSchema,
  type ActorOutcome,
  type ResponseShares,
  type RoundAggregate,
  type RunOutcome,
  type SimulateOptions,
  type SimulationSpec,
  type Simulator,
} from '../../../shared/analysis.js';
import {
  buildTies,
  createEffects,
  createStats,
  fadeEffects,
  initialiseHeard,
  listenTargets,
  stepRound,
  type RoundStats,
} from './dynamics.js';
import { DEFAULT_SAMPLE_CAP, PERSISTENCE } from './parameters.js';
import { buildPopulation, SimulationInputError } from './population.js';
import { CATEGORY_COUNT } from './response.js';
import { buildResponders, createResponders, runResponders } from './responders.js';
import { aggregateSignals, createHistory, recordSignals } from './signals.js';

export { SimulationInputError };

const MAX_SEED = 2_147_483_647;
const clampStance = (value: number): number => Math.min(1, Math.max(-1, value));

function sharesOf(counts: Int32Array, base: number, members: number): ResponseShares {
  const shares = emptyResponseShares();
  RESPONSE_CATEGORIES.forEach((category, at) => {
    shares[category] = Math.min(1, (counts[base + at] ?? 0) / members);
  });
  return shares;
}

/** One round's overall and per-actor figures, each actor counting once. */
function sumUp(
  round: number,
  ids: readonly string[],
  start: Int32Array,
  stats: RoundStats,
): RoundAggregate {
  const overall = new Float64Array(CATEGORY_COUNT);
  let stance = 0;
  const byActor = ids.map((actorId, actor) => {
    const members = (start[actor + 1] ?? 0) - (start[actor] ?? 0);
    const base = actor * CATEGORY_COUNT;
    for (let category = 0; category < CATEGORY_COUNT; category += 1) {
      overall[category] = (overall[category] ?? 0) + (stats.counts[base + category] ?? 0) / members;
    }
    stance += stats.mean[actor] ?? 0;
    return { actorId, stanceMean: clampStance(stats.mean[actor] ?? 0) };
  });
  const responseShares = emptyResponseShares();
  RESPONSE_CATEGORIES.forEach((category, at) => {
    responseShares[category] = Math.min(1, (overall[at] ?? 0) / ids.length);
  });
  return {
    round,
    stanceMean: clampStance(stance / ids.length),
    responseShares,
    byActor,
    signals: {},
  };
}

/**
 * The same as `simulate` for a spec that has already been through `simulationSpecSchema`. Validating a
 * large cast costs about as much as running it, so a caller that runs one spec on many seeds parses
 * once and calls this. It still checks the seed, the cap and that the cast and variant agree.
 */
export function simulateValidated(
  spec: SimulationSpec,
  seed: number,
  options: SimulateOptions = {},
): RunOutcome {
  if (!Number.isInteger(seed) || seed < 1 || seed > MAX_SEED) {
    throw new SimulationInputError(`The seed has to be a whole number from 1 to ${MAX_SEED}.`);
  }
  const cap = options.sampleSizeCap ?? DEFAULT_SAMPLE_CAP;
  if (!Number.isInteger(cap) || cap < 1) {
    throw new SimulationInputError('The sample size cap has to be a whole number of at least 1.');
  }
  const { actors, variant } = spec;
  const ids = actors.map((actor) => actor.id);
  const index = new Map(ids.map((id, at) => [id, at]));
  if (index.size !== ids.length) throw new SimulationInputError('Two actors share an id.');

  const population = buildPopulation(actors, variant, seed, cap);
  const ties = buildTies(actors, population, spec.relations, index);
  const stats = createStats(actors.length);
  initialiseHeard(population, stats);
  const effects = createEffects(actors.length);
  const targets = new Float64Array(actors.length);
  const withSignals = options.signals ?? true;
  const history = withSignals
    ? createHistory(
        spec.rounds,
        population.resolved.map((resolved) => resolved.value.impact),
      )
    : null;
  const responders = withSignals
    ? createResponders(buildResponders(actors, population, spec.relations, index))
    : null;

  const rounds: RoundAggregate[] = [];
  for (let round = 1; round <= spec.rounds; round += 1) {
    const push =
      round < variant.round ? 0 : variant.intensity * PERSISTENCE ** (round - variant.round);
    listenTargets(ties, stats, targets);
    stepRound(population, effects, stats, targets, round, push);
    const aggregate = sumUp(round, ids, population.start, stats);
    rounds.push(aggregate);
    if (history && responders) {
      recordSignals(history, round, stats, population.start);
      aggregate.signals = aggregateSignals(history, round);
      fadeEffects(effects);
      runResponders(responders, actors, history, effects, round);
    }
  }

  const last = rounds[rounds.length - 1] as RoundAggregate;
  const byActor: ActorOutcome[] = ids.map((actorId, actor) => {
    const members = (population.start[actor + 1] ?? 0) - (population.start[actor] ?? 0);
    return {
      actorId,
      members,
      stanceMean: clampStance(stats.mean[actor] ?? 0),
      responseShares: sharesOf(stats.counts, actor * CATEGORY_COUNT, members),
    };
  });
  const outcome: RunOutcome = {
    seed,
    variantId: variant.id,
    rounds,
    final: { stanceMean: last.stanceMean, responseShares: { ...last.responseShares }, byActor },
    events: responders ? responders.emitted.map((emitted) => emitted.event) : [],
    work: { members: population.memberCount, updates: population.memberCount * spec.rounds },
  };
  return outcome;
}

/** Validates the spec with the schema, then runs it. Pure: the same spec and seed give the same outcome. */
export const simulate: Simulator = (spec, seed, options) =>
  simulateValidated(simulationSpecSchema.parse(spec), seed, options);
