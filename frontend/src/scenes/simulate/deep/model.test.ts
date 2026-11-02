import { describe, expect, it } from 'vitest';
import { checkpointFixture } from '../../../test/project';
import { deepFixture } from './fixture';
import {
  NO_FILTER,
  changeText,
  deepPhase,
  defaultPlatform,
  draftChanges,
  environmentEditable,
  environmentInput,
  filterMemories,
  interventionMark,
  memoriesOf,
  memoryFacets,
  minutesText,
  phaseView,
  platformViews,
  progressShare,
  proxyLines,
  roundDetail,
  roundPoints,
  runControls,
  sameDraft,
  stanceText,
  waitingBranch,
} from './model';

describe('how numbers are said', () => {
  it('signs an inclination with a true minus and never shows a negative zero', () => {
    expect(stanceText(0.123)).toBe('+0.12');
    expect(stanceText(-0.04)).toBe('\u22120.04');
    expect(stanceText(-0.001)).toBe('0.00');
    expect(stanceText(Number.NaN)).toBe('not recorded');
  });

  it('signs a change, and says plainly when there is none', () => {
    expect(changeText(0.031)).toBe('+0.03');
    expect(changeText(-0.2)).toBe('\u22120.20');
    expect(changeText(0)).toBe('±0.00');
  });

  it('says scenario minutes as people do', () => {
    expect(minutesText(45)).toBe('45 min');
    expect(minutesText(480)).toBe('8 h');
    expect(minutesText(150)).toBe('2 h 30 min');
  });
});

describe('where the run stands', () => {
  it('reads the environment first and the simulation after it', () => {
    expect(deepPhase(deepFixture({ simulation: 'ready' }))).toBe('complete');
    expect(deepPhase(deepFixture({ simulation: 'paused', saved: 2 }))).toBe('paused');
    expect(deepPhase(deepFixture({ simulation: 'running', saved: 2 }))).toBe('running');
    expect(deepPhase(deepFixture({ simulation: 'failed', saved: 1 }))).toBe('failed');
    expect(deepPhase(deepFixture({ simulation: 'cancelled', saved: 0 }))).toBe('cancelled');
    expect(deepPhase(deepFixture({ simulation: 'pending', saved: 0 }))).toBe('ready');
    expect(
      deepPhase(deepFixture({ simulation: 'pending', saved: 0, environment: 'pending' })),
    ).toBe('unprepared');
    expect(
      deepPhase(deepFixture({ simulation: 'pending', saved: 0, environment: 'running' })),
    ).toBe('preparing');
    expect(deepPhase(deepFixture({ simulation: 'pending', saved: 0, environment: 'failed' }))).toBe(
      'prep-stopped',
    );
  });

  it('tells a quick run from a guided record that lost its stages', () => {
    const quick = deepFixture();
    quick.workflow = 'quick';
    quick.console = null;
    expect(deepPhase(quick)).toBe('legacy');
    const lost = deepFixture();
    lost.console = null;
    expect(deepPhase(lost)).toBe('unavailable');
  });

  it('describes a paused run by the rounds that were saved, and a live one as live', () => {
    const paused = phaseView(deepFixture({ simulation: 'paused', saved: 2 }));
    expect(paused.label).toBe('Paused');
    expect(paused.detail).toContain('After round 2 of 6');
    expect(paused.live).toBe(false);
    expect(phaseView(deepFixture({ simulation: 'running', saved: 2 })).live).toBe(true);
  });

  it('calls a branch that has not run yet ready, and a run that was paused after it paused', () => {
    const branch = {
      parentId: '22222222-2222-4222-8222-222222222222',
      parentName: 'Parent',
      rootId: '22222222-2222-4222-8222-222222222222',
      fromRound: 2,
      createdAt: '2026-01-02T00:00:00Z',
      changes: [],
    };
    const waiting = deepFixture({ simulation: 'paused', saved: 2 });
    waiting.console!.branch = branch;
    expect(waitingBranch(waiting)).toBe(true);
    expect(phaseView(waiting).label).toBe('Branch ready');
    expect(phaseView(waiting).detail).toContain('Copied through round 2 of 6');

    const later = deepFixture({ simulation: 'paused', saved: 4 });
    later.console!.branch = branch;
    expect(waitingBranch(later)).toBe(false);
    expect(phaseView(later).label).toBe('Paused');
    expect(waitingBranch(deepFixture({ simulation: 'paused', saved: 2 }))).toBe(false);
  });

  it('measures progress from saved rounds only', () => {
    expect(progressShare(deepFixture({ saved: 3, simulation: 'running' }))).toBeCloseTo(0.5);
    expect(progressShare({ currentRound: 9, roundCount: 6 })).toBe(1);
    expect(progressShare({ currentRound: 0, roundCount: 0 })).toBe(0);
  });
});

