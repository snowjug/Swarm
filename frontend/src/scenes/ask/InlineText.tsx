import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { cx } from '../../design/cx';
import './InlineText.css';

/**
 * Text that is edited where it stands. It reads as text (a pencil appears under the pointer or the
 * keyboard); pressing it turns it into a field in the same type, Enter or leaving keeps the change and
 * Escape drops it. It is a real button and a real textarea, so it works from the keyboard and a screen
 * reader: `label` is what it is called in both states.
 */
export function InlineText({
  value,
  onCommit,
  label,
  placeholder = 'Add',
  maxLength,
  multiline = false,
  className,
  disabled = false,
  autoEdit = false,
}: {
  value: string;
  /** `via` is how it ended: `key` (Enter) leaves focus on the text, `blur` (the person went elsewhere) leaves it where it went. */
  onCommit: (value: string, via: 'key' | 'blur') => void;
  label: string;
  placeholder?: string;
  maxLength?: number;
  /** Enter adds a line (Ctrl/⌘+Enter keeps the change) instead of keeping the change. */
  multiline?: boolean;
  className?: string;
  disabled?: boolean;
  /** Opens as a field (a row that was just added has nothing to read yet). */
  autoEdit?: boolean;
}) {
  const [editing, setEditing] = useState(autoEdit);
  const [draft, setDraft] = useState(value);
  const field = useRef<HTMLTextAreaElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const restore = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useLayoutEffect(() => {
    const node = field.current;
    if (!editing || !node) return;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  }, [editing, draft]);

  useEffect(() => {
    if (!editing) return;
    const node = field.current;
    node?.focus();
    node?.setSelectionRange(node.value.length, node.value.length);
  }, [editing]);

  const finish = (keep: boolean, via: 'key' | 'blur') => {
    setEditing(false);
    if (keep && draft.trim() !== value.trim()) onCommit(draft.trim(), via);
    else setDraft(value);
    // Focus goes back to the text for a key, and is left alone when the person has moved on: a Tab must go forward.
    restore.current = via === 'key';
  };

  useEffect(() => {
    if (!editing && restore.current) {
      restore.current = false;
      button.current?.focus();
    }
  }, [editing]);

  if (editing) {
    return (
      <textarea
        ref={field}
        className={cx('sw-inline sw-inline--field', className)}
        aria-label={label}
        rows={1}
        maxLength={maxLength}
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => finish(true, 'blur')}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            finish(false, 'key');
          } else if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            (!multiline || event.metaKey || event.ctrlKey)
          ) {
            event.preventDefault();
            finish(true, 'key');
          }
        }}
      />
    );
  }
  const empty = value.trim() === '';
  return (
    <button
      ref={button}
      type="button"
      className={cx('sw-inline sw-inline--text', empty && 'is-empty', className)}
      // The name holds the words that are seen (the value, or the hint of an empty field) so that a voice can say them.
      aria-label={empty ? `${placeholder}: ${label}, empty. Edit` : `${label}: ${value}. Edit`}
      disabled={disabled}
      onClick={() => setEditing(true)}
    >
      <span className="sw-inline__value">{empty ? placeholder : value}</span>
      <Pencil className="sw-inline__pencil" size={13} aria-hidden="true" />
    </button>
  );
}
