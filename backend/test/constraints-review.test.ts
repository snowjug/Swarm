import { describe, expect, it } from 'vitest';
import {
  MAX_CONSTRAINTS,
  constraintReviewSchema,
  putConstraintsSchema,
  type ConstraintSet,
} from '../../shared/constraints.js';
import { AppError } from '../src/errors.js';
import { applyPut, applyReview } from '../src/constraints/review.js';
import {
  NOW,
  constraintOf,
  evidenceOf,
  reviewWorld,
  setOf,
} from './support/constraint-fixtures.js';

const act = (set: ConstraintSet, action: Record<string, unknown>, world = reviewWorld()) =>
  applyReview(set, constraintReviewSchema.parse({ expectedRevision: 1, ...action }), world, NOW);

const refusal = (work: () => unknown): AppError => {
  try {
    work();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('Expected a refusal.');
};

const waiting = (id: string, statement: string) =>
  constraintOf({
    id,
    statement,
    review: 'proposed',
    validation: 'unvalidated',
    source: 'inferred',
  });

const quoted = constraintOf({
  id: 'c-quoted',
  statement: 'The vendor contract requires ninety days of notice.',
  category: 'contractual',
  source: 'extracted',
  hardness: 'hard',
  validation: 'unvalidated',
  review: 'proposed',
  evidenceRefs: [evidenceOf('requires ninety days of notice')],
});

const question = (id: string, category: 'privacy' | 'time' = 'privacy') => ({
  id,
  category,
  question: 'Does the change touch personal data?',
  why: 'Rules on personal data can limit what may be kept.',
  status: 'open' as const,
  answer: null,
  constraintId: null,
});

describe('what a person does with the constraints', () => {
  it('accepts what waits for a first look, leaves validation to the person, and is reviewed when nothing waits', () => {
    const set = setOf([waiting('c-a', 'Budget is tight.'), waiting('c-b', 'Time is short.')], {
      reviewedAt: null,
    });
    const half = act(set, { action: 'accept', ids: ['c-a'] });
    expect(half.constraints.map((item) => [item.review, item.validation])).toEqual([
      ['accepted', 'unvalidated'],
      ['proposed', 'unvalidated'],
    ]);
    expect(half.reviewedAt).toBeNull();
    const all = act(set, { action: 'accept', ids: ['c-a', 'c-b'] });
    expect(all.reviewedAt).toBe(NOW.toISOString());
    expect(all.constraints.every((item) => item.validation === 'unvalidated')).toBe(true);
    expect(refusal(() => act(set, { action: 'accept', ids: ['c-zzz'] }))).toMatchObject({
      statusCode: 404,
      code: 'CONSTRAINT_NOT_FOUND',
    });
  });

  it('records a confirmation as the person’s own, and never changes where a constraint came from', () => {
    const set = setOf([quoted], { reviewedAt: null });
    const confirmed = act(set, { action: 'confirm', id: 'c-quoted' }).constraints[0];
    expect(confirmed).toMatchObject({
      validation: 'confirmed',
      review: 'accepted',
      source: 'extracted',
      hardness: 'hard',
    });
    expect(confirmed?.evidenceRefs).toEqual(quoted.evidenceRefs);
    const aside = setOf([constraintOf({ review: 'removed', validation: 'rejected' })]);
    expect(refusal(() => act(aside, { action: 'confirm', id: 'c-0001' })).code).toBe(
      'CONSTRAINT_SET_ASIDE',
    );
  });

  it('lets the wording and the scope change, keeps the source’s quote as the source’s, and reads as edited', () => {
    const set = setOf([quoted], { reviewedAt: null });
    const edited = act(set, {
      action: 'edit',
      id: 'c-quoted',
      patch: {
        statement: 'The vendor contract asks for ninety days of notice before any change.',
        affectedActorIds: ['resellers'],
      },
    }).constraints[0];
    expect(edited).toMatchObject({
      review: 'edited',
      source: 'extracted',
      validation: 'unvalidated',
    });
    expect(edited?.evidenceRefs).toEqual(quoted.evidenceRefs);
    expect(edited?.confidenceBasis.note).toMatch(/the quote is the source’s own/u);
    expect(edited?.affectedActorIds).toEqual(['resellers']);
    // The patch has no field for where it came from, and a client that sends one is refused.
    for (const patch of [{ source: 'user' }, { evidenceRefs: [] }, { validation: 'confirmed' }]) {
      expect(
        constraintReviewSchema.safeParse({
          action: 'edit',
          id: 'c-quoted',
          patch,
          expectedRevision: 1,
        }).success,
      ).toBe(false);
    }
  });

  it('refuses a change that names an actor, a scenario or an assumption the project does not have', () => {
    const set = setOf([constraintOf()]);
    const edit = (patch: Record<string, unknown>) => () =>
      act(set, { action: 'edit', id: 'c-0001', patch });
    expect(refusal(edit({ affectedActorIds: ['ghost'] }))).toMatchObject({
      statusCode: 400,
      code: 'CONSTRAINT_ACTOR_UNKNOWN',
    });
    expect(refusal(edit({ affectedAlternativeIds: ['ghost'] })).code).toBe(
      'CONSTRAINT_ALTERNATIVE_UNKNOWN',
    );
    expect(refusal(edit({ assumptionId: 'ghost' })).code).toBe('CONSTRAINT_ASSUMPTION_UNKNOWN');
    expect(
      refusal(
        edit({ effects: [{ kind: 'require-approval', approverActorId: 'ghost', threshold: 0 }] }),
      ).code,
    ).toBe('CONSTRAINT_EFFECT_INVALID');
    expect(
      refusal(
        edit({ effects: [{ kind: 'force-sequencing', beforeActorIds: ['ghost'], gapRounds: 2 }] }),
      ).code,
    ).toBe('CONSTRAINT_EFFECT_INVALID');
  });

  it('adds a constraint of the person’s own: theirs, with no evidence, whatever the request says', () => {
    const set = setOf([], { reviewedAt: null });
    const added = act(set, {
      action: 'add',
      constraint: {
        category: 'staffing',
        statement: 'Two people cover the desk at night.',
        hardness: 'hard',
      },
    });
    expect(added.constraints[0]).toMatchObject({
      source: 'user',
      review: 'added',
      validation: 'confirmed',
      evidenceRefs: [],
      hardness: 'hard',
      enforcement: 'interpretive',
      confidenceBasis: { kind: 'user-entry' },
    });
    expect(added.reviewedAt).toBe(NOW.toISOString());
    for (const forged of [
      { source: 'extracted' },
      { evidenceRefs: [evidenceOf('x')] },
      { enforcement: 'enforced' },
      { conflict: ['conflicts-with:c-1'] },
      { review: 'accepted' },
      { consideredIn: ['critic'] },
    ]) {
      expect(
        constraintReviewSchema.safeParse({
          action: 'add',
          constraint: { category: 'staffing', statement: 'Two people.', ...forged },
          expectedRevision: 1,
        }).success,
        JSON.stringify(forged),
      ).toBe(false);
    }
    // The same words twice, and more than the project may hold, are refused with a way forward.
    expect(
      refusal(() =>
        act(added, {
          action: 'add',
          constraint: { category: 'staffing', statement: 'Two people cover the desk at night.' },
        }),
      ),
    ).toMatchObject({ statusCode: 409, code: 'CONSTRAINT_EXISTS' });
    const full = setOf(
      Array.from({ length: MAX_CONSTRAINTS }, (_, at) =>
        constraintOf({ id: `c-${at}`, statement: `Constraint number ${at}.` }),
      ),
    );
    expect(
      refusal(() =>
        act(full, { action: 'add', constraint: { category: 'time', statement: 'One too many.' } }),
      ).code,
    ).toBe('CONSTRAINTS_FULL');
  });

  it('sets aside by removing or excluding, and puts back what was set aside, and nothing else', () => {
    const set = setOf([
      constraintOf({ id: 'c-a' }),
      constraintOf({ id: 'c-b', statement: 'Other.' }),
    ]);
    const removed = act(set, { action: 'remove', id: 'c-a' });
    expect(removed.constraints[0]).toMatchObject({ review: 'removed', validation: 'rejected' });
    expect(act(removed, { action: 'restore', id: 'c-a' }).constraints[0]).toMatchObject({
      review: 'accepted',
      validation: 'unvalidated',
    });
    const excluded = act(set, { action: 'exclude', id: 'c-b' });
    expect(excluded.constraints[1]).toMatchObject({ review: 'excluded', validation: 'confirmed' });
    expect(act(excluded, { action: 'restore', id: 'c-b' }).constraints[1]?.review).toBe('accepted');
    expect(refusal(() => act(set, { action: 'restore', id: 'c-a' })).code).toBe(
      'CONSTRAINT_NOT_SET_ASIDE',
    );
  });

  it('marks a constraint unknown, or assumed, and a person’s note goes with the assumption', () => {
    const set = setOf([waiting('c-a', 'Budget is tight.')], { reviewedAt: null });
    expect(act(set, { action: 'mark-unknown', id: 'c-a' }).constraints[0]).toMatchObject({
      validation: 'unknown',
      review: 'accepted',
    });
    expect(
      act(set, { action: 'use-assumption', id: 'c-a', note: 'Assumed until finance replies.' })
        .constraints[0],
    ).toMatchObject({
      validation: 'assumed',
      review: 'accepted',
      note: 'Assumed until finance replies.',
    });
  });
});

describe('answering what Swarm asked', () => {
  const asked = setOf([], { clarifications: [question('q-privacy'), question('q-time', 'time')] });

  it('turns an answer into a constraint of the person’s own that remembers which question it answered', () => {
    const next = act(asked, {
      action: 'answer',
      clarificationId: 'q-privacy',
      constraint: {
        category: 'privacy',
        statement: 'Transcripts may not leave the region.',
        hardness: 'hard',
      },
    });
    const [answered, other] = next.clarifications;
    const [constraint] = next.constraints;
    expect(answered).toMatchObject({
      status: 'answered',
      constraintId: constraint?.id,
      answer: 'Transcripts may not leave the region.',
    });
    expect(other?.status).toBe('open');
    expect(constraint).toMatchObject({ source: 'user', review: 'added', evidenceRefs: [] });
    expect(
      refusal(() =>
        act(next, {
          action: 'answer',
          clarificationId: 'q-privacy',
          constraint: { category: 'privacy', statement: 'Again, in other words.' },
        }),
      ),
    ).toMatchObject({ statusCode: 409, code: 'QUESTION_ANSWERED' });
    expect(
      refusal(() =>
        act(asked, {
          action: 'answer',
          clarificationId: 'q-ghost',
          constraint: { category: 'privacy', statement: 'Nobody asked.' },
        }),
      ).code,
    ).toBe('CONSTRAINT_NOT_FOUND');
  });

  it('lets a person leave a question unknown or turn it away, and records neither as a constraint', () => {
    const unknown = act(asked, { action: 'mark-unknown', clarificationId: 'q-privacy' });
    expect(unknown.clarifications[0]?.status).toBe('unknown');
    const turned = act(asked, { action: 'exclude', clarificationId: 'q-time' });
    expect(turned.clarifications[1]?.status).toBe('excluded');
    expect(unknown.constraints).toEqual([]);
    expect(turned.constraints).toEqual([]);
  });

  it('writes an assumption down as a constraint, labelled assumed, so that it shows wherever constraints do', () => {
    const plain = act(asked, { action: 'use-assumption', clarificationId: 'q-time' });
    const [constraint] = plain.constraints;
    expect(constraint).toMatchObject({
      category: 'time',
      source: 'user',
      validation: 'assumed',
      review: 'added',
    });
    expect(constraint?.statement).toMatch(/^Assumed for now: no time limit applies/u);
    expect(plain.clarifications[1]).toMatchObject({
      status: 'assumed',
      constraintId: constraint?.id,
    });
    const noted = act(asked, {
      action: 'use-assumption',
      clarificationId: 'q-time',
      note: 'Assume launch is in the spring.',
    });
    expect(noted.constraints[0]?.statement).toBe('Assume launch is in the spring.');
  });

  it('wants one thing to act on, a constraint or a question, not both and not neither', () => {
    for (const action of ['exclude', 'mark-unknown', 'use-assumption']) {
      expect(refusal(() => act(asked, { action })).code).toBe('INVALID_INPUT');
      expect(refusal(() => act(asked, { action, id: 'c-a', clarificationId: 'q-time' })).code).toBe(
        'INVALID_INPUT',
      );
    }
  });
});

describe('confirming the set, and putting it all at once', () => {
  it('confirms a review only when nothing waits for a decision', () => {
    const set = setOf([waiting('c-a', 'Budget is tight.')], { reviewedAt: null });
    expect(refusal(() => act(set, { action: 'confirm-set' }))).toMatchObject({
      statusCode: 409,
      code: 'CONSTRAINTS_PENDING',
    });
    const done = act(act(set, { action: 'accept', ids: ['c-a'] }), { action: 'confirm-set' });
    expect(done.reviewedAt).toBe(NOW.toISOString());
  });

  it('is not reviewed after a new constraint is proposed, until a person has been through it again', () => {
    const reviewed = setOf([constraintOf()]);
    expect(reviewed.reviewedAt).not.toBeNull();
    const more = { ...reviewed, constraints: [...reviewed.constraints, waiting('c-n', 'New.')] };
    expect(act(more, { action: 'remove', id: 'c-n' }).reviewedAt).toBe(reviewed.reviewedAt);
    expect(
      act({ ...more, reviewedAt: null }, { action: 'edit', id: 'c-0001', patch: { note: 'x' } })
        .reviewedAt,
    ).toBeNull();
  });

  const put = (set: ConstraintSet, body: Record<string, unknown>) =>
    applyPut(set, putConstraintsSchema.parse({ expectedRevision: 1, ...body }), reviewWorld(), NOW);

  it('refuses a list that leaves a constraint out, so that what became of it can be told', () => {
    const set = setOf([
      constraintOf({ id: 'c-a' }),
      constraintOf({ id: 'c-b', statement: 'Other.' }),
    ]);
    expect(
      refusal(() =>
        put(set, {
          constraints: [{ id: 'c-a', category: 'budget', statement: 'Spending is capped.' }],
        }),
      ),
    ).toMatchObject({ statusCode: 400, code: 'CONSTRAINTS_OMITTED' });
  });

  it('changes what it names, adds what has no id as the person’s own, and keeps the quote of a source', () => {
    const set = setOf([quoted, constraintOf({ id: 'c-b', statement: 'Other.' })], {
      reviewedAt: null,
    });
    const next = put(set, {
      constraints: [
        {
          id: 'c-quoted',
          category: 'contractual',
          statement: 'The vendor needs ninety days of notice.',
          hardness: 'soft',
          validation: 'confirmed',
        },
        { id: 'c-b', category: 'budget', statement: 'Other.' },
        {
          category: 'time',
          statement: 'The decision is due in the spring.',
          validation: 'assumed',
        },
      ],
    });
    const [first, second, third] = next.constraints;
    expect(first).toMatchObject({
      source: 'extracted',
      hardness: 'soft',
      validation: 'confirmed',
      review: 'edited',
    });
    expect(first?.evidenceRefs).toEqual(quoted.evidenceRefs);
    expect(second?.id).toBe('c-b');
    expect(third).toMatchObject({
      source: 'user',
      review: 'added',
      validation: 'assumed',
      evidenceRefs: [],
    });
    // A new constraint with no word on whether it holds is confirmed, because the person wrote it.
    expect(
      put(setOf([]), {
        constraints: [{ category: 'time', statement: 'The decision is due soon.' }],
      }).constraints[0]?.validation,
    ).toBe('confirmed');
    expect(
      refusal(() =>
        put(set, {
          constraints: [
            { id: 'c-quoted', category: 'contractual', statement: 'Kept.' },
            { id: 'c-b', category: 'budget', statement: 'Other.' },
            { id: 'c-zzz', category: 'time', statement: 'Nobody has this.' },
          ],
        }),
      ).code,
    ).toBe('CONSTRAINT_NOT_FOUND');
  });

  it('holds no more than the project may', () => {
    const body = {
      constraints: Array.from({ length: MAX_CONSTRAINTS + 1 }, (_, at) => ({
        category: 'time',
        statement: `Constraint number ${at}.`,
      })),
    };
    expect(putConstraintsSchema.safeParse({ ...body, expectedRevision: 0 }).success).toBe(false);
  });
});
