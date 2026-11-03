import {
  CONSTRAINT_CATEGORY_LABELS,
  OPEN_WINDOW,
  isLive,
  type Clarification,
  type Constraint,
  type ConstraintCategory,
  type ConstraintEffect,
  type ConstraintInput,
  type ConstraintPatch,
  type ConstraintReviewAction,
  type ConstraintSet,
  type PutConstraintsBody,
} from '../../../shared/constraints.js';
import { constraintInputSchema } from '../../../shared/constraints.js';
import { AppError } from '../errors.js';
import { truncate, uniqueId } from '../stakeholders/names.js';
import { MAX_SET, fingerprintOf, idOfFingerprint, scopeOf, severityOf } from './build.js';
import { IMPACT_IF_VIOLATED } from './lexicon.js';

/** What a person may name in a constraint: the actors, the scenarios and the assumptions there are. */
export interface ReviewWorld {
  actorIds: ReadonlySet<string>;
  alternativeIds: ReadonlySet<string>;
  assumptionIds: ReadonlySet<string>;
}

const refuse = (status: number, code: string, message: string): AppError =>
  new AppError(status, code, message);

const notFound = (what: string): AppError =>
  refuse(404, 'CONSTRAINT_NOT_FOUND', `There is no ${what} with that id in this project.`);

function checkReferences(
  input: Pick<
    ConstraintInput,
    'affectedActorIds' | 'affectedAlternativeIds' | 'assumptionId' | 'effects'
  >,
  world: ReviewWorld,
): void {
  for (const id of input.affectedActorIds ?? []) {
    if (!world.actorIds.has(id)) {
      throw refuse(
        400,
        'CONSTRAINT_ACTOR_UNKNOWN',
        'A constraint can only be about actors that are in the cast. Make the actors first, or leave the actors out.',
      );
    }
  }
  for (const id of input.affectedAlternativeIds ?? []) {
    if (!world.alternativeIds.has(id)) {
      throw refuse(
        400,
        'CONSTRAINT_ALTERNATIVE_UNKNOWN',
        'A constraint can only be about the alternatives of the scenario.',
      );
    }
  }
  if (input.assumptionId && !world.assumptionIds.has(input.assumptionId)) {
    throw refuse(
      400,
      'CONSTRAINT_ASSUMPTION_UNKNOWN',
      'That assumption is not one of the scenario’s.',
    );
  }
  for (const effect of input.effects ?? []) {
    const named =
      effect.kind === 'require-approval'
        ? [effect.approverActorId]
        : effect.kind === 'force-sequencing'
          ? effect.beforeActorIds
          : [];
    if (named.some((id) => !world.actorIds.has(id))) {
      throw refuse(
        400,
        'CONSTRAINT_EFFECT_INVALID',
        'An effect can only name actors that are in the cast.',
      );
    }
  }
}

const indexOf = (set: ConstraintSet, id: string): number => {
  const at = set.constraints.findIndex((constraint) => constraint.id === id);
  if (at < 0) throw notFound('constraint');
  return at;
};

const replaceAt = (set: ConstraintSet, at: number, next: Constraint): ConstraintSet => ({
  ...set,
  constraints: set.constraints.map((constraint, index) => (index === at ? next : constraint)),
});

/** Where a person's own constraint stands in what the page says of it: you said it, and how sure you are. */
function uncertaintyOfPerson(
  validation: 'confirmed' | 'assumed' | 'unknown',
): Constraint['uncertainty'] {
  if (validation === 'confirmed') return { level: 'low', reason: 'You stated it.' };
  if (validation === 'assumed')
    return { level: 'medium', reason: 'You chose to assume it, not to check it.' };
  return { level: 'high', reason: 'You marked it unknown.' };
}

