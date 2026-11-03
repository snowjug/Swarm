import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STATEMENT_ORIGINS } from '../../shared/brief.js';
import { CONFIDENCE_BASES, CONSTRAINT_SOURCES } from '../../shared/constraints.js';
import { critiqueSchema } from '../../shared/critique.js';
import {
  EPISTEMIC_LABELS,
  EPISTEMIC_LABEL_INFO,
  LABEL_NAMESPACES,
  LABEL_TABLE,
  labelOf,
  labelOfConstraint,
} from '../../shared/decision.js';
import { STATEMENT_TYPES } from '../../shared/evidence.js';
import { CLAIM_KINDS } from '../../shared/grounding.js';
import { scenarioFrameSchema } from '../../shared/scenario.js';
import { TRAIT_ORIGINS, stakeholderSchema } from '../../shared/stakeholders.js';

/** The values each source enum has, written out apart from the table so that the table is held to them. */
const SOURCES: Record<(typeof LABEL_NAMESPACES)[number], readonly string[]> = {
  'brief-origin': STATEMENT_ORIGINS,
  'claim-kind': CLAIM_KINDS,
  'statement-type': STATEMENT_TYPES,
  'trait-origin': TRAIT_ORIGINS,
  'sensitivity-origin': ['evidence', 'user', 'system-assumption', 'model', 'scenario'],
  'constraint-source': CONSTRAINT_SOURCES,
  'constraint-basis': CONFIDENCE_BASES,
  'frame-origin': scenarioFrameSchema.shape.origin.options,
  'stakeholder-origin': stakeholderSchema.shape.origin.options,
  'critique-origin': critiqueSchema.shape.origin.options,
};

describe('the one table that maps what the product already says onto the eight labels', () => {
  it('has a namespace for each kind of statement, and each maps every value its enum has, and no other', () => {
    expect([...LABEL_NAMESPACES].sort()).toEqual(Object.keys(SOURCES).sort());
    for (const namespace of LABEL_NAMESPACES) {
      expect(Object.keys(LABEL_TABLE[namespace]).sort(), namespace).toEqual(
        [...SOURCES[namespace]].sort(),
      );
      for (const label of Object.values(LABEL_TABLE[namespace]))
        expect(EPISTEMIC_LABELS).toContain(label);
    }
  });

  it('describes each label in plain words that say what it is not', () => {
    expect(EPISTEMIC_LABELS).toHaveLength(8);
    for (const label of EPISTEMIC_LABELS) {
      expect(EPISTEMIC_LABEL_INFO[label].name.length).toBeGreaterThan(2);
      expect(EPISTEMIC_LABEL_INFO[label].meaning.length).toBeGreaterThan(40);
    }
    expect(EPISTEMIC_LABEL_INFO['simulation-event'].meaning).toMatch(
      /did not happen in the world/u,
    );
    expect(EPISTEMIC_LABEL_INFO['scenario-possibility'].meaning).toMatch(/not a forecast/u);
    expect(EPISTEMIC_LABEL_INFO['model-inference'].meaning).toMatch(/not a finding/u);
  });

  it('lets only a quoted source, a verified quote or a record be a fact, and never anything derived', () => {
    const facts = LABEL_NAMESPACES.flatMap((namespace) =>
      Object.entries(LABEL_TABLE[namespace])
        .filter(([, label]) => label === 'fact')
        .map(([value]) => `${namespace}:${value}`),
    );
    expect(facts.sort()).toEqual([
      'claim-kind:source-fact',
      'constraint-basis:evidence-quote',
      'statement-type:source-fact',
    ]);
  });

  it('keeps what a model or a rule inferred, and what a simulation did, apart from what a source says', () => {
    expect(labelOf('brief-origin', 'inferred-stakeholder')).toBe('model-inference');
    expect(labelOf('brief-origin', 'model-interpretation')).toBe('model-inference');
    expect(labelOf('brief-origin', 'simulation-aggregation')).toBe('simulation-event');
    expect(labelOf('brief-origin', 'actor-behavior')).toBe('simulation-event');
    expect(labelOf('brief-origin', 'supplied-evidence')).toBe('source-claim');
    expect(labelOf('brief-origin', 'unresolved-uncertainty')).toBe('validation-requirement');
    expect(labelOf('claim-kind', 'ai-hypothesis')).toBe('model-inference');
    expect(labelOf('statement-type', 'recommendation')).toBe('recommendation');
    expect(labelOf('trait-origin', 'system-assumption')).toBe('assumption');
    expect(labelOf('trait-origin', 'model')).toBe('model-inference');
    expect(labelOf('trait-origin', 'evidence')).toBe('source-claim');
    expect(labelOf('stakeholder-origin', 'rules')).toBe('model-inference');
    expect(labelOf('frame-origin', 'model')).toBe('model-inference');
  });

  it('labels a constraint by what it was read from when that is known, else by who proposed it', () => {
    expect(
      labelOfConstraint({ source: 'extracted', confidenceBasis: { kind: 'evidence-quote' } }),
    ).toBe('fact');
    expect(
      labelOfConstraint({ source: 'extracted', confidenceBasis: { kind: 'model-reading' } }),
    ).toBe('model-inference');
    expect(labelOfConstraint({ source: 'user', confidenceBasis: { kind: 'question-quote' } })).toBe(
      'assumption',
    );
    expect(labelOfConstraint({ source: 'inferred' })).toBe('model-inference');
    expect(labelOfConstraint({ source: 'extracted' })).toBe('source-claim');
  });

  it('is written out, row by row, in the document that explains the canvas', () => {
    const doc = readFileSync(
      new URL('../../docs/analysis/decision-canvas.md', import.meta.url),
      'utf8',
    );
    for (const namespace of LABEL_NAMESPACES) expect(doc, namespace).toContain(namespace);
    for (const label of EPISTEMIC_LABELS)
      expect(doc.toLowerCase(), label).toContain(label.replace('-', ' '));
  });
});
