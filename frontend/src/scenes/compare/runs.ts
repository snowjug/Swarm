import type { RoundMetrics, RunComparison } from '../../../../shared/guided';
import type { ProjectDetail, ProjectSummary } from '../../../../shared/types';
import { comparisonMetrics } from '../../lib/metrics';
import { MINUS, signed } from './format';
import { niceStep, ticksBetween } from './scale';

/** How another recorded run stands to the one that is open: never more than the record of branching says. */
export type Relation = 'this' | 'parent' | 'branch' | 'sibling' | 'other';

/** The one hidden sentence that says what the two run names in the heading open. */
export const RUN_HINT = 'Opens the choice of which two recorded runs are set against each other.';
export const RUN_HINT_ID = 'sw-cmp-run-hint';

export const RELATION_WORDS: Record<Relation, string> = {
  this: 'This run',
  parent: 'Its parent',
  branch: 'A branch of it',
  sibling: 'Shares its parent',
  other: 'Another run',
};

export interface RunChoice {
  id: string;
  name: string;
  /** Saved rounds. A run with none cannot be compared. */
  rounds: number;
  status: string;
  relation: Relation;
}

const relationOf = (
  item: Pick<ProjectSummary, 'id' | 'parentId'>,
  open: ProjectDetail,
): Relation =>
  item.id === open.id
    ? 'this'
    : item.id === open.parentId
      ? 'parent'
      : item.parentId === open.id
        ? 'branch'
        : item.parentId !== null && item.parentId === open.parentId
          ? 'sibling'
          : 'other';

const ORDER: Record<Relation, number> = { this: 0, parent: 1, branch: 2, sibling: 3, other: 4 };

/**
 * The recorded runs that can be set against each other: the guided ones with at least one saved round, the open one
 * first, then the ones it is related to by branching, then the rest, the most recently saved first.
 */
export function runChoices(open: ProjectDetail, projects: readonly ProjectSummary[]): RunChoice[] {
  const others = projects.filter(
    (item) => item.id !== open.id && item.workflow === 'guided' && item.currentRound >= 1,
  );
  const mine: RunChoice[] =
    open.workflow === 'guided' && open.rounds.length > 0
      ? [
          {
            id: open.id,
            name: open.name,
            rounds: open.rounds.length,
            status: open.status,
            relation: 'this',
          },
        ]
      : [];
  const rest = others
    .map((item) => ({
      item,
      relation: relationOf(item, open),
      updated: Date.parse(item.updatedAt),
    }))
    .sort((x, y) => ORDER[x.relation] - ORDER[y.relation] || y.updated - x.updated)
    .map(({ item, relation }): RunChoice => ({
      id: item.id,
      name: item.name,
      rounds: item.currentRound,
      status: item.status,
      relation,
    }));
  return [...mine, ...rest];
}

/** What to show first: the open run against the run it was branched from, else one branched from it, else the closest. */
export function defaultPair(choices: readonly RunChoice[]): { base: string; other: string } | null {
  const base = choices.find((choice) => choice.relation === 'this') ?? choices[0];
  if (!base) return null;
  const other = choices.find((choice) => choice.id !== base.id);
  return other ? { base: base.id, other: other.id } : null;
}

export type RunPair = { base: string; other: string };

/** The pair kept to runs that exist; a run that is gone, or chosen on both sides, falls back to the default. */
export function validRunPair(pair: RunPair | null, choices: readonly RunChoice[]): RunPair | null {
  const has = (id: string): boolean => choices.some((choice) => choice.id === id);
  if (pair && has(pair.base) && has(pair.other) && pair.base !== pair.other) return pair;
  return defaultPair(choices);
}

/** Chooses one side. Choosing the run that is on the other side swaps the two. */
export function chooseRun(pair: RunPair, side: 'base' | 'other', id: string): RunPair {
  const opposite = side === 'base' ? 'other' : 'base';
  if (pair[side] === id) return pair;
  if (pair[opposite] === id) return { base: pair.other, other: pair.base };
  return { ...pair, [side]: id };
}

export const METRICS = comparisonMetrics;
export type Metric = keyof RoundMetrics;

export interface MetricPoint {
  round: number;
  base: number | null;
  other: number | null;
  delta: number | null;
}

