import { useState } from 'react';
import { CircleHelp, HelpCircle, PenLine, Sparkles, X } from 'lucide-react';
import {
  CONSTRAINT_CATEGORY_LABELS,
  missingConstraintsSentence,
  type Clarification,
  type ConstraintInput,
} from '../../../../../shared/constraints';
import { Button, Field, Segmented, Textarea } from '../../../design/ui';
import { draftOfConstraint, inputOfDraft, problemWith, type EditorDraft } from './model';

export interface QuestionsProps {
  /** The questions to put now: at most three. */
  open: readonly Clarification[];
  /** How many are open in all, so that the page can say that more wait. */
  totalOpen: number;
  canEdit: boolean;
  working: boolean;
  onAnswer: (question: Clarification, constraint: ConstraintInput) => void;
  onUnknown: (question: Clarification) => void;
  onAssume: (question: Clarification) => void;
  onExclude: (question: Clarification) => void;
}

function AnswerForm({
  question,
  working,
  onSave,
  onCancel,
}: {
  question: Clarification;
  working: boolean;
  onSave: (constraint: ConstraintInput) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<EditorDraft>(() =>
    draftOfConstraint(undefined, question.category),
  );
  const [shown, setShown] = useState(false);
  const problem = shown ? problemWith(draft) : null;
  return (
    <form
      className="sw-cask__form"
      noValidate
      aria-label={`Answer: ${question.question}`}
      onSubmit={(event) => {
        event.preventDefault();
        setShown(true);
        if (problemWith(draft) === null) onSave(inputOfDraft(draft));
      }}
    >
      <Field
        label="What is the limit?"
        hint={`It is saved as your own ${CONSTRAINT_CATEGORY_LABELS[question.category].toLowerCase()} constraint.`}
        error={problem}
      >
        <Textarea
          rows={2}
          maxRows={5}
          value={draft.statement}
          autoFocus
          onChange={(event) => setDraft((old) => ({ ...old, statement: event.target.value }))}
        />
      </Field>
      <Segmented
        label="How firm it is"
        value={draft.hardness}
        onChange={(hardness) => setDraft((old) => ({ ...old, hardness }))}
        options={[
          { value: 'soft', label: 'Soft: a preference or a pressure' },
          { value: 'hard', label: 'Hard: a rule or a ceiling' },
        ]}
      />
      <div className="sw-cask__row">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={working}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="sm" busy={working} busyLabel="Saving">
          Save as a constraint
        </Button>
      </div>
    </form>
  );
}

/**
 * What Swarm could not find out and that could change the result, asked a few at a time. A person may
 * answer, say they do not know, choose to assume, or leave the question out. Not knowing is an answer
 * the page keeps: an unknown is not applied and is never treated as true.
 */
export function Questions({
  open,
  totalOpen,
  canEdit,
  working,
  onAnswer,
  onUnknown,
  onAssume,
  onExclude,
}: QuestionsProps) {
  const [answering, setAnswering] = useState<string | null>(null);
  if (open.length === 0) return null;
  const more = totalOpen - open.length;
  return (
    <section className="sw-cask" aria-labelledby="ask-title">
      <h2 id="ask-title" className="sw-title">
        {missingConstraintsSentence(open.length)}
      </h2>
      <p className="sw-caption">
        Swarm asks three at a time. Not knowing is a fine answer: an unknown is not applied, and is
        never treated as true.
        {more > 0 ? ` ${more} more ${more === 1 ? 'is' : 'are'} waiting.` : ''}
      </p>
      <ol className="sw-cask__list">
        {open.map((question) => (
          <li key={question.id} className="sw-cask__item">
            <p className="sw-eyebrow">{CONSTRAINT_CATEGORY_LABELS[question.category]}</p>
            <p className="sw-cask__q">{question.question}</p>
            <p className="sw-cask__why">
              <HelpCircle size={14} aria-hidden="true" />
              <span>Why it is asked: {question.why}</span>
            </p>
            {canEdit &&
              (answering === question.id ? (
                <AnswerForm
                  question={question}
                  working={working}
                  onCancel={() => setAnswering(null)}
                  onSave={(constraint) => {
                    setAnswering(null);
                    onAnswer(question, constraint);
                  }}
                />
              ) : (
                <div
                  className="sw-cask__actions"
                  role="group"
                  aria-label={`Respond: ${question.question}`}
                >
                  <Button
                    size="sm"
                    variant="glass"
                    icon={<PenLine size={14} aria-hidden="true" />}
                    disabled={working}
                    onClick={() => setAnswering(question.id)}
                  >
                    Answer
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<CircleHelp size={14} aria-hidden="true" />}
                    disabled={working}
                    onClick={() => onUnknown(question)}
                  >
                    Mark unknown
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Sparkles size={14} aria-hidden="true" />}
                    disabled={working}
                    onClick={() => onAssume(question)}
                  >
                    Use an assumption
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<X size={14} aria-hidden="true" />}
                    disabled={working}
                    onClick={() => onExclude(question)}
                  >
                    Exclude
                  </Button>
                </div>
              ))}
          </li>
        ))}
      </ol>
    </section>
  );
}
