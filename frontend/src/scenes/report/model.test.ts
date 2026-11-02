import { describe, expect, it } from 'vitest';
import { emptyVerdictCounts } from '../../../../shared/grounding';
import type { OperationTrace } from '../../../../shared/guided';
import type { ProjectDetail, RoundSnapshot } from '../../../../shared/types';
import { claimFixture, modelReportFixture, reviewFixture } from '../../test/grounding';
import { projectFixture, roundFixture } from '../../test/project';
import {
  activeSection,
  activityText,
  askAbout,
  attentionOf,
  chapterCounts,
  chapterId,
  contentsOf,
  describeTrajectory,
  filterClaims,
  finalSplit,
  nearestIndex,
  resolveReport,
  shiftWord,
  signedNumber,
  toggleVerdict,
  trajectory,
  trajectoryDomain,
  trajectoryGeometry,
  writingView,
} from './model';

/** A guided project at the point where the deep dive has finished and the report can be written. */
function readyToWrite(): ProjectDetail {
  const project = projectFixture();
  project.status = 'ready';
  project.stage = 'report';
  for (const step of ['knowledge', 'environment', 'simulation'] as const)
    project.console!.steps[step] = 'ready';
  return project;
}

const trace = (overrides: Partial<OperationTrace>): OperationTrace => ({
  id: 't',
  step: 'report',
  kind: 'model',
  name: 'Executive summary',
  status: 'completed',
  startedAt: '2026-01-01T00:00:00Z',
  completedAt: '2026-01-01T00:00:01Z',
  input: {},
  output: null,
  error: null,
  ...overrides,
});

describe('resolveReport', () => {
  it('opens a finished report as complete', () => {
    const project = readyToWrite();
    project.report = modelReportFixture();
    project.status = 'completed';
    project.console!.steps.report = 'ready';
    expect(resolveReport(project)).toEqual({ kind: 'complete' });
  });

  it('offers to write the report once the deep dive is done, and not before', () => {
    expect(resolveReport(readyToWrite())).toEqual({ kind: 'ready' });
    const early = readyToWrite();
    early.console!.steps.simulation = 'pending';
    expect(resolveReport(early)).toEqual({ kind: 'blocked', running: false });
    const running = readyToWrite();
    running.console!.steps.simulation = 'running';
    running.status = 'running';
    expect(resolveReport(running)).toEqual({ kind: 'blocked', running: true });
  });

  it('shows a report that is being written as writing, with or without chapters yet', () => {
    const project = readyToWrite();
    project.status = 'running';
    project.console!.steps.report = 'running';
    expect(resolveReport(project)).toEqual({ kind: 'writing' });
    project.report = modelReportFixture();
    expect(resolveReport(project)).toEqual({ kind: 'writing' });
  });

  it('says why a report stopped, whether or not part of it was kept', () => {
    const failed = readyToWrite();
    failed.status = 'failed';
    failed.console!.steps.report = 'failed';
    expect(resolveReport(failed)).toEqual({ kind: 'stopped', reason: 'failed' });
    failed.report = modelReportFixture();
    expect(resolveReport(failed)).toEqual({ kind: 'stopped', reason: 'failed' });
    const cancelled = readyToWrite();
    cancelled.console!.steps.report = 'cancelled';
    expect(resolveReport(cancelled)).toEqual({ kind: 'stopped', reason: 'cancelled' });
  });

  it('reads a record that was not made by the guided flow, and never offers to write one for it', () => {
    const legacy = projectFixture();
    legacy.console = null;
    legacy.workflow = 'quick';
    expect(resolveReport(legacy)).toEqual({ kind: 'none' });
    legacy.report = modelReportFixture();
    legacy.status = 'completed';
    expect(resolveReport(legacy)).toEqual({ kind: 'complete' });
  });
});

