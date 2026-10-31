import { z } from 'zod';
import { fidelitySchema } from './analysis.js';
import { evidenceRefSchema, idSchema } from './stakeholders.js';

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
});
export type DecisionBrief = z.infer<typeof decisionBriefSchema>;
