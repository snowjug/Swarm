import { useCallback, useEffect, useState } from 'react';
import type { CritiqueResponseInput, CritiquesView } from '../../../shared/critique';
import { errorMessage } from '../api';
import { criticsApi } from '../api/critics';

export interface CritiquesState {
  view: CritiquesView | null;
  loading: boolean;
  error: string | null;
  running: boolean;
  runError: string | null;
  /** The critique being answered, while the answer is on its way. */
  answering: string | null;
  answerError: { id: string; message: string } | null;
  reload: () => void;
  run: (useModel: boolean) => Promise<void>;
  /** Resolves true when the server took the response. */
  respond: (critiqueId: string, input: CritiqueResponseInput) => Promise<boolean>;
}

/**
 * The independent review of one project. It is read once when the page opens, which never fails for a
 * project that has not used it, and again on request; running it and answering a critique are the
 * person's own acts and each replaces what is shown with what the server now holds.
 */
export function useCritiques(projectId: string): CritiquesState {
  const [view, setView] = useState<CritiquesView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [answering, setAnswering] = useState<string | null>(null);
  const [answerError, setAnswerError] = useState<{ id: string; message: string } | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void criticsApi.read(projectId, controller.signal).then(
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
  }, [projectId, revision]);

  const reload = useCallback(() => setRevision((old) => old + 1), []);

  const run = useCallback(
    async (useModel: boolean): Promise<void> => {
      setRunning(true);
      setRunError(null);
      try {
        setView(await criticsApi.run(projectId, { useModel }));
      } catch (failure) {
        setRunError(errorMessage(failure));
      } finally {
        setRunning(false);
      }
    },
    [projectId],
  );

  const respond = useCallback(
    async (critiqueId: string, input: CritiqueResponseInput): Promise<boolean> => {
      setAnswering(critiqueId);
      setAnswerError(null);
      try {
        setView(await criticsApi.respond(projectId, critiqueId, input));
        return true;
      } catch (failure) {
        setAnswerError({ id: critiqueId, message: errorMessage(failure) });
        return false;
      } finally {
        setAnswering(null);
      }
    },
    [projectId],
  );

  return { view, loading, error, running, runError, answering, answerError, reload, run, respond };
}
