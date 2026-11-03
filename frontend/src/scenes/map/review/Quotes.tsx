import { FileText, TriangleAlert } from 'lucide-react';

export interface QuoteItem {
  passageId: string;
  documentName: string;
  quote: string | null;
}

/** The passages behind a participant: each quotation word for word, with the document it was taken from. */
export function Quotes({ items, label }: { items: readonly QuoteItem[]; label: string }) {
  return (
    <ul className="sw-prv__quotes" aria-label={label}>
      {items.map((item, index) => (
        <li key={`${item.passageId}-${index}`}>
          {item.quote ? (
            <blockquote>“{item.quote}”</blockquote>
          ) : (
            <p className="sw-caption">No excerpt was kept for this passage.</p>
          )}
          <p className="sw-prv__source">
            <FileText size={13} aria-hidden="true" />
            <span>{item.documentName}</span>
            <span className="sw-mono">{item.passageId}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

/** Said where a participant cites nothing: what it rests on is an assumption, and is never dressed as a finding. */
export function Assumed({ children }: { children: string }) {
  return (
    <p className="sw-prv__assume">
      <TriangleAlert size={15} aria-hidden="true" />
      <span>
        <strong>Assumption, not evidence.</strong> {children}
      </span>
    </p>
  );
}
