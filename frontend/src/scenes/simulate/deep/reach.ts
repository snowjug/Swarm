import { useEffect, useState } from 'react';
import type { ProjectDetail } from '../../../../../shared/types';
import { api } from '../../../api';
import { useWorkspace } from '../../../app/context';
import { sceneAvailable } from '../../../app/scenes';

/**
 * Where the comparison of two recorded runs can be opened from. It lives in the comparison scene, which a project
 * opens once its scenarios have been compared. A branch is a project of its own and has not been: its comparison
 * is the one of the run it was branched from, which already has the branch among its recorded runs.
 */
export type RunsReach =
  { way: 'here' } | { way: 'parent'; parentId: string } | { way: 'closed' } | { way: 'checking' };

export function useRunsReach(project: ProjectDetail): RunsReach {
  const open = sceneAvailable(project, 'compare');
  const parentId = project.console?.branch?.parentId ?? null;
  const [parent, setParent] = useState<{ id: string; open: boolean } | null>(null);

  useEffect(() => {
    if (open || !parentId) return undefined;
    const controller = new AbortController();
    void api.project(parentId, controller.signal).then(
      (detail) => {
        if (!controller.signal.aborted)
          setParent({ id: parentId, open: sceneAvailable(detail, 'compare') });
      },
      () => {
        if (!controller.signal.aborted) setParent({ id: parentId, open: false });
      },
    );
    return () => controller.abort();
  }, [open, parentId]);

  if (open) return { way: 'here' };
  if (!parentId) return { way: 'closed' };
  if (parent?.id !== parentId) return { way: 'checking' };
  return parent.open ? { way: 'parent', parentId } : { way: 'closed' };
}

/** What pressing "compare" does, for a way that is open. */
export function useOpenRuns(reach: RunsReach): (() => void) | null {
  const { go, openProject } = useWorkspace();
  if (reach.way === 'here') return () => go('compare', { view: 'runs' });
  if (reach.way === 'parent')
    return () => openProject(reach.parentId, { scene: 'compare', view: 'runs' });
  return null;
}
