import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { anchorOf, type ChapterId } from '../model/brief-model';
import { plural } from '../model/format';
import './chapter.css';

/**
 * One chapter of the document. A chapter of the story is always open; a chapter of reference is one line of
 * the page until it is wanted, and its heading is the control that opens it. What is in it stays in the page
 * either way, so that find-in-page reaches it and the printed page holds it.
 */
export function ChapterShell({
  id,
  title,
  gist,
  reference,
  open,
  onToggle,
  noteCount,
  children,
}: {
  id: ChapterId;
  title: string;
  gist: string | null;
  reference: boolean;
  open: boolean;
  onToggle: () => void;
  /** How many criticisms stand in this chapter, so that a closed one still says it holds some. */
  noteCount: number;
  children: ReactNode;
}) {
  const anchor = anchorOf(id);
  const heading = (
    <>
      <span className="sw-title sw-decide-chapter__name">{title}</span>
      {gist ? <span className="sw-decide-chapter__gist num">{gist}</span> : null}
      {noteCount > 0 ? (
        <span className="sw-decide-chapter__notes">{plural(noteCount, 'criticism')}</span>
      ) : null}
    </>
  );
  return (
    <section
      id={anchor}
      className="sw-decide-chapter"
      data-reference={reference || undefined}
      data-open={open}
      aria-labelledby={`${anchor}-title`}
      tabIndex={-1}
    >
      <h2 id={`${anchor}-title`} className="sw-decide-chapter__title">
        {reference ? (
          <button
            type="button"
            className="sw-decide-chapter__toggle"
            aria-expanded={open}
            aria-controls={`${anchor}-body`}
            onClick={onToggle}
          >
            <span className="sw-decide-chapter__head">{heading}</span>
            <ChevronDown className="sw-decide-chapter__chevron" size={22} aria-hidden="true" />
          </button>
        ) : (
          <span className="sw-decide-chapter__head">{heading}</span>
        )}
      </h2>
      <div
        id={`${anchor}-body`}
        className="sw-decide-chapter__body"
        data-open={open}
        inert={reference ? !open : undefined}
      >
        <div className="sw-decide-chapter__inner">
          <div className="sw-decide-chapter__flow">{children}</div>
        </div>
      </div>
    </section>
  );
}

/** Where a new part of the story begins: a hairline and its name. */
export function ActDivider({ label, index }: { label: string; index: number }) {
  return (
    <div className="sw-decide-act" role="presentation">
      <span className="sw-decide-act__index num">{String(index + 1).padStart(2, '0')}</span>
      <span className="sw-decide-act__label sw-eyebrow">{label}</span>
      <span className="sw-decide-act__rule" aria-hidden="true" />
    </div>
  );
}
