import { describe, expect, it } from 'vitest';
import { projectFixture } from '../test/project';
import { actionLabel, canExecute, initialStep, needsPolling, stepAvailable } from './console';

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
