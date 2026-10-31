/**
 * External responders: actors whose category is one of `EXTERNAL_RESPONDER_CATEGORIES` (competitor,
 * substitute, partner, regulator). They do not react to the change itself but to what it does to the
 * actors they are related to, and what they do in turn changes those actors in later rounds. That is
 * how second-order effects arise: nothing here knows what the change is, who is harmed, or what a
 * competitor "would" do. Each responder follows one generic rule:
 *
 *   1. It watches one signal (see signals.ts), averaged over the actors in its reach that the signal
 *      is about, and sees it `lag` rounds late: 1 round at high reactivity, 3 at low.
 *   2. The first time the signal it sees is at or above its `threshold` it acts, once, emitting one
 *      event. The threshold is higher the more risk the responder tolerates and the less authority it
 *      has.
 *   3. The event lands on every actor in the responder's reach from the next round, with a strength
 *      that grows with how far the signal was past the threshold and with the responder's authority
 *      (effects are in dynamics.ts). What it adds lasts for the rest of the run: an alternative that
 *      has appeared, help that has been offered and scrutiny that has begun do not go away.
 *
 * Every event lists what it followed from: the signal it saw, and the earlier events that had already
 * landed on actors it was watching (the engine does not say which of them mattered; running the same
 * seeds with `signals: false` shows what all of them together did). Reading those links back gives a
 * chain such as discontent, then a counter-move, then more switching, then a substitute offer. Since
 * an actor has one rule and acts once, an event is unique per (kind, actor, round) by construction, and
 * a run holds at most one event per actor.
 *
 * Reach is the actors the responder is related to, in either direction, weighted by relation strength.
 * With no relations it is the actors of the categories in DEFAULT_REACH, at a tie of 0.5. If none of
 * those is harmed by the change it also reaches the harmed actors, at a tie of 0.3, because there
 * would otherwise be nothing for it to watch or to act on.
 */
import type { SimEvent } from '../../../shared/analysis.js';
import {
  EXTERNAL_RESPONDER_CATEGORIES,
  type Actor,
  type ActorRelation,
  type StakeholderCategory,
} from '../../../shared/stakeholders.js';
import type { Effects } from './dynamics.js';
import {
  AFFECTED_MIN,
  DEFAULT_TIE,
  FALLBACK_TIE,
  MAX_EARLIER_CAUSES,
  MAX_EVENTS,
  PRESSURE_CAP,
  RELIEF_CAP,
  RELIEF_STEP,
  sizeWeight,
} from './parameters.js';
import type { Population } from './population.js';
import {
  observe,
  SIGNAL_INDEX,
  type Reach,
  type SignalHistory,
  type SignalName,
} from './signals.js';

export interface ResponderRule {
  signal: SignalName;
  kind: string;
  /** What the event does to the actors it lands on, in words (also used in the event description). */
  effect: string;
}

export const RESPONDER_RULES: Readonly<Partial<Record<StakeholderCategory, ResponderRule>>> = {
  competitor: {
    signal: 'adverse-share',
    kind: 'counter-move',
    effect:
      'an alternative becomes more attractive: switching gets cheaper and discontented members settle further from the change',
  },
  substitute: {
    signal: 'switching-pressure',
    kind: 'substitute-offer',
    effect:
      'an alternative becomes available: switching gets cheaper and discontented members settle further from the change',
  },
  partner: {
    signal: 'adverse-share',
    kind: 'enablement',
    effect: 'help eases the burden: discontented members settle closer to neutral',
  },
  regulator: {
    signal: 'risk-concern',
    kind: 'scrutiny',
    effect: 'attention raises risk concern: members who tolerate little risk settle lower',
  },
};

/** The categories a responder with no relations reaches. */
export const DEFAULT_REACH: Readonly<
  Partial<Record<StakeholderCategory, readonly StakeholderCategory[]>>
> = {
  competitor: ['end-user', 'cost-bearer', 'beneficiary', 'channel'],
  substitute: ['end-user', 'cost-bearer', 'beneficiary'],
  partner: ['decision-maker', 'channel', 'operations'],
  regulator: ['decision-maker', 'risk-bearer', 'end-user', 'cost-bearer'],
};

/** Rounds a responder takes to see a signal: 1 above a reactivity of 0.75, 3 at 0.25 or below, else 2. */
export function responderLag(reactivity: number): number {
  return 1 + Math.round(2 * (1 - reactivity));
}

/** The level of the signal a responder acts at, from 0.15 (bold, powerful) to 0.75 (tolerant, weak). */
export function responderThreshold(riskTolerance: number, authority: number): number {
  return 0.15 + 0.35 * riskTolerance + 0.25 * (1 - authority);
}

/** From 0.2 to 1: grows with how far past its threshold the signal was and with the responder's authority. */
export function eventStrength(seen: number, threshold: number, authority: number): number {
  const excess = Math.min(1, Math.max(0, (seen - threshold) / (1 - threshold)));
  return (0.4 + 0.6 * excess) * (0.5 + 0.5 * authority);
}

export interface Responder {
  actor: number;
  rule: ResponderRule;
  lag: number;
  threshold: number;
  authority: number;
  reach: Reach;
  /** Relation strength of each actor in the reach: how hard an event lands on it. */
  tie: readonly number[];
  acted: boolean;
}

