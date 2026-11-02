import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { BRIEF_SIGNAL_NOTICES, type BriefView } from '../../../../shared/brief';
import { critiqueSchema } from '../../../../shared/critique';
import { WorkspaceContext, type Workspace } from '../../app/context';
import { sceneInfos } from '../../app/scenes';
import { ToastProvider, TooltipProvider } from '../../design/ui';
import { briefFixture, viewFixture, visualsFixture } from '../../test/brief';
import {
  critiqueFixture,
  setFixture,
  stateFixture,
  viewFixture as reviewFixture,
} from '../../test/critics';
import { modelReportFixture } from '../../test/grounding';
import { projectFixture } from '../../test/project';
import { DecideDocument, type DocumentProps } from './DecideDocument';
import { BriefFailed, BriefLoading, NoAnalysis, WriteBrief, Writing } from './States';
import { SubScene } from './SubScene';
import DecideScene from './index';

const noop = () => undefined;

function workspaceOf(overrides: Partial<Workspace> = {}): Workspace {
  const project = projectFixture();
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
    view: null,
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
    ...overrides,
  };
}

function page(node: ReactNode, workspace: Workspace = workspaceOf()): string {
  return renderToStaticMarkup(
    <WorkspaceContext.Provider value={workspace}>
      <TooltipProvider>
        <ToastProvider>{node}</ToastProvider>
      </TooltipProvider>
    </WorkspaceContext.Provider>,
  );
}

const text = (markup: string): string =>
  markup
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/\s+/gu, ' ');

function document(
  overrides: Partial<DocumentProps> = {},
  view: Partial<BriefView> = {},
): DocumentProps {
  return {
    project: projectFixture(),
    mode: 'guided',
    view: { ...viewFixture(view), brief: view.brief ?? briefFixture() },
    handle: {
      generating: false,
      generateError: null,
      generate: async () => undefined,
      reload: noop,
      error: null,
      loading: false,
    },
    review: stateFixture(),
    analysis: { facts: null, loading: false },
    reviewOpen: false,
    onReviewOpenChange: noop,
    go: { simulate: noop, studio: noop, report: noop, ground: noop },
    ...overrides,
  };
}

const render = (props: DocumentProps) => page(<DecideDocument {...props} />);

describe('the decide scene by its address', () => {
  it('shows the shape of the first screen while the brief is read', () => {
    const markup = page(<DecideScene />);
    expect(markup).toContain('aria-busy="true"');
    expect(text(markup)).toContain('Loading the decision brief');
  });

  it('hands the view of a scene built apart to the sub-scene, with a way back', () => {
    const markup = page(<DecideScene />, workspaceOf({ view: 'studio' }));
    expect(text(markup)).toContain('Decision brief');
    expect(text(markup)).toContain('Edit report');
    expect(markup).not.toContain('Loading the decision brief');
  });

  it('names the detailed report where that is the view', () => {
    const markup = page(<SubScene name="report" />);
    expect(text(markup)).toContain('Detailed report');
  });
});

describe('the states before there is a brief', () => {
  it('says so, with a retry, when the brief cannot be read', () => {
    const markup = page(
      <BriefFailed message="The store did not answer." onRetry={noop} busy={false} />,
    );
    expect(text(markup)).toContain('The decision brief could not be loaded');
    expect(text(markup)).toContain('The store did not answer.');
    expect(text(markup)).toContain('Try again');
  });

  it('points to the comparison when there is none to write from', () => {
    const markup = page(<NoAnalysis onSimulate={noop} onReport={null} />);
    expect(text(markup)).toContain('Nothing to decide from yet');
    expect(text(markup)).toContain('Open Simulate');
    expect(text(markup)).not.toContain('Detailed report');
  });

  it('offers to write the brief, and only to someone who may', () => {
    const open = page(
      <WriteBrief
        completedAt="2026-02-01T10:00:00.000Z"
        may
        busy={false}
        error={null}
        onWrite={noop}
        onRetry={noop}
      />,
    );
    expect(text(open)).toContain('Write the brief');
    expect(text(open)).toContain('1 Feb 2026');
    const closed = page(
      <WriteBrief
        completedAt={null}
        may={false}
        busy={false}
        error={null}
        onWrite={noop}
        onRetry={noop}
      />,
    );
    expect(text(closed)).not.toMatch(/>\s*Write the brief\s*</u);
    expect(text(closed)).toContain('Your role can read this exploration but not write the brief');
  });

  it('shows a failed attempt next to the way to try again', () => {
    const markup = page(
      <WriteBrief
        completedAt={null}
        may
        busy={false}
        error="The engine stopped."
        onWrite={noop}
        onRetry={noop}
      />,
    );
    expect(text(markup)).toContain('The brief could not be made');
    expect(text(markup)).toContain('The engine stopped.');
  });

  it('announces the writing as a status and lists what will be written', () => {
    const markup = page(<Writing />);
    expect(markup).toContain('role="status"');
    expect(text(markup)).toContain('Writing the brief');
    expect(text(markup)).toContain('Prioritised recommendations');
  });

  it('draws the loading state without the answer', () => {
    expect(text(page(<BriefLoading />))).not.toContain('Proposed change');
  });
});

