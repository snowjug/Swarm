import { z } from 'zod';
import { actorRelationSchema, actorSchema, idSchema } from './stakeholders.js';

/**
 * What each simulated member ends up doing, derived from where their stance ends and what the actor
 * is like (see RESPONSE_MEANINGS). It is a reading of the simulation, never an observed behaviour.
 */
export const RESPONSE_CATEGORIES = [
  'adopt',
  'accept-with-conditions',
  'wait',
  'adapt-defensively',
  'switch',
  'resist',
] as const;
export type ResponseCategory = (typeof RESPONSE_CATEGORIES)[number];
export type ResponseShares = Record<ResponseCategory, number>;

export const RESPONSE_LABELS: Record<ResponseCategory, string> = {
  adopt: 'Go along',
  'accept-with-conditions': 'Accept with conditions',
  wait: 'Wait and see',
  'adapt-defensively': 'Adapt to limit the impact',
  switch: 'Look for an alternative',
  resist: 'Resist',
};

export const RESPONSE_MEANINGS: Record<ResponseCategory, string> = {
  adopt: 'Final stance is clearly favourable.',
  'accept-with-conditions': 'Final stance is mildly favourable.',
  wait: 'Final stance is near neutral: the member has not committed.',
  'adapt-defensively':
    'Final stance is mildly unfavourable: the member adjusts to limit the effect.',
  switch: 'Final stance is clearly unfavourable and switching is cheap for this actor.',
  resist: 'Final stance is clearly unfavourable and switching is costly for this actor.',
};

export function emptyResponseShares(): ResponseShares {
  return {
    adopt: 0,
    'accept-with-conditions': 0,
    wait: 0,
    'adapt-defensively': 0,
    switch: 0,
    resist: 0,
  };
}

export const responseSharesSchema = z.object({
  adopt: z.number().min(0).max(1),
  'accept-with-conditions': z.number().min(0).max(1),
  wait: z.number().min(0).max(1),
  'adapt-defensively': z.number().min(0).max(1),
  switch: z.number().min(0).max(1),
  resist: z.number().min(0).max(1),
});

const line = (max: number) => z.string().trim().max(max);

/**
 * One scenario to simulate: the baseline (nothing changes) or a way the change could be made. The
 * change lands in `round`, with `intensity` from 0 to 1; how it lands on each actor is that actor's
 * `impact` trait unless `impactOverrides` says otherwise.
 */
export const variantSchema = z.object({
  id: idSchema,
  label: line(120).min(1),
  kind: z.enum(['baseline', 'alternative']),
  description: line(600).default(''),
  round: z.int().min(1).max(36).default(1),
  intensity: z.number().min(0).max(1),
  impactOverrides: z.record(idSchema, z.number().min(-1).max(1)).default({}),
  traitEdits: z
    .array(
      z.object({
        actorId: idSchema,
        trait: z.string().min(1).max(40),
        value: z.number().min(-1).max(1),
      }),
    )
    .max(40)
    .default([]),
});
export type Variant = z.infer<typeof variantSchema>;

export const MAX_ROUNDS = 36;

/** Everything the simulator needs for one seeded run. */
export const simulationSpecSchema = z.object({
  actors: z.array(actorSchema).min(1).max(60),
  relations: z.array(actorRelationSchema).max(240).default([]),
  rounds: z.int().min(3).max(MAX_ROUNDS),
  variant: variantSchema,
});
export type SimulationSpec = z.infer<typeof simulationSpecSchema>;

// ---------------------------------------------------------------------------------------------
// One run
// ---------------------------------------------------------------------------------------------

/** A thing that happened in a run, with what it followed from, so that a chain can be read back. */
export const simEventSchema = z.object({
  id: z.string().min(1).max(60),
  round: z.int().min(1).max(MAX_ROUNDS),
  /** A generic kind such as `counter-move`, `scrutiny` or `enablement`; never a scenario script. */
  kind: z.string().min(1).max(60),
  actorId: idSchema.nullable(),
  description: line(300),
  /** Ids of earlier events, or names of signals, that this followed from. */
  causedBy: z.array(z.string().max(80)).max(8).default([]),
});
export type SimEvent = z.infer<typeof simEventSchema>;

