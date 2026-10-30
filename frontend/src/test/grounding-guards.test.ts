/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SUPPORT_VERDICTS } from '../../../shared/grounding';
import { THEME_NAMES, colour, contrastIn, minimumContrast } from './palette';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const rootStyles = read('../styles.css');
const grounding = read('../styles/grounding.css');
const statements = read('../styles/statements.css');
const transparency = read('../styles/transparency.css');

const ruleBody = (css: string, selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'u').exec(css)?.[1];
};

describe('verdict colours', () => {
  it.each(THEME_NAMES)(
    'keeps every verdict label readable on its own tint and on the report page in the %s theme',
    (theme) => {
      for (const verdict of SUPPORT_VERDICTS) {
        const ink = `var(--verdict-${verdict})`;
        const tint = `var(--verdict-${verdict}-tint)`;
        expect(contrastIn(theme, ink, tint), `${verdict} on tint`).toBeGreaterThanOrEqual(
          minimumContrast(theme),
        );
        expect(
          contrastIn(theme, ink, 'var(--panel)'),
          `${verdict} on the page`,
        ).toBeGreaterThanOrEqual(minimumContrast(theme));
        expect(contrastIn(theme, 'var(--text)', tint), `text on ${verdict}`).toBeGreaterThanOrEqual(
          minimumContrast(theme),
        );
      }
    },
  );

  it.each(THEME_NAMES)('keeps the filled contradicted badge readable in the %s theme', (theme) => {
    const rule = ruleBody(statements, '.verdict-badge.verdict-contradicted')!;
    const ink = /(?:^|\s)color:\s*(var\(--[\w-]+\));/u.exec(rule)?.[1];
    const fill = /(?:^|\s)background:\s*(var\(--[\w-]+\));/u.exec(rule)?.[1];
    expect(ink, 'the badge sets its text colour').toBeDefined();
    expect(fill, 'the badge sets its fill').toBeDefined();
    expect(colour(ink!, theme)).toBeDefined();
    expect(contrastIn(theme, ink!, fill!)).toBeGreaterThanOrEqual(minimumContrast(theme));
  });

  it('defines a badge, a tally colour and a distinct shape cue for every verdict', () => {
    for (const verdict of SUPPORT_VERDICTS) {
      expect(ruleBody(statements, `.verdict-badge.verdict-${verdict}`), verdict).toBeDefined();
      expect(ruleBody(grounding, `.tally-${verdict}`), verdict).toBeDefined();
    }
    expect(ruleBody(statements, '.verdict-badge.verdict-unchecked')).toContain(
      'border-style: dashed',
    );
  });

  it('marks unsupported and contradicted rows with a visible left marker of a different style', () => {
    const unsupported = ruleBody(statements, '.claim-unsupported')!;
    const contradicted = ruleBody(statements, '.claim-contradicted')!;
    expect(unsupported).toMatch(/border-left:\s*[4-9]px dashed/u);
    expect(contradicted).toMatch(/border-left:\s*[4-9]px solid/u);
  });
});

describe('grounding and transparency styles', () => {
  const styles = [
    ['grounding.css', grounding],
    ['statements.css', statements],
    ['transparency.css', transparency],
  ] as const;

  it('wraps long text instead of scrolling or clipping it', () => {
    const wrapped = [
      [grounding, '.grounding-review h2'],
      [grounding, '.grounding-facts dd'],
      [grounding, '.grounding-empty'],
      [grounding, '.grounding-figures li'],
      [grounding, '.grounding-notes li'],
      [statements, '.claim-text'],
      [statements, '.claim-reason'],
      [statements, '.quote-block blockquote'],
      [statements, '.quote-block figcaption'],
      [statements, '.legend-list dd'],
      [transparency, '.stated-reason p'],
      [transparency, '.proxy-assumptions li'],
    ] as const;
    for (const [css, selector] of wrapped) {
      expect(ruleBody(css, selector), selector).toContain('overflow-wrap: anywhere');
    }
    for (const [name, css] of styles) {
      expect(css, name).not.toMatch(
        /overflow(?:-x)?:\s*(?:auto|scroll|hidden)|text-overflow|line-clamp/u,
      );
    }
  });

  it('never overlays stage content: no positioned, sticky or stacked elements', () => {
    for (const [name, css] of styles) {
      expect(css, name).not.toMatch(/position:|z-index:|transform:/u);
    }
  });

  it('keeps nothing behind a hover or focus: no hover rules and nothing hidden', () => {
    for (const [name, css] of styles) {
      expect(css, name).not.toMatch(
        /:hover|:focus-within|display:\s*none|visibility:\s*hidden|opacity:\s*0\b/u,
      );
    }
  });

  it('lets grid columns shrink so nothing forces a horizontal scroll at 390px', () => {
    expect(statements).toMatch(
      /grid-template-columns:\s*minmax\(0,\s*max-content\)\s*minmax\(0,\s*1fr\)/u,
    );
    const narrowLegend = statements.slice(statements.indexOf('@media (max-width: 640px)'));
    expect(narrowLegend).toMatch(
      /\.legend-list\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/u,
    );
    const narrowFacts = grounding.slice(grounding.indexOf('@media (max-width: 640px)'));
    expect(narrowFacts).toMatch(
      /\.grounding-facts > div\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/u,
    );
  });

  it('is loaded by the application stylesheet', () => {
    for (const name of ['grounding', 'statements', 'transparency']) {
      expect(rootStyles).toContain(`@import './styles/${name}.css';`);
    }
  });
});

describe('new components never interpret server text as markup or hide it', () => {
  const files = [
    'GroundingReview',
    'GroundedStatement',
    'GroundingLegend',
    'Verdict',
    'QuoteBlock',
    'StatedReason',
    'ProxyAssumptions',
  ];
  for (const name of files) {
    it(`${name}.tsx renders plain text, with no tooltip, live region or renamed control`, () => {
      const source = read(`../components/console/${name}.tsx`);
      expect(source).not.toMatch(
        /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|document\.write/u,
      );
      expect(source).not.toMatch(/\btitle=|aria-label=|aria-live|role="alert"|role="status"/u);
      expect(source).not.toMatch(/onMouse(?:Enter|Over|Leave)|onPointer(?:Enter|Over)|onFocus/u);
    });
  }
});
