import { ChevronDown } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { Critique } from '../../../../../shared/critique';
import { SEVERITY_VIEW, STATUS_VIEW } from '../../../lib/critics';
import { bySeriousness } from '../model/critique-model';
import { useDoc } from './context';
import { ROLE_SHORT, SEVERITY_ICONS, STATUS_ICONS } from './meta';
import './notes.css';

/**
 * One criticism, as a note in the margin beside the statement it is about. A press opens it in the review.
 * Its name is what it shows, with what it is said before and what a press does after, so that the name
 * still begins with the words that are on it.
 */
export function CritiqueNote({ critique, index = 0 }: { critique: Critique; index?: number }) {
  const { openReview } = useDoc();
  const Icon = SEVERITY_ICONS[critique.severity];
  const Status = critique.status === 'open' ? null : STATUS_ICONS[critique.status];
  return (
    <button
      type="button"
      className="sw-decide-note"
      data-severity={critique.severity}
      data-status={critique.status}
      style={{ '--i': index } as CSSProperties}
      onClick={() => openReview(critique.id)}
    >
      <span className="sr-only">Criticism: </span>
      <span className="sw-decide-note__meta">
        <Icon size={13} aria-hidden="true" />
        <span className="sw-decide-note__sev">{SEVERITY_VIEW[critique.severity].label}</span>
        <span className="sw-decide-note__role">{ROLE_SHORT[critique.role] ?? critique.role}</span>
        {Status ? (
          <span className="sw-decide-note__status" title={STATUS_VIEW[critique.status].meaning}>
            <Status size={13} aria-hidden="true" />
            <span>{STATUS_VIEW[critique.status].label}</span>
          </span>
        ) : null}
      </span>
      <span className="sw-decide-note__text">{critique.objection}</span>
      <span className="sr-only"> Open in the review.</span>
    </button>
  );
}

/** The notes beside one statement: in the margin where there is one, and a small count under the text where there is not. */
export function NoteStack({ critiques }: { critiques: readonly Critique[] }) {
  const { arrival, openReview } = useDoc();
  if (critiques.length === 0) return null;
  const ordered = bySeriousness(critiques);
  const worst = ordered[0]!;
  const Icon = SEVERITY_ICONS[worst.severity];
  return (
    <>
      <div className="sw-decide-notes" key={arrival} data-many={ordered.length > 1 || undefined}>
        {ordered.map((critique, index) => (
          <CritiqueNote key={critique.id} critique={critique} index={index} />
        ))}
      </div>
      <button
        type="button"
        className="sw-decide-notes-inline"
        data-severity={worst.severity}
        onClick={() => openReview(worst.id)}
      >
        <Icon size={13} aria-hidden="true" />
        <span className="num">{critiques.length}</span>{' '}
        <span>{critiques.length === 1 ? 'criticism' : 'criticisms'}</span>
        <span className="sr-only">
          {' '}
          of this statement, the most serious {SEVERITY_VIEW[worst.severity].label.toLowerCase()}.
          Open in the review.
        </span>
        <ChevronDown size={13} aria-hidden="true" className="sw-decide-notes-inline__chev" />
      </button>
    </>
  );
}
