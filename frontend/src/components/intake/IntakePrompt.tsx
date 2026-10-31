import { LoaderCircle, Sparkles } from 'lucide-react';
import { useId } from 'react';
import { MIN_QUESTION } from '../../lib/intake';
import { Notice } from '../ui';

/** The invitation to read the question into a scenario, in the one state where nothing has been read. */
export function IntakePrompt({
  ready,
  reading,
  error,
  disabled,
  onRead,
  onCancel,
}: {
  /** The question is long enough to read. */
  ready: boolean;
  reading: boolean;
  error: string | null;
  disabled: boolean;
  onRead: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  return (
    <div className="intake-prompt">
      <h3 className="intake-title">
        <Sparkles size={16} aria-hidden="true" /> Understand my question{' '}
        <span className="intake-optional">(optional)</span>
      </h3>
      <p id={`${id}-about`} className="intake-about">
        Swarm can read your question into a scenario that you can edit: what changes, what is
        affected, what is expected without the change, and the options to compare. Nothing runs
        until you start the experiment, and you can skip this step.
      </p>
      <div className="intake-actions">
        <button
          type="button"
          className="button button-primary"
          disabled={disabled || reading || !ready}
          aria-busy={reading}
          aria-describedby={`${id}-about${!ready ? ` ${id}-hint` : ''}`}
          onClick={onRead}
        >
          {reading ? (
            <LoaderCircle size={16} className="spin" aria-hidden="true" />
          ) : (
            <Sparkles size={16} aria-hidden="true" />
          )}
          {reading ? 'Reading your question…' : 'Understand my question'}
        </button>
        {reading && (
          <button type="button" className="text-button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      {!ready && !reading && (
        <p id={`${id}-hint`} className="field-help">
          Write your question above first: at least {MIN_QUESTION} characters.
        </p>
      )}
      <div aria-live="polite" className="sr-only">
        {reading ? 'Reading your question' : ''}
      </div>
      {error && (
        <Notice tone="error" title="The question could not be read">
          {error} You can carry on without a scenario.
        </Notice>
      )}
    </div>
  );
}
