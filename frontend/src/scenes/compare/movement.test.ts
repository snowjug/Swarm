import { describe, expect, it } from 'vitest';
import { analysisFixture } from '../../../../shared/lab-fixtures';
import type { Analysis } from '../../../../shared/analysis';
import {
  deltaScale,
  groupsOf,
  hiddenGroups,
  inGroup,
  moversOf,
  rankMovers,
  stanceScale,
  topMover,
} from './movement';

const SHARES = {
  adopt: 0.1,
  'accept-with-conditions': 0.2,
  wait: 0.4,
  'adapt-defensively': 0.1,
  switch: 0.1,
  resist: 0.1,
};

/** The fixture with a per-scenario summary of each actor, the way the engine keeps it, so that two scenarios can differ. */
function withSummaries(): Analysis {
  const analysis = analysisFixture();
  const stance = (variant: 'baseline' | 'proposed-change', id: string): number => {
    const moved: Record<string, number> = {
      provider: -0.02,
      subscribers: -0.31,
      'rival-provider': 0.04,
      regulator: -0.005,
      resellers: -0.12,
    };
    return variant === 'baseline' ? 0.01 : 0.01 + (moved[id] ?? 0);
  };
  for (const result of analysis.variants) {
    result.actors = analysis.actors.map((actor) => ({
      actorId: actor.id,
      members: actor.sampleSize,
      stanceMean: stance(result.variantId as 'baseline' | 'proposed-change', actor.id),
      responseShares: SHARES,
    }));
  }
  return analysis;
}

describe('who moves between two scenarios', () => {
  it('reads each actor’s stance in both scenarios and the difference of them', () => {
    const { movers, source } = moversOf(withSummaries(), 'baseline', 'proposed-change');
    expect(source).toBe('actors');
    expect(movers).toHaveLength(5);
    const subscribers = movers.find((mover) => mover.id === 'subscribers')!;
    expect(subscribers.a).toBeCloseTo(0.01);
    expect(subscribers.b).toBeCloseTo(-0.3);
    expect(subscribers.delta).toBeCloseTo(-0.31);
    expect(subscribers.categoryLabel).toBe('Bears cost');
  });

  it('ranks by how far they moved in either direction, and never shuffles ties', () => {
    const { movers } = moversOf(withSummaries(), 'baseline', 'proposed-change');
    expect(rankMovers(movers).map((mover) => mover.id)).toEqual([
      'subscribers',
      'resellers',
      'rival-provider',
      'provider',
      'regulator',
    ]);
    const tied = movers.map((mover) => ({ ...mover, delta: 0.1 }));
    const names = rankMovers(tied).map((mover) => mover.name);
    expect(names).toEqual([...names].sort((x, y) => x.localeCompare(y)));
  });

  it('names the actor that moved most, and nobody when no one moved', () => {
    const { movers } = moversOf(withSummaries(), 'baseline', 'proposed-change');
    expect(topMover(movers)?.id).toBe('subscribers');
    expect(topMover(movers.map((mover) => ({ ...mover, delta: 0.001 })))).toBeNull();
    expect(topMover([])).toBeNull();
  });

  it('falls back to the per-run lists when the summary was not kept, and averages them', () => {
    const analysis = analysisFixture();
    const { movers, source } = moversOf(analysis, 'baseline', 'proposed-change');
    expect(source).toBe('runs');
    expect(movers).toHaveLength(5);
    expect(movers[0]!.b).toBeLessThan(movers[0]!.a);
  });

  it('says there is nothing to show, not that nobody moved, when neither list was kept', () => {
    const analysis = analysisFixture();
    for (const result of analysis.variants) for (const run of result.runs) run.byActor = [];
    expect(moversOf(analysis, 'baseline', 'proposed-change')).toEqual({
      movers: [],
      source: 'none',
    });
    expect(moversOf(analysis, 'baseline', 'ghost').source).toBe('none');
  });

  it('groups the actors the way the map does, in its order, and filters to one group', () => {
    const { movers } = moversOf(withSummaries(), 'baseline', 'proposed-change');
    const groups = groupsOf(movers);
    expect(groups.map((group) => group.id)).toEqual(['decide', 'bear', 'rival', 'work', 'rules']);
    expect(groups.reduce((sum, group) => sum + group.count, 0)).toBe(5);
    expect(inGroup(movers, 'bear').map((mover) => mover.id)).toEqual(['subscribers']);
    expect(inGroup(movers, null)).toHaveLength(5);
    expect([...hiddenGroups(movers, 'bear')].sort()).toEqual(['decide', 'rival', 'rules', 'work']);
    expect(hiddenGroups(movers, null).size).toBe(0);
  });

  it('draws every row on one ruler that holds every stance it shows', () => {
    const { movers } = moversOf(withSummaries(), 'baseline', 'proposed-change');
    const axis = stanceScale(movers);
    for (const mover of movers) {
      expect(mover.a).toBeGreaterThanOrEqual(axis.min);
      expect(mover.b).toBeGreaterThanOrEqual(axis.min);
      expect(mover.a).toBeLessThanOrEqual(axis.max);
    }
  });

  it('colours the map on the scale of the largest move, never finer than noise', () => {
    const { movers } = moversOf(withSummaries(), 'baseline', 'proposed-change');
    expect(deltaScale(movers)).toBe(0.31);
    expect(deltaScale(movers.map((mover) => ({ ...mover, delta: 0.073 })))).toBe(0.08);
    expect(deltaScale(movers.map((mover) => ({ ...mover, delta: 0.001 })))).toBe(0.05);
    expect(deltaScale([])).toBe(0.05);
  });
});
