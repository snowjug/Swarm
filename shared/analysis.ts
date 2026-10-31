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

/**
 * A thing that happened in a run, so that a chain can be read back. `causedBy` is what its responder's
 * trigger read, and, in a run that was `explained`, the earlier events a replay showed it needed;
 * `followed` is the earlier events that had only come first.
 */
export const simEventSchema = z.object({
  id: z.string().min(1).max(60),
  round: z.int().min(1).max(MAX_ROUNDS),
  /** A generic kind such as `counter-move`, `scrutiny` or `enablement`; never a scenario script. */
  kind: z.string().min(1).max(60),
  actorId: idSchema.nullable(),
  description: line(300),
  /**
   * The names of the signals its responder watched, then the ids of earlier events that were shown to
   * be needed. An event id here is a cause only in a run that was `explained`; analyses saved before
   * that was tested list earlier events here that merely came first.
   */
  causedBy: z.array(z.string().max(80)).max(8).default([]),
  /**
   * Ids of earlier events that had already landed on actors the responder watches. They came first,
   * and nothing shows that they mattered: in an `explained` run a replay without one still had the
   * event; in any other nothing was tried.
   */
  followed: z.array(z.string().max(80)).max(8).optional(),
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
  /**
   * Set when the run was replayed once for each earlier event that could have mattered to a later one,
   * with that event's responder switched off, so that an event id in `causedBy` was tested. Absent in
   * any run that was not, where an earlier event in `causedBy` only came first.
   */
  explained: z.boolean().optional(),
  work: z.object({
    members: z.int().min(0),
    updates: z.int().min(0),
    /** How many times the run was played again to tell which earlier events a later one needed; absent when it was not. */
    replays: z.int().min(0).optional(),
  }),
});
export type RunOutcome = z.infer<typeof runOutcomeSchema>;

export interface SimulateOptions {
  /** Caps how many members any one cohort simulates, to bound the cost of a run. */
  sampleSizeCap?: number;
  /**
   * `false` turns off the aggregate signals and everything that follows from them (external
   * responders and the events they cause), leaving plain stance dynamics. On by default; switching it
   * off on the same seeds shows how much the second-order effects change an outcome.
   */
  signals?: boolean;
  /**
   * Replays the run for each earlier event that could have mattered to a later one, with that event's
   * responder switched off, and lists as a cause only the events without which the later one did not
   * happen (see `explain.ts`). Off by default, because it costs a replay for each such pair; the analysis
   * asks for it for the one run it keeps in detail.
   */
  explain?: boolean;
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
const sensitivityRowShape = z.object({
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
  /**
   * Present when the value that was moved is not the actor's own but one that the proposed change sets
   * for it, an impact override or an edit of the trait: `value` is what the change set before the move.
   */
  setting: z
    .object({
      source: z.enum(['scenario-override', 'scenario-edit']),
      value: z.number().min(-1).max(1),
    })
    .optional(),
});
// Rows saved while `evidence` labelled a whole impact: only its direction was ever read from passages,
// so the number that was moved was the system's default.
export const sensitivityRowSchema = sensitivityRowShape.transform((row) =>
  row.target.trait === 'impact' && row.assumptionOrigin === 'evidence'
    ? { ...row, assumptionOrigin: 'system-assumption' as const }
    : row,
);
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

/** One actor's end state averaged over the runs of a variant. It is kept even when the runs themselves drop their per-actor detail. */
export const variantActorSummarySchema = z.object({
  actorId: idSchema,
  members: z.int().min(1),
  stanceMean: z.number().min(-1).max(1),
  responseShares: responseSharesSchema,
});
export type VariantActorSummary = z.infer<typeof variantActorSummarySchema>;

export const variantResultSchema = z.object({
  variantId: idSchema,
  runs: z.array(runSummarySchema).max(200),
  /** Spread of the overall mean stance across runs, round by round. */
  trajectory: z.array(trajectoryBandSchema).max(MAX_ROUNDS),
  actors: z.array(variantActorSummarySchema).max(60).optional(),
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

/**
 * The documents a comparison is made from. When one of them changes after the comparison ran, the
 * comparison, and the review and the brief made from it, describe the project as it was: only
 * running the comparison again brings them up to date.
 */
export const ANALYSIS_INPUTS = ['scenario', 'stakeholders', 'actors'] as const;
export type AnalysisInput = (typeof ANALYSIS_INPUTS)[number];

export const ANALYSIS_INPUT_NAMES: Record<AnalysisInput, string> = {
  scenario: 'the scenario',
  stakeholders: 'the stakeholders',
  actors: 'the simulated actors',
};

/** What a list of changes (`changedSince`) says when a comparison has finished after the one the brief or review rests on. */
export const NEWER_ANALYSIS_EXISTS = 'a newer analysis exists';

/**
 * What a list of changes says of a comparison that was saved before the documents it was made from
 * were recorded: whether they have changed since cannot be told, so nothing that rests on it is called
 * current, however often the brief or the review is made again.
 */
export const COMPARISON_INPUTS_UNRECORDED = 'what the comparison was made from was not recorded';

export const comparisonInputsUnrecorded = (changedSince: readonly string[]): boolean =>
  changedSince.includes(COMPARISON_INPUTS_UNRECORDED);

/** Said of such a comparison wherever it is said that the brief or the review may be out of date. */
export const UNRECORDED_INPUTS_ADVICE =
  'The comparison it rests on was saved before Swarm recorded what a comparison is made from, so whether the scenario, the stakeholders and the actors it used are the ones the project holds now cannot be told.';

/**
 * The documents among `changedSince` that a comparison is made from, when running the comparison
 * again is what brings the brief or the review up to date. None when a newer comparison already
 * exists, which making the brief or the review again uses: if that one is out of date too, it is
 * said then.
 */
export const staleComparisonInputs = (changedSince: readonly string[]): AnalysisInput[] =>
  changedSince.includes(NEWER_ANALYSIS_EXISTS)
    ? []
    : ANALYSIS_INPUTS.filter((input) => changedSince.includes(input));

/** "the scenario", "the scenario and the stakeholders", "the scenario, the stakeholders and the simulated actors". */
export function inputsInWords(inputs: readonly AnalysisInput[]): string {
  const names = inputs.map((input) => ANALYSIS_INPUT_NAMES[input]);
  return names.length < 2
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

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
  /**
   * The revision of each document the comparison was made from (0 when there was none): the scenario
   * and the stakeholders it read and the actors it copied, so that a later change to any of them can
   * be told from a comparison that still describes the project. Absent for a comparison saved before
   * this was recorded, whose freshness cannot be told.
   */
  inputRevisions: z.record(z.string().max(40), z.int().min(0)).optional(),
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
