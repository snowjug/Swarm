import { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  MAX_REVIEW_NOTE_LENGTH,
  PUBLICATION_STATUS_LABELS,
  REVIEW_RESULT_LABELS,
  STATEMENT_TYPE_LABELS,
  SUPPORT_CLASS_LABELS,
  SUPPORT_CLASS_MEANINGS,
  type ClaimDetail,
  type EvidenceRef,
  type ReviewResult,
} from '../../../../shared/evidence';
import type { EvidenceChunk } from '../../../../shared/types';
import { api, errorMessage } from '../../api';
import { dateTime } from '../../lib/format';
import { PUBLICATION_TONE, SUPPORT_TONE, locationText, splitAtQuote } from '../../lib/ledger';
import { Notice, Spinner } from '../ui';
import { ToneChip } from './LedgerParts';

function Passage({
  evidence,
  passage,
}: {
  evidence: EvidenceRef;
  passage: EvidenceChunk | undefined;
}) {
  const split = passage ? splitAtQuote(passage.text, evidence.quote) : null;
  return (
    <li className={`evidence evidence-${evidence.role}`}>
      <p className="evidence-location">
        <strong>
          {evidence.role === 'supports' ? 'Supporting passage' : 'Contradicting passage'}
        </strong>
        <span className="mono muted">{locationText(evidence)}</span>
      </p>
      {passage ? (
        <blockquote className="preserve-text">
          {split ? (
            <>
              {split.before}
              <mark>{split.quote}</mark>
              {split.after}
            </>
          ) : (
            passage.text
          )}
        </blockquote>
      ) : (
        <p className="field-help">The passage text is no longer available.</p>
      )}
      <p className="field-help">
        {evidence.quote
          ? 'The highlighted words were found exactly as written in this passage.'
          : 'No exact quotation was matched; the whole passage was cited.'}{' '}
        {passage?.parserVersion ? `Cut from the document by ${passage.parserVersion}` : ''}
        {passage?.extractedAt ? ` on ${dateTime(passage.extractedAt)}.` : ''}
      </p>
      <p className="mono muted evidence-hash">{`SHA-256 ${evidence.contentHash.slice(0, 16)}…`}</p>
    </li>
  );
}

const REVIEW_ACTIONS: { result: Exclude<ReviewResult, 'pending'>; label: string }[] = [
  { result: 'accepted', label: 'Accept' },
  { result: 'needs-revision', label: 'Needs revision' },
  { result: 'rejected', label: 'Reject' },
];

/**
 * Everything behind one statement: the exact quotation in its passage and document, what
 * contradicts it, the assumptions and simulated events it rests on, and who reviewed it. A reviewer
 * can withhold or flag a statement, never make it better supported than the evidence allows.
 */
