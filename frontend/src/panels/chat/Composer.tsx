import type { Ref } from 'react';
import { ArrowUp } from 'lucide-react';
import { IconButton, Orbit, Textarea } from '../../design/ui';
import { QUESTION_MAX, QUESTION_MIN } from './chatView';

/**
 * Where a question is written: a field that grows with it, and a send button that is the one accent on the
 * sheet. Enter sends and Shift+Enter makes a new line; nothing is sent that is too short to be a question.
 */
export function Composer({
  value,
  onChange,
  onSend,
  label,
  placeholder,
  sendLabel,
  busy,
  disabled,
  blocked = false,
  inputRef,
  note,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: (question: string) => void;
  label: string;
  placeholder: string;
  sendLabel: string;
  busy: boolean;
  /** The field itself cannot be used. */
  disabled: boolean;
  /** The field can be written in but nothing can be sent yet. */
  blocked?: boolean;
  inputRef?: Ref<HTMLTextAreaElement>;
  note?: string | null;
}) {
  const ready = value.trim().length >= QUESTION_MIN && !busy && !disabled && !blocked;
  const submit = () => {
    if (ready) onSend(value.trim());
  };
  return (
    <form
      className="sw-chat__composer"
      data-busy={busy || undefined}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Textarea
        bare
        ref={inputRef}
        className="sw-chat__input"
        aria-label={label}
        placeholder={placeholder}
        rows={1}
        maxRows={6}
        maxLength={QUESTION_MAX}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="sw-chat__composer-foot">
        {note ? (
          <span className="sw-chat__status" role="status">
            {note}
          </span>
        ) : value.length >= 850 ? (
          <span className="sw-chat__count num" aria-hidden="true">
            {value.length}/{QUESTION_MAX}
          </span>
        ) : (
          <span className="sw-chat__hint" aria-hidden="true">
            Enter to send · Shift+Enter for a new line
          </span>
        )}
        <IconButton
          className="sw-chat__send"
          label={sendLabel}
          tone="accent"
          type="submit"
          disabled={!ready && !busy}
          aria-busy={busy || undefined}
        >
          {busy ? (
            <Orbit size={18} label="Waiting for the answer" />
          ) : (
            <ArrowUp size={18} aria-hidden="true" />
          )}
        </IconButton>
      </div>
    </form>
  );
}