/** One metric over the rounds both runs recorded. A missing value stays missing: nothing is filled in. */
export function metricSeries(comparison: RunComparison, metric: Metric): MetricPoint[] {
  return comparison.rounds.map((round) => ({
    round: round.round,
    base: round.base?.[metric] ?? null,
    other: round.other?.[metric] ?? null,
    delta: round.delta?.[metric] ?? null,
  }));
}

/** The rounds both runs recorded: a branch that was stopped early has fewer than the run it came from, and nothing fills the rest. */
export const sharedRounds = (comparison: RunComparison): number[] =>
  comparison.rounds
    .filter((round) => round.base !== null && round.other !== null)
    .map((round) => round.round);

/**
 * The first round in which the two runs are not the same, or null when they are the same in every round both recorded.
 * The server's own `identicalThroughRound` decides it, so a run branched from round 3 parts in round 4, but only when
 * both runs recorded round 4: a branch that has not got there has not parted yet, as far as anything shows.
 */
export function partedRound(comparison: RunComparison): number | null {
  const next = comparison.rounds.find(
    (round) =>
      round.round > comparison.identicalThroughRound && round.base !== null && round.other !== null,
  );
  return next?.round ?? null;
}

/** Shares are said as percentages, counts as whole numbers, and everything else to three places. */
export function isShare(metric: Metric): boolean {
  return metric === 'supportShare' || metric === 'oppositionShare' || metric === 'undecidedShare';
}

export function metricText(value: number | null, metric: Metric, delta = false): string {
  if (value === null) return 'Not recorded';
  if (metric === 'activityCount') return delta ? signed(value, 0) : String(value);
  if (isShare(metric)) {
    const points = value * 100;
    const text = Math.abs(points).toFixed(1);
    return delta
      ? `${Number(text) === 0 ? '' : points < 0 ? MINUS : '+'}${text} points`
      : `${text}%`;
  }
  return delta ? signed(value, 3) : value.toFixed(3);
}

/**
 * The metric to look at first: mean inclination, the one that says where the runs stand, unless it never differs, and
 * then the first that does. Null when the two runs are the same in every metric and round recorded.
 */
export function firstMoved(comparison: RunComparison): Metric | null {
  return (
    METRICS.find((metric) =>
      comparison.rounds.some((round) => Math.abs(round.delta?.[metric] ?? 0) > 1e-9),
    ) ?? null
  );
}

/** A piece of the lineage sentence: words, or one of the two runs, so that a name can be a control. */
export type LineagePart = string | { run: 'base' | 'other' };

/**
 * The sentence the server's lineage allows, with the runs as parts so that their names can be set as controls. It
 * never says more than the record of branching does: runs that are not related by branching are said to be
 * unrelated, and nothing of cause is said of them.
 */
export function lineageParts(lineage: RunComparison['lineage']): LineagePart[] {
  const base: LineagePart = { run: 'base' };
  const other: LineagePart = { run: 'other' };
  switch (lineage) {
    case 'base-is-parent':
      return [base, ' is the parent run of ', other, '.'];
    case 'other-is-parent':
      return [other, ' is the parent run of ', base, '.'];
    case 'siblings':
      return [base, ' and ', other, ' share a parent run.'];
    default:
      return [base, ' and ', other, ' are not in the same recorded parent/sibling relationship.'];
  }
}

/** A tight, round axis around some values; shares and counts never go below nothing, and a share never above 1. */
export function metricAxis(
  values: readonly number[],
  metric: Metric,
): { min: number; max: number; ticks: number[] } {
  const floor = metric === 'meanOpinion' ? -1 : 0;
  const ceiling = metric === 'activityCount' ? Number.POSITIVE_INFINITY : 1;
  const low = values.length ? Math.min(...values) : 0;
  const high = values.length ? Math.max(...values) : 1;
  const base = metric === 'meanOpinion' ? [low, high, 0] : [low, high];
  const lo = Math.min(...base);
  const hi = Math.max(...base);
  const step = niceStep(Math.max(hi - lo, metric === 'activityCount' ? 4 : 0.02) / 4);
  const min = Math.max(floor, Math.floor((lo - step * 0.15) / step) * step);
  const max = Math.min(ceiling, Math.ceil((hi + step * 0.15) / step) * step);
  const clean = (value: number): number => Math.round(value * 1e6) / 1e6 || 0;
  return { min: clean(min), max: clean(max), ticks: ticksBetween(clean(min), clean(max), 4) };
}
