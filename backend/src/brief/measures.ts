import {
  RESPONSE_CATEGORIES,
  emptyResponseShares,
  type Analysis,
  type Finding,
  type ResponseCategory,
  type ResponseShares,
  type RunSummary,
  type Variant,
  type VariantActorSummary,
} from '../../../shared/analysis.js';
import { ADVERSE_PHRASE } from '../analysis/findings.js';
import { mean, standardError } from '../analysis/stats.js';

/**
 * Whether a finding says that a group's largest response is the adverse one: looking for an
 * alternative or resisting. Only such a finding bears on the share the answer leads with; which of
 * two other responses is a group's largest does not.
 */
export const aboutAdverseShare = (finding: Finding): boolean =>
  finding.kind === 'majority-response' && finding.statement.includes(ADVERSE_PHRASE);

/**
 * Plain arithmetic over the recorded runs of an analysis. Nothing here estimates anything. There are
 * two kinds of figure, and they need different things from the stored analysis:
 *
 *  - The engine's own overall figures give every actor the same weight: the share of simulated
 *    members in a response is a mean over actors of each actor's own share, so an actor with 20
 *    sampled members counts as much as one with 1. Every run keeps them, so they are there however the
 *    analysis was stored, and the brief leads with them.
 *  - Counts of simulated members add up each actor's sampled members, so they depend on how many
 *    members were sampled for each group: a numerical resolution, not a population. They need the
 *    per-actor results. Those are kept for every run when the document fits; when it does not, the
 *    runs lose them and only the totals over the runs of each variant are kept. A count is then a mean
 *    only, with no range over runs and no run-by-run pairing, and where even the totals are missing
 *    the count is `null`: an absent list is never read as zero.
 */

/** The responses that mean a simulated member ended up looking for an alternative or resisting. */
export const ADVERSE_CATEGORIES: readonly ResponseCategory[] = ['switch', 'resist'];

/** The responses that mean a simulated member ended up going along, perhaps with conditions. */
export const FAVOURABLE_CATEGORIES: readonly ResponseCategory[] = [
  'adopt',
  'accept-with-conditions',
];

/** Scores that differ only by rounding are the same. */
const EPSILON = 1e-9;

export const shareIn = (shares: ResponseShares, categories: readonly ResponseCategory[]): number =>
  categories.reduce((total, category) => total + shares[category], 0);

/**
 * The share of simulated members ending in switch or resist, every actor counting equally: the
 * measure the engine, the sensitivity rows and the critics all call the headline share.
 */
export const adverseShareOf = (shares: ResponseShares): number => shares.switch + shares.resist;

/** A mean over runs, with the lowest and highest run when each run's own figure was kept. */
export interface Spread {
  mean: number;
  /** Null when the figure could only be worked out as a mean. */
  min: number | null;
  max: number | null;
}

export function spreadOf(values: readonly number[]): Spread {
  if (values.length === 0) return { mean: 0, min: 0, max: 0 };
  return { mean: mean(values), min: Math.min(...values), max: Math.max(...values) };
}

const meanOnly = (value: number): Spread => ({ mean: value, min: null, max: null });

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

export const adverseIn = (run: RunSummary): number => adverseCount(countsIn(run));

/** What one actor did over the seeded runs of a variant: its sampled members and the mean of its own shares. */
export interface ActorTotals {
  actorId: string;
  /** Simulated members sampled for the actor in one run. */
  members: number;
  /** Mean over the runs of the share of its members in each response. */
  shares: ResponseShares;
  /** Mean final stance over the runs. */
  stance: number;
}

function totalsOfRuns(runs: readonly RunSummary[]): ActorTotals[] {
  const order: string[] = [];
  const by = new Map<
    string,
    { members: number; shares: ResponseShares; stance: number; n: number }
  >();
  for (const run of runs) {
    for (const actor of run.byActor) {
      let total = by.get(actor.actorId);
      if (!total) {
        total = { members: actor.members, shares: emptyResponseShares(), stance: 0, n: 0 };
        by.set(actor.actorId, total);
        order.push(actor.actorId);
      }
      for (const category of RESPONSE_CATEGORIES) {
        total.shares[category] += actor.responseShares[category];
      }
      total.stance += actor.stanceMean;
      total.n += 1;
    }
  }
  return order.map((actorId) => {
    const total = by.get(actorId)!;
    const shares = emptyResponseShares();
    for (const category of RESPONSE_CATEGORIES) shares[category] = total.shares[category] / total.n;
    return { actorId, members: total.members, shares, stance: total.stance / total.n };
  });
}

