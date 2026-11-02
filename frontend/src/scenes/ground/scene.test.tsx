import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import type { Ledger } from '../../../../shared/evidence';
import type { ProjectDetail } from '../../../../shared/types';
import { WorkspaceContext, type Workspace } from '../../app/context';
import { sceneInfos } from '../../app/scenes';
import { ToastProvider, TooltipProvider } from '../../design/ui';
import { claimRecord, ledgerFixture } from '../../test/ledger';
import { Conflicts } from './Conflicts';
import { ConstellationGraph } from './ConstellationGraph';
import { Hero } from './Hero';
import { SourceRows } from './SourceRows';
import { NoStatements, Statements } from './Statements';
import { Trace } from './Trace';
import {
  GroundActionsContext,
  GroundDataContext,
  GroundLitContext,
  type GroundActions,
  type GroundData,
} from './context';
import { NO_LIT, buildGraphView, layoutPlacements } from './graphModel';
import { documentList, groundStage } from './model';
import { indexPassages } from './passages';
import { passagesOf, project, twoConflicts } from './fixtures';
import GroundScene from './index';

const noop = () => undefined;

function workspaceOf(source: ProjectDetail, overrides: Partial<Workspace> = {}): Workspace {
  return {
    project: source,
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
    scene: 'ground',
    view: null,
    go: noop,
    setView: noop,
    journey: sceneInfos(source, 'ground'),
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

const actions: GroundActions = {
  openDocument: noop,
  openPassage: noop,
  openBrowse: noop,
  openClaim: noop,
  selectNode: noop,
  selectEdge: noop,
  hover: noop,
  pinDocument: noop,
  goTo: noop,
  showConflict: noop,
};

interface Options {
  ledger?: Ledger | null;
  mode?: 'guided' | 'advanced';
  passages?: 'loaded' | 'loading' | 'failed';
  ledgerState?: 'loaded' | 'loading' | 'failed';
}

function dataOf(source: ProjectDetail, options: Options = {}): GroundData {
  const documents = documentList(source);
  const chunks =
    options.passages === 'loaded' || options.passages === undefined ? passagesOf(source) : [];
  const index =
    options.passages === 'loading' || options.passages === 'failed' ? null : indexPassages(chunks);
  const graph = source.graph
    ? buildGraphView(
        source.graph,
        layoutPlacements(source.graph, 42),
        index,
        documents.map((doc) => doc.id),
      )
    : null;
  const ledgerState = options.ledgerState ?? 'loaded';
  return {
    project: source,
    mode: options.mode ?? 'guided',
    stage: groundStage(source),
    documents,
    passages: {
      index,
      loading: options.passages === 'loading',
      error: options.passages === 'failed' ? 'The evidence index is not available.' : null,
      reload: noop,
    },
    graph,
    ledger: {
      ledger: ledgerState === 'loaded' ? (options.ledger ?? null) : null,
      loading: ledgerState === 'loading',
      error: ledgerState === 'failed' ? 'The ledger could not be read.' : null,
      reload: noop,
      replace: noop,
    },
    conflictsKnown: true,
    openClaimId: null,
  };
}

function render(
  node: ReactNode,
  source: ProjectDetail,
  options: Options = {},
  workspace: Partial<Workspace> = {},
) {
  return renderToStaticMarkup(
    <TooltipProvider>
      <ToastProvider>
        <WorkspaceContext.Provider
          value={workspaceOf(source, { mode: options.mode ?? 'guided', ...workspace })}
        >
          <GroundDataContext.Provider value={dataOf(source, options)}>
            <GroundActionsContext.Provider value={actions}>
              <GroundLitContext.Provider
                value={{ lit: NO_LIT, selection: { node: null, edge: null, pinnedDocument: null } }}
              >
                {node}
              </GroundLitContext.Provider>
            </GroundActionsContext.Provider>
          </GroundDataContext.Provider>
        </WorkspaceContext.Provider>
      </ToastProvider>
    </TooltipProvider>,
  );
}

/** The words of the markup, as a reader meets them. */
const words = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/gu, '')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/&#x27;|&#39;/gu, "'")
    .replace(/&quot;/gu, '"')
    .replace(/\s+/gu, ' ');

describe('the first screen', () => {
  it('invites a start when the evidence has not been read, and shows what is not known as a dash', () => {
    const idle = project('pending');
    const html = render(<Hero />, idle);
    expect(words(html)).toContain('Not started');
    expect(words(html)).toContain(idle.question);
    expect(words(html)).toContain('Ground it');
    expect(html).toContain('aria-label="Not known yet"');
    expect(words(html)).not.toContain('Stop');
  });

  it('shows what the engine does, the step it is on, and a way to stop', () => {
    const running = project('running');
    running.console!.traces = [
      {
        id: 't1',
        step: 'knowledge',
        kind: 'review',
        name: 'Ontology definition',
        status: 'completed',
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T00:00:08.000Z',
        input: null,
        output: null,
        error: null,
      },
    ];
    const html = render(<Hero />, running);
    expect(html).toContain('aria-label="Progress"');
    for (const label of ['Reading', 'Extracting', 'Checking', 'Ready'])
      expect(words(html)).toContain(label);
    expect(html).toContain('aria-current="step"');
    expect(words(html)).toContain('Stop');
    // The first phase is done, so the engine is extracting: the status and the line that is read out say so.
    expect(words(html)).toContain('Extracting topics from the sources.');
    expect(words(html)).not.toContain('Ground it');
  });

  it('says why it failed, in the engine’s words, and offers a retry', () => {
    const failed = project('failed');
    failed.error = 'The model did not return a graph that could be checked.';
    const html = render(<Hero />, failed);
    expect(html).toContain('role="alert"');
    expect(words(html)).toContain('The model did not return a graph that could be checked.');
    expect(words(html)).toContain('Try again');
  });

  it('offers a fresh start after a stop, without calling it a failure', () => {
    const html = render(<Hero />, project('cancelled'));
    expect(words(html)).toContain('Start again');
    expect(words(html)).toContain('Stopped');
    expect(html).not.toContain('role="alert"');
  });

  it('answers what the evidence is in four figures and leads on to the next scene', () => {
    const html = render(<Hero />, project('ready'), { ledger: twoConflicts() });
    const text = words(html);
    for (const label of ['Sources', 'Passages', 'Topics', 'Conflicts'])
      expect(text).toContain(label);
    expect(text).toMatch(/2\s+Sources/u);
    expect(text).toMatch(/3\s+Topics/u);
    expect(text).toContain('to review');
    expect(text).toContain('Map the stakeholders');
  });

  it('shows a saved record as it is: read-only, with nothing to run', () => {
    const legacy = project('ready');
    legacy.console = null;
    legacy.workflow = 'quick';
    const html = render(<Hero />, legacy);
    expect(words(html)).toContain('Saved record');
    for (const absent of ['Ground it', 'Try again', 'Start again', 'Stop'])
      expect(words(html)).not.toContain(absent);
  });

  it('says none, not a dash, when a saved record holds no graph and no sources', () => {
    const bare = project('ready');
    bare.console = null;
    bare.workflow = 'quick';
    bare.graph = null;
    bare.documents = [];
    const html = render(<Hero />, bare);
    expect(html).not.toContain('aria-label="Not known yet"');
    expect(words(html)).toContain('No source text');
  });

  it('keeps the engine’s own step name and log line for Advanced only', () => {
    const running = project('running');
    running.events = [
      {
        id: 1,
        projectId: running.id,
        stage: 'knowledge',
        message: 'knowledge started.',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    expect(words(render(<Hero />, running, { mode: 'guided' }))).not.toContain(
      'knowledge started.',
    );
    const advanced = words(render(<Hero />, running, { mode: 'advanced' }));
    expect(advanced).toContain('knowledge started.');
    expect(advanced).toContain('Ontology definition');
  });
});

describe('the head of the page says what the sources are', () => {
  it('says synthetic samples beside the status when every source is one, and when only some are', () => {
    const all = words(render(<Hero />, project()));
    expect(all).toContain('Synthetic samples');
    expect(all).not.toContain('Includes synthetic samples');
    const mixed = project();
    mixed.documents[1]!.provenance = { kind: 'paste' };
    expect(words(render(<Hero />, mixed))).toContain('Includes synthetic samples');
  });

  it('says nothing of it for sources that are not samples, nor for a project that has none', () => {
    const real = project();
    for (const document of real.documents) document.provenance = { kind: 'upload' };
    expect(words(render(<Hero />, real))).not.toMatch(/synthetic sample/iu);
    const bare = project();
    bare.documents = [];
    expect(words(render(<Hero />, bare))).not.toMatch(/synthetic sample/iu);
  });
});

describe('the sources', () => {
  it('lists each document with where it came from, and each passage as a button that says where it is', () => {
    const html = render(<SourceRows variant="list" reading="done" />, project());
    expect(words(html)).toContain('01-note.md');
    expect(words(html)).toContain('Synthetic sample');
    expect(html).toMatch(/aria-label="Passage S1, characters 1 to \d+"/u);
    expect(html).toMatch(/<button[^>]*class="sw-ground-src__passage"/u);
  });

  it('shows what it is waiting for, not an empty list, while the passages are read', () => {
    const html = render(<SourceRows variant="list" reading="done" />, project(), {
      passages: 'loading',
    });
    expect(html).toContain('sw-skeleton');
  });

  it('says so, with a way to try again, when the passages could not be read', () => {
    const html = render(<SourceRows variant="list" reading="done" />, project(), {
      passages: 'failed',
    });
    expect(html).toContain('role="alert"');
    expect(words(html)).toContain('The evidence index is not available.');
    expect(words(html)).toContain('Retry');
  });

  it('writes a document’s name as text, whatever it holds', () => {
    const hostile = project();
    hostile.documents[0]!.name = '<img src=x onerror=alert(1)>.md';
    const html = render(<SourceRows variant="list" reading="done" />, hostile);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('has an honest empty state for a record with no sources', () => {
    const none = project();
    none.documents = [];
    expect(words(render(<SourceRows variant="list" reading="done" />, none))).toContain(
      'No source text',
    );
  });
});

describe('the graph', () => {
  const html = render(<ConstellationGraph />, project());

  it('is a labelled group that says how to move about it, with every topic a button of its own', () => {
    expect(html).toContain('role="group"');
    expect(html).toContain('Press [ and ] to move between them');
    for (const label of ['Crossings', 'Fares', 'Riders']) {
      expect(html).toMatch(new RegExp(`role="button"[^>]*aria-label="${label}, Topic`, 'u'));
    }
  });

  it('has the controls a pointer would use, each with a name', () => {
    for (const name of ['Find a topic', 'Zoom out', 'Zoom in', 'Fit to view', 'Graph options']) {
      expect(html).toContain(`aria-label="${name}"`);
    }
  });

  it('says what kind of graph it is, short, where it is seen', () => {
    expect(words(html)).toContain('Shared passages, not meaning');
    const model = project();
    model.graph = { ...model.graph!, method: 'llm' };
    expect(words(render(<ConstellationGraph />, model))).toContain('Extracted by a model');
  });

  it('draws nothing for a project with no graph', () => {
    expect(render(<ConstellationGraph />, project('pending'))).not.toContain('sw-ground-graph');
  });
});

describe('the conflicts', () => {
  it('sets the two statements side by side with their figures, and the ways to settle it', () => {
    const html = render(<Conflicts flash={null} />, project(), { ledger: twoConflicts() });
    const text = words(html);
    expect(text).toContain('01-note.md');
    expect(text).toContain('02-note.md');
    expect(text).toContain('412,000');
    expect(text).toContain('365,000');
    expect(text).toContain('Possible conflict');
    for (const action of ['Confirm', 'Not a conflict', 'Mark resolved'])
      expect(text).toContain(action);
    expect(text).toContain('Neither side is declared true');
  });

  it('keeps what was reviewed, with the note, apart from what is open', () => {
    const html = render(<Conflicts flash={null} />, project(), { ledger: twoConflicts() });
    expect(words(html)).toContain('Reviewed · 1');
    expect(words(html)).toContain('Different years.');
    expect(words(html)).toContain('Change decision');
  });

  it('says there are none, and that this is not proof, when the sources do not conflict', () => {
    const html = render(<Conflicts flash={null} />, project(), {
      ledger: ledgerFixture({ claims: [], contradictions: [] }),
    });
    expect(words(html)).toContain('No conflicts found between the sources');
    expect(words(html)).toContain('can be missed');
  });

  it('shows a skeleton while it loads and a way to try again when it fails', () => {
    expect(render(<Conflicts flash={null} />, project(), { ledgerState: 'loading' })).toContain(
      'aria-busy="true"',
    );
    const failed = render(<Conflicts flash={null} />, project(), { ledgerState: 'failed' });
    expect(words(failed)).toContain('Conflicts could not be read');
    expect(words(failed)).toContain('Retry');
  });

  it('writes a quotation as text, whatever it holds', () => {
    const hostile = twoConflicts();
    hostile.contradictions[0]!.left.quote = '<script>alert(1)</script> 412,000';
    const html = render(<Conflicts flash={null} />, project(), { ledger: hostile });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('the statements', () => {
  const ledger = ledgerFixture();
  const html = render(<Statements />, project(), { ledger });

  it('gives each statement as a button, with its type, how well it is backed and how it is shown', () => {
    expect(html).toMatch(/<button[^>]*class="sw-ground-claim-row"[^>]*aria-pressed="false"/u);
    for (const phrase of [
      'The council counted 412,000 crossings in 2025.',
      'Source fact',
      'Directly supported',
      'AI hypothesis',
      'Labelled hypothesis',
      'Rejected by a reviewer',
    ]) {
      expect(words(html)).toContain(phrase);
    }
  });

  it('shows the whole ledger as a bar with a text alternative, and says what it measures', () => {
    expect(html).toMatch(/role="img" aria-label="3 statements: /u);
    expect(words(html)).toContain('not whether they are true');
  });

  it('says whether the evidence is enough, and leaves the reasons one press away', () => {
    expect(words(html)).toContain('Limited: treat as tentative');
  });

  it('says only that a checked report listed no statements, and nothing while none was checked', () => {
    expect(words(render(<NoStatements />, project()))).toContain('listed no statements');
  });

  it('shows a statement that cites nothing as one that does', () => {
    const bare = ledgerFixture({
      claims: [claimRecord({ id: 'C9', supporting: [], text: 'Nobody cited this.' })],
    });
    expect(words(render(<Statements />, project(), { ledger: bare }))).toContain(
      'Nobody cited this.',
    );
  });
});

describe('the operations', () => {
  it('lists what the engine recorded, and keeps the raw input out of sight until it is asked for', () => {
    const source = project();
    source.console!.traces = [
      {
        id: 'abc',
        step: 'knowledge',
        kind: 'retrieval',
        name: 'Source graph construction',
        status: 'completed',
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T00:00:03.000Z',
        input: { passages: 2 },
        output: { nodes: 3 },
        error: null,
      },
    ];
    const html = render(<Trace />, source, { mode: 'advanced' });
    expect(words(html)).toContain('Source graph construction');
    expect(words(html)).toContain('Completed');
    expect(html).toMatch(/aria-expanded="false"/u);
    expect(html).toMatch(/class="sw-ground-reveal"[^>]*data-open="false"[^>]*inert/u);
  });

  it('keeps the log a named region around a plain list, with headings that follow the page’s', () => {
    const source = project();
    source.console!.traces = [
      {
        id: 'abc',
        step: 'knowledge',
        kind: 'retrieval',
        name: 'Source graph construction',
        status: 'completed',
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T00:00:03.000Z',
        input: { passages: 2 },
        output: null,
        error: null,
      },
    ];
    source.events = [
      {
        id: 1,
        projectId: source.id,
        stage: 'knowledge',
        message: 'Reading the sources',
        createdAt: '2026-01-01T00:00:01.000Z',
      },
    ];
    const html = render(<Trace />, source, { mode: 'advanced' });
    // A log is a region and not a list: its items belong to the plain list inside it.
    expect(html).toMatch(/<div[^>]*role="log"[^>]*aria-label="Recorded events"/u);
    expect(html).not.toMatch(/<ol[^>]*role="log"/u);
    expect(html).toMatch(/<div[^>]*role="log"[^>]*><ol[^>]*><li/u);
    // The part is named by a heading of its own, and everything under it is a level below it.
    expect(html).toMatch(/<h2 class="sr-only" id="ground-trace-title">Operations<\/h2>/u);
    expect(html).not.toMatch(/<h4/u);
    expect(html).toMatch(/<h3[^>]*>Input<\/h3>/u);
    expect(html).toMatch(/<h3[^>]*>Output<\/h3>/u);
    expect(html).toMatch(/<h3[^>]*>Events<\/h3>/u);
  });

  it('lets a keyboard reach what scrolls: the log and each block of raw input or output', () => {
    const source = project();
    source.console!.traces = [
      {
        id: 'abc',
        step: 'knowledge',
        kind: 'retrieval',
        name: 'Source graph construction',
        status: 'completed',
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T00:00:03.000Z',
        input: { passages: 2 },
        output: { nodes: 3 },
        error: null,
      },
    ];
    source.events = [
      {
        id: 1,
        projectId: source.id,
        stage: 'knowledge',
        message: 'Reading the sources',
        createdAt: '2026-01-01T00:00:01.000Z',
      },
    ];
    const html = render(<Trace />, source, { mode: 'advanced' });
    expect(html.match(/<pre[^>]*tabindex="0"/gu)).toHaveLength(2);
    expect(html).toMatch(/role="log"[^>]*tabindex="0"|tabindex="0"[^>]*role="log"/u);
  });
});

describe('the whole scene', () => {
  const scene = (source: ProjectDetail, workspace: Partial<Workspace> = {}) =>
    renderToStaticMarkup(
      <TooltipProvider>
        <ToastProvider>
          <WorkspaceContext.Provider value={workspaceOf(source, workspace)}>
            <GroundScene />
          </WorkspaceContext.Provider>
        </ToastProvider>
      </TooltipProvider>,
    );

  it.each(['pending', 'queued', 'running', 'ready', 'failed', 'cancelled'] as const)(
    'renders when the evidence step is %s, with the question as its heading',
    (step) => {
      const html = scene(project(step));
      expect(html).toContain('<h1');
      expect(words(html)).toContain('What could happen if the ferry fares fall by a third?');
    },
  );

  it('renders a record the guided flow did not make, and one with nothing in it', () => {
    const legacy = project();
    legacy.console = null;
    legacy.workflow = 'quick';
    expect(words(scene(legacy))).toContain('Saved record');
    legacy.graph = null;
    legacy.documents = [];
    expect(words(scene(legacy))).toContain('No source text');
  });

  it('keeps the operations out of Guided and has them in Advanced', () => {
    const source = project();
    expect(scene(source, { mode: 'guided' })).not.toContain('id="ground-trace"');
    expect(scene(source, { mode: 'advanced' })).toContain('id="ground-trace"');
  });
});
