import { describe, expect, it } from 'vitest';
import type { ProjectDetail } from '../../../shared/types';
import { projectFixture, roundFixture } from '../test/project';
import { readRoute } from './route';
import {
  SCENE_IDS,
  frontierScene,
  isProjectScene,
  isSceneId,
  nextScene,
  sceneAvailable,
  sceneInfos,
} from './scenes';

/** A guided project whose evidence has not been read yet, with the lab's progress as given. */
const lab = (
  over: Partial<NonNullable<ProjectDetail['lab']>>,
  evidenceRead = false,
): ProjectDetail => {
  const project = projectFixture();
  if (evidenceRead) project.console!.steps.knowledge = 'ready';
  project.lab = {
    scenario: true,
    stakeholders: 'none',
    actors: 0,
    analysis: 'none',
    critiques: false,
    brief: false,
    ...over,
  };
  return project;
};

describe('the journey', () => {
  it('goes ask, ground, map, simulate, compare, decide', () => {
    expect([...SCENE_IDS]).toEqual(['ask', 'ground', 'map', 'simulate', 'compare', 'decide']);
    expect(isSceneId('map')).toBe(true);
    expect(isSceneId('settings')).toBe(false);
    expect(isProjectScene('ask')).toBe(false);
  });

  it('opens Ask for anyone and Ground for any project, and the rest as the work reaches them', () => {
    expect(sceneAvailable(null, 'ask')).toBe(true);
    expect(sceneAvailable(null, 'ground')).toBe(false);
    expect(sceneAvailable(lab({}), 'ground')).toBe(true);
    expect(sceneAvailable(lab({}), 'simulate')).toBe(false);
    expect(sceneAvailable(lab({ stakeholders: 'proposed' }), 'map')).toBe(true);
    expect(sceneAvailable(lab({ stakeholders: 'approved', actors: 12 }), 'simulate')).toBe(true);
    expect(sceneAvailable(lab({ actors: 12 }), 'compare')).toBe(false);
    expect(sceneAvailable(lab({ analysis: 'completed' }), 'compare')).toBe(true);
    expect(sceneAvailable(lab({ analysis: 'completed' }), 'decide')).toBe(true);
  });

  it('says what a locked step needs, in a few words', () => {
    const steps = sceneInfos(lab({}), 'ground');
    const locked = steps.filter((step) => step.state === 'locked');
    expect(locked.map((step) => step.id)).toEqual(['map', 'simulate', 'compare', 'decide']);
    for (const step of locked) expect(step.reason?.length ?? 0).toBeGreaterThan(3);
    expect(steps.find((step) => step.id === 'ground')?.current).toBe(true);
  });

  it('shows the work as it stands: running, done, needing attention', () => {
    const running = sceneInfos(
      lab({ stakeholders: 'approved', actors: 5, analysis: 'running' }),
      'simulate',
    );
    expect(running.find((step) => step.id === 'simulate')?.state).toBe('working');
    const failed = sceneInfos(
      lab({ stakeholders: 'approved', actors: 5, analysis: 'failed' }),
      'ground',
    );
    expect(failed.find((step) => step.id === 'simulate')?.state).toBe('attention');
    const done = sceneInfos(
      lab({ stakeholders: 'approved', actors: 5, analysis: 'completed', brief: true }),
      'decide',
    );
    expect(done.find((step) => step.id === 'decide')).toMatchObject({
      state: 'done',
      current: true,
    });
    expect(done.find((step) => step.id === 'map')?.state).toBe('done');
    expect(done.find((step) => step.id === 'ask')?.state).toBe('done');
  });

  it('opens a project on the furthest place its work has reached', () => {
    expect(frontierScene(lab({}))).toBe('ground');
    expect(frontierScene(lab({}, true))).toBe('map');
    expect(frontierScene(lab({ stakeholders: 'approved', actors: 4 }))).toBe('simulate');
    expect(frontierScene(lab({ analysis: 'completed' }))).toBe('decide');
  });

  it('goes on to the next scene only when it can be opened', () => {
    expect(nextScene(lab({}), 'ground')).toBeNull();
    expect(nextScene(lab({}, true), 'ground')).toBe('map');
    expect(nextScene(null, 'ask')).toBeNull();
  });

  it('lets a run the engine made on its own reach its run, its report and its run comparison, and keeps a lab record gated', () => {
    // A guided record that the lab holds nothing for, as the server sends it: the recorded demonstration is one.
    const engineOnly = lab({}, true);
    engineOnly.lab = {
      scenario: false,
      stakeholders: 'none',
      actors: 0,
      analysis: 'none',
      critiques: false,
      brief: false,
    };
    expect(sceneAvailable(engineOnly, 'compare')).toBe(false);
    expect(sceneAvailable(engineOnly, 'decide')).toBe(false);
    expect(frontierScene(engineOnly)).toBe('map');

    engineOnly.rounds = [roundFixture()];
    expect(sceneAvailable(engineOnly, 'compare')).toBe(true);
    expect(sceneAvailable(engineOnly, 'decide')).toBe(false);
    expect(frontierScene(engineOnly)).toBe('simulate');

    engineOnly.report = {} as NonNullable<ProjectDetail['report']>;
    expect(sceneAvailable(engineOnly, 'decide')).toBe(true);

    // Without a lab record at all it is the same.
    delete engineOnly.lab;
    expect(sceneAvailable(engineOnly, 'decide')).toBe(true);

    // The same rounds in a record that the lab has begun do not open what the lab has not produced.
    const guided = lab({}, true);
    guided.rounds = [roundFixture()];
    guided.report = {} as NonNullable<ProjectDetail['report']>;
    expect(sceneAvailable(guided, 'compare')).toBe(false);
    expect(sceneAvailable(guided, 'decide')).toBe(false);
  });

  it('treats a record that the guided flow did not make as readable but without a map or a comparison', () => {
    const legacy = projectFixture();
    legacy.workflow = 'quick';
    legacy.console = null;
    expect(sceneAvailable(legacy, 'ground')).toBe(true);
    expect(sceneAvailable(legacy, 'map')).toBe(false);
    expect(sceneAvailable(legacy, 'compare')).toBe(false);
    expect(sceneAvailable(legacy, 'decide')).toBe(true);
    expect(sceneInfos(legacy, 'ground').find((step) => step.id === 'map')?.reason).toBe(
      'Not in this record',
    );
  });
});

describe('the address', () => {
  it('reads the scene and the view, and ignores what it does not know', () => {
    expect(readRoute('?project=p&scene=map&view=list')).toEqual({ scene: 'map', view: 'list' });
    expect(readRoute('?scene=nonsense&view=Not%20a%20view')).toEqual({ scene: null, view: null });
    expect(readRoute('')).toEqual({ scene: null, view: null });
    expect(readRoute('?scene=simulate&view=' + 'x'.repeat(40))).toEqual({
      scene: 'simulate',
      view: null,
    });
  });
});