export const actorOutcomeSchema = z.object({
  actorId: idSchema,
  members: z.int().min(1),
  stanceMean: z.number().min(-1).max(1),
  responseShares: responseSharesSchema,
});
export type ActorOutcome = z.infer<typeof actorOutcomeSchema>;

export const roundAggregateSchema = z.object({
  round: z.int().min(1).max(MAX_ROUNDS),
  stanceMean: z.number().min(-1).max(1),
  responseShares: responseSharesSchema,
  byActor: z.array(z.object({ actorId: idSchema, stanceMean: z.number().min(-1).max(1) })).max(60),
  /** Named aggregate indicators the engine derived, such as the share of members leaning to switch. */
  signals: z.record(z.string().max(60), z.number()).default({}),
});
export type RoundAggregate = z.infer<typeof roundAggregateSchema>;

/** Aggregates of one seeded run. Individual members are never kept: only what they add up to. */
export const runOutcomeSchema = z.object({
  seed: z.int().min(1).max(2_147_483_647),
  variantId: idSchema,
  rounds: z.array(roundAggregateSchema).min(1).max(MAX_ROUNDS),
  final: z.object({
    stanceMean: z.number().min(-1).max(1),
    responseShares: responseSharesSchema,
    byActor: z.array(actorOutcomeSchema).max(60),
  }),
  events: z.array(simEventSchema).max(200).default([]),
  work: z.object({ members: z.int().min(0), updates: z.int().min(0) }),
});
export type RunOutcome = z.infer<typeof runOutcomeSchema>;

export interface SimulateOptions {
  /** Caps how many members any one cohort simulates, to bound the cost of a run. */
  sampleSizeCap?: number;
}

/**
 * The seam between the engine and the analysis. A simulator is pure and deterministic: the same spec
 * and seed give the same outcome. Anything that makes a run vary must come from the seed.
 */
export type Simulator = (
  spec: SimulationSpec,
  seed: number,
  options?: SimulateOptions,
) => RunOutcome;

// ---------------------------------------------------------------------------------------------
// A set of runs
// ---------------------------------------------------------------------------------------------

export const FINDING_KINDS = [
  'majority-response',
  'direction-vs-baseline',
  'threshold-crossing',
  'ordering',
  'second-order-event',
] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

export const STABILITY_CLASSES = ['repeatable', 'mostly-repeatable', 'unstable', 'rare'] as const;
export type StabilityClass = (typeof STABILITY_CLASSES)[number];

/**
 * A statement about the runs that is either true of a run or not, and how often it was true. There is
 * no confidence score: `holdsIn` of `of` runs, a 95% Wilson interval for that share, and a class
 * from documented cut-offs on the interval.
 */
export const findingSchema = z.object({
  id: z.string().min(1).max(80),
  kind: z.enum(FINDING_KINDS),
  variantId: idSchema,
  actorId: idSchema.nullable(),
  /** The finding in words a person can read, with its numbers. */
  statement: line(500),
  /** The test applied to each run, so that the finding can be checked. */
  predicate: line(400),
  holdsIn: z.int().min(0),
  of: z.int().min(1),
  interval: z.object({ lo: z.number().min(0).max(1), hi: z.number().min(0).max(1) }),
  classification: z.enum(STABILITY_CLASSES),
});
export type Finding = z.infer<typeof findingSchema>;

export const SENSITIVITY_CLASSES = ['assumption-sensitive', 'robust', 'inconclusive'] as const;
export type SensitivityClass = (typeof SENSITIVITY_CLASSES)[number];

/**
 * What happened to the headline outcome when one assumption was moved by `perturbation` and nothing
 * else changed, measured on the same seeds. `shift` is the mean paired difference and `standardError`
 * its noise; `assumption-sensitive` means the shift is clearly larger than that noise and material.
 */
