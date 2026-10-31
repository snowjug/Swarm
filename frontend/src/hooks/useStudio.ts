import { useCallback, useEffect, useRef, useState } from 'react';
import type { StudioView } from '../../../shared/studio';
import { ApiError, api, errorMessage, isAbort } from '../api';
import { refusalKind } from '../lib/studio';

export interface StudioHandle {
  view: StudioView | null;
  /** Why the studio could not be loaded. */
  loadError: string | null;
  /** Why the last change was refused, in the server's words. */
  actionError: string | null;
  /** What is being done now, by name, so that exactly one control can say it is working. */
  pending: string | null;
  loading: boolean;
  reload: () => void;
  clearActionError: () => void;
  /**
   * Makes one change and shows the studio as the server says it now is. Resolves true when it was
   * made. A change refused because the person's page was out of date also reloads the studio, so that
   * the next thing they see is what the document actually says.
   */
  act: (
    name: string,
    change: () => Promise<StudioView>,
    options?: { handled?: (code: string) => boolean },
  ) => Promise<boolean>;
}

export function useStudio(projectId: string): StudioHandle {
  const [view, setView] = useState<StudioView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const busy = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    void api.studio(projectId, controller.signal).then(
      (loaded) => {
        if (controller.signal.aborted) return;
        setView(loaded);
        setLoading(false);
      },
      (failure: unknown) => {
        if (controller.signal.aborted || isAbort(failure)) return;
        setLoadError(errorMessage(failure));
        setLoading(false);
      },
    );
    return () => controller.abort();
  }, [projectId, revision]);

  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const clearActionError = useCallback(() => setActionError(null), []);

  const act = useCallback(
    async (
      name: string,
      change: () => Promise<StudioView>,
      options: { handled?: (code: string) => boolean } = {},
    ): Promise<boolean> => {
      // One change at a time: a second click while the first is in flight is not a second change.
      if (busy.current) return false;
      busy.current = true;
      setPending(name);
      setActionError(null);
      try {
        setView(await change());
        return true;
      } catch (failure) {
        const kind = refusalKind(
          failure instanceof ApiError ? failure.code : null,
          options.handled,
        );
        // A refusal the caller deals with itself (it asks the person to confirm, say) is not an error to show.
        if (kind === 'handled') return false;
        setActionError(errorMessage(failure));
        if (kind === 'out-of-date') reload();
        return false;
      } finally {
        busy.current = false;
        setPending(null);
      }
    },
    [reload],
  );

  return { view, loadError, actionError, pending, loading, reload, clearActionError, act };
}
