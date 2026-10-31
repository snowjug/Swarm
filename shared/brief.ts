import { z } from 'zod';
import {
  fidelitySchema,
  type ResponseCategory,
  type SensitivityClass,
  type StabilityClass,
} from './analysis.js';
import {
  evidenceRefSchema,
  idSchema,
  type StakeholderCategory,
  type TraitOrigin,
} from './stakeholders.js';

/** Where a statement in the brief comes from. Every statement carries exactly one. */
export const STATEMENT_ORIGINS = [
  'supplied-evidence',
  'retrieved-public-evidence',
  'user-assumption',
  'system-assumption',
  'inferred-stakeholder',
  'actor-behavior',
  'simulation-aggregation',
  'model-interpretation',
  'historical-comparison',
  'unresolved-uncertainty',
] as const;
export type StatementOrigin = (typeof STATEMENT_ORIGINS)[number];

export const STATEMENT_ORIGIN_LABELS: Record<StatementOrigin, string> = {
  'supplied-evidence': 'Supplied evidence',
  'retrieved-public-evidence': 'Retrieved public evidence',
  'user-assumption': 'User assumption',
  'system-assumption': 'System assumption',
  'inferred-stakeholder': 'Inferred stakeholder',
  'actor-behavior': 'Actor behaviour',
  'simulation-aggregation': 'Simulation aggregation',
  'model-interpretation': 'Model interpretation',
  'historical-comparison': 'Historical comparison',
  'unresolved-uncertainty': 'Unresolved uncertainty',
};

/** The sections of the answer-first brief, in the order they are read. */
export const BRIEF_SECTION_IDS = [
  'executive-answer',
  'decision',
  'evidence-base',
  'stakeholders',
  'reaction-patterns',
  'alternative-outcomes',
  'first-order',
  'second-order',
  'drivers',
  'assumptions',
  'uncertainty',
  'risks-opportunities',
  'recommendations',
  'validation-plan',
  'sources',
  'limitations',
  'technical-appendix',
] as const;
export type BriefSectionId = (typeof BRIEF_SECTION_IDS)[number];

export const BRIEF_SECTION_TITLES: Record<BriefSectionId, string> = {
  'executive-answer': 'Executive answer',
  decision: 'Decision evaluated',
  'evidence-base': 'Evidence base and quality',
  stakeholders: 'Stakeholder landscape',
  'reaction-patterns': 'Main reaction patterns',
  'alternative-outcomes': 'Alternative outcomes',
  'first-order': 'First-order effects',
  'second-order': 'Second-order and competitor effects',
  drivers: 'Behavioural drivers',
  assumptions: 'Important assumptions',
  uncertainty: 'Uncertainty and sensitivity',
  'risks-opportunities': 'Risks and opportunities',
  recommendations: 'Prioritised recommendations',
  'validation-plan': 'Validation plan',
  sources: 'Sources and provenance',
  limitations: 'Limitations',
  'technical-appendix': 'Technical appendix',
};

const line = (max: number) => z.string().trim().max(max);

/** What a statement rests on. The brief is assembled from these ids, so nothing in it is unsourced. */
export const briefRefsSchema = z.object({
  evidence: z.array(evidenceRefSchema).max(4).default([]),
  stakeholderIds: z.array(idSchema).max(8).default([]),
  findingIds: z.array(z.string().max(80)).max(8).default([]),
  sensitivityIds: z.array(z.string().max(80)).max(8).default([]),
  critiqueIds: z.array(z.string().max(80)).max(8).default([]),
  assumptions: z.array(line(300)).max(6).default([]),
  /** The source documents a statement about provenance rests on, where no single passage is cited. */
  documentIds: z.array(z.string().max(80)).max(8).default([]),
  /** The variants whose seeded runs a statement adds up. */
  variantIds: z.array(idSchema).max(8).default([]),
});
export type BriefRefs = z.infer<typeof briefRefsSchema>;