/** A constraint the person wrote. It is theirs: nothing about where it came from is theirs to claim for a source. */
export function constraintOfPerson(
  input: ConstraintInput,
  world: ReviewWorld,
  used: Set<string>,
): Constraint {
  const parsed = constraintInputSchema.parse(input);
  checkReferences(parsed, world);
  const statement = truncate(parsed.statement, 400);
  const id = uniqueId(idOfFingerprint(fingerprintOf(parsed.category, statement)), used);
  return {
    id,
    category: parsed.category,
    statement,
    source: 'user',
    evidenceRefs: [],
    hardness: parsed.hardness,
    hardnessBasis: `You set it to ${parsed.hardness}.`,
    scope:
      parsed.scope === 'decision'
        ? scopeOf(parsed.category, parsed.affectedActorIds, parsed.affectedAlternativeIds)
        : parsed.scope,
    affectedActorIds: [...new Set(parsed.affectedActorIds)],
    affectedAlternativeIds: [...new Set(parsed.affectedAlternativeIds)],
    window: parsed.window,
    severity: parsed.severity ?? severityOf(parsed.category, parsed.hardness),
    confidenceBasis: { kind: 'user-entry', note: 'You wrote it.' },
    uncertainty: uncertaintyOfPerson(parsed.validation),
    validation: parsed.validation,
    conflict: [],
    impactIfViolated: parsed.impactIfViolated || IMPACT_IF_VIOLATED[parsed.hardness],
    assumptionId: parsed.assumptionId,
    mitigations: parsed.mitigations,
    enforcement: 'interpretive',
    effects: parsed.effects,
    consideredIn: [],
    review: 'added',
    note: parsed.note,
  };
}

/** The person's changes to a constraint: only what they may change, and it is then theirs, so it reads as edited. */
export function patched(
  constraint: Constraint,
  patch: ConstraintPatch,
  world: ReviewWorld,
): Constraint {
  checkReferences(
    {
      affectedActorIds: patch.affectedActorIds ?? [],
      affectedAlternativeIds: patch.affectedAlternativeIds ?? [],
      assumptionId: patch.assumptionId ?? null,
      effects: patch.effects ?? [],
    },
    world,
  );
  const next: Constraint = { ...constraint };
  if (patch.category !== undefined) next.category = patch.category;
  if (patch.statement !== undefined) {
    next.statement = truncate(patch.statement, 400);
    if (constraint.source !== 'user' && next.statement !== constraint.statement) {
      next.confidenceBasis = {
        ...constraint.confidenceBasis,
        note: truncate(
          `${constraint.confidenceBasis.note} You changed the wording; the quote is the source’s own.`.trim(),
          240,
        ),
      };
    }
  }
  if (patch.hardness !== undefined) {
    if (patch.hardness !== constraint.hardness) {
      next.hardnessBasis = `You set it to ${patch.hardness}; ${constraint.hardness === 'hard' ? 'it was held hard' : 'it was held soft'} before.`;
    }
    next.hardness = patch.hardness;
  }
  if (patch.scope !== undefined) next.scope = patch.scope;
  if (patch.affectedActorIds !== undefined)
    next.affectedActorIds = [...new Set(patch.affectedActorIds)];
  if (patch.affectedAlternativeIds !== undefined) {
    next.affectedAlternativeIds = [...new Set(patch.affectedAlternativeIds)];
  }
  if (patch.window !== undefined) next.window = patch.window;
  if (patch.severity !== undefined) next.severity = patch.severity;
  if (patch.impactIfViolated !== undefined) next.impactIfViolated = patch.impactIfViolated;
  if (patch.assumptionId !== undefined) next.assumptionId = patch.assumptionId;
  if (patch.mitigations !== undefined) next.mitigations = patch.mitigations;
  if (patch.effects !== undefined) next.effects = patch.effects as ConstraintEffect[];
  if (patch.note !== undefined) next.note = patch.note;
  const changed = JSON.stringify(next) !== JSON.stringify(constraint);
  if (changed && (next.review === 'proposed' || next.review === 'accepted')) next.review = 'edited';
  return next;
}

function openQuestion(set: ConstraintSet, id: string): number {
  const at = set.clarifications.findIndex((question) => question.id === id);
  if (at < 0) throw notFound('question');
  return at;
}

const setQuestion = (
  set: ConstraintSet,
  at: number,
  change: Partial<Clarification>,
): ConstraintSet => ({
  ...set,
  clarifications: set.clarifications.map((question, index) =>
    index === at ? { ...question, ...change } : question,
  ),
});

/** What a person who has been through the constraints leaves behind: reviewed, when nothing still waits for a look. */
function reviewedNow(set: ConstraintSet, now: Date): ConstraintSet {
  const waiting = set.constraints.some((constraint) => constraint.review === 'proposed');
  return { ...set, reviewedAt: waiting ? null : (set.reviewedAt ?? now.toISOString()) };
}

