import {
  GATE_STATUS_WORDS,
  MAX_CLARIFICATIONS,
  isHighStakes,
  isLive,
  openQuestions,
  provisionalLabel,
  type Constraint,
  type ConstraintCoverage,
  type ConstraintRef,
  type ConstraintSet,
} from '../../../shared/constraints.js';
import { detectConflicts } from './conflicts.js';
import { enforcementOf, type World } from './enforce.js';

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

/** What the gate reads besides the constraints: the scenarios and the cast as they are now. */
export interface GateWorld {
  /** The scenarios other than the baseline: where the change is tried. */
  alternatives: readonly { id: string; label: string }[];
  /** Every scenario of the comparison, the baseline included. */
  variantIds: ReadonlySet<string>;
  actors: readonly { id: string; name: string }[];
  assumptionIds: ReadonlySet<string>;
  /** Whether the scenario or the actors changed after the constraints were read against them. */
  stale: { scenario: boolean; actors: boolean };
}

const refOf = (constraint: Constraint): ConstraintRef => ({
  id: constraint.id,
  category: constraint.category,
  hardness: constraint.hardness,
  statement: clip(constraint.statement, 160),
});

const byHardness = (a: Constraint, b: Constraint): number =>
  Number(b.hardness === 'hard') - Number(a.hardness === 'hard') || a.id.localeCompare(b.id);

/**
 * The Constraint Coverage Gate: what is known, assumed, conflicting and missing, which alternatives a hard
 * constraint rules out, who is affected, and so whether a simulation may start and with what label. It is
 * rules over the constraints and the scenario, nothing a model decides, and the same inputs give the same
 * answer. It decides nothing about the world.
 *
 *  - `blocked` when a hard legal, regulatory or safety constraint nobody has settled (not confirmed,
 *    rejected, assumed, marked unknown or set aside) stands, or when a hard constraint rules out every
 *    alternative: going on would pass a limit without anyone having said so, or compare nothing.
 *  - `provisional` when anything is left that a person has not confirmed: an unvalidated, assumed or
 *    unknown constraint, a possible conflict, an open question, a hard constraint the simulation can only
 *    read, a constraint that names what is gone, or constraints read against an earlier scenario or cast.
 *  - `clear` otherwise.
 */
