import { useCallback, useEffect, useState } from 'react';
import type { Analysis } from '../../../shared/analysis';
import type {
  AnalysisReadiness,
  AnalysisSummary,
  StartAnalysisInput,
} from '../../../shared/analysis-plan';
import { errorMessage } from '../api';
import { analysisApi } from '../api/analysis';

export interface AnalysisState {
  readiness: AnalysisReadiness | null;
  /** Saved comparisons, newest first. */
  summaries: AnalysisSummary[];
  /** The comparison on show: the one running, or else the latest finished, or the one chosen. */
  current: Analysis | null;
  loading: boolean;
  error: string | null;
  starting: boolean;
  startError: string | null;
  cancelling: boolean;
  reload: () => void;
  /** Starts a comparison. Resolves true when the server accepted it. */
  start: (input: StartAnalysisInput) => Promise<boolean>;
  cancel: () => Promise<void>;
  select: (id: string) => void;
}

const POLL_MS = 1_000;
const active = (status: Analysis['status'] | undefined): boolean =>
  status === 'running' || status === 'queued';

/**
 * The comparisons of one project. It reads the list once, and then only the comparison that is
 * running, once a second, until it is done: a project that never compared anything costs one read
 * that answers with an empty list.
 */
export function useAnalysis(projectId: string): AnalysisState {
  const [readiness, setReadiness] = useState<AnalysisReadiness | null>(null);
  const [summaries, setSummaries] = useState<AnalysisSummary[]>([]);
  const [current, setCurrent] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [revision, setRevision] = useState(0);
  const [refreshes, setRefreshes] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const listed = await analysisApi.list(projectId, controller.signal);
        const pick =
          listed.analyses.find((item) => active(item.status)) ??
          listed.analyses.find((item) => item.status === 'completed') ??
          listed.analyses[0];
        const shown = pick ? await analysisApi.get(projectId, pick.id, controller.signal) : null;
        if (controller.signal.aborted) return;
        setReadiness(listed.readiness);
        setSummaries(listed.analyses);
        setCurrent(shown);
        setError(null);
        setLoading(false);
      } catch (failure) {
        if (controller.signal.aborted) return;
        setError(errorMessage(failure));
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [projectId, revision]);

  // When a comparison that was being watched has finished, the list is read again for its summaries,
  // and the comparison on show stays the one that was watched, however it ended.
  useEffect(() => {
    if (refreshes === 0) return;
    const controller = new AbortController();
    void analysisApi.list(projectId, controller.signal).then(
      (listed) => {
        if (controller.signal.aborted) return;
        setReadiness(listed.readiness);
        setSummaries(listed.analyses);
      },
      (failure: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(failure));
      },
    );
    return () => controller.abort();
  }, [projectId, refreshes]);

  const watching = active(current?.status) ? (current?.id ?? null) : null;
  useEffect(() => {
    if (watching === null) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async (): Promise<void> => {
      try {
        const next = await analysisApi.get(projectId, watching, controller.signal);
        if (controller.signal.aborted) return;
        setCurrent(next);
        if (active(next.status)) timer = setTimeout(() => void poll(), POLL_MS);
        else setRefreshes((old) => old + 1);
      } catch (failure) {
        if (controller.signal.aborted) return;
        setError(errorMessage(failure));
      }
    };
    timer = setTimeout(() => void poll(), POLL_MS);
    return () => {
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [projectId, watching]);

  const reload = useCallback(() => setRevision((old) => old + 1), []);

  const start = useCallback(
    async (input: StartAnalysisInput): Promise<boolean> => {
      setStarting(true);
      setStartError(null);
      try {
        setCurrent(await analysisApi.start(projectId, input));
        setError(null);
        return true;
      } catch (failure) {
        setStartError(errorMessage(failure));
        return false;
      } finally {
        setStarting(false);
      }
    },
    [projectId],
  );

  const currentId = current?.id ?? null;
  const cancel = useCallback(async (): Promise<void> => {
    if (currentId === null) return;
    setCancelling(true);
    setStartError(null);
    try {
      setCurrent(await analysisApi.cancel(projectId, currentId));
    } catch (failure) {
      setStartError(errorMessage(failure));
    } finally {
      setCancelling(false);
    }
  }, [projectId, currentId]);

  const select = useCallback(
    (id: string) => {
      void analysisApi.get(projectId, id).then(
        (chosen) => setCurrent(chosen),
        (failure: unknown) => setError(errorMessage(failure)),
      );
    },
    [projectId],
  );

  return {
    readiness,
    summaries,
    current,
    loading,
    error,
    starting,
    startError,
    cancelling,
    reload,
    start,
    cancel,
    select,
  };
}
