import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StudioView } from '../../../../shared/studio';
import type { ProjectDetail } from '../../../../shared/types';
import { WorkspaceContext, type Workspace } from '../../app/context';
import { sceneInfos } from '../../app/scenes';
import { ToastProvider, TooltipProvider } from '../../design/ui';
import type { StudioHandle } from '../../hooks/useStudio';
import { modelReportFixture } from '../../test/grounding';
import { projectFixture } from '../../test/project';
import { capabilities, defaultSections, hash, sectionView, studioView } from '../../test/studio';
import type { StudioActions } from './actions';
import { NoReport } from './NoReport';
import { Opening } from './Opening';
import { Workbench } from './Workbench';

const noop = () => undefined;
const yes = async () => true;

const actions: StudioActions = {
  pending: null,
  exporting: false,
  edit: yes,
  lock: yes,
  note: yes,
  restore: yes,
  regenerate: yes,
  decide: yes,
  step: yes,
  start: yes,
  exportAs: async () => undefined,
};

function handle(view: StudioView): StudioHandle {
  return {
    view,
    loadError: null,
    actionError: null,
    pending: null,
    loading: false,
    reload: noop,
    clearActionError: noop,
    act: yes,
  };
}

/** What a reader would read: the markup and the comments React leaves between text nodes are taken out. */
function text(html: string): string {
  return html
    .replace(/<!--.*?-->/gu, '')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\s+/gu, ' ');
}

function workbench(view: StudioView): string {
  if (!view.document) throw new Error('The fixture needs a document.');
  return text(
    renderToStaticMarkup(
      <TooltipProvider>
        <ToastProvider>
          <Workbench
            projectId="project-1"
            view={view}
            document={view.document}
            studio={handle(view)}
            actions={actions}
            onBack={noop}
            onReport={noop}
            onAudit={noop}
          />
        </ToastProvider>
      </TooltipProvider>,
    ),
  );
}

function opening(view: StudioView): string {
  return text(
    renderToStaticMarkup(
      <TooltipProvider>
        <Opening
          view={view}
          report={view.reportReady ? modelReportFixture() : null}
          actions={actions}
          onBack={noop}
          onReport={noop}
        />
      </TooltipProvider>,
    ),
  );
}

const AT = '2026-02-02T10:00:00.000Z';

function workspaceOf(project: ProjectDetail, overrides: Partial<Workspace> = {}): Workspace {
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
    view: 'studio',
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
    },
    ...overrides,
  };
}

/** What the studio says when the report it works on is not written, for a project at some point of writing it. */
function noReport(project: ProjectDetail, view: Partial<StudioView> = {}): string {
  return text(
    renderToStaticMarkup(
      <TooltipProvider>
        <ToastProvider>
          <WorkspaceContext.Provider value={workspaceOf(project)}>
            <NoReport
              view={studioView({ document: null, reportReady: false, ...view })}
              onBack={noop}
            />
          </WorkspaceContext.Provider>
        </ToastProvider>
      </TooltipProvider>,
    ),
  );
}

/** A guided project whose deep dive has finished, so that the detailed report could be written from it. */
function finishedRun(): ProjectDetail {
  const project = projectFixture();
  project.status = 'ready';
  for (const step of ['knowledge', 'environment', 'simulation'] as const)
    project.console!.steps[step] = 'ready';
  return project;
}

describe('opening the studio', () => {
  it('lets someone who can edit open a working copy, and tells them what it will and will not do', () => {
    const html = opening(studioView({ document: null }));
    expect(html).toContain('Open in the studio');
    expect(html).toContain('the generated report is never changed');
  });

  it('asks someone who cannot edit to have it opened for them', () => {
    const html = opening(
      studioView({ document: null, capabilities: capabilities({ edit: false }) }),
    );
    expect(html).not.toContain('Open in the studio');
    expect(html).toContain('needs to open it first');
  });
});

