import { BRIEF_SECTION_IDS, type BriefSectionId } from '../../../../shared/brief';
import { sectionAnchor } from '../../lib/brief';

/** The three parts of the Report stage a person jumps between, and the contents of the brief. */
export const REPORT_BRIEF_ID = 'report-brief';
export const REPORT_REVIEW_ID = 'report-review';
export const REPORT_DETAIL_ID = 'report-detail';
export const BRIEF_CONTENTS_ID = 'brief-contents';

/**
 * What a decision-maker reads without opening anything: the answer, what was decided, what the
 * simulation showed and what to do about it. Every other section is reference material: it is closed
 * until it is wanted, one click away, and listed in the contents with all the others.
 */
const OPEN_BY_DEFAULT: ReadonlySet<BriefSectionId> = new Set<BriefSectionId>([
  'executive-answer',
  'decision',
  'reaction-patterns',
  'alternative-outcomes',
  'first-order',
  'second-order',
  'drivers',
  'risks-opportunities',
  'recommendations',
]);

export const openByDefault = (id: BriefSectionId): boolean => OPEN_BY_DEFAULT.has(id);

/**
 * The section a URL hash names: `#brief-<id>`, as the contents link to it, or `#brief-<n>` for the nth
 * section of the contents. Null for anything else, so that a hash that is not about the brief is left alone.
 */
export function sectionFromHash(
  hash: string,
  present: readonly BriefSectionId[] = BRIEF_SECTION_IDS,
): BriefSectionId | null {
  const name = hash.replace(/^#/u, '');
  const byId = present.find((id) => sectionAnchor(id) === name);
  if (byId) return byId;
  const number = /^brief-(\d{1,2})$/u.exec(name);
  return number ? (present[Number(number[1]) - 1] ?? null) : null;
}

/** A click that is the page's own to answer: one that opens in a new tab or window is the browser's. */
export const isPlainClick = (event: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

/**
 * Brings a part of the page into view and puts focus on it, so that a keyboard or screen reader user
 * arrives where the eye does. A part that cannot take focus hands it to its first heading.
 */
export function scrollToPlace(id: string): boolean {
  const target = document.getElementById(id);
  if (!target) return false;
  target.scrollIntoView({ block: 'start' });
  const landing = target.hasAttribute('tabindex')
    ? target
    : target.querySelector<HTMLElement>('h1, h2, h3');
  if (landing) {
    if (!landing.hasAttribute('tabindex')) landing.setAttribute('tabindex', '-1');
    landing.focus({ preventScroll: true });
  }
  return true;
}