export const sensitivityRowSchema = z.object({
  id: z.string().min(1).max(80),
  target: z.object({
    kind: z.enum(['trait', 'intensity', 'population']),
    actorId: idSchema.nullable(),
    trait: z.string().max(40).nullable(),
  }),
  label: line(200),
  perturbation: z.number(),
  metric: line(120),
  baseMean: z.number(),
  shift: z.number(),
  standardError: z.number().min(0),
  classification: z.enum(SENSITIVITY_CLASSES),
  /** Where the perturbed assumption came from, so that a sensitive but unevidenced one stands out. */
  assumptionOrigin: z.enum(['evidence', 'user', 'system-assumption', 'model', 'scenario']),
});
export type SensitivityRow = z.infer<typeof sensitivityRowSchema>;

export const fidelitySchema = z.object({
  /** `rules`: every actor follows declared rules; the outcome is a consequence of the assumptions. */
  engine: z.enum(['rules', 'hybrid']),
  keyActors: z.enum(['rules', 'model']),
  cohorts: z.literal('rules'),
  repeatedRuns: z.int().min(1),
  /** How many times the model-driven part was run. Run-to-run variation of a model is unmeasured when 1. */
  modelRepeats: z.int().min(0),
  label: line(160),
  caveats: z.array(line(300)).max(10),
});
export type Fidelity = z.infer<typeof fidelitySchema>;

export const costSchema = z.object({
  modelCalls: z.int().min(0),
  inputTokens: z.int().min(0),
  outputTokens: z.int().min(0),
  simulatedRuns: z.int().min(0),
  simulatedMembers: z.int().min(0),
  wallMs: z.int().min(0),
});
export type Cost = z.infer<typeof costSchema>;

/** One run's end state, kept for every seed so that every finding can be recounted. */
export const runSummarySchema = z.object({
  seed: z.int().min(1).max(2_147_483_647),
  stanceMean: z.number().min(-1).max(1),
  responseShares: responseSharesSchema,
  byActor: z.array(actorOutcomeSchema).max(60),
});
export type RunSummary = z.infer<typeof runSummarySchema>;

export const trajectoryBandSchema = z.object({
  round: z.int().min(1).max(MAX_ROUNDS),
  p10: z.number().min(-1).max(1),
  p50: z.number().min(-1).max(1),
  p90: z.number().min(-1).max(1),
});

export const variantResultSchema = z.object({
  variantId: idSchema,
  runs: z.array(runSummarySchema).max(200),
  /** Spread of the overall mean stance across runs, round by round. */
  trajectory: z.array(trajectoryBandSchema).max(MAX_ROUNDS),
});
export type VariantResult = z.infer<typeof variantResultSchema>;

export const ANALYSIS_STATUSES = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

/** The artifact `analysis` (one per run set; the key is its id). */
export const analysisSchema = z.object({
  id: idSchema,
  status: z.enum(ANALYSIS_STATUSES),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable().default(null),
  config: z.object({
    runsPerVariant: z.int().min(3).max(200),
    baseSeed: z.int().min(1).max(2_147_483_647),
    rounds: z.int().min(3).max(MAX_ROUNDS),
    variants: z.array(variantSchema).min(1).max(8),
    sensitivity: z.boolean(),
  }),
  /** The cast and relations the runs used, copied so that the analysis stays reproducible. */
  actors: z.array(actorSchema).min(1).max(60),
  relations: z.array(actorRelationSchema).max(240).default([]),
  fidelity: fidelitySchema,
  progress: z.object({ completedRuns: z.int().min(0), totalRuns: z.int().min(0) }),
  variants: z.array(variantResultSchema).max(8).default([]),
  findings: z.array(findingSchema).max(120).default([]),
  sensitivity: z.array(sensitivityRowSchema).max(120).default([]),
  /** The full detail of the run nearest the median, for reading a chain of events back. */
  representativeRun: runOutcomeSchema.nullable().default(null),
  /** Whether a deeper (for example model-assisted) run of the same project agrees with the ensemble. */
  crossCheck: z
    .object({
      primaryStanceMean: z.number().min(-1).max(1).nullable(),
      withinEnsembleRange: z.boolean().nullable(),
      note: line(400),
    })
    .nullable()
    .default(null),
  cost: costSchema,
  error: z
    .object({ code: z.string().max(60), message: line(400) })
    .nullable()
    .default(null),
});
export type Analysis = z.infer<typeof analysisSchema>;
