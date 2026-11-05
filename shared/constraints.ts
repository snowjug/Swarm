import { z } from 'zod';
import {
  CONSTRAINT_IMPACT_CLASSES,
  CONSTRAINT_SOURCES,
  CONSTRAINT_VALIDATIONS,
  EFFECT_CATALOGUE,
  EFFECT_MAX_ROUND,
  constraintEffectSchema,
  constraintImpactSchema,
  type AnalysisConstraints,
  type ConstraintEffect,
  type ConstraintImpact,
  type ConstraintSource,
  type ConstraintValidation,
} from './constraint-effects.js';
import {
  evidenceRefSchema,
  idSchema,
  uncertaintySchema,
  type ModelAvailability,
} from './stakeholders.js';

export * from './constraint-effects.js';

/**
 * Constraints: what limits the decision, kept as a document of its own so that the person reviews them
 * before a simulation and the final answer can say which it rests on. Version 1.
 *
 * A constraint is never a fact because someone, or something, proposed it. Where it came from (`source`),
 * whether anyone has checked it (`validation`) and whether the simulation applies it (`enforcement`) are
 * three separate things, and the last two are decided by rules in `backend/src/constraints`, never by a
 * model. A model may propose the words of a constraint and quote a passage; whether the quote is in the
 * passage is for the server to find out.
 */
export const CONSTRAINT_SCHEMA_VERSION = 1;

export const CONSTRAINT_CATEGORIES = [
  'budget',
  'time',
  'capacity',
  'staffing',
  'technical-feasibility',
  'infrastructure',
  'legal',
  'regulatory',
  'privacy',
  'security',
  'safety',
  'contractual',
  'geographic',
  'cultural',
  'organizational',
  'operational',
  'market',
  'customer',
  'dependency',
  'sequencing',
  'adoption',
  'accessibility',
  'reputational',
  'environmental',
  'data-quality',
  'evidence-quality',
  'uncertainty',
  'reversibility',
] as const;
export type ConstraintCategory = (typeof CONSTRAINT_CATEGORIES)[number];

export const CONSTRAINT_CATEGORY_LABELS: Record<ConstraintCategory, string> = {
  budget: 'Budget',
  time: 'Time',
  capacity: 'Capacity',
  staffing: 'Staffing',
  'technical-feasibility': 'Technical feasibility',
  infrastructure: 'Infrastructure',
  legal: 'Legal',
  regulatory: 'Regulatory',
  privacy: 'Privacy',
  security: 'Security',
  safety: 'Safety',
  contractual: 'Contractual',
  geographic: 'Geographic',
  cultural: 'Cultural',
  organizational: 'Organizational',
  operational: 'Operational',
  market: 'Market',
  customer: 'Customer',
  dependency: 'Dependency',
  sequencing: 'Sequencing',
  adoption: 'Adoption',
  accessibility: 'Accessibility',
  reputational: 'Reputational',
  environmental: 'Environmental',
  'data-quality': 'Data quality',
  'evidence-quality': 'Evidence quality',
  uncertainty: 'Uncertainty',
  reversibility: 'Reversibility',
};

/**
 * The categories where a hard constraint that nobody has settled stops a simulation: proceeding would go
 * past a limit of the law or of safety without anyone having said so.
 */
export const HIGH_STAKES_CATEGORIES: readonly ConstraintCategory[] = [
  'legal',
  'regulatory',
  'safety',
];

export const isHighStakes = (category: ConstraintCategory): boolean =>
  HIGH_STAKES_CATEGORIES.includes(category);

export const CONSTRAINT_HARDNESS = ['hard', 'soft'] as const;
export type ConstraintHardness = (typeof CONSTRAINT_HARDNESS)[number];

/** What a constraint is about: the whole decision, some alternatives, some actors, or the world around them. */
export const CONSTRAINT_SCOPES = ['decision', 'alternatives', 'actors', 'environment'] as const;
export type ConstraintScope = (typeof CONSTRAINT_SCOPES)[number];

export const CONSTRAINT_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type ConstraintSeverity = (typeof CONSTRAINT_SEVERITIES)[number];

/** Where a person's review of a constraint has got to. `removed` and `excluded` stay in the set so the review is auditable. */
export const CONSTRAINT_REVIEWS = [
  'proposed',
  'accepted',
  'edited',
  'added',
  'removed',
  'excluded',
] as const;
export type ConstraintReview = (typeof CONSTRAINT_REVIEWS)[number];

