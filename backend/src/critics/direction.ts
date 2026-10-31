import type { Variant } from '../../../shared/analysis.js';
import { effectiveTrait } from '../../../shared/signal.js';
import type { Actor } from '../../../shared/stakeholders.js';

type Cast = readonly Pick<Actor, 'id' | 'traits'>[];
type Scenario = Pick<Variant, 'impactOverrides'> & Partial<Pick<Variant, 'traitEdits'>>;

/** How a scenario lands on an actor: the impact that governs a run, after the scenario's own override and edits. */
export const impactUnder = (actor: Cast[number], variant: Scenario): number =>
  effectiveTrait(actor, variant, 'impact');

/** The actors a scenario affects in some direction, whatever its intensity. */
export const affectedBy = (cast: Cast, variant: Scenario) =>
  cast.filter((actor) => impactUnder(actor, variant) !== 0);
