import type { RefObject } from 'react';
import { GitCompareArrows, Hourglass, OctagonAlert, Sparkles } from 'lucide-react';
import type { Analysis } from '../../../../shared/analysis';
import type { AnalysisState } from '../../hooks/useAnalysis';
import { Button, EmptyState, Notice, Ring, Skeleton } from '../../design/ui';
import { durationText } from '../../lib/analysis';
import { countText, whenText } from './format';
import './states.css';

/** The shape of the first screen, while it is being read: where the sentence, the numbers and the answers will be. */
export function LoadingState() {
  return (
    <div className="sw-cmp sw-cmp-wait" role="status" aria-busy="true">
      <p className="sr-only">Reading the comparison</p>
      <div className="sw-cmp-hero" aria-hidden="true">
        <div className="sw-cmp-hero__lead">
          <Skeleton width="9rem" height="0.8rem" />
          <div className="sw-cmp-wait__title">
            <Skeleton width="92%" height="2.6rem" radius="0.6rem" />
            <Skeleton width="78%" height="2.6rem" radius="0.6rem" />
            <Skeleton width="54%" height="2.6rem" radius="0.6rem" />
          </div>
          <Skeleton width="62%" height="1.1rem" />
          <div className="sw-cmp-wait__figs">
            <Skeleton width="6rem" height="3.6rem" radius="0.8rem" />
            <Skeleton width="9rem" height="5.2rem" radius="0.8rem" />
            <Skeleton width="7rem" height="3rem" radius="0.8rem" />
          </div>
          <Skeleton width="100%" height="5.5rem" radius="0.8rem" />
        </div>
        <div className="sw-cmp-wait__why">
          <Skeleton width="70%" height="2.4rem" radius="0.6rem" />
          <Skeleton width="85%" height="2.4rem" radius="0.6rem" />
          <Skeleton width="60%" height="2.4rem" radius="0.6rem" />
        </div>
      </div>
    </div>
  );
}

/** What the page says when the saved comparisons could not be read, and the way to try again. */
export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="sw-cmp sw-cmp-state" role="alert">
      <EmptyState
        level={2}
        icon={<OctagonAlert size={22} aria-hidden="true" />}
        title="The comparison could not be read"
        action={
          <Button variant="primary" onClick={onRetry}>
            Try again
          </Button>
        }
      >
        {message}
      </EmptyState>
    </div>
  );
}

/** Nothing has been compared yet: the one thing to do is to simulate. */
export function NoneState({
  needsActors,
  onSimulate,
  onMap,
}: {
  needsActors: boolean;
  onSimulate: () => void;
  onMap: () => void;
}) {
  return (
    <div className="sw-cmp sw-cmp-state">
      <EmptyState
        level={2}
        icon={<GitCompareArrows size={22} aria-hidden="true" />}
        title={needsActors ? 'There is nobody to compare yet' : 'Nothing has been compared yet'}
        action={
          needsActors ? (
            <Button variant="primary" onClick={onMap}>
              Map the stakeholders
            </Button>
          ) : (
            <Button variant="primary" onClick={onSimulate}>
              Simulate the scenarios
            </Button>
          )
        }
      >
        {needsActors
          ? 'Approve the stakeholders and make the actors first. Then the scenarios can be run and set side by side.'
          : 'Simulate the baseline, the proposed change and its alternatives. They are set side by side here.'}
      </EmptyState>
    </div>
  );
}

/** A record the guided flow did not make has no scenarios to compare. */
export function LegacyState({ onExplore }: { onExplore: () => void }) {
  return (
    <div className="sw-cmp sw-cmp-state">
      <EmptyState
        level={2}
        icon={<GitCompareArrows size={22} aria-hidden="true" />}
        title="No comparison in this record"
        action={
          <Button variant="primary" onClick={onExplore}>
            Explore this question again
          </Button>
        }
      >
        This record was made before explorations could compare scenarios. Starting again from its
        question gives it a baseline and a proposed change to set side by side.
      </EmptyState>
    </div>
  );
}

/** The comparison finished, but left nothing to set against anything. */
export function EmptyResults({ onRun }: { onRun: () => void }) {
  return (
    <div className="sw-cmp sw-cmp-state">
      <EmptyState
        level={2}
        icon={<OctagonAlert size={22} aria-hidden="true" />}
        title="This comparison has no results"
        action={
          <Button variant="primary" onClick={onRun}>
            Simulate again
          </Button>
        }
      >
        It finished without keeping the runs of any scenario.
      </EmptyState>
    </div>
  );
}

