import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ResearchStatus, ResearchView } from '../../../shared/research';
import { ApiError, errorMessage, isAbort, onAcceptedChange } from '../api';
import { researchApi, type OwnDocument } from '../api/research';
import { isLive, recalledIntake } from '../lib/research';

/** How often a run that is under way is read again, and how often one that waits for a person to let it go on. */
export const RESEARCH_POLL_MS = { live: 1_500, paused: 4_000 } as const;
/** The longest wait between two tries when the reads keep failing. */
export const RESEARCH_BACKOFF_MS = 15_000;
/** How many times, and how soon after it ended, a run is read again while the server allows nothing to be started. */
const SETTLE_READS = 6;
const SETTLE_WITHIN_MS = 60_000;

/** A run that ended a moment ago, and the server does not yet let another be started. */
function endedRecently(view: ResearchView): boolean {
  const run = view.run;
  if (!run || isLive(run.status) || view.may.start) return false;
  const ended = Date.parse(run.finishedAt ?? run.updatedAt);
  return Number.isFinite(ended) && Math.abs(Date.now() - ended) < SETTLE_WITHIN_MS;
}

export type ResearchWork =
  'start' | 'pause' | 'resume' | 'cancel' | 'finish' | 'add-source' | 'add-documents';

export interface ResearchState {
  view: ResearchView | null;
  /** The first read is under way. */
  loading: boolean;
  /** Why the latest read failed. With a view in hand, what is shown is the last one that was read. */
  error: string | null;
  /** When the view in hand was read, by this browser's clock. */
  readAt: number | null;
  /** What the server is being asked to do, or null. One thing at a time. */
  working: ResearchWork | null;
  /** Why the last thing asked was refused, in a sentence for the person, and what it was. */
  problem: { kind: ResearchWork; message: string } | null;
  reload: () => void;
  dismissProblem: () => void;
  start: (input?: Parameters<typeof researchApi.start>[1]) => Promise<boolean>;
  pause: () => Promise<boolean>;
  resume: () => Promise<boolean>;
  cancel: () => Promise<boolean>;
  finish: () => Promise<boolean>;
  addSource: (url: string) => Promise<boolean>;
  /** Text a person pasted or attached: the server adds it as sources and goes on to read it. */
  addDocuments: (documents: readonly OwnDocument[]) => Promise<boolean>;
}

/** The wait before the next read: the cadence of the run, and longer after each failure to read. */
export function nextReadIn(view: ResearchView | null, failures: number): number {
  if (failures > 0) return Math.min(RESEARCH_BACKOFF_MS, 1_000 * 2 ** failures);
  return view?.run?.status === 'paused' ? RESEARCH_POLL_MS.paused : RESEARCH_POLL_MS.live;
}

/** The changes to a project that can change its research: a step started, a run cancelled or paused, or a run's own. */
const AFFECTS_RESEARCH =
  /\/(?:steps\/[a-z]+|cancel|pause|run|evidence\/documents|research(?:\/[a-z]+)?)$/u;

/**
 * The research of one project: read when the page opens, and again while a run is under way (not while the page
 * is out of sight), and answered by whatever a person asks of it. A read that fails keeps the view that was read before
 * and says so, and is tried again, more slowly each time. `onSettled` is called once when a run that was under way
 * ends, so that the page can read the project, which is what the run adds its sources to.
 */
