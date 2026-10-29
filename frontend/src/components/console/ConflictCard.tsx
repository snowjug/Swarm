import { useId, useState } from 'react';
import {
  CONTRADICTION_STATUS_LABELS,
  MAX_REVIEW_NOTE_LENGTH,
  isOpenConflict,
  type ContradictionRecord,
  type ContradictionStatus,
  type EvidenceRef,
} from '../../../../shared/evidence';
import { api, errorMessage } from '../../api';
import { locationText, type Tone } from '../../lib/ledger';
import { ToneChip } from './LedgerParts';

const STATUS_TONE: Record<ContradictionStatus, Tone> = {
  detected: 'caution',
  confirmed: 'bad',
  dismissed: 'neutral',
  resolved: 'good',
};

function Side({ side, value }: { side: EvidenceRef; value: string | null }) {
  return (
    <figure className="conflict-side">
      <figcaption>
        <strong>{side.documentName}</strong>
        <span className="mono muted">
          {locationText(side).replace(`${side.documentName}, `, '')}
        </span>
      </figcaption>
      {side.quote && <blockquote className="preserve-text">{side.quote}</blockquote>}
      {value && (
        <p className="conflict-value">
          Figure: <strong>{value}</strong>
        </p>
      )}
    </figure>
  );
}

/**
 * Two source passages that seem to disagree. They are detected from wording alone, so neither is
 * declared true: a person confirms the conflict, dismisses it, or marks it resolved.
 */
export function ConflictCard({
  projectId,
  conflict,
  onChanged,
}: {
  projectId: string;
  conflict: ContradictionRecord;
  onChanged: () => void;
}) {
  const noteId = useId();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = isOpenConflict(conflict.status);

  const review = async (status: 'confirmed' | 'dismissed' | 'resolved') => {
    setBusy(true);
    setError(null);
    try {
      await api.reviewConflict(projectId, conflict.id, { status, note: note.trim() || null });
      setNote('');
      onChanged();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={`conflict conflict-${conflict.status}`}>
      <div className="claim-meta">
        <ToneChip
          tone={STATUS_TONE[conflict.status]}
          label={CONTRADICTION_STATUS_LABELS[conflict.status]}
        />
        <span className="claim-kind">
          {conflict.kind === 'numeric' ? 'Different figures' : 'Opposite statements'}
        </span>
        <span className="mono muted claim-id">{conflict.id}</span>
      </div>
      <p className="conflict-topic">
        <strong>Shared wording</strong>{' '}
        {conflict.topic ? conflict.topic.split(' ').join(', ') : 'none recorded'}
      </p>
      <div className="conflict-sides">
        <Side side={conflict.left} value={conflict.leftValue} />
        <Side side={conflict.right} value={conflict.rightValue} />
      </div>
      {conflict.note && (
        <p className="claim-reason">
          <strong>Reviewer note</strong> {conflict.note}
        </p>
      )}
      {open ? (
        <div className="review-form">
          <label htmlFor={noteId}>Note (optional)</label>
          <textarea
            id={noteId}
            rows={2}
            maxLength={MAX_REVIEW_NOTE_LENGTH}
            value={note}
            disabled={busy}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="review-actions">
            <button
              className="button button-secondary"
              type="button"
              disabled={busy}
              onClick={() => void review('confirmed')}
            >
              Confirm conflict
            </button>
            <button
              className="button button-secondary"
              type="button"
              disabled={busy}
              onClick={() => void review('dismissed')}
            >
              Not a conflict
            </button>
            <button
              className="button button-secondary"
              type="button"
              disabled={busy}
              onClick={() => void review('resolved')}
            >
              Mark resolved
            </button>
          </div>
          <p className="field-help">
            Found automatically from wording. Neither passage is declared true. Dismissing removes
            this conflict from the statements it affected.
          </p>
        </div>
      ) : null}
      {error && (
        <p className="review-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