/** A comparison under way: how far it has got, and where to watch it. */
export function RunningState({
  analysis,
  state,
  headingRef,
  onWatch,
}: {
  analysis: Analysis;
  state: AnalysisState;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onWatch: () => void;
}) {
  const { completedRuns, totalRuns } = analysis.progress;
  const share = totalRuns > 0 ? Math.min(1, completedRuns / totalRuns) : 0;
  const text = `${countText(completedRuns)} of ${countText(totalRuns)} simulated runs finished`;
  const tenths = Math.floor(share * 10) * 10;
  const may = state.readiness?.may.run !== false;
  return (
    <section className="sw-cmp sw-cmp-state" aria-labelledby="compare-title">
      <p className="sw-eyebrow">Compare</p>
      <h1
        id="compare-title"
        ref={headingRef}
        tabIndex={-1}
        className="sw-cmp-state__title sw-display"
      >
        Setting the futures <em>side by side</em>
      </h1>
      <div className="sw-cmp-run">
        <Ring value={share} size={148} stroke={7} label="Comparison progress" valueText={text}>
          <span className="sw-numeral sw-cmp-run__pct">
            {Math.round(share * 100)}
            <small>%</small>
          </span>
        </Ring>
        <div className="sw-cmp-run__text">
          <p className="sw-lead">
            {state.cancelling ? 'Cancelling: it stops after the run in progress.' : text}
          </p>
          <p className="sw-caption">
            {analysis.config.variants.length} scenarios × {analysis.config.runsPerVariant} seeded
            runs
            {analysis.config.sensitivity ? ', then the sensitivity of the change' : ''}.
          </p>
          <div className="sw-cmp-run__actions">
            <Button variant="primary" onClick={onWatch}>
              Watch it in Simulate
            </Button>
            {may && (
              <Button variant="ghost" busy={state.cancelling} onClick={() => void state.cancel()}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      </div>
      {state.trouble && (
        <Notice tone="caution" title="The progress cannot be read just now">
          {state.trouble} It tries again by itself, and the comparison goes on running on the
          server.
        </Notice>
      )}
      {state.startError && (
        <Notice tone="error" title="That did not work">
          {state.startError}
        </Notice>
      )}
      <p className="sr-only" role="status">
        {state.cancelling
          ? 'Cancelling the comparison.'
          : `Comparing scenarios: about ${tenths}% of the simulated runs are finished.`}
      </p>
    </section>
  );
}

const SETTINGS = (analysis: Analysis) => ({
  variants: analysis.config.variants,
  runsPerVariant: analysis.config.runsPerVariant,
  sensitivity: analysis.config.sensitivity,
  baseSeed: analysis.config.baseSeed,
  rounds: analysis.config.rounds,
});

/** A comparison that stopped without a result: what happened, honestly, and the way to run it again. */
export function UnfinishedState({
  analysis,
  state,
  headingRef,
  onSimulate,
  lastDone,
}: {
  analysis: Analysis;
  state: AnalysisState;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onSimulate: () => void;
  /** The newest comparison that did finish, if one did, to read in its place. */
  lastDone: { id: string; completedAt: string | null } | null;
}) {
  const may = state.readiness?.may.run !== false;
  const { completedRuns, totalRuns } = analysis.progress;
  const cancelled = analysis.status === 'cancelled';
  const interrupted = analysis.status === 'interrupted';
  const title = cancelled
    ? 'This comparison was cancelled'
    : interrupted
      ? 'This comparison was interrupted'
      : 'This comparison failed';
  return (
    <section className="sw-cmp sw-cmp-state" aria-labelledby="compare-title">
      <p className="sw-eyebrow">Compare</p>
      <h1
        id="compare-title"
        ref={headingRef}
        tabIndex={-1}
        className="sw-cmp-state__title sw-display"
      >
        {title}
      </h1>
      <Notice
        tone={cancelled ? 'info' : interrupted ? 'caution' : 'error'}
        title={`It stopped after ${countText(completedRuns)} of ${countText(totalRuns)} runs`}
      >
        {cancelled
          ? 'Nothing is shown from a partial comparison, because its scenarios would not all have the same seeds.'
          : (analysis.error?.message ??
            (interrupted
              ? 'The server stopped before it finished. It can be reproduced exactly from its seeds.'
              : 'It stopped before it finished.'))}
      </Notice>
      {state.startError && (
        <Notice tone="error" title="That did not work">
          {state.startError}
        </Notice>
      )}
      <div className="sw-cmp-run__actions">
        <Button
          variant="primary"
          icon={<Sparkles size={16} aria-hidden="true" />}
          busy={state.starting}
          disabled={!may}
          onClick={() => void state.start(SETTINGS(analysis))}
        >
          Run it again with the same settings
        </Button>
        <Button variant="ghost" onClick={onSimulate}>
          Change the scenarios
        </Button>
        {lastDone && (
          <Button
            variant="ghost"
            icon={<Hourglass size={16} aria-hidden="true" />}
            onClick={() => state.select(lastDone.id)}
          >
            Read the last finished one ({whenText(lastDone.completedAt)})
          </Button>
        )}
      </div>
      <p className="sr-only" role="status">
        {title}.
      </p>
      <p className="sw-caption">
        {durationText(analysis.cost.wallMs)} of simulation time was used before it stopped.
      </p>
    </section>
  );
}
