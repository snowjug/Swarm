import { RESPONSE_CATEGORIES, type ResponseCategory } from '../../../shared/analysis.js';
import { ACCEPT_AT, ADOPT_AT, ADVERSE_AT, AGAINST_AT, CHEAP_SWITCH_BELOW } from './parameters.js';

/** Index into `RESPONSE_CATEGORIES`, in the order the counters in a run use. */
export type ResponseIndex = 0 | 1 | 2 | 3 | 4 | 5;
export const ADOPT_INDEX = 0;
export const SWITCH_INDEX = 4;
export const CATEGORY_COUNT = RESPONSE_CATEGORIES.length;

/**
 * The response for a final stance, as an index. Thresholds on the stance scale:
 *   stance >= 0.35            adopt
 *   0.1 <= stance < 0.35      accept-with-conditions
 *   -0.1 < stance < 0.1       wait
 *   -0.35 < stance <= -0.1    adapt-defensively
 *   stance <= -0.35           switch when the switching cost is below 0.5, otherwise resist
 */
export function classifyIndex(stance: number, switchingCost: number): ResponseIndex {
  if (stance >= ADOPT_AT) return 0;
  if (stance >= ACCEPT_AT) return 1;
  if (stance > ADVERSE_AT) return 2;
  if (stance > AGAINST_AT) return 3;
  return switchingCost < CHEAP_SWITCH_BELOW ? 4 : 5;
}

type Scale = number | { value: number };

/**
 * What a member ends up doing, a reading of where its stance ended and how costly switching is for it.
 * It is a classification of the simulation, never an observed behaviour.
 */
export function classifyResponse(
  stance: number,
  traits: { switchingCost: Scale },
): ResponseCategory {
  if (!Number.isFinite(stance)) throw new RangeError('A stance has to be a finite number.');
  const cost =
    typeof traits.switchingCost === 'number' ? traits.switchingCost : traits.switchingCost.value;
  return RESPONSE_CATEGORIES[classifyIndex(stance, cost)];
}
