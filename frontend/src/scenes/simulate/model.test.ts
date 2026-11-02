import { describe, expect, it } from 'vitest';
import type { Analysis, RunOutcome } from '../../../../shared/analysis';
import { analysisFixture } from '../../../../shared/lab-fixtures';
import {
  alignmentAt,
  bandAt,
  causalLinks,
  lanesOf,
  movesIn,
  moversOf,
  movementOf,
  narrationOf,
  niceAxis,
  niceScale,
  replayOf,
  seriesOf,
  stancesAt,
  storyOf,
  traceOf,
  variantColours,
} from './model';

const shares = {
  adopt: 0.1,
  'accept-with-conditions': 0.1,
  wait: 0.5,
  'adapt-defensively': 0.1,
  switch: 0.1,
  resist: 0.1,
};

/** A run of four rounds in which two actors move apart and one event follows another. */
function runFixture(analysis: Analysis, over: Partial<RunOutcome> = {}): RunOutcome {
  const [a, b] = analysis.actors;
  const round = (n: number, a1: number, b1: number) => ({
    round: n,
    stanceMean: (a1 + b1) / 2,
    responseShares: shares,
    byActor: [
      { actorId: a!.id, stanceMean: a1 },
      { actorId: b!.id, stanceMean: b1 },
    ],
    signals: { 'adverse-share': n / 10, 'switching-pressure': 0.05 },
  });
  return {
    seed: 7,
    variantId: 'proposed-change',
    rounds: [round(1, 0, 0), round(2, -0.04, 0.01), round(3, -0.1, 0.02), round(4, -0.12, 0.03)],
    final: { stanceMean: -0.045, responseShares: shares, byActor: [] },
    events: [
      {
        id: 'e1',
        round: 2,
        kind: 'counter-move',
        actorId: a!.id,
        description: 'First.',
        causedBy: ['adverse-share'],
      },
      {
        id: 'e2',
        round: 3,
        kind: 'scrutiny',
        actorId: b!.id,
        description: 'Second.',
        causedBy: ['e1'],
      },
    ],
    explained: true,
    work: { members: 10, updates: 40 },
    ...over,
  };
}

const analysis = (over: Partial<Analysis> = {}): Analysis => {
  const base = analysisFixture();
  return { ...base, representativeRun: runFixture(base), ...over };
};

describe('the colour scale of a run', () => {
  it('reaches full colour at the largest move in the data, so that small moves are seen', () => {
    expect(niceScale([0.01, -0.12, 0.03])).toBe(0.12);
    expect(niceScale([])).toBe(0.04);
    expect(niceScale([-1, 0.5])).toBe(1);
  });
  it('frames a range of stances with round figures that include nothing-changed', () => {
    const axis = niceAxis([-0.06, -0.02, 0.01]);
    expect(axis.min).toBeLessThanOrEqual(-0.06);
    expect(axis.max).toBeGreaterThanOrEqual(0.01);
    expect(axis.ticks).toContain(0);
    expect(axis.ticks.length).toBeGreaterThan(2);
    expect(axis.ticks.length).toBeLessThan(10);
  });
});

describe('replaying the run that was kept in detail', () => {
  it('has nothing to replay without a run, or without the scenario it played', () => {
    expect(replayOf(analysis({ representativeRun: null }))).toBeNull();
    const base = analysis();
    expect(
      replayOf({ ...base, representativeRun: { ...runFixture(base), variantId: 'gone' } }),
    ).toBeNull();
  });

  it('reads every round in order, with where the change lands and how the events fall', () => {
    const base = analysis();
    const replay = replayOf(base)!;
    expect(replay.firstRound).toBe(1);
    expect(replay.lastRound).toBe(4);
    expect(replay.changeRound).toBe(2);
    expect(replay.scale).toBe(0.12);
    expect(replay.eventsByRound.get(2)).toHaveLength(1);
    expect(replay.explained).toBe(true);
  });

  it('gives where each actor stands in a round and how it got there', () => {
    const base = analysis();
    const replay = replayOf(base)!;
    const [a] = base.actors;
    expect(stancesAt(replay, 3).get(a!.id)).toBeCloseTo(-0.1);
    expect(traceOf(replay, a!.id).map((point) => point.round)).toEqual([1, 2, 3, 4]);
    expect(movementOf(replay, a!.id)).toBeCloseTo(-0.12);
    expect(movementOf(replay, 'nobody')).toBe(0);
  });

  it('draws a link between actors only where a replay showed one event needed the other', () => {
    const base = analysis();
    const replay = replayOf(base)!;
    const links = causalLinks(replay, 3);
    expect(links).toHaveLength(1);
    expect(links[0]!.from).toBe(base.actors[0]!.id);
    expect(links[0]!.to).toBe(base.actors[1]!.id);
    expect(causalLinks(replay, 2)).toEqual([]);
    const untested = replayOf({
      ...base,
      representativeRun: { ...base.representativeRun!, explained: false },
    })!;
    expect(causalLinks(untested, 3)).toEqual([]);
  });
});

