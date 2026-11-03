import { useCallback, useEffect, useState } from 'react';
import type { DecisionView } from '../../../shared/decision';
import { errorMessage } from '../api';
import { decisionApi } from '../api/decision';

export interface DecisionHandle {
  view: DecisionView | null;
  /** The first read, before there is anything to show. */
  loading: boolean;
  /** Read again while the last view stays on the page. */
  refreshing: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * The decision canvas of one project. It is read when the project changes (`refreshOn`) and on request.
 * A read that fails is said, with a way to try again, and the last view that could be read stays: the page
 * is never replaced by an empty one.
 */
export function useDecision(projectId: string, refreshOn: string): DecisionHandle {
  const [view, setView] = useState<DecisionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setRefreshing(true);
    void decisionApi.get(projectId, controller.signal).then(
      (loaded) => {
        if (controller.signal.aborted) return;
        setView(loaded);
        setError(null);
        setLoading(false);
        setRefreshing(false);
      },
      (failure: unknown) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(failure));
        setLoading(false);
        setRefreshing(false);
      },
    );
    return () => controller.abort();
  }, [projectId, refreshOn, revision]);

  const reload = useCallback(() => setRevision((old) => old + 1), []);
  return { view, loading, refreshing, error, reload };
}
