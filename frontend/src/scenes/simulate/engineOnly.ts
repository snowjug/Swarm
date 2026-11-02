import { isEngineOnly } from '../../app/scenes';
import type { ProjectDetail } from '../../../../shared/types';

/**
 * A run the engine made on its own, with its rounds saved (the recorded demonstration is one): the lab holds nothing for
 * it, so there are no futures to set side by side and no replay of a comparison to watch. What it has is its run, and
 * that is read in the deep dive. Its simulation opens there, and its comparison is the one of its recorded runs.
 */
export function readsThroughTheDeepDive(project: ProjectDetail): boolean {
  return isEngineOnly(project) && project.rounds.length > 0;
}
