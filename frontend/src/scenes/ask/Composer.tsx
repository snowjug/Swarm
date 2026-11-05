import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode, Ref } from 'react';
import { AnimatePresence, m, useIsPresent } from 'motion/react';
import { ArrowRight, FileText, FlaskConical, Globe, X } from 'lucide-react';
import { cx } from '../../design/cx';
import { SPRING, useReducedMotion } from '../../design/motion';
import { Button, Textarea } from '../../design/ui';
import type { SourceKind } from '../../../../shared/scenario';
import { keyOf, sizeText, type DocumentInput } from './evidence';
import './Composer.css';

const ICONS: Record<SourceKind, typeof FileText> = {
  upload: FileText,
  paste: FileText,
  url: Globe,
  sample: FlaskConical,
  historical: FileText,
};

/**
 * The rotating line that says what a question could be, while the field is empty. Only a question that is shown
 * whole at this width is offered: one that would be cut off in the middle of its sentence (a phone is narrow) is not.
 */
function Prompts({ questions, visible }: { questions: readonly string[]; visible: boolean }) {
  const reduced = useReducedMotion();
  const [turn, setTurn] = useState(0);
  const [whole, setWhole] = useState<readonly number[] | null>(null);
  const probe = useRef<HTMLDivElement>(null);

  // The same lines, set in the same type and the same width but out of sight, are measured: a line that is cut by
  // the limit of three lines is taller than the box it is in.
  useLayoutEffect(() => {
    const node = probe.current;
    if (!node || !visible) return undefined;
    const measure = () => {
      const fit = Array.from(node.children).flatMap((child, at) =>
        child.scrollHeight <= child.clientHeight + 1 ? [at] : [],
      );
      const next = fit.length > 0 ? fit : questions.map((_, at) => at);
      setWhole((old) => (old && old.join() === next.join() ? old : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    void document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, [questions, visible]);

  const offered = whole ?? [];
  useEffect(() => {
    if (reduced || offered.length < 2 || !visible) return undefined;
    const timer = setInterval(() => setTurn((value) => value + 1), 5200);
    return () => clearInterval(timer);
  }, [reduced, offered.length, visible]);

  if (!visible || questions.length === 0) return null;
  const at = offered.length > 0 ? offered[turn % offered.length] : undefined;
  return (
    <>
      <div className="sw-composer__ghost sw-composer__probe" aria-hidden="true" ref={probe}>
        {questions.map((question) => (
          <span key={question}>{question}</span>
        ))}
      </div>
      <div className="sw-composer__ghost" aria-hidden="true">
        <AnimatePresence mode="wait" initial={false}>
          {at !== undefined && (
            <m.span
              key={at}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            >
              {questions[at]}
            </m.span>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}

/** One attached source: a pill that opens it and a control that takes it away. It is out of reach while it leaves. */
function Pill({
  document,
  index,
  disabled,
  onOpen,
  onRemove,
}: {
  document: DocumentInput;
  index: number;
  disabled: boolean;
  onOpen: (index: number) => void;
  onRemove: (index: number) => void;
}) {
  const present = useIsPresent();
  const Icon = ICONS[document.provenance?.kind ?? 'upload'];
  return (
    <m.li
      layout
      className="sw-tray__pill"
      inert={present ? undefined : true}
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
  // With no source there is no list, but it stays until the last pill has left, and is there for the first to arrive.
  const [listed, setListed] = useState(documents.length > 0);
  if (documents.length > 0 && !listed) setListed(true);
  return (
    <m.ul className="sw-tray" aria-label="Attached evidence" layoutScroll hidden={!listed}>
      <AnimatePresence initial={false} onExitComplete={() => setListed(documents.length > 0)}>
        {documents.map((document, index) => (
          <Pill
            key={keyOf(document)}
            document={document}
            index={index}
            disabled={disabled}
            onOpen={onOpen}
            onRemove={onRemove}
          />
        ))}
      </AnimatePresence>
    </m.ul>
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
  /** What the question brought up that can be done with it (a page it names), below the field while there is one. */
  suggestion?: ReactNode;
  /** What the person can say beside the question: the website it concerns and how far ahead it looks. */
  context: ReactNode;
  /** Whether Swarm researches for itself, which is the one thing it does that the person did not ask for by name. */
  research: ReactNode;
  tools: ReactNode;
  /** Who reads the question (rules or a model), on the row of the question's label, where it is seen before the question is asked. */
  engine?: ReactNode;
  /** What opens under the foot of the composer (the advanced fields). */
  panel?: ReactNode;
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
      // From any field of the composer. What is drawn in a portal (a menu, a sheet) is inside this form for React and
      // outside it for the page, so only a key that was pressed in the composer itself asks.
      onKeyDown={(event) => {
        if (
          event.key === 'Enter' &&
          (event.metaKey || event.ctrlKey) &&
          event.currentTarget.contains(event.target as Node)
        ) {
          event.preventDefault();
          if (!disabled) props.onSubmit();
        }
      }}
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
        <div className="sw-composer__headline">
          <label className="sw-composer__label" htmlFor="swarm-question">
            Your what-if question
          </label>
          {props.engine}
        </div>
        <div className="sw-composer__box">
          <Prompts questions={props.pool} visible={question.length === 0} />
          <Textarea
            bare
            id="swarm-question"
            ref={props.textareaRef}
            className="sw-composer__input"
            aria-describedby={props.describedBy}
            aria-invalid={props.invalid || undefined}
            rows={1}
            maxRows={9}
            maxLength={2000}
            disabled={disabled}
            value={question}
            onChange={(event) => props.onQuestion(event.target.value)}
          />
        </div>
      </div>
      <AnimatePresence initial={false}>{props.suggestion}</AnimatePresence>
      {props.tray}
      <div className="sw-composer__lower">
        {props.context}
        <div className="sw-composer__research">{props.research}</div>
        <div className="sw-composer__actions">
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
      </div>
      {props.panel}
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