describe('writingView', () => {
  it('lists the planned chapters as done, being written and waiting, from what the project holds', () => {
    const project = readyToWrite();
    project.status = 'running';
    project.progress = 61.4;
    project.console!.reportPlan = {
      title: 'The plan',
      sections: ['One', 'Two', 'Three'],
      evidenceQueries: [],
      interviewAgentIds: [],
      interviewQuestion: '',
      completedSections: 1,
    };
    project.report = {
      ...modelReportFixture(),
      sections: [{ title: 'One', body: 'Four short words here.', sourceIds: [] }],
    };
    project.console!.traces = [
      trace({ name: 'Write chapter: Two', status: 'running', completedAt: null }),
    ];
    const view = writingView(project);
    expect(view.chapters.map((chapter) => chapter.state)).toEqual(['done', 'writing', 'waiting']);
    expect(view.chapters[0]).toMatchObject({ title: 'One', words: 4 });
    expect(view).toMatchObject({
      title: 'The plan',
      done: 1,
      total: 3,
      percent: 61,
      operation: 'Write chapter: Two',
    });
    expect(view.activity).toBe('Writing “Two”');
  });

  it('says it is planning before there is a plan, and shows no chapter as being written once it has stopped', () => {
    const project = readyToWrite();
    project.status = 'running';
    expect(writingView(project)).toMatchObject({
      activity: 'Planning the chapters',
      total: 0,
      title: null,
    });
    project.console!.reportPlan = {
      title: 'The plan',
      sections: ['One', 'Two'],
      evidenceQueries: [],
      interviewAgentIds: [],
      interviewQuestion: '',
      completedSections: 0,
    };
    expect(writingView(project, true).chapters.map((chapter) => chapter.state)).toEqual([
      'waiting',
      'waiting',
    ]);
  });

  it('keeps the progress within 0 to 100 and puts the engine’s own name only in the operation', () => {
    const project = readyToWrite();
    project.progress = 140;
    expect(writingView(project).percent).toBe(100);
    project.progress = -3;
    expect(writingView(project).percent).toBe(0);
    expect(activityText({ name: 'Something the engine added', kind: 'model' })).toBe(
      'Something the engine added',
    );
    expect(activityText({ name: 'Grounding review', kind: 'review' })).toMatch(/every statement/u);
    expect(activityText({ name: 'proxy interview', kind: 'interview' })).toMatch(/fictional/u);
  });
});

describe('the figures', () => {
  it('calls a small change in the mean no movement, and a larger one by its direction', () => {
    expect(shiftWord(0, 0.021)).toBe('barely moved');
    expect(shiftWord(0, 0.3)).toBe('toward support');
    expect(shiftWord(0.1, -0.2)).toBe('toward opposition');
  });

  it('signs a figure and never shows negative zero', () => {
    expect(signedNumber(0.0214)).toBe('+0.02');
    expect(signedNumber(-0.0214)).toBe('-0.02');
    expect(signedNumber(-0.001)).toBe('0.00');
    expect(signedNumber(0)).toBe('0.00');
  });

  it('makes the final cohort add to one, whatever the report says of its shares', () => {
    const split = finalSplit({ finalSupport: 0.25, finalOpposition: 0.5 });
    expect(split).toEqual({ support: 0.25, opposition: 0.5, undecided: 0.25 });
    const over = finalSplit({ finalSupport: 0.8, finalOpposition: 0.6 });
    expect(over.support + over.opposition + over.undecided).toBeCloseTo(1);
    expect(over.opposition).toBeCloseTo(0.2);
  });
});

describe('the trajectory', () => {
  const rounds = (means: number[]): RoundSnapshot[] =>
    means.map((mean, index) => ({ ...roundFixture(index + 1), meanOpinion: mean }));

  it('is drawn from two rounds or more, in round order', () => {
    expect(trajectory(rounds([0.1]))).toEqual([]);
    const points = trajectory([...rounds([0.1, 0.2, 0.3])].reverse());
    expect(points.map((point) => point.round)).toEqual([1, 2, 3]);
  });

  it('widens the axis to hold every point with room to spare, and never narrows it below a quarter', () => {
    expect(trajectoryDomain(rounds([0.03, -0.02]).map((r) => ({ mean: r.meanOpinion })))).toBe(
      0.25,
    );
    expect(trajectoryDomain([{ mean: 0.23 }])).toBe(0.5);
    expect(trajectoryDomain([{ mean: -0.46 }])).toBe(1);
    expect(trajectoryDomain([{ mean: 0.95 }])).toBe(1);
  });

  it('puts zero in the middle, a high mean high and a low one low, and spreads rounds across the width', () => {
    const geometry = trajectoryGeometry(
      [{ mean: 0.5 }, { mean: 0 }, { mean: -0.5 }],
      { width: 100, height: 60 },
      0.5,
    );
    expect(geometry.xs).toEqual([0, 50, 100]);
    expect(geometry.ys).toEqual([0, 30, 60]);
    expect(geometry.zero).toBe(30);
    expect(geometry.line).toBe('M0.0 0.0 L50.0 30.0 L100.0 60.0');
  });

  it('finds the nearest round to a position and stays within the rounds there are', () => {
    expect(nearestIndex(0, 100, 5)).toBe(0);
    expect(nearestIndex(49, 100, 5)).toBe(2);
    expect(nearestIndex(500, 100, 5)).toBe(4);
    expect(nearestIndex(-20, 100, 5)).toBe(0);
    expect(nearestIndex(10, 100, 1)).toBe(0);
  });

  it('describes the line in words, from the first round to the last and between its extremes', () => {
    const points = trajectory(rounds([-0.0036, 0.0288, 0.0209]));
    expect(describeTrajectory(points)).toBe(
      'Mean inclination by round, from -0.004 in round 1 to +0.021 in round 3, between -0.004 and +0.029.',
    );
    expect(describeTrajectory([])).toMatch(/No rounds/u);
  });
});