export const briefStatementSchema = z.object({
  id: z.string().min(1).max(80),
  text: line(700).min(1),
  origin: z.enum(STATEMENT_ORIGINS),
  refs: briefRefsSchema.default(() => briefRefsSchema.parse({})),
  /** How much the statement can be relied on, from repeatability and evidence; null when not applicable. */
  reliance: z.enum(['high', 'moderate', 'low']).nullable().default(null),
});
export type BriefStatement = z.infer<typeof briefStatementSchema>;

/** A chart the page draws from the analysis itself. The brief names it; it never carries its own numbers. */
export const VISUAL_KINDS = [
  'stakeholder-map',
  'influence-network',
  'outcome-distribution',
  'sensitivity',
  'risk-impact',
  'timeline',
  'scenario-comparison',
  'assumption-register',
  'evidence-map',
] as const;
export type VisualKind = (typeof VISUAL_KINDS)[number];

export const briefSectionSchema = z.object({
  id: z.enum(BRIEF_SECTION_IDS),
  title: line(120),
  statements: z.array(briefStatementSchema).max(40),
  visuals: z.array(z.enum(VISUAL_KINDS)).max(4).default([]),
});
export type BriefSection = z.infer<typeof briefSectionSchema>;

export const recommendationSchema = z.object({
  id: z.string().min(1).max(80),
  text: line(500).min(1),
  /** Every recommendation follows from at least one finding. */
  linkedFindingIds: z.array(z.string().max(80)).min(1).max(8),
  priority: z.int().min(1).max(20),
  impact: z.enum(['low', 'medium', 'high']),
  effort: z.enum(['low', 'medium', 'high']),
  reversibility: z.enum(['easy', 'moderate', 'hard']),
  horizon: line(80),
  ownerFunction: line(120),
  leadingIndicators: z.array(line(200)).max(5).default([]),
  assumptions: z.array(line(300)).max(5).default([]),
  /** How to find out whether it is right, before committing. */
  validation: line(400),
});
export type Recommendation = z.infer<typeof recommendationSchema>;

export const validationExperimentSchema = z.object({
  id: z.string().min(1).max(80),
  /** The assumptions or findings the experiment would test. */
  targets: z.array(z.string().max(120)).min(1).max(6),
  question: line(300),
  method: line(400),
  successSignal: line(300),
  effort: z.enum(['low', 'medium', 'high']),
  duration: line(80),
});
export type ValidationExperiment = z.infer<typeof validationExperimentSchema>;

/** The artifact `brief`: the answer-first decision brief for one analysis. */
export const decisionBriefSchema = z.object({
  generatedAt: z.iso.datetime(),
  analysisId: idSchema,
  question: line(2_000),
  /** The executive answer in one or two sentences. */
  headline: line(700),
  sections: z.array(briefSectionSchema).max(20),
  recommendations: z.array(recommendationSchema).max(20),
  validationPlan: z.array(validationExperimentSchema).max(20),
  limitations: z.array(line(500)).max(20),
  fidelity: fidelitySchema,
  methodology: z.object({
    runsPerVariant: z.int().min(1),
    variants: z.array(z.string().max(120)).max(8),
    baseSeed: z.int().min(1),
    rounds: z.int().min(1),
    notes: z.array(line(400)).max(10),
  }),
  openCritiques: z.int().min(0),
  /** `rules` assembles every statement from data; `model` also lets a model word interpretations. */
  generatedBy: z.enum(['rules', 'model']),
  /**
   * The revision of each document the brief was assembled from (0 when there was none), so that a
   * later change to any of them can be told from a brief that is still current.
   */
  inputRevisions: z.record(z.string().max(40), z.int().min(0)).default({}),
});
export type DecisionBrief = z.infer<typeof decisionBriefSchema>;

// ---------------------------------------------------------------------------------------------
// What the page and the exports draw
// ---------------------------------------------------------------------------------------------

export const BRIEF_EXPORT_FORMATS = ['md', 'json', 'html'] as const;
export type BriefExportFormat = (typeof BRIEF_EXPORT_FORMATS)[number];

/** Mean, lowest and highest number of simulated members over the seeded runs of one variant. */
export interface BriefSpread {
  mean: number;
  min: number;
  max: number;
}

