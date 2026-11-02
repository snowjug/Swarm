/// <reference types="node" />

import { readFileSync } from 'node:fs';

// The colours of the design tokens in each theme, for the tests that hold them to a contrast ratio. Vitest replaces
// an imported stylesheet with an empty string, so the file is read as text. Tokens are hex colours or `rgb(r g b / a)`,
// by rule (tokens.css says so); a translucent one is composited over what can sit behind it before it is measured.

export type ThemeName = 'light' | 'dark' | 'high-contrast';
export const THEME_NAMES: readonly ThemeName[] = ['light', 'dark', 'high-contrast'];

/** The ratio a theme is held to for ordinary text: WCAG AA, and AAA in the high-contrast theme. */
export const minimumContrast = (theme: ThemeName): number => (theme === 'high-contrast' ? 7 : 4.5);

const tokenFile = new URL('../design/tokens.css', import.meta.url);
export const tokenCss = readFileSync(tokenFile, 'utf8').replaceAll('\r\n', '\n');

/** The custom properties declared by the first rule with this selector. */
export function declarations(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`No rule for ${selector}.`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start));
  const found = new Map<string, string>();
  for (const match of body.matchAll(/(--[\w-]+):\s*([^;]+);/gu)) {
    found.set(match[1]!, match[2]!.replace(/\/\*.*?\*\//gu, '').trim());
  }
  return found;
}

const rules: Record<ThemeName, string> = {
  light: ':root',
  dark: "[data-theme='dark']",
  'high-contrast': "[data-theme='high-contrast']",
};

const own: Record<ThemeName, Map<string, string>> = {
  light: declarations(tokenCss, rules.light),
  dark: declarations(tokenCss, rules.dark),
  'high-contrast': declarations(tokenCss, rules['high-contrast']),
};

/** Every token a theme has: its own, over the light ones that it does not set again. */
export const tokens: Record<ThemeName, Map<string, string>> = {
  light: own.light,
  dark: new Map([...own.light, ...own.dark]),
  'high-contrast': new Map([...own.light, ...own['high-contrast']]),
};

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parse(value: string): Rgba {
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/iu.exec(value);
  if (hex) {
    const raw = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join('') : hex[1]!;
    return {
      r: parseInt(raw.slice(0, 2), 16),
      g: parseInt(raw.slice(2, 4), 16),
      b: parseInt(raw.slice(4, 6), 16),
      a: 1,
    };
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:\s*[/,]\s*([\d.]+%?))?\s*\)$/iu.exec(value);
  if (rgb) {
    const alpha =
      rgb[4] === undefined
        ? 1
        : rgb[4].endsWith('%')
          ? Number.parseFloat(rgb[4]) / 100
          : Number(rgb[4]);
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: alpha };
  }
  throw new Error(`Not a hex or rgb() colour: ${value}`);
}

/** A token or a literal, followed through `var()` chains to the colour it is in a theme. */
export function resolve(value: string, theme: ThemeName): Rgba {
  let current = value.trim();
  for (let hops = 0; hops < 8; hops += 1) {
    const reference = /^var\((--[\w-]+)\)$/u.exec(current);
    if (!reference) break;
    const next = tokens[theme].get(reference[1]!);
    if (next === undefined)
      throw new Error(`${reference[1]} is not a token of the ${theme} theme.`);
    current = next;
  }
  return parse(current);
}

/** A colour laid over an opaque one. */
export function over(top: Rgba, under: Rgba): Rgba {
  const a = top.a + under.a * (1 - top.a);
  const mix = (t: number, u: number): number =>
    a === 0 ? 0 : (t * top.a + u * under.a * (1 - top.a)) / a;
  return { r: mix(top.r, under.r), g: mix(top.g, under.g), b: mix(top.b, under.b), a };
}

const linear = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
export const luminance = ({ r, g, b }: Rgba): number =>
  0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

/** The WCAG contrast ratio of two opaque colours, from 1 to 21. */
export function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The surfaces that something translucent can sit on: the page, and the lightest and darkest the ambient light makes it. */
export function backdrops(theme: ThemeName): { name: string; colour: Rgba }[] {
  return [
    { name: '--bg', colour: resolve('var(--bg)', theme) },
    { name: '--backdrop-lo', colour: resolve('var(--backdrop-lo)', theme) },
    { name: '--backdrop-hi', colour: resolve('var(--backdrop-hi)', theme) },
  ];
}

/**
 * The contrast of a foreground token on a surface token in a theme, over every backdrop the surface can sit on, and the
 * worst of them: a translucent foreground is laid over the surface first, and a translucent surface over the backdrop.
 */
export function worstContrast(
  theme: ThemeName,
  foreground: string,
  surface: string,
): { ratio: number; backdrop: string } {
  let worst = { ratio: Number.POSITIVE_INFINITY, backdrop: '' };
  for (const backdrop of backdrops(theme)) {
    const ground = over(resolve(surface, theme), backdrop.colour);
    const ink = over(resolve(foreground, theme), ground);
    const ratio = contrast(ink, ground);
    if (ratio < worst.ratio) worst = { ratio, backdrop: backdrop.name };
  }
  return worst;
}
