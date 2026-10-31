import type { Analysis, Finding } from '../../../shared/analysis.js';
import type { Critique, CritiqueSet } from '../../../shared/critique.js';
import type { ContradictionStatus, EvidenceRef } from '../../../shared/evidence.js';
import type { ScenarioFrame } from '../../../shared/scenario.js';
import {
  TRAIT_KEYS,
  type Actor,
  type ActorSet,
  type Stakeholder,
  type StakeholderSet,
} from '../../../shared/stakeholders.js';
import { assumptionRows, type AssumptionRow } from './assumptions.js';
import { evidenceIndex, type BriefDocument, type EvidenceIndex } from './evidence.js';
import {
  baselineOf,
  headlineOf,
  measureVariants,
  type Headline,
  type VariantMeasure,
} from './measures.js';
import { relianceOfFinding, weakestReliance, type Reliance } from './rules.js';

/** A conflict between two supplied sources, as the evidence ledger recorded it. */
export interface BriefConflict {
  id: string;
  topic: string;
  status: ContradictionStatus;
  left: EvidenceRef;
  right: EvidenceRef;
  leftValue: string | null;
  rightValue: string | null;
}

/** What the project's evidence ledger says about its sources, read without changing the ledger. */
export interface BriefLedgerSummary {
  conflicts: BriefConflict[];
  sufficiency: { level: 'sufficient' | 'limited' | 'insufficient'; reasons: string[] } | null;
}

export interface BriefInputs {
  project: { id: string; name: string; question: string };
  scenario: ScenarioFrame | null;
  stakeholders: StakeholderSet | null;
  actors: ActorSet | null;
  analysis: Analysis;
  critiques: CritiqueSet | null;
  documents: BriefDocument[];
  ledgerSummary: BriefLedgerSummary | null;
  /** The revision of each document the brief is made from, kept with it. */
  inputRevisions?: Record<string, number>;
  /** The time to record. Everything else in a brief is a function of the inputs. */
  generatedAt?: string;
}

/** What the builders read, worked out once from the inputs. */
export interface Facts {
  inputs: BriefInputs;
  analysis: Analysis;
  scenario: ScenarioFrame | null;
  /** Stakeholders the person has not removed. */
  stakeholders: Stakeholder[];
  removedStakeholders: Stakeholder[];
  critiques: Critique[];
  /** Said when critiques on file belong to another analysis and so are not counted. */
  critiqueNote: string | null;
  ledger: BriefLedgerSummary | null;
  documents: BriefDocument[];
  evidence: EvidenceIndex;
  measures: VariantMeasure[];
  baseline: VariantMeasure | null;
  headline: Headline | null;
  assumptions: AssumptionRow[];
  /** The actors were edited after the analysis ran. */
  actorsChanged: boolean;
  actorById: Map<string, Actor>;
  findingById: Map<string, Finding>;
  variantLabel(variantId: string): string;
  /** Evidence presence for a finding: its actor has a cited supporting passage, or most actors do. */
  evidencedFinding(finding: Finding): boolean;
  relianceOf(findings: readonly Finding[]): Reliance | null;
}

const fingerprint = (actor: Actor): string =>
  JSON.stringify([
    actor.id,
    actor.size,
    actor.sampleSize,
    TRAIT_KEYS.map((key) => [
      actor.traits[key].value,
      actor.traits[key].spread,
      actor.traits[key].origin,
    ]),
  ]);

export function gatherFacts(inputs: BriefInputs): Facts {
  const { analysis } = inputs;
  const stakeholders = (inputs.stakeholders?.stakeholders ?? []).filter(
    (stakeholder) => stakeholder.status !== 'removed',
  );
  const removedStakeholders = (inputs.stakeholders?.stakeholders ?? []).filter(
    (stakeholder) => stakeholder.status === 'removed',
  );
  const forThisAnalysis =
    inputs.critiques !== null &&
    (inputs.critiques.analysisId === null || inputs.critiques.analysisId === analysis.id);
  const critiques = forThisAnalysis ? (inputs.critiques?.critiques ?? []) : [];
  const evidence = evidenceIndex(inputs.stakeholders, analysis.actors, inputs.documents);
  const measures = measureVariants(analysis);
  const actorById = new Map(analysis.actors.map((actor) => [actor.id, actor]));
  const findingById = new Map(analysis.findings.map((finding) => [finding.id, finding]));
  const evidencedFinding = (finding: Finding): boolean => {
    if (finding.actorId !== null) {
      const actor = actorById.get(finding.actorId);
      return actor ? evidence.supports(actor) : false;
    }
    const supported = analysis.actors.filter((actor) => evidence.supports(actor)).length;
    return supported * 2 >= analysis.actors.length;
  };
  const current = inputs.actors?.actors ?? null;
  const actorsChanged =
    current !== null &&
    current.map(fingerprint).sort().join('|') !== analysis.actors.map(fingerprint).sort().join('|');
  return {
    inputs,
    analysis,
    scenario: inputs.scenario,
    stakeholders,
    removedStakeholders,
    critiques,
    critiqueNote:
      inputs.critiques !== null && !forThisAnalysis
        ? 'Critiques on file were written for a different analysis, so none is counted here.'
        : null,
    ledger: inputs.ledgerSummary,
    documents: inputs.documents,
    evidence,
    measures,
    baseline: baselineOf(measures),
    headline: headlineOf(analysis, measures),
    assumptions: assumptionRows({ analysis, scenario: inputs.scenario, evidence }),
    actorsChanged,
    actorById,
    findingById,
    variantLabel: (variantId) =>
      analysis.config.variants.find((variant) => variant.id === variantId)?.label ?? variantId,
    evidencedFinding,
    relianceOf: (findings) =>
      weakestReliance(
        findings.map((finding) =>
          relianceOfFinding(finding.classification, evidencedFinding(finding)),
        ),
      ),
  };
}
