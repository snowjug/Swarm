import { useId } from 'react';
import type { Analysis } from '../../../../shared/analysis';
import type { ProjectDetail } from '../../../../shared/types';
import { useAnalysis, type AnalysisState } from '../../hooks/useAnalysis';
import { dateTime } from '../../lib/format';
import { EmptyPanel, Notice, Spinner } from '../ui';
import { AnalysisResults } from './AnalysisResults';
import { ScenarioSetup, type SetupSettings } from './ScenarioSetup';

export interface AnalysisPanelProps {
  project: ProjectDetail;
  /** When given, the empty state offers a way to the step where the actors are made. */
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

function Progress({ analysis, state }: { analysis: Analysis; state: AnalysisState }) {
  const { completedRuns, totalRuns } = analysis.progress;
  const text = `${completedRuns.toLocaleString('en-GB')} of ${totalRuns.toLocaleString('en-GB')} simulated runs finished`;
  return (
    <div className="analysis-progress">
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
      <p aria-live="polite">
        {state.cancelling ? 'Cancelling: it stops after the run in progress. ' : 'Running: '}
        {text}. {analysis.config.variants.length} scenarios × {analysis.config.runsPerVariant}{' '}
        seeded runs
        {analysis.config.sensitivity ? ', then the sensitivity of the proposed change' : ''}.
      </p>
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
function Unfinished({ analysis, state }: { analysis: Analysis; state: AnalysisState }) {
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
  if (analysis.status === 'cancelled') {
    return (
      <Notice tone="info" title="This comparison was cancelled" action={again}>
        It stopped after {analysis.progress.completedRuns.toLocaleString('en-GB')} of{' '}
        {analysis.progress.totalRuns.toLocaleString('en-GB')} runs. Nothing is shown from a partial
        comparison, because its scenarios would not yet all have the same seeds.
      </Notice>
    );
  }
  if (analysis.status === 'interrupted') {
    return (
      <Notice tone="warning" title="This comparison was interrupted" action={again}>
        {analysis.error?.message ??
          'The server stopped before it finished. It can be reproduced exactly from its seeds.'}
      </Notice>
    );
  }
  return (
    <Notice tone="error" title="This comparison failed" action={again}>
      {analysis.error?.message ?? 'It stopped before it finished.'}
    </Notice>
  );
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
  const { readiness, current, summaries, loading, error } = state;
  const lastWallMs = summaries.find((item) => item.status === 'completed')?.cost.wallMs ?? null;

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
    body = (
      <EmptyPanel
        title="No simulated actors yet"
        action={
          onOpenStep ? (
            <button
              className="button button-secondary"
              type="button"
              onClick={() => onOpenStep('environment')}
            >
              Open Env Setup
            </button>
          ) : undefined
        }
      >
        A comparison needs the cast of simulated actors. Approve the stakeholders and create the
        actors in the Env Setup step, then come back here to compare a baseline with the proposed
        change and its alternatives.
      </EmptyPanel>
    );
  } else if (current && running(current)) {
    body = <Progress analysis={current} state={state} />;
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
            <AnalysisResults analysis={current} />
          ) : (
            <Unfinished analysis={current} state={state} />
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
            />
          </details>
        ) : (
          <ScenarioSetup
            readiness={readiness}
            lastWallMs={lastWallMs}
            starting={state.starting}
            error={state.startError}
            onStart={(input) => void state.start(input)}
          />
        )}
      </>
    );
  }

  return (
    <section className="analysis-panel stage-card" aria-labelledby={titleId}>
      <header className="analysis-header">
        <h2 id={titleId}>Compare scenarios</h2>
        <p className="analysis-statement">
          Swarm explores scenarios. It does not guarantee or precisely predict real-world behavior.
        </p>
        <p className="field-help">
          A baseline where nothing changes, set against the proposed change and its alternatives,
          each run many times on the same seeds. Everything below counts simulated members and
          seeded runs; none of it is a rate of anything real.
        </p>
      </header>
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
