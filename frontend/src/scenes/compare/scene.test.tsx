import { createRef } from 'react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Analysis } from '../../../../shared/analysis';
import type { AnalysisSummary } from '../../../../shared/analysis-plan';
import { FIXTURE_VARIANTS, analysisFixture } from '../../../../shared/lab-fixtures';
import { WorkspaceContext, type Workspace } from '../../app/context';
import { sceneInfos } from '../../app/scenes';
import { TooltipProvider, ToastProvider } from '../../design/ui';
import type { AnalysisState } from '../../hooks/useAnalysis';
import { projectFixture } from '../../test/project';
import { CompareView, type CompareViewProps } from './CompareScene';
import { CompareDocument, type DocumentProps } from './Document';

const noop = () => undefined;

function workspaceOf(): Workspace {
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
    scene: 'compare',
    view: null,
    go: noop,
    setView: noop,
    journey: sceneInfos(project, 'compare'),
    sharing: false,
    panels: {
      history: noop,
      ask: noop,
      audit: noop,
      budget: noop,
      access: noop,
      provider: noop,
    },
  };
}

function page(node: ReactNode): string {
  return renderToStaticMarkup(
    <WorkspaceContext.Provider value={workspaceOf()}>
      <TooltipProvider>
        <ToastProvider>{node}</ToastProvider>
      </TooltipProvider>
    </WorkspaceContext.Provider>,
  );
}

/** What a person reads: the markup without its tags, entities or runs of space. */
const textOf = (markup: string): string =>
  markup
    .replace(/<style[^]*?<\/style>/gu, ' ')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/&#x27;/gu, '’')
    .replace(/&quot;/gu, '"')
    .replace(/\s+/gu, ' ');

const summaryOf = (analysis: Analysis): AnalysisSummary => ({
  id: analysis.id,
  status: analysis.status,
  createdAt: analysis.createdAt,
  completedAt: analysis.completedAt,
  runsPerVariant: analysis.config.runsPerVariant,
  variants: analysis.config.variants.map((variant) => ({ id: variant.id, label: variant.label })),
  sensitivity: analysis.config.sensitivity,
  progress: analysis.progress,
  findings: analysis.findings.length,
  sensitivityRows: analysis.sensitivity.length,
  cost: analysis.cost,
  fidelityLabel: analysis.fidelity.label,
  error: analysis.error,
});

function documentOf(analysis: Analysis, overrides: Partial<DocumentProps> = {}): string {
  return page(
    <CompareDocument
      analysis={analysis}
      summaries={[summaryOf(analysis)]}
      headingRef={createRef<HTMLHeadingElement>()}
      onSelect={noop}
      pending={false}
      onRun={noop}
      onDecide={noop}
      onReview={noop}
      onRuns={null}
      {...overrides}
    />,
  );
}

function stateOf(overrides: Partial<AnalysisState> = {}): AnalysisState {
  return {
    trouble: null,
    readiness: null,
    summaries: [],
    current: null,
    loading: false,
    error: null,
    starting: false,
    startError: null,
    cancelling: false,
    reload: noop,
    start: async () => true,
    cancel: async () => undefined,
    select: noop,
    ...overrides,
  };
}

function viewOf(state: AnalysisState, overrides: Partial<CompareViewProps> = {}): string {
  return page(
    <CompareView
      legacy={false}
      state={state}
      go={noop}
      onExplore={noop}
      headingRef={createRef<HTMLHeadingElement>()}
      pending={false}
      onSelect={noop}
      {...overrides}
    />,
  );
}

/** The same analysis with the impact of every actor at nothing, and no member's differing: the change cannot move anyone. */
function undirected(analysis: Analysis): Analysis {
  return analysisFixture({
    actors: analysis.actors.map((actor) => ({
      ...actor,
      traits: { ...actor.traits, impact: { ...actor.traits.impact, value: 0, spread: 0 } },
    })),
  });
}

/** Only the baseline was simulated. */
function alone(analysis: Analysis): Analysis {
  const [baseline] = analysis.variants;
  return analysisFixture({
    config: { ...analysis.config, variants: [FIXTURE_VARIANTS[0]!] },
    variants: baseline ? [baseline] : [],
    findings: [],
    sensitivity: [],
    progress: { completedRuns: 10, totalRuns: 10 },
  });
}

/** What the page must never say: nothing here is a probability, a prediction or a share of people. */
const NEVER = /probab|predict|chance of|percent of (the )?people/iu;

