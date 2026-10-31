import type { Analysis, Finding } from '../../../shared/analysis.js';
import type { Critique, CritiqueSet } from '../../../shared/critique.js';
import type { ContradictionStatus, EvidenceRef } from '../../../shared/evidence.js';
import type { ScenarioFrame } from '../../../shared/scenario.js';
import { effectiveTrait } from '../../../shared/signal.js';
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
import {
  directionOfImpact,
  relianceOfFinding,
  weakestReliance,
  type Direction,
  type Reliance,
} from './rules.js';
import { readSignal, type SignalReading } from './signal.js';

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
  /**
   * How far the search for conflicts between the sources read: its work is bounded, so a very large or
   * very repetitive body of evidence is not searched in full. Absent where the search was not run again.
   */
  scan?: { sentences: number; skippedLists: number; cappedSentences: number };
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
  /** Removed, and not merged into another: the only ones that left the list because the person removed them. */
  removedStakeholders: Stakeholder[];
  /** Names that were merged into another stakeholder, whether by the rules that found them or by the person. */
  mergedStakeholders: { stakeholder: Stakeholder; into: Stakeholder }[];
  critiques: Critique[];
  /** Said when critiques on file belong to another analysis and so are not counted. */
  critiqueNote: string | null;
  ledger: BriefLedgerSummary | null;
  documents: BriefDocument[];
  evidence: EvidenceIndex;
  measures: VariantMeasure[];
  baseline: VariantMeasure | null;
  headline: Headline | null;
  /** Whether the comparison with no change can be read as a result about the change. */
  signal: SignalReading;
  assumptions: AssumptionRow[];
  /** The actors were edited after the analysis ran. */
  actorsChanged: boolean;
  actorById: Map<string, Actor>;
  findingById: Map<string, Finding>;
  variantLabel(variantId: string): string;
  /**
   * The impact of the change on an actor as the headline comparison ran it: what the scenario sets for
   * it (an override or an edit) where it sets one, else what the actor carries. Whatever the brief says
   * about who is helped or harmed is read from this and never from the actor alone.
   */
  impactIn(actor: Actor): number;
  directionIn(actor: Actor): Direction;
  /** Whether the headline scenario, and not the actor, sets the impact the runs used. */
  impactSetByScenario(actor: Actor): boolean;
  /** Evidence presence for a finding: its actor has a cited supporting passage, or most actors do. */
  evidencedFinding(finding: Finding): boolean;
  /** Whether at least half of the actors have a cited supporting passage. */
  evidencedOverall(): boolean;
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
  const all = inputs.stakeholders?.stakeholders ?? [];
  const stakeholders = all.filter((stakeholder) => stakeholder.status !== 'removed');
  const mergedStakeholders = all.flatMap((into) =>
    into.mergedFrom.flatMap((id) => {
      const stakeholder = all.find((candidate) => candidate.id === id);
      return stakeholder?.status === 'removed' ? [{ stakeholder, into }] : [];
    }),
  );
  const merged = new Set(mergedStakeholders.map((entry) => entry.stakeholder.id));
  const removedStakeholders = all.filter(
    (stakeholder) => stakeholder.status === 'removed' && !merged.has(stakeholder.id),
  );
  const forThisAnalysis =
    inputs.critiques !== null &&
    (inputs.critiques.analysisId === null || inputs.critiques.analysisId === analysis.id);
  const critiques = forThisAnalysis ? (inputs.critiques?.critiques ?? []) : [];
  const evidence = evidenceIndex(inputs.stakeholders, analysis.actors, inputs.documents);
  const measures = measureVariants(analysis);
  const headline = headlineOf(analysis, measures);
  const signal = readSignal(analysis, headline);
  const actorById = new Map(analysis.actors.map((actor) => [actor.id, actor]));
  const findingById = new Map(analysis.findings.map((finding) => [finding.id, finding]));
  const evidencedOverall = (): boolean => {
    const supported = analysis.actors.filter((actor) => evidence.supports(actor)).length;
    return supported * 2 >= analysis.actors.length;
  };
  const evidencedFinding = (finding: Finding): boolean => {
    if (finding.actorId !== null) {
      const actor = actorById.get(finding.actorId);
      return actor ? evidence.supports(actor) : false;
    }
    return evidencedOverall();
  };
  const current = inputs.actors?.actors ?? null;
  const actorsChanged =
    current !== null &&
    current.map(fingerprint).sort().join('|') !== analysis.actors.map(fingerprint).sort().join('|');
  const scenario = headline?.variant.variant ?? null;
  const impactIn = (actor: Actor): number =>
    scenario ? effectiveTrait(actor, scenario, 'impact') : actor.traits.impact.value;
  return {
    inputs,
    analysis,
    scenario: inputs.scenario,
    stakeholders,
    removedStakeholders,
    mergedStakeholders,
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
    headline,
    signal,
    assumptions: assumptionRows({ analysis, scenario: inputs.scenario, evidence }),
    actorsChanged,
    actorById,
    findingById,
    variantLabel: (variantId) =>
      analysis.config.variants.find((variant) => variant.id === variantId)?.label ?? variantId,
    impactIn,
    directionIn: (actor) => directionOfImpact(impactIn(actor)),
    impactSetByScenario: (actor) =>
      scenario !== null &&
      (scenario.impactOverrides[actor.id] !== undefined ||
        (scenario.traitEdits ?? []).some(
          (edit) => edit.actorId === actor.id && edit.trait === 'impact',
        )),
    evidencedFinding,
    evidencedOverall,
    // When no one can be moved, every finding describes noise, however often it held.
    relianceOf: (findings) => {
      if (signal.state === 'no-direction') return findings.length > 0 ? 'low' : null;
      return weakestReliance(
        findings.map((finding) =>
          relianceOfFinding(finding.classification, evidencedFinding(finding)),
        ),
      );
    },
  };
}
