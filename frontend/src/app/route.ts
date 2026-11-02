import { useSyncExternalStore } from 'react';
import { isSceneId, type SceneId } from './scenes';

/**
 * What the address holds besides the project: which scene is open and, inside it, which view. The
 * project itself is read and written by `useConsole` (`?project=`); this only adds to it, so that a link
 * to a scene, a reload and the browser's Back button all land where the person was.
 */
export interface SceneRoute {
  scene: SceneId | null;
  view: string | null;
}

const EVENT = 'swarm:route';

export function readRoute(search: string = window.location.search): SceneRoute {
  const params = new URLSearchParams(search);
  const scene = params.get('scene');
  const view = params.get('view');
  return {
    scene: isSceneId(scene) ? scene : null,
    view: view && /^[a-z-]{1,24}$/u.test(view) ? view : null,
  };
}

/** Writes the scene and view into the address, keeping everything else. `null` removes one. */
export function navigate(patch: Partial<SceneRoute>, options: { replace?: boolean } = {}): void {
  const url = new URL(window.location.href);
  if ('scene' in patch) {
    if (patch.scene) url.searchParams.set('scene', patch.scene);
    else url.searchParams.delete('scene');
  }
  if ('view' in patch) {
    if (patch.view) url.searchParams.set('view', patch.view);
    else url.searchParams.delete('view');
  }
  if (url.href !== window.location.href) {
    if (options.replace) window.history.replaceState(window.history.state, '', url);
    else window.history.pushState({}, '', url);
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('popstate', listener);
  window.addEventListener(EVENT, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(EVENT, listener);
  };
}

let cached: { search: string; route: SceneRoute } | null = null;
function snapshot(): SceneRoute {
  const search = window.location.search;
  if (!cached || cached.search !== search) cached = { search, route: readRoute(search) };
  return cached.route;
}

const SERVER: SceneRoute = { scene: null, view: null };

export function useRoute(): SceneRoute {
  return useSyncExternalStore(subscribe, snapshot, () => SERVER);
}
