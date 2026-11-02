import {
  RESPONSE_CATEGORIES,
  emptyResponseShares,
  type Analysis,
  type ResponseShares,
  type RunSummary,
  type VariantActorSummary,
} from '../../../../../shared/analysis';

/** What the page reads of the analysis the brief was made from, kept small: the analysis itself is large. */

/** The responses that mean a simulated member ended up looking for an alternative or resisting. */
const ADVERSE = ['switch', 'resist'] as const;
const EPSILON = 1e-9;

/** The share of simulated members ending in switch or resist, every actor counting equally. */
export const adverseOf = (shares: ResponseShares): number => shares.switch + shares.resist;

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;

function standardError(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const centre = mean(values);
  const squares = values.reduce((total, value) => total + (value - centre) ** 2, 0);
  return Math.sqrt(squares / (values.length - 1)) / Math.sqrt(values.length);
}

export interface PairedRun {
  seed: number;
  /** The change's share minus the baseline's, on the same seed. */
  delta: number;
}

export interface PairedRuns {
  variantId: string;
  baselineId: string;
  runs: PairedRun[];
  mean: number;
  error: number;
  higher: number;
  lower: number;
  equal: number;
}

/** The change set against the baseline seed by seed, which is what the brief's paired difference is the mean of. */
export function pairedRunsOf(
  variantRuns: readonly RunSummary[],
  baselineRuns: readonly RunSummary[],
  ids: { variantId: string; baselineId: string },
): PairedRuns | null {
  const baselineBySeed = new Map(baselineRuns.map((run) => [run.seed, run]));
  const runs: PairedRun[] = [];
  for (const run of variantRuns) {
    const base = baselineBySeed.get(run.seed);
    if (!base) continue;
    runs.push({
      seed: run.seed,
      delta: adverseOf(run.responseShares) - adverseOf(base.responseShares),
    });
  }
  if (runs.length === 0) return null;
  const deltas = runs.map((run) => run.delta);
  return {
    ...ids,
    runs,
    mean: mean(deltas),
    error: standardError(deltas),
    higher: deltas.filter((delta) => delta > EPSILON).length,
    lower: deltas.filter((delta) => delta < -EPSILON).length,
    equal: deltas.filter((delta) => Math.abs(delta) <= EPSILON).length,
  };
}

interface ActorTotals {
  actorId: string;
  members: number;
  shares: ResponseShares;
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
      for (const category of RESPONSE_CATEGORIES)
        total.shares[category] += actor.responseShares[category];
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

/** Each group's own results under one variant, from the runs when every run kept them, else from the totals the analysis keeps. */
function actorTotals(analysis: Analysis, variantId: string): ActorTotals[] {
  const result = analysis.variants.find((entry) => entry.variantId === variantId);
  if (!result) return [];
  const detailed = result.runs.length > 0 && result.runs.every((run) => run.byActor.length > 0);
  return detailed ? totalsOfRuns(result.runs) : totalsOfSummaries(result.actors ?? []);
}

/** A group's share has to move by at least this, on the scale from 0 to 1, to be named as affected. */
export const AFFECTED_MIN = 0.01;

export interface Movement {
  actorId: string;
  stakeholderId: string;
  name: string;
  kind: 'key' | 'cohort';
  category: string;
  /** Simulated members sampled for the group: a numerical resolution of the simulation, never a population. */
  members: number;
  /** The group's own share of members ending in switch or resist, under the change and under the baseline. */
  share: number;
  baselineShare: number;
  delta: number;
  /** The group's mean final stance, from -1 (against) to 1 (in favour), under the change and the baseline. */
  stance: number;
  baselineStance: number;
  shares: ResponseShares;
  baselineShares: ResponseShares;
  /** Whether the share moved by at least `AFFECTED_MIN`. */
  affected: boolean;
}

const sameSeeds = (a: readonly RunSummary[], b: readonly RunSummary[]): boolean => {
  if (a.length !== b.length) return false;
  const seeds = new Set(b.map((run) => run.seed));
  return a.every((run) => seeds.has(run.seed));
};

/**
 * Each group's own movement against the baseline, the biggest move first, as the brief ranks the groups
 * it names: by the group's own share, never by how many members were sampled for it. Null when the
 * analysis kept nothing per group for the change or the baseline, or the two did not run the same seeds.
 */
export function movementOf(
  analysis: Analysis,
  variantId: string,
  baselineId: string,
): Movement[] | null {
  const variantRuns = analysis.variants.find((entry) => entry.variantId === variantId)?.runs ?? [];
  const baselineRuns =
    analysis.variants.find((entry) => entry.variantId === baselineId)?.runs ?? [];
  if (!sameSeeds(variantRuns, baselineRuns)) return null;
  const own = actorTotals(analysis, variantId);
  const base = new Map(actorTotals(analysis, baselineId).map((entry) => [entry.actorId, entry]));
  if (own.length === 0 || base.size === 0) return null;
  const actors = new Map(analysis.actors.map((actor) => [actor.id, actor]));
  const rows: Movement[] = [];
  for (const entry of own) {
    const was = base.get(entry.actorId);
    const actor = actors.get(entry.actorId);
    if (!was) continue;
    const share = ADVERSE.reduce((total, category) => total + entry.shares[category], 0);
    const baselineShare = ADVERSE.reduce((total, category) => total + was.shares[category], 0);
    rows.push({
      actorId: entry.actorId,
      stakeholderId: actor?.stakeholderId ?? entry.actorId,
      name: actor?.name ?? entry.actorId,
      kind: actor?.kind ?? 'cohort',
      category: actor?.category ?? 'other',
      members: entry.members,
      share,
      baselineShare,
      delta: share - baselineShare,
      stance: entry.stance,
      baselineStance: was.stance,
      shares: entry.shares,
      baselineShares: was.shares,
      affected: Math.abs(share - baselineShare) >= AFFECTED_MIN,
    });
  }
  return rows.sort(
    (a, b) =>
      Math.abs(b.delta) - Math.abs(a.delta) ||
      a.stance - a.baselineStance - (b.stance - b.baselineStance) ||
      (a.actorId < b.actorId ? -1 : 1),
  );
}

export interface AnalysisFacts {
  analysisId: string;
  baselineId: string | null;
  paired: Record<string, PairedRuns>;
  movement: Record<string, Movement[]>;
}

/** Everything the page draws from the analysis, for each alternative against the baseline. */
export function factsOf(analysis: Analysis): AnalysisFacts {
  const baseline = analysis.config.variants.find((variant) => variant.kind === 'baseline') ?? null;
  const facts: AnalysisFacts = {
    analysisId: analysis.id,
    baselineId: baseline?.id ?? null,
    paired: {},
    movement: {},
  };
  if (!baseline) return facts;
  const baselineRuns =
    analysis.variants.find((entry) => entry.variantId === baseline.id)?.runs ?? [];
  for (const variant of analysis.config.variants) {
    if (variant.kind === 'baseline') continue;
    const runs = analysis.variants.find((entry) => entry.variantId === variant.id)?.runs ?? [];
    const paired = pairedRunsOf(runs, baselineRuns, {
      variantId: variant.id,
      baselineId: baseline.id,
    });
    if (paired) facts.paired[variant.id] = paired;
    const movement = movementOf(analysis, variant.id, baseline.id);
    if (movement) facts.movement[variant.id] = movement;
  }
  return facts;
}