const totalsOfSummaries = (summaries: readonly VariantActorSummary[]): ActorTotals[] =>
  summaries.map((summary) => ({
    actorId: summary.actorId,
    members: summary.members,
    shares: summary.responseShares,
    stance: summary.stanceMean,
  }));

/**
 * Where a variant's per-actor figures come from: `runs` when every run kept its own, `totals` when
 * only the totals over the runs were kept (the document was too large), `none` when neither was.
 */
export type Detail = 'runs' | 'totals' | 'none';

export interface VariantMeasure {
  variant: Variant;
  runs: RunSummary[];
  detail: Detail;
  /** Per-actor means over the runs, however they were stored. Empty when `detail` is `none`. */
  actors: ActorTotals[];
  /** Simulated members sampled in one run, all actors together; null when no per-actor figure survives. */
  members: number | null;
  /** Simulated members in each response, a mean over the runs; null when no per-actor figure survives. */
  counts: Record<ResponseCategory, Spread> | null;
  /** Simulated members looking for an alternative or resisting; null when no per-actor figure survives. */
  adverseCount: Spread | null;
  /** The share of simulated members in each response, every actor counting equally, over the runs. */
  shares: Record<ResponseCategory, Spread>;
  /** The share ending in switch or resist, every actor counting equally, over the runs. */
  share: Spread;
  stance: Spread;
}

/** The variants that have recorded runs, in the order the analysis was configured with. */
export function measureVariants(analysis: Analysis): VariantMeasure[] {
  const measures: VariantMeasure[] = [];
  for (const variant of analysis.config.variants) {
    const result = analysis.variants.find((candidate) => candidate.variantId === variant.id);
    if (!result || result.runs.length === 0) continue;
    const { runs } = result;
    const detailed = runs.every((run) => run.byActor.length > 0);
    const actors = detailed ? totalsOfRuns(runs) : totalsOfSummaries(result.actors ?? []);
    const detail: Detail = detailed ? 'runs' : actors.length > 0 ? 'totals' : 'none';
    let members: number | null = null;
    let counts: VariantMeasure['counts'] = null;
    let adverse: Spread | null = null;
    if (detail === 'runs') {
      const perRun = runs.map(countsIn);
      members = Math.round(mean(runs.map(membersIn)));
      counts = Object.fromEntries(
        RESPONSE_CATEGORIES.map((category) => [
          category,
          spreadOf(perRun.map((entry) => entry[category])),
        ]),
      ) as Record<ResponseCategory, Spread>;
      adverse = spreadOf(perRun.map(adverseCount));
    } else if (detail === 'totals') {
      members = actors.reduce((total, actor) => total + actor.members, 0);
      const means = emptyResponseShares();
      for (const actor of actors) {
        for (const category of RESPONSE_CATEGORIES) {
          means[category] += actor.shares[category] * actor.members;
        }
      }
      counts = Object.fromEntries(
        RESPONSE_CATEGORIES.map((category) => [category, meanOnly(means[category])]),
      ) as Record<ResponseCategory, Spread>;
      adverse = meanOnly(adverseCount(means));
    }
    measures.push({
      variant,
      runs,
      detail,
      actors,
      members,
      counts,
      adverseCount: adverse,
      shares: Object.fromEntries(
        RESPONSE_CATEGORIES.map((category) => [
          category,
          spreadOf(runs.map((run) => run.responseShares[category])),
        ]),
      ) as Record<ResponseCategory, Spread>,
      share: spreadOf(runs.map((run) => adverseShareOf(run.responseShares))),
      stance: spreadOf(runs.map((run) => run.stanceMean)),
    });
  }
  return measures;
}

/**
 * A variant against the baseline on the same seeds, in the engine's own measure: the share of
 * simulated members ending in switch or resist, every actor counting equally. It needs only what every
 * run keeps, so it reads the same whether or not the per-actor results were stored.
 */
