import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SUPPORT_VERDICTS } from '../../../../shared/grounding';
import type { ProjectDetail } from '../../../../shared/types';
import {
  allKindsAndVerdicts,
  claimFixture,
  modelReportFixture,
  reviewFixture,
} from '../../test/grounding';
import {
  fullReview,
  groupsHtml,
  headings,
  renderReview,
  summaryHtml,
} from '../../test/groundingView';
import { projectFixture } from '../../test/project';
import { visibleText } from '../../test/provider';
import { GroundingReview } from './GroundingReview';
import { ReportReader } from './ReportReader';

describe('grounding review summary and method', () => {
  it('has the heading and one summary line with a count for every verdict', () => {
    const html = renderReview(fullReview());
    expect(headings(html)[0]).toEqual({ level: 2, text: 'Grounding review' });
    expect(visibleText(summaryHtml(html))).toBe(
      '7 statements checked · 2 Supported · 1 Partly supported · 1 Not supported · 1 Contradicted · 2 Not checkable',
    );
  });

  it('writes the counts it is given, in the shared order', () => {
    const review = fullReview({
      counts: { unchecked: 1, contradicted: 1, unsupported: 1, partial: 2, supported: 7 },
    });
    expect(visibleText(summaryHtml(renderReview(review)))).toBe(
      '12 statements checked · 7 Supported · 2 Partly supported · 1 Not supported · 1 Contradicted · 1 Not checkable',
    );
  });

  it('gives every verdict its own icon, the same one in the summary and on every statement', () => {
    const html = renderReview(fullReview());
    const summary = [
      ...summaryHtml(html).matchAll(
        /class="tally tally-(\w+)"><svg[^>]*class="lucide (lucide-[a-z-]+)"/gu,
      ),
    ];
    expect(summary.map((match) => match[1])).toEqual([...SUPPORT_VERDICTS]);
    expect(new Set(summary.map((match) => match[2])).size).toBe(SUPPORT_VERDICTS.length);
    const icons = Object.fromEntries(summary.map((match) => [match[1], match[2]]));
    const badges = [
      ...groupsHtml(html).matchAll(
        /class="verdict-badge verdict-(\w+)"><svg[^>]*class="lucide (lucide-[a-z-]+)" aria-hidden="true"/gu,
      ),
    ];
    expect(badges).toHaveLength(7);
    for (const badge of badges) expect(badge[2]).toBe(icons[badge[1]!]);
  });

  it('dims a verdict nobody received instead of colouring it as an alarm', () => {
    const claims = allKindsAndVerdicts().filter((claim) => claim.verdict !== 'contradicted');
    const html = summaryHtml(renderReview(reviewFixture(claims)));
    expect(html).toContain('class="tally tally-contradicted tally-zero"');
    expect(html.match(/tally-zero/gu)).toHaveLength(1);
  });

  it('says an independent model check ran when it did, as plain visible text', () => {
    const html = renderReview(fullReview({ method: 'deterministic+model' }));
    const sentence =
      'Quote, word-overlap and figure checks, plus an independent model check that had to quote real text';
    expect(html).toContain(`<dd>${sentence}</dd>`);
    expect(visibleText(html)).not.toContain('Deterministic checks only');
  });

  it('says plainly when the independent model check did not run', () => {
    const html = renderReview(fullReview({ method: 'deterministic' }));
    expect(html).toContain(
      '<dd class="method-limited">Deterministic checks only — the independent model check did not run</dd>',
    );
    expect(visibleText(html)).not.toContain('plus an independent model check');
  });

  it('records when the review was made, machine-readably', () => {
    expect(renderReview(fullReview())).toMatch(
      /<dt>Checked<\/dt><dd><time dateTime="2026-01-02T03:04:05.000Z">[^<]+<\/time>/u,
    );
  });

  it('states that a verdict is about the cited passage, not about the world', () => {
    expect(visibleText(renderReview(fullReview()))).toContain(
      'They do not show that the passage itself is true.',
    );
  });
});

