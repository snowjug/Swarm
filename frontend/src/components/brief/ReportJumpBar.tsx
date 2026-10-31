import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, ReactNode, RefObject } from 'react';
import {
  REPORT_BRIEF_ID,
  REPORT_DETAIL_ID,
  REPORT_REVIEW_ID,
  isPlainClick,
  scrollToPlace,
} from './reportNavigation';

/**
 * Where the bar sticks, and how much of the top of the screen it and the app header keep. The header
 * stays at the top of the page on a wide screen and goes with the page on a phone, so its height is
 * read, not assumed; the page then leaves room for both when it scrolls to a heading or a control.
 */
function useStickyOffsets(bar: RefObject<HTMLElement | null>): number | null {
  const [top, setTop] = useState<number | null>(null);
  useEffect(() => {
    const element = bar.current;
    const header = document.querySelector<HTMLElement>('.app-header');
    const root = document.documentElement;
    const measure = () => {
      const offset =
        header && getComputedStyle(header).position === 'sticky'
          ? Math.round(header.getBoundingClientRect().height)
          : 0;
      setTop(offset);
      root.style.setProperty(
        '--report-sticky',
        `${offset + Math.round(element?.getBoundingClientRect().height ?? 0)}px`,
      );
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (header) observer?.observe(header);
    if (element) observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      root.style.removeProperty('--report-sticky');
    };
  }, [bar]);
  return top;
}

/**
 * A link to a part of the page. On a phone the bar has room for a word each, so the name is shortened
 * to the eye; it stays whole in the accessible name, which is the same at every width.
 */
function Jump({
  id,
  label,
  short,
  children,
}: {
  id: string;
  label: string;
  short: string;
  children?: ReactNode;
}) {
  return (
    <a
      href={`#${id}`}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (!isPlainClick(event)) return;
        event.preventDefault();
        scrollToPlace(id);
      }}
    >
      <span className="report-jump-full">{label}</span>
      <span className="report-jump-short" aria-hidden="true">
        {short}
      </span>
      {children}
    </a>
  );
}

/**
 * The way around the Report stage, kept in view: the decision brief, the independent review and the
 * detailed report are each one link away, however far down the page the person has read. The review
 * says where it stands, so that a person who has only read the brief learns that there is one.
 */
export function ReportJumpBar({ review }: { review: string | null }) {
  const bar = useRef<HTMLElement>(null);
  const top = useStickyOffsets(bar);
  return (
    <nav
      ref={bar}
      className="report-jump"
      aria-label="Jump within the report"
      style={top === null ? undefined : ({ '--report-jump-top': `${top}px` } as CSSProperties)}
    >
      <span className="report-jump-label" aria-hidden="true">
        Jump to
      </span>
      <ul>
        <li>
          <Jump id={REPORT_BRIEF_ID} label="Decision brief" short="Brief" />
        </li>
        <li>
          <Jump id={REPORT_REVIEW_ID} label="Independent review" short="Review">
            {review ? (
              <>
                {' '}
                <span className="report-jump-status">{review}</span>
              </>
            ) : null}
          </Jump>
        </li>
        <li>
          <Jump id={REPORT_DETAIL_ID} label="Detailed report and studio" short="Details" />
        </li>
      </ul>
    </nav>
  );
}
