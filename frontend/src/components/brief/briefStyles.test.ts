/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { THEME_NAMES, colour, contrastIn, minimumContrast } from '../../test/palette';

// The decision brief's stylesheet is held to the same rules as the rest of the interface: colours only
// from the theme variables, no text below 12 pixels, readable pairs in every theme, a visible focus, a
// layout for a narrow screen and one for the printed page.
const css = readFileSync(new URL('../../styles/brief.css', import.meta.url), 'utf8')
  .replaceAll('\r\n', '\n')
  .replaceAll(/\/\*[\s\S]*?\*\//gu, '');

interface Rule {
  selector: string;
  body: string;
}
const rules: Rule[] = [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/gu)].map((match) => ({
  selector: match[1]!.trim(),
  body: match[2]!,
}));
const declared = (body: string, property: string): string | undefined =>
  new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+)`, 'u').exec(body)?.[1]?.trim();

describe('the brief stylesheet', () => {
  it('has rules to read', () => {
    expect(rules.length).toBeGreaterThan(80);
  });

  it('takes every colour from the theme variables, never a literal', () => {
    expect(css).not.toMatch(/#[\da-f]{3,8}\b/iu);
    expect(css).not.toMatch(/\b(?:rgba?|hsla?|oklch|color-mix)\(/iu);
    for (const rule of rules) {
      for (const property of ['color', 'background', 'background-color', 'border-color']) {
        const value = declared(rule.body, property);
        if (value) expect(value, `${rule.selector} ${property}`).toMatch(/^var\(--[\w-]+\)$/u);
      }
      for (const border of rule.body.matchAll(/border(?:-[a-z]+)?:\s*([^;]+);/gu)) {
        const withoutVariables = border[1]!.replaceAll(/var\(--[\w-]+\)/gu, '');
        expect(withoutVariables, `${rule.selector} border`).not.toMatch(/#|rgb|hsl/u);
        expect(withoutVariables, `${rule.selector} border`).not.toMatch(
          /\b(?:black|white|red|green|blue|gray|grey|orange)\b/iu,
        );
      }
    }
  });

  it('has no text below 12 CSS pixels', () => {
    for (const match of css.matchAll(/font(?:-size)?:\s*(?:italic\s+)?([\d.]+)px/gu)) {
      expect(Number(match[1]), match[0]).toBeGreaterThanOrEqual(12);
    }
  });

  it.each(THEME_NAMES)(
    'keeps every declared text colour readable on its surface in the %s theme',
    (theme) => {
      let pairs = 0;
      for (const rule of rules) {
        const foreground = declared(rule.body, 'color');
        if (!foreground) continue;
        const background =
          declared(rule.body, 'background') ??
          declared(rule.body, 'background-color') ??
          'var(--panel)';
        expect(
          contrastIn(theme, foreground, background),
          `${rule.selector}: ${foreground} on ${background}`,
        ).toBeGreaterThanOrEqual(minimumContrast(theme));
        pairs += 1;
      }
      expect(pairs).toBeGreaterThan(12);
    },
  );

  it.each(THEME_NAMES)(
    'keeps every bar and mark visible against the chart surface in the %s theme',
    (theme) => {
      const marks = rules.filter((rule) => /\.brief-(?:seg|fill|diverge)-/u.test(rule.selector));
      expect(marks.length).toBeGreaterThanOrEqual(10);
      for (const rule of marks) {
        const fill = declared(rule.body, 'background');
        if (!fill) continue;
        // 3:1 is the bar for the parts of a graphic; every bar also has a label and a table.
        expect(
          contrastIn(theme, fill, 'var(--chart-surface)'),
          `${rule.selector}: ${fill}`,
        ).toBeGreaterThanOrEqual(3);
      }
      for (const name of [
        '--verdict-supported',
        '--chart-2',
        '--verdict-unchecked',
        '--verdict-partial',
        '--chart-3',
        '--verdict-contradicted',
      ]) {
        expect(colour(`var(${name})`, theme)).toMatch(/^#[\da-f]{6}$/u);
      }
    },
  );

  it('never removes the focus ring, and lays out for a narrow screen and for the printed page', () => {
    expect(css).not.toMatch(/outline:\s*(?:none|0)\b/u);
    expect(css).toContain('@media (max-width: 640px)');
    expect(css).toContain('@media print');
    expect(css).toContain('print-color-adjust: exact');
    expect(css).toContain('break-inside: avoid');
  });

  it('lets wide tables scroll inside their own region instead of breaking the page', () => {
    const scroll = rules.find((rule) => rule.selector === '.brief-scroll');
    expect(declared(scroll?.body ?? '', 'overflow-x')).toBe('auto');
    expect(declared(scroll?.body ?? '', 'max-width')).toBe('100%');
  });
});