describe('what may be done', () => {
  it('lets a paused run resume, restart, branch and take an intervention, when the server allows what-if', () => {
    const project = checkpointFixture();
    project.roundCount = 3;
    const on = runControls(project, true);
    expect(on).toMatchObject({
      resume: true,
      restart: true,
      branch: true,
      intervention: true,
      pause: false,
    });
    const off = runControls(project, false);
    expect(off).toMatchObject({
      resume: false,
      restart: false,
      branch: false,
      intervention: false,
    });
  });

  it('offers pause and cancel only while it runs', () => {
    const project = deepFixture({ simulation: 'running', saved: 2 });
    const controls = runControls(project, true);
    expect(controls.pause).toBe(true);
    expect(controls.cancel).toBe(true);
    expect(controls.start).toBe(false);
    expect(runControls(project, false).pause).toBe(false);
  });

  it('puts a failed run with saved rounds into recovery rather than a plain retry', () => {
    const project = deepFixture({ simulation: 'failed', saved: 2 });
    project.status = 'failed';
    const controls = runControls(project, true);
    expect(controls.recovering).toBe(true);
    expect(controls.resume).toBe(true);
    expect(controls.restart).toBe(true);
    expect(controls.start).toBe(false);
  });

  it('offers a plain retry where there is nothing saved to recover', () => {
    const project = deepFixture({ simulation: 'cancelled', saved: 0 });
    project.status = 'cancelled';
    project.console!.activeStep = 'simulation';
    const controls = runControls(project, true);
    expect(controls.start).toBe(true);
    expect(controls.retry).toBe(true);
    expect(controls.recovering).toBe(false);
  });

  it('offers the report once the simulation is finished, and to open it once it exists', () => {
    expect(runControls(deepFixture({ simulation: 'ready' }), true).report).toBe('write');
    expect(runControls(deepFixture({ simulation: 'ready', report: 'ready' }), true).report).toBe(
      'open',
    );
    expect(runControls(deepFixture({ simulation: 'paused', saved: 2 }), true).report).toBeNull();
  });

  it('closes the environment to edits once the simulation has started', () => {
    const prepared = deepFixture({ simulation: 'pending', saved: 0 });
    prepared.status = 'ready';
    expect(environmentEditable(prepared)).toBe(true);
    expect(environmentEditable(deepFixture({ simulation: 'ready' }))).toBe(false);
  });
});

describe('platforms are never merged', () => {
  it('reads each platform from its own run', () => {
    const views = platformViews(deepFixture());
    expect(views.map((view) => view.id)).toEqual(['plaza', 'community']);
    expect(views[0]!.rounds).toHaveLength(6);
    expect(views[0]!.latest?.round).toBe(6);
    expect(views[0]!.minutes).toBe(360);
    expect(views[0]!.actions).toBe(24);
  });

  it('starts on the first platform that has rounds', () => {
    const project = deepFixture();
    project.console!.platforms = project.console!.platforms.filter(
      (run) => run.platform === 'community',
    );
    expect(defaultPlatform(project)).toBe('community');
    expect(platformViews(project)[0]!.run).toBeNull();
  });
});

