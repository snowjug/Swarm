import { describe, expect, it } from 'vitest';
import { claimsAgainst } from '../../e2e/support/claims.js';
import { MAX_ROUNDS, analysisSchema, simulationSpecSchema } from '../../shared/analysis.js';
import { artifactSchemas, isArtifactKind } from '../../shared/artifacts.js';
import {
  CONFIDENCE_BASES,
  CONFIDENCE_BASIS_WORDS,
  CONSTRAINT_CATEGORIES,
  CONSTRAINT_CATEGORY_LABELS,
  CONSTRAINT_REVIEWS,
  CONSTRAINT_SCHEMA_VERSION,
  EFFECT_CATALOGUE,
  EFFECT_MAX_ROUND,
  ENFORCED_EFFECT_KINDS,
  CONSTRAINT_EFFECT_KINDS,
  GATE_STATUS_WORDS,
  MAX_OPEN_QUESTIONS,
  NOT_APPLIED_WORDS,
  appliedConstraintSchema,
  clarificationSchema,
  constraintBasisOf,
  constraintEffectSchema,
  constraintInputSchema,
  constraintPatchSchema,
  constraintReviewSchema,
  constraintSchema,
  constraintSetSchema,
  effectPhrase,
  isAppliedConstraint,
  isLive,
  missingConstraintsSentence,
  openQuestions,
  provisionalLabel,
  putConstraintsSchema,
  sourceLabel,
  type Constraint,
  type ConstraintSet,
} from '../../shared/constraints.js';
import { analysisFixture } from '../../shared/lab-fixtures.js';
import { lintText } from '../src/brief/lint.js';
import { actor, key, spec } from './support/simulation-cast.js';

const NOW = '2026-03-01T09:00:00.000Z';

/** The least a constraint needs: everything else has a default, so a stored document stays readable as fields are added. */
const minimal = {
  id: 'c-0001',
  category: 'budget',
  statement: 'Spending on the change is capped.',
  source: 'user',
  hardness: 'hard',
  confidenceBasis: { kind: 'user-entry' },
  uncertainty: { level: 'low', reason: 'You stated it.' },
};

const constraintOf = (overrides: Partial<Constraint> = {}): Constraint =>
  constraintSchema.parse({ ...minimal, ...overrides });

const setOf = (constraints: Constraint[] = []): ConstraintSet =>
  constraintSetSchema.parse({
    version: CONSTRAINT_SCHEMA_VERSION,
    constraints,
    generatedAt: NOW,
    mode: 'rules',
    scenarioRevision: 1,
    actorsRevision: 1,
  });

