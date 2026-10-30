import { useCallback, useEffect, useState } from 'react';
import type { AuditEntry, AuditVerification } from '../../../shared/types';
import { api, errorMessage } from '../api';

export type Verification =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'done'; result: AuditVerification }
  | { state: 'failed'; error: string };

export interface AuditState {
  entries: AuditEntry[] | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  verification: Verification;
  verify: () => void;
}

/** The audit entries of one project, and an on-request check that the log's hash chain is intact. */
export function useAudit(projectId: string): AuditState {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [verification, setVerification] = useState<Verification>({ state: 'idle' });

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void api.audit(projectId, controller.signal).then(
      (loaded) => {
        if (controller.signal.aborted) return;
        setEntries(loaded.events);
        setLoading(false);
      },
      (failure: unknown) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(failure));
        setLoading(false);
      },
    );
    return () => controller.abort();
  }, [projectId, revision]);

  const reload = useCallback(() => setRevision((old) => old + 1), []);
  const verify = useCallback(() => {
    setVerification({ state: 'running' });
    void api.verifyAudit().then(
      (result) => setVerification({ state: 'done', result }),
      (failure: unknown) => setVerification({ state: 'failed', error: errorMessage(failure) }),
    );
  }, []);
  return { entries, loading, error, reload, verification, verify };
}
