import type { Analysis } from '../../../shared/analysis.js';
import { decisionBriefSchema, type DecisionBrief } from '../../../shared/brief.js';
import type { EvidenceRef } from '../../../shared/evidence.js';
import {
  actorSetFixture,
  analysisFixture,
  scenarioFixture,
  stakeholderSetFixture,
} from '../../../shared/lab-fixtures.js';
import {
  TRAIT_KEYS,
  type Actor,
  type Stakeholder,
  type TraitKey,
} from '../../../shared/stakeholders.js';
import type { CriticInput } from '../../src/critics/types.js';

export const NOW = '2026-02-01T09:00:00.000Z';

/** A cited passage of a document, with a quote, for a fixture. */
export function ref(
  documentId: string,
  passage: number,
  extra: Partial<EvidenceRef> = {},
): EvidenceRef {
  return {
    passageId: `${documentId}-p${passage}`,
    documentId,
    documentName: `Source ${documentId}`,
    start: passage * 100,
    end: passage * 100 + 80,
    quote: `Excerpt ${passage} of ${documentId}.`,
    contentHash: `hash-${documentId}-${passage}`,
    role: 'supports',
    ...extra,
  };
}

/** Two cited passages for each stakeholder, spread over three documents. */
const CITED: Record<string, EvidenceRef[]> = {
  provider: [ref('d1', 1), ref('d2', 1)],
  subscribers: [ref('d2', 2), ref('d3', 1)],
  'rival-provider': [ref('d3', 2), ref('d1', 2)],
  regulator: [ref('d1', 3), ref('d3', 3)],
  resellers: [ref('d2', 3), ref('d3', 4)],
};

/** Every actor was looked at by a person, who set each trait; stances differ in sign. */
const STANCE: Record<string, number> = {
  provider: 0.3,
  subscribers: -0.4,
  'rival-provider': 0,
  regulator: -0.2,
  resellers: 0.2,
};

function confirmed(actor: Actor): Actor {
  const traits = { ...actor.traits };
  for (const key of TRAIT_KEYS) traits[key] = { ...traits[key], origin: 'user' };
  traits.priorStance = { ...traits.priorStance, value: STANCE[actor.id] ?? 0 };
  return { ...actor, traits, edited: true };
}

/**
 * An analysis that none of the rules has anything to say about, made from the shared fixtures by small
 * edits: many runs, a hybrid engine whose model part was repeated, a cross-check that agrees, findings
 * that repeat, evidence from three documents, and a cast a person has looked at. Every rule test
 * starts from this and changes one thing.
 */
export function cleanInput(): CriticInput {
  const actors = actorSetFixture();
  const cast = actors.actors.map(confirmed);
  const base = analysisFixture();
  const analysis = analysisFixture({
    actors: cast,
    config: { ...base.config, runsPerVariant: 30 },
    fidelity: {
      engine: 'hybrid',
      keyActors: 'model',
      cohorts: 'rules',
      repeatedRuns: 30,
      modelRepeats: 3,
      label: 'Hybrid: key actors by a model, cohorts by rules',
      caveats: [],
    },
    findings: base.findings.map((finding) =>
      finding.id === 'f2'
        ? { ...finding, holdsIn: 9, interval: { lo: 0.6, hi: 0.98 }, classification: 'repeatable' }
        : finding,
    ),
    sensitivity: base.sensitivity.map((row) => ({
      ...row,
      classification: 'robust',
      shift: 0.01,
      assumptionOrigin: 'evidence',
    })),
    crossCheck: {
      primaryStanceMean: -0.2,
      withinEnsembleRange: true,
      note: 'The deeper run lies inside the spread of the repeated runs.',
    },
  });
  const set = stakeholderSetFixture();
  return {
    scenario: scenarioFixture(),
    stakeholders: {
      ...set,
      stakeholders: set.stakeholders.map((stakeholder) => ({
        ...stakeholder,
        evidence: CITED[stakeholder.id] ?? [],
      })),
    },
    actors: { actors: cast },
    analysis,
    brief: null,
    evidenceSummary: {
      documents: [
        {
          id: 'd1',
          name: 'Source d1',
          provenance: { kind: 'url', fetchedByServer: true, asOf: '2026-01-10' },
        },
        { id: 'd2', name: 'Source d2', provenance: { kind: 'upload', asOf: '2026-01-05' } },
        { id: 'd3', name: 'Source d3', provenance: { kind: 'paste', asOf: '2026-01-02' } },
      ],
      openConflicts: 0,
      conflictEvidence: [],
    },
    now: NOW,
  };
}