const assumptionStatement = (category: ConstraintCategory): string =>
  `Assumed for now: no ${CONSTRAINT_CATEGORY_LABELS[category].toLowerCase()} limit applies to this decision.`;

function added(set: ConstraintSet, constraint: Constraint): ConstraintSet {
  if (set.constraints.length >= MAX_SET) {
    throw refuse(
      409,
      'CONSTRAINTS_FULL',
      `A project holds at most ${MAX_SET} constraints. Remove one first.`,
    );
  }
  const mark = fingerprintOf(constraint.category, constraint.statement);
  if (set.constraints.some((item) => fingerprintOf(item.category, item.statement) === mark)) {
    throw refuse(
      409,
      'CONSTRAINT_EXISTS',
      'That constraint is already in the list. Restore it, or change its words.',
    );
  }
  return { ...set, constraints: [...set.constraints, constraint] };
}

/**
 * One thing a person does with the constraints or the questions, applied to the set. Pure: it returns
 * the new set, or throws a refusal with a sentence the person can act on. Nothing here can make a
 * constraint a source's or a fact: what is `extracted` stays so only by its quote, what is `inferred`
 * stays so, and a person's confirmation is recorded as theirs in `validation`.
 */
export function applyReview(
  set: ConstraintSet,
  action: ConstraintReviewAction,
  world: ReviewWorld,
  now: Date,
): ConstraintSet {
  const used = new Set(set.constraints.map((constraint) => constraint.id));
  switch (action.action) {
    case 'accept': {
      const wanted = new Set(action.ids);
      for (const id of wanted) indexOf(set, id);
      return reviewedNow(
        {
          ...set,
          constraints: set.constraints.map((constraint) =>
            wanted.has(constraint.id) && constraint.review === 'proposed'
              ? { ...constraint, review: 'accepted' }
              : constraint,
          ),
        },
        now,
      );
    }
    case 'confirm': {
      const at = indexOf(set, action.id);
      const constraint = set.constraints[at] as Constraint;
      if (!isLive(constraint) && constraint.review !== 'proposed') {
        throw refuse(
          409,
          'CONSTRAINT_SET_ASIDE',
          'This constraint was set aside. Restore it first.',
        );
      }
      return reviewedNow(
        replaceAt(set, at, {
          ...constraint,
          validation: 'confirmed',
          review: constraint.review === 'proposed' ? 'accepted' : constraint.review,
        }),
        now,
      );
    }
    case 'edit': {
      const at = indexOf(set, action.id);
      return reviewedNow(
        replaceAt(set, at, patched(set.constraints[at] as Constraint, action.patch, world)),
        now,
      );
    }
    case 'add':
      return reviewedNow(added(set, constraintOfPerson(action.constraint, world, used)), now);
    case 'remove': {
      const at = indexOf(set, action.id);
      return reviewedNow(
        replaceAt(set, at, {
          ...(set.constraints[at] as Constraint),
          review: 'removed',
          validation: 'rejected',
        }),
        now,
      );
    }
    case 'restore': {
      const at = indexOf(set, action.id);
      const constraint = set.constraints[at] as Constraint;
      if (constraint.review !== 'removed' && constraint.review !== 'excluded') {
        throw refuse(409, 'CONSTRAINT_NOT_SET_ASIDE', 'This constraint is not set aside.');
      }
      return reviewedNow(
        replaceAt(set, at, {
          ...constraint,
          review: 'accepted',
          validation: constraint.validation === 'rejected' ? 'unvalidated' : constraint.validation,
        }),
        now,
      );
    }
    case 'answer': {
      const at = openQuestion(set, action.clarificationId);
      const question = set.clarifications[at] as Clarification;
      if (question.status !== 'open') {
        throw refuse(409, 'QUESTION_ANSWERED', 'That question has already been dealt with.');
      }
      const constraint = constraintOfPerson(action.constraint, world, used);
      return reviewedNow(
        setQuestion(added(set, constraint), at, {
          status: 'answered',
          answer: truncate(constraint.statement, 400),
          constraintId: constraint.id,
        }),
        now,
      );
    }
    case 'exclude':
    case 'mark-unknown':
    case 'use-assumption': {
      if ((action.id === undefined) === (action.clarificationId === undefined)) {
        throw refuse(
          400,
          'INVALID_INPUT',
          'Name either a constraint or a question, not both and not neither.',
        );
      }
      if (action.id !== undefined) {
        const at = indexOf(set, action.id);
        const constraint = set.constraints[at] as Constraint;
        const wasProposed = constraint.review === 'proposed';
        if (action.action === 'exclude') {
          return reviewedNow(replaceAt(set, at, { ...constraint, review: 'excluded' }), now);
        }
        const next: Constraint =
          action.action === 'mark-unknown'
            ? {
                ...constraint,
                validation: 'unknown',
                review: wasProposed ? 'accepted' : constraint.review,
              }
            : {
                ...constraint,
                validation: 'assumed',
                review: wasProposed ? 'accepted' : constraint.review,
                note:
                  action.action === 'use-assumption' && action.note ? action.note : constraint.note,
              };
        return reviewedNow(replaceAt(set, at, next), now);
      }
      const at = openQuestion(set, action.clarificationId as string);
      const question = set.clarifications[at] as Clarification;
      if (question.status !== 'open') {
        throw refuse(409, 'QUESTION_ANSWERED', 'That question has already been dealt with.');
      }
      if (action.action === 'exclude') {
        return reviewedNow(setQuestion(set, at, { status: 'excluded' }), now);
      }
      if (action.action === 'mark-unknown') {
        return reviewedNow(setQuestion(set, at, { status: 'unknown' }), now);
      }
      // An assumption is written down as a constraint, so that it shows wherever the constraints do.
      const statement = action.note?.trim() ? action.note : assumptionStatement(question.category);
      const constraint = constraintOfPerson(
        {
          category: question.category,
          statement,
          validation: 'assumed',
          note: `In answer to: ${truncate(question.question, 200)}`,
        },
        world,
        used,
      );
      return reviewedNow(
        setQuestion(added(set, constraint), at, {
          status: 'assumed',
          answer: truncate(statement, 400),
          constraintId: constraint.id,
        }),
        now,
      );
    }
    case 'confirm-set': {
      const waiting = set.constraints.filter(
        (constraint) => constraint.review === 'proposed',
      ).length;
      if (waiting > 0) {
        throw refuse(
          409,
          'CONSTRAINTS_PENDING',
          `${waiting} ${waiting === 1 ? 'constraint is' : 'constraints are'} still waiting for your decision. Accept, change or set aside each one first.`,
        );
      }
      return { ...set, reviewedAt: now.toISOString() };
    }
  }
}

