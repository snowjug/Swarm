import { useCallback, useEffect, useState } from 'react';
import type { BudgetInput, BudgetView } from '../../../shared/budget';
import { api, errorMessage } from '../api';

export interface BudgetState {
  budget: BudgetView | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  saveError: string | null;
  /** Whether the last change was accepted, until the next one is tried or the budget is read again. */
  saved: boolean;
  reload: () => void;
  /** Sets the project's own limits. Resolves true when the server accepted them. */
  save: (input: BudgetInput) => Promise<boolean>;
}

/**
 * What one project has used of its model budget, and what it may. It is read again when `refreshOn`
 * changes (the number of model calls the project has recorded) and on request, and it is not read at
 * all while `enabled` is false: a project that never calls a model has nothing to show.
 */
export function useBudget(projectId: string, enabled: boolean, refreshOn: number): BudgetState {
  const [budget, setBudget] = useState<BudgetView | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setLoading(true);
    void api.budget(projectId, controller.signal).then(
      (loaded) => {
        if (controller.signal.aborted) return;
        setBudget(loaded);
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
  }, [projectId, enabled, refreshOn, revision]);

  const reload = useCallback(() => {
    setSaved(false);
    setRevision((old) => old + 1);
  }, []);
  const save = useCallback(
    async (input: BudgetInput): Promise<boolean> => {
      setSaving(true);
      setSaveError(null);
      setSaved(false);
      try {
        setBudget(await api.setBudget(projectId, input));
        setSaved(true);
        return true;
      } catch (failure) {
        setSaveError(errorMessage(failure));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [projectId],
  );
  return { budget, loading, error, saving, saveError, saved, reload, save };
}
