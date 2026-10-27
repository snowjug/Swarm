import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GroundingReview as Review } from '../../../shared/grounding';
import { GroundingReview } from '../components/console/GroundingReview';
import { allKindsAndVerdicts, modelReportFixture, reviewFixture } from './grounding';
import { visibleText } from './provider';

/** Static markup of the review for a model-written report carrying `review` (or none). */
export function renderReview(
  review?: Review,
  options: { complete?: boolean; titles?: string[] } = {},
): string {
  return renderToStaticMarkup(
    createElement(GroundingReview, {
      report: modelReportFixture(review, options.titles),
      complete: options.complete,
      onInspect: () => {},
    }),
  );
}

export const fullReview = (overrides: Partial<Review> = {}): Review =>
  reviewFixture(allKindsAndVerdicts(), overrides);

export const summaryHtml = (html: string): string =>
  /<p class="grounding-summary">([\s\S]*?)<\/p>/u.exec(html)![1]!;

export const headings = (html: string): { level: number; text: string }[] =>
  [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gu)].map((match) => ({
    level: Number(match[1]),
    text: visibleText(match[2]!),
  }));

/** Everything from the first chapter group on. */
export const groupsHtml = (html: string): string =>
  html.slice(html.indexOf('class="grounding-groups"'));

/** One markup string per statement row inside the chapter groups, each starting at its class list. */
export const rowsOf = (html: string): string[] =>
  groupsHtml(html).split('<li class="claim ').slice(1);
