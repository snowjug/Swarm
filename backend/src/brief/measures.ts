import {
  RESPONSE_CATEGORIES,
  emptyResponseShares,
  type Analysis,
  type Finding,
  type ResponseCategory,
  type RunSummary,
  type Variant,
} from '../../../shared/analysis.js';

/**
 * Plain arithmetic over the recorded runs of an analysis. Nothing here estimates anything: every
 * figure is a count or a mean of what the seeded runs recorded, in simulated members.
 */

/** The responses that mean a simulated member ended up looking for an alternative or resisting. */
export const ADVERSE_CATEGORIES: readonly ResponseCategory[] = ['switch', 'resist'];

export interface Spread {
  mean: number;
  min: number;
  max: number;
}

export function spreadOf(values: readonly number[]): Spread {
  if (values.length === 0) return { mean: 0, min: 0, max: 0 };
  return {
    mean: values.reduce((total, value) => total + value, 0) / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

/** The simulated members in one run: key actors, and the sampled members of each cohort. */
export const membersIn = (run: RunSummary): number =>
  run.byActor.reduce((total, actor) => total + actor.members, 0);

/** How many simulated members ended in each response, from each actor's shares. */
export function countsIn(run: RunSummary): Record<ResponseCategory, number> {
  const counts = emptyResponseShares();
  for (const actor of run.byActor) {
    for (const category of RESPONSE_CATEGORIES) {
      counts[category] += actor.responseShares[category] * actor.members;
    }
  }
  return counts;
}

export const adverseCount = (counts: Record<ResponseCategory, number>): number =>
  ADVERSE_CATEGORIES.reduce((total, category) => total + counts[category], 0);

/** The responses that mean a simulated member ended up going along, perhaps with conditions. */
export const FAVOURABLE_CATEGORIES: readonly ResponseCategory[] = [
  'adopt',
  'accept-with-conditions',
];

export const adverseIn = (run: RunSummary): number => adverseCount(countsIn(run));

export interface VariantMeasure {
  variant: Variant;
  runs: RunSummary[];
  /** Simulated members in one run. */
  members: number;
  responses: Record<ResponseCategory, Spread>;
  adverse: Spread;
  stance: Spread;
}

/** The variants that have recorded runs, in the order the analysis was configured with. */
export function measureVariants(analysis: Analysis): VariantMeasure[] {
  const measures: VariantMeasure[] = [];
  for (const variant of analysis.config.variants) {
    const result = analysis.variants.find((candidate) => candidate.variantId === variant.id);
    if (!result || result.runs.length === 0) continue;
    const counts = result.runs.map(countsIn);
    const responses = Object.fromEntries(
      RESPONSE_CATEGORIES.map((category) => [
        category,
        spreadOf(counts.map((entry) => entry[category])),
      ]),
    ) as Record<ResponseCategory, Spread>;
    measures.push({
      variant,
      runs: result.runs,
      members: Math.round(spreadOf(result.runs.map(membersIn)).mean),
      responses,
      adverse: spreadOf(counts.map(adverseCount)),
      stance: spreadOf(result.runs.map((run) => run.stanceMean)),
    });
  }
  return measures;
}

export interface Pairing {
  /** Seeds that were run under both the variant and the baseline. */
  pairs: number;
  /** Pairs in which more simulated members ended up adverse than under the baseline. */
  worse: number;
  better: number;
  /** Mean change in the number of adverse members, variant minus baseline, on the same seed. */
  adverseDelta: number;
  stanceDelta: number;
}

type Reading = (run: RunSummary) => { adverse: number; favourable: number; stance: number } | null;

const overall: Reading = (run) => {
  const counts = countsIn(run);
  return {
    adverse: adverseCount(counts),
    favourable: FAVOURABLE_CATEGORIES.reduce((total, category) => total + counts[category], 0),
    stance: run.stanceMean,
  };
};
const ofActor =
  (actorId: string): Reading =>
  (run) => {
    const actor = run.byActor.find((candidate) => candidate.actorId === actorId);
    if (!actor) return null;
    const share = (categories: readonly ResponseCategory[]): number =>
      categories.reduce((total, category) => total + actor.responseShares[category], 0) *
      actor.members;
    return {
      adverse: share(ADVERSE_CATEGORIES),
      favourable: share(FAVOURABLE_CATEGORIES),
      stance: actor.stanceMean,
    };
  };

/** Compares a variant with the baseline seed by seed, so that the same random draws sit on both sides. */
export function pairRuns(
  variantRuns: readonly RunSummary[],
  baselineRuns: readonly RunSummary[],
  actorId: string | null = null,
): Pairing {
  const read = actorId === null ? overall : ofActor(actorId);
  const baselineBySeed = new Map(baselineRuns.map((run) => [run.seed, run]));
  let pairs = 0;
  let worse = 0;
  let better = 0;
  let adverseDelta = 0;
  let stanceDelta = 0;
  for (const run of variantRuns) {
    const base = baselineBySeed.get(run.seed);
    const after = read(run);
    const before = base ? read(base) : null;
    if (!after || !before) continue;
    pairs += 1;
    adverseDelta += after.adverse - before.adverse;
    stanceDelta += after.stance - before.stance;
    if (after.adverse > before.adverse) worse += 1;
    else if (after.adverse < before.adverse) better += 1;
  }
  return {
    pairs,
    worse,
    better,
    adverseDelta: pairs === 0 ? 0 : adverseDelta / pairs,
    stanceDelta: pairs === 0 ? 0 : stanceDelta / pairs,
  };
}

export interface ActorMeasure {
  actorId: string;
  /** Simulated members of the actor in one run. */
  members: number;
  /** Mean number of them who ended up adverse. */
  adverse: number;
  /** Mean number of them who ended up going along, perhaps with conditions. */
  favourable: number;
  stance: number;
}

export function actorMeasure(runs: readonly RunSummary[], actorId: string): ActorMeasure | null {
  const read = ofActor(actorId);
  const readings = runs.flatMap((run) => {
    const reading = read(run);
    return reading ? [reading] : [];
  });
  if (readings.length === 0) return null;
  const members =
    runs.flatMap((run) => run.byActor).find((actor) => actor.actorId === actorId)?.members ?? 0;
  return {
    actorId,
    members,
    adverse: spreadOf(readings.map((entry) => entry.adverse)).mean,
    favourable: spreadOf(readings.map((entry) => entry.favourable)).mean,
    stance: spreadOf(readings.map((entry) => entry.stance)).mean,
  };
}

export interface Headline {
  /** The proposed change: the first alternative the analysis ran, or the only variant there is. */
  variant: VariantMeasure;
  baseline: VariantMeasure | null;
  pairing: Pairing | null;
  /** The finding that states the direction against the baseline, when the analysis recorded one. */
  finding: Finding | null;
}

export function baselineOf(measures: readonly VariantMeasure[]): VariantMeasure | null {
  return measures.find((measure) => measure.variant.kind === 'baseline') ?? null;
}

export function headlineOf(
  analysis: Analysis,
  measures: readonly VariantMeasure[],
): Headline | null {
  const variant = measures.find((measure) => measure.variant.kind === 'alternative') ?? measures[0];
  if (!variant) return null;
  const baseline = variant.variant.kind === 'baseline' ? null : baselineOf(measures);
  const directions = analysis.findings.filter(
    (finding) =>
      finding.kind === 'direction-vs-baseline' && finding.variantId === variant.variant.id,
  );
  return {
    variant,
    baseline,
    pairing: baseline ? pairRuns(variant.runs, baseline.runs) : null,
    finding: directions.find((finding) => finding.actorId === null) ?? directions[0] ?? null,
  };
}

export const findingsFor = (
  analysis: Analysis,
  where: { variantId?: string; actorId?: string | null; kind?: Finding['kind'] },
): Finding[] =>
  analysis.findings.filter(
    (finding) =>
      (where.variantId === undefined || finding.variantId === where.variantId) &&
      (where.actorId === undefined || finding.actorId === where.actorId) &&
      (where.kind === undefined || finding.kind === where.kind),
  );
