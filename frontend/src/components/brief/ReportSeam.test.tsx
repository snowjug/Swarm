import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CritiquesState } from '../../hooks/useCritiques';
import { critiqueFixture, setFixture, stateFixture, viewFixture } from '../../test/critics';
import { projectFixture } from '../../test/project';
import { visibleText } from '../../test/provider';
import { ReportJumpBar } from './ReportJumpBar';
import { ReportSeam } from './ReportSeam';
import { REPORT_BRIEF_ID, REPORT_DETAIL_ID, REPORT_REVIEW_ID } from './reportNavigation';

const mocked = vi.hoisted(() => ({ useCritiques: vi.fn() }));
vi.mock('../../hooks/useCritiques', () => ({ useCritiques: mocked.useCritiques }));

const project = projectFixture();
const seam = (state: CritiquesState) => {
  mocked.useCritiques.mockReturnValue(state);
  return renderToStaticMarkup(<ReportSeam project={project} />);
};
const links = (html: string) =>
  [...html.matchAll(/<a href="#([^"]+)">([\s\S]*?)<\/a>/gu)].map((match) => ({
    href: match[1],
    text: visibleText(match[2] ?? ''),
  }));

beforeEach(() => mocked.useCritiques.mockReset());

describe('the way around the Report stage', () => {
  it('puts a bar above the brief and the review, with one link to each part of the page', () => {
    const html = seam(stateFixture());
    expect(html.indexOf('<nav class="report-jump"')).toBeGreaterThan(-1);
    expect(html.indexOf('<nav class="report-jump"')).toBeLessThan(
      html.indexOf('<div class="seam-stack">'),
    );
    expect(html).toContain('aria-label="Jump within the report"');
    expect(
      links(html.slice(0, html.indexOf('<div class="seam-stack">'))).map((link) => link.href),
    ).toEqual([REPORT_BRIEF_ID, REPORT_REVIEW_ID, REPORT_DETAIL_ID]);
    expect([REPORT_BRIEF_ID, REPORT_REVIEW_ID, REPORT_DETAIL_ID]).toEqual([
      'report-brief',
      'report-review',
      'report-detail',
    ]);
  });

  it('lands on the panels it links to: the brief, and the independent review under its own name', () => {
    const html = seam(stateFixture());
    expect(html).toContain(`id="${REPORT_BRIEF_ID}"`);
    expect(html).toMatch(
      new RegExp(
        `<section class="critic-panel view-stack" id="${REPORT_REVIEW_ID}" tabindex="-1" aria-labelledby="[^"]+">`,
        'u',
      ),
    );
    expect(visibleText(html)).toContain('Independent review');
  });

  it('reads the review once and gives the same read to the panel, so that nothing is asked for twice', () => {
    seam(stateFixture());
    expect(mocked.useCritiques).toHaveBeenCalledTimes(1);
    expect(mocked.useCritiques).toHaveBeenCalledWith(project.id);
  });

  it('says where the review stands, from what has been read', () => {
    const status = (state: Partial<CritiquesState>) => links(seam(stateFixture(state)))[1]?.text;
    expect(status({ view: viewFixture({ critiques: null }) })).toBe(
      'Independent review Review not run yet',
    );
    expect(
      status({
        view: viewFixture({
          critiques: setFixture([
            critiqueFixture({ id: 'a' }),
            critiqueFixture({ id: 'b', status: 'accepted' }),
          ]),
        }),
      }),
    ).toBe('Independent review Review 1 not yet closed');
  });

  it('says nothing about the review until it has been read, and says when it could not be', () => {
    expect(links(seam(stateFixture({ view: null, loading: true })))[1]?.text).toBe(
      'Independent review Review',
    );
    expect(links(seam(stateFixture({ view: null, error: 'Offline.' })))[1]?.text).toBe(
      'Independent review Review could not be read',
    );
  });
});

describe('the links of the bar', () => {
  const html = renderToStaticMarkup(<ReportJumpBar review="not run yet" />);

  it('name each part in full to a screen reader, and shorten the name only to the eye', () => {
    expect(html).toContain('<span class="report-jump-full">Detailed report and studio</span>');
    expect(html).toContain('<span class="report-jump-short" aria-hidden="true">Details</span>');
    expect(html).toContain('<span class="report-jump-short" aria-hidden="true">Review</span>');
    // The decorative label of the bar is not read out before the links.
    expect(html).toContain('<span class="report-jump-label" aria-hidden="true">Jump to</span>');
  });

  it('keeps the status of the review inside its link, so that it is part of the name', () => {
    const review = /<a href="#report-review">([\s\S]*?)<\/a>/u.exec(html)?.[1] ?? '';
    expect(review).toContain('<span class="report-jump-status">not run yet</span>');
  });
});
