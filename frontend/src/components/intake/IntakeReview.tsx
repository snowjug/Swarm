import { useEffect, useRef } from 'react';
import type { ScenarioFrame } from '../../../../shared/scenario';
import { applyAnswer, skipQuestion } from '../../lib/intake';
import { Notice } from '../ui';
import { IntakeEditor } from './IntakeEditor';
import { IntakeNotes } from './IntakeParts';
import { IntakeQuestions } from './IntakeQuestions';

/**
 * A scenario that has been read and is waiting for the person: how it was read, the few things the
 * question left open, every field to edit, and the choice to use it or drop it. Focus lands on the
 * heading when it appears, so that a keyboard user is where the result is.
 */
export function IntakeReview({
  frame,
  mode,
  model,
  notes,
  stale,
  problems,
  disabled,
  onChange,
  onUse,
  onDiscard,
}: {
  frame: ScenarioFrame;
  mode: 'rules' | 'model' | null;
  model: string | null;
  notes: readonly string[];
  stale: boolean;
  problems: readonly string[];
  disabled: boolean;
  onChange: (frame: ScenarioFrame) => void;
  onUse: () => void;
  onDiscard: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <div className="intake-review">
      <h3 className="intake-title" ref={heading} tabIndex={-1}>
        Check and edit the scenario
      </h3>
      <p className="field-help">
        Everything here is yours to change. Nothing runs yet, and a reading is a starting point, not
        an answer.
      </p>
      <IntakeNotes frame={frame} mode={mode} model={model} notes={notes} />
      {stale && (
        <p className="intake-stale" role="status">
          The question has changed since it was read. Read it again to update the scenario, or keep
          editing this one.
        </p>
      )}
      <IntakeQuestions
        questions={frame.ambiguities}
        disabled={disabled}
        onAnswer={(index, answer) => onChange(applyAnswer(frame, index, answer))}
        onSkip={(index) => onChange(skipQuestion(frame, index))}
      />
      <IntakeEditor frame={frame} disabled={disabled} onChange={onChange} />
      <div aria-live="polite">
        {problems.length > 0 && (
          <Notice tone="error" title="This scenario cannot be used yet">
            <ul className="intake-plain">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </Notice>
        )}
      </div>
      <div className="intake-actions">
        <button type="button" className="button button-primary" disabled={disabled} onClick={onUse}>
          Use this scenario
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={disabled}
          onClick={onDiscard}
        >
          Discard
        </button>
      </div>
      <p className="field-help">
        The scenario is kept with your experiment when you create it. If you do not use it, the
        experiment starts from your question alone.
      </p>
    </div>
  );
}