export const CONSTRAINT_ENFORCEMENTS = ['enforced', 'interpretive'] as const;
export type ConstraintEnforcement = (typeof CONSTRAINT_ENFORCEMENTS)[number];

/**
 * Where a constraint the simulation does not apply was taken into account instead. Each is set by the
 * server, from what actually happened, and never typed: the gate lists it, the independent review reads
 * the comparison's record of it, the comparison records it, and a counterfactual view names it.
 */
export const CONSIDERED_IN = ['gate', 'critic', 'counterfactual', 'analysis-record'] as const;
export type ConsideredIn = (typeof CONSIDERED_IN)[number];

/** What a constraint was read from, for the person who has to decide whether to believe it. */
export const CONFIDENCE_BASES = [
  'user-entry',
  'question-quote',
  'scenario-quote',
  'evidence-quote',
  'model-quote',
  'actor-statement',
  'category-prompt',
  'model-reading',
] as const;
export type ConfidenceBasisKind = (typeof CONFIDENCE_BASES)[number];

export const CONFIDENCE_BASIS_WORDS: Record<ConfidenceBasisKind, string> = {
  'user-entry': 'You stated it.',
  'question-quote': 'Your question says so, in these words.',
  'scenario-quote': 'Your scenario says so, in these words.',
  'evidence-quote': 'A source passage says so, in these words, and Swarm found the quote in it.',
  'model-quote':
    'A model proposed it, and Swarm found the quote it gave in a source passage. The model chose it; the source says it.',
  'actor-statement':
    'It is listed as a limit of a simulated actor, which Swarm wrote, not a source.',
  'category-prompt':
    'Swarm suggests it from who is involved. No source or person has said it holds.',
  'model-reading':
    'A model proposed it and no quote of it could be found in the sources. It is a reading, not a finding.',
};

const line = (max: number) => z.string().trim().max(max);
const roundOrNull = z.int().min(1).max(EFFECT_MAX_ROUND).nullable().default(null);

export const constraintWindowSchema = z
  .object({
    fromRound: roundOrNull,
    toRound: roundOrNull,
    /** The window in the words it was found in ("until the review is done"); never read by the engine. */
    text: line(120).default(''),
  })
  .refine(
    (window) =>
      window.fromRound === null || window.toRound === null || window.toRound >= window.fromRound,
    {
      message: 'A window ends in or after the round it starts.',
      path: ['toRound'],
    },
  );
export type ConstraintWindow = z.infer<typeof constraintWindowSchema>;

export const OPEN_WINDOW: ConstraintWindow = { fromRound: null, toRound: null, text: '' };

export const confidenceBasisSchema = z.object({
  kind: z.enum(CONFIDENCE_BASES),
  note: line(240).default(''),
});
export type ConfidenceBasis = z.infer<typeof confidenceBasisSchema>;

const CONFLICT_TOKEN = /^conflicts-with:[a-z0-9][a-z0-9-]{0,47}$/u;
export const conflictToken = (id: string): string => `conflicts-with:${id}`;

export const MAX_CONSTRAINTS = 60;
export const MAX_CLARIFICATIONS = 20;
/** Questions put to a person at once: more would be a form, not an aid. */
export const MAX_OPEN_QUESTIONS = 3;

export const constraintSchema = z.object({
  id: idSchema,
  category: z.enum(CONSTRAINT_CATEGORIES),
  statement: line(400).min(1),
  source: z.enum(CONSTRAINT_SOURCES),
  /** Passages the statement was found in, each with a quote that was found in it. Only a source can add one. */
  evidenceRefs: z.array(evidenceRefSchema).max(5).default([]),
  hardness: z.enum(CONSTRAINT_HARDNESS),
  /**
   * Why it is held hard or soft, in words a person can check against the source: "the source says
   * ‘must’", "a model read it as a firm limit", "you set it to hard". Hardness is a proposal; this is its basis.
   */
  hardnessBasis: line(240).default(''),
  scope: z.enum(CONSTRAINT_SCOPES).default('decision'),
  affectedActorIds: z.array(idSchema).max(60).default([]),
  affectedAlternativeIds: z.array(idSchema).max(8).default([]),
  window: constraintWindowSchema.default(OPEN_WINDOW),
  severity: z.enum(CONSTRAINT_SEVERITIES).default('medium'),
  confidenceBasis: confidenceBasisSchema,
  uncertainty: uncertaintySchema,
  validation: z.enum(CONSTRAINT_VALIDATIONS).default('unvalidated'),
  /** `conflicts-with:<id>` for each constraint this one cannot hold with; empty when none does. Worked out, never typed. */
  conflict: z.array(z.string().regex(CONFLICT_TOKEN)).max(10).default([]),
  impactIfViolated: line(300).default(''),
  /** The scenario assumption this constraint holds only while that assumption holds. */
  assumptionId: idSchema.nullable().default(null),
  mitigations: z.array(line(200)).max(5).default([]),
  /** Worked out from `effects` and the cast, never typed: `enforced` only where the engine applies something. */
  enforcement: z.enum(CONSTRAINT_ENFORCEMENTS).default('interpretive'),
  /** What the engine is to do because of it. Empty for a constraint that is only read. */
  effects: z.array(constraintEffectSchema).max(3).default([]),
  consideredIn: z.array(z.enum(CONSIDERED_IN)).max(CONSIDERED_IN.length).default([]),
  review: z.enum(CONSTRAINT_REVIEWS).default('proposed'),
  /** What the person said about it, such as why they assume it. */
  note: line(300).default(''),
});
export type Constraint = z.infer<typeof constraintSchema>;

