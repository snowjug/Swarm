import type { Variant } from './analysis.js';
import type { Actor } from './stakeholders.js';

/**
 * Whether the declared assumptions give a change any way to move anyone. It does when some scenario
 * other than the baseline has an intensity above nothing and some actor is affected by it: the actor's
 * own `impact` trait, or the scenario's override of it, is not zero. Where it does not, a comparison
 * with no change can only show noise, and nothing it says is about the change.
 */
export function changeCanMoveAnyone(
  actors: readonly Pick<Actor, 'id' | 'traits'>[],
  variants: readonly Pick<Variant, 'kind' | 'intensity' | 'impactOverrides'>[],
): boolean {
  return variants.some(
    (variant) =>
      variant.kind !== 'baseline' &&
      variant.intensity > 0 &&
      actors.some(
        (actor) => (variant.impactOverrides[actor.id] ?? actor.traits.impact.value) !== 0,
      ),
  );
}

/** What a person should be told when it does not, in the words every page and report uses. */
export const NO_DIRECTION_NOTICE =
  'No stakeholder has an expected direction of impact, so the change cannot move anyone in the simulation and every difference from no change is noise. Say who is helped or harmed in the stakeholder review, or read the evidence with a model, before reading anything into the results.';