/**
 * Every constraint as the person now wants it. A constraint they left out is refused, not dropped: set
 * it aside instead, so that what became of it can be told. One with an id is changed as an edit is;
 * one without is the person's own and is added.
 */
export function applyPut(
  set: ConstraintSet,
  input: PutConstraintsBody,
  world: ReviewWorld,
  now: Date,
): ConstraintSet {
  const incoming = input.constraints;
  const kept = new Set(incoming.flatMap((item) => (item.id ? [item.id] : [])));
  const left = set.constraints.filter((constraint) => !kept.has(constraint.id));
  if (left.length > 0) {
    throw refuse(
      400,
      'CONSTRAINTS_OMITTED',
      'Every constraint has to be in the list. To drop one, remove it, so that what became of it can be told.',
    );
  }
  let next = set;
  const used = new Set(set.constraints.map((constraint) => constraint.id));
  for (const item of incoming) {
    const { id, validation, ...rest } = item;
    if (id === undefined) {
      const said = validation === 'assumed' || validation === 'unknown' ? validation : 'confirmed';
      next = added(next, constraintOfPerson({ ...rest, validation: said }, world, used));
      continue;
    }
    const at = indexOf(next, id);
    const constraint = next.constraints[at] as Constraint;
    const edited = patched(
      constraint,
      {
        category: rest.category,
        statement: rest.statement,
        hardness: rest.hardness,
        scope: rest.scope,
        affectedActorIds: rest.affectedActorIds,
        affectedAlternativeIds: rest.affectedAlternativeIds,
        window: rest.window ?? OPEN_WINDOW,
        severity: rest.severity,
        impactIfViolated: rest.impactIfViolated,
        assumptionId: rest.assumptionId,
        mitigations: rest.mitigations,
        effects: rest.effects,
        note: rest.note,
      },
      world,
    );
    next = replaceAt(next, at, validation ? { ...edited, validation } : edited);
  }
  return reviewedNow(next, now);
}