describe('contradicted statements come first', () => {
  it('lists them in a labelled region, before any chapter group', () => {
    const html = renderReview(fullReview());
    expect(html).toContain(
      '<section class="grounding-contradicted" role="region" aria-labelledby="grounding-contradicted-title">',
    );
    const heading = headings(html).find((item) => item.text.startsWith('Contradicted'));
    expect(heading).toEqual({ level: 3, text: 'Contradicted by the sources (1)' });
    const region = html.indexOf('class="grounding-contradicted"');
    expect(region).toBeGreaterThan(-1);
    expect(region).toBeLessThan(html.indexOf('class="grounding-groups"'));
    expect(region).toBeLessThan(html.indexOf('Chapter one</h3>'));
    const regionHtml = html.slice(region, html.indexOf('</section>', region));
    expect(regionHtml).toContain('Synthetic contradicted claim seven.');
    expect(regionHtml).not.toContain('Synthetic source fact one.');
  });

  it('is not an alert, status or live region: it is not a live event', () => {
    expect(renderReview(fullReview())).not.toMatch(
      /role="(?:alert|status|log)"|aria-live|aria-atomic/u,
    );
  });

  it('counts only the contradicted statements', () => {
    const claims = [
      ...allKindsAndVerdicts(),
      claimFixture({ id: 'C8', verdict: 'contradicted', text: 'Another contradicted statement.' }),
    ];
    const html = renderReview(reviewFixture(claims));
    expect(headings(html).map((item) => item.text)).toContain('Contradicted by the sources (2)');
    expect(html.match(/class="grounding-contradicted"/gu)).toHaveLength(1);
  });

  it('is absent when nothing was contradicted', () => {
    const claims = allKindsAndVerdicts().filter((claim) => claim.verdict !== 'contradicted');
    const html = renderReview(reviewFixture(claims));
    expect(html).not.toContain('grounding-contradicted');
    expect(html).not.toContain('Contradicted by the sources');
    expect(html).not.toContain('role="region"');
  });

  it('still announces the count when the review recorded no details for them', () => {
    const html = renderReview(
      reviewFixture([claimFixture()], { counts: { ...fullReview().counts } }),
    );
    expect(headings(html).map((item) => item.text)).toContain('Contradicted by the sources (1)');
    expect(visibleText(html)).toContain(
      'The review counts these statements, but their details were not recorded.',
    );
  });
});

describe('statements grouped by chapter', () => {
  it('has one group per chapter, in chapter order, each with its own small tally', () => {
    const html = renderReview(fullReview());
    const groups = [
      ...groupsHtml(html).matchAll(
        /<div class="group-head"><h3 id="(grounding-group-\d)">([^<]*)<\/h3><p>([\s\S]*?)<\/p><\/div>/gu,
      ),
    ];
    expect(groups.map((group) => group[2])).toEqual(['Chapter one', 'Chapter two']);
    expect(groups.map((group) => visibleText(group[3]!))).toEqual([
      '3 statements · 1 Supported · 1 Partly supported · 1 Not checkable',
      '4 statements · 1 Supported · 1 Not supported · 1 Contradicted · 1 Not checkable',
    ]);
    for (const [, id] of groups)
      expect(html).toContain(`<ul class="claim-list" role="list" aria-labelledby="${id}">`);
  });

  it('keeps every statement in its chapter, including the contradicted one', () => {
    const html = groupsHtml(renderReview(fullReview()));
    const chapterTwo = html.slice(html.indexOf('Chapter two</h3>'));
    for (const id of ['C4', 'C5', 'C6', 'C7']) expect(chapterTwo).toContain(`>${id}</span>`);
    expect(html.slice(0, html.indexOf('Chapter two</h3>'))).not.toContain('>C7</span>');
  });

  it('names chapters in which no statement was listed instead of implying they were checked', () => {
    const html = renderReview(fullReview(), {
      titles: ['Chapter one', 'Chapter two', 'Chapter three'],
    });
    expect(visibleText(html)).toContain(
      'No statements were listed for “Chapter three”, so nothing in that chapter was checked statement by statement.',
    );
    expect(visibleText(renderReview(fullReview()))).not.toContain('No statements were listed');
  });

  it('says so when no statement was listed at all', () => {
    const html = renderReview(reviewFixture([]));
    expect(visibleText(summaryHtml(html))).toBe(
      '0 statements checked · 0 Supported · 0 Partly supported · 0 Not supported · 0 Contradicted · 0 Not checkable',
    );
    expect(visibleText(html)).toContain('No statements were listed for checking');
    expect(html).not.toContain('grounding-groups');
    expect(html).not.toContain('grounding-contradicted');
  });
});

