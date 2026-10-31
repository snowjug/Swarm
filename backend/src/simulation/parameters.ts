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

/**
 * Each round a member closes this share of the gap between its stance and the stance it is anchored
 * to: `RATE_MIN` at no reactivity, `RATE_MIN + RATE_SPAN` at full reactivity (0.4 at 0.5).
 */
export const RATE_MIN = 0.2;
export const RATE_SPAN = 0.4;
/** How far the change moves the stance a member is anchored to, per unit of intensity x sensitivity x impact. */
export const CHANGE_GAIN = 1.25;
/**
 * Run-to-run variation, as a standard deviation around 1, in how strongly a whole group reacts to the
 * change. Members of a group are not independent draws: they share circumstances, so a group as a
 * whole reacts a little more or a little less strongly in one run than in another.
 */
export const GROUP_SPREAD = 0.15;
/** How far a member moves toward the stance of those it listens to, per round at openness 1. */
export const SOCIAL_RATE = 0.1;
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

/**
 * Effect of an event on the stance the actors it lands on are anchored to, per unit of pressure
 * (event strength times tie strength). Pressures last for the rest of the run.
 */
export const SWITCH_PULL = 0.5;
export const ENABLE_LIFT = 0.5;
export const SCRUTINY_PULL = 0.3;
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