export interface BriefOutcomeRow {
  variantId: string;
  label: string;
  kind: 'baseline' | 'alternative';
  runs: number;
  /** Simulated members in one run: key actors and the sampled members of each cohort. */
  members: number;
  responses: ({ category: ResponseCategory } & BriefSpread)[];
  /** Members who ended up looking for an alternative or resisting. */
  adverse: BriefSpread;
  /** Mean final stance of the simulated members, from -1 (against) to 1 (in favour). */
  stanceMean: number;
}

export interface BriefComparisonRow {
  variantId: string;
  label: string;
  members: number;
  adverseMean: number;
  baselineAdverseMean: number | null;
  /** Change in the mean number of adverse members against the baseline, on the same seeds. */
  adverseDelta: number | null;
  stanceMean: number;
  stanceDelta: number | null;
  /** Seeds that were run under both this variant and the baseline. */
  pairedRuns: number;
  /** Paired seeds in which more simulated members ended up adverse than under the baseline. */
  worseInRuns: number;
  /** The finding that states the direction against the baseline, when the analysis recorded one. */
  findingId: string | null;
  classification: StabilityClass | null;
  holdsIn: number | null;
  of: number | null;
}

export interface BriefStakeholderRow {
  id: string;
  name: string;
  priority: 'key' | 'standard' | 'background';
  direction: 'harmed' | 'benefited' | 'mixed' | 'unclear';
  supporting: number;
  contradicting: number;
  uncertainty: 'low' | 'medium' | 'high';
  origin: StatementOrigin;
}

export interface BriefStakeholderGroup {
  category: StakeholderCategory;
  label: string;
  stakeholders: BriefStakeholderRow[];
}

export interface BriefSensitivityRow {
  id: string;
  label: string;
  metric: string;
  shift: number;
  standardError: number;
  classification: SensitivityClass;
  origin: StatementOrigin;
  /** Whether a cited passage backs the assumption that was moved. */
  evidenced: boolean;
}

export interface BriefAssumptionRow {
  id: string;
  text: string;
  value: string | null;
  origin: StatementOrigin;
  sensitive: boolean;
  evidenced: boolean;
  /** What moving it did to the outcome, when it was perturbed. */
  effect: string | null;
}

export interface BriefEvidenceRow {
  stakeholderId: string;
  name: string;
  category: StakeholderCategory;
  supporting: number;
  contradicting: number;
  documents: string[];
  gap: boolean;
}

export interface BriefTraitRow {
  actorId: string;
  name: string;
  kind: 'key' | 'cohort';
  members: number;
  /** The population the actor stands for. An assumption, never a count. */
  size: number;
  traits: { key: string; value: number; spread: number; origin: TraitOrigin }[];
}

/** What a reference in a statement points at, so that the page can open it without another request. */
export interface BriefLookups {
  findings: {
    id: string;
    statement: string;
    classification: StabilityClass;
    holdsIn: number;
    of: number;
    interval: { lo: number; hi: number };
  }[];
  variants: { id: string; label: string }[];
  stakeholders: { id: string; name: string }[];
  documents: { id: string; name: string; origin: StatementOrigin; provenance: string }[];
}

/**
 * Everything the page draws and the exports tabulate, worked out from the analysis and the project's
 * other documents when it is asked for. The stored brief carries none of these numbers.
 */
export interface BriefVisuals {
  analysisId: string;
  runsPerVariant: number;
  stakeholderMap: BriefStakeholderGroup[];
  outcomeDistribution: BriefOutcomeRow[];
  scenarioComparison: BriefComparisonRow[];
  sensitivity: BriefSensitivityRow[];
  assumptionRegister: BriefAssumptionRow[];
  evidenceMap: BriefEvidenceRow[];
  traitTable: BriefTraitRow[];
  lookups: BriefLookups;
}

/** What `GET` and `POST /api/projects/:id/brief` answer with. */
export interface BriefView {
  brief: DecisionBrief | null;
  visuals: BriefVisuals | null;
  /** The newest completed analysis, which generating would use. Null when there is none. */
  latestAnalysis: { id: string; completedAt: string | null } | null;
  /** Which inputs have changed since the brief was made; empty when it is current. */
  changedSince: string[];
  may: { generate: boolean; export: boolean };
}
