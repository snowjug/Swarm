/**
 * What constraints do to a run. A constraint is a limit the person has accepted, and the engine applies
 * it to the state it already has: a round in which the change reaches an actor, an actor's influence or
 * costs, the scrutiny an actor feels, how a final stance is read. Nothing here draws a number of its own,
 * so a run is as reproducible with constraints as without: the same spec and seed give the same outcome.
 *
 * Two kinds of effect, by when they act:
 *  - Before the members are drawn (`reduce-influence`, `add-cost`): the actor's trait values are changed,
 *    and the draws go through the changed values, so a seed gives every member the draw it would have had
 *    and the difference is the effect and not the dice.
 *  - Round by round (`block`, `delay`, `force-sequencing`, `require-approval`, `add-risk`,
 *    `limit-actions`): `begin` works out, from the state at the end of the round before, which actors the
 *    change is held back from, how much scrutiny each feels and which responses are open to it.
 *
 * A run with no constraints never reaches this file: `simulate.ts` passes `null` and every line it adds
 * to the round is the line it had.
 */
import type { SimulationSpec } from '../../../shared/analysis.js';
import type {
  AppliedConstraint,
  ConstraintEffect,
  ConstraintEvent,
  LimitableResponse,
} from '../../../shared/constraint-effects.js';
import type { RoundAdjust, RoundStats } from './dynamics.js';
import { PRESSURE_CAP } from './parameters.js';
import { SimulationInputError, type ResolvedActor } from './population.js';

const BIT: Record<LimitableResponse, number> = { adopt: 1, switch: 2, resist: 4 };
const MAX_NAMES = 3;
const MAX_EVENTS = 80;

type Kind = ConstraintEffect['kind'];