describe('the studio when there is no report to work on', () => {
  it('offers to write the report from there, and says what it costs', () => {
    const html = noReport(finishedRun());
    expect(html).toContain('There is no report to work on yet');
    expect(html).toContain('Write the detailed report');
    expect(html).toContain('Not a forecast');
    expect(html).not.toContain('Go to the detailed report');
  });

  it('says who can write it to someone who cannot', () => {
    const html = noReport(finishedRun(), { capabilities: capabilities({ edit: false }) });
    expect(html).toContain('There is no report to work on yet');
    expect(html).not.toContain('Write the detailed report');
    expect(html).toContain('analyst or lead role needs to write it');
  });

  it('leads to the deep dive when the report cannot be written before it', () => {
    const html = noReport(projectFixture());
    expect(html).toContain('has not been run for this question');
    expect(html).toContain('Go to the deep dive');
    expect(html).not.toContain('Write the detailed report');
    const running = projectFixture();
    running.status = 'running';
    expect(noReport(running)).toContain('Watch it in the deep dive');
  });

  it('shows how far the writing has got, with a way to stop it, and says the studio will open on it', () => {
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
    const html = noReport(project);
    expect(html).toContain('The detailed report is being written');
    expect(html).toContain('1 of 2 chapters written');
    expect(html).toContain('Stop');
    expect(html).toContain('The studio opens on it as soon as it is finished');
  });

  it('says why the report stopped, and offers to try again', () => {
    const project = finishedRun();
    project.status = 'failed';
    project.error = 'The model did not answer.';
    project.console!.steps.report = 'failed';
    project.console!.activeStep = 'report';
    const html = noReport(project);
    expect(html).toContain('stopped before it was finished');
    expect(html).toContain('The model did not answer.');
    expect(html).toContain('Try again');
  });

  it('says that the report is written while the studio reads it, and that a record without one cannot make one', () => {
    const written = finishedRun();
    written.status = 'completed';
    written.console!.steps.report = 'ready';
    written.report = modelReportFixture();
    expect(noReport(written)).toContain('Opening it in the studio');
    const quick = projectFixture();
    quick.workflow = 'quick';
    expect(noReport(quick)).toContain('cannot make one');
  });
});

describe('the report studio', () => {
  it('shows a draft as a document that can be edited and sent for review', () => {
    const html = workbench(studioView());
    expect(html).toContain('Executive summary');
    expect(html).toContain('Submit for review');
    expect(html).toContain('Edit');
  });

  it('gives a reviewer the decision, and no way to change the text under review', () => {
    const html = workbench(
      studioView({
        document: { state: 'in-review' },
        capabilities: capabilities({ edit: false, review: true }),
      }),
    );
    expect(html).toContain('Approve…');
    expect(html).toContain('Request changes…');
    expect(html).not.toContain('Submit for review');
  });

  it('puts what the reviewer said first when a report was sent back', () => {
    const html = workbench(
      studioView({
        document: {
          state: 'changes-requested',
          decisions: [
            { action: 'started', actor: 'local-user', at: AT, note: null, revision: 1 },
            {
              action: 'changes-requested',
              actor: 'reviewer',
              at: AT,
              note: 'The second chapter needs its source named.',
              revision: 4,
            },
          ],
        },
      }),
    );
    expect(html).toContain('A reviewer sent it back for changes');
    expect(html).toContain('The second chapter needs its source named.');
  });

  it('records who approved it, and that approval is only a reading of this text', () => {
    const html = workbench(
      studioView({
        document: {
          state: 'approved',
          approval: {
            actor: 'reviewer',
            at: AT,
            revision: 5,
            contentHash: hash('b'),
            alsoEdited: true,
          },
        },
      }),
    );
    expect(html).toContain('Approved by');
    expect(html).toContain('who also wrote part of this text');
    expect(html).toContain('Reopen…');
  });

  it('says the copy is out of date when the generated report was replaced, and offers a fresh start', () => {
    const html = workbench(studioView({ stale: true }));
    expect(html).toContain('The generated report was replaced after this copy was made');
    expect(html).toContain('Start again from the new report');
  });

  it('flags statements that describe an earlier text of an edited chapter', () => {
    const sections = defaultSections();
    sections[1] = sectionView({ ...sections[1], origin: 'human', statementsCurrent: false });
    const html = workbench(studioView({ document: { sections } }));
    expect(html).toContain('Statements describe an earlier text');
    expect(workbench(studioView())).not.toContain('Statements describe an earlier text');
  });
});
