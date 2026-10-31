import { describe, expect, it } from 'vitest';
import type { LabProgress } from '../../../shared/lab';
import { checkpointFixture, projectFixture } from '../test/project';
import {
  actionLabel,
  canExecute,
  defaultView,
  initialStep,
  journey,
  journeyItems,
  keepLab,
  labPollingNeeded,
  needsPolling,
  nextStep,
  stepAvailable,
  stepHelp,
  stepLabels,
  stepOrder,
  stepStatusLabel,
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

const lab = (change: Partial<LabProgress> = {}): LabProgress => ({
  scenario: false,
  stakeholders: 'none',
  actors: 0,
  analysis: 'none',
  critiques: false,
  brief: false,
  ...change,
});

describe('what the scenario lab opens without the engine', () => {
  it('opens Simulation once there are simulated actors, and not before', () => {
    const project = projectFixture();
    expect(stepAvailable(project, 'simulation')).toBe(false);
    project.lab = lab({ stakeholders: 'approved' });
    expect(stepAvailable(project, 'simulation')).toBe(false);
    project.lab = lab({ stakeholders: 'approved', actors: 5 });
    expect(stepAvailable(project, 'simulation')).toBe(true);
  });

  it('opens Report once a comparison has finished, and not while it runs or when it stopped', () => {
    const project = projectFixture();
    for (const analysis of ['none', 'running', 'failed'] as const) {
      project.lab = lab({ actors: 5, analysis });
      expect(stepAvailable(project, 'report'), analysis).toBe(false);
    }
    project.lab = lab({ actors: 5, analysis: 'completed' });
    expect(stepAvailable(project, 'report')).toBe(true);
  });

  it('changes nothing else: the other stages follow the engine, and no stage can be run by it', () => {
    const project = projectFixture();
    project.lab = lab({ stakeholders: 'approved', actors: 5, analysis: 'completed', brief: true });
    expect(stepAvailable(project, 'knowledge')).toBe(true);
    expect(stepAvailable(project, 'environment')).toBe(false);
    expect(stepAvailable(project, 'interaction')).toBe(false);
    for (const step of ['knowledge', 'environment', 'simulation', 'report'] as const) {
      expect(canExecute(project, step), step).toBe(canExecute(projectFixture(), step));
    }
    expect(canExecute(project, 'simulation')).toBe(false);
    expect(canExecute(project, 'report')).toBe(false);
  });

  it('keeps the engine’s own rules for a project that did not come with lab progress', () => {
    const project = checkpointFixture();
    expect(project.lab).toBeUndefined();
    expect(stepAvailable(project, 'simulation')).toBe(true);
    expect(stepAvailable(project, 'report')).toBe(false);
    project.console!.steps.simulation = 'ready';
    expect(stepAvailable(project, 'report')).toBe(true);
  });

  it('leaves a record that has no guided stages open, as it was', () => {
    const project = projectFixture();
    project.workflow = 'quick';
    project.console = null;
    project.lab = lab();
    for (const step of stepOrder) expect(stepAvailable(project, step)).toBe(true);
  });
});

describe('the label under a stage name', () => {
  it('is the engine’s status when the engine has run the stage, or the lab has done nothing there', () => {
    const project = projectFixture();
    project.console!.steps.knowledge = 'ready';
    expect(stepStatusLabel(project, 'knowledge')).toBe('ready');
    project.lab = lab({ stakeholders: 'approved', actors: 5, analysis: 'completed', brief: true });
    expect(stepStatusLabel(project, 'knowledge')).toBe('ready');
    expect(stepStatusLabel(project, 'interaction')).toBe('pending');
    project.console!.steps.simulation = 'ready';
    expect(stepStatusLabel(project, 'simulation')).toBe('ready');
  });

  it('says what the lab did where the engine did not run the stage', () => {
    const project = projectFixture();
    expect(stepStatusLabel(project, 'environment')).toBe('pending');
    project.lab = lab({ actors: 5 });
    expect(stepStatusLabel(project, 'environment')).toBe('actors ready');
    expect(stepStatusLabel(project, 'simulation')).toBe('pending');
    project.lab = lab({ actors: 5, analysis: 'running' });
    expect(stepStatusLabel(project, 'simulation')).toBe('comparing');
    project.lab = lab({ actors: 5, analysis: 'completed' });
    expect(stepStatusLabel(project, 'simulation')).toBe('compared');
    expect(stepStatusLabel(project, 'report')).toBe('ready to write');
    project.lab = lab({ actors: 5, analysis: 'completed', brief: true });
    expect(stepStatusLabel(project, 'report')).toBe('brief written');
  });

  it('is not recorded for a record with no guided stages', () => {
    const project = projectFixture();
    project.workflow = 'quick';
    project.console = null;
    expect(stepStatusLabel(project, 'report')).toBe('historical view');
  });
});

describe('the journey, with what the scenario lab recorded', () => {
  const current = (project: ReturnType<typeof projectFixture>, stage: (typeof stepOrder)[number]) =>
    journeyItems(project, stage)
      .filter((item) => item.current)
      .map((item) => item.id);
  const done = (project: ReturnType<typeof projectFixture>) =>
    journeyItems(project, 'knowledge')
      .filter((item) => item.done)
      .map((item) => item.id);

  it('ticks the stakeholders and the actors once they are approved and made, with no engine stage run', () => {
    const project = projectFixture();
    project.lab = lab({ stakeholders: 'approved', actors: 5 });
    expect(done(project)).toEqual(['question', 'stakeholders', 'actors']);
    expect(current(project, 'environment')).toEqual(['scenarios']);
  });

  it('does not tick what is only proposed, or approved with no actors made', () => {
    const project = projectFixture();
    project.lab = lab({ stakeholders: 'proposed' });
    expect(done(project)).toEqual(['question']);
    expect(current(project, 'environment')).toEqual(['stakeholders']);
    project.lab = lab({ stakeholders: 'approved' });
    expect(done(project)).toEqual(['question', 'stakeholders']);
    expect(current(project, 'environment')).toEqual(['actors']);
  });

  it('ticks the run while a comparison runs, and its progress and results when it has finished', () => {
    const project = projectFixture();
    project.lab = lab({ stakeholders: 'approved', actors: 5, analysis: 'running' });
    expect(done(project)).toContain('run');
    expect(done(project)).not.toContain('progress');
    expect(done(project)).not.toContain('results');
    expect(current(project, 'simulation')).toEqual(['progress']);

    project.lab = lab({ stakeholders: 'approved', actors: 5, analysis: 'completed' });
    expect(done(project)).toEqual(
      expect.arrayContaining(['scenarios', 'run', 'progress', 'results']),
    );
    expect(current(project, 'report')).toEqual(['results']);
  });

  it('claims nothing for a comparison that did not finish, and ticks Export only for a brief', () => {
    const project = projectFixture();
    project.lab = lab({ actors: 5, analysis: 'failed' });
    expect(done(project)).not.toContain('run');
    expect(done(project)).not.toContain('results');
    project.lab = lab({ actors: 5, analysis: 'completed' });
    expect(done(project)).not.toContain('export');
    project.lab = lab({ actors: 5, analysis: 'completed', brief: true });
    expect(done(project)).toContain('export');
    expect(done(project)).not.toContain('compare');
    expect(done(project)).not.toContain('explore');
  });

  it('keeps what the engine’s record shows when the lab has nothing, and has one current step', () => {
    const project = projectFixture();
    project.console!.steps.knowledge = 'ready';
    project.console!.steps.environment = 'ready';
    project.lab = lab();
    expect(done(project)).toEqual(['question', 'evidence', 'stakeholders', 'actors', 'scenarios']);
    for (const step of stepOrder) expect(current(project, step)).toHaveLength(1);
  });
});

describe('the one move offered once a comparison has finished', () => {
  it('goes from the comparison to the brief, and back', () => {
    const finished = lab({ actors: 5, analysis: 'completed' });
    expect(nextStep('simulation', finished)).toMatchObject({
      label: 'See the decision brief',
      to: 'report',
    });
    expect(nextStep('report', finished)).toMatchObject({
      label: 'Back to the comparison',
      to: 'simulation',
    });
  });

  it('offers nothing before a comparison has finished, or in the other stages', () => {
    for (const analysis of ['none', 'running', 'failed'] as const) {
      expect(nextStep('simulation', lab({ actors: 5, analysis }))).toBeNull();
      expect(nextStep('report', lab({ actors: 5, analysis }))).toBeNull();
    }
    expect(nextStep('simulation', undefined)).toBeNull();
    for (const step of ['knowledge', 'environment', 'interaction'] as const) {
      expect(nextStep(step, lab({ analysis: 'completed' }))).toBeNull();
    }
  });
});

describe('when the project is read again while a comparison runs', () => {
  it('is only in a stage that shows the comparison, and only while one is running', () => {
    const project = projectFixture();
    project.lab = lab({ actors: 5, analysis: 'running' });
    expect(labPollingNeeded(project, 'simulation')).toBe(true);
    expect(labPollingNeeded(project, 'report')).toBe(true);
    for (const step of ['knowledge', 'environment', 'interaction'] as const) {
      expect(labPollingNeeded(project, step), step).toBe(false);
    }
    for (const analysis of ['none', 'completed', 'failed'] as const) {
      project.lab = lab({ actors: 5, analysis });
      expect(labPollingNeeded(project, 'simulation'), analysis).toBe(false);
    }
    delete project.lab;
    expect(labPollingNeeded(project, 'simulation')).toBe(false);
  });
});

describe('the view a project opens in', () => {
  it('is the workbench alone once there are simulated actors, and the split view otherwise', () => {
    const project = projectFixture();
    expect(defaultView(project)).toBe('split');
    project.lab = lab({ stakeholders: 'approved' });
    expect(defaultView(project)).toBe('split');
    project.lab = lab({ stakeholders: 'approved', actors: 5 });
    expect(defaultView(project)).toBe('workbench');
  });

  it('stays the split view for a record that has no guided stages', () => {
    const project = projectFixture();
    project.workflow = 'quick';
    project.console = null;
    project.lab = lab({ actors: 5 });
    expect(defaultView(project)).toBe('split');
  });
});

describe('progress that a project returned by an action does not carry', () => {
  it('is kept from the last one read, for the same project, until it is read again', () => {
    const before = projectFixture();
    before.lab = lab({ actors: 5, analysis: 'completed' });
    const after = { ...projectFixture(), status: 'running' as const };
    expect(keepLab(after, before)).toEqual({ ...after, lab: before.lab });
  });

  it('is not kept from another project, from nothing, or over a newer reading', () => {
    const before = projectFixture();
    before.lab = lab({ actors: 5 });
    const other = { ...projectFixture(), id: '33333333-3333-4333-8333-333333333333' };
    expect(keepLab(other, before)).toBe(other);
    const bare = projectFixture();
    expect(keepLab(bare, null)).toBe(bare);
    expect(keepLab(bare, projectFixture())).toBe(bare);
    const read = { ...projectFixture(), lab: lab({ actors: 7 }) };
    expect(keepLab(read, before)).toBe(read);
  });
});
