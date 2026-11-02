import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BranchInfo } from '../../../../../shared/guided';
import type { AppConfig, ProjectDetail } from '../../../../../shared/types';
import { WorkspaceContext, type Workspace } from '../../../app/context';
import { sceneInfos } from '../../../app/scenes';
import { ToastProvider, TooltipProvider } from '../../../design/ui';
import { projectFixture } from '../../../test/project';
import { deepFixture } from './fixture';
import DeepDive from './index';

const noop = () => undefined;

function workspaceOf(project: ProjectDetail, mode: Workspace['mode'], whatIf: boolean): Workspace {
  return {
    project,
    config: { capabilities: { whatIf } } as unknown as AppConfig,
    mode,
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
    scene: 'simulate',
    view: 'deep',
    go: noop,
    setView: noop,
    journey: sceneInfos(project, 'simulate'),
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

function render(
  project: ProjectDetail,
  options: { mode?: Workspace['mode']; whatIf?: boolean } = {},
) {
  return renderToStaticMarkup(
    <TooltipProvider>
      <ToastProvider>
        <WorkspaceContext.Provider
          value={workspaceOf(project, options.mode ?? 'guided', options.whatIf ?? true)}
        >
          <DeepDive />
        </WorkspaceContext.Provider>
      </ToastProvider>
    </TooltipProvider>,
  );
}

/** What a reader would read: the markup without its tags. */
const read = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ');

const branchOf = (): BranchInfo => ({
  parentId: '22222222-2222-4222-8222-222222222222',
  parentName: 'Parent scenario',
  rootId: '22222222-2222-4222-8222-222222222222',
  fromRound: 2,
  createdAt: '2026-01-02T00:00:00Z',
  changes: [
    {
      kind: 'intervention',
      from: null,
      to: { round: 3, label: 'A second pilot is announced.', stance: 0.4, strength: 0.5 },
    },
    { kind: 'agent', agentId: 'agent-1', field: 'influence', from: 1.4, to: 1.8 },
  ],
});

describe('the deep dive, by where the run stands', () => {
  it('invites preparation and offers no run before there is an environment', () => {
    const text = read(render(projectFixture()));
    expect(text).toContain('Not prepared');
    expect(text).toContain('Make the cast and the platforms');
    expect(text).not.toContain('Start the simulation');
    expect(text).not.toContain('Pause at the last saved round');
  });

  it('offers the start once the environment is ready, with every setting readable', () => {
    const text = read(render(deepFixture({ saved: 0, simulation: 'pending' })));
    expect(text).toContain('Ready to start');
    expect(text).toContain('Start the simulation');
    expect(text).toContain('Platforms to run');
    expect(text).toContain('Assumed stance');
    expect(text).toContain('Nothing is saved until you save.');
  });

  it('says it is running, offers a pause and a cancel, and no start', () => {
    const text = read(render(deepFixture({ saved: 2, simulation: 'running' })));
    expect(text).toContain('Running');
    expect(text).toContain('2 of 6 rounds saved');
    expect(text).toContain('Round 3 is being worked out.');
    expect(text).toContain('Pause at the last saved round');
    expect(text).toContain('Cancel');
    expect(text).not.toContain('Start the simulation');
    expect(text).toContain('Pause the run to schedule or change an event.');
  });

  it('keeps what a pause saved, and says what a restart would discard', () => {
    const text = read(render(deepFixture({ saved: 2, simulation: 'paused' })));
    expect(text).toContain('Paused');
    expect(text).toContain('After round 2 of 6. Saved and resumable.');
    expect(text).toContain('Saved rounds are kept');
    expect(text).toContain('Resume — simulate rounds 3–6');
    expect(text).toContain('A restart discards 2 saved rounds');
    expect(text).toContain('never half saved');
    expect(text).toContain('Schedule the event');
    expect(text).toContain('Branch from a round');
    expect(text).toContain('Ask a proxy');
  });

  it('shows what the server recorded when a run stopped, and how to carry on', () => {
    const failed = deepFixture({ saved: 3, simulation: 'failed' });
    failed.error = 'The simulation stopped: the provider did not answer in time.';
    const text = read(render(failed));
    expect(text).toContain('The server recorded an error');
    expect(text).toContain('the provider did not answer in time');
    expect(text).toContain('A saved checkpoint at round 3');
    expect(text).toContain('Resume — simulate rounds 4–6');
  });

  it('offers a retry when a run was cancelled before it saved anything', () => {
    const text = read(render(deepFixture({ saved: 0, simulation: 'cancelled' })));
    expect(text).toContain('Cancelled');
    expect(text).toContain('Retry the simulation');
    expect(text).toContain('No round was saved.');
    expect(text).toContain('There is no saved round to continue from');
  });

  it('draws a finished run as one chart with a name and a table, one platform at a time', () => {
    const html = render(deepFixture());
    const text = read(html);
    expect(text).toContain('Finished');
    expect(html).toMatch(/role="img" aria-label="Info Plaza: 6 of 6 rounds recorded/);
    expect(html).toContain('The exact values are in the data table.');
    expect(html).toContain('<table');
    expect(html).toContain('<caption>');
    expect(text).toContain('Round 6 of 6');
    expect(text).toContain('Info Plaza');
    expect(html).not.toContain('Topic Community: 6 of 6 rounds recorded');
  });

  it('names the parent of a branch and every change that was declared', () => {
    const branched = deepFixture({ saved: 2, simulation: 'paused' });
    branched.console!.branch = branchOf();
    const text = read(render(branched));
    expect(text).toContain('A branch of Parent scenario');
    expect(text).toContain('Branch ready');
    expect(text).toContain('Branched after round 2 of 6');
    expect(text).toContain('Left after round 2. Rounds 1 to 2 were copied unchanged.');
    expect(text).toContain('Declared changes are assumptions, not proof of a cause.');
    expect(text).toContain('2 declared changes');
    expect(text).toContain('Rounds 1 to 2 came from the parent run and were not run again.');
  });

  it('shows a quick run as it was saved and invents no platform for it', () => {
    const quick = deepFixture();
    quick.workflow = 'quick';
    quick.console = null;
    const text = read(render(quick));
    expect(text).toContain('A quick run, saved before the staged engine');
    expect(text).toContain('Duplicate as a guided exploration');
    expect(text).toContain('were not recorded');
    expect(text).not.toContain('Info Plaza');
    expect(text).not.toContain('Topic Community');
  });

  it('turns the controls off when the staged record did not come back', () => {
    const lost = deepFixture();
    lost.console = null;
    const text = read(render(lost));
    expect(text).toContain('The staged record is unavailable');
    expect(text).toContain('Read it again');
    expect(text).toContain('not returned');
    expect(text).not.toContain('Start the simulation');
    expect(text).not.toContain('Resume');
  });
});

describe('what the deep dive says it is', () => {
  const finished = deepFixture();

  it('calls proxies fictional and never claims to predict', () => {
    const text = read(render(finished));
    expect(text).toContain('Proxies are fictional stand-ins, not people.');
    expect(text).toContain('Nothing here predicts what real people would do.');
    expect(text).toContain('Platform positions are scenario state, not measured public opinion.');
    expect(text).not.toMatch(/\b(forecast|will happen|likely outcome|expected outcome)\b/i);
  });

  it('keeps the platforms apart', () => {
    const text = read(render(deepFixture({ saved: 2, simulation: 'paused' })));
    expect(text).toContain('Two platforms, kept apart');
    expect(text).toContain('never added together or averaged into one audience');
    expect(text).toContain('Info Plaza');
    expect(text).toContain('Topic Community');
  });

  it('shows words that came from a person or a model as text, never as markup', () => {
    const hostile = deepFixture();
    hostile.agents![0]!.name = '<img src=x onerror=alert(1)>';
    hostile.console!.platforms[0]!.rounds.at(-1)!.actions[0]!.content =
      '<script>alert("x")</script>';
    const html = render(hostile);
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;img src=x');
  });

  it('keeps the engine records one step away, or a tab in the advanced view', () => {
    const guided = render(finished, { mode: 'guided' });
    expect(read(guided)).toContain('Engine records: traces, the log and the raw state');
    expect(guided).not.toContain('>Advanced<');
    const advanced = render(finished, { mode: 'advanced' });
    expect(advanced).toContain('>Advanced<');
    expect(read(advanced)).not.toContain('Engine records: traces, the log and the raw state');
  });

  it('leaves out branching and the assumed event when the server cannot do what-if', () => {
    const paused = deepFixture({ saved: 2, simulation: 'paused' });
    const text = read(render(paused, { whatIf: false }));
    expect(text).toContain('Resume');
    expect(text).not.toContain('Branch from a round');
    expect(text).not.toContain('Schedule the event');
  });
});