describe('what happens in a round', () => {
  it('says who moved from the round before, and nobody where nobody did', () => {
    const base = analysis();
    const replay = replayOf(base)!;
    const [a, b] = base.actors;
    expect(replay.peakMove).toBeCloseTo(0.06);
    expect(movesIn(replay, 1)).toEqual([]);
    const second = movesIn(replay, 2);
    expect(second[0]!.actorId).toBe(a!.id);
    expect(second[0]!.move).toBeCloseTo(-0.04);
    expect(second.map((entry) => entry.actorId)).not.toContain('nobody');
    // The second actor moved by a hundredth: less than a fifth of the largest move, so it is not said to have moved.
    expect(movesIn(replay, 3).map((entry) => entry.actorId)).toEqual([a!.id]);
    expect(movesIn(replay, 4).map((entry) => entry.actorId)).toEqual([a!.id]);
    expect(movesIn(replay, 4)[0]!.actorId).not.toBe(b!.id);
  });

  it('narrates a round from what the run recorded: the change first, then what was set off, then who moved', () => {
    const base = analysis();
    const replay = replayOf(base)!;
    expect(narrationOf(replay, 1)).toMatchObject({ kind: 'start' });
    const change = narrationOf(replay, 2);
    expect(change.kind).toBe('change');
    expect(change.text).toMatch(/^The change lands on \d+ actors?$|no actor is set to feel it/u);
    expect(change.tag).toBe('strength 0.70');
    const event = narrationOf(replay, 3);
    expect(event).toMatchObject({ kind: 'event', tag: 'scrutiny' });
    expect(event.text).toContain('set something off');
    expect(event.actorIds).toEqual([base.actors[1]!.id]);
    expect(narrationOf(replay, 4)).toMatchObject({ kind: 'move', tag: '-0.02' });
    // Where nobody moved, nothing is said to have moved.
    const [a, b] = base.actors;
    const flat = (n: number) => ({
      ...runFixture(base).rounds[0]!,
      round: n,
      byActor: [
        { actorId: a!.id, stanceMean: 0.05 },
        { actorId: b!.id, stanceMean: -0.05 },
      ],
    });
    const still = replayOf({
      ...base,
      representativeRun: {
        ...runFixture(base),
        rounds: [flat(1), flat(2), flat(3), flat(4)],
        events: [],
      },
    })!;
    expect(narrationOf(still, 3)).toMatchObject({ kind: 'quiet', actorIds: [] });
  });

  it('counts the connected pairs that lean together and apart, only where both ends lean clearly', () => {
    const base = analysis();
    const replay = replayOf(base)!;
    const [a, b] = base.actors;
    const edges = [{ id: 'ab', from: a!.id, to: b!.id }];
    // Round 1: both near neutral.
    expect(alignmentAt(replay, edges, 1)).toMatchObject({ together: 0, apart: 0, quiet: 1 });
    // The scale is the run's largest move (0.12), so the band is 0.024: -0.1 against +0.02 is one lean and one near neutral.
    expect(alignmentAt(replay, edges, 3)).toMatchObject({ together: 0, apart: 0, quiet: 1 });
    // Round 4: -0.12 against +0.03, and both are past the band of 0.024: they lean opposite ways.
    expect(alignmentAt(replay, edges, 4)).toMatchObject({ together: 0, apart: 1, quiet: 0 });
    expect(alignmentAt(replay, edges, 4).byEdge.get('ab')).toBe('apart');
    // An edge with an actor the run does not have is not counted.
    expect(alignmentAt(replay, [{ id: 'x', from: a!.id, to: 'gone' }], 4)).toMatchObject({
      together: 0,
      apart: 0,
      quiet: 0,
    });
  });

  it('keeps the spread of all the runs, so that one run is seen among them', () => {
    const base = analysis();
    const replay = replayOf(base)!;
    const proposed = base.variants.find((entry) => entry.variantId === 'proposed-change');
    const point = proposed?.trajectory[0];
    if (point)
      expect(bandAt(replay, point.round)).toEqual({
        p10: point.p10,
        p50: point.p50,
        p90: point.p90,
      });
    expect(bandAt(replay, 99)).toBeNull();
  });
});