// ---------------------------------------------------------------------------------------------
// Open questions
// ---------------------------------------------------------------------------------------------

export const CLARIFICATION_STATUSES = [
  'open',
  'answered',
  'unknown',
  'assumed',
  'excluded',
] as const;
export type ClarificationStatus = (typeof CLARIFICATION_STATUSES)[number];

/** A thing Swarm could not find out and that could change the result: asked once, answered or left unknown by the person. */
export const clarificationSchema = z.object({
  id: idSchema,
  category: z.enum(CONSTRAINT_CATEGORIES),
  question: line(300).min(1),
  /** Why it is asked: what it could change. */
  why: line(300).min(1),
  status: z.enum(CLARIFICATION_STATUSES).default('open'),
  answer: line(400).nullable().default(null),
  /** The constraint the answer made. */
  constraintId: idSchema.nullable().default(null),
});
export type Clarification = z.infer<typeof clarificationSchema>;

// ---------------------------------------------------------------------------------------------
// The coverage gate
// ---------------------------------------------------------------------------------------------

export const GATE_STATUSES = ['clear', 'provisional', 'blocked'] as const;
export type GateStatus = (typeof GATE_STATUSES)[number];

export const GATE_STATUS_WORDS: Record<GateStatus, string> = {
  clear: 'Clear',
  provisional: 'Provisional',
  blocked: 'Blocked',
};

export const constraintRefSchema = z.object({
  id: idSchema,
  category: z.enum(CONSTRAINT_CATEGORIES),
  hardness: z.enum(CONSTRAINT_HARDNESS),
  statement: line(160),
});
export type ConstraintRef = z.infer<typeof constraintRefSchema>;

export const BLOCK_REASONS = ['unresolved-high-stakes', 'violated-by-every-alternative'] as const;
export type BlockReason = (typeof BLOCK_REASONS)[number];

const refs = z.array(constraintRefSchema).max(MAX_CONSTRAINTS).default([]);

/**
 * What the gate found, from the constraints as they stand. It decides nothing about the world: it says
 * what is known, what is assumed, what is missing, and so whether a simulation can start and with what label.
 */
