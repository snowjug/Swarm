import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import { List, Scale } from 'lucide-react';
import { Button, IconButton } from '../../../design/ui';
import type { BriefExportFormat } from '../../../../../shared/brief';
import {
  ANSWER_ANCHOR,
  actsOf,
  anchorOf,
  CHAPTERS_ANCHOR,
  type Chapter,
  type ChapterId,
} from '../model/brief-model';
import { plural } from '../model/format';
import { ExportMenu } from './Tools';
import './nav.css';

/** A click that is the page's own to answer: one that opens in a new tab or window is the browser's. */
const plain = (event: MouseEvent): boolean =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

export type Place = ChapterId | 'answer';

/** The chapters in their parts, each a link that opens it and takes the reader there. */
export function ContentsList({
  chapters,
  active,
  notes,
  onSelect,
}: {
  chapters: readonly Chapter[];
  active: Place | null;
  notes: ReadonlyMap<string, number>;
  onSelect: (place: Place) => void;
}) {
  const list = useRef<HTMLOListElement>(null);
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  // The mark is one element that slides to the link being read. It is measured, not animated by the
  // layout engine, so that it does not lose its place when the page jumps under the sticky list.
  useLayoutEffect(() => {
    const root = list.current;
    if (!root) return;
    const measure = () => {
      const current = root.querySelector<HTMLElement>('[aria-current="location"]');
      setBox((old) => {
        if (!current) return old === null ? old : null;
        const next = { top: current.offsetTop, height: current.offsetHeight };
        return old && old.top === next.top && old.height === next.height ? old : next;
      });
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(root);
    return () => watch.disconnect();
  }, [active, chapters]);

  const link = (place: Place, href: string, label: string, count = 0) => {
    const current = active === place;
    return (
      <a
        href={`#${href}`}
        className="sw-decide-toc__link"
        aria-current={current ? 'location' : undefined}
        onClick={(event) => {
          if (!plain(event)) return;
          event.preventDefault();
          onSelect(place);
        }}
      >
        <span className="sw-decide-toc__label">{label}</span>
        {count > 0 && (
          <span className="sw-decide-toc__dot" title={plural(count, 'criticism')}>
            <span className="sr-only">{plural(count, 'criticism')}</span>
          </span>
        )}
      </a>
    );
  };
  return (
    <div className="sw-decide-tocwrap">
      <ol className="sw-decide-toc" role="list" ref={list}>
        <li>{link('answer', ANSWER_ANCHOR, 'The answer')}</li>
        {actsOf(chapters).map(({ act, label, chapters: own }) => (
          <li key={act} className="sw-decide-toc__act">
            <p className="sw-eyebrow">{label}</p>
            <ol role="list">
              {own.map((chapter) => (
                <li key={chapter.spec.id}>
                  {link(
                    chapter.spec.id,
                    anchorOf(chapter.spec.id),
                    chapter.title,
                    notes.get(chapter.spec.id) ?? 0,
                  )}
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ol>
      <span
        className="sw-decide-toc__mark"
        aria-hidden="true"
        data-shown={box !== null || undefined}
        style={
          box
            ? ({ '--mark-y': `${box.top}px`, '--mark-h': `${box.height}px` } as CSSProperties)
            : undefined
        }
      />
    </div>
  );
}

/** The contents, kept beside the page where there is room for them. */
export function ContentsRail(
  props: Parameters<typeof ContentsList>[0] & { onOpenAll: () => void; allOpen: boolean },
) {
  const { onOpenAll, allOpen, ...list } = props;
  return (
    <nav className="sw-decide-rail" aria-label="Contents of the decision brief">
      <a
        href={`#${CHAPTERS_ANCHOR}`}
        className="sw-decide-rail__skip"
        onClick={(event) => {
          if (!plain(event)) return;
          event.preventDefault();
          document.getElementById(CHAPTERS_ANCHOR)?.focus();
        }}
      >
        Skip the contents
      </a>
      <ContentsList {...list} />
      <button type="button" className="sw-decide-rail__all" onClick={onOpenAll}>
        {allOpen ? 'Close the reference' : 'Open every chapter'}
      </button>
    </nav>
  );
}

/**
 * The bar that keeps the tools in reach once the first screen has gone by: where the reader is, the review
 * and the export. It is there only while it is wanted, and carries how far through the brief the reader is.
 */
export function DocBar({
  shown,
  where,
  reviewCount,
  onContents,
  onReview,
  url,
  mayExport,
}: {
  shown: boolean;
  where: { act: string | null; title: string };
  reviewCount: number | null;
  onContents: () => void;
  onReview: () => void;
  url: (format: BriefExportFormat) => string;
  mayExport: boolean;
}) {
  return (
    <div
      className="sw-decide-bar sw-glass"
      data-shown={shown}
      inert={!shown}
      role="region"
      aria-label="Brief tools"
    >
      <div className="sw-decide-bar__start">
        <IconButton
          label="Contents"
          size="md"
          onClick={onContents}
          className="sw-decide-bar__contents"
        >
          <List size={18} aria-hidden="true" />
        </IconButton>
        <p className="sw-decide-bar__where">
          {where.act ? <span className="sw-eyebrow">{where.act}</span> : null}
          <strong>{where.title}</strong>
        </p>
      </div>
      <div className="sw-decide-bar__end">
        <Button
          variant="glass"
          size="sm"
          icon={<Scale size={15} aria-hidden="true" />}
          onClick={onReview}
        >
          <span className="sw-decide-bar__long">Review</span>
          {reviewCount ? <span className="sw-decide-tools__count num">{reviewCount}</span> : null}
        </Button>
        <ExportMenu url={url} allowed={mayExport} />
      </div>
      <span className="sw-decide-bar__progress" aria-hidden="true" />
    </div>
  );
}