export interface SharePairing {
  /** Seeds that were run under both the variant and the baseline. */
  pairs: number;
  /** Pairs in which the share is higher under the variant, and in which it is lower. */
  higher: number;
  lower: number;
  /** The share under each, a mean over the paired seeds. */
  variantMean: number;
  baselineMean: number;
  /** Mean of the paired differences, variant minus baseline, and the standard error of that mean. */
  delta: number;
  standardError: number;
  /** Mean paired change of the overall final stance, on the scale from -1 to 1. */
  stanceDelta: number;
}

export function pairShares(
  variantRuns: readonly RunSummary[],
  baselineRuns: readonly RunSummary[],
): SharePairing {
  const baselineBySeed = new Map(baselineRuns.map((run) => [run.seed, run]));
  const after: number[] = [];
  const before: number[] = [];
  const differences: number[] = [];
  const stances: number[] = [];
  let higher = 0;
  let lower = 0;
  for (const run of variantRuns) {
    const base = baselineBySeed.get(run.seed);
    if (!base) continue;
    const now = adverseShareOf(run.responseShares);
    const was = adverseShareOf(base.responseShares);
    after.push(now);
    before.push(was);
    differences.push(now - was);
    stances.push(run.stanceMean - base.stanceMean);
    if (now > was + EPSILON) higher += 1;
    else if (now < was - EPSILON) lower += 1;
  }
  return {
    pairs: differences.length,
    higher,
    lower,
    variantMean: mean(after),
    baselineMean: mean(before),
    delta: mean(differences),
    standardError: standardError(differences),
    stanceDelta: mean(stances),
  };
}

export interface Pairing {
  /** Seeds that were run under both the variant and the baseline, and had per-actor results to count. */
  pairs: number;
  /** Pairs in which more simulated members ended up adverse than under the baseline. */
  worse: number;
  better: number;
  /** Mean change in the number of adverse members, variant minus baseline, on the same seed. */
  adverseDelta: number;
  stanceDelta: number;
}

type Reading = (run: RunSummary) => { adverse: number; favourable: number; stance: number } | null;

// A run that kept no per-actor results has no members to count: it is not read as a run of none.
const overall: Reading = (run) => {
  if (run.byActor.length === 0) return null;
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
    return {
      adverse: shareIn(actor.responseShares, ADVERSE_CATEGORIES) * actor.members,
      favourable: shareIn(actor.responseShares, FAVOURABLE_CATEGORIES) * actor.members,
      stance: actor.stanceMean,
    };
  };

/**
 * Compares a variant with the baseline seed by seed in simulated members, so that the same random
 * draws sit on both sides. It counts only the seeds whose runs kept per-actor results: where none did,
 * `pairs` is 0 and nothing is paired, which is not a difference of zero.
 */
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
  /** Simulated members of the actor in one run: how many were sampled for it. */
  members: number;
  /** Mean number of them who ended up adverse. */
  adverse: number;
  /** Mean number of them who ended up going along, perhaps with conditions. */
  favourable: number;
  /** The same as shares of the actor's own members, which do not depend on how many were sampled. */
  adverseShare: number;
  favourableShare: number;
  stance: number;
}

export function actorMeasure(measure: VariantMeasure, actorId: string): ActorMeasure | null {
  const totals = measure.actors.find((actor) => actor.actorId === actorId);
  if (!totals) return null;
  const adverseShare = shareIn(totals.shares, ADVERSE_CATEGORIES);
  const favourableShare = shareIn(totals.shares, FAVOURABLE_CATEGORIES);
  return {
    actorId,
    members: totals.members,
    adverse: adverseShare * totals.members,
    favourable: favourableShare * totals.members,
    adverseShare,
    favourableShare,
    stance: totals.stance,
  };
}

/** How one group's own outcome moved against the baseline, whatever number of members was sampled for it. */
export interface GroupShift {
  actorId: string;
  members: number;
  /** Mean share of the group's simulated members ending in switch or resist, under the variant. */
  share: number;
  baselineShare: number | null;
  /** Variant minus baseline; null when the baseline has nothing for the group or the seeds differ. */
  delta: number | null;
  stance: number;
  stanceDelta: number | null;
  /** Paired seeds in which the group's share was higher under the variant, when each run's own results were kept. */
  higherIn: number | null;
  pairs: number | null;
}