export const constraintCoverageSchema = z.object({
  status: z.enum(GATE_STATUSES),
  /** Whether a person has been through the constraints and none still waits for a first look. */
  reviewed: z.boolean(),
  evaluatedAt: z.iso.datetime(),
  /** One sentence for the top of a page. */
  summary: line(300),
  /** The words a provisional result carries into the comparison and after it. Null when the gate is clear. */
  label: line(300).nullable().default(null),
  /** Hard constraints a person has confirmed. */
  known: refs,
  /** Constraints a person chose to treat as true without checking them. */
  assumed: refs,
  /** Constraints nobody has checked: proposed by Swarm, kept by the person, not confirmed. */
  unvalidated: refs,
  /** Constraints a person marked unknown. They are not applied and not treated as true. */
  unknown: refs,
  conflicting: z
    .array(z.object({ ids: z.array(idSchema).min(2).max(10), basis: line(300) }))
    .max(30)
    .default([]),
  /** What Swarm still needs to know and has not been told. */
  missing: z
    .array(
      z.object({
        clarificationId: idSchema.nullable(),
        category: z.enum(CONSTRAINT_CATEGORIES),
        text: line(300),
      }),
    )
    .max(MAX_CLARIFICATIONS + MAX_CONSTRAINTS)
    .default([]),
  /** Alternatives that a hard constraint forbids. */
  violations: z
    .array(
      z.object({
        alternativeId: idSchema,
        label: line(120),
        constraintIds: z.array(idSchema).min(1).max(20),
      }),
    )
    .max(8)
    .default([]),
  affectedActors: z
    .array(
      z.object({
        actorId: idSchema,
        name: line(120),
        constraintIds: z.array(idSchema).min(1).max(MAX_CONSTRAINTS),
      }),
    )
    .max(60)
    .default([]),
  /** Constraints the simulation does not apply: read and listed, not run. */
  interpretive: refs,
  /** Constraints that name an actor or an alternative that is no longer there. */
  dangling: refs,
  /** Everything that needs a person to confirm it before the result can be called clear. */
  needsConfirmation: refs,
  blockedBy: z
    .array(
      z.object({
        reason: z.enum(BLOCK_REASONS),
        constraintId: idSchema.nullable(),
        text: line(300),
      }),
    )
    .max(20)
    .default([]),
  /** The constraint whose removal moves the headline share the most, from a few paired seeds. Null when none is applied. */
  largestSensitivity: constraintImpactSchema.nullable().default(null),
  reasons: z.array(line(300)).max(16).default([]),
});
export type ConstraintCoverage = z.infer<typeof constraintCoverageSchema>;

// ---------------------------------------------------------------------------------------------
// The artifact `constraints`
// ---------------------------------------------------------------------------------------------

export const constraintSetSchema = z.object({
  version: z.literal(CONSTRAINT_SCHEMA_VERSION),
  constraints: z.array(constraintSchema).max(MAX_CONSTRAINTS),
  /** The gate as it last stood, when the set was last written; `GET .../gate` works it out again. */
  coverage: constraintCoverageSchema.nullable().default(null),
  clarifications: z.array(clarificationSchema).max(MAX_CLARIFICATIONS).default([]),
  generatedAt: z.iso.datetime(),
  mode: z.enum(['rules', 'model', 'user']),
  model: line(120).nullable().default(null),
  /** How the set was made and what that could not do, in a sentence a person can read. */
  note: line(500).default(''),
  /** The revisions of the scenario and the actors the constraints were read against (0 when there was none). */
  scenarioRevision: z.int().min(0),
  actorsRevision: z.int().min(0),
  /** Set when a person has been through the constraints; cleared when something new is proposed. */
  reviewedAt: z.iso.datetime().nullable().default(null),
});
export type ConstraintSet = z.infer<typeof constraintSetSchema>;

/** The kind the artifact store holds the counterfactual views under. */
export const COUNTERFACTUAL_IDS = [
  'without-budget',
  'delayed-implementation',
  'stronger-regulation',
  'lower-adoption',
  'higher-capacity',
  'different-decision-owner',
  'dependency-fails',
] as const;
export type CounterfactualId = (typeof COUNTERFACTUAL_IDS)[number];

export const COUNTERFACTUAL_LABELS: Record<CounterfactualId, string> = {
  'without-budget': 'Without the budget constraint',
  'delayed-implementation': 'Implementation delayed',
  'stronger-regulation': 'Stronger regulatory restriction',
  'lower-adoption': 'Lower adoption',
  'higher-capacity': 'Higher capacity',
  'different-decision-owner': 'A different decision owner',
  'dependency-fails': 'A critical dependency fails',
};

/**
 * One counterfactual view of the proposed scenario, on the same seeds as the base: what was changed, the
 * paired difference in the headline share (members ending in switch or resist, each actor counting equally),
 * and what drove it. A view that does not apply to this project says why and has no difference.
 */
export const counterfactualSchema = z.object({
  id: z.enum(COUNTERFACTUAL_IDS),
  label: line(120),
  /** What was changed, in a sentence. */
  change: line(300),
  applicable: z.boolean(),
  /** Why it could not be run, when it was not. */
  reason: line(240).nullable().default(null),
  /** Counterfactual less base, in share points of simulated members (-1 to 1). Null when not run. */
  deltaVsBase: z.number().min(-1).max(1).nullable().default(null),
  standardError: z.number().min(0).nullable().default(null),
  classification: z.enum(CONSTRAINT_IMPACT_CLASSES).nullable().default(null),
  /** What moved it: the constraints that were changed, or the setting of the view. */
  driver: line(240),
  driverConstraintIds: z.array(idSchema).max(20).default([]),
});
export type Counterfactual = z.infer<typeof counterfactualSchema>;

