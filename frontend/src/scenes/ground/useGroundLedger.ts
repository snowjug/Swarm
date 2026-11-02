import { useCallback, useMemo, useState } from 'react';
import type { Ledger } from '../../../../shared/evidence';
import { useLedger } from '../../hooks/useLedger';

/**
 * The project's ledger, with the one a review returns taken in at once. A review answers with the whole
 * updated ledger, so the page can show it without a second read; when the ledger is next read for any
 * other reason, what was read is what is shown.
 */
export function useGroundLedger(projectId: string, enabled: boolean, version: string) {
  const base = useLedger(projectId, enabled, version);
  const [taken, setTaken] = useState<{ from: Ledger | null; value: Ledger } | null>(null);
  const baseLedger = base.ledger;
  const current = taken && taken.from === baseLedger ? taken.value : baseLedger;
  const replace = useCallback(
    (next: Ledger) => setTaken({ from: baseLedger, value: next }),
    [baseLedger],
  );
  return useMemo(
    () => ({
      ledger: current,
      loading: base.loading,
      error: base.error,
      reload: base.reload,
      replace,
    }),
    [current, base.loading, base.error, base.reload, replace],
  );
}
