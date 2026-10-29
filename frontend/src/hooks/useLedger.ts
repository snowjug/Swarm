import { useCallback, useEffect, useState } from 'react';
import type { Ledger } from '../../../shared/evidence';
import { api, errorMessage } from '../api';

export interface LedgerState {
  ledger: Ledger | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Loads a project's evidence ledger, and again whenever `version` changes (for example a new report). */
export function useLedger(projectId: string, enabled: boolean, version: string): LedgerState {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void api.ledger(projectId, controller.signal).then(
      (loaded) => {
        if (controller.signal.aborted) return;
        setLedger(loaded);
        setLoading(false);
      },
      (failure: unknown) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(failure));
        setLoading(false);
      },
    );
    return () => controller.abort();
  }, [projectId, enabled, version, revision]);

  const reload = useCallback(() => setRevision((old) => old + 1), []);
  return { ledger, loading, error, reload };
}