interface Entry<K extends Kind> {
  id: string;
  effect: Extract<ConstraintEffect, { kind: K }>;
  /** Who it is about, as indexes into the cast. */
  actors: number[];
  from: number;
  to: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const rounds = (count: number): string => `${count} ${count === 1 ? 'round' : 'rounds'}`;

function actorWords(names: readonly string[]): string {
  const shown = names.slice(0, MAX_NAMES).map((name) => name.slice(0, 60));
  if (names.length === 0) return 'every actor';
  if (names.length === 1) return shown[0] ?? '';
  if (names.length <= MAX_NAMES) return `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`;
  return `${shown.join(', ')} and ${names.length - MAX_NAMES} more`;
}

export interface Compiled {
  /** Changes an actor's resolved trait values before its members are drawn. */
  adjust: (index: number, resolved: ResolvedActor) => void;
  /** What `stepRound` reads each round. */
  round: RoundAdjust;
  /** The rounds an external responder waits on top of its own, per actor: only where a delay names it. */
  lagExtra: Int32Array;
  /** Works out the round's state from the stances at the end of the round before. */
  begin: (round: number, stats: RoundStats) => void;
  /** Called after the last round: what never happened is said then. */
  end: (last: number) => void;
  events: ConstraintEvent[];
}

/**
 * Checks the constraints against the cast and prepares what the run reads. Throws `SimulationInputError`
 * for one that names an actor who is not in the cast, as a variant does.
 */
export function compileConstraints(
  spec: Pick<SimulationSpec, 'actors' | 'rounds' | 'variant'> & {
    constraints: readonly AppliedConstraint[];
  },
  index: ReadonlyMap<string, number>,
): Compiled {
  const { actors, variant } = spec;
  const count = actors.length;
  const last = spec.rounds;
  const indexOf = (id: string): number => {
    const found = index.get(id);
    if (found === undefined) {
      throw new SimulationInputError(`A constraint names "${id}", who is not in the cast.`);
    }
    return found;
  };
  const names = actors.map((actor) => actor.name);
  // A scenario with no strength, or that lands after the last round, has no change to hold back.
  const lands = variant.intensity > 0 && variant.round <= last;
  const nameOf = (at: number): string => (names[at] ?? '').slice(0, 60);
  const namesOf = (scope: readonly number[]): string =>
    actorWords(scope.length === count ? [] : scope.map((at) => names[at] ?? ''));

  const events: ConstraintEvent[] = [];
  const emit = (
    constraintId: string,
    kind: ConstraintEvent['kind'],
    round: number,
    scope: readonly number[],
    description: string,
  ): void => {
    if (events.length >= MAX_EVENTS) return;
    events.push({
      constraintId,
      kind,
      round: Math.min(last, Math.max(1, round)),
      actorIds: scope.map((at) => actors[at]?.id ?? '').filter(Boolean),
      description: description.slice(0, 300).trim(),
    });
  };

  const scopeOf = (applied: AppliedConstraint): number[] =>
    applied.actorIds.length > 0
      ? [...new Set(applied.actorIds.map(indexOf))].sort((a, b) => a - b)
      : Array.from({ length: count }, (_, at) => at);

  const delays = new Int32Array(count);
  const lagExtra = new Int32Array(count);
  const holds: Entry<'block'>[] = [];
  const limits: Entry<'limit-actions'>[] = [];
  const risks: Entry<'add-risk'>[] = [];
  const influences: Entry<'reduce-influence'>[] = [];
  const costs: Entry<'add-cost'>[] = [];
  const delayed: Entry<'delay'>[] = [];
  const approvals: (Entry<'require-approval'> & { approver: number; granted: boolean })[] = [];
  const sequences: (Entry<'force-sequencing'> & { before: number[] })[] = [];

  for (const applied of spec.constraints) {
    const scope = scopeOf(applied);
    const base = {
      id: applied.id,
      actors: scope,
      from: applied.fromRound ?? 1,
      to: applied.toRound ?? Number.POSITIVE_INFINITY,
    };
    const { effect } = applied;
    switch (effect.kind) {
      case 'block':
        holds.push({ ...base, effect });
        break;
      case 'limit-actions':
        limits.push({ ...base, effect });
        break;
      case 'add-risk':
        risks.push({ ...base, effect });
        break;
      case 'reduce-influence':
        influences.push({ ...base, effect });
        break;
      case 'add-cost':
        costs.push({ ...base, effect });
        break;
      case 'delay':
        delayed.push({ ...base, effect });
        for (const at of scope) delays[at] = (delays[at] ?? 0) + effect.rounds;
        // A responder the constraint names is slow to respond; one in a delay of everything is not, because
        // what it watches already comes later.
        if (applied.actorIds.length > 0) {
          for (const at of scope) lagExtra[at] = (lagExtra[at] ?? 0) + effect.rounds;
        }
        break;
      case 'require-approval': {
        const approver = indexOf(effect.approverActorId);
        approvals.push({
          ...base,
          actors: scope.filter((at) => at !== approver),
          effect,
          approver,
          granted: false,
        });
        break;
      }
      case 'force-sequencing': {
        const before = [...new Set(effect.beforeActorIds.map(indexOf))];
        sequences.push({
          ...base,
          actors: scope.filter((at) => !before.includes(at)),
          effect,
          before,
        });
        break;
      }
    }
  }

  // The round the change reaches each actor: the round it lands, later by the delays that name the
  // actor, and never before the actors that must come first.
  const start = Int32Array.from({ length: count }, (_, at) => variant.round + (delays[at] ?? 0));
  for (const sequence of sequences) {
    const earliest = Math.max(...sequence.before.map((at) => start[at] ?? variant.round));
    for (const at of sequence.actors) {
      start[at] = Math.max(start[at] ?? 0, earliest + sequence.effect.gapRounds);
    }
  }

  if (lands) {
    for (const entry of delayed) {
      const reached = entry.actors.map((at) => start[at] ?? variant.round);
      emit(
        entry.id,
        'delayed',
        variant.round,
        entry.actors,
        Math.max(...reached) <= last
          ? `The change reaches ${namesOf(entry.actors)} from round ${Math.min(...reached)} instead of round ${variant.round}.`
          : `The change does not reach ${namesOf(entry.actors)} within the ${last} rounds of the run.`,
      );
    }
    for (const sequence of sequences) {
      emit(
        sequence.id,
        'sequenced',
        variant.round,
        sequence.actors,
        `The change reaches ${namesOf(sequence.actors)} ${rounds(sequence.effect.gapRounds)} after it reaches the actors that come first.`,
      );
    }
  }
  for (const entry of influences) {
    emit(
      entry.id,
      'influence-reduced',
      1,
      entry.actors,
      `The influence of ${namesOf(entry.actors)} is reduced from the first round.`,
    );
  }
  for (const entry of costs) {
    emit(
      entry.id,
      'friction-added',
      1,
      entry.actors,
      `Friction is added for ${namesOf(entry.actors)} from the first round.`,
    );
  }

  const adjust = (at: number, resolved: ResolvedActor): void => {
    for (const entry of influences) {
      if (entry.actors.includes(at)) {
        resolved.value.influence = clamp01(resolved.value.influence * (1 - entry.effect.amount));
      }
    }
    for (const entry of costs) {
      if (!entry.actors.includes(at)) continue;
      if (entry.effect.target === 'switching') {
        resolved.value.switchingCost = clamp01(resolved.value.switchingCost + entry.effect.amount);
      } else {
        resolved.value.adoptionTendency = clamp01(
          resolved.value.adoptionTendency - entry.effect.amount,
        );
      }
    }
  };

  const held = new Uint8Array(count);
  const extraScrutiny = new Float64Array(count);
  const forbid = new Uint8Array(count);
  const said = new Set<string>();
  const once = (key: string): boolean => {
    if (said.has(key)) return false;
    said.add(key);
    return true;
  };

  const begin = (round: number, stats: RoundStats): void => {
    for (let at = 0; at < count; at += 1) held[at] = round < (start[at] ?? 0) ? 1 : 0;
    extraScrutiny.fill(0);
    forbid.fill(0);

    if (lands) {
      for (const hold of holds) {
        if (round < hold.from || round > hold.to) continue;
        for (const at of hold.actors) held[at] = 1;
        if (hold.to >= variant.round && once(`hold:${hold.id}`)) {
          emit(
            hold.id,
            'held',
            Math.max(round, variant.round),
            hold.actors,
            `The change is held back from ${namesOf(hold.actors)} ${Number.isFinite(hold.to) ? `until round ${hold.to + 1}` : 'for the rest of the run'}.`,
          );
        }
      }
      for (const approval of approvals) {
        if (round < approval.from || round > approval.to) continue;
        // The approver reads the change from the round after it reaches the approver.
        const reads = (start[approval.approver] ?? variant.round) + 1;
        if (
          !approval.granted &&
          round >= reads &&
          (stats.mean[approval.approver] ?? 0) >= approval.effect.threshold
        ) {
          approval.granted = true;
          emit(
            approval.id,
            'approval-granted',
            round,
            [approval.approver],
            `The simulated mean stance of ${nameOf(approval.approver)} reached ${approval.effect.threshold}, so the change reaches ${namesOf(approval.actors)} from round ${round}.`,
          );
        }
        if (!approval.granted) for (const at of approval.actors) held[at] = 1;
      }
    }

    for (const risk of risks) {
      if (round < risk.from || round > risk.to) continue;
      for (const at of risk.actors) {
        extraScrutiny[at] = Math.min(PRESSURE_CAP, (extraScrutiny[at] ?? 0) + risk.effect.amount);
      }
      if (once(`risk:${risk.id}`)) {
        emit(
          risk.id,
          'risk-added',
          round,
          risk.actors,
          `Scrutiny is added for ${namesOf(risk.actors)}: members who accept little risk settle lower.`,
        );
      }
    }
    for (const limit of limits) {
      if (round < limit.from || round > limit.to) continue;
      const mask = limit.effect.forbid.reduce((bits, response) => bits | BIT[response], 0);
      for (const at of limit.actors) forbid[at] = (forbid[at] ?? 0) | mask;
      if (once(`limit:${limit.id}`)) {
        emit(
          limit.id,
          'limited',
          round,
          limit.actors,
          `${limit.effect.forbid.join(' and ')} ${limit.effect.forbid.length === 1 ? 'is' : 'are'} not open to ${namesOf(limit.actors)}: a stance that would read so is read as the nearest response left.`,
        );
      }
    }
  };

  const end = (finalRound: number): void => {
    if (!lands) return;
    for (const approval of approvals) {
      if (approval.granted || approval.from > finalRound) continue;
      emit(
        approval.id,
        'approval-withheld',
        finalRound,
        [approval.approver],
        `The simulated mean stance of ${nameOf(approval.approver)} did not reach ${approval.effect.threshold}, so the change did not reach ${namesOf(approval.actors)} while the constraint was active.`,
      );
    }
  };

  return { adjust, round: { held, extraScrutiny, forbid }, lagExtra, begin, end, events };
}