describe('what a running simulation has done', () => {
  const running = (completedRuns: number, over: Partial<Analysis['config']> = {}) => ({
    config: { ...analysisFixture().config, runsPerVariant: 10, ...over },
    progress: { completedRuns, totalRuns: 20 + 30 },
  });

  it('runs one seed at a time across every scenario, so the lanes fill together', () => {
    const lanes = lanesOf(running(7), 3);
    expect(lanes.phase).toBe('runs');
    expect(lanes.lanes.map((lane) => lane.done)).toEqual([4, 3]);
    expect(lanes.lanes.every((lane) => lane.of === 10)).toBe(true);
  });

  it('moves on to the sensitivity runs once the scenarios are done, and then to reading the results', () => {
    const during = lanesOf(running(30), 3);
    expect(during.phase).toBe('sensitivity');
    expect(during.lanes.map((lane) => lane.done)).toEqual([10, 10]);
    expect(during.sensitivityDone).toBe(10);
    expect(lanesOf(running(50), 3).phase).toBe('reading');
  });

  it('never claims more than was done', () => {
    expect(lanesOf(running(-5), 3).lanes.map((lane) => lane.done)).toEqual([0, 0]);
    expect(lanesOf(running(5000), 3).lanes.map((lane) => lane.done)).toEqual([10, 10]);
  });
});

describe('the story', () => {
  it('says how the share who look for an alternative or resist differs, from the runs kept for each scenario', () => {
    const story = storyOf(analysis());
    expect(story.adverse).not.toBeNull();
    expect(story.adverse!.shift).toBeCloseTo(story.adverse!.proposed - story.adverse!.baseline);
    expect(story.adverse!.shift).toBeGreaterThan(0);
    expect(story.adverse!.spread.p10).toBeLessThanOrEqual(story.adverse!.spread.p90);
  });

  it('reads who moves from the per-actor summaries, which are there when the runs have dropped their detail', () => {
    const base = analysis();
    const [a, b] = base.actors;
    const withActors: Analysis = {
      ...base,
      variants: base.variants.map((variant) => ({
        ...variant,
        runs: variant.runs.map((run) => ({ ...run, byActor: [] })),
        actors: [
          {
            actorId: a!.id,
            members: 3,
            stanceMean: variant.variantId === 'baseline' ? 0 : -0.3,
            responseShares: shares,
          },
          {
            actorId: b!.id,
            members: 5,
            stanceMean: variant.variantId === 'baseline' ? 0 : 0.05,
            responseShares: shares,
          },
        ],
      })),
    };
    const movers = moversOf(withActors, 'baseline', 'proposed-change');
    expect(movers.map((mover) => mover.actorId)).toEqual([a!.id, b!.id]);
    expect(movers[0]!.shift).toBeCloseTo(-0.3);
    expect(moversOf(base, 'baseline', 'proposed-change')).toEqual([]);
  });

  it('says so, and does not describe the change, when nothing can move anyone', () => {
    const base = analysis();
    const still: Analysis = {
      ...base,
      actors: base.actors.map((actor) => ({
        ...actor,
        kind: 'key',
        traits: { ...actor.traits, impact: { ...actor.traits.impact, value: 0, spread: 0 } },
      })),
      config: {
        ...base.config,
        variants: base.config.variants.map((variant) => ({
          ...variant,
          impactOverrides: {},
          traitEdits: [],
        })),
      },
    };
    expect(storyOf(still).caution).toBe('cannot-move');
  });
});

describe('colours and series of the scenarios', () => {
  it('keeps no change quiet and gives every other scenario a hue, in order', () => {
    const colours = variantColours([
      { kind: 'baseline' },
      { kind: 'alternative' },
      { kind: 'alternative' },
    ]);
    expect(colours[0]).toBe('var(--ink-3)');
    expect(new Set(colours).size).toBe(3);
  });
  it('makes a series for each scenario that has a trajectory, no change dashed', () => {
    const series = seriesOf(analysis());
    expect(series.map((item) => item.id)).toEqual(['baseline', 'proposed-change']);
    expect(series[0]!.dash).toBeDefined();
    expect(series[1]!.dash).toBeUndefined();
    expect(series[1]!.points).toHaveLength(8);
  });
});
