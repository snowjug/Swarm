/// <reference types="node" />

import { describe, expect, it } from 'vitest';
import {
  THEME_NAMES,
  minimumContrast,
  tokens,
  worstContrast,
  type ThemeName,
} from './design-palette';

// The contrast of the colours the interface is built from, in every theme, computed from tokens.css itself with the
// WCAG formula and with every translucent surface laid over the lightest and darkest backdrop it can sit on. The rendered
// pages are held to the same standard by axe in the browser (e2e); this fails first, and says which pair it was.

const SURFACES = [
  '--bg',
  '--bg-raised',
  '--bg-sunk',
  '--glass',
  '--glass-raised',
  '--glass-overlay',
] as const;
const INKS = ['--ink', '--ink-2', '--ink-3'] as const;
const MEANING = ['--c-against', '--c-favor', '--c-neutral', '--c-caution', '--c-critical'] as const;
const CATEGORIES = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `--cat-${n}`);

describe.each(THEME_NAMES)('the %s theme', (theme: ThemeName) => {
  const strong = minimumContrast(theme);
  const ratio = (foreground: string, surface: string): number =>
    worstContrast(theme, `var(${foreground})`, `var(${surface})`).ratio;

  it('keeps text readable on the page and on every surface, translucent ones over any backdrop', () => {
    for (const ink of INKS) {
      for (const surface of SURFACES) {
        expect(ratio(ink, surface), `${ink} on ${surface}`).toBeGreaterThanOrEqual(strong);
      }
    }
    for (const surface of SURFACES)
      expect(ratio('--ink', surface), `--ink on ${surface}`).toBeGreaterThanOrEqual(7);
  });

  it('keeps the accent readable as text and as a filled control', () => {
    for (const surface of SURFACES)
      expect(ratio('--accent', surface), `--accent on ${surface}`).toBeGreaterThanOrEqual(strong);
    expect(ratio('--accent-strong', '--bg')).toBeGreaterThanOrEqual(strong);
    // The label of a filled accent button.
    expect(ratio('--accent-ink', '--accent'), 'label on --accent').toBeGreaterThanOrEqual(strong);
  });

  it('keeps the colours of meaning readable as text on the page and on glass', () => {
    for (const colour of MEANING) {
      for (const surface of ['--bg', '--glass', '--glass-overlay'] as const) {
        expect(ratio(colour, surface), `${colour} on ${surface}`).toBeGreaterThanOrEqual(strong);
      }
    }
  });

  it('keeps a chip readable: its colour on its own tint', () => {
    const tints = {
      '--c-against': '--c-against-soft',
      '--c-favor': '--c-favor-soft',
      '--c-neutral': '--c-neutral-soft',
      '--c-caution': '--c-caution-soft',
      '--c-critical': '--c-critical-soft',
      '--accent': '--accent-soft',
    } as const;
    for (const [colour, tint] of Object.entries(tints)) {
      // The tint is laid over glass, which is laid over the backdrop.
      const worst = ['--bg', '--glass', '--glass-overlay'].map((surface) => {
        const first = worstContrast(theme, `var(${colour})`, `var(${tint})`).ratio;
        return Math.min(first, ratio(colour, surface));
      });
      for (const value of worst)
        expect(value, `${colour} on ${tint}`).toBeGreaterThanOrEqual(strong);
    }
  });

  it('keeps every data colour visible as a graphic on the page and on glass', () => {
    // 3:1 is the bar for the parts of a graphic; their labels are text, held to the figures above.
    for (const colour of [...MEANING, ...CATEGORIES, '--accent', '--focus-ring']) {
      for (const surface of ['--bg', '--bg-raised', '--glass', '--glass-overlay'] as const) {
        expect(ratio(colour, surface), `${colour} on ${surface}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('keeps the edge of a surface and a rule visible', () => {
    // A hairline is decoration; the strong one is what a control or a divider that carries meaning is drawn in.
    expect(ratio('--hairline-strong', '--bg')).toBeGreaterThanOrEqual(
      theme === 'high-contrast' ? 3 : 1.25,
    );
  });
});

describe('the themes', () => {
  it('define the same tokens in each, so that no theme falls back to another by accident', () => {
    const names = [...tokens.light.keys()]
      .filter((name) =>
        /^--(?:bg|ink|glass|accent|c-|cat-|hairline|focus|backdrop|scrim)/u.test(name),
      )
      .sort();
    expect(names.length).toBeGreaterThan(40);
    for (const theme of ['dark', 'high-contrast'] as const) {
      const own = [...tokens[theme].keys()].filter((name) => names.includes(name)).sort();
      expect(own).toEqual(names);
    }
  });

  it('are different palettes: light text on dark surfaces in dark and high-contrast', () => {
    for (const theme of ['dark', 'high-contrast'] as const) {
      expect(tokens[theme].get('--bg')).not.toBe(tokens.light.get('--bg'));
      expect(tokens[theme].get('--ink')).not.toBe(tokens.light.get('--ink'));
    }
  });

  it('make the high-contrast theme opaque: no translucent surface, no blur', () => {
    for (const name of ['--glass', '--glass-raised', '--glass-overlay', '--glass-tint']) {
      expect(tokens['high-contrast'].get(name), name).toMatch(/^#[\da-f]{6}$/iu);
    }
    expect(tokens['high-contrast'].get('--blur-md')).toBe('0px');
  });
});
