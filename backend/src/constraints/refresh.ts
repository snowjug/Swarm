import {
  isAppliedConstraint,
  isLive,
  type ConsideredIn,
  type Constraint,
  type ConstraintSet,
} from '../../../shared/constraints.js';
import { withConflicts } from './conflicts.js';
import { enforcementOf } from './enforce.js';
import { evaluateGate, type GateWorld } from './gate.js';

/** What happened to a constraint elsewhere, known only when the set is read against the rest of the project. */
export interface Considered {
  /** Constraints the newest finished comparison made under this version of the set lists, applied or not. */
  inAnalysis: ReadonlySet<string>;
  /** Whether the independent review of that comparison has been run, so that it has read what the comparison recorded. */
  reviewed: boolean;
  /** Constraints a counterfactual view that still holds names. */
  inCounterfactual: ReadonlySet<string>;
}

export const NOTHING_ELSE: Considered = {
  inAnalysis: new Set(),
  reviewed: false,
  inCounterfactual: new Set(),
};

function consideredOf(constraint: Constraint, enforced: boolean, more: Considered): ConsideredIn[] {
  if (enforced || !isLive(constraint)) return [];
  const where: ConsideredIn[] = ['gate'];
  if (more.inCounterfactual.has(constraint.id)) where.push('counterfactual');
  if (more.inAnalysis.has(constraint.id)) {
    where.push('analysis-record');
    if (more.reviewed && isAppliedConstraint(constraint)) where.push('critic');
  }
  return where;
}

/**
 * The set with everything that is worked out and never typed worked out again: which constraints cannot
 * hold together, what the engine could apply, where a constraint was taken into account instead, and
 * what the gate says. Called whenever the set is written and whenever it is read, so that what a page
 * shows follows from the constraints and the project as they are.
 */
export function refreshSet(
  set: ConstraintSet,
  world: GateWorld,
  now: Date,
  more: Considered = NOTHING_ELSE,
): ConstraintSet {
  const reach = {
    actorIds: new Set(world.actors.map((actor) => actor.id)),
    variantIds: world.variantIds,
  };
  const constraints = withConflicts(set.constraints).map((constraint): Constraint => {
    const enforcement = enforcementOf(constraint, reach);
    return {
      ...constraint,
      enforcement,
      consideredIn: consideredOf(constraint, enforcement === 'enforced', more),
    };
  });
  return {
    ...set,
    constraints,
    coverage: evaluateGate({ ...set, constraints }, world, now),
  };
}
