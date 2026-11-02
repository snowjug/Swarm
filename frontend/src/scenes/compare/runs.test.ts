import { describe, expect, it } from 'vitest';
import type { RoundMetrics, RunComparison } from '../../../../shared/guided';
import type { ProjectDetail, ProjectSummary } from '../../../../shared/types';
import { projectFixture } from '../../test/project';
import {
  chooseRun,
  defaultPair,
  firstMoved,
  lineageParts,
  metricSeries,
  metricText,
  partedRound,
  runChoices,
  sharedRounds,
  validRunPair,
} from './runs';

const metrics = (overrides: Partial<RoundMetrics> = {}): RoundMetrics => ({
  meanOpinion: 0.1,
  supportShare: 0.25,
  oppositionShare: 0.25,
  undecidedShare: 0.5,
  polarization: 0.2,
  activityCount: 4,
  ...overrides,
});

const summary = (id: string, overrides: Partial<ProjectSummary> = {}): ProjectSummary => ({
  ...(projectFixture() as ProjectSummary),
  id,
  name: `Run ${id}`,
  workflow: 'guided',
  currentRound: 3,
  parentId: null,
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

function open(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  const base = projectFixture();
  return {
    ...base,
    id: 'open',
    name: 'Open run',
    rounds: [{ ...base.rounds[0]!, round: 1 }],
    ...overrides,
  } as ProjectDetail;
}

describe('the recorded runs that can be compared', () => {
  it('lists the open run first, then its relatives, then the rest by recency', () => {
    const projects = [
      summary('older', { updatedAt: '2026-01-01T00:00:00Z' }),
      summary('newer', { updatedAt: '2026-03-01T00:00:00Z' }),
      summary('kid', { parentId: 'open' }),
      summary('parent'),
      summary('sibling', { parentId: 'mum' }),
    ];
    const choices = runChoices(open({ parentId: 'mum' }), [...projects, summary('mum')]);
    expect(choices.map((choice) => [choice.id, choice.relation])).toEqual([
      ['open', 'this'],
      ['mum', 'parent'],
      ['kid', 'branch'],
      ['sibling', 'sibling'],
      ['newer', 'other'],
      ['older', 'other'],
      ['parent', 'other'],
    ]);
  });

  it('leaves out runs with no saved round, and runs that are not guided', () => {
    const projects = [
      summary('empty', { currentRound: 0 }),
      summary('quick', { workflow: 'quick' }),
      summary('fine'),
    ];
    expect(runChoices(open(), projects).map((choice) => choice.id)).toEqual(['open', 'fine']);
  });

  it('has nothing to compare with fewer than two', () => {
    expect(defaultPair(runChoices(open(), []))).toBeNull();
    expect(validRunPair(null, runChoices(open(), []))).toBeNull();
  });

  it('starts with the open run against the closest relative', () => {
    const choices = runChoices(open(), [summary('kid', { parentId: 'open' }), summary('other')]);
    expect(defaultPair(choices)).toEqual({ base: 'open', other: 'kid' });
  });

  it('swaps the sides instead of setting a run against itself, and repairs a pair that is gone', () => {
    const choices = runChoices(open(), [summary('kid', { parentId: 'open' }), summary('other')]);
    const pair = { base: 'open', other: 'kid' };
    expect(chooseRun(pair, 'other', 'other')).toEqual({ base: 'open', other: 'other' });
    expect(chooseRun(pair, 'base', 'kid')).toEqual({ base: 'kid', other: 'open' });
    expect(chooseRun(pair, 'base', 'open')).toBe(pair);
    expect(validRunPair({ base: 'open', other: 'gone' }, choices)).toEqual(pair);
    expect(validRunPair({ base: 'open', other: 'open' }, choices)).toEqual(pair);
    expect(validRunPair(pair, choices)).toBe(pair);
  });
});

function comparison(rounds: RunComparison['rounds'], identicalThroughRound: number): RunComparison {
  return {
    base: {
      id: 'a',
      name: 'A',
      status: 'ready',
      seed: 1,
      completedRounds: 4,
      totalRounds: 4,
      branchFromRound: null,
      intervention: null,
    },
    other: {
      id: 'b',
      name: 'B',
      status: 'ready',
      seed: 1,
      completedRounds: 4,
      totalRounds: 4,
      branchFromRound: 2,
      intervention: null,
    },
    lineage: 'base-is-parent',
    identicalThroughRound,
    rounds,
    declaredChanges: [],
    notes: [],
  };
}

const delta = (value: number): RoundMetrics =>
  metrics({
    meanOpinion: value,
    supportShare: 0,
    oppositionShare: 0,
    undecidedShare: 0,
    polarization: 0,
    activityCount: 0,
  });

describe('two runs coming apart', () => {
  const rounds: RunComparison['rounds'] = [1, 2, 3, 4].map((round) => ({
    round,
    base: metrics(),
    other: metrics({ meanOpinion: round > 2 ? 0.2 : 0.1 }),
    delta: delta(round > 2 ? 0.1 : 0),
  }));

  it('parts in the round after the last identical one', () => {
    expect(partedRound(comparison(rounds, 2))).toBe(3);
    expect(partedRound(comparison(rounds, 0))).toBe(1);
  });

  it('has not parted when the runs are the same as far as both recorded', () => {
    expect(partedRound(comparison(rounds, 4))).toBeNull();
    const short = rounds.map((round) =>
      round.round > 2 ? { ...round, other: null, delta: null } : round,
    );
    // The branch was stopped at round 2: round 3 is not one both recorded, so nothing shows that they have parted.
    expect(partedRound(comparison(short, 2))).toBeNull();
    expect(sharedRounds(comparison(short, 2))).toEqual([1, 2]);
  });

  it('reads a series without filling a value that was not recorded', () => {
    const short = rounds.map((round) =>
      round.round === 4 ? { ...round, other: null, delta: null } : round,
    );
    const series = metricSeries(comparison(short, 2), 'meanOpinion');
    expect(series[3]).toEqual({ round: 4, base: 0.1, other: null, delta: null });
  });

  it('looks first at mean inclination, and at the first metric that moved when that did not', () => {
    expect(firstMoved(comparison(rounds, 2))).toBe('meanOpinion');
    const quiet = rounds.map((round) => ({
      ...round,
      delta: { ...delta(0), polarization: round.round === 4 ? 0.05 : 0 },
    }));
    expect(firstMoved(comparison(quiet, 2))).toBe('polarization');
    expect(
      firstMoved(
        comparison(
          rounds.map((round) => ({ ...round, delta: delta(0) })),
          4,
        ),
      ),
    ).toBeNull();
  });

  it('says values as the record does: three places, shares as percentages, counts whole', () => {
    expect(metricText(0.0213, 'meanOpinion')).toBe('0.021');
    expect(metricText(-0.0213, 'meanOpinion', true)).toBe('−0.021');
    expect(metricText(0.25, 'supportShare')).toBe('25.0%');
    expect(metricText(-0.125, 'oppositionShare', true)).toBe('−12.5 points');
    expect(metricText(3, 'activityCount', true)).toBe('+3');
    expect(metricText(4, 'activityCount')).toBe('4');
    expect(metricText(null, 'polarization')).toBe('Not recorded');
  });

  it('keeps the server’s four lineages, and says nothing of cause for unrelated runs', () => {
    const text = (lineage: RunComparison['lineage']): string =>
      lineageParts(lineage)
        .map((part) => (typeof part === 'string' ? part : part.run === 'base' ? '[A]' : '[B]'))
        .join('');
    expect(text('base-is-parent')).toBe('[A] is the parent run of [B].');
    expect(text('other-is-parent')).toBe('[B] is the parent run of [A].');
    expect(text('siblings')).toBe('[A] and [B] share a parent run.');
    expect(text('unrelated')).toBe(
      '[A] and [B] are not in the same recorded parent/sibling relationship.',
    );
    expect(text('unrelated')).not.toMatch(/caus|effect|because/iu);
  });
});
