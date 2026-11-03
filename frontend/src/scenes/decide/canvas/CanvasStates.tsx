import { ArrowRight, Compass, OctagonAlert } from 'lucide-react';
import type { DecisionReadiness } from '../../../../../shared/decision';
import { Button, EmptyState, Notice, Orbit, Skeleton, SkeletonText } from '../../../design/ui';
import { COPY, NEXT_STEPS } from './model';

/** What stands where the canvas will be, and what it says when it cannot be shown. */

/** The shape of the first viewport while it is read, with light passing over it. */
export function CanvasLoading() {
  return (
    <section className="sw-canvas-state" aria-busy="true" aria-label="Loading the decision view">
      <p className="sr-only" role="status">
        Loading the decision view
      </p>
      <div className="sw-canvas-skel" aria-hidden="true">
        <Skeleton height="1.4rem" width="min(36rem, 80%)" />
        <Skeleton height="clamp(2.6rem, 5vw, 4rem)" width="min(44rem, 100%)" radius="var(--r-md)" />
        <div className="sw-canvas-skel__row">
          {[0, 1, 2].map((index) => (
            <div key={index}>
              <Skeleton height="0.8rem" width="45%" />
              <SkeletonText lines={4} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** The canvas could not be read; what was read before, if anything, stays above this. */
export function CanvasError({
  message,
  onRetry,
  busy,
  kept,
}: {
  message: string;
  onRetry: () => void;
  busy: boolean;
  kept: boolean;
}) {
  return (
    <Notice
      tone="error"
      className="sw-canvas-notice"
      title="The decision view could not be read"
      action={
        <Button size="sm" variant="glass" busy={busy} onClick={onRetry}>
          Try again
        </Button>
      }
    >
      {message}{' '}
      {kept
        ? 'What is shown is the last version that could be read.'
        : 'Nothing has been lost: it is worked out from what the project holds.'}
    </Notice>
  );
}

/** What stands for the picture when there is none: nothing has been compared yet, a comparison is running, or the last one did not finish. */
export function CanvasEmpty({
  readiness,
  go,
  onReport,
}: {
  readiness: DecisionReadiness;
  go: Record<'ask' | 'ground' | 'map' | 'simulate', () => void>;
  /** The detailed report, where the exploration has one: it is the other thing there is to read. */
  onReport: (() => void) | null;
}) {
  const running = readiness.state === 'running';
  const failed = readiness.state === 'failed';
  const next = readiness.next ? NEXT_STEPS[readiness.next] : null;
  return (
    <section
      className="sw-canvas-state sw-canvas-state--empty"
      data-state={readiness.state}
      aria-label="The decision view is not available yet"
    >
      <EmptyState
        level={2}
        icon={
          running ? (
            <Orbit size={26} label="A comparison is running" />
          ) : failed ? (
            <OctagonAlert size={26} aria-hidden="true" />
          ) : (
            <Compass size={26} aria-hidden="true" />
          )
        }
        title={
          running
            ? 'A comparison is running'
            : failed
              ? 'The last comparison did not finish'
              : 'Nothing to decide from yet'
        }
        action={
          running ? null : (
            <div className="sw-canvas-state__actions">
              {next && (
                <Button
                  variant="primary"
                  iconEnd={<ArrowRight size={16} aria-hidden="true" />}
                  onClick={go[next.scene]}
                >
                  {next.label}
                </Button>
              )}
              {onReport && (
                <Button variant="glass" onClick={onReport}>
                  Detailed report
                </Button>
              )}
            </div>
          )
        }
      >
        {readiness.missing.join(' ')}
      </EmptyState>
      {!running && <p className="sw-canvas-quiet">{COPY.emptyLead}</p>}
      {readiness.status && <p className="sw-canvas-state__status">{readiness.status.headline}</p>}
    </section>
  );
}