describe('the constraint contract', () => {
  it('names the twenty-eight categories, each with a label, and every kind of effect with what the engine does', () => {
    expect(CONSTRAINT_CATEGORIES).toHaveLength(28);
    expect(new Set(CONSTRAINT_CATEGORIES).size).toBe(28);
    for (const category of CONSTRAINT_CATEGORIES) {
      expect(CONSTRAINT_CATEGORY_LABELS[category], category).toMatch(/^[A-Z]/u);
    }
    expect(Object.keys(EFFECT_CATALOGUE).sort()).toEqual([...CONSTRAINT_EFFECT_KINDS].sort());
    for (const kind of CONSTRAINT_EFFECT_KINDS) {
      const entry = EFFECT_CATALOGUE[kind];
      expect(entry.enforced, kind).toBe(
        (ENFORCED_EFFECT_KINDS as readonly string[]).includes(kind),
      );
      expect(entry.engine.length, kind).toBeGreaterThan(40);
    }
    // The one thing the engine does not do is said, not left out.
    expect(EFFECT_CATALOGUE.branch.enforced).toBe(false);
    expect(EFFECT_CATALOGUE.branch.engine).toMatch(/^Not applied/u);
  });

  it('keeps the largest round of an effect in step with the engine', () => {
    expect(EFFECT_MAX_ROUND).toBe(MAX_ROUNDS);
  });

  it('reads a constraint written with only what it needs, and fills in the rest the way that keeps it cautious', () => {
    const constraint = constraintOf();
    expect(constraint).toMatchObject({
      validation: 'unvalidated',
      review: 'proposed',
      enforcement: 'interpretive',
      scope: 'decision',
      severity: 'medium',
      effects: [],
      conflict: [],
      evidenceRefs: [],
      assumptionId: null,
      window: { fromRound: null, toRound: null, text: '' },
    });
  });

  it('holds every field to a bound', () => {
    const bad = (overrides: Record<string, unknown>) =>
      constraintSchema.safeParse({ ...minimal, ...overrides }).success;
    expect(bad({})).toBe(true);
    expect(bad({ category: 'weather' })).toBe(false);
    expect(bad({ statement: '' })).toBe(false);
    expect(bad({ statement: 'x'.repeat(401) })).toBe(false);
    expect(bad({ id: 'Not A Slug' })).toBe(false);
    expect(bad({ hardness: 'firm' })).toBe(false);
    expect(bad({ source: 'model' })).toBe(false);
    expect(bad({ validation: 'verified' })).toBe(false);
    expect(bad({ affectedAlternativeIds: Array.from({ length: 9 }, (_, i) => `a-${i}`) })).toBe(
      false,
    );
    expect(bad({ mitigations: Array.from({ length: 6 }, () => 'Ask first.') })).toBe(false);
    expect(bad({ conflict: ['conflicts-with:c-0002'] })).toBe(true);
    expect(bad({ conflict: ['clashes-with:c-0002'] })).toBe(false);
    expect(bad({ window: { fromRound: 5, toRound: 3 } })).toBe(false);
    expect(bad({ window: { fromRound: 0 } })).toBe(false);
    expect(bad({ window: { fromRound: 37 } })).toBe(false);
    expect(bad({ review: 'approved' })).toBe(false);
    expect(bad({ consideredIn: ['somewhere'] })).toBe(false);
  });

  it('holds every effect to the range its engine reads', () => {
    const good = (effect: unknown) => constraintEffectSchema.safeParse(effect).success;
    expect(good({ kind: 'block' })).toBe(true);
    expect(good({ kind: 'delay', rounds: 3 })).toBe(true);
    expect(good({ kind: 'delay', rounds: 0 })).toBe(false);
    expect(good({ kind: 'delay', rounds: 37 })).toBe(false);
    expect(good({ kind: 'limit-actions', forbid: ['switch'] })).toBe(true);
    expect(good({ kind: 'limit-actions', forbid: [] })).toBe(false);
    expect(good({ kind: 'limit-actions', forbid: ['wait'] })).toBe(false);
    expect(good({ kind: 'reduce-influence', amount: 0.04 })).toBe(false);
    expect(good({ kind: 'reduce-influence', amount: 0.5 })).toBe(true);
    expect(good({ kind: 'add-cost', target: 'switching', amount: 0.3 })).toBe(true);
    expect(good({ kind: 'add-cost', target: 'price', amount: 0.3 })).toBe(false);
    expect(good({ kind: 'add-risk', amount: 1.1 })).toBe(false);
    expect(good({ kind: 'require-approval', approverActorId: 'regulator', threshold: 0.1 })).toBe(
      true,
    );
    expect(good({ kind: 'require-approval', approverActorId: 'Regulator', threshold: 0.1 })).toBe(
      false,
    );
    expect(good({ kind: 'force-sequencing', beforeActorIds: [], gapRounds: 2 })).toBe(false);
    // `branch` is a kind the engine does not apply, so it cannot be given as an effect to apply.
    expect(good({ kind: 'branch' })).toBe(false);
  });

  it('refuses a window that ends before it starts, in an applied constraint too', () => {
    expect(
      appliedConstraintSchema.safeParse({
        id: 'c-0001',
        effect: { kind: 'block' },
        fromRound: 4,
        toRound: 2,
      }).success,
    ).toBe(false);
    expect(
      appliedConstraintSchema.parse({ id: 'c-0001', effect: { kind: 'block' } }),
    ).toMatchObject({ actorIds: [], fromRound: null, toRound: null });
  });

  it('is a document of the artifact store, under its own kinds, and one that is not this version is refused', () => {
    expect(isArtifactKind('constraints')).toBe(true);
    expect(isArtifactKind('constraint-counterfactuals')).toBe(true);
    const set = setOf([constraintOf()]);
    expect(artifactSchemas.constraints.parse(set)).toEqual(set);
    expect(constraintSetSchema.safeParse({ ...set, version: 2 }).success).toBe(false);
    // A set saved before a field existed is still read: the new field takes its default.
    const older: Record<string, unknown> = { ...set };
    delete older.reviewedAt;
    expect(constraintSetSchema.parse(older).reviewedAt).toBeNull();
  });

  it('takes a person’s words strictly: nothing that says where a constraint came from can be sent', () => {
    expect(
      constraintInputSchema.safeParse({ category: 'time', statement: 'Nothing before the review.' })
        .success,
    ).toBe(true);
    for (const extra of [
      { source: 'extracted' },
      { evidenceRefs: [] },
      { enforcement: 'enforced' },
      { review: 'accepted' },
      { conflict: [] },
    ]) {
      expect(
        constraintInputSchema.safeParse({
          category: 'time',
          statement: 'Nothing before the review.',
          ...extra,
        }).success,
        JSON.stringify(extra),
      ).toBe(false);
      expect(constraintPatchSchema.safeParse(extra).success, JSON.stringify(extra)).toBe(false);
    }
    expect(
      constraintInputSchema.parse({ category: 'time', statement: 'Nothing before the review.' }),
    ).toMatchObject({ hardness: 'soft', validation: 'confirmed', effects: [] });
    expect(
      putConstraintsSchema.safeParse({
        constraints: [{ category: 'time', statement: 'Nothing before the review.', source: 'x' }],
        expectedRevision: 0,
      }).success,
    ).toBe(false);
    expect(constraintPatchSchema.parse({ hardness: 'hard' })).toEqual({ hardness: 'hard' });
  });

  it('knows each review action and refuses an unknown one or an extra field', () => {
    const parse = (value: unknown) => constraintReviewSchema.safeParse(value).success;
    expect(parse({ action: 'accept', ids: ['c-0001'], expectedRevision: 1 })).toBe(true);
    expect(parse({ action: 'accept', ids: [], expectedRevision: 1 })).toBe(false);
    expect(
      parse({ action: 'mark-unknown', clarificationId: 'q-budget', expectedRevision: 1 }),
    ).toBe(true);
    expect(
      parse({ action: 'use-assumption', id: 'c-0001', note: 'Yes.', expectedRevision: 1 }),
    ).toBe(true);
    expect(parse({ action: 'confirm-set', expectedRevision: 2 })).toBe(true);
    expect(parse({ action: 'approve', expectedRevision: 2 })).toBe(false);
    expect(parse({ action: 'remove', id: 'c-0001' })).toBe(false);
    expect(parse({ action: 'remove', id: 'c-0001', expectedRevision: 1, extra: true })).toBe(false);
    expect(CONSTRAINT_REVIEWS).toContain('excluded');
  });

  it('adds nothing to a spec or a comparison that has no constraints', () => {
    expect(Object.keys(analysisSchema.parse(analysisFixture()))).not.toContain('constraints');
    const input = spec([actor('a', 'cost-bearer'), key('b', 'regulator')]);
    expect(Object.keys(simulationSpecSchema.parse(input))).not.toContain('constraints');
  });
});

