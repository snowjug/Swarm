import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import type { Analysis } from '../../../../shared/analysis';
import type { ProjectDetail } from '../../../../shared/types';
import { useAnalysis, type AnalysisState } from '../../hooks/useAnalysis';
import { dateTime } from '../../lib/format';
import { Notice, Spinner } from '../ui';
import { AnalysisResults } from './AnalysisResults';
import { ScenarioSetup, type SetupSettings } from './ScenarioSetup';

export interface AnalysisPanelProps {
  project: ProjectDetail;
  /** When given, the empty state and the warning about who the change affects offer a way to the step where that is said. */
  onOpenStep?: (step: 'environment') => void;
}

const running = (analysis: Analysis): boolean =>
  analysis.status === 'running' || analysis.status === 'queued';

const settingsOf = (analysis: Analysis): SetupSettings => ({
  variants: analysis.config.variants,
  runsPerVariant: analysis.config.runsPerVariant,
  sensitivity: analysis.config.sensitivity,
  baseSeed: analysis.config.baseSeed,
  rounds: analysis.config.rounds,
});

function Progress({
  analysis,
  state,
  headingRef,
}: {
  analysis: Analysis;
  state: AnalysisState;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const { completedRuns, totalRuns } = analysis.progress;
  const text = `${completedRuns.toLocaleString('en-GB')} of ${totalRuns.toLocaleString('en-GB')} simulated runs finished`;
  // Announced to a screen reader in tenths, not on every run, so that it is not read out every second.
  const tenths = totalRuns > 0 ? Math.floor((completedRuns / totalRuns) * 10) * 10 : 0;
  return (
    <div className="analysis-progress">
      <h3 ref={headingRef} tabIndex={-1}>
        Comparing scenarios
      </h3>
      <div
        className="analysis-meter"
        role="progressbar"
        aria-label="Comparison progress"
        aria-valuemin={0}
        aria-valuemax={Math.max(totalRuns, 1)}
        aria-valuenow={completedRuns}
        aria-valuetext={text}
      >
        <div
          className="analysis-meter-fill"
          style={{
            width: `${totalRuns > 0 ? Math.min(100, (completedRuns / totalRuns) * 100) : 0}%`,
          }}
        />
      </div>
      <p>
        {state.cancelling ? 'Cancelling: it stops after the run in progress. ' : 'Running: '}
        {text}. {analysis.config.variants.length} scenarios × {analysis.config.runsPerVariant}{' '}
        seeded runs
        {analysis.config.sensitivity ? ', then the sensitivity of the proposed change' : ''}.
      </p>
      <p className="sr-only" role="status">
        {state.cancelling
          ? 'Cancelling the comparison.'
          : `Comparing scenarios: about ${tenths}% of the simulated runs are finished.`}
      </p>
      {state.trouble && (
        <Notice tone="warning" title="The progress cannot be read just now">
          {state.trouble} It tries again by itself. A comparison that is running goes on running on
          the server, and one that the server stopped is shown as interrupted once it can be read.
        </Notice>
      )}
      {state.readiness?.may.run !== false && (
        <button
          className="button button-secondary"
          type="button"
          disabled={state.cancelling}
          onClick={() => void state.cancel()}
        >
          {state.cancelling ? 'Cancelling' : 'Cancel the comparison'}
        </button>
      )}
      {state.startError && (
        <Notice tone="error" title="That did not work">
          {state.startError}
        </Notice>
      )}
    </div>
  );
}

/** Why a comparison that did not finish shows nothing, and the means to run it again. */
function Unfinished({
  analysis,
  state,
  focusRef,
}: {
  analysis: Analysis;
  state: AnalysisState;
  focusRef: RefObject<HTMLElement | null>;
}) {
  const may = state.readiness?.may.run !== false;
  const again = (
    <button
      className="button button-secondary button-small"
      type="button"
      disabled={state.starting || !may}
      onClick={() => void state.start(settingsOf(analysis))}
    >
      Run it again with the same settings
    </button>
  );
  let notice;
  if (analysis.status === 'cancelled') {
    notice = (
      <Notice tone="info" title="This comparison was cancelled" action={again}>
        It stopped after {analysis.progress.completedRuns.toLocaleString('en-GB')} of{' '}
        {analysis.progress.totalRuns.toLocaleString('en-GB')} runs. Nothing is shown from a partial
        comparison, because its scenarios would not yet all have the same seeds.
      </Notice>
    );
  } else if (analysis.status === 'interrupted') {
    notice = (
      <Notice tone="warning" title="This comparison was interrupted" action={again}>
        {analysis.error?.message ??
          'The server stopped before it finished. It can be reproduced exactly from its seeds.'}
      </Notice>
    );
  } else {
    notice = (
      <Notice tone="error" title="This comparison failed" action={again}>
        {analysis.error?.message ?? 'It stopped before it finished.'}
      </Notice>
    );
  }
  return (
    <div
      ref={focusRef as RefObject<HTMLDivElement | null>}
      tabIndex={-1}
      className="analysis-outcome"
    >
      {notice}
    </div>
  );
}

/** What a screen reader is told when a comparison that it was following is no longer running. */
function outcomeSentence(status: Analysis['status']): string {
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
 * Where the person's attention goes when the comparison changes under them. Starting one replaces the
 * form they pressed with a much shorter block, and the page may stay scrolled to where the form was, so
 * the progress is brought into view and takes focus. When it ends the block they were watching is
 * replaced by its outcome, which is announced, and takes focus only if focus would otherwise be lost.
 */
function useAttention(
  state: AnalysisState,
  progress: RefObject<HTMLHeadingElement | null>,
  outcome: RefObject<HTMLElement | null>,
  panel: RefObject<HTMLElement | null>,
): string {
  const { current, starting } = state;
  const running_ = Boolean(current && running(current));
  const asked = useRef(false);
  const followed = useRef(false);
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    if (starting) asked.current = true;
  }, [starting]);
  useEffect(() => {
    if (running_) {
      followed.current = true;
      if (asked.current) {
        asked.current = false;
        progress.current?.focus({ preventScroll: true });
        progress.current?.scrollIntoView({ block: 'start' });
      }
      return;
    }
    if (!followed.current || !current) return;
    followed.current = false;
    setAnnouncement(outcomeSentence(current.status));
    const here = document.activeElement;
    if (!here || here === document.body || panel.current?.contains(here)) {
      outcome.current?.focus({ preventScroll: true });
    }
  }, [running_, current, progress, outcome, panel]);
  return announcement;
}

