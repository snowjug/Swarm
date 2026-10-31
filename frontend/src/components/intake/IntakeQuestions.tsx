import { CircleHelp } from 'lucide-react';
import { useId, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { ScenarioAmbiguity } from '../../../../shared/scenario';
import { LIMITS } from '../../lib/intake';

function QuestionCard({
  ambiguity,
  disabled,
  onAnswer,
  onSkip,
}: {
  ambiguity: ScenarioAmbiguity;
  disabled: boolean;
  onAnswer: (answer: string) => void;
  onSkip: () => void;
}) {
  const id = useId();
  const [answer, setAnswer] = useState('');
  const ready = answer.trim().length > 0;
  const submit = () => {
    if (ready && !disabled) onAnswer(answer);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    submit();
  };
  return (
    <li className="intake-question">
      <p className="intake-question-note" id={`${id}-message`}>
        {ambiguity.message}
      </p>
      <div className="field">
        <label htmlFor={`${id}-answer`}>{ambiguity.question ?? ambiguity.message}</label>
        <input
          id={`${id}-answer`}
          type="text"
          autoComplete="off"
          maxLength={LIMITS.description}
          value={answer}
          disabled={disabled}
          aria-describedby={`${id}-message`}
          onChange={(event) => setAnswer(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="intake-actions">
        <button
          type="button"
          className="button button-secondary button-small"
          disabled={disabled || !ready}
          onClick={submit}
        >
          Apply my answer
        </button>
        <button type="button" className="text-button" disabled={disabled} onClick={onSkip}>
          Skip this question
        </button>
      </div>
    </li>
  );
}

/**
 * What the question left open, at most a few, each with the one question that would settle it. An
 * answer refines the scenario below; a question can also be skipped. None of them is required.
 */
export function IntakeQuestions({
  questions,
  disabled = false,
  onAnswer,
  onSkip,
}: {
  questions: readonly ScenarioAmbiguity[];
  disabled?: boolean;
  onAnswer: (index: number, answer: string) => void;
  onSkip: (index: number) => void;
}) {
  if (questions.length === 0) return null;
  return (
    <section className="intake-questions" aria-label="Questions that would improve the scenario">
      <h4>
        <CircleHelp size={16} aria-hidden="true" />{' '}
        {questions.length === 1 ? 'One thing' : 'Things'} the question left open
      </h4>
      <p className="field-help">
        These are optional. Each answer goes into the scenario below, where you can still change it.
      </p>
      <ul className="intake-list">
        {questions.map((ambiguity, index) => (
          <QuestionCard
            key={`${ambiguity.field}:${ambiguity.question}`}
            ambiguity={ambiguity}
            disabled={disabled}
            onAnswer={(answer) => onAnswer(index, answer)}
            onSkip={() => onSkip(index)}
          />
        ))}
      </ul>
    </section>
  );
}
