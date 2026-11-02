import { forwardRef, useEffect, useState } from 'react';
import type { FormEvent, ReactNode, Ref } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { ArrowRight, FileText, FlaskConical, Globe, X } from 'lucide-react';
import { cx } from '../../design/cx';
import { SPRING, useReducedMotion } from '../../design/motion';
import { Button, Textarea } from '../../design/ui';
import type { SourceKind } from '../../../../shared/scenario';
import { sizeText, type DocumentInput } from './evidence';
import './Composer.css';

const ICONS: Record<SourceKind, typeof FileText> = {
  upload: FileText,
  paste: FileText,
  url: Globe,
  sample: FlaskConical,
  historical: FileText,
};

/** The rotating line that says what a question could be, while the field is empty. */
function Prompts({ questions, visible }: { questions: readonly string[]; visible: boolean }) {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (reduced || questions.length < 2 || !visible) return undefined;
    const timer = setInterval(() => setIndex((value) => (value + 1) % questions.length), 5200);
    return () => clearInterval(timer);
  }, [reduced, questions.length, visible]);
  if (!visible || questions.length === 0) return null;
  return (
    <div className="sw-composer__ghost" aria-hidden="true">
      <AnimatePresence mode="wait" initial={false}>
        <m.span
          key={index}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        >
          {questions[index]}
        </m.span>
      </AnimatePresence>
    </div>
  );
}

/** The sources that are attached, as small pills that arrive and leave with a spring. */
export function Tray({
  documents,
  onOpen,
  onRemove,
  disabled,
}: {
  documents: readonly DocumentInput[];
  onOpen: (index: number) => void;
  onRemove: (index: number) => void;
  disabled: boolean;
}) {
  return (
    <ul className="sw-tray" aria-label="Attached evidence">
      <AnimatePresence initial={false}>
        {documents.map((document, index) => {
          const Icon = ICONS[document.provenance?.kind ?? 'upload'];
          return (
            <m.li
              layout
              key={`${index}-${document.name}`}
              className="sw-tray__pill"
              initial={{ opacity: 0, scale: 0.85, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.14 } }}
              transition={{ ...SPRING.snappy, delay: Math.min(index * 0.03, 0.24) }}
            >
              <button
                type="button"
                className="sw-tray__open"
                onClick={() => onOpen(index)}
                title={`${document.name} · ${sizeText(document.content.length)}`}
                aria-label={`Read ${document.name}, ${sizeText(document.content.length)}`}
              >
                <Icon size={14} aria-hidden="true" />
                <span className="sw-tray__name">{document.name}</span>
              </button>
              <button
                type="button"
                className="sw-tray__remove"
                aria-label={`Remove ${document.name}`}
                disabled={disabled}
                onClick={() => onRemove(index)}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </m.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}

export interface ComposerProps {
  question: string;
  onQuestion: (value: string) => void;
  disabled: boolean;
  busy: boolean;
  /** What to say beside the field when something is wrong with the question itself. */
  invalid: boolean;
  pool: readonly string[];
  tray: ReactNode;
  tools: ReactNode;
  note?: ReactNode;
  onSubmit: () => void;
  onFocusChange: (focused: boolean) => void;
  dropping: boolean;
  onDropFiles: (files: FileList) => void;
  onDropState: (dropping: boolean) => void;
  describedBy?: string;
  submitLabel?: string;
  textareaRef: Ref<HTMLTextAreaElement>;
}

/**
 * The one place a person starts: a field in the serif, large, on a glass that lights at its edge while
 * it is being written in. Evidence is attached to it (dropped on it, or from the tray), and the single
 * way forward is at its foot. The edge light and the gathering swarm behind it are what "focus" looks like.
 */
export const Composer = forwardRef<HTMLFormElement, ComposerProps>(function Composer(props, ref) {
  const { question, disabled, busy } = props;
  const [focused, setFocused] = useState(false);
  const [filled, setFilled] = useState(false);
  useEffect(() => setFilled(question.trim().length > 0), [question]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!disabled) props.onSubmit();
  };
  return (
    <form
      ref={ref}
      className={cx(
        'sw-composer sw-glass sw-glass--overlay',
        (focused || filled) && 'is-active',
        props.dropping && 'is-dropping',
        props.invalid && 'is-invalid',
      )}
      onSubmit={submit}
      noValidate
      aria-busy={busy || undefined}
      onFocus={() => {
        setFocused(true);
        props.onFocusChange(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocused(false);
          props.onFocusChange(false);
        }
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          props.onDropState(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          props.onDropState(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.files.length) return;
        event.preventDefault();
        props.onDropState(false);
        props.onDropFiles(event.dataTransfer.files);
      }}
    >
      <span className="sw-composer__edge" aria-hidden="true" />
      <div className="sw-composer__field">
        <Prompts questions={props.pool} visible={question.length === 0} />
        <Textarea
          bare
          id="swarm-question"
          ref={props.textareaRef}
          className="sw-composer__input"
          aria-label="Your what-if question"
          aria-describedby={props.describedBy}
          aria-invalid={props.invalid || undefined}
          rows={2}
          maxRows={9}
          maxLength={2000}
          disabled={disabled}
          value={question}
          onChange={(event) => props.onQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              if (!disabled) props.onSubmit();
            }
          }}
        />
      </div>
      {props.tray}
      <div className="sw-composer__bar">
        <div className="sw-composer__tools">{props.tools}</div>
        <div className="sw-composer__go">
          {props.note}
          <Button
            type="submit"
            variant="primary"
            size="lg"
            busy={busy}
            busyLabel="Reading your question"
            disabled={disabled && !busy}
            iconEnd={<ArrowRight size={18} aria-hidden="true" />}
          >
            {props.submitLabel ?? 'Explore'}
          </Button>
        </div>
      </div>
      <AnimatePresence>
        {props.dropping && (
          <m.div
            className="sw-composer__drop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            aria-hidden="true"
          >
            Drop to add evidence
          </m.div>
        )}
      </AnimatePresence>
    </form>
  );
});