/** The panel for a given state of the comparisons: what it says before, while and after one runs. */
export function AnalysisView({
  state,
  onOpenStep,
}: {
  state: AnalysisState;
  onOpenStep?: AnalysisPanelProps['onOpenStep'];
}) {
  const titleId = useId();
  const panel = useRef<HTMLElement>(null);
  const progressHeading = useRef<HTMLHeadingElement>(null);
  const outcome = useRef<HTMLElement>(null);
  const announcement = useAttention(state, progressHeading, outcome, panel);
  const { readiness, current, summaries, loading, error } = state;
  const lastWallMs = summaries.find((item) => item.status === 'completed')?.cost.wallMs ?? null;
  // What the introduction says is about the setup and the results, so it waits for a cast to compare.
  const hasCast = current !== null || (readiness?.actors ?? null) !== null;
  const needsCast = readiness !== null && !hasCast;

  let body;
  if (!readiness) {
    body = error ? (
      <Notice
        tone="error"
        title="Saved comparisons could not be read"
        action={
          <button
            className="button button-secondary button-small"
            type="button"
            onClick={state.reload}
          >
            Retry
          </button>
        }
      >
        {error}
      </Notice>
    ) : (
      <p className="analysis-loading">
        <Spinner label="Reading saved comparisons" /> {loading ? 'Reading saved comparisons' : ''}
      </p>
    );
  } else if (readiness.actors === null && !current) {
    // Small on purpose: with nothing to compare this panel only points on, and it must not push the
    // stage's own controls below the fold.
    body = (
      <Notice
        action={
          onOpenStep ? (
            <button
              className="button button-secondary button-small"
              type="button"
              onClick={() => onOpenStep('environment')}
            >
              Open Env Setup
            </button>
          ) : undefined
        }
      >
        <strong>No simulated actors yet.</strong> Approve the stakeholders and create the actors in
        the Env Setup step; then compare a baseline with the proposed change and its alternatives.
      </Notice>
    );
  } else if (current && running(current)) {
    body = <Progress analysis={current} state={state} headingRef={progressHeading} />;
  } else {
    body = (
      <>
        {error && (
          <Notice
            tone="error"
            title="Something could not be read"
            action={
              <button
                className="button button-secondary button-small"
                type="button"
                onClick={state.reload}
              >
                Retry
              </button>
            }
          >
            {error}
          </Notice>
        )}
        {summaries.length > 1 && (
          <div className="field analysis-earlier">
            <label htmlFor={`${titleId}-earlier`}>Saved comparisons</label>
            <select
              id={`${titleId}-earlier`}
              value={current?.id ?? ''}
              onChange={(event) => state.select(event.target.value)}
            >
              {summaries.map((item) => (
                <option key={item.id} value={item.id}>
                  {dateTime(item.createdAt)}: {item.status}, {item.variants.length} scenarios ×{' '}
                  {item.runsPerVariant} runs
                </option>
              ))}
            </select>
          </div>
        )}
        {current &&
          (current.status === 'completed' ? (
            <AnalysisResults analysis={current} headingRef={outcome} />
          ) : (
            <Unfinished analysis={current} state={state} focusRef={outcome} />
          ))}
        {state.startError && (
          <Notice tone="error" title="That did not work">
            {state.startError}
          </Notice>
        )}
        {current ? (
          <details className="analysis-another">
            <summary>Run another comparison</summary>
            <ScenarioSetup
              key={current.id}
              readiness={readiness}
              initial={settingsOf(current)}
              lastWallMs={lastWallMs}
              starting={state.starting}
              error={null}
              submitLabel="Compare scenarios again"
              onStart={(input) => void state.start(input)}
              onOpenStep={onOpenStep}
            />
          </details>
        ) : (
          <ScenarioSetup
            readiness={readiness}
            lastWallMs={lastWallMs}
            starting={state.starting}
            error={state.startError}
            onStart={(input) => void state.start(input)}
            onOpenStep={onOpenStep}
          />
        )}
      </>
    );
  }

  return (
    <section
      ref={panel}
      className={`analysis-panel stage-card${needsCast ? ' analysis-panel-bare' : ''}`}
      aria-labelledby={titleId}
    >
      <header className="analysis-header">
        <h2 id={titleId}>Compare scenarios</h2>
        <p className="analysis-statement">
          Swarm explores scenarios. It does not guarantee or precisely predict real-world behavior.
        </p>
        {hasCast && (
          <p className="field-help">
            A baseline where nothing changes, set against the proposed change and its alternatives,
            each run many times on the same seeds. Everything below counts simulated members and
            seeded runs; none of it is a rate of anything real.
          </p>
        )}
      </header>
      <p className="sr-only" role="status">
        {announcement}
      </p>
      {body}
    </section>
  );
}

/** Baseline against alternatives, repeated runs, stability and sensitivity. */
export function AnalysisPanel({ project, onOpenStep }: AnalysisPanelProps) {
  return <AnalysisLoader key={project.id} projectId={project.id} onOpenStep={onOpenStep} />;
}

function AnalysisLoader({
  projectId,
  onOpenStep,
}: {
  projectId: string;
  onOpenStep: AnalysisPanelProps['onOpenStep'];
}) {
  const state = useAnalysis(projectId);
  return <AnalysisView state={state} onOpenStep={onOpenStep} />;
}