describe('what a stage reads of the constraints', () => {
  it('applies a constraint only once a person has looked at it, and never an unknown or one set aside', () => {
    const states: [Partial<Constraint>, boolean, boolean][] = [
      [{ review: 'proposed' }, true, false],
      [{ review: 'accepted' }, true, true],
      [{ review: 'edited' }, true, true],
      [{ review: 'added' }, true, true],
      [{ review: 'accepted', validation: 'confirmed' }, true, true],
      [{ review: 'accepted', validation: 'assumed' }, true, true],
      [{ review: 'accepted', validation: 'unknown' }, true, false],
      [{ review: 'accepted', validation: 'rejected' }, false, false],
      [{ review: 'removed' }, false, false],
      [{ review: 'excluded' }, false, false],
    ];
    for (const [state, live, applied] of states) {
      const constraint = constraintOf(state);
      expect(isLive(constraint), JSON.stringify(state)).toBe(live);
      expect(isAppliedConstraint(constraint), JSON.stringify(state)).toBe(applied);
    }
  });

  it('puts at most three questions to a person at once, in the order they were found, and says what was found', () => {
    const questions = ['a', 'b', 'c', 'd', 'e'].map((letter, at) =>
      clarificationSchema.parse({
        id: `q-${letter}`,
        category: CONSTRAINT_CATEGORIES[at]!,
        question: `Is there a limit ${letter}?`,
        why: 'It could change which scenario comes out ahead.',
        status: letter === 'a' ? 'answered' : 'open',
      }),
    );
    const open = openQuestions({ clarifications: questions });
    expect(open.map((question) => question.id)).toEqual(['q-b', 'q-c', 'q-d']);
    expect(open.length).toBeLessThanOrEqual(MAX_OPEN_QUESTIONS);
    expect(missingConstraintsSentence(3)).toBe(
      'We found three missing constraints that could materially change the outcome.',
    );
    expect(missingConstraintsSentence(1)).toBe(
      'We found one missing constraint that could materially change the outcome.',
    );
    expect(missingConstraintsSentence(9)).toMatch(/^We found three missing constraints/u);
    expect(missingConstraintsSentence(0)).toMatch(/^Nothing is missing/u);
  });

  it('labels where a constraint came from by whose words they are', () => {
    expect(sourceLabel(constraintOf({ source: 'user' }))).toBe('You');
    expect(
      sourceLabel(
        constraintOf({ source: 'user', confidenceBasis: { kind: 'question-quote', note: '' } }),
      ),
    ).toBe('From your question');
    expect(
      sourceLabel(
        constraintOf({
          source: 'extracted',
          confidenceBasis: { kind: 'evidence-quote', note: '' },
        }),
      ),
    ).toBe('From evidence');
    expect(sourceLabel(constraintOf({ source: 'inferred' }))).toBe('Inferred');
  });

  it('says there were no constraints when a comparison recorded none, and never that nothing limits the decision', () => {
    const none = constraintBasisOf(undefined);
    expect(none).toMatchObject({
      status: 'none',
      provisional: false,
      label: null,
      constraints: [],
    });
    expect(none.reasons).toEqual([]);
  });

  it('puts what a comparison applied, what it only read and what needs confirming into one basis', () => {
    const basis = constraintBasisOf({
      revision: 3,
      status: 'provisional',
      label: provisionalLabel({
        unvalidated: 1,
        assumed: 1,
        unknown: 0,
        missing: 0,
        conflicting: 0,
        notModelledHard: 1,
      }),
      reasons: ['One hard constraint was assumed.'],
      applied: [
        {
          constraintId: 'c-0001',
          statement: 'Approval from the authority is needed first.',
          category: 'regulatory',
          hardness: 'hard',
          source: 'extracted',
          validation: 'assumed',
          effect: { kind: 'require-approval', approverActorId: 'regulator', threshold: 0.1 },
          actorIds: [],
          alternativeIds: [],
          fromRound: null,
          toRound: null,
        },
      ],
      notApplied: [
        {
          constraintId: 'c-0002',
          statement: 'The platform cannot hold more than a fixed number of records.',
          category: 'technical-feasibility',
          hardness: 'hard',
          source: 'inferred',
          validation: 'unvalidated',
          reason: 'interpretive',
        },
      ],
      impacts: [
        {
          constraintId: 'c-0001',
          variantId: 'proposed-change',
          metric: 'Simulated share of members ending in switch or resist',
          seeds: 8,
          withMean: 0.3,
          withoutShift: 0.12,
          standardError: 0.02,
          classification: 'material',
        },
      ],
    });
    expect(basis.provisional).toBe(true);
    expect(basis.label).toMatch(/^Provisional: the simulation ran with/u);
    expect(basis.constraints.map((row) => [row.id, row.enforcement])).toEqual([
      ['c-0001', 'enforced'],
      ['c-0002', 'interpretive'],
    ]);
    expect(basis.constraints[0]?.effects).toEqual(['Needs an approver: a stance of at least 0.1']);
    expect(basis.weakens).toEqual(['Approval from the authority is needed first.']);
    expect(basis.notModelled).toEqual([
      'The platform cannot hold more than a fixed number of records.',
    ]);
    expect(basis.drivers).toEqual([
      expect.objectContaining({ constraintId: 'c-0001', withoutShift: 0.12 }),
    ]);
    expect(basis.validateNext).toHaveLength(2);
  });

  it('holds its own words to the guards that hold the rest of the product', () => {
    const texts = [
      ...Object.values(CONFIDENCE_BASIS_WORDS),
      ...Object.values(NOT_APPLIED_WORDS),
      ...Object.values(GATE_STATUS_WORDS),
      ...CONFIDENCE_BASES.map((kind) => CONFIDENCE_BASIS_WORDS[kind]),
      ...ENFORCED_EFFECT_KINDS.map((kind) => EFFECT_CATALOGUE[kind].engine),
      ...ENFORCED_EFFECT_KINDS.map((kind) => EFFECT_CATALOGUE[kind].label),
      missingConstraintsSentence(2),
      provisionalLabel({
        unvalidated: 2,
        assumed: 1,
        unknown: 1,
        missing: 3,
        conflicting: 1,
        notModelledHard: 1,
      }),
      effectPhrase({ kind: 'delay', rounds: 3 }),
      effectPhrase({ kind: 'add-cost', target: 'adoption', amount: 0.3 }),
      effectPhrase({ kind: 'reduce-influence', amount: 0.4 }),
      effectPhrase({ kind: 'limit-actions', forbid: ['switch', 'resist'] }),
    ];
    for (const text of texts) {
      expect(lintText(text), text).toEqual([]);
      expect(claimsAgainst(text), text).toEqual([]);
    }
  });
});
