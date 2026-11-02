import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ProjectDetail } from '../../../../shared/types';
import { WorkspaceContext, type Workspace } from '../../app/context';
import { sceneInfos } from '../../app/scenes';
import { ToastProvider, TooltipProvider } from '../../design/ui';
import { claimFixture, modelReportFixture, reviewFixture } from '../../test/grounding';
import { projectFixture, roundFixture } from '../../test/project';
import ReportScene from './index';

const noop = () => undefined;

function workspaceOf(project: ProjectDetail): Workspace {
  return {
    project,
    config: null,
    mode: 'guided',
    busy: false,
    refreshing: false,
    refresh: noop,
    run: async () => undefined,
    cancel: async () => undefined,
    pause: async () => undefined,
    resume: async () => undefined,
    setIntervention: async () => undefined,
    branch: async () => undefined,
    saveEnvironment: async () => undefined,
    recordSurvey: noop,
    duplicate: noop,
    openProject: noop,
    projects: [],
    scene: 'decide',
    view: 'report',
    go: noop,
    setView: noop,
    journey: sceneInfos(project, 'decide'),
    sharing: false,
    panels: {
      history: noop,
      ask: noop,
      audit: noop,
      budget: noop,
      access: noop,
      provider: noop,
      snapshot: noop,
    },
  };
}

function markup(project: ProjectDetail): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <ToastProvider>
        <WorkspaceContext.Provider value={workspaceOf(project)}>
          <ReportScene />
        </WorkspaceContext.Provider>
      </ToastProvider>
    </TooltipProvider>,
  );
}

/** What a reader would read: the markup and the comments React leaves between text nodes are taken out. */
function render(project: ProjectDetail): string {
  return markup(project)
    .replace(/<!--.*?-->/gu, '')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\s+/gu, ' ');
}

/** A guided project whose deep dive has finished, so that a report could be written. */
function finishedRun(): ProjectDetail {
  const project = projectFixture();
  project.status = 'ready';
  project.stage = 'report';
  project.rounds = [roundFixture(1), { ...roundFixture(2), meanOpinion: -0.1 }, roundFixture(3)];
  for (const step of ['knowledge', 'environment', 'simulation'] as const)
    project.console!.steps[step] = 'ready';
  return project;
}

describe('the detailed report scene', () => {
  it('offers to write the report once the deep dive has finished', () => {
    const html = render(finishedRun());
    expect(html).toContain('Write the report');
  });

  it('says what has to happen first when the report cannot be written yet', () => {
    const project = finishedRun();
    project.console!.steps.simulation = 'pending';
    const html = render(project);
    expect(html).toContain('The deep dive comes first');
    expect(html).not.toContain('Write the report');
  });

  it('shows how far the writing has got, and how to stop it, while the report is being written', () => {
    const project = finishedRun();
    project.status = 'running';
    project.progress = 40;
    project.console!.steps.report = 'running';
    project.console!.activeStep = 'report';
    project.console!.reportPlan = {
      title: 'Findings',
      sections: ['Chapter one', 'Chapter two'],
      evidenceQueries: [],
      interviewAgentIds: [],
      interviewQuestion: '',
      completedSections: 1,
    };
    project.report = modelReportFixture(undefined, ['Chapter one']);
    const html = render(project);
    expect(html).toContain('1 of 2 chapters written');
    expect(html).toContain('Stop');
  });

  it('reads a finished rules-based report and says why it has no statement checks', () => {
    const project = finishedRun();
    project.status = 'completed';
    project.console!.steps.report = 'ready';
    project.report = {
      ...modelReportFixture(),
      generatedBy: 'local',
      title: 'Rules-based findings',
    };
    const html = render(project);
    expect(html).toContain('Rules-based findings');
    expect(html).toContain('Edit in the studio');
    expect(html).toContain('no model-written statements to check');
  });

  it('shows each statement of a model-written report with its verdict', () => {
    const project = finishedRun();
    project.status = 'completed';
    project.console!.steps.report = 'ready';
    project.report = modelReportFixture(
      reviewFixture([
        claimFixture({ id: 'C1', text: 'A statement that holds.' }),
        claimFixture({ id: 'C2', text: 'A statement that conflicts.', verdict: 'contradicted' }),
      ]),
    );
    const html = render(project);
    expect(html).toContain('Statement checks');
    expect(html).toContain('A statement that holds.');
    expect(html).toContain('Contradicted');
  });

  it('labels every chapter group of the statement checks with its own heading', () => {
    const project = finishedRun();
    project.status = 'completed';
    project.console!.steps.report = 'ready';
    project.report = modelReportFixture(
      reviewFixture([
        claimFixture({ id: 'C1', section: 'Chapter one' }),
        claimFixture({ id: 'C2', section: 'Chapter two' }),
      ]),
    );
    const html = markup(project);
    const ids = [...html.matchAll(/\sid="([^"]+)"/gu)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    const labels = [...html.matchAll(/aria-labelledby="([^"]+)"/gu)].flatMap((match) =>
      match[1]!.split(' '),
    );
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(ids).toContain(label);
  });

  it('says plainly what is left when the report stopped before it was finished', () => {
    const project = finishedRun();
    project.status = 'cancelled';
    project.console!.steps.report = 'cancelled';
    project.console!.activeStep = 'report';
    project.report = modelReportFixture(undefined, ['Chapter one']);
    const html = render(project);
    expect(html).toContain('You stopped the report');
    expect(html).toContain('Write it again');
  });
});
