import type { ProjectDetail } from '../../../shared/types';
import { isGuided, stepAvailable } from '../lib/console';

/** The journey, in the order a person takes it. */
export const SCENE_IDS = ['ask', 'ground', 'map', 'simulate', 'compare', 'decide'] as const;
export type SceneId = (typeof SCENE_IDS)[number];

/** The scenes a project is opened into: Ask is the entry screen, before there is a project. */
export const PROJECT_SCENES = ['ground', 'map', 'simulate', 'compare', 'decide'] as const;
export type ProjectScene = (typeof PROJECT_SCENES)[number];

export const SCENE_LABELS: Record<SceneId, string> = {
  ask: 'Ask',
  ground: 'Ground',
  map: 'Map',
  simulate: 'Simulate',
  compare: 'Compare',
  decide: 'Decide',
};

/** What each part of the journey is for, in a few words: the tooltip of a step and nothing more. */
export const SCENE_PURPOSE: Record<SceneId, string> = {
  ask: 'The change you want to explore',
  ground: 'The evidence it rests on',
  map: 'Who is affected',
  simulate: 'Watch it unfold',
  compare: 'Set the futures side by side',
  decide: 'What to do about it',
};

export function isSceneId(value: unknown): value is SceneId {
  return typeof value === 'string' && (SCENE_IDS as readonly string[]).includes(value);
}

export function isProjectScene(value: unknown): value is ProjectScene {
  return typeof value === 'string' && (PROJECT_SCENES as readonly string[]).includes(value);
}

/**
 * `done` the work of the scene is finished; `current` it is the one in view; `ready` it can be opened;
 * `working` the engine is doing something for it right now; `attention` it stopped and needs a look;
 * `locked` it cannot be opened yet, and `reason` says what opens it.
 */
export type SceneState = 'done' | 'current' | 'ready' | 'working' | 'attention' | 'locked';

export interface SceneInfo {
  id: SceneId;
  label: string;
  state: SceneState;
  /** Whether the scene is the one in view (a scene can be `done` and `current`). */
  current: boolean;
  /** Short, and only where the scene is locked: what it needs. */
  reason?: string;
}

function labOf(project: ProjectDetail) {
  return project.lab;
}

/** Whether a scene can be opened for this project. Ask is always open. */
export function sceneAvailable(project: ProjectDetail | null, scene: SceneId): boolean {
  if (scene === 'ask') return true;
  if (!project) return false;
  // A record that was not made by the guided flow has no stakeholders or comparison, and nothing to lock
  // in the rest: whatever it holds can be read.
  if (!isGuided(project)) return scene !== 'map' && scene !== 'compare';
  const lab = labOf(project);
  switch (scene) {
    case 'ground':
      return true;
    case 'map':
      return stepAvailable(project, 'environment') || (lab?.stakeholders ?? 'none') !== 'none';
    case 'simulate':
      return (lab?.actors ?? 0) > 0 || stepAvailable(project, 'simulation');
    case 'compare':
    case 'decide':
      return lab?.analysis === 'completed';
  }
}

/**
 * What a step of the journey is called to assistive technology: its name, then what a sighted person sees in its
 * glyph (a check, a spinner, a dot, a lock), so that a step that is running or stopped says so.
 */
export function sceneName(step: SceneInfo): string {
  switch (step.state) {
    case 'locked':
      return step.reason ? `${step.label}, locked: ${step.reason}` : `${step.label}, locked`;
    case 'working':
      return `${step.label}, in progress`;
    case 'attention':
      return `${step.label}, stopped: needs a look`;
    case 'done':
      return `${step.label}, done`;
    default:
      return step.label;
  }
}

const LOCKS: Record<Exclude<SceneId, 'ask' | 'ground'>, string> = {
  map: 'Ground it first',
  simulate: 'Needs actors',
  compare: 'Run a simulation first',
  decide: 'Run a simulation first',
};

/** Why a scene is shut for a record that the guided flow did not make. */
const LEGACY_LOCK = 'Not in this record';

/** What the journey rail and the dock show for each scene, from what the project's own record holds. */
export function sceneInfos(project: ProjectDetail | null, current: SceneId): SceneInfo[] {
  return SCENE_IDS.map((id) => {
    const info = (state: SceneState, reason?: string): SceneInfo => ({
      id,
      label: SCENE_LABELS[id],
      state: id === current && state === 'ready' ? 'current' : state,
      current: id === current,
      ...(reason ? { reason } : {}),
    });
    if (id === 'ask') return info(project ? 'done' : 'current');
    if (!project) return info('locked', 'Ask first');
    if (!sceneAvailable(project, id)) {
      return info('locked', isGuided(project) ? LOCKS[id as keyof typeof LOCKS] : LEGACY_LOCK);
    }
    const lab = labOf(project);
    const steps = project.console?.steps;
    switch (id) {
      case 'ground': {
        const status = steps?.knowledge;
        if (status === 'running' || status === 'queued') return info('working');
        if (status === 'failed' || status === 'cancelled') return info('attention');
        return info(status === 'ready' || !steps ? 'done' : 'ready');
      }
      case 'map':
        if (lab?.stakeholders === 'approved' && (lab.actors ?? 0) > 0) return info('done');
        return info('ready');
      case 'simulate':
        if (lab?.analysis === 'running') return info('working');
        if (lab?.analysis === 'failed') return info('attention');
        return info(lab?.analysis === 'completed' ? 'done' : 'ready');
      case 'compare':
        return info('ready');
      case 'decide':
        return info(lab?.brief ? 'done' : 'ready');
      default:
        return info('ready');
    }
  });
}

/**
 * Where a project is opened to: the furthest scene its record has reached, so that a finished
 * exploration opens on its answer and one in progress opens where the work is.
 */
export function frontierScene(project: ProjectDetail): ProjectScene {
  const lab = labOf(project);
  if (lab?.analysis === 'completed') return 'decide';
  if (lab?.analysis === 'running') return 'simulate';
  if ((lab?.actors ?? 0) > 0) return 'simulate';
  if (!isGuided(project))
    return project.report ? 'decide' : project.rounds.length ? 'simulate' : 'ground';
  if (sceneAvailable(project, 'map') && project.console?.steps.knowledge === 'ready') return 'map';
  return 'ground';
}

/** The scene a person is sent to next, from the one they are in, when there is a natural next one. */
export function nextScene(project: ProjectDetail | null, from: SceneId): SceneId | null {
  const index = SCENE_IDS.indexOf(from);
  for (const candidate of SCENE_IDS.slice(index + 1)) {
    if (sceneAvailable(project, candidate)) return candidate;
    break;
  }
  return null;
}
