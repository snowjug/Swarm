/// <reference types="node" />

import { readdirSync, readFileSync } from 'node:fs';

// The colours the stylesheets resolve to in each theme, for the tests that hold them to a contrast ratio.
// Vitest replaces an imported stylesheet with an empty string, so the files are read as text.

export type ThemeName = 'light' | 'dark' | 'high-contrast';
export const THEME_NAMES: readonly ThemeName[] = ['light', 'dark', 'high-contrast'];

/** The ratio a theme is held to for ordinary text: WCAG AA, and AAA in the high-contrast theme. */
export const minimumContrast = (theme: ThemeName): number => (theme === 'high-contrast' ? 7 : 4.5);

const sourceRoot = new URL('../', import.meta.url);
const stylesRoot = new URL('styles/', sourceRoot);
const read = (url: URL): string => readFileSync(url, 'utf8').replaceAll('\r\n', '\n');

export const baseStyles = read(new URL('styles.css', sourceRoot));
const tokenStyles = read(new URL('theme-tokens.css', stylesRoot));

/** The custom properties declared by the first rule with this selector. */
export function declarations(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`No rule for ${selector}.`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start));
  const found = new Map<string, string>();
  for (const match of body.matchAll(/(--[\w-]+):\s*([^;]+);/gu)) {
    found.set(match[1]!, match[2]!.trim());
  }
  return found;
}

/** The colour tokens (`--t-…`) of each theme: the hex values themselves. */
export const tokens: Record<ThemeName, Map<string, string>> = {
  light: declarations(tokenStyles, ':root'),
  dark: declarations(tokenStyles, "[data-theme='dark']"),
  'high-contrast': declarations(tokenStyles, "[data-theme='high-contrast']"),
};

/** The custom properties the stylesheets define in terms of tokens: `--text`, `--panel`, `--chart-1` and so on. */
const semantic = new Map<string, string>();
for (const name of readdirSync(stylesRoot)) {
  if (!name.endsWith('.css') || name === 'theme-tokens.css') continue;
  const css = read(new URL(name, stylesRoot));
  if (css.includes(':root {')) {
    for (const [property, value] of declarations(css, ':root')) semantic.set(property, value);
  }
}
for (const [property, value] of declarations(baseStyles, ':root')) semantic.set(property, value);

/** The colour a value is in a theme: a `var()` chain followed to its token, or a hex colour as written. */
export function colour(value: string, theme: ThemeName): string {
  let current = value.trim();
  for (let hops = 0; hops < 8; hops += 1) {
    const reference = /^var\((--[\w-]+)\)$/u.exec(current);
    if (!reference) break;
    const next = tokens[theme].get(reference[1]!) ?? semantic.get(reference[1]!);
    if (next === undefined) throw new Error(`${reference[1]} is not defined by any stylesheet.`);
    current = next;
  }
  if (!/^#(?:[\da-f]{3}|[\da-f]{6})$/iu.test(current)) {
    throw new Error(
      `${value} does not resolve to an opaque colour in the ${theme} theme: ${current}`,
    );
  }
  return current.toLowerCase();
}

/** What the page is painted with: the `background` of the root rule. */
export const PAGE_BACKGROUND = ((): string => {
  const root = baseStyles.slice(baseStyles.indexOf(':root {'), baseStyles.indexOf('\n}'));
  const match = /(?:^|\s)background:\s*(var\(--[\w-]+\));/u.exec(root);
  if (!match) throw new Error('The root rule of styles.css has no background.');
  return match[1]!;
})();

export function luminance(hex: string): number {
  const raw = hex.slice(1);
  const expanded =
    raw.length === 3
      ? raw
          .split('')
          .map((part) => part + part)
          .join('')
      : raw;
  const [red, green, blue] = [0, 2, 4].map((offset) => {
    const value = Number.parseInt(expanded.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return red! * 0.2126 + green! * 0.7152 + blue! * 0.0722;
}

export function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** The contrast of two values (hex colours or `var()` references) in a theme. */
export const contrastIn = (theme: ThemeName, foreground: string, background: string): number =>
  contrast(colour(foreground, theme), colour(background, theme));