describe('the statement checks', () => {
  const claims = [
    claimFixture({ id: 'C1', section: 'One', verdict: 'supported' }),
    claimFixture({ id: 'C2', section: 'One', verdict: 'contradicted' }),
    claimFixture({ id: 'C3', section: 'Two', verdict: 'unsupported' }),
    claimFixture({ id: 'C4', section: 'Two', verdict: 'unsupported' }),
  ];

  it('divides the statements by chapter and counts those the sources give no reason to rely on', () => {
    const counts = chapterCounts(claims);
    expect(counts.get('One')).toEqual({ ...emptyVerdictCounts(), supported: 1, contradicted: 1 });
    expect(attentionOf(counts.get('One')!)).toBe(1);
    expect(attentionOf(counts.get('Two')!)).toBe(2);
    expect(counts.has('Three')).toBe(false);
  });

  it('presses and releases a verdict without touching the others, and shows everything when none is pressed', () => {
    const none = new Set<never>();
    const one = toggleVerdict(none, 'contradicted');
    expect([...one]).toEqual(['contradicted']);
    const two = toggleVerdict(one, 'unsupported');
    expect([...two].sort()).toEqual(['contradicted', 'unsupported']);
    expect([...toggleVerdict(two, 'contradicted')]).toEqual(['unsupported']);
    expect(none.size).toBe(0);
    expect(filterClaims(claims, new Set()).map((claim) => claim.id)).toEqual([
      'C1',
      'C2',
      'C3',
      'C4',
    ]);
    expect(filterClaims(claims, two).map((claim) => claim.id)).toEqual(['C2', 'C3', 'C4']);
  });

  it('asks the analyst about a statement by name, and keeps the question within what a message may hold', () => {
    const question = askAbout({ verdict: 'contradicted', text: 'A statement.' });
    expect(question).toBe(
      'Why is this statement of the report rated “Contradicted”? “A statement.”',
    );
    const long = askAbout({ verdict: 'partial', text: 'word '.repeat(400) });
    expect(long.length).toBeLessThan(600);
    expect(long).toContain('…');
  });
});

describe('contents and reading position', () => {
  const report = () => {
    const base = modelReportFixture(
      reviewFixture([
        claimFixture({ section: 'Chapter one', verdict: 'supported' }),
        claimFixture({ id: 'C2', section: 'Chapter two', verdict: 'contradicted' }),
      ]),
    );
    return base;
  };

  it('lists the summary, the figures, each chapter, the checks and the limitations in page order, and flags what needs a look', () => {
    const entries = contentsOf(report(), { figures: true });
    expect(entries.map((entry) => entry.id)).toEqual([
      'summary',
      'figures',
      chapterId(0),
      chapterId(1),
      'checks',
      'limits',
    ]);
    expect(entries.filter((entry) => entry.flag).map((entry) => entry.id)).toEqual([
      chapterId(1),
      'checks',
    ]);
    expect(entries.find((entry) => entry.id === chapterId(1))).toMatchObject({
      index: 2,
      label: 'Chapter two',
    });
  });

  it('leaves out the checks of a rules-based report and the figures when there are none', () => {
    const local = { ...report(), generatedBy: 'local' as const, grounding: undefined };
    const ids = contentsOf(local, { figures: false }).map((entry) => entry.id);
    expect(ids).not.toContain('checks');
    expect(ids).not.toContain('figures');
  });

  it('keeps the checks of a model-written report in the contents when its review is missing', () => {
    const withoutReview = { ...report(), grounding: undefined };
    expect(contentsOf(withoutReview, { figures: false }).map((entry) => entry.id)).toContain(
      'checks',
    );
  });

  it('reads the section whose top has passed the line, and the first one before any has', () => {
    const tops = [
      { id: 'a', top: 120 },
      { id: 'b', top: 600 },
      { id: 'c', top: 1200 },
    ];
    expect(activeSection(tops, 0)).toBe('a');
    expect(activeSection(tops, 120)).toBe('a');
    expect(activeSection(tops, 700)).toBe('b');
    expect(activeSection(tops, 5000)).toBe('c');
    expect(activeSection([], 10)).toBeNull();
  });
});
