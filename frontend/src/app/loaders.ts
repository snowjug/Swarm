import type { ComponentType } from 'react';
import type { ProjectScene } from './scenes';

/** Each scene is a chunk of its own: nothing of it is fetched until it is opened, or about to be. */
export const loaders: Record<ProjectScene, () => Promise<{ default: ComponentType }>> = {
  ground: () => import('../scenes/ground'),
  map: () => import('../scenes/map'),
  simulate: () => import('../scenes/simulate'),
  compare: () => import('../scenes/compare'),
  decide: () => import('../scenes/decide'),
};

/** Starts fetching a scene's code before it is opened, so that opening it is not a wait. */
export function preloadScene(scene: ProjectScene): void {
  void loaders[scene]().catch(() => undefined);
}
