import { ArrowRight, RefreshCw } from 'lucide-react';
import type { ExecutionStep } from '../../../../shared/guided';
import type { ProjectDetail } from '../../../../shared/types';
import { canExecute, stepLabels, stepStatus } from '../../lib/console';
import { Spinner } from '../ui';

export function StageStatus({
  project,
  step,
  label,
}: {
  project: ProjectDetail;
  step: ExecutionStep;
  /** What the status is of, where that is only a part of the stage. */
  label?: string;
}) {
  const status = stepStatus(project, step);
  return (
    <div className={`stage-state state-${status ?? 'unknown'}`}>
      {status === 'running' || status === 'queued' ? (
        <Spinner label={`${stepLabels[step]} ${status}`} />
      ) : (
        <span className="status-dot" />
      )}
      <div>
        <strong>
          {label ?? stepLabels[step]} · {status ?? 'not recorded'}
        </strong>
        <p>
          {status === 'paused'
            ? `Paused after round ${project.currentRound} of ${project.roundCount} — saved and resumable.`
            : status === 'ready'
              ? 'Recorded output is ready for inspection.'
              : status === 'pending'
                ? 'Not started. No output has been generated for this stage.'
                : status === 'queued'
                  ? 'Accepted by the server; waiting for execution.'
                  : status === 'running'
                    ? 'The server is executing this stage. Updates reflect persisted records.'
                    : status === 'failed' || status === 'cancelled'
                      ? 'Execution stopped. Inspect the error / log, then retry this current stage.'
                      : 'This historical record has no guided stage status.'}
        </p>
      </div>
    </div>
  );
}

export function RunStepButton({
  project,
  step,
  busy,
  onRun,
  label,
  variant = 'primary',
}: {
  project: ProjectDetail;
  step: ExecutionStep;
  busy: boolean;
  onRun: (step: ExecutionStep) => void;
  label?: string;
  /** Secondary where the stage has another action that leads, so that it has one main button. */
  variant?: 'primary' | 'secondary';
}) {
  if (!canExecute(project, step)) return null;
  const retry = ['failed', 'cancelled'].includes(stepStatus(project, step) ?? '');
  return (
    <button
      className={`button button-${variant}`}
      type="button"
      disabled={busy}
      onClick={() => onRun(step)}
    >
      {retry ? (
        <RefreshCw size={15} aria-hidden="true" />
      ) : (
        <ArrowRight size={15} aria-hidden="true" />
      )}
      {retry ? `Retry ${stepLabels[step]}` : (label ?? `Start ${stepLabels[step]}`)}
    </button>
  );
}
