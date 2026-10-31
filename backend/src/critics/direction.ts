import type { Variant } from '../../../shared/analysis.js';
import type { Actor } from '../../../shared/stakeholders.js';

type Cast = readonly Pick<Actor, 'id' | 'traits'>[];

/** How a scenario lands on an actor: the scenario's own figure for it, else the actor's impact trait. */
export const impactUnder = (
  actor: Cast[number],
  variant: Pick<Variant, 'impactOverrides'>,
): number => variant.impactOverrides[actor.id] ?? actor.traits.impact.value;

/** The actors a scenario affects in some direction, whatever its intensity. */
export const affectedBy = (cast: Cast, variant: Pick<Variant, 'impactOverrides'>) =>
  cast.filter((actor) => impactUnder(actor, variant) !== 0);
