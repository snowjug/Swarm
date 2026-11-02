import { FileText, TriangleAlert } from 'lucide-react';
import type { EvidenceRef } from '../../../../shared/evidence';

/** The passages behind a party: each quote word for word, with where it was taken from. */
export function EvidenceQuotes({
  evidence,
  empty,
}: {
  evidence: readonly EvidenceRef[];
  empty: string;
}) {
  if (evidence.length === 0) {
    return (
      <p className="sw-insp__assume">
        <TriangleAlert size={15} aria-hidden="true" />
        <span>
          <strong>Assumption, not evidence.</strong> {empty}
        </span>
      </p>
    );
  }
  return (
    <ul className="sw-insp__quotes">
      {evidence.map((ref, index) => (
        <li key={`${ref.passageId}-${index}`}>
          {ref.quote ? (
            <blockquote>“{ref.quote}”</blockquote>
          ) : (
            <p className="sw-caption">No excerpt was kept for this passage.</p>
          )}
          <p className="sw-insp__source">
            <FileText size={13} aria-hidden="true" />
            <span>{ref.documentName}</span>
            <span className="sw-mono">{ref.passageId}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}