export const counterfactualSetSchema = z.object({
  version: z.literal(CONSTRAINT_SCHEMA_VERSION),
  generatedAt: z.iso.datetime(),
  /** The scenario the base is: the proposed change of the comparison, by id and label. */
  variantId: idSchema,
  variantLabel: line(120),
  metric: line(200),
  seeds: z.int().min(1),
  baseMean: z.number(),
  /** What the views were made from, so that a later change to any of it is told from a view that still holds. */
  inputs: z.object({
    constraints: z.int().min(0),
    actors: z.int().min(0),
    scenario: z.int().min(0),
  }),
  views: z.array(counterfactualSchema).max(COUNTERFACTUAL_IDS.length),
});
export type CounterfactualSet = z.infer<typeof counterfactualSetSchema>;

/** The compact line a Decision view renders for a counterfactual. */
export interface CounterfactualSummary {
  counterfactual: string;
  deltaVsBase: number | null;
  driver: string;
}

export const summariseCounterfactual = (view: Counterfactual): CounterfactualSummary => ({
  counterfactual: view.label,
  deltaVsBase: view.deltaVsBase,
  driver: view.applicable ? view.driver : (view.reason ?? view.driver),
});

// ---------------------------------------------------------------------------------------------
// What a person sends
// ---------------------------------------------------------------------------------------------

const input = {
  category: z.enum(CONSTRAINT_CATEGORIES),
  statement: line(400).min(3),
  hardness: z.enum(CONSTRAINT_HARDNESS),
  scope: z.enum(CONSTRAINT_SCOPES),
  affectedActorIds: z.array(idSchema).max(60),
  affectedAlternativeIds: z.array(idSchema).max(8),
  window: constraintWindowSchema,
  severity: z.enum(CONSTRAINT_SEVERITIES),
  impactIfViolated: line(300),
  assumptionId: idSchema.nullable(),
  mitigations: z.array(line(200)).max(5),
  effects: z.array(constraintEffectSchema).max(3),
  note: line(300),
};

/** A constraint a person writes, as an answer or as one of their own. It is theirs: `source` is `user`. */
export const constraintInputSchema = z
  .object({
    category: input.category,
    statement: input.statement,
    hardness: input.hardness.default('soft'),
    scope: input.scope.default('decision'),
    affectedActorIds: input.affectedActorIds.default([]),
    affectedAlternativeIds: input.affectedAlternativeIds.default([]),
    window: input.window.default(OPEN_WINDOW),
    severity: input.severity.default('medium'),
    impactIfViolated: input.impactIfViolated.default(''),
    assumptionId: input.assumptionId.default(null),
    mitigations: input.mitigations.default([]),
    effects: input.effects.default([]),
    note: input.note.default(''),
    /** What the person says of it: it holds (the default), it is an assumption, or they do not know. */
    validation: z.enum(['confirmed', 'assumed', 'unknown']).default('confirmed'),
  })
  .strict();
export type ConstraintInput = z.input<typeof constraintInputSchema>;

/** What a person may change on a constraint that is already in the set. Nothing that says where it came from. */
export const constraintPatchSchema = z
  .object({
    category: input.category.optional(),
    statement: input.statement.optional(),
    hardness: input.hardness.optional(),
    scope: input.scope.optional(),
    affectedActorIds: input.affectedActorIds.optional(),
    affectedAlternativeIds: input.affectedAlternativeIds.optional(),
    window: constraintWindowSchema.optional(),
    severity: input.severity.optional(),
    impactIfViolated: input.impactIfViolated.optional(),
    assumptionId: input.assumptionId.optional(),
    mitigations: input.mitigations.optional(),
    effects: input.effects.optional(),
    note: input.note.optional(),
  })
  .strict();
export type ConstraintPatch = z.infer<typeof constraintPatchSchema>;

const revision = { expectedRevision: z.int().min(0) };

