import { useCallback, useEffect, useState } from 'react';
import type { BriefView } from '../../../shared/brief';
import { errorMessage } from '../api';
import { briefApi } from '../api/brief';

export interface BriefHandle {
  view: BriefView | null;
  loading: boolean;
  error: string | null;
  generating: boolean;
  generateError: string | null;
  /** Makes the brief from the newest completed analysis, and shows what was made. */
  generate: () => Promise<void>;
  reload: () => void;
}

/**
 * The decision brief of one project. It is read when the project changes (`refreshOn`) and on request,
 * and a failed read or a failed generation is shown, never replaced by an empty page.
 */
export function useBrief(projectId: string, refreshOn: string): BriefHandle {
  const [view, setView] = useState<BriefView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void briefApi.get(projectId, controller.signal).then(
      (loaded) => {
        if (controller.signal.aborted) return;
        setView(loaded);
        setError(null);
        setLoading(false);
      },
      (failure: unknown) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(failure));
        setLoading(false);
      },
    );
    return () => controller.abort();
  }, [projectId, refreshOn, revision]);

  const reload = useCallback(() => setRevision((old) => old + 1), []);

  const generate = useCallback(async (): Promise<void> => {
    setGenerating(true);
    setGenerateError(null);
    try {
      setView(await briefApi.generate(projectId));
      setError(null);
    } catch (failure) {
      setGenerateError(errorMessage(failure));
    } finally {
      setGenerating(false);
    }
  }, [projectId]);

  return { view, loading, error, generating, generateError, generate, reload };
}
