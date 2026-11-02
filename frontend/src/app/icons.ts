import { Compass, GitCompareArrows, Layers, Orbit, Sparkles, Waypoints } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { SceneId } from './scenes';

/** One glyph for each part of the journey, used by the rail, the dock and anywhere a scene is named. */
export const SCENE_ICONS: Record<SceneId, LucideIcon> = {
  ask: Sparkles,
  ground: Layers,
  map: Waypoints,
  simulate: Orbit,
  compare: GitCompareArrows,
  decide: Compass,
};
