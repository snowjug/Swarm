import {
  CONSTRAINT_SCHEMA_VERSION,
  constraintSchema,
  constraintSetSchema,
  type Constraint,
  type ConstraintSet,
} from '../../../shared/constraints.js';
import { actorSetFixture } from '../../../shared/lab-fixtures.js';
import type { GateWorld } from '../../src/constraints/gate.js';
import type { ReviewWorld } from '../../src/constraints/review.js';

export const NOW = new Date('2026-03-01T09:00:00.000Z');

/** The least a constraint needs: everything else has a default, so a stored document stays readable as fields are added. */
const minimal = {
  id: 'c-0001',
  category: 'budget',
  statement: 'Spending on the change is capped.',
  source: 'user',
  hardness: 'soft',
  confidenceBasis: { kind: 'user-entry' },
  uncertainty: { level: 'low', reason: 'You stated it.' },
  validation: 'confirmed',
  review: 'accepted',
};

export const constraintOf = (overrides: Partial<Constraint> = {}): Constraint =>
  constraintSchema.parse({ ...minimal, ...overrides });

export const setOf = (
  constraints: Constraint[] = [],
  overrides: Partial<ConstraintSet> = {},
): ConstraintSet =>
  constraintSetSchema.parse({
    version: CONSTRAINT_SCHEMA_VERSION,
    constraints,
    generatedAt: NOW.toISOString(),
    mode: 'rules',
    scenarioRevision: 1,
    actorsRevision: 1,
    reviewedAt: NOW.toISOString(),
    ...overrides,
  });

/** A quote kept from a passage, as a reading of a source leaves it. */
export const evidenceOf = (
  quote: string,
  passageId = 'S1',
): Constraint['evidenceRefs'][number] => ({
  passageId,
  documentId: 'doc-1',
  documentName: 'doc-1.md',
  start: 0,
  end: quote.length,
  quote,
  contentHash: 'hash-1',
  role: 'supports',
});

export const ALTERNATIVES = [
  { id: 'proposed-change', label: 'Proposed change' },
  { id: 'smaller-rise', label: 'Smaller rise' },
];

export const gateWorld = (overrides: Partial<GateWorld> = {}): GateWorld => ({
  alternatives: ALTERNATIVES,
  variantIds: new Set(['baseline', ...ALTERNATIVES.map(({ id }) => id)]),
  actors: actorSetFixture().actors.map(({ id, name }) => ({ id, name })),
  assumptionIds: new Set(),
  stale: { scenario: false, actors: false },
  ...overrides,
});

export const reviewWorld = (overrides: Partial<ReviewWorld> = {}): ReviewWorld => ({
  actorIds: new Set(actorSetFixture().actors.map(({ id }) => id)),
  alternativeIds: new Set(ALTERNATIVES.map(({ id }) => id)),
  assumptionIds: new Set(),
  ...overrides,
});
