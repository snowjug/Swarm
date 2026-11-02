import type { ReactNode } from 'react';

/** A part of the page: a serif title, how many it holds, and what a person may do to it. It can be scrolled to and focused. */
export function SectionHead({
  id,
  titleId,
  title,
  count,
  aside,
}: {
  id: string;
  titleId: string;
  title: string;
  count?: number | null;
  aside?: ReactNode;
}) {
  return (
    <header className="sw-ground-head" id={id} tabIndex={-1}>
      <h2 className="sw-ground-head__title" id={titleId}>
        {title}
        {count !== undefined && count !== null && (
          <span className="sw-ground-head__count num">{count}</span>
        )}
      </h2>
      {aside && <div className="sw-ground-head__aside">{aside}</div>}
    </header>
  );
}
