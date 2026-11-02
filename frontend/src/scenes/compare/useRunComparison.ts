import { useCallback, useEffect, useState } from 'react';
import type { RunComparison } from '../../../../shared/guided';
import { api, errorMessage } from '../../api';

export interface RunComparisonState {
  comparison: RunComparison | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

/**
 * Two recorded runs set against each other, as the server works it out: per-round metrics, the difference of each, the
 * round they part, what was declared changed and the notes it must be read with. A new pair replaces the old at once,
 * and the one in flight is let go.
 */
export function useRunComparison(
  baseId: string | null,
  otherId: string | null,
): RunComparisonState {
  const [state, setState] = useState<{
    key: string;
    comparison: RunComparison | null;
    error: string | null;
  }>({
    key: '',
    comparison: null,
    error: null,
  });
  const [revision, setRevision] = useState(0);
  const key = baseId && otherId ? `${baseId}|${otherId}|${revision}` : '';

  useEffect(() => {
    if (!baseId || !otherId) return undefined;
    const controller = new AbortController();
    void api.compare(baseId, otherId, controller.signal).then(
      (comparison) => {
        if (!controller.signal.aborted) setState({ key, comparison, error: null });
      },
      (failure: unknown) => {
        if (!controller.signal.aborted)
          setState({ key, comparison: null, error: errorMessage(failure) });
      },
    );
    return () => controller.abort();
  }, [baseId, otherId, key]);

  const retry = useCallback(() => setRevision((old) => old + 1), []);
  const settled = key !== '' && state.key === key;
  return {
    comparison: settled ? state.comparison : null,
    loading: key !== '' && !settled,
    error: settled ? state.error : null,
    retry,
  };
}