describe('when there is no review to show', () => {
  it('says why a rules-based report has none', () => {
    const report = { ...modelReportFixture(), generatedBy: 'local' as const };
    const html = renderToStaticMarkup(<GroundingReview report={report} onInspect={() => {}} />);
    expect(headings(html)).toEqual([{ level: 2, text: 'Grounding review' }]);
    expect(html).toContain(
      '<p class="grounding-empty">The rules-based report is assembled from recorded metrics and verbatim excerpts, so it has no model-written statements to check.</p>',
    );
    expect(html).not.toContain('grounding-legend');
    expect(html).not.toContain('statements checked');
  });

  it('says so when a finished model-written report has no review', () => {
    const html = renderReview(undefined);
    expect(html).toContain(
      '<p class="grounding-empty">This model-written report has no grounding review, so none of its statements were checked.</p>',
    );
    expect(html).not.toContain('statements checked');
    expect(html).not.toContain('The rules-based report');
  });

  it('does not say a partial model-written report was left unchecked for good', () => {
    expect(renderReview(undefined, { complete: false })).toContain(
      'This partial model-written report has no grounding review, so none of its statements have been checked.',
    );
  });

  it('keeps the section labelled even when it is empty', () => {
    expect(renderReview(undefined)).toContain(
      '<section class="grounding-review view-stack" aria-labelledby="grounding-review-title">',
    );
  });
});

describe('inside the report reader', () => {
  const projectWith = (
    report: ReturnType<typeof modelReportFixture>,
    status: ProjectDetail['status'] = 'completed',
  ) => {
    const project = projectFixture();
    project.mode = report.generatedBy;
    project.status = status;
    project.report = report;
    return project;
  };

  it('sits after the chapters and before the recorded metrics', () => {
    const html = renderToStaticMarkup(
      <ReportReader project={projectWith(modelReportFixture(fullReview()))} onInspect={() => {}} />,
    );
    const lastChapter = html.indexOf('id="report-chapter-1"');
    const review = html.indexOf('id="grounding-review-title"');
    const metrics = html.indexOf('Recorded scenario metrics');
    expect(lastChapter).toBeGreaterThan(-1);
    expect(review).toBeGreaterThan(lastChapter);
    expect(metrics).toBeGreaterThan(review);
  });

  it('shows the rules-based sentence for a local report', () => {
    const report = { ...modelReportFixture(), generatedBy: 'local' as const };
    const html = renderToStaticMarkup(
      <ReportReader project={projectWith(report)} onInspect={() => {}} />,
    );
    expect(visibleText(html)).toContain('so it has no model-written statements to check.');
  });

  it('tells a finished report from a partial one when the review is missing', () => {
    const done = renderToStaticMarkup(
      <ReportReader project={projectWith(modelReportFixture())} onInspect={() => {}} />,
    );
    expect(visibleText(done)).toContain(
      'This model-written report has no grounding review, so none of its statements were checked.',
    );
    const partial = renderToStaticMarkup(
      <ReportReader project={projectWith(modelReportFixture(), 'running')} onInspect={() => {}} />,
    );
    expect(visibleText(partial)).toContain(
      'This partial model-written report has no grounding review',
    );
  });
});