describe('rounds', () => {
  const project = deepFixture({ rounds: 6, saved: 4 });
  const plaza = platformViews(project)[0]!;

  it('turns snapshots into one point per round, in order', () => {
    const points = roundPoints(plaza.rounds.slice().reverse());
    expect(points.map((point) => point.round)).toEqual([1, 2, 3, 4]);
    expect(points[0]!.support + points[0]!.undecided + points[0]!.opposition).toBeCloseTo(1);
  });

  it('starts each proxy’s line at the inclination the environment gave it', () => {
    const lines = proxyLines(plaza.rounds, project.agents);
    expect(lines[0]!.points[0]).toEqual({ round: 0, opinion: -0.6 });
    expect(lines[0]!.points).toHaveLength(5);
  });

  it('shows round 0 as the starting inclinations and later rounds against the round before', () => {
    const start = roundDetail(plaza.rounds, project.agents, 0, 60);
    expect(start.point).toBeNull();
    expect(start.proxies.map((proxy) => proxy.opinion)).toEqual([-0.6, -0.1, 0.2, 0.7]);
    expect(start.minute).toBe(0);
    const second = roundDetail(plaza.rounds, project.agents, 2, 60);
    expect(second.minute).toBe(120);
    const first = plaza.rounds[0]!.opinions[0]!.opinion;
    const now = plaza.rounds[1]!.opinions[0]!.opinion;
    expect(second.proxies[0]!.before).toBeCloseTo(first);
    expect(second.proxies[0]!.change).toBeCloseTo(now - first);
    expect(second.previous?.round).toBe(1);
    expect(second.actions).toHaveLength(4);
  });

  it('makes nothing up for a round that was not saved', () => {
    const late = roundDetail(plaza.rounds, project.agents, 6, 60);
    expect(late.proxies).toEqual([]);
    expect(late.actions).toEqual([]);
    expect(late.point).toBeNull();
  });

  it('knows which round an event was applied in, and which is only scheduled', () => {
    const event = { round: 3, label: 'A scheduled assumption.', stance: -0.4, strength: 0.6 };
    const run = deepFixture({ rounds: 6, saved: 4, event });
    expect(interventionMark(run)).toMatchObject({ round: 3, applied: true });
    expect(platformViews(run)[0]!.rounds[2]!.intervention).toEqual(event);
    const waiting = deepFixture({ rounds: 6, saved: 2, event });
    expect(interventionMark(waiting)).toMatchObject({ round: 3, applied: false });
    expect(interventionMark(deepFixture())).toBeNull();
  });
});

describe('the memory stream', () => {
  const project = deepFixture({ rounds: 3, saved: 3 });
  const memories = memoriesOf(project.console!.memories, 'plaza');

  it('keeps one platform apart from the other', () => {
    expect(memories.every((memory) => memory.platform === 'plaza')).toBe(true);
    expect(memories).toHaveLength(13);
  });

  it('puts the newest first and filters by proxy, round, action and text', () => {
    const all = filterMemories(memories, NO_FILTER);
    expect(all[0]!.round).toBe(3);
    expect(all.at(-1)!.round).toBe(0);
    expect(
      filterMemories(memories, { ...NO_FILTER, agentId: 'agent-2' }).every(
        (m) => m.agentId === 'agent-2',
      ),
    ).toBe(true);
    expect(filterMemories(memories, { ...NO_FILTER, round: 2 })).toHaveLength(4);
    expect(filterMemories(memories, { ...NO_FILTER, action: 'seed' })).toHaveLength(1);
    expect(filterMemories(memories, { ...NO_FILTER, query: '  SOURCE context ' })).toHaveLength(1);
    expect(filterMemories(memories, { ...NO_FILTER, query: 'agent-3', round: 1 })).toHaveLength(1);
  });

  it('lists only the rounds and actions that were recorded', () => {
    const facets = memoryFacets(memories);
    expect(facets.rounds).toEqual([0, 1, 2, 3]);
    expect(facets.actions[0]).toBe('seed');
    expect(facets.actions).not.toContain('reply');
  });
});

describe('the environment draft', () => {
  const project = deepFixture({ simulation: 'pending', saved: 0 });

  it('starts from what was saved and nothing more', () => {
    const draft = environmentInput(project)!;
    expect(draft.agents).toHaveLength(4);
    expect(Object.keys(draft.agents[0]!).sort()).toEqual([
      'id',
      'influence',
      'initialOpinion',
      'name',
      'openness',
      'persona',
      'role',
    ]);
    expect(
      environmentInput({ ...project, console: { ...project.console!, environment: null } }),
    ).toBeNull();
  });

  it('counts what changed, by the thing that changed', () => {
    const initial = environmentInput(project)!;
    expect(draftChanges(initial, initial).total).toBe(0);
    const draft = {
      ...initial,
      rounds: 8,
      platforms: ['plaza' as const],
      initialPosts: initial.initialPosts.map((post) => ({ ...post, stance: -0.3 })),
      agents: initial.agents.map((agent, index) =>
        index === 1 ? { ...agent, influence: 1.9 } : agent,
      ),
    };
    const changes = draftChanges(initial, draft);
    expect(changes).toMatchObject({
      timing: true,
      platforms: true,
      seeds: ['P1'],
      proxies: ['agent-2'],
      total: 4,
    });
    expect(sameDraft(initial, draft)).toBe(false);
    expect(sameDraft(initial, { ...initial, rounds: Number.NaN })).toBe(false);
  });
});
