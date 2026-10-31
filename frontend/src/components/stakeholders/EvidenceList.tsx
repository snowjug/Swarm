import { FileText, TriangleAlert } from 'lucide-react';
import type { EvidenceRef } from '../../../../shared/evidence';

/** The passages behind a stakeholder: each quote word for word, with the passage it was taken from. */
export function EvidenceList({
  evidence,
  empty,
}: {
  evidence: readonly EvidenceRef[];
  /** What to say when there is none, since that depends on who proposed the stakeholder. */
  empty: string;
}) {
  if (evidence.length === 0) {
    return (
      <p className="stk-no-evidence">
        <TriangleAlert size={14} aria-hidden="true" /> <strong>Assumption, not evidence.</strong>{' '}
        {empty}
      </p>
    );
  }
  return (
    <div className="stk-evidence">
      <p className="stk-label">
        Evidence ({evidence.length}) <span className="stk-hint">quotes from your sources</span>
      </p>
      <ul>
        {evidence.map((ref, index) => (
          <li key={`${ref.passageId}-${index}`}>
            {ref.quote ? (
              <blockquote className="stk-quote">“{ref.quote}”</blockquote>
            ) : (
              <p className="stk-quote">No excerpt was kept for this passage.</p>
            )}
            <p className="stk-source">
              <FileText size={12} aria-hidden="true" />
              <span className="mono">{ref.passageId}</span> · {ref.documentName}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
