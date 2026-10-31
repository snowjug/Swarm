import { describe, expect, it } from 'vitest';
import { projectFixture } from '../test/project';
import {
  actionLabel,
  canExecute,
  initialStep,
  journey,
  journeyItems,
  needsPolling,
  stepAvailable,
  stepHelp,
  stepLabels,
  stepOrder,
} from './console';

describe('guided workflow gates', () => {
  it('executes one stage at a time and never reruns ready stages', () => {
    const project = projectFixture();
    expect(canExecute(project, 'knowledge')).toBe(true);
    expect(canExecute(project, 'environment')).toBe(false);
    expect(stepAvailable(project, 'environment')).toBe(false);
    project.console!.steps.knowledge = 'ready';
    project.status = 'ready';
    expect(canExecute(project, 'knowledge')).toBe(false);
    expect(canExecute(project, 'environment')).toBe(true);
    expect(stepAvailable(project, 'environment')).toBe(true);
    expect(stepAvailable(project, 'simulation')).toBe(false);
    project.status = 'running';
    expect(canExecute(project, 'environment')).toBe(false);
  });

  it('only retries the failed or cancelled current step', () => {
    const project = projectFixture();
    project.status = 'failed';
    project.console!.activeStep = 'simulation';
    project.console!.steps.knowledge = 'ready';
    project.console!.steps.environment = 'ready';
    project.console!.steps.simulation = 'failed';
    expect(canExecute(project, 'simulation')).toBe(true);
    expect(canExecute(project, 'report')).toBe(false);
    project.console!.steps.environment = 'cancelled';
    expect(canExecute(project, 'environment')).toBe(false);
    expect(initialStep(project)).toBe('simulation');
  });

  it('keeps quick runs read-only and does not invent guided status', () => {
    const project = projectFixture();
    project.workflow = 'quick';
    project.console = null;
    for (const step of ['knowledge', 'environment', 'simulation', 'report'] as const)
      expect(canExecute(project, step)).toBe(false);
    expect(initialStep(project)).toBe('environment');
  });

  it.each(['state', 'interview'] as const)(
    'polls queued/running execution or queued/running %s surveys',
    (kind) => {
      const project = projectFixture();
      expect(needsPolling(project)).toBe(false);
      project.status = 'running';
      expect(needsPolling(project)).toBe(true);
      project.status = 'completed';
      project.console!.surveys = [
        {
          id: 'survey-test',
          kind,
          question: 'Test question?',
          agentIds: ['agent-1'],
          status: 'queued',
          createdAt: project.createdAt,
          completedAt: null,
          responses: [],
          error: null,
        },
      ];
      expect(needsPolling(project)).toBe(true);
      project.console!.surveys[0]!.status = 'completed';
      expect(needsPolling(project)).toBe(false);
    },
  );

  it('labels local events as state changes, not social posts', () => {
    expect(actionLabel('update', true)).toBe('Local state update');
    expect(actionLabel('observe', true)).toBe('Local observation');
    expect(actionLabel('post', false)).toBe('Simulated post');
  });
});

describe('plain-language help under each stage', () => {
  it('keeps the five engine stage names and gives each one a short help line', () => {
    expect(stepOrder.map((step) => stepLabels[step])).toEqual([
      'Graph Build',
      'Env Setup',
      'Simulation',
      'Report',
      'Interaction',
    ]);
    expect(stepOrder.map((step) => stepHelp[step])).toEqual([
      'Understand the evidence',
      'Review stakeholders and actors',
      'Run and compare scenarios',
      'Decision brief',
      'Ask questions',
    ]);
  });
});

describe('the journey from a question to a result', () => {
  const current = (project: ReturnType<typeof projectFixture>, stage: (typeof stepOrder)[number]) =>
    journeyItems(project, stage)
      .filter((item) => item.current)
      .map((item) => item.id);
  const done = (project: ReturnType<typeof projectFixture>) =>
    journeyItems(project, 'knowledge')
      .filter((item) => item.done)
      .map((item) => item.id);

  it('has the twelve steps in order, each placed in one of the five stages', () => {
    expect(journey.map((item) => item.label)).toEqual([
      'Question',
      'Evidence',
      'Stakeholders',
      'Actors',
      'Scenarios',
      'Run',
      'Progress',
      'Results',
      'Explore',
      'Change',
      'Compare',
      'Export',
    ]);
    for (const item of journey) expect(stepOrder).toContain(item.stage);
    expect(new Set(journey.map((item) => item.stage))).toEqual(new Set(stepOrder));
  });

  it('starts at the evidence: a question is the one thing a new project already has', () => {
    const project = projectFixture();
    expect(done(project)).toEqual(['question']);
    expect(current(project, 'knowledge')).toEqual(['evidence']);
  });

  it('marks a step done only when the stage record shows it', () => {
    const project = projectFixture();
    project.console!.steps.knowledge = 'ready';
    expect(done(project)).toEqual(['question', 'evidence']);
    expect(current(project, 'environment')).toEqual(['stakeholders']);

    project.console!.steps.environment = 'ready';
    expect(done(project)).toEqual(['question', 'evidence', 'stakeholders', 'actors', 'scenarios']);
    expect(current(project, 'environment')).toEqual(['actors']);
    expect(current(project, 'simulation')).toEqual(['run']);

    project.console!.steps.simulation = 'running';
    expect(done(project)).not.toContain('progress');
    expect(done(project)).toContain('run');
    expect(current(project, 'simulation')).toEqual(['progress']);

    project.console!.steps.simulation = 'ready';
    project.console!.steps.report = 'ready';
    expect(done(project)).toContain('progress');
    expect(done(project)).toContain('results');
    expect(current(project, 'report')).toEqual(['results']);
  });

  it('never claims that a person explored, compared or exported, which leave no record', () => {
    const project = projectFixture();
    for (const step of stepOrder) project.console!.steps[step] = 'ready';
    expect(done(project)).not.toContain('explore');
    expect(done(project)).not.toContain('compare');
    expect(done(project)).not.toContain('export');
  });

  it('counts a branch as a changed assumption', () => {
    const project = projectFixture();
    expect(done(project)).not.toContain('change');
    project.parentId = '22222222-2222-4222-8222-222222222222';
    expect(done(project)).toContain('change');
  });

  it('has exactly one current step for every stage in view', () => {
    const project = projectFixture();
    for (const step of stepOrder) expect(current(project, step)).toHaveLength(1);
    expect(current(project, 'interaction')).toEqual(['explore']);
  });

  it('is empty for a record that has no guided stages', () => {
    const project = projectFixture();
    project.workflow = 'quick';
    project.console = null;
    expect(journeyItems(project, 'knowledge')).toEqual([]);
  });
});