describe('the brief as a document', () => {
  it('leads with the answer, what happened, why and what matters, then every chapter', () => {
    const markup = render(document());
    const words = text(markup);
    expect(words).toContain('What happened');
    expect(words).toContain('Why');
    expect(words).toContain('What matters');
    expect(words).toContain('Stakeholder landscape');
    expect(words).toContain('Prioritised recommendations');
    expect(words).toContain('Independent review');
    expect(words).toContain('Technical appendix');
    expect(markup).toContain('id="brief-answer"');
  });

  it('puts the editor and the detailed report in the tools once the report is written', () => {
    const project = projectFixture();
    project.status = 'completed';
    project.report = modelReportFixture();
    for (const step of ['knowledge', 'environment', 'simulation', 'report'] as const)
      project.console!.steps[step] = 'ready';
    const words = text(render(document({ project })));
    expect(words).toContain('Edit report');
    expect(words).toContain('Detailed report');
    expect(words).not.toContain('Write the detailed report');
  });

  it('offers to write the detailed report, and not to edit one that is not there', () => {
    // The studio would only say that there is nothing to work on: the one thing to do is to write it.
    const words = text(render(document()));
    expect(words).toContain('Write the detailed report');
    expect(words).not.toContain('Edit report');
    expect(words).not.toContain('Detailed report');
  });

  it('offers a role that cannot write the report neither', () => {
    const words = text(render(document({}, { may: { generate: false, export: true } })));
    expect(words).not.toContain('Write the detailed report');
    expect(words).not.toContain('Edit report');
  });

  it('never writes a share of simulated members as a percentage', () => {
    const hero = render(document()).split('class="sw-decide-body"')[0] ?? '';
    expect(text(hero)).toContain('in 100');
    expect(text(hero)).not.toMatch(/\d\s?%/u);
  });

  it('says the figures are counts of the simulation, not a forecast', () => {
    expect(text(render(document()))).toMatch(/not a forecast/u);
  });

  it('renders what the server wrote as text, never as markup', () => {
    const hostile = '<img src=x onerror=alert(1)> and <script>alert(2)</script>';
    const markup = render(
      document(
        {},
        {
          brief: briefFixture({ question: hostile, headline: hostile }),
        },
      ),
    );
    expect(markup).not.toContain('<img src=x');
    expect(markup).not.toContain('<script>alert');
    expect(markup).toContain('&lt;img src=x');
  });

  it('shows a signal the engine raised, and does not read the figures as an effect', () => {
    const markup = render(document({}, { brief: briefFixture({ signal: 'no-direction' }) }));
    const words = text(markup);
    expect(words).toContain(BRIEF_SIGNAL_NOTICES['no-direction'].text);
    expect(words).toContain('Cannot tell the change from no change');
    expect(words).toContain('These figures are not read as an effect of the change.');
  });

  it('says that no measurable difference is not a finding about the world', () => {
    const markup = render(document({}, { brief: briefFixture({ signal: 'no-difference' }) }));
    expect(text(markup)).toContain('No measurable difference');
  });

  it('says a brief is out of date and what to do, by what changed', () => {
    const rerun = text(render(document({}, { changedSince: ['scenario'] })));
    expect(rerun).toContain('This brief may be out of date');
    expect(rerun).toContain('Re-run the comparison');
    const newer = text(render(document({}, { changedSince: ['a newer analysis exists'] })));
    expect(newer).toContain('Write the brief again');
    expect(newer).toContain('A newer comparison exists.');
  });

  it('does not offer a person who cannot edit the means to bring it up to date', () => {
    const markup = render(
      document(
        {},
        { changedSince: ['a newer analysis exists'], may: { generate: false, export: false } },
      ),
    );
    expect(text(markup)).toContain(
      'Ask someone who can edit this exploration to bring it up to date.',
    );
    expect(markup).not.toMatch(/<button[^>]*>[^<]*(<[^>]+>)*\s*Write the brief again/u);
  });

  it('says the charts are drawn from the project as it is when they were not kept', () => {
    const markup = render(document({}, { changedSince: ['actors'], visualsFrom: 'current' }));
    expect(text(markup)).toContain('Its charts show the project as it is now');
  });

  it('keeps the answer as written, in a calm size, when its figures are gone', () => {
    const markup = render(document({}, { visuals: null, visualsFrom: null }));
    expect(markup).toContain('data-written="true"');
    expect(text(markup)).toContain('no longer stored');
  });

  it('shows a criticism as a note beside the statement it is about, and counts it on the chapter', () => {
    const critique = critiqueSchema.parse({
      ...critiqueFixture(),
      id: 'about-the-statement',
      objection: 'The group list leaves out the people who do the work.',
      target: { kind: 'statement', id: 'stakeholders-1' },
    });
    const markup = render(
      document({
        review: stateFixture({
          view: reviewFixture({ critiques: setFixture([critique]) }),
        }),
      }),
    );
    expect(markup.match(/class="sw-decide-note"/gu)).toHaveLength(1);
    expect(markup).toContain('The group list leaves out the people who do the work.');
    expect(markup).toMatch(/sw-decide-chapter__notes">1 criticism</u);
    const none = render(
      document({ review: stateFixture({ view: reviewFixture({ critiques: setFixture([]) }) }) }),
    );
    expect(none).not.toContain('class="sw-decide-note"');
  });
});

describe('the independent review in the document', () => {
  it('invites the review when none has been run, and says what the model reading is', () => {
    const markup = render(
      document({
        review: stateFixture({ view: reviewFixture({ critiques: null, revision: null }) }),
      }),
    );
    const words = text(markup);
    expect(words).toContain('Run the independent review');
    expect(words).toContain('Seven critics can challenge this analysis');
    expect(words).toContain('Also ask a model');
  });

  it('says a person without the right cannot start one', () => {
    const markup = render(
      document({
        review: stateFixture({
          view: reviewFixture({
            critiques: null,
            revision: null,
            may: { run: false, respond: false },
          }),
        }),
      }),
    );
    expect(text(markup)).toContain(
      'Only someone who can run analyses on this exploration can start a review.',
    );
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*?Run the independent review/u);
  });

  it('does not read an empty review as proof that the analysis is right', () => {
    const markup = render(
      document({ review: stateFixture({ view: reviewFixture({ critiques: setFixture([]) }) }) }),
    );
    expect(text(markup)).toContain('does not show the analysis is right');
  });

  it('counts the criticisms, says none has changed a finding, and prints them all', () => {
    const markup = render(
      document({
        review: stateFixture({
          view: reviewFixture({
            critiques: setFixture([
              critiqueFixture(),
              critiqueFixture({ id: 'second', severity: 'major', objection: 'The second one.' }),
            ]),
          }),
        }),
      }),
    );
    const words = text(markup);
    expect(words).toContain('criticisms raised');
    expect(words).toContain('none of them has changed a finding');
    expect(words).toContain('All criticisms');
    expect(words).toContain('The second one.');
  });

  it('shows the reading of the review failing, and offers to read it again', () => {
    const markup = render(
      document({ review: stateFixture({ view: null, error: 'The review could not be read.' }) }),
    );
    expect(text(markup)).toContain('The independent review could not be read');
    expect(text(markup)).toContain('Retry');
  });

  it('calls a review of an earlier comparison out of date', () => {
    const markup = render(
      document({
        review: stateFixture({
          view: reviewFixture({
            changedSince: ['a newer analysis exists'],
            analysis: { id: 'analysis-2', completedAt: '2026-02-02T08:00:00.000Z' },
            critiques: setFixture([critiqueFixture()], { analysisId: 'analysis-1' }),
          }),
        }),
      }),
    );
    expect(text(markup)).toContain('This review is of an earlier comparison');
  });
});

describe('the figures in the first screen', () => {
  it('shows the four numbers the answer rests on when the visuals are there', () => {
    const words = text(render(document({}, { visuals: visualsFixture() })));
    expect(words).toContain('paired seeded runs');
    expect(words).toContain('Paired difference');
    expect(words).toContain('with nothing changed');
  });
});
