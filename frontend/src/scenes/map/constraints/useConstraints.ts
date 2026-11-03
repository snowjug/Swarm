import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ConstraintImpact,
  ConstraintsView,
  CounterfactualsView,
} from '../../../../../shared/constraints';
import { ApiError, errorMessage } from '../../../api';
import { constraintsApi, type ReviewAction } from '../../../api/constraints';

/** Said when the constraints changed under a person who was deciding, and they have been read again. */
export const CHANGED_WHILE_LOOKING =
  'The constraints changed while you were looking at them. They have been read again below; choose again what to do.';

export type ConstraintsWork = 'proposing' | 'reviewing' | 'measuring' | 'viewing';

export interface ConstraintsState {
  view: ConstraintsView | null;
  counterfactuals: CounterfactualsView | null;
  /** What was found when the gate was measured, when it was. */
  sensitivity: { impact: ConstraintImpact | null } | null;
  loading: boolean;
  /** Reading failed: nothing can be shown. */
  error: string | null;
  working: ConstraintsWork | null;
  /** The last thing a person did that was refused, in words they can act on. */
  problem: string | null;
  reload: () => void;
  dismissProblem: () => void;
  propose: (mode: 'rules' | 'model') => Promise<boolean>;
  review: (action: ReviewAction) => Promise<boolean>;
  /** Measures which applied constraint moves the simulated result most. */
  measure: () => Promise<boolean>;
  runViews: () => Promise<boolean>;
}

/**
 * The constraints of one project. They are read when the page opens, which never fails for a project that
 * has none, and every change is the person's own act: it carries the revision they were looking at, and the
 * answer replaces what is shown with what the server holds. A change made to a version that is no longer
 * the latest is refused by the server; the page then reads again and says so, and what the person chose
 * is not applied.
 */
export function useConstraints(projectId: string): ConstraintsState {
  const [view, setView] = useState<ConstraintsView | null>(null);
  const [counterfactuals, setCounterfactuals] = useState<CounterfactualsView | null>(null);
  const [sensitivity, setSensitivity] = useState<ConstraintsState['sensitivity']>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<ConstraintsWork | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [reads, setReads] = useState(0);
  const latest = useRef<ConstraintsView | null>(null);
  useEffect(() => {
    latest.current = view;
  }, [view]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void Promise.all([
      constraintsApi.read(projectId, controller.signal),
      constraintsApi.counterfactuals(projectId, controller.signal),
    ]).then(
      ([loaded, views]) => {
        if (controller.signal.aborted) return;
        setView(loaded);
        setCounterfactuals(views);
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
  }, [projectId, reads]);

  const reload = useCallback(() => setReads((old) => old + 1), []);
  const dismissProblem = useCallback(() => setProblem(null), []);

  /** Runs one thing a person asked for and says what became of it. */
  const act = useCallback(
    async (kind: ConstraintsWork, work: () => Promise<void>): Promise<boolean> => {
      setWorking(kind);
      setProblem(null);
      try {
        await work();
        return true;
      } catch (failure) {
        if (failure instanceof ApiError && failure.code === 'ARTIFACT_CONFLICT') {
          setProblem(CHANGED_WHILE_LOOKING);
          setReads((old) => old + 1);
        } else {
          setProblem(errorMessage(failure));
        }
        return false;
      } finally {
        setWorking(null);
      }
    },
    [],
  );

  const propose = useCallback(
    (mode: 'rules' | 'model') =>
      act('proposing', async () => {
        setView(await constraintsApi.propose(projectId, { mode }));
        setSensitivity(null);
      }),
    [act, projectId],
  );

  const review = useCallback(
    (action: ReviewAction) =>
      act('reviewing', async () => {
        const revision = latest.current?.revision ?? 0;
        setView(await constraintsApi.review(projectId, action, revision));
        setSensitivity(null);
      }),
    [act, projectId],
  );

  const measure = useCallback(
    () =>
      act('measuring', async () => {
        const { gate } = await constraintsApi.gate(projectId);
        setSensitivity({ impact: gate?.largestSensitivity ?? null });
      }),
    [act, projectId],
  );

  const runViews = useCallback(
    () =>
      act('viewing', async () => {
        setCounterfactuals(await constraintsApi.runCounterfactuals(projectId));
      }),
    [act, projectId],
  );

  return {
    view,
    counterfactuals,
    sensitivity,
    loading,
    error,
    working,
    problem,
    reload,
    dismissProblem,
    propose,
    review,
    measure,
    runViews,
  };
}