/** A brief that the recommendation and wording rules have nothing to say about. */
export function briefFixture(
  analysis: Analysis,
  overrides: Partial<DecisionBrief> = {},
): DecisionBrief {
  return decisionBriefSchema.parse({
    generatedAt: NOW,
    analysisId: analysis.id,
    question: 'What could happen if the fee changes?',
    headline:
      'Under the proposed change, simulated members ended less favourable than under no change in 10 of 10 simulated runs.',
    sections: [
      {
        id: 'executive-answer',
        title: 'Executive answer',
        statements: [
          {
            id: 'st-1',
            text: 'In 10 of 10 simulated runs the proposed change ended less favourable than no change.',
            origin: 'simulation-aggregation',
            refs: { findingIds: ['f1'] },
            reliance: 'moderate',
          },
        ],
        visuals: [],
      },
    ],
    recommendations: [
      {
        id: 'r1',
        text: 'Stage the change and watch the leading indicators.',
        linkedFindingIds: ['f1'],
        priority: 1,
        impact: 'medium',
        effort: 'low',
        reversibility: 'easy',
        horizon: 'Next quarter',
        ownerFunction: 'operations',
        leadingIndicators: ['Early reactions'],
        assumptions: [],
        validation: 'Pilot the change with one group before wider use.',
      },
    ],
    validationPlan: [],
    limitations: ['Synthetic actors are not real people.'],
    fidelity: analysis.fidelity,
    methodology: {
      runsPerVariant: analysis.config.runsPerVariant,
      variants: ['No change', 'Proposed change'],
      baseSeed: 100,
      rounds: 8,
      notes: [],
    },
    openCritiques: 0,
    generatedBy: 'rules',
    ...overrides,
  });
}

export function withBrief(input: CriticInput, overrides: Partial<DecisionBrief> = {}): CriticInput {
  return { ...input, brief: briefFixture(input.analysis, overrides) };
}

export function withStakeholder(
  input: CriticInput,
  id: string,
  change: Partial<Stakeholder>,
): CriticInput {
  const set = input.stakeholders;
  if (!set) throw new Error('This input has no stakeholders.');
  return {
    ...input,
    stakeholders: {
      ...set,
      stakeholders: set.stakeholders.map((stakeholder) =>
        stakeholder.id === id ? { ...stakeholder, ...change } : stakeholder,
      ),
    },
  };
}

export function withActor(input: CriticInput, id: string, change: Partial<Actor>): CriticInput {
  return {
    ...input,
    actors: {
      actors: input.actors.actors.map((actor) =>
        actor.id === id ? { ...actor, ...change } : actor,
      ),
    },
  };
}

export function withTrait(
  input: CriticInput,
  id: string,
  key: TraitKey,
  change: Partial<Actor['traits'][TraitKey]>,
): CriticInput {
  const actor = input.actors.actors.find((candidate) => candidate.id === id);
  if (!actor) throw new Error(`No actor ${id}.`);
  return withActor(input, id, {
    traits: { ...actor.traits, [key]: { ...actor.traits[key], ...change } },
  });
}

export function withAnalysis(input: CriticInput, change: Partial<Analysis>): CriticInput {
  return { ...input, analysis: { ...input.analysis, ...change } };
}

/** Replaces what every stakeholder cites. */
export function withCitations(
  input: CriticInput,
  cited: Record<string, EvidenceRef[]>,
): CriticInput {
  const set = input.stakeholders;
  if (!set) throw new Error('This input has no stakeholders.');
  return {
    ...input,
    stakeholders: {
      ...set,
      stakeholders: set.stakeholders.map((stakeholder) => ({
        ...stakeholder,
        evidence: cited[stakeholder.id] ?? [],
      })),
    },
  };
}