export function useResearch(
  projectId: string,
  {
    enabled,
    onSettled,
    onChanged,
  }: { enabled: boolean; onSettled?: () => void; onChanged?: () => void },
): ResearchState {
  const [view, setView] = useState<ResearchView | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [readAt, setReadAt] = useState<number | null>(null);
  const [working, setWorking] = useState<ResearchWork | null>(null);
  const [problem, setProblem] = useState<ResearchState['problem']>(null);
  const [reads, setReads] = useState(0);
  // Reads that came back, whether they could be read or not: what a run that is polled is polled again after.
  const [answered, setAnswered] = useState(0);
  const failures = useRef(0);
  const status = useRef<ResearchStatus | null>(null);
  const latest = useRef<ResearchView | null>(null);
  const [settledReads, setSettledReads] = useState(0);
  const busy = useRef(false);
  const callbacks = useRef({ onSettled, onChanged });
  useEffect(() => {
    callbacks.current = { onSettled, onChanged };
  }, [onSettled, onChanged]);

  const take = useCallback((next: ResearchView) => {
    const before = status.current;
    status.current = next.run?.status ?? null;
    latest.current = next;
    // Reads of a run that has ended while the server still allows nothing are counted: there are only a few.
    setSettledReads((count) => (endedRecently(next) ? count + 1 : 0));
    failures.current = 0;
    setView(next);
    setError(null);
    setLoading(false);
    setReadAt(Date.now());
    setAnswered((count) => count + 1);
    if (isLive(before) && !isLive(status.current)) callbacks.current.onSettled?.();
  }, []);

  const reload = useCallback(() => setReads((count) => count + 1), []);

  // A project that is opened has none of the last one's.
  useEffect(() => {
    status.current = null;
    latest.current = null;
    setSettledReads(0);
    failures.current = 0;
    setView(null);
    setError(null);
    setProblem(null);
    setReadAt(null);
    setLoading(enabled);
  }, [projectId, enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    void researchApi.get(projectId, controller.signal).then(
      (next) => {
        if (!controller.signal.aborted) take(next);
      },
      (failure: unknown) => {
        if (controller.signal.aborted || isAbort(failure)) return;
        failures.current += 1;
        setError(errorMessage(failure));
        setLoading(false);
        setAnswered((count) => count + 1);
      },
    );
    return () => controller.abort();
  }, [projectId, enabled, reads, take]);

  // While a run is under way, or after a read that failed, read again, at the run's pace. A page that is out of sight
  // waits, and reads as soon as it is in sight again. A run that has only just ended is read a few times more while the
  // server allows nothing: what a person may do follows a moment after the run, as the job that carried it lets go.
  const live = isLive(view?.run?.status);
  const settling = !live && view !== null && endedRecently(view) && settledReads <= SETTLE_READS;
  useEffect(() => {
    if (!enabled || (!live && !settling && error === null)) return undefined;
    const again = () => setReads((count) => count + 1);
    if (document.visibilityState === 'hidden') {
      const visible = () => {
        if (document.visibilityState === 'visible') again();
      };
      document.addEventListener('visibilitychange', visible);
      return () => document.removeEventListener('visibilitychange', visible);
    }
    const timer = setTimeout(again, nextReadIn(view, failures.current));
    return () => clearTimeout(timer);
  }, [enabled, live, settling, view, error, answered]);

  // What is done to the project elsewhere on the page (the head of the page stops a run, or starts a step; a question
  // that was just asked starts its research) changes the run too: it is read soon, not at the next turn of the clock.
  // What this hook asks of the server itself is answered by the server's own reply.
  useEffect(() => {
    if (!enabled) return undefined;
    const base = `/api/projects/${encodeURIComponent(projectId)}/`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = onAcceptedChange((path) => {
      if (busy.current || !path.startsWith(base) || !AFFECTS_RESEARCH.test(path)) return;
      clearTimeout(timer);
      timer = setTimeout(reload, 400);
    });
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [enabled, projectId, reload]);

  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);

  const act = useCallback(
    async (kind: ResearchWork, call: (signal: AbortSignal) => Promise<ResearchView | void>) => {
      if (busy.current) return false;
      busy.current = true;
      const request = new AbortController();
      controller.current = request;
      setWorking(kind);
      setProblem(null);
      try {
        const next = await call(request.signal);
        if (!mounted.current || request.signal.aborted) return false;
        // What was asked is answered with the run, or, where it was not about the run, the run is read again.
        if (next) take(next);
        else reload();
        callbacks.current.onChanged?.();
        return true;
      } catch (failure) {
        if (!mounted.current || request.signal.aborted || isAbort(failure)) return false;
        // Starting what is already under way is what was asked for: it is shown as it is. Naming a site is not: it
        // is a run of its own, and it was not made.
        if (kind === 'start' && failure instanceof ApiError && failure.code === 'RESEARCH_ACTIVE') {
          reload();
          return true;
        }
        setProblem({ kind, message: errorMessage(failure) });
        // What is true is read again: a refusal is often a run that moved on while the page looked at it.
        reload();
        return false;
      } finally {
        busy.current = false;
        if (mounted.current) setWorking(null);
      }
    },
    [reload, take],
  );

  const dismissProblem = useCallback(() => setProblem(null), []);
  const start = useCallback<ResearchState['start']>(
    (input) =>
      act('start', (signal) => {
        // What was asked when the project was made is not kept by the server: the run before this one, or the page that
        // made the project, says it again.
        const intake = input?.intake ?? latest.current?.run?.intake ?? recalledIntake(projectId);
        return researchApi.start(projectId, { ...input, ...(intake ? { intake } : {}) }, signal);
      }),
    [act, projectId],
  );
  const pause = useCallback(
    () => act('pause', (signal) => researchApi.pause(projectId, signal)),
    [act, projectId],
  );
  const resume = useCallback(
    () => act('resume', (signal) => researchApi.resume(projectId, signal)),
    [act, projectId],
  );
  const cancel = useCallback(
    () => act('cancel', (signal) => researchApi.cancel(projectId, signal)),
    [act, projectId],
  );
  const finish = useCallback(
    () => act('finish', (signal) => researchApi.finish(projectId, signal)),
    [act, projectId],
  );
  const addSource = useCallback(
    (url: string) => act('add-source', (signal) => researchApi.addSource(projectId, url, signal)),
    [act, projectId],
  );
  const addDocuments = useCallback<ResearchState['addDocuments']>(
    (documents) =>
      act('add-documents', (signal) => researchApi.addDocuments(projectId, documents, signal)),
    [act, projectId],
  );

  return useMemo(
    () => ({
      view,
      loading,
      error,
      readAt,
      working,
      problem,
      reload,
      dismissProblem,
      start,
      pause,
      resume,
      cancel,
      finish,
      addSource,
      addDocuments,
    }),
    [
      view,
      loading,
      error,
      readAt,
      working,
      problem,
      reload,
      dismissProblem,
      start,
      pause,
      resume,
      cancel,
      finish,
      addSource,
      addDocuments,
    ],
  );
}
