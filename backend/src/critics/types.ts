import type { Analysis } from '../../../shared/analysis.js';
import type { DecisionBrief } from '../../../shared/brief.js';
import type { Critique } from '../../../shared/critique.js';
import type { EvidenceRef } from '../../../shared/evidence.js';
import type { ScenarioFrame, SourceProvenance } from '../../../shared/scenario.js';
import type { ActorSet, Stakeholder, StakeholderSet } from '../../../shared/stakeholders.js';

/** One source document and what is recorded about where it came from. */
export interface EvidenceDocument {
  id: string;
  name: string;
  provenance: SourceProvenance | null;
}

/**
 * What the critics are told about the sources. The caller gathers it, so that the rules stay pure
 * functions of their input.
 */
export interface EvidenceSummary {
  documents: EvidenceDocument[];
  /** Conflicts between sources that nobody has resolved or dismissed. Null when the ledger was never built. */
  openConflicts: number | null;
  /** Passages on either side of the first open conflicts, at most five. */
  conflictEvidence: EvidenceRef[];
}

export interface CriticInput {
  /** Null when the project never went through scenario intake. */
  scenario: ScenarioFrame | null;
  /** Null when no stakeholders were recorded. */
  stakeholders: StakeholderSet | null;
  /** The cast the analysis ran with. */
  actors: Pick<ActorSet, 'actors'>;
  analysis: Analysis;
  /** When a brief exists for this analysis, its wording and recommendations are challenged too. */
  brief?: DecisionBrief | null;
  evidenceSummary: EvidenceSummary;
  /** When the critiques are made. Defaults to the current time; a test passes one to get identical output. */
  now?: string;
}

/** What several critics need to know about the cited evidence. */
export interface Facts {
  /** The stakeholders that were not removed. */
  stakeholders: Stakeholder[];
  /** Every passage cited by those stakeholders, once. */
  cited: EvidenceRef[];
  /** The cited passages by the document they come from. */
  citedByDocument: Map<string, EvidenceRef[]>;
  /** Whether the cast and the scenarios give the change any way to move anyone at all. */
  changeCanMove: boolean;
}

export interface Resolved extends CriticInput {
  now: string;
  facts: Facts;
}

/** One critic: reads what it is given and raises what it finds. Never edits anything. */
export type RoleCritic = (input: Resolved) => Critique[];