/** What a person may do with the constraints and the questions, one at a time. */
export const constraintReviewSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('accept'),
      ids: z.array(idSchema).min(1).max(MAX_CONSTRAINTS),
      ...revision,
    })
    .strict(),
  z.object({ action: z.literal('confirm'), id: idSchema, ...revision }).strict(),
  z
    .object({ action: z.literal('edit'), id: idSchema, patch: constraintPatchSchema, ...revision })
    .strict(),
  z.object({ action: z.literal('add'), constraint: constraintInputSchema, ...revision }).strict(),
  z.object({ action: z.literal('remove'), id: idSchema, ...revision }).strict(),
  z.object({ action: z.literal('restore'), id: idSchema, ...revision }).strict(),
  z
    .object({
      action: z.literal('answer'),
      clarificationId: idSchema,
      constraint: constraintInputSchema,
      ...revision,
    })
    .strict(),
  z
    .object({
      action: z.literal('exclude'),
      id: idSchema.optional(),
      clarificationId: idSchema.optional(),
      ...revision,
    })
    .strict(),
  z
    .object({
      action: z.literal('mark-unknown'),
      id: idSchema.optional(),
      clarificationId: idSchema.optional(),
      ...revision,
    })
    .strict(),
  z
    .object({
      action: z.literal('use-assumption'),
      id: idSchema.optional(),
      clarificationId: idSchema.optional(),
      note: line(300).optional(),
      ...revision,
    })
    .strict(),
  z.object({ action: z.literal('confirm-set'), ...revision }).strict(),
]);
export type ConstraintReviewAction = z.infer<typeof constraintReviewSchema>;
/** What a client sends: the defaults of a constraint it writes are left to the server. */
export type ConstraintReviewInput = z.input<typeof constraintReviewSchema>;

export const proposeConstraintsSchema = z
  .object({
    /** `rules` reads the text on this server. `model` asks the project's model, if the person chooses it. */
    mode: z.enum(['rules', 'model']).default('rules'),
  })
  .strict();
export type ProposeConstraintsInput = z.input<typeof proposeConstraintsSchema>;

/** Every constraint as the person now wants it, for a change of many at once. Nothing may be left out: remove it instead. */
export const putConstraintsSchema = z
  .object({
    constraints: z
      .array(
        constraintInputSchema.extend({
          id: idSchema.optional(),
          validation: z.enum(CONSTRAINT_VALIDATIONS).optional(),
        }),
      )
      .max(MAX_CONSTRAINTS),
    ...revision,
  })
  .strict();
export type PutConstraintsInput = z.input<typeof putConstraintsSchema>;
export type PutConstraintsBody = z.output<typeof putConstraintsSchema>;

// ---------------------------------------------------------------------------------------------
// What the routes answer
// ---------------------------------------------------------------------------------------------

export interface ConstraintAlternativeOption {
  id: string;
  label: string;
}

export interface ConstraintActorOption {
  id: string;
  name: string;
  category: string;
}

/** `GET /api/projects/:id/constraints`. `constraints` is null for a project that has none yet. */
export interface ConstraintsView {
  constraints: ConstraintSet | null;
  revision: number | null;
  /** The gate worked out now, from the constraints, the scenario and the actors as they are. */
  gate: ConstraintCoverage | null;
  /** The questions to put to the person now: the first few of those still open. */
  open: Clarification[];
  /** Whether the scenario or the actors changed after the constraints were read against them. */
  stale: { scenario: boolean; actors: boolean };
  alternatives: ConstraintAlternativeOption[];
  actors: ConstraintActorOption[];
  assumptions: { id: string; text: string }[];
  model: ModelAvailability;
  may: { edit: boolean; run: boolean };
}

/** `GET /api/projects/:id/constraints/gate`: the gate worked out now, with the constraint whose removal moves the result most. */
export interface GateView {
  gate: ConstraintCoverage | null;
  revision: number | null;
}

/** `GET /api/projects/:id/constraints/counterfactuals`. `current` is false when what they were made from has changed. */
export interface CounterfactualsView {
  counterfactuals: CounterfactualSet | null;
  current: boolean;
  may: { run: boolean };
}

// ---------------------------------------------------------------------------------------------
// Selectors for the stages that read the constraints
// ---------------------------------------------------------------------------------------------

export const SOURCE_LABELS: Record<ConstraintSource, string> = {
  user: 'You',
  extracted: 'From evidence',
  inferred: 'Inferred',
};

export const VALIDATION_LABELS: Record<ConstraintValidation, string> = {
  unvalidated: 'Not yet validated',
  confirmed: 'Confirmed',
  rejected: 'Rejected',
  unknown: 'Unknown',
  assumed: 'Assumed',
};

export const HARDNESS_LABELS: Record<ConstraintHardness, string> = {
  hard: 'Hard',
  soft: 'Soft',
};

