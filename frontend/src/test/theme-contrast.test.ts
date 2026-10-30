/// <reference types="node" />

import { describe, expect, it } from 'vitest';
import {
  PAGE_BACKGROUND,
  THEME_NAMES,
  colour,
  contrastIn,
  luminance,
  minimumContrast,
  tokens,
} from './palette';

// The contrast of the colours the interface is built from, in every theme, computed from the stylesheets
// themselves with the WCAG formula. The rendered pages are held to the same standard by axe in the browser
// (e2e/journey/themes.spec.ts); this fails first, and says which pair of colours it was.

describe.each(THEME_NAMES)('the %s theme', (theme) => {
  const strong = minimumContrast(theme);
  const pair = (foreground: string, background: string): number =>
    contrastIn(theme, foreground, background);

  it('keeps text readable on the panels and on the page', () => {
    expect(pair('var(--text)', 'var(--panel)')).toBeGreaterThanOrEqual(7);
    expect(pair('var(--muted)', 'var(--panel)')).toBeGreaterThanOrEqual(strong);
    expect(pair('var(--text)', PAGE_BACKGROUND)).toBeGreaterThanOrEqual(7);
    expect(pair('var(--muted)', PAGE_BACKGROUND)).toBeGreaterThanOrEqual(strong);
    expect(pair('var(--danger)', 'var(--panel)')).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the accent readable as text on the panels and on the page', () => {
    expect(pair('var(--orange)', 'var(--panel)')).toBeGreaterThanOrEqual(4.5);
    expect(pair('var(--orange)', PAGE_BACKGROUND)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps white text readable on the filled accent and on the contradicted badge', () => {
    expect(pair('var(--t-fg-ffffff)', 'var(--orange-fill)')).toBeGreaterThanOrEqual(strong);
    expect(pair('var(--t-fg-ffffff)', 'var(--contradicted-fill)')).toBeGreaterThanOrEqual(strong);
  });

  it('keeps every chart series and graph node visible against the chart surface', () => {
    const series = [1, 2, 3, 4, 5].map((n) => `var(--chart-${n})`);
    const nodes = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `var(--graph-${n})`);
    const marks = ['var(--graph-actor)', 'var(--graph-memory)', 'var(--chart-axis)'];
    // 3:1 is the bar for the parts of a graphic; the labels are text.
    for (const name of [...series, ...nodes, ...marks]) {
      expect(pair(name, 'var(--chart-surface)'), name).toBeGreaterThanOrEqual(3);
    }
    expect(pair('var(--chart-label)', 'var(--chart-surface)')).toBeGreaterThanOrEqual(strong);
  });

  it('is a different palette from the light one, with light text on dark surfaces', () => {
    if (theme === 'light') return;
    expect(colour('var(--panel)', theme)).not.toBe(colour('var(--panel)', 'light'));
    expect(colour('var(--text)', theme)).not.toBe(colour('var(--text)', 'light'));
    expect(luminance(colour('var(--text)', theme))).toBeGreaterThan(
      luminance(colour('var(--panel)', theme)),
    );
  });
});

describe('the token file', () => {
  it('defines every token in all three themes, the same ones in each', () => {
    const names = [...tokens.light.keys()].filter((name) => name.startsWith('--t-'));
    expect(names.length).toBeGreaterThan(150);
    for (const theme of THEME_NAMES) {
      expect([...tokens[theme].keys()].filter((name) => name.startsWith('--t-'))).toEqual(names);
    }
  });

  it('writes the colour in the name of every light token, so that nothing can drift from its name', () => {
    for (const [name, value] of tokens.light) {
      if (name.startsWith('--t-')) expect(value, name).toBe(`#${name.slice(-6)}`);
    }
  });
});
