import { z } from 'zod';
import {
  MAX_ROUNDS,
  variantSchema,
  type Analysis,
  type AnalysisStatus,
  type Cost,
  type Variant,
} from './analysis.js';

/**
 * How big a comparison of scenarios may be, and how its size is worked out, so that the server that
 * refuses an over-large request and the page that estimates one use the same arithmetic.
 */
export const MIN_RUNS_PER_VARIANT = 3;
export const MAX_RUNS_PER_VARIANT = 200;
export const DEFAULT_RUNS_PER_VARIANT = 30;
export const RUNS_PER_VARIANT_CHOICES = [10, 30, 100] as const;
export const MAX_VARIANTS = 8;
/** Rounds each seeded run simulates unless the request says otherwise. */
export const DEFAULT_ROUNDS = 12;
/** Every simulated run of one comparison, sensitivity included. */
export const MAX_TOTAL_RUNS = 2_400;
/** Sensitivity reuses at most this many of the seeds, so that its cost stays bounded. */
export const SENSITIVITY_SEED_CAP = 30;
/** A person's saved comparisons per project; the oldest finished ones are removed beyond this. */
export const MAX_STORED_ANALYSES = 12;

/**
 * What the description of a scenario says once a person has chosen how strongly it lands. A scenario the
 * system made says that its intensity is a system assumption, so one without this note is read that way.
 */
export const USER_SET_NOTE = 'was set by you';
export const isSetByPerson = (variant: Pick<Variant, 'description'>): boolean =>
  variant.description.includes(USER_SET_NOTE);

export interface RunPlan {
  /** Variants times seeded runs. */
  mainRuns: number;
  /** Seeds the sensitivity step reuses; 0 when it is off or has nothing to move. */
  sensitivitySeeds: number;
  sensitivityRuns: number;
  totalRuns: number;
}

export function planRuns(input: {
  variants: number;
  runsPerVariant: number;
  sensitivity: boolean;
  /** One-at-a-time changes of an assumption that the sensitivity step would make. */
  perturbations: number;
}): RunPlan {
  const mainRuns = input.variants * input.runsPerVariant;
  const sensitivitySeeds =
    input.sensitivity && input.perturbations > 0
      ? Math.min(input.runsPerVariant, SENSITIVITY_SEED_CAP)
      : 0;
  const sensitivityRuns = sensitivitySeeds * input.perturbations;
  return { mainRuns, sensitivitySeeds, sensitivityRuns, totalRuns: mainRuns + sensitivityRuns };
}

/** What a person may ask for. `variants: 'auto'` is a baseline, the proposed change and each alternative. */
export const startAnalysisSchema = z.strictObject({
  runsPerVariant: z
    .int()
    .min(MIN_RUNS_PER_VARIANT)
    .max(MAX_RUNS_PER_VARIANT)
    .default(DEFAULT_RUNS_PER_VARIANT),
  baseSeed: z.int().min(1).max(2_147_483_647).optional(),
  variants: z
    .union([z.literal('auto'), z.array(variantSchema).min(2).max(MAX_VARIANTS)])
    .default('auto'),
  sensitivity: z.boolean().default(true),
  rounds: z.int().min(3).max(MAX_ROUNDS).optional(),
});
export type StartAnalysisInput = z.input<typeof startAnalysisSchema>;

/** One saved comparison without its results, for choosing between them. */
export interface AnalysisSummary {
  id: string;
  status: AnalysisStatus;
  createdAt: string;
  completedAt: string | null;
  runsPerVariant: number;
  variants: { id: string; label: string }[];
  sensitivity: boolean;
  progress: Analysis['progress'];
  findings: number;
  sensitivityRows: number;
  cost: Cost;
  fidelityLabel: string;
  error: Analysis['error'];
}

/** What the next comparison would use, so that the page can offer it before anything has run. */
export interface AnalysisReadiness {
  /** The cast of the project: null until actors have been created from approved stakeholders. */
  actors: { count: number; members: number } | null;
  /** A baseline, the proposed change and one scenario for each alternative, with their stated intensities. */
  suggestedVariants: Variant[];
  perturbations: number;
  rounds: number;
  may: { run: boolean };
}

export interface AnalysisList {
  analyses: AnalysisSummary[];
  readiness: AnalysisReadiness;
}
