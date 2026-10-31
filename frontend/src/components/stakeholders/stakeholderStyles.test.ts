/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PAGE_BACKGROUND,
  THEME_NAMES,
  colour,
  contrast,
  minimumContrast,
} from '../../test/palette';

// The accessibility audit of the console reads a fixed list of stylesheets. This one holds the
// stakeholder stylesheet to the same rules: text of 12px or more, text colours readable on the
// surface they sit on in every theme, and colours from the theme's own tokens, never a raw value.
const css = readFileSync(
  new URL('../../styles/stakeholders.css', import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n');

/** Properties that are fonts, not colours. */
const NOT_COLOURS = new Set(['--mono']);

describe('the stakeholder stylesheet', () => {
  it('has no text below 12 CSS pixels', () => {
    const sizes = [...css.matchAll(/font(?:-size)?:\s*(?:italic\s+)?([\d.]+)px/gu)];
    expect(sizes.length).toBeGreaterThan(5);
    for (const match of sizes) expect(Number(match[1]), match[0]).toBeGreaterThanOrEqual(12);
  });

  it('paints only with the theme’s tokens, and every token it names exists in every theme', () => {
    expect(css).not.toMatch(/#[\da-f]{3,8}\b/iu);
    expect(css).not.toMatch(/\b(?:rgb|rgba|hsl|hsla)\(/iu);
    const used = new Set([...css.matchAll(/var\((--[\w-]+)\)/gu)].map((match) => match[1]!));
    expect(used.size).toBeGreaterThan(8);
    for (const property of used) {
      if (NOT_COLOURS.has(property)) continue;
      for (const theme of THEME_NAMES) {
        expect(() => colour(`var(${property})`, theme), `${property} in ${theme}`).not.toThrow();
      }
    }
  });

  it.each(THEME_NAMES)(
    'keeps every declared text colour readable on its surface in the %s theme',
    (theme) => {
      let pairs = 0;
      for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
        const selector = match[1]!.trim();
        const body = match[2]!;
        const foreground = /(?:^|;|\s)color:\s*(var\(--[\w-]+\))/iu.exec(body)?.[1];
        if (!foreground) continue;
        const surface =
          /(?:^|;|\s)background(?:-color)?:\s*(var\(--[\w-]+\))/iu.exec(body)?.[1] ??
          PAGE_BACKGROUND;
        expect(
          contrast(colour(foreground, theme), colour(surface, theme)),
          `${selector}: ${foreground} on ${surface}`,
        ).toBeGreaterThanOrEqual(minimumContrast(theme));
        pairs += 1;
      }
      expect(pairs).toBeGreaterThan(5);
    },
  );

  it('puts a chip’s text on the chip’s own background, since the page behind it may differ', () => {
    for (const selector of ['.stk-pill', '.stk-pill-you', '.stk-origin', '.stk-origin-evidence']) {
      const rule = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'u').exec(
        css,
      )?.[1];
      expect(rule, selector).toBeDefined();
      expect(rule, selector).toMatch(/background:/u);
    }
  });
});
