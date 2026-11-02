import { useEffect, useState } from 'react';
import type { BriefView } from '../../../../shared/brief';
import { briefApi } from '../../api/brief';

/**
 * The brief's view of the project, read for the one thing it alone says: whether what a comparison was made from has
 * changed. It is read when the project changes, quietly, and a failed read is not an error to show: the comparison
 * stands, with no claim about how current it is.
 */
export function useBriefView(projectId: string, token: string): BriefView | null {
  const [state, setState] = useState<{ key: string; view: BriefView | null }>({
    key: '',
    view: null,
  });
  const key = `${projectId}|${token}`;
  useEffect(() => {
    const controller = new AbortController();
    void briefApi.get(projectId, controller.signal).then(
      (view) => {
        if (!controller.signal.aborted) setState({ key, view });
      },
      () => {
        if (!controller.signal.aborted) setState({ key, view: null });
      },
    );
    return () => controller.abort();
  }, [projectId, key]);
  return state.view;
}