describe('the finished comparison', () => {
  const analysis = analysisFixture();
  const markup = documentOf(analysis);
  const text = textOf(markup);

  it('leads with what the runs show, in plain words about the two scenarios it sets side by side', () => {
    expect(text).toContain('Proposed change');
    expect(text).toContain('No change');
    expect(text).toContain('less favourable');
    expect(text).toMatch(/held in 10 of 10 seeded runs/u);
    expect(text).toContain('An exploration, not a forecast.');
  });

  it('has every part of the document, each one addressable', () => {
    for (const id of ['futures', 'movers', 'time', 'holds', 'depends', 'sets-off', 'rely']) {
      expect(markup, id).toContain(`id="${id}"`);
    }
    expect(markup).toContain('id="compare-title"');
  });

  it('gives every chart a text alternative and its numbers as a table', () => {
    const svgs = markup.match(/<svg\b[^>]*>/gu) ?? [];
    expect(svgs.length).toBeGreaterThan(0);
    for (const svg of svgs) expect(svg).toMatch(/aria-hidden="true"|role="img"/u);
    expect(markup).toMatch(/<table\b/u);
    expect(markup).toContain('<caption');
  });

  it('never calls a simulated share a probability, a prediction or a share of people', () => {
    expect(text).not.toMatch(NEVER);
  });
});

describe('a change that cannot move anyone', () => {
  const text = textOf(documentOf(undirected(analysisFixture())));
  const first = text.slice(0, text.indexOf('An exploration, not a forecast.'));

  it('claims nothing about the change on the first screen', () => {
    expect(first).toContain('Nothing in this change can move anyone.');
    expect(first).toContain('Every difference below is noise.');
    expect(first).toContain('Nothing to rate');
    expect(first).not.toContain('less favourable');
    expect(first).not.toMatch(/repeatable/iu);
    expect(text).not.toMatch(NEVER);
  });

  it('says what to do about it', () => {
    expect(text).toContain('Review the stakeholders');
  });
});

describe('a change that can move members although nobody is set as helped or harmed', () => {
  const analysis = analysisFixture({
    actors: analysisFixture().actors.map((actor) => ({
      ...actor,
      traits: { ...actor.traits, impact: { ...actor.traits.impact, value: 0 } },
    })),
  });
  const text = textOf(documentOf(analysis));

  it('keeps reading the runs, and says where the differences come from', () => {
    expect(text).toContain('less favourable than');
    expect(text).toContain('Read these differences with care');
    expect(text).toContain('they come from those assumptions and not from a direction of impact');
    expect(text).not.toContain('Nothing in this change can move anyone.');
  });
});

describe('one scenario alone', () => {
  const text = textOf(documentOf(alone(analysisFixture())));

  it('says there is nothing to set it against, and says nothing of a change it does not have', () => {
    expect(text).toContain('One scenario was simulated');
    expect(text).toContain('1 scenario');
    expect(text).toContain('There is nothing to set it against.');
    expect(text).not.toContain('cannot move anyone');
    expect(text).not.toContain('Why, and how sure');
  });
});

describe('every state of the page', () => {
  const finished = analysisFixture();
  const stopped = (status: Analysis['status']): Analysis =>
    analysisFixture({ status, progress: { completedRuns: 7, totalRuns: 20 }, completedAt: null });

  const states: [string, string][] = [
    ['reading', viewOf(stateOf({ loading: true }))],
    ['could not be read', viewOf(stateOf({ error: 'The server could not read it.' }))],
    ['nothing yet', viewOf(stateOf())],
    ['no actors', viewOf(stateOf({ readiness: { actors: null } as AnalysisState['readiness'] }))],
    ['legacy', viewOf(stateOf(), { legacy: true })],
    ['running', viewOf(stateOf({ current: stopped('running') }))],
    ['failed', viewOf(stateOf({ current: stopped('failed') }))],
    ['cancelled', viewOf(stateOf({ current: stopped('cancelled') }))],
    ['interrupted', viewOf(stateOf({ current: stopped('interrupted') }))],
    ['no results', viewOf(stateOf({ current: { ...finished, variants: [] } }))],
  ];

  it.each(states)('%s says what it means and never overclaims', (_name, markup) => {
    const text = textOf(markup);
    expect(text.length).toBeGreaterThan(20);
    expect(text).not.toMatch(NEVER);
  });

  it('shows how far a running comparison has got, with a way to watch it', () => {
    const text = textOf(states.find(([name]) => name === 'running')![1]);
    expect(text).toContain('7 of 20 simulated runs finished');
    expect(text).toContain('Watch it in Simulate');
  });

  it('never shows a partial comparison, and offers to run it again with the same settings', () => {
    for (const name of ['failed', 'cancelled', 'interrupted']) {
      const text = textOf(states.find(([label]) => label === name)![1]);
      expect(text, name).toContain('It stopped after 7 of 20 runs');
      expect(text, name).toContain('Run it again with the same settings');
      expect(text, name).not.toContain('less favourable');
    }
  });

  it('sends a project with no actors to the map, and one with none compared to simulate', () => {
    expect(textOf(states[3]![1])).toContain('Map the stakeholders');
    expect(textOf(states[2]![1])).toContain('Simulate the scenarios');
  });
});
