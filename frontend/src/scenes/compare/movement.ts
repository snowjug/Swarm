import {
  RESPONSE_CATEGORIES,
  type Analysis,
  type ResponseShares,
  type VariantActorSummary,
} from '../../../../shared/analysis';
import {
  STAKEHOLDER_CATEGORY_LABELS,
  type StakeholderCategory,
} from '../../../../shared/stakeholders';
import { CLUSTER_ORDER, clusterGroup, clusterLabel } from '../../viz/palette';
import { adverseShare, stanceAxis } from '../../lib/analysis';

/** One simulated actor, in two scenarios: where its members ended up in each, and how far that moved. */
export interface Mover {
  id: string;
  name: string;
  role: string;
  kind: 'key' | 'cohort';
  category: StakeholderCategory;
  categoryLabel: string;
  /** The group it gathers in on the map and in the filter. */
  group: string;
  /** Simulated members of the actor (a key actor is one); a cohort's size in the world is an assumption. */
  members: number;
  /** The population the actor stands for in the model: an assumption, never a count of anyone. */
  size: number;
  /** The mean final stance of its members in each scenario, and the difference (b minus a). */
  a: number;
  b: number;
  delta: number;
  sharesA: ResponseShares;
  sharesB: ResponseShares;
}

export type MoverSource = 'actors' | 'runs' | 'none';

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * What each actor's members did in one scenario, averaged over its seeded runs. The per-scenario summary is
 * kept even when the per-run lists were dropped to keep the document small, so it is read first; the
 * per-run lists are the fallback for an analysis that did not keep it. Neither is read as "no members".
 */
function summariesOf(
  analysis: Analysis,
  variantId: string,
): { byActor: Map<string, VariantActorSummary>; source: 'actors' | 'runs' } | null {
  const result = analysis.variants.find((candidate) => candidate.variantId === variantId);
  if (!result) return null;
  if (result.actors && result.actors.length > 0) {
    return {
      byActor: new Map(result.actors.map((entry) => [entry.actorId, entry])),
      source: 'actors',
    };
  }
  const collected = new Map<string, VariantActorSummary[]>();
  for (const run of result.runs) {
    for (const entry of run.byActor) {
      const list = collected.get(entry.actorId) ?? [];
      list.push(entry);
      collected.set(entry.actorId, list);
    }
  }
  if (collected.size === 0) return null;
  const byActor = new Map<string, VariantActorSummary>();
  for (const [actorId, entries] of collected) {
    byActor.set(actorId, {
      actorId,
      members: entries[0]?.members ?? 1,
      stanceMean: mean(entries.map((entry) => entry.stanceMean)),
      responseShares: Object.fromEntries(
        RESPONSE_CATEGORIES.map((category) => [
          category,
          mean(entries.map((entry) => entry.responseShares[category])),
        ]),
      ) as ResponseShares,
    });
  }
  return { byActor, source: 'runs' };
}

/** The actors with their stance in scenario `a` and in scenario `b`, in the order the analysis lists them. */
export function moversOf(
  analysis: Analysis,
  a: string,
  b: string,
): { movers: Mover[]; source: MoverSource } {
  const first = summariesOf(analysis, a);
  const second = summariesOf(analysis, b);
  if (!first || !second) return { movers: [], source: 'none' };
  const movers = analysis.actors.flatMap((actor) => {
    const x = first.byActor.get(actor.id);
    const y = second.byActor.get(actor.id);
    if (!x || !y) return [];
    return [
      {
        id: actor.id,
        name: actor.name,
        role: actor.role,
        kind: actor.kind,
        category: actor.category,
        categoryLabel: STAKEHOLDER_CATEGORY_LABELS[actor.category],
        group: clusterGroup(actor.category).id,
        members: y.members,
        size: actor.size,
        a: x.stanceMean,
        b: y.stanceMean,
        delta: y.stanceMean - x.stanceMean,
        sharesA: x.responseShares,
        sharesB: y.responseShares,
      } satisfies Mover,
    ];
  });
  return {
    movers,
    source:
      movers.length === 0
        ? 'none'
        : first.source === 'actors' && second.source === 'actors'
          ? 'actors'
          : 'runs',
  };
}

/** Those who moved furthest first, in either direction; ties by name so that the order never shuffles. */
export const rankMovers = (movers: readonly Mover[]): Mover[] =>
  [...movers].sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta) || x.name.localeCompare(y.name));

export interface MoverGroup {
  id: string;
  label: string;
  count: number;
}

/** The groups the actors fall into, in the order every filter and legend of the product lists them. */
export function groupsOf(movers: readonly Mover[]): MoverGroup[] {
  return CLUSTER_ORDER.flatMap((id) => {
    const count = movers.filter((mover) => mover.group === id).length;
    return count > 0 ? [{ id, label: clusterLabel(id), count }] : [];
  });
}

export const inGroup = (movers: readonly Mover[], group: string | null): Mover[] =>
  group === null ? [...movers] : movers.filter((mover) => mover.group === group);

/** The clusters of the map to hide when only one group is shown. */
export const hiddenGroups = (movers: readonly Mover[], group: string | null): Set<string> =>
  new Set(
    group === null
      ? []
      : groupsOf(movers)
          .filter((entry) => entry.id !== group)
          .map((entry) => entry.id),
  );

/** One scale for every row, so that a short line is short against the same ruler as a long one. */
export function stanceScale(movers: readonly Mover[]): {
  min: number;
  max: number;
  ticks: number[];
} {
  return stanceAxis(movers.flatMap((mover) => [mover.a, mover.b]));
}

/**
 * How far the colour of the map runs: the largest move, so that the strongest mover is the deepest colour and a map
 * of small moves is not washed out by a scale made for large ones. Never narrower than five hundredths, so that
 * noise is not painted as an effect.
 */
export function deltaScale(movers: readonly Mover[]): number {
  const reach = Math.max(0, ...movers.map((mover) => Math.abs(mover.delta)));
  return Math.max(0.05, Math.ceil(reach * 100 - 1e-9) / 100);
}

/** A mover counts as moved when the difference is at least this much of the scale of -1 to 1. */
export const MOVED_AT = 0.005;

export function topMover(movers: readonly Mover[]): Mover | null {
  const first = rankMovers(movers)[0];
  return first && Math.abs(first.delta) >= MOVED_AT ? first : null;
}

/** How far an actor's members ended adverse (looking for an alternative or resisting) in each scenario. */
export const adverseOf = (mover: Mover): { a: number; b: number } => ({
  a: adverseShare(mover.sharesA),
  b: adverseShare(mover.sharesB),
});
