import { describe, expect, it } from 'vitest';
import type { ConsoleStep } from '../../../shared/guided';
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
  labRefreshToken,
  labWatch,
  needsPolling,
  nextStep,
  stepAvailable,
  stepHelp,
  stepLabels,
  stepLock,
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
  it('is the engine’s status when the engine has run the stage, and locked where it cannot be opened', () => {
    const project = projectFixture();
    expect(stepStatusLabel(project, 'environment')).toBe('locked');
    project.console!.steps.knowledge = 'ready';
    expect(stepStatusLabel(project, 'knowledge')).toBe('ready');
    expect(stepStatusLabel(project, 'environment')).toBe('pending');
    project.lab = lab({ stakeholders: 'approved', actors: 5, analysis: 'completed', brief: true });
    expect(stepStatusLabel(project, 'knowledge')).toBe('ready');
    expect(stepStatusLabel(project, 'interaction')).toBe('locked');
    project.console!.steps.simulation = 'ready';
    expect(stepStatusLabel(project, 'simulation')).toBe('ready');
  });

  it('says what the lab did where the engine did not run the stage', () => {
    const project = projectFixture();
    project.console!.steps.knowledge = 'ready';
    project.lab = lab({ actors: 5 });
    expect(stepStatusLabel(project, 'environment')).toBe('actors ready');
    expect(stepStatusLabel(project, 'simulation')).toBe('ready to compare');
    project.lab = lab({ actors: 5, analysis: 'running' });
    expect(stepStatusLabel(project, 'simulation')).toBe('comparing');
    project.lab = lab({ actors: 5, analysis: 'failed' });
    expect(stepStatusLabel(project, 'simulation')).toBe('stopped');
    expect(stepStatusLabel(project, 'report')).toBe('locked');
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

describe('what a locked stage says it needs', () => {
  it('names what opens each stage that can be locked, and nothing for one that can be opened', () => {
    const project = projectFixture();
    expect(stepLock(project, 'knowledge')).toBeNull();
    expect(stepLock(project, 'environment')).toBe('Needs Graph Build first');
    expect(stepLock(project, 'simulation')).toBe('Needs actors from Env Setup');
    expect(stepLock(project, 'report')).toBe('Needs a finished comparison');
    expect(stepLock(project, 'interaction')).toBe('Needs the detailed report');
    project.console!.steps.knowledge = 'ready';
    expect(stepLock(project, 'environment')).toBeNull();
  });

  it('follows the lab: actors open Simulation and a finished comparison opens Report', () => {
    const project = projectFixture();
    project.lab = lab({ stakeholders: 'approved', actors: 5 });
    expect(stepLock(project, 'simulation')).toBeNull();
    expect(stepLock(project, 'report')).not.toBeNull();
    project.lab = lab({ stakeholders: 'approved', actors: 5, analysis: 'completed' });
    expect(stepLock(project, 'report')).toBeNull();
  });

  it('has nothing to lock in a record with no guided stages', () => {
    const project = projectFixture();
    project.workflow = 'quick';
    project.console = null;
    for (const step of stepOrder) expect(stepLock(project, step)).toBeNull();
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

describe('the one move offered from what the scenario lab has recorded', () => {
  const at = (change: Partial<LabProgress>, graphReady = true) => {
    const project = projectFixture();
    project.console!.steps.knowledge = graphReady ? 'ready' : 'pending';
    project.lab = lab(change);
    return project;
  };
  const APPROVED = { stakeholders: 'approved' } as const;
  const WITH_ACTORS = { stakeholders: 'approved', actors: 5 } as const;

  it('goes from the comparison to the brief, and back', () => {
    const finished = at({ ...WITH_ACTORS, analysis: 'completed' });
    expect(nextStep(finished, 'simulation')).toMatchObject({
      label: 'See the decision brief',
      to: 'report',
    });
    expect(nextStep(finished, 'report')).toMatchObject({
      label: 'Back to the comparison',
      to: 'simulation',
      back: true,
    });
  });

  it('names the next piece of work, one at a time, from a stage where it is not done', () => {
    const next: [Partial<LabProgress>, string, ConsoleStep][] = [
      [{ stakeholders: 'proposed' }, 'Review the stakeholders', 'environment'],
      [APPROVED, 'Make the actors', 'environment'],
      [WITH_ACTORS, 'Compare the scenarios', 'simulation'],
      [{ ...WITH_ACTORS, analysis: 'running' }, 'Follow the comparison', 'simulation'],
      [{ ...WITH_ACTORS, analysis: 'failed' }, 'Compare the scenarios', 'simulation'],
      [{ ...WITH_ACTORS, analysis: 'completed' }, 'See the decision brief', 'report'],
      [{ ...WITH_ACTORS, analysis: 'completed', brief: true }, 'See the decision brief', 'report'],
    ];
    for (const [change, label, to] of next) {
      const move = nextStep(at(change), 'knowledge');
      expect(move, label).toMatchObject({ label, to });
      expect(move?.back).toBeUndefined();
    }
    expect(nextStep(at({ ...WITH_ACTORS, analysis: 'failed' }), 'knowledge')?.text).toContain(
      'stopped before it finished',
    );
  });

  it('offers nothing in the stage where that work is done, or in Interaction', () => {
    expect(nextStep(at({ stakeholders: 'proposed' }), 'environment')).toBeNull();
    expect(nextStep(at(APPROVED), 'environment')).toBeNull();
    for (const analysis of ['none', 'running', 'failed'] as const) {
      expect(nextStep(at({ ...WITH_ACTORS, analysis }), 'simulation'), analysis).toBeNull();
    }
    for (const change of [{ stakeholders: 'proposed' }, WITH_ACTORS] as const) {
      expect(nextStep(at(change), 'interaction')).toBeNull();
    }
    expect(nextStep(at({ ...WITH_ACTORS, analysis: 'completed' }), 'interaction')).toBeNull();
  });

  it('offers nothing before the lab has recorded anything, and nothing to a stage that is locked', () => {
    expect(nextStep(at({}), 'knowledge')).toBeNull();
    expect(nextStep(at({ scenario: true }), 'knowledge')).toBeNull();
    // The graph is not built, so Env Setup cannot be opened: the stage in view says what to do.
    expect(nextStep(at(APPROVED, false), 'knowledge')).toBeNull();
    const plain = projectFixture();
    expect(plain.lab).toBeUndefined();
    expect(nextStep(plain, 'simulation')).toBeNull();
    plain.workflow = 'quick';
    plain.console = null;
    plain.lab = lab({ ...WITH_ACTORS, analysis: 'completed' });
    expect(nextStep(plain, 'simulation')).toBeNull();
  });

  it('does not offer the way back to a comparison that cannot be opened', () => {
    const project = at({ analysis: 'completed' });
    expect(stepAvailable(project, 'report')).toBe(true);
    expect(stepAvailable(project, 'simulation')).toBe(false);
    expect(nextStep(project, 'report')).toBeNull();
  });
});

describe('when the page reads the project again by itself', () => {
  const watched = (change: Partial<LabProgress> | undefined, step: ConsoleStep) => {
    const project = projectFixture();
    if (change) project.lab = lab(change);
    return labWatch(project, step);
  };
  const WITH_ACTORS = { stakeholders: 'approved', actors: 5 } as const;

  it('is quick in every stage but Interaction while a comparison runs', () => {
    for (const step of ['knowledge', 'environment', 'simulation', 'report'] as const) {
      expect(watched({ ...WITH_ACTORS, analysis: 'running' }, step), step).toBe('running');
    }
    expect(watched({ ...WITH_ACTORS, analysis: 'running' }, 'interaction')).toBeNull();
  });

  it('waits in Simulation for a comparison to be started, and ends once one has finished', () => {
    for (const analysis of ['none', 'failed'] as const) {
      expect(watched({ ...WITH_ACTORS, analysis }, 'simulation'), analysis).toBe('waiting');
    }
    expect(watched({ ...WITH_ACTORS, analysis: 'completed' }, 'simulation')).toBeNull();
    // Without actors there is nothing to compare, and nothing a panel here could start.
    expect(watched({ stakeholders: 'approved' }, 'simulation')).toBeNull();
  });

  it('waits in Report for the brief to be written, and ends once it is', () => {
    const finished = { ...WITH_ACTORS, analysis: 'completed' } as const;
    expect(watched(finished, 'report')).toBe('waiting');
    expect(watched({ ...finished, brief: true }, 'report')).toBeNull();
    expect(watched({ ...WITH_ACTORS, analysis: 'none' }, 'report')).toBeNull();
  });

  it('reads nothing where no panel can change the record, or for a project with none', () => {
    for (const step of ['knowledge', 'environment', 'interaction'] as const) {
      expect(watched({ ...WITH_ACTORS, analysis: 'completed' }, step), step).toBeNull();
    }
    expect(watched(undefined, 'simulation')).toBeNull();
    const plain = projectFixture();
    plain.workflow = 'quick';
    plain.console = null;
    plain.lab = lab({ ...WITH_ACTORS, analysis: 'running' });
    expect(labWatch(plain, 'simulation')).toBeNull();
  });
});

describe('what the brief and the review read again on', () => {
  const tokenOf = (change: Partial<LabProgress> | undefined, reads = 0) => {
    const project = projectFixture();
    if (change) project.lab = lab(change);
    return labRefreshToken(project, reads);
  };
  const FINISHED = { stakeholders: 'approved', actors: 5, analysis: 'completed' } as const;

  it('changes each time a person asks for a fresh read of the project, though nothing in the record moved', () => {
    const first = tokenOf(FINISHED, 0);
    expect(tokenOf(FINISHED, 0)).toBe(first);
    expect(tokenOf(FINISHED, 1)).not.toBe(first);
    expect(tokenOf(FINISHED, 2)).not.toBe(tokenOf(FINISHED, 1));
  });

  it('changes when the lab’s record does: a comparison finished, a review made, a brief written', () => {
    const tokens = [
      tokenOf({ ...FINISHED, analysis: 'running' }),
      tokenOf(FINISHED),
      tokenOf({ ...FINISHED, critiques: true }),
      tokenOf({ ...FINISHED, critiques: true, brief: true }),
      tokenOf({ ...FINISHED, stakeholders: 'proposed' }),
    ];
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it('is the same for a project that carries no record, and does not depend on its timestamp', () => {
    expect(tokenOf(undefined)).toBe(tokenOf(undefined));
    const project = projectFixture();
    project.lab = lab(FINISHED);
    const later = { ...project, updatedAt: '2030-01-01T00:00:00.000Z' };
    expect(labRefreshToken(later, 0)).toBe(labRefreshToken(project, 0));
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
