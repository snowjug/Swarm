import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { MAX_NOTE } from '../../../../shared/studio';
import { Modal, Spinner } from '../ui';

/**
 * A step of the review workflow that a person confirms. Where the step needs a reason, the reason is
 * required before it can be confirmed, and the server asks for it too.
 */
export function StepDialog({
  title,
  children,
  noteLabel,
  confirmLabel,
  confirmTone = 'primary',
  working,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  /** When set, the person must give a reason of at least three characters. */
  noteLabel?: string;
  confirmLabel: string;
  confirmTone?: 'primary' | 'secondary';
  working: boolean;
  onConfirm: (note: string | null) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const id = useId();
  const needsNote = noteLabel !== undefined;
  const ready = !needsNote || note.trim().length >= 3;
  return (
    <Modal title={title} onClose={() => (working ? undefined : onClose())}>
      <form
        className="view-stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready && !working) onConfirm(needsNote ? note.trim() : null);
        }}
      >
        <div>{children}</div>
        {needsNote && (
          <div className="field">
            <label htmlFor={id}>{noteLabel}</label>
            <textarea
              id={id}
              rows={4}
              maxLength={MAX_NOTE}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              required
              aria-describedby={`${id}-help`}
            />
            <p className="field-help" id={`${id}-help`}>
              At least three characters. It is kept in the report’s record.
            </p>
          </div>
        )}
        <div className="stage-actions">
          <button
            className={`button button-${confirmTone}`}
            type="submit"
            disabled={!ready || working}
          >
            {working ? <Spinner label={`${confirmLabel}…`} /> : null} {confirmLabel}
          </button>
          <button
            className="button button-secondary"
            type="button"
            disabled={working}
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