export function isResponder(category: StakeholderCategory): boolean {
  return (
    EXTERNAL_RESPONDER_CATEGORIES.includes(category) && RESPONDER_RULES[category] !== undefined
  );
}

export function buildResponders(
  actors: readonly Actor[],
  population: Population,
  relations: readonly ActorRelation[],
  index: ReadonlyMap<string, number>,
): Responder[] {
  const harmed = actors.map(
    (_, at) => (population.resolved[at]?.value.impact ?? 0) <= -AFFECTED_MIN,
  );
  const responders: Responder[] = [];
  actors.forEach((actor, self) => {
    const rule = isResponder(actor.category) ? RESPONDER_RULES[actor.category] : undefined;
    const resolved = population.resolved[self];
    if (!rule || !resolved) return;
    const ties = new Map<number, number>();
    for (const relation of relations) {
      if (!(relation.strength > 0)) continue;
      const other =
        relation.from === actor.id
          ? index.get(relation.to)
          : relation.to === actor.id
            ? index.get(relation.from)
            : undefined;
      if (other !== undefined && other !== self) {
        ties.set(other, Math.max(ties.get(other) ?? 0, relation.strength));
      }
    }
    if (ties.size === 0) {
      const categories = DEFAULT_REACH[actor.category] ?? [];
      actors.forEach((other, at) => {
        if (at !== self && categories.includes(other.category)) ties.set(at, DEFAULT_TIE);
      });
    }
    if (![...ties.keys()].some((at) => harmed[at])) {
      harmed.forEach((isHarmed, at) => {
        if (isHarmed && at !== self && !ties.has(at)) ties.set(at, FALLBACK_TIE);
      });
    }
    const reached = [...ties.keys()];
    responders.push({
      actor: self,
      rule,
      lag: responderLag(resolved.value.reactivity),
      threshold: responderThreshold(resolved.value.riskTolerance, resolved.value.authority),
      authority: resolved.value.authority,
      reach: {
        actors: reached,
        watch: reached.map((at) => (ties.get(at) ?? 0) * sizeWeight(actors[at]?.size ?? 1)),
      },
      tie: reached.map((at) => ties.get(at) ?? 0),
      acted: false,
    });
  });
  return responders;
}

/** An event as the run keeps it: the public record and the actors it landed on. */
interface Emitted {
  event: SimEvent;
  landedOn: readonly number[];
}

export interface Responders {
  list: Responder[];
  emitted: Emitted[];
}

export function createResponders(list: Responder[]): Responders {
  return { list, emitted: [] };
}

function land(effects: Effects, responder: Responder, strength: number): void {
  responder.reach.actors.forEach((actor, at) => {
    const amount = strength * (responder.tie[at] ?? 0);
    const raise = (series: Float64Array, cap: number, by: number): void => {
      series[actor] = Math.min(cap, (series[actor] ?? 0) + by);
    };
    switch (responder.rule.kind) {
      case 'counter-move':
      case 'substitute-offer':
        raise(effects.relief, RELIEF_CAP, RELIEF_STEP * amount);
        raise(effects.pullSwitch, PRESSURE_CAP, amount);
        break;
      case 'enablement':
        raise(effects.lift, PRESSURE_CAP, amount);
        break;
      default:
        raise(effects.scrutiny, PRESSURE_CAP, amount);
    }
  });
}

/**
 * After a round: let every responder that has not yet acted see the signal as it stood `lag` rounds
 * ago and act if it is at or above the threshold. Events are recorded in the order the responders
 * appear in the cast.
 */
export function runResponders(
  responders: Responders,
  actors: readonly Actor[],
  history: SignalHistory,
  effects: Effects,
  round: number,
): void {
  for (const responder of responders.list) {
    const actor = actors[responder.actor];
    const seenRound = round - responder.lag;
    if (!actor || responder.acted || seenRound < 1) continue;
    if (responders.emitted.length >= MAX_EVENTS) return;
    const seen = observe(history, responder.rule.signal, seenRound, responder.reach);
    if (seen === null || seen < responder.threshold) continue;

    const about = history.applies[SIGNAL_INDEX[responder.rule.signal]];
    const watched = new Set(responder.reach.actors.filter((at) => about?.[at]));
    const earlier: string[] = [];
    for (
      let at = responders.emitted.length - 1;
      at >= 0 && earlier.length < MAX_EARLIER_CAUSES;
      at -= 1
    ) {
      const candidate = responders.emitted[at];
      if (
        candidate &&
        candidate.event.round < seenRound &&
        candidate.landedOn.some((landed) => watched.has(landed))
      ) {
        earlier.unshift(candidate.event.id);
      }
    }
    const description =
      `${actor.name.slice(0, 60)} acted in round ${round}: the ${responder.rule.signal} signal it watches ` +
      `stood at ${seen.toFixed(2)} in round ${seenRound}, at or above its threshold of ` +
      `${responder.threshold.toFixed(2)}. From round ${round + 1}, ${responder.rule.effect}.`;
    responders.emitted.push({
      event: {
        id: `e${responders.emitted.length + 1}`,
        round,
        kind: responder.rule.kind,
        actorId: actor.id,
        description: description.slice(0, 300).trim(),
        causedBy: [responder.rule.signal, ...earlier],
      },
      landedOn: responder.reach.actors,
    });
    land(effects, responder, eventStrength(seen, responder.threshold, responder.authority));
    responder.acted = true;
  }
}
