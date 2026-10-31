import { Check, Lock } from 'lucide-react';
import type { ConsoleStep } from '../../../../shared/guided';
import type { ProjectDetail } from '../../../../shared/types';
import type { UiMode } from '../../lib/mode';
import {
  stepAvailable,
  stepHelp,
  stepLabels,
  stepLock,
  stepOrder,
  stepStatus,
  stepStatusLabel,
} from '../../lib/console';
import { Spinner } from '../ui';

export function ConsoleStepper({
  project,
  step,
  onNavigate,
  mode = 'guided',
}: {
  project: ProjectDetail;
  step: ConsoleStep;
  onNavigate: (step: ConsoleStep) => void;
  /**
   * Guided says in plain words what each step is for, and for a locked one what it needs too;
   * Advanced keeps the engine's names alone. A screen reader is told what a locked step needs in
   * both, whatever is drawn.
   */
  mode?: UiMode;
}) {
  return (
    <nav className="console-stepper" aria-label="Guided workflow steps">
      {stepOrder.map((item, index) => {
        const status = stepStatus(project, item);
        const enabled = stepAvailable(project, item);
        const lock = stepLock(project, item);
        return (
          <button
            type="button"
            key={item}
            className={`console-step ${step === item ? 'active' : ''} step-${status ?? 'unknown'}`}
            disabled={!enabled}
            aria-current={step === item ? 'step' : undefined}
            onClick={() => onNavigate(item)}
          >
            <span className="step-index" aria-hidden="true">
              {status === 'ready' ? <Check size={13} /> : index + 1}
            </span>
            <span>
              <strong>{stepLabels[item]}</strong>{' '}
              <small className={lock ? 'step-locked' : undefined}>
                {lock && <Lock size={11} aria-hidden="true" />}
                {lock && ' '}
                {stepStatusLabel(project, item)}
              </small>
              <span className="sr-only">
                , step {index + 1} of 5{lock ? `. ${lock}` : ''}
              </span>
              {mode === 'guided' && <small className="step-help">{stepHelp[item]}</small>}
              {mode === 'guided' && lock && (
                <small className="step-help step-lock" aria-hidden="true">
                  {lock}
                </small>
              )}
            </span>
            {(status === 'queued' || status === 'running') && (
              <span className="step-spinner" aria-hidden="true">
                <Spinner />
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
