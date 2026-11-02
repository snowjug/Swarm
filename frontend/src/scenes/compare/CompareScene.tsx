import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { useWorkspace, type Workspace } from '../../app/context';
import { useAnalysis, type AnalysisState } from '../../hooks/useAnalysis';
import { Button, Notice } from '../../design/ui';
import { isGuided } from '../../lib/console';
import { CompareScope } from './context';
import { CompareDocument } from './Document';
import { Fresh } from './Fresh';
import { UNKNOWN, freshnessOf, newerThan } from './freshness';
import { RunsScene } from './RunsScene';
import { useBriefView } from './useFreshness';
import {
  EmptyResults,
  ErrorState,
  LegacyState,
  LoadingState,
  NoneState,
  RunningState,
  UnfinishedState,
} from './States';
import { scenariosOf } from './scenarios';

const active = (status: string | undefined): boolean => status === 'running' || status === 'queued';

export interface CompareViewProps {
  legacy: boolean;
  state: AnalysisState;
  go: Workspace['go'];
  onExplore: () => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
  /** A saved comparison has been asked for and is being read. */
  pending: boolean;
  onSelect: (id: string) => void;
  /** The way to read two recorded runs against each other, when the project has two. */
  onRuns?: (() => void) | null;
  fresh?: ReactNode;
}

/** What the page shows for each state a comparison can be in: reading, nothing yet, running, stopped, finished. */
export function CompareView({
  legacy,
  state,
  go,
  onExplore,
  headingRef,
  pending,
  onSelect,
  onRuns = null,
  fresh,
}: CompareViewProps) {
  const { current, loading, error, readiness, summaries } = state;
  if (legacy) return <LegacyState onExplore={onExplore} />;
  if (loading && !current) return <LoadingState />;
  if (!current) {
    return error ? (
      <ErrorState message={error} onRetry={state.reload} />
    ) : (
      <NoneState
        needsActors={readiness !== null && readiness.actors === null}
        onSimulate={() => go('simulate')}
        onMap={() => go('map')}
      />
    );
  }
  if (active(current.status)) {
    return (
      <RunningState
        analysis={current}
        state={state}
        headingRef={headingRef}
        onWatch={() => go('simulate')}
      />
    );
  }
  if (current.status !== 'completed') {
    const lastDone = summaries.find((summary) => summary.status === 'completed') ?? null;
    return (
      <UnfinishedState
        analysis={current}
        state={state}
        headingRef={headingRef}
        onSimulate={() => go('simulate')}
        lastDone={lastDone ? { id: lastDone.id, completedAt: lastDone.completedAt } : null}
      />
    );
  }
  if (scenariosOf(current).length === 0) return <EmptyResults onRun={() => go('simulate')} />;
  return (
    <>
      {error && (
        <div className="sw-cmp sw-cmp-banner">
          <Notice
            tone="error"
            title="Something could not be read"
            action={
              <Button size="sm" variant="glass" onClick={state.reload}>
                Retry
              </Button>
            }
          >
            {error}
          </Notice>
        </div>
      )}
      <CompareDocument
        key={current.id}
        analysis={current}
        summaries={summaries}
        headingRef={headingRef}
        onSelect={onSelect}
        pending={pending}
        onRun={() => go('simulate', { view: 'setup' })}
        onDecide={() => go('decide')}
        onReview={() => go('map')}
        onRuns={onRuns}
        fresh={fresh}
      />
    </>
  );
}

/** What a screen reader is told when a comparison that was being followed ends. */
function outcomeSentence(status: string): string {
  switch (status) {
    case 'completed':
      return 'The comparison finished. The results are below.';
    case 'cancelled':
      return 'The comparison was cancelled.';
    case 'interrupted':
      return 'The comparison was interrupted. It can be run again with the same settings.';
    default:
      return 'The comparison failed.';
  }
}

/**
 * Where attention goes when the comparison changes under the person. When one that was being followed ends,
 * focus moves to the new heading and the outcome is announced, so that nobody is left on a screen that has gone.
 */
function useCompletion(
  state: AnalysisState,
  headingRef: RefObject<HTMLHeadingElement | null>,
): string {
  const status = state.current?.status;
  const followed = useRef(false);
  const [said, setSaid] = useState('');
  useEffect(() => {
    if (active(status)) {
      followed.current = true;
      return;
    }
    if (!followed.current || !status) return;
    followed.current = false;
    setSaid(outcomeSentence(status));
    headingRef.current?.focus({ preventScroll: true });
  }, [status, headingRef]);
  return said;
}

/** The comparison of scenarios of the open project, in whatever state it is in. */
function Scenarios() {
  const { project, projects, go, duplicate } = useWorkspace();
  const state = useAnalysis(project.id);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const said = useCompletion(state, headingRef);
  const [asked, setAsked] = useState<string | null>(null);
  const currentId = state.current?.id ?? null;
  const failed = state.error;
  useEffect(() => {
    if (asked === null) return;
    if (asked === currentId) {
      setAsked(null);
      headingRef.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
    } else if (failed) setAsked(null);
  }, [asked, currentId, failed]);

  // The project's own timestamp does not move when a comparison or a document changes, so the lab's record is read with it.
  const token = `${project.updatedAt}|${JSON.stringify(project.lab ?? null)}`;
  const briefView = useBriefView(project.id, token);
  const current = state.current;
  const completed = current?.status === 'completed' ? current : null;
  const freshness = completed ? freshnessOf(briefView, completed.id) : UNKNOWN;
  const newer = completed ? newerThan(state.summaries, completed) : null;
  const canRun = state.readiness?.may.run !== false;
  const hasRuns =
    project.rounds.length > 0 &&
    projects.some(
      (item) => item.id !== project.id && item.workflow === 'guided' && item.currentRound >= 1,
    );

  return (
    <>
      <CompareView
        legacy={!isGuided(project)}
        state={state}
        go={go}
        onExplore={duplicate}
        headingRef={headingRef}
        pending={asked !== null && asked !== currentId}
        onSelect={(id) => {
          setAsked(id);
          state.select(id);
        }}
        onRuns={hasRuns ? () => go('compare', { view: 'runs' }) : null}
        fresh={
          <Fresh
            freshness={freshness}
            newer={newer}
            canRun={canRun}
            onRun={() => go('simulate', { view: 'setup' })}
            onNewer={(id) => {
              setAsked(id);
              state.select(id);
            }}
          />
        }
      />
      <p className="sr-only" role="status">
        {said}
      </p>
    </>
  );
}

export function CompareScene() {
  const { view, mode } = useWorkspace();
  const scope = useMemo(() => ({ advanced: mode === 'advanced' }), [mode]);
  return (
    <CompareScope.Provider value={scope}>
      {view === 'runs' ? <RunsScene /> : <Scenarios />}
    </CompareScope.Provider>
  );
}