/** The words for where a constraint came from: your own, a source's, or Swarm's suggestion. */
export function sourceLabel(constraint: Pick<Constraint, 'source' | 'confidenceBasis'>): string {
  if (constraint.source === 'user') {
    const kind = constraint.confidenceBasis.kind;
    if (kind === 'question-quote') return 'From your question';
    if (kind === 'scenario-quote') return 'From your scenario';
  }
  // Where a model chose the constraint, that is said whatever it quoted: the source says it, the model picked it.
  const kind = constraint.confidenceBasis.kind;
  if (kind === 'model-quote' || kind === 'model-reading') return 'Proposed by a model';
  return SOURCE_LABELS[constraint.source];
}

/** A constraint the review has not set aside. */
export const isLive = (constraint: Pick<Constraint, 'review' | 'validation'>): boolean =>
  constraint.review !== 'removed' &&
  constraint.review !== 'excluded' &&
  constraint.validation !== 'rejected';

/**
 * A constraint the simulation takes into account: a person has looked at it and has not set it aside or
 * said that it is unknown. One that is only proposed is not applied, and neither is an unknown, which is
 * never treated as true.
 */
export const isAppliedConstraint = (
  constraint: Pick<Constraint, 'review' | 'validation'>,
): boolean =>
  isLive(constraint) && constraint.review !== 'proposed' && constraint.validation !== 'unknown';

export function liveConstraints(set: Pick<ConstraintSet, 'constraints'> | null): Constraint[] {
  return (set?.constraints ?? []).filter(isLive);
}

/** The questions that are still open, in the order they are asked, at most `MAX_OPEN_QUESTIONS`. */
export function openQuestions(set: Pick<ConstraintSet, 'clarifications'> | null): Clarification[] {
  return (set?.clarifications ?? [])
    .filter((question) => question.status === 'open')
    .slice(0, MAX_OPEN_QUESTIONS);
}

/** "We found three missing constraints that could materially change the outcome." */
export function missingConstraintsSentence(count: number): string {
  const words = ['no', 'one', 'two', 'three'];
  const n = Math.min(count, MAX_OPEN_QUESTIONS);
  if (n <= 0) return 'Nothing is missing that Swarm knows to ask about.';
  const said = words[n] ?? String(n);
  return `We found ${said} missing ${n === 1 ? 'constraint' : 'constraints'} that could materially change the outcome.`;
}

/** What a person reads of an effect: its label and, in a few words, its size. */
export function effectPhrase(effect: ConstraintEffect): string {
  const base = EFFECT_CATALOGUE[effect.kind].label;
  switch (effect.kind) {
    case 'limit-actions':
      return `${base}: takes away ${effect.forbid.join(', ')}`;
    case 'delay':
      return `${base} by ${effect.rounds} ${effect.rounds === 1 ? 'round' : 'rounds'}`;
    case 'reduce-influence':
      return `${base} by ${Math.round(effect.amount * 100)} points`;
    case 'add-cost':
      return `${base} on ${effect.target === 'switching' ? 'switching' : 'taking it up'} by ${effect.amount}`;
    case 'require-approval':
      return `${base}: a stance of at least ${effect.threshold}`;
    case 'add-risk':
      return `${base} by ${effect.amount}`;
    case 'force-sequencing':
      return `${base}: ${effect.gapRounds} ${effect.gapRounds === 1 ? 'round' : 'rounds'} after the earlier actors`;
    default:
      return base;
  }
}

export interface BasisConstraint {
  id: string;
  statement: string;
  category: string;
  hardness: ConstraintHardness;
  source: string;
  validation: string;
  enforcement: ConstraintEnforcement;
  /** What the simulation did with it, in words; empty when it only read it. */
  effects: string[];
  /** Why it was read and not run, when it was not. */
  notApplied: string | null;
}

/**
 * What a decision says about its constraints, in the order a decision view needs it: whether the result
 * is provisional and why, which constraints it was run under and how, what taking each away did, and what
 * needs a person's confirmation next. Every list is empty when there is nothing to say.
 */
export interface ConstraintBasis {
  /** `none` when no constraints were reviewed for the comparison it rests on. */
  status: 'none' | 'clear' | 'provisional';
  provisional: boolean;
  label: string | null;
  reasons: string[];
  constraints: BasisConstraint[];
  /** The hard constraints the result rests on without anyone having confirmed them. */
  weakens: string[];
  /** The constraints that read, not ran: the result does not show their effect. */
  notModelled: string[];
  /** The constraints that were applied and what taking each away did, largest first. */
  drivers: {
    constraintId: string;
    statement: string;
    variantId: string;
    withoutShift: number;
    classification: ConstraintImpact['classification'];
  }[];
  validateNext: string[];
}

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

