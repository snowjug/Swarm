import { useCallback, useEffect, useRef, useState } from 'react';
import type { Analysis } from '../../../shared/analysis';
import type {
  AnalysisReadiness,
  AnalysisSummary,
  StartAnalysisInput,
} from '../../../shared/analysis-plan';
import { errorMessage } from '../api';
import { analysisApi } from '../api/analysis';

export interface AnalysisState {
  /** Set while the progress of a running comparison cannot be read: the reason, in words. The comparison itself goes on. */
  trouble: string | null;
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

export const POLL_MS = 1_000;
/** How long to wait before reading again after a read that failed; the last wait repeats. */
export const RETRY_MS: readonly number[] = [2_000, 4_000, 8_000, 15_000];
const active = (status: Analysis['status'] | undefined): boolean =>
  status === 'running' || status === 'queued';

/**
 * Reads one comparison once a second until it is no longer running. A read that fails is not the end of
 * the watching: the server may be restarting or busy, and a comparison that was running may by then have
 * finished or been marked interrupted, which only another read can say. So it tries again, a little later
 * each time, and says while it does that it cannot read. Returns the function that stops the watching.
 */
export function watchAnalysis(options: {
  read: () => Promise<Analysis>;
  onUpdate: (analysis: Analysis) => void;
  onFinished: () => void;
  /** The reason a read failed, or null when reading works again. */
  onTrouble: (reason: string | null) => void;
  describe: (failure: unknown) => string;
  timers?: { set: typeof setTimeout; clear: typeof clearTimeout };
}): () => void {
  const { set, clear } = options.timers ?? { set: setTimeout, clear: clearTimeout };
  let stopped = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const poll = async (): Promise<void> => {
    try {
      const next = await options.read();
      if (stopped) return;
      if (failures > 0) {
        failures = 0;
        options.onTrouble(null);
      }
      options.onUpdate(next);
      if (active(next.status)) timer = set(() => void poll(), POLL_MS);
      else options.onFinished();
    } catch (failure) {
      if (stopped) return;
      failures += 1;
      options.onTrouble(options.describe(failure));
      timer = set(() => void poll(), RETRY_MS[Math.min(failures, RETRY_MS.length) - 1]);
    }
  };
  timer = set(() => void poll(), POLL_MS);
  return () => {
    stopped = true;
    if (timer !== undefined) clear(timer);
  };
}

/**
 * The comparisons of one project. It reads the list once, and then only the comparison that is
 * running, once a second, until it is done: a project that never compared anything costs one read
 * that answers with an empty list.
 *
 * `onSettled` says that what the server holds of this project's comparisons has just changed: one was accepted, one was
 * asked to stop, or one that was being watched has finished, however it ended. The shell reads the project only every few
 * seconds, so its own record of the lab lags until it is told; the owner of this hook tells it. The latest function given
 * is the one called, and a new one on every draw restarts nothing.
 */
export function useAnalysis(projectId: string, onSettled?: () => void): AnalysisState {
  const [readiness, setReadiness] = useState<AnalysisReadiness | null>(null);
  const [summaries, setSummaries] = useState<AnalysisSummary[]>([]);
  const [current, setCurrent] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [refreshes, setRefreshes] = useState(0);

  const latestSettled = useRef(onSettled);
  useEffect(() => {
    latestSettled.current = onSettled;
  }, [onSettled]);
  const settled = useCallback(() => latestSettled.current?.(), []);

  // The choice of a comparison that is being read, if any. Only the newest choice may answer, and only while the project
  // is open: a comparison that arrives after another was chosen, or after the project was left, is not the one to show.
  const choosing = useRef<AbortController | null>(null);
  const stopChoosing = useCallback(() => {
    choosing.current?.abort();
    choosing.current = null;
  }, []);
  useEffect(() => stopChoosing, [projectId, stopChoosing]);

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
    const stop = watchAnalysis({
      read: () => analysisApi.get(projectId, watching, controller.signal),
      onUpdate: setCurrent,
      onFinished: () => {
        setRefreshes((old) => old + 1);
        settled();
      },
      onTrouble: setTrouble,
      describe: errorMessage,
    });
    return () => {
      controller.abort();
      stop();
      setTrouble(null);
    };
  }, [projectId, watching, settled]);

  // Asking to stop is answered at once, but the comparison stops at its next run: it is cancelling until it has.
  useEffect(() => {
    if (watching === null) setCancelling(false);
  }, [watching]);

  const reload = useCallback(() => setRevision((old) => old + 1), []);

  const start = useCallback(
    async (input: StartAnalysisInput): Promise<boolean> => {
      setStarting(true);
      setStartError(null);
      try {
        const started = await analysisApi.start(projectId, input);
        // The comparison just started is the one to watch: a choice still being read must not take its place.
        stopChoosing();
        setCurrent(started);
        setError(null);
      } catch (failure) {
        setStartError(errorMessage(failure));
        return false;
      } finally {
        setStarting(false);
      }
      settled();
      return true;
    },
    [projectId, stopChoosing, settled],
  );

  const currentId = current?.id ?? null;
  const cancel = useCallback(async (): Promise<void> => {
    if (currentId === null) return;
    setCancelling(true);
    setStartError(null);
    try {
      await analysisApi.cancel(projectId, currentId);
    } catch (failure) {
      setStartError(errorMessage(failure));
      setCancelling(false);
      return;
    }
    settled();
  }, [projectId, currentId, settled]);

  const select = useCallback(
    (id: string) => {
      stopChoosing();
      const controller = new AbortController();
      choosing.current = controller;
      void analysisApi.get(projectId, id, controller.signal).then(
        (chosen) => {
          if (!controller.signal.aborted) setCurrent(chosen);
        },
        (failure: unknown) => {
          if (!controller.signal.aborted) setError(errorMessage(failure));
        },
      );
    },
    [projectId, stopChoosing],
  );

  return {
    trouble,
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