export function evaluateGate(
  set: Pick<ConstraintSet, 'constraints' | 'clarifications' | 'reviewedAt'>,
  world: GateWorld,
  now: Date,
): ConstraintCoverage {
  const live = set.constraints.filter(isLive);
  const reach: World = {
    actorIds: new Set(world.actors.map((actor) => actor.id)),
    variantIds: world.variantIds,
  };
  const enforced = (constraint: Constraint): boolean =>
    enforcementOf(constraint, reach) === 'enforced';

  const known = live.filter(
    (constraint) => constraint.hardness === 'hard' && constraint.validation === 'confirmed',
  );
  const assumed = live.filter((constraint) => constraint.validation === 'assumed');
  const unvalidated = live.filter((constraint) => constraint.validation === 'unvalidated');
  const unknown = live.filter((constraint) => constraint.validation === 'unknown');
  const interpretive = live.filter((constraint) => !enforced(constraint));
  const hardInterpretive = interpretive.filter((constraint) => constraint.hardness === 'hard');
  const proposed = set.constraints.filter((constraint) => constraint.review === 'proposed');

  const conflicts = detectConflicts(set.constraints);
  const conflicting = conflicts.map((conflict) => ({
    ids: [...conflict.ids],
    basis: clip(conflict.basis, 300),
  }));

  const open = openQuestions({ clarifications: set.clarifications });
  const allOpen = set.clarifications.filter((question) => question.status === 'open');
  const missing = allOpen.slice(0, MAX_CLARIFICATIONS).map((question) => ({
    clarificationId: question.id,
    category: question.category,
    text: clip(question.question, 300),
  }));

  // An alternative is ruled out by a hard constraint that bans the change outright: a block with no actors
  // named and no window, since a block in a window only holds the change back.
  const bans = live.filter(
    (constraint) =>
      constraint.hardness === 'hard' &&
      constraint.review !== 'proposed' &&
      constraint.validation !== 'unknown' &&
      constraint.effects.some((effect) => effect.kind === 'block') &&
      constraint.affectedActorIds.length === 0 &&
      constraint.window.fromRound === null &&
      constraint.window.toRound === null,
  );
  const violations = world.alternatives
    .map((alternative) => ({
      alternativeId: alternative.id,
      label: clip(alternative.label, 120),
      constraintIds: bans
        .filter(
          (constraint) =>
            constraint.affectedAlternativeIds.length === 0 ||
            constraint.affectedAlternativeIds.includes(alternative.id),
        )
        .map((constraint) => constraint.id),
    }))
    .filter((violation) => violation.constraintIds.length > 0);

  const names = new Map(world.actors.map((actor) => [actor.id, actor.name]));
  const touched = new Map<string, Set<string>>();
  const touch = (actorId: string, constraintId: string): void => {
    if (!names.has(actorId)) return;
    const set_ = touched.get(actorId) ?? new Set<string>();
    set_.add(constraintId);
    touched.set(actorId, set_);
  };
  for (const constraint of live) {
    for (const id of constraint.affectedActorIds) touch(id, constraint.id);
    for (const effect of constraint.effects) {
      if (effect.kind === 'require-approval') touch(effect.approverActorId, constraint.id);
      if (effect.kind === 'force-sequencing') {
        for (const id of effect.beforeActorIds) touch(id, constraint.id);
      }
    }
  }
  const affectedActors = [...touched]
    .map(([actorId, ids]) => ({
      actorId,
      name: clip(names.get(actorId) ?? actorId, 120),
      constraintIds: [...ids].sort(),
    }))
    .sort(
      (a, b) =>
        b.constraintIds.length - a.constraintIds.length || a.actorId.localeCompare(b.actorId),
    );

  const dangling = live.filter((constraint) => {
    const missingActor = constraint.affectedActorIds.some((id) => !names.has(id));
    const missingAlternative = constraint.affectedAlternativeIds.some(
      (id) => !world.variantIds.has(id),
    );
    const missingAssumption =
      constraint.assumptionId !== null && !world.assumptionIds.has(constraint.assumptionId);
    const effectTarget = constraint.effects.some(
      (effect) =>
        (effect.kind === 'require-approval' && !names.has(effect.approverActorId)) ||
        (effect.kind === 'force-sequencing' && effect.beforeActorIds.some((id) => !names.has(id))),
    );
    // With no cast there is nothing to be dangling from yet: the cast is what the references are checked against.
    return (
      world.actors.length > 0 &&
      (missingActor || effectTarget || missingAlternative || missingAssumption)
    );
  });

  const needsConfirmation = [
    ...live.filter((constraint) => constraint.validation !== 'confirmed'),
  ].sort(byHardness);

  const blockedBy: ConstraintCoverage['blockedBy'] = [];
  for (const constraint of live.filter(
    (item) =>
      item.hardness === 'hard' && isHighStakes(item.category) && item.validation === 'unvalidated',
  )) {
    blockedBy.push({
      reason: 'unresolved-high-stakes',
      constraintId: constraint.id,
      text: clip(
        `A hard ${constraint.category} constraint is not settled: confirm it, set it aside, mark it unknown or choose to assume it. “${clip(constraint.statement, 140)}”`,
        300,
      ),
    });
  }
  if (world.alternatives.length > 0 && violations.length === world.alternatives.length) {
    blockedBy.push({
      reason: 'violated-by-every-alternative',
      constraintId: violations[0]?.constraintIds[0] ?? null,
      text: 'Every alternative is ruled out by a hard constraint, so there is nothing to compare. Review those constraints, or edit the alternatives.',
    });
  }

  const staleWords = [
    world.stale.scenario ? 'the scenario' : '',
    world.stale.actors ? 'the actors' : '',
  ]
    .filter(Boolean)
    .join(' and ');
  const reasons: string[] = [];
  const reason = (count: number, one: string, many: string): void => {
    if (count > 0) reasons.push(clip(`${count} ${count === 1 ? one : many}`, 300));
  };
  reason(
    proposed.length,
    'constraint waits for a first look.',
    'constraints wait for a first look.',
  );
  reason(
    unvalidated.length,
    'constraint has not been validated.',
    'constraints have not been validated.',
  );
  reason(
    assumed.length,
    'constraint is assumed, not checked.',
    'constraints are assumed, not checked.',
  );
  reason(
    unknown.length,
    'constraint is marked unknown and is not applied.',
    'constraints are marked unknown and are not applied.',
  );
  reason(
    conflicting.length,
    'possible conflict between constraints.',
    'possible conflicts between constraints.',
  );
  reason(allOpen.length, 'question is still open.', 'questions are still open.');
  reason(
    hardInterpretive.length,
    'hard constraint is read but not modelled: the simulation does not test it.',
    'hard constraints are read but not modelled: the simulation does not test them.',
  );
  reason(
    dangling.length,
    'constraint names something that is no longer there.',
    'constraints name something that is no longer there.',
  );
  if (staleWords)
    reasons.push(`The constraints were read against an earlier version of ${staleWords}.`);

  const reviewed = set.reviewedAt !== null && proposed.length === 0;
  const provisional =
    unvalidated.length > 0 ||
    assumed.length > 0 ||
    unknown.length > 0 ||
    conflicting.length > 0 ||
    allOpen.length > 0 ||
    hardInterpretive.length > 0 ||
    dangling.length > 0 ||
    staleWords !== '';
  const status: ConstraintCoverage['status'] =
    blockedBy.length > 0 ? 'blocked' : provisional ? 'provisional' : 'clear';

  const label =
    status === 'provisional'
      ? provisionalLabel({
          unvalidated: unvalidated.length,
          assumed: assumed.length,
          unknown: unknown.length,
          missing: allOpen.length,
          conflicting: conflicting.length,
          notModelledHard: hardInterpretive.length,
        })
      : null;
  const summary =
    status === 'blocked'
      ? `${GATE_STATUS_WORDS.blocked}: ${blockedBy[0]?.reason === 'violated-by-every-alternative' ? 'every alternative is ruled out by a hard constraint.' : 'a hard legal, regulatory or safety constraint is not settled.'}`
      : status === 'provisional'
        ? `${GATE_STATUS_WORDS.provisional}: a simulation may run, and says so.${open.length > 0 ? ' Some constraints are still being asked about.' : ''}`
        : live.length === 0
          ? `${GATE_STATUS_WORDS.clear}: no constraints were identified, which is what was found and not proof that none exist.`
          : `${GATE_STATUS_WORDS.clear}: every constraint is confirmed.`;

  return {
    status,
    reviewed,
    evaluatedAt: now.toISOString(),
    summary: clip(summary, 300),
    label,
    known: known.sort(byHardness).map(refOf),
    assumed: assumed.sort(byHardness).map(refOf),
    unvalidated: unvalidated.sort(byHardness).map(refOf),
    unknown: unknown.sort(byHardness).map(refOf),
    conflicting,
    missing,
    violations,
    affectedActors: affectedActors.slice(0, 60),
    interpretive: interpretive.sort(byHardness).map(refOf),
    dangling: dangling.sort(byHardness).map(refOf),
    needsConfirmation: needsConfirmation.map(refOf),
    blockedBy: blockedBy.slice(0, 20),
    largestSensitivity: null,
    reasons: reasons.slice(0, 16),
  };
}
