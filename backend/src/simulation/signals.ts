import { AFFECTED_MIN } from './parameters.js';
import type { RoundStats } from './dynamics.js';
import { ADOPT_INDEX, CATEGORY_COUNT, RESIST_INDEX, SWITCH_INDEX } from './response.js';

/**
 * Aggregate signals: plain readings of the members' states that say how the change is landing. They
 * are computed per actor every round, and then read in two ways:
 *
 *  - reported, with equal weight for each actor the signal is about (never weighted by population),
 *  - observed by external responders, who watch the actors they are related to, some rounds late.
 *
 * A signal is "about" the actors the change harms (impact at or below -0.05) or the ones it benefits
 * (at or above +0.05). For other actors it is not defined, and it is left out of what is reported
 * and of what a responder watches.
 *
 *  adverse-share       share of members who are clearly against: stance of -0.35 or lower, that is
 *                      who would switch or resist                          (about harmed actors)
 *  switching-pressure  share of members whose response is "switch"         (about harmed actors)
 *  adoption            share of members whose response is "adopt"          (about benefited actors)
 *  risk-concern        among members who tolerate little risk (risk tolerance below 0.5), the share who
 *                      are clearly against; 0 when none is risk averse     (about harmed actors)
 */
export const SIGNAL_NAMES = [
  'adverse-share',
  'switching-pressure',
  'adoption',
  'risk-concern',
] as const;
export type SignalName = (typeof SIGNAL_NAMES)[number];
export const SIGNAL_INDEX: Record<SignalName, number> = {
  'adverse-share': 0,
  'switching-pressure': 1,
  adoption: 2,
  'risk-concern': 3,
};
const ABOUT_HARMED = [true, true, false, true] as const;

export interface SignalHistory {
  actorCount: number;
  /** `values[signal][(round - 1) * actorCount + actor]`. */
  values: Float64Array[];
  /** `applies[signal][actor]` is 1 when the signal is about that actor. */
  applies: Uint8Array[];
}

export function createHistory(rounds: number, impact: ArrayLike<number>): SignalHistory {
  const actorCount = impact.length;
  const applies = ABOUT_HARMED.map((harmed) => {
    const flags = new Uint8Array(actorCount);
    for (let actor = 0; actor < actorCount; actor += 1) {
      const value = impact[actor] ?? 0;
      flags[actor] = (harmed ? value <= -AFFECTED_MIN : value >= AFFECTED_MIN) ? 1 : 0;
    }
    return flags;
  });
  return {
    actorCount,
    values: SIGNAL_NAMES.map(() => new Float64Array(rounds * actorCount)),
    applies,
  };
}

/** Record the four signals of every actor for one round, from the counters that round produced. */
export function recordSignals(
  history: SignalHistory,
  round: number,
  stats: RoundStats,
  start: Int32Array,
): void {
  const { actorCount, values } = history;
  const adverse = values[SIGNAL_INDEX['adverse-share']];
  const switching = values[SIGNAL_INDEX['switching-pressure']];
  const adoption = values[SIGNAL_INDEX.adoption];
  const concern = values[SIGNAL_INDEX['risk-concern']];
  if (!adverse || !switching || !adoption || !concern) return;
  const offset = (round - 1) * actorCount;
  for (let actor = 0; actor < actorCount; actor += 1) {
    const members = (start[actor + 1] ?? 0) - (start[actor] ?? 0);
    const base = actor * CATEGORY_COUNT;
    const against =
      (stats.counts[base + SWITCH_INDEX] ?? 0) + (stats.counts[base + RESIST_INDEX] ?? 0);
    const averse = stats.averse[actor] ?? 0;
    adverse[offset + actor] = against / members;
    switching[offset + actor] = (stats.counts[base + SWITCH_INDEX] ?? 0) / members;
    adoption[offset + actor] = (stats.counts[base + ADOPT_INDEX] ?? 0) / members;
    concern[offset + actor] = averse > 0 ? (stats.worried[actor] ?? 0) / averse : 0;
  }
}

/** The reported value of each signal in one round: the mean over the actors it is about, else 0. */
export function aggregateSignals(
  history: SignalHistory,
  round: number,
): Record<SignalName, number> {
  const { actorCount, values, applies } = history;
  const offset = (round - 1) * actorCount;
  const result = {} as Record<SignalName, number>;
  SIGNAL_NAMES.forEach((name, signal) => {
    const series = values[signal];
    const flags = applies[signal];
    let total = 0;
    let about = 0;
    if (series && flags) {
      for (let actor = 0; actor < actorCount; actor += 1) {
        if (flags[actor]) {
          total += series[offset + actor] ?? 0;
          about += 1;
        }
      }
    }
    result[name] = about > 0 ? total / about : 0;
  });
  return result;
}

/** The actors a responder watches and how much each counts, as parallel arrays. */
export interface Reach {
  actors: readonly number[];
  /** Relation strength times the actor's population weight: how much the actor counts when watched. */
  watch: readonly number[];
}

/**
 * What a responder sees of one signal in one round: the mean over the actors in its reach that the
 * signal is about, weighted by `watch`. `null` when the signal is about none of them.
 */
export function observe(
  history: SignalHistory,
  signal: SignalName,
  round: number,
  reach: Reach,
): number | null {
  const index = SIGNAL_INDEX[signal];
  const series = history.values[index];
  const flags = history.applies[index];
  if (!series || !flags) return null;
  const offset = (round - 1) * history.actorCount;
  let total = 0;
  let weight = 0;
  for (let at = 0; at < reach.actors.length; at += 1) {
    const actor = reach.actors[at] ?? 0;
    if (!flags[actor]) continue;
    const watch = reach.watch[at] ?? 0;
    total += watch * (series[offset + actor] ?? 0);
    weight += watch;
  }
  return weight > 0 ? total / weight : null;
}
