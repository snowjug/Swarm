import { z } from 'zod';
import {
  RESPONSE_CATEGORIES,
  SENSITIVITY_CLASSES,
  STABILITY_CLASSES,
  fidelitySchema,
  type ResponseCategory,
  type SensitivityClass,
  type StabilityClass,
} from './analysis.js';
import { NO_DIRECTION_NOTICE } from './signal.js';
import {
  STAKEHOLDER_CATEGORIES,
  TRAIT_ORIGINS,
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

/**
 * Whether the comparison of the change with no change can be read as a result about the change.
 * `no-direction`: no stakeholder has an expected direction of impact, so the change cannot move anyone
 * and every difference is noise. `no-difference`: stakeholders do have directions, and the comparison
 * still found the two about the same, repeatably, with no group moving clearly on its own.
 */
export const BRIEF_SIGNALS = ['clear', 'no-direction', 'no-difference'] as const;
export type BriefSignal = (typeof BRIEF_SIGNALS)[number];

export const NO_DIFFERENCE_NOTICE =
  'Under the assumptions made here the simulation shows no measurable difference between the change and no change: the two ended up about the same in most paired seeded runs, and no group moved clearly on its own. That describes the assumptions, not the world. Check who is affected, and by how much, against real groups before concluding that the change makes no difference.';

/** What a part of the brief that sets variants side by side says first when the comparison cannot be read as a result. */
export const BRIEF_READING_NOTES: Record<Exclude<BriefSignal, 'clear'>, string> = {
  'no-direction':
    'Read every difference between variants in this section as noise: no stakeholder has an expected direction of impact, so the change cannot move anyone in the simulation.',
  'no-difference':
    'Read the small differences between variants in this section as within noise: under these assumptions the comparison found no measurable difference between the change and no change.',
};

/** What the page and the exports say at the top when the comparison cannot be read as a result. */
export const BRIEF_SIGNAL_NOTICES: Record<
  Exclude<BriefSignal, 'clear'>,
  { title: string; text: string }
> = {
  'no-direction': {
    title: 'The simulation could not tell the change from no change',
    text: NO_DIRECTION_NOTICE,
  },
  'no-difference': {
    title: 'No measurable difference under these assumptions',
    text: NO_DIFFERENCE_NOTICE,
  },
};

/**
 * The data behind the page's charts and the exports' tables, as it is kept with a brief. It mirrors
 * `BriefVisuals` below, which the compiler checks, and is as permissive as the text it holds is long
 * so that nothing the brief's own builders produce is refused.
 */
const note = (max = 2_000) => z.string().max(max);
const count = z.int().min(0);
const spreadSchema = z.object({ mean: z.number(), min: z.number(), max: z.number() });
const statementOriginSchema = z.enum(STATEMENT_ORIGINS);
const briefVisualsSchema = z.object({
  analysisId: idSchema,
  runsPerVariant: count,
  stakeholderMap: z
    .array(
      z.object({
        category: z.enum(STAKEHOLDER_CATEGORIES),
        label: note(120),
        stakeholders: z
          .array(
            z.object({
              id: note(80),
              name: note(200),
              priority: z.enum(['key', 'standard', 'background']),
              direction: z.enum(['harmed', 'benefited', 'mixed', 'unclear']),
              supporting: count,
              contradicting: count,
              uncertainty: z.enum(['low', 'medium', 'high']),
              origin: statementOriginSchema,
            }),
          )
          .max(200),
      }),
    )
    .max(40),
  outcomeDistribution: z
    .array(
      z.object({
        variantId: note(80),
        label: note(200),
        kind: z.enum(['baseline', 'alternative']),
        runs: count,
        members: count,
        responses: z
          .array(spreadSchema.extend({ category: z.enum(RESPONSE_CATEGORIES) }))
          .max(RESPONSE_CATEGORIES.length),
        adverse: spreadSchema,
        stanceMean: z.number(),
      }),
    )
    .max(16),
  scenarioComparison: z
    .array(
      z.object({
        variantId: note(80),
        label: note(200),
        members: count,
        adverseMean: z.number(),
        baselineAdverseMean: z.number().nullable(),
        adverseDelta: z.number().nullable(),
        stanceMean: z.number(),
        stanceDelta: z.number().nullable(),
        pairedRuns: count,
        worseInRuns: count,
        findingId: note(80).nullable(),
        classification: z.enum(STABILITY_CLASSES).nullable(),
        holdsIn: count.nullable(),
        of: count.nullable(),
      }),
    )
    .max(16),
  sensitivity: z
    .array(
      z.object({
        id: note(80),
        label: note(300),
        metric: note(200),
        shift: z.number(),
        standardError: z.number(),
        classification: z.enum(SENSITIVITY_CLASSES),
        origin: statementOriginSchema,
        evidenced: z.boolean(),
      }),
    )
    .max(200),
  assumptionRegister: z
    .array(
      z.object({
        id: note(120),
        text: note(),
        value: note().nullable(),
        origin: statementOriginSchema,
        sensitive: z.boolean(),
        evidenced: z.boolean(),
        effect: note().nullable(),
      }),
    )
    .max(500),
  evidenceMap: z
    .array(
      z.object({
        stakeholderId: note(80),
        name: note(200),
        category: z.enum(STAKEHOLDER_CATEGORIES),
        supporting: count,
        contradicting: count,
        documents: z.array(note(300)).max(100),
        gap: z.boolean(),
      }),
    )
    .max(200),
  traitTable: z
    .array(
      z.object({
        actorId: note(80),
        name: note(200),
        kind: z.enum(['key', 'cohort']),
        members: count,
        size: count,
        traits: z
          .array(
            z.object({
              key: note(40),
              value: z.number(),
              spread: z.number(),
              origin: z.enum(TRAIT_ORIGINS),
            }),
          )
          .max(40),
      }),
    )
    .max(100),
  lookups: z.object({
    findings: z
      .array(
        z.object({
          id: note(80),
          statement: note(600),
          classification: z.enum(STABILITY_CLASSES),
          holdsIn: count,
          of: count,
          interval: z.object({ lo: z.number(), hi: z.number() }),
        }),
      )
      .max(200),
    variants: z.array(z.object({ id: note(80), label: note(200) })).max(16),
    stakeholders: z.array(z.object({ id: note(80), name: note(200) })).max(200),
    documents: z
      .array(
        z.object({
          id: note(80),
          name: note(300),
          origin: statementOriginSchema,
          provenance: note(),
        }),
      )
      .max(100),
  }),
}) satisfies z.ZodType<BriefVisuals>;

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
  /** Whether the comparison could tell the change from no change; a brief made before this was checked reads `clear`. */
  signal: z.enum(BRIEF_SIGNALS).default('clear'),
  /**
   * The revision of each document the brief was assembled from (0 when there was none), so that a
   * later change to any of them can be told from a brief that is still current.
   */
  inputRevisions: z.record(z.string().max(40), z.int().min(0)).default({}),
  /**
   * The data of the page's charts and of the exports' tables as it was when the brief was made, so
   * that they show what the brief's own words rest on even after the stakeholders, the scenario or the
   * critiques have changed. The routes answer with it as `visuals` and leave it out of `brief`.
   * Absent for a brief made before it was kept: its charts are then drawn from the project as it is.
   */
  snapshot: briefVisualsSchema.optional(),
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
 * Everything the page draws and the exports tabulate. It is worked out when the brief is made and kept
 * with it (`DecisionBrief.snapshot`), so that the charts agree with the brief's own words; a brief made
 * before that was kept has it worked out from the project's documents as they are when it is asked for.
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
  /** The data of the charts: the snapshot kept with the brief, or, for an older one, the project's documents as they are. */
  visuals: BriefVisuals | null;
  /** Where `visuals` comes from: kept with the brief when it was made, or drawn from the project as it is now. Null with no visuals. */
  visualsFrom: 'snapshot' | 'current' | null;
  /** The newest completed analysis, which generating would use. Null when there is none. */
  latestAnalysis: { id: string; completedAt: string | null } | null;
  /**
   * What has changed since the brief was made, or since the comparison it rests on was run: the
   * scenario, the stakeholders and the actors (checked against what the comparison recorded, so
   * writing the brief again does not clear them), the critiques, and whether a newer comparison exists.
   * Empty when the brief is current.
   */
  changedSince: string[];
  may: { generate: boolean; export: boolean };
}