const sameSeeds = (a: readonly RunSummary[], b: readonly RunSummary[]): boolean =>
  a.length === b.length &&
  [...a.map((run) => run.seed)]
    .sort((x, y) => x - y)
    .every((seed, index) => seed === [...b.map((run) => run.seed)].sort((x, y) => x - y)[index]);

/**
 * Each group's own movement, whichever way the per-actor results were stored. The mean paired
 * difference is the difference of the two means when both variants ran the same seeds, so totals give
 * it exactly; the run-by-run counts need each run's own results and are null without them.
 */
export function groupShifts(
  variant: VariantMeasure,
  baseline: VariantMeasure | null,
): GroupShift[] {
  const aligned = baseline !== null && sameSeeds(variant.runs, baseline.runs);
  const runByRun = aligned && variant.detail === 'runs' && baseline.detail === 'runs';
  return variant.actors.map((actor) => {
    const own = actorMeasure(variant, actor.actorId);
    const base = baseline && aligned ? actorMeasure(baseline, actor.actorId) : null;
    let higherIn: number | null = null;
    let pairs: number | null = null;
    if (runByRun && baseline) {
      const baselineBySeed = new Map(baseline.runs.map((run) => [run.seed, run]));
      higherIn = 0;
      pairs = 0;
      for (const run of variant.runs) {
        const now = run.byActor.find((entry) => entry.actorId === actor.actorId);
        const was = baselineBySeed
          .get(run.seed)
          ?.byActor.find((entry) => entry.actorId === actor.actorId);
        if (!now || !was) continue;
        pairs += 1;
        if (adverseShareOf(now.responseShares) > adverseShareOf(was.responseShares) + EPSILON) {
          higherIn += 1;
        }
      }
    }
    return {
      actorId: actor.actorId,
      members: actor.members,
      share: own?.adverseShare ?? 0,
      baselineShare: base?.adverseShare ?? null,
      delta: base && own ? own.adverseShare - base.adverseShare : null,
      stance: actor.stance,
      stanceDelta: base ? actor.stance - base.stance : null,
      higherIn,
      pairs,
    };
  });
}

/** A group's share has to move by at least this, on the scale from 0 to 1, to be named as affected. */
export const AFFECTED_MIN = 0.01;

export interface Headline {
  /** The proposed change: the first alternative the analysis ran, or the only variant there is. */
  variant: VariantMeasure;
  baseline: VariantMeasure | null;
  /** The comparison in the engine's own measure, every actor counting equally. */
  pairing: SharePairing | null;
  /** The finding that states the direction against the baseline, when the analysis recorded one. */
  finding: Finding | null;
  /** The groups whose own share moved against the baseline, the biggest move first. */
  groups: GroupShift[];
  /**
   * Whether each group's own movement could be worked out at all: false when the stored analysis kept
   * no per-actor results for the change or the baseline, or the two did not run the same seeds. An
   * empty `groups` then says nothing, where otherwise it says that no group moved.
   */
  groupsKnown: boolean;
}

export function baselineOf(measures: readonly VariantMeasure[]): VariantMeasure | null {
  return measures.find((measure) => measure.variant.kind === 'baseline') ?? null;
}

/** The groups that moved by at least `AFFECTED_MIN`, the biggest move first, ties by stance and then name. */
export function movedGroups(
  variant: VariantMeasure,
  baseline: VariantMeasure | null,
): GroupShift[] {
  return groupShifts(variant, baseline)
    .filter((group) => group.delta !== null && Math.abs(group.delta) >= AFFECTED_MIN)
    .sort(
      (a, b) =>
        Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0) ||
        (a.stanceDelta ?? 0) - (b.stanceDelta ?? 0) ||
        (a.actorId < b.actorId ? -1 : 1),
    );
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
    pairing: baseline ? pairShares(variant.runs, baseline.runs) : null,
    finding: directions.find((finding) => finding.actorId === null) ?? directions[0] ?? null,
    groups: baseline ? movedGroups(variant, baseline) : [],
    groupsKnown:
      baseline !== null &&
      variant.detail !== 'none' &&
      baseline.detail !== 'none' &&
      sameSeeds(variant.runs, baseline.runs),
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