export function ClaimInspector({
  projectId,
  claimId,
  onClose,
  onChanged,
}: {
  projectId: string;
  claimId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<ClaimDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const noteId = useId();

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    void api.claim(projectId, claimId, controller.signal).then(
      (loaded) => {
        if (!controller.signal.aborted) setDetail(loaded);
      },
      (failure: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(failure));
      },
    );
    return () => controller.abort();
  }, [projectId, claimId, revision]);

  const loadedId = detail?.claim.id;
  useEffect(() => {
    if (loadedId) heading.current?.focus();
  }, [loadedId]);

  const review = async (result: Exclude<ReviewResult, 'pending'>) => {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      await api.reviewClaim(projectId, claimId, {
        result,
        note: note.trim() || null,
        expectedVersion: detail.claim.version,
      });
      setNote('');
      setRevision((old) => old + 1);
      onChanged();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  const passages = new Map(detail?.passages.map((passage) => [passage.id, passage]));
  const claim = detail?.claim;
  return (
    <section className="claim-inspector" aria-labelledby={`inspector-${claimId}`}>
      <div className="section-heading">
        <span className="eyebrow">STATEMENT INSPECTOR / {claimId}</span>
        <button
          className="icon-button"
          type="button"
          aria-label="Close statement inspector"
          onClick={onClose}
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>
      {!claim && !error && (
        <p className="inline-pending" role="status">
          <Spinner /> Loading the statement…
        </p>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {claim && detail && (
        <div className="view-stack">
          <h3 id={`inspector-${claimId}`} tabIndex={-1} ref={heading} className="preserve-text">
            {claim.text}
          </h3>
          <div className="claim-meta">
            <span className="claim-kind">{STATEMENT_TYPE_LABELS[claim.statementType]}</span>
            <ToneChip
              tone={SUPPORT_TONE[claim.supportClass]}
              label={SUPPORT_CLASS_LABELS[claim.supportClass]}
              title={SUPPORT_CLASS_MEANINGS[claim.supportClass]}
            />
            <ToneChip
              tone={PUBLICATION_TONE[claim.publication.status]}
              label={PUBLICATION_STATUS_LABELS[claim.publication.status]}
            />
          </div>
          <p className="field-help">{SUPPORT_CLASS_MEANINGS[claim.supportClass]}</p>
          {claim.publication.qualification && (
            <p className="claim-reason">
              <strong>Must be shown with</strong> {claim.publication.qualification}
            </p>
          )}
          <dl className="record-grid">
            <dt>How it was checked</dt>
            <dd>
              {claim.verification.method === 'deterministic+model'
                ? 'Automatic checks, then an independent model check'
                : 'Automatic checks only (no model check ran)'}
            </dd>
            <dt>Why this class</dt>
            <dd className="preserve-text">{claim.verification.reason}</dd>
            <dt>Chapter</dt>
            <dd>{claim.section}</dd>
            <dt>Version</dt>
            <dd>{claim.version}</dd>
          </dl>

          {claim.supporting.length + claim.contradicting.length > 0 ? (
            <ul className="evidence-list" role="list">
              {[...claim.supporting, ...claim.contradicting].map((evidence, index) => (
                <Passage
                  key={`${index}-${evidence.passageId}-${evidence.role}`}
                  evidence={evidence}
                  passage={passages.get(evidence.passageId)}
                />
              ))}
            </ul>
          ) : (
            <p className="claim-reason">No source passage is cited for this statement.</p>
          )}

          {detail.assumptions.length > 0 && (
            <div>
              <h4>Assumptions it depends on</h4>
              <ul className="plain-list">
                {detail.assumptions.map((assumption) => (
                  <li key={assumption.id}>
                    <span className="mono muted">{assumption.id}</span> {assumption.statement}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {claim.simulationEvents.length > 0 && (
            <div>
              <h4>Simulated events behind it</h4>
              <p className="field-help">
                These are recorded outputs of the simulation, not observations of real people.
              </p>
              <ul className="plain-list">
                {claim.simulationEvents.map((event) => (
                  <li key={event.memoryId}>
                    <span className="mono muted">{event.memoryId}</span> {event.platform}, round{' '}
                    {event.round}
                    {detail.memories.find((memory) => memory.id === event.memoryId)?.text
                      ? `: ${detail.memories.find((memory) => memory.id === event.memoryId)?.text}`
                      : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="review-form">
            <h4>Review</h4>
            <p>
              <ToneChip
                tone={
                  claim.review.result === 'pending'
                    ? 'neutral'
                    : claim.review.result === 'accepted'
                      ? 'good'
                      : 'caution'
                }
                label={REVIEW_RESULT_LABELS[claim.review.result]}
              />
              {claim.review.note && <span className="preserve-text"> {claim.review.note}</span>}
            </p>
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
              {REVIEW_ACTIONS.map(({ result, label }) => (
                <button
                  key={result}
                  className="button button-secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => void review(result)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="field-help">
              Rejecting withholds the statement from the report. Accepting only records that you
              reviewed it: it does not make the statement better supported.
            </p>
          </div>

          {claim.history.length > 0 && (
            <details className="record-details">
              <summary>{`History (${claim.history.length})`}</summary>
              <ol className="plain-list">
                {claim.history.map((entry) => (
                  <li key={entry.version}>
                    <span className="mono muted">v{entry.version}</span>{' '}
                    <time dateTime={entry.at}>{dateTime(entry.at)}</time>,{' '}
                    {entry.actor === 'reviewer' ? 'reviewer' : 'system'}: {entry.change}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