/**
 * The constraint basis of a comparison, from what the comparison recorded. Pass the comparison's
 * `constraints` record (`Analysis.constraints`); a comparison that recorded none was run without a
 * reviewed set, and the answer says so rather than implying that nothing limits the decision.
 */
export function constraintBasisOf(
  recorded: AnalysisConstraints | undefined | null,
): ConstraintBasis {
  if (!recorded) {
    return {
      status: 'none',
      provisional: false,
      label: null,
      reasons: [],
      constraints: [],
      weakens: [],
      notModelled: [],
      drivers: [],
      validateNext: [],
    };
  }
  const statementOf = new Map<string, string>();
  const rows: BasisConstraint[] = [];
  for (const item of recorded.applied) {
    statementOf.set(item.constraintId, item.statement);
    const existing = rows.find((row) => row.id === item.constraintId);
    const phrase = effectPhrase(item.effect);
    if (existing) existing.effects.push(phrase);
    else {
      rows.push({
        id: item.constraintId,
        statement: item.statement,
        category: item.category,
        hardness: item.hardness,
        source: SOURCE_LABELS[item.source],
        validation: VALIDATION_LABELS[item.validation],
        enforcement: 'enforced',
        effects: [phrase],
        notApplied: null,
      });
    }
  }
  const weakens = recorded.applied
    .filter((item) => item.hardness === 'hard' && item.validation !== 'confirmed')
    .map((item) => item.constraintId);
  for (const item of recorded.notApplied) {
    statementOf.set(item.constraintId, item.statement);
    rows.push({
      id: item.constraintId,
      statement: item.statement,
      category: item.category,
      hardness: item.hardness,
      source: SOURCE_LABELS[item.source],
      validation: VALIDATION_LABELS[item.validation],
      enforcement: 'interpretive',
      effects: [],
      notApplied: item.reason,
    });
  }
  const notModelled = recorded.notApplied
    .filter((item) => item.reason === 'interpretive' || item.reason === 'soft-block')
    .map((item) => item.constraintId);
  const unconfirmed = rows.filter(
    (row) => row.validation !== VALIDATION_LABELS.confirmed && row.notApplied !== 'excluded',
  );
  return {
    status: recorded.status,
    provisional: recorded.status === 'provisional',
    label: recorded.status === 'provisional' ? recorded.label : null,
    reasons: recorded.reasons,
    constraints: rows,
    weakens: [...new Set(weakens)].map((id) => clip(statementOf.get(id) ?? id, 160)),
    notModelled: [...new Set(notModelled)].map((id) => clip(statementOf.get(id) ?? id, 160)),
    drivers: [...recorded.impacts]
      .filter((impact) => impact.classification === 'material')
      .sort(
        (a, b) =>
          Math.abs(b.withoutShift) - Math.abs(a.withoutShift) ||
          a.constraintId.localeCompare(b.constraintId),
      )
      .map((impact) => ({
        constraintId: impact.constraintId,
        statement: clip(statementOf.get(impact.constraintId) ?? impact.constraintId, 160),
        variantId: impact.variantId,
        withoutShift: impact.withoutShift,
        classification: impact.classification,
      })),
    validateNext: unconfirmed.map(
      (row) => `${HARDNESS_LABELS[row.hardness]}: ${clip(row.statement, 140)}`,
    ),
  };
}

/** The sentence a provisional result carries. The gate and the comparison both use it, so that they say the same thing. */
export function provisionalLabel(counts: {
  unvalidated: number;
  assumed: number;
  unknown: number;
  missing: number;
  conflicting: number;
  notModelledHard: number;
}): string {
  const parts: string[] = [];
  const add = (n: number, one: string, many: string): void => {
    if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
  };
  add(counts.unvalidated, 'constraint not yet validated', 'constraints not yet validated');
  add(counts.assumed, 'constraint assumed', 'constraints assumed');
  add(counts.unknown, 'constraint marked unknown', 'constraints marked unknown');
  add(counts.missing, 'question still open', 'questions still open');
  add(counts.conflicting, 'conflict between constraints', 'conflicts between constraints');
  add(counts.notModelledHard, 'hard constraint not modelled', 'hard constraints not modelled');
  return clip(
    `Provisional: the simulation ran with ${parts.join(', ') || 'constraints that are not all confirmed'}. Treat what it shows as conditional on them.`,
    300,
  );
}
