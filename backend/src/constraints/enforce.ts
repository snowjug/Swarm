import {
  EFFECT_CATALOGUE,
  MAX_APPLIED_CONSTRAINTS,
  isAppliedConstraint,
  isLive,
  type AppliedConstraint,
  type Constraint,
  type ConstraintEffect,
  type ConstraintEnforcement,
  type NotAppliedReason,
  type RecordedConstraint,
  type UnappliedConstraint,
} from '../../../shared/constraints.js';

/** What a constraint has to refer to for the simulation to apply it: the actors and scenarios there are. */
export interface World {
  actorIds: ReadonlySet<string>;
  /** The scenarios of the comparison, the baseline included. */
  variantIds: ReadonlySet<string>;
}

const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

/** Whether what an effect names is in the cast. An effect that names no one is about everyone and always is. */
function targetsExist(effect: ConstraintEffect, world: World): boolean {
  switch (effect.kind) {
    case 'require-approval':
      return world.actorIds.has(effect.approverActorId);
    case 'force-sequencing':
      return effect.beforeActorIds.every((id) => world.actorIds.has(id));
    default:
      return true;
  }
}

export type Reach = 'applicable' | 'interpretive' | 'dangling' | 'soft-block';

/**
 * Whether the simulation could apply this constraint, from what it says and the cast and scenarios there
 * are now, whatever has been decided about it. A constraint that names an actor or a scenario that is gone
 * is dangling; a soft one is never run as a ban on the change; one with no effect is read, not run.
 */
export function reachOf(constraint: Constraint, world: World): Reach {
  if (constraint.effects.length === 0) return 'interpretive';
  const actorsGone =
    constraint.affectedActorIds.length > 0 &&
    constraint.affectedActorIds.every((id) => !world.actorIds.has(id));
  const alternativesGone =
    constraint.affectedAlternativeIds.length > 0 &&
    constraint.affectedAlternativeIds.every((id) => !world.variantIds.has(id));
  if (actorsGone || alternativesGone) return 'dangling';
  let soft = false;
  let dangling = false;
  for (const effect of constraint.effects) {
    if (effect.kind === 'block' && constraint.hardness !== 'hard') soft = true;
    else if (!targetsExist(effect, world)) dangling = true;
    else return 'applicable';
  }
  return dangling ? 'dangling' : soft ? 'soft-block' : 'interpretive';
}

/** `enforced` where the engine could apply it; otherwise `interpretive`, which changes nothing in a run. */
export const enforcementOf = (constraint: Constraint, world: World): ConstraintEnforcement =>
  reachOf(constraint, world) === 'applicable' ? 'enforced' : 'interpretive';

const refOf = (constraint: Constraint) => ({
  constraintId: constraint.id,
  statement: truncate(constraint.statement, 400),
  category: constraint.category,
  hardness: constraint.hardness,
  source: constraint.source,
  validation: constraint.validation,
});

export interface Compiled {
  applied: RecordedConstraint[];
  notApplied: UnappliedConstraint[];
}

/**
 * What a comparison applies of a set of constraints, and what it only reads. A constraint is applied
 * once a person has looked at it and has neither set it aside nor said it is unknown; one that cannot
 * be applied is listed with the reason, so that it is never mistaken for one that was. An effect
 * keeps the window of its constraint only where the engine reads one.
 */
export function compileConstraints(constraints: readonly Constraint[], world: World): Compiled {
  const applied: RecordedConstraint[] = [];
  const notApplied: UnappliedConstraint[] = [];
  const listed = (constraint: Constraint, reason: NotAppliedReason): void => {
    notApplied.push({ ...refOf(constraint), reason });
  };
  for (const constraint of constraints) {
    if (constraint.review === 'removed' || constraint.validation === 'rejected') continue;
    if (constraint.review === 'excluded') {
      listed(constraint, 'excluded');
      continue;
    }
    if (!isAppliedConstraint(constraint)) {
      if (isLive(constraint) && constraint.validation === 'unknown') listed(constraint, 'unknown');
      continue;
    }
    const reach = reachOf(constraint, world);
    if (reach !== 'applicable') {
      listed(constraint, reach);
      continue;
    }
    const actorIds = constraint.affectedActorIds.filter((id) => world.actorIds.has(id));
    const alternativeIds = constraint.affectedAlternativeIds.filter((id) =>
      world.variantIds.has(id),
    );
    let over = false;
    for (const effect of constraint.effects) {
      if (effect.kind === 'block' && constraint.hardness !== 'hard') continue;
      if (!targetsExist(effect, world)) continue;
      if (applied.length >= MAX_APPLIED_CONSTRAINTS) {
        over = true;
        continue;
      }
      const reads = EFFECT_CATALOGUE[effect.kind].window;
      const { fromRound, toRound } = constraint.window;
      const windowed = fromRound !== null || toRound !== null;
      applied.push({
        ...refOf(constraint),
        effect,
        actorIds,
        alternativeIds,
        fromRound: reads === 'both' ? fromRound : null,
        toRound: reads === 'both' ? toRound : null,
        ...(windowed && reads !== 'both'
          ? {
              note: 'Its window is not modelled for this effect: the simulation applies it for the whole run.',
            }
          : {}),
      });
    }
    if (over) listed(constraint, 'over-limit');
  }
  return { applied, notApplied };
}

/** The effects that apply to one scenario of a comparison, in the form the engine takes. */
export function appliedFor(
  recorded: readonly RecordedConstraint[],
  variantId: string,
): AppliedConstraint[] {
  return recorded
    .filter((item) => item.alternativeIds.length === 0 || item.alternativeIds.includes(variantId))
    .map((item) => ({
      id: item.constraintId,
      effect: item.effect,
      actorIds: item.actorIds,
      fromRound: item.fromRound,
      toRound: item.toRound,
    }));
}
