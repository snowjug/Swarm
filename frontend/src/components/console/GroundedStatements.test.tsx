import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  CLAIM_KINDS,
  CLAIM_KIND_LABELS,
  CLAIM_KIND_MEANINGS,
  SUPPORT_VERDICTS,
  SUPPORT_VERDICT_LABELS,
} from '../../../../shared/grounding';
import { VERDICT_MEANINGS } from '../../lib/grounding';
import { expandElements, findButtons } from '../../test/elements';
import {
  allKindsAndVerdicts,
  claimFixture,
  modelReportFixture,
  reviewFixture,
} from '../../test/grounding';
import { fullReview, headings, renderReview, rowsOf } from '../../test/groundingView';
import { visibleText } from '../../test/provider';
import { GroundingReview } from './GroundingReview';

const hostile = '<img src=x onerror=alert(1)>';
const script = '<script>alert(1)</script>';

describe('statement rows', () => {
  it('shows a kind chip and a verdict badge, both as text, on every row', () => {
    const rows = rowsOf(renderReview(fullReview()));
    expect(rows).toHaveLength(7);
    for (const claim of allKindsAndVerdicts()) {
      const row = rows.find((item) => item.includes(`claim-id">${claim.id}</span>`))!;
      expect(row, claim.id).toContain(
        `<span class="claim-kind">${CLAIM_KIND_LABELS[claim.kind]}</span>`,
      );
      expect(row).toMatch(
        new RegExp(
          `verdict-badge verdict-${claim.verdict}">.*?</svg>${SUPPORT_VERDICT_LABELS[claim.verdict]}</span>`,
          'u',
        ),
      );
    }
    const kinds = new Set(rows.map((row) => /class="claim-kind">([^<]+)</u.exec(row)![1]));
    expect(kinds).toEqual(new Set(CLAIM_KINDS.map((kind) => CLAIM_KIND_LABELS[kind])));
    const verdicts = new Set(rows.map((row) => /verdict-badge verdict-(\w+)"/u.exec(row)![1]));
    expect(verdicts).toEqual(new Set(SUPPORT_VERDICTS));
  });

  it('gives unsupported and contradicted rows a left marker class, and no other row', () => {
    const classes = rowsOf(renderReview(fullReview())).map((row) => /^([^"]+)"/u.exec(row)![1]);
    expect(classes).toEqual([
      'claim-supported',
      'claim-partial',
      'claim-unchecked',
      'claim-unchecked',
      'claim-unsupported',
      'claim-supported',
      'claim-contradicted',
    ]);
  });

  it('shows the statement, the server reason, a labelled quote and the citations', () => {
    const html = renderReview(fullReview());
    const row = rowsOf(html).find((item) => item.includes('>C1</span>'))!;
    expect(row).toContain('<p class="claim-text">Synthetic source fact one.</p>');
    expect(visibleText(row)).toContain(
      'Why this verdict Reason one: the quote was found verbatim in S1.',
    );
    expect(row).toContain('<figcaption>Quoted from S1</figcaption>');
    expect(row).toContain('<blockquote>a verbatim excerpt of the passage</blockquote>');
    expect(visibleText(row)).toContain('Sources S1');
    const memoryRow = rowsOf(html).find((item) => item.includes('>C5</span>'))!;
    expect(visibleText(memoryRow)).toContain('Simulated memory M-3');
  });

  it('does not claim a quote came from a passage the server did not find it in', () => {
    const claims = [
      claimFixture({
        id: 'C1',
        kind: 'source-fact',
        sourceIds: ['S1', 'S2'],
        quote: 'copied text',
        checks: { quote: 'found', overlap: 1, numbers: null, entailment: null },
      }),
      claimFixture({
        id: 'C2',
        kind: 'source-fact',
        quote: 'altered text',
        checks: { quote: 'not-found', overlap: 0.2, numbers: null, entailment: null },
        verdict: 'unsupported',
      }),
    ];
    const html = renderReview(reviewFixture(claims));
    expect(html).toContain('<figcaption>Quoted from one of S1, S2</figcaption>');
    expect(html).toContain('<figcaption>Quote not found verbatim in S1</figcaption>');
  });

  it('says so when a statement cites no source and no simulated memory', () => {
    const row = rowsOf(renderReview(fullReview())).find((item) => item.includes('>C3</span>'))!;
    expect(row).toContain('No source or simulated memory is cited for this statement');
    expect(row).not.toContain('class="citations"');
  });

  it('opens the existing evidence inspector from a source or memory citation', () => {
    const onInspect = vi.fn();
    const tree = expandElements(
      <GroundingReview report={modelReportFixture(fullReview())} onInspect={onInspect} />,
    );
    const named = (label: string) =>
      findButtons(tree).filter((button) => visibleText(renderToStaticMarkup(button)) === label);
    named('S1')[0]!.props.onClick!();
    named('S2')[0]!.props.onClick!();
    named('M-3')[0]!.props.onClick!();
    expect(onInspect.mock.calls).toEqual([
      [{ kind: 'source', id: 'S1' }],
      [{ kind: 'source', id: 'S2' }],
      [{ kind: 'memory', id: 'M-3' }],
    ]);
  });
});

describe('legend', () => {
  it('is a collapsed native details element in the page, not a tooltip', () => {
    const html = renderReview(fullReview());
    expect(html).toContain(
      '<details class="record-details grounding-legend"><summary>What the kinds and verdicts mean</summary>',
    );
    expect(html).not.toMatch(/<details[^>]*\sopen/u);
    expect(html.match(/<summary>/gu)).toHaveLength(1);
  });

  it('explains every kind and every verdict', () => {
    const legend = /<details class="record-details grounding-legend">([\s\S]*?)<\/details>/u.exec(
      renderReview(fullReview()),
    )![1]!;
    const text = visibleText(legend);
    for (const kind of CLAIM_KINDS) {
      expect(text).toContain(`${CLAIM_KIND_LABELS[kind]} ${CLAIM_KIND_MEANINGS[kind]}`);
    }
    for (const verdict of SUPPORT_VERDICTS) {
      expect(text).toContain(`${SUPPORT_VERDICT_LABELS[verdict]} ${VERDICT_MEANINGS[verdict]}`);
    }
    expect(text).toContain('It does not show that the passage itself is true.');
  });

  it('is present even when no statement is contradicted or listed', () => {
    expect(renderReview(reviewFixture([]))).toContain('grounding-legend');
  });
});

describe('figures with nothing behind them and the notes', () => {
  it('lists the chapter and the figures, with the reason they matter', () => {
    const html = renderReview(
      fullReview({
        unverifiedFigures: [
          { section: 'Chapter two', figures: ['41%', '3.5 million'] },
          { section: 'Chapter one', figures: ['12'] },
        ],
      }),
    );
    expect(headings(html).map((item) => item.text)).toContain('Figures with nothing behind them');
    expect(visibleText(html)).toContain(
      'These figures appear in chapter text but in neither the cited passages nor the recorded simulation, so they may be invented.',
    );
    expect(html).toContain('<li><strong>Chapter two</strong>: <span>41%, 3.5 million</span></li>');
    expect(html).toContain('<li><strong>Chapter one</strong>: <span>12</span></li>');
    expect(html).toContain('<ul aria-labelledby="grounding-figures-title">');
  });

  it('is absent when every figure is accounted for', () => {
    expect(renderReview(fullReview())).not.toContain('Figures with nothing behind them');
  });

  it('renders each note as a plain list item under "What was and was not checked"', () => {
    const notes = [
      'The independent model check did not complete (MODEL_TIMEOUT); every verdict uses the deterministic checks only.',
      'A citation proves where a statement says it came from, not that the source is true.',
    ];
    const html = renderReview(fullReview({ notes }));
    const block = /<div class="grounding-notes">([\s\S]*?)<\/div>/u.exec(html)![1]!;
    expect(headings(block)).toEqual([{ level: 3, text: 'What was and was not checked' }]);
    expect([...block.matchAll(/<li>([\s\S]*?)<\/li>/gu)].map((match) => match[1])).toEqual(notes);
  });

  it('is absent when the server recorded no notes', () => {
    expect(renderReview(fullReview())).not.toContain('What was and was not checked');
  });
});

describe('server text is inert and long text stays whole', () => {
  it('renders hostile strings from every field as text', () => {
    const claims = [
      claimFixture({
        id: 'C1',
        kind: 'source-fact',
        section: hostile,
        text: hostile,
        reason: script,
        quote: `${hostile}${script}`,
        checks: { quote: 'found', overlap: 1, numbers: null, entailment: null },
      }),
      claimFixture({
        id: 'C2',
        verdict: 'contradicted',
        section: hostile,
        text: script,
        reason: hostile,
      }),
    ];
    const html = renderReview(
      reviewFixture(claims, {
        notes: [hostile, script],
        unverifiedFigures: [{ section: hostile, figures: [hostile, script] }],
      }),
      { titles: [hostile] },
    );
    expect(html).not.toMatch(/<img\b/u);
    expect(html).not.toMatch(/<script\b/u);
    expect(html).not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/iu);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('keeps very long unbroken text complete in every field', () => {
    const long = 'unbroken'.repeat(500);
    const claim = claimFixture({
      id: 'C1',
      kind: 'source-fact',
      section: long,
      text: long,
      reason: `${long}-reason`,
      quote: `${long}-quote`,
      sourceIds: ['S1'],
      checks: { quote: 'found', overlap: 1, numbers: null, entailment: null },
    });
    const html = renderReview(
      reviewFixture([claim], {
        notes: [long],
        unverifiedFigures: [{ section: long, figures: [long] }],
      }),
      { titles: [long] },
    );
    expect(html).toContain(`<p class="claim-text">${long}</p>`);
    expect(html).toContain(`${long}-reason`);
    expect(html).toContain(`<blockquote>${long}-quote</blockquote>`);
    expect(html).toContain(`<h3 id="grounding-group-0">${long}</h3>`);
    expect(html).toContain(`<li>${long}</li>`);
    expect(html).toContain(`<strong>${long}</strong>`);
  });
});

describe('structure for keyboards and assistive technology', () => {
  const rich = () =>
    fullReview({
      unverifiedFigures: [{ section: 'Chapter two', figures: ['41%'] }],
      notes: ['A note.'],
      method: 'deterministic',
    });

  it('starts at level 2 and never skips a heading level', () => {
    const levels = headings(renderReview(rich())).map((item) => item.level);
    expect(levels[0]).toBe(2);
    levels.forEach((level, index) => {
      if (index > 0) expect(level - levels[index - 1]!).toBeLessThanOrEqual(1);
    });
    expect(levels.filter((level) => level === 1)).toHaveLength(0);
  });

  it('only refers to labels that exist', () => {
    const html = renderReview(rich());
    const references = [...html.matchAll(/aria-labelledby="([^"]+)"/gu)].map((match) => match[1]!);
    expect(references.length).toBeGreaterThanOrEqual(5);
    for (const id of references)
      expect(html.match(new RegExp(`id="${id}"`, 'gu')), id).toHaveLength(1);
  });

  it('uses native controls only: type=button chips and one summary', () => {
    const html = renderReview(rich());
    const buttons = [...html.matchAll(/<button\b[^>]*>/gu)].map((match) => match[0]);
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((tag) => tag.includes('type="button"'))).toBe(true);
    expect(html).not.toMatch(/tabindex=|role="button"|href=|role="tab"/u);
  });

  it('never uses a name that differs from the visible text', () => {
    expect(renderReview(rich())).not.toMatch(/<(?:button|summary|a)\b[^>]*aria-label=/u);
  });

  it('keeps nothing behind a hover: no tooltips, hidden-until-hover text or descriptions', () => {
    const html = renderReview(rich()).replace(/ title="Find source excerpt S\d+"/gu, '');
    expect(html).not.toMatch(/\stitle=|data-tooltip|aria-describedby|<abbr|<dialog|popover/u);
    for (const verdict of SUPPORT_VERDICTS) {
      expect(visibleText(html)).toContain(VERDICT_MEANINGS[verdict]);
    }
  });
});
