/**
 * Every number the model assumes, in one place, so that the documentation (docs/analysis/engine.md)
 * and the code cannot drift apart. None of these is measured: each is a modelling choice, listed there
 * with what it does and what changing it would mean.
 */

/** A response begins here on the stance scale; see `RESPONSE_MEANINGS` in shared/analysis.ts. */
export const ADOPT_AT = 0.35;
export const ACCEPT_AT = 0.1;
export const ADVERSE_AT = -0.1;
export const AGAINST_AT = -0.35;
/** Below this effective switching cost, a member who is clearly against looks for an alternative. */
export const CHEAP_SWITCH_BELOW = 0.5;

/** How far a member's stance moves toward the stance of those it listens to, per round at openness 1. */
export const SOCIAL_RATE = 0.15;
/** The share of the change's push that is still felt one round later (and of any event's push). */
export const PERSISTENCE = 0.5;
/** Half-width of the seeded noise on a stance, per round, for a member of average reactivity. */
export const NOISE = 0.02;
/** How much trust, and readiness to take up something new, scale how the change is felt. */
export const TRUST_WEIGHT = 0.8;
export const ADOPTION_WEIGHT = 0.4;
/** An actor whose impact is smaller than this is neither harmed nor benefited by the change. */
export const AFFECTED_MIN = 0.05;
/** Weight of an actor's own cohort, relative to a related actor of the same voice, in what it listens to. */
export const COHORT_TIE = 1;
/** A member counts as "risk averse" in the risk-concern signal below this risk tolerance. */
export const RISK_AVERSE_BELOW = 0.5;

/** Effect of an event on the actors it lands on, per unit of event strength and tie strength. */
export const SWITCH_PULL = 0.1;
export const ENABLE_LIFT = 0.1;
export const SCRUTINY_PULL = 0.08;
export const RELIEF_STEP = 0.4;
export const RELIEF_CAP = 0.6;
export const PRESSURE_CAP = 1;

/** External responders: how they see the actors around them, and how many events a run can hold. */
export const MAX_EVENTS = 200;
/** How many earlier events an event lists as something it followed from, besides the signal. */
export const MAX_EARLIER_CAUSES = 3;
export const DEFAULT_TIE = 0.5;
export const FALLBACK_TIE = 0.3;

export const DEFAULT_SAMPLE_CAP = 200;

/**
 * How much an actor's population counts when others weigh what it does. The population is a modelling
 * assumption, so it enters on a log scale: a cohort that stands for a million counts about seven times
 * one that stands for one. It is never used to weight a reported result and never reported itself.
 */
export function sizeWeight(size: number): number {
  return 1 + Math.log10(Math.max(1, size));
}
