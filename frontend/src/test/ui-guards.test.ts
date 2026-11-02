/// <reference types="node" />

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The rules the design system keeps, held by reading every stylesheet and source of the interface. They are the
// ones a person could break by writing one more rule in a hurry: a type size below the floor, a rule outside the
// cascade layers, motion that ignores what the person asked for, a class that is not ours. Each test lists every
// offender it finds, not the first, so that one run is enough to fix a stylesheet.

const source = fileURLToPath(new URL('..', import.meta.url));
/** The interface that was replaced is gone, and nothing may bring back an import of it. */

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory())
      return entry === 'test' || entry === 'node_modules' ? [] : walk(path);
    return [path];
  });
}

const all = walk(source);
const styles = all.filter((path) => path.endsWith('.css'));
const code = all.filter((path) => /\.tsx?$/u.test(path) && !/\.test\.tsx?$/u.test(path));
const text = (path: string): string => readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
const name = (path: string): string => relative(source, path);
/** Comments are blanked, not removed, so that what is left keeps its line numbers. */
const stripComments = (css: string): string =>
  css.replace(/\/\*[^]*?\*\//gu, (comment) => comment.replace(/[^\n]/gu, ' '));
const lineOf = (css: string, index: number): number => css.slice(0, index).split('\n').length;

const TOKENS = 'design/tokens.css';
const BASE = 'design/base.css';

/** The top-level blocks of a stylesheet, as `[prelude, body]`, with braces matched. */
function topLevel(css: string): [string, string][] {
  const found: [string, string][] = [];
  let depth = 0;
  let start = 0;
  let open = -1;
  for (let index = 0; index < css.length; index += 1) {
    const char = css[index];
    if (char === '{') {
      if (depth === 0) open = index;
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        found.push([css.slice(start, open).trim(), css.slice(open + 1, index)]);
        start = index + 1;
      }
    } else if (char === ';' && depth === 0) {
      start = index + 1;
    }
  }
  return found;
}

/** Every `@keyframes` block of a stylesheet, wherever it nests, as `[name, body]`. */
function keyframesOf(css: string): [string, string][] {
  const found: [string, string][] = [];
  const visit = (block: string): void => {
    for (const [prelude, body] of topLevel(block)) {
      if (prelude.startsWith('@keyframes'))
        found.push([prelude.slice('@keyframes'.length).trim(), body]);
      else if (prelude.startsWith('@')) visit(body);
    }
  };
  visit(css);
  return found;
}

describe('the interface that is checked', () => {
  it('finds the stylesheets and sources it is meant to guard', () => {
    expect(styles.length).toBeGreaterThan(30);
    expect(code.length).toBeGreaterThan(100);
    const have = new Set(styles.map(name));
    for (const part of [
      TOKENS,
      BASE,
      'app/shell.css',
      'scenes/map/map.css',
      'viz/ecosystem/Ecosystem.css',
    ]) {
      expect(have.has(part), part).toBe(true);
    }
  });
});

describe('type', () => {
  it('has no text below 12 CSS pixels, in any stylesheet', () => {
    const offenders: string[] = [];
    for (const path of styles) {
      const css = stripComments(text(path));
      // `em` and `%` depend on what they sit in and are not measured; a size in px or rem is the size.
      for (const match of css.matchAll(
        /font(?:-size)?:\s*(?:italic\s+|\d{3}\s+)*([\d.]+)(px|rem)\b/gu,
      )) {
        const pixels = match[2] === 'px' ? Number(match[1]) : Number(match[1]) * 16;
        if (pixels < 12) offenders.push(`${name(path)}:${lineOf(css, match.index)} ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the floor of the type scale at 12 pixels', () => {
    expect(text(join(source, TOKENS))).toMatch(/--fs-micro:\s*0\.75rem/u);
  });
});

describe('the cascade', () => {
  it('puts every rule of every stylesheet in a layer, so that order never depends on where a file is imported', () => {
    const offenders: string[] = [];
    const layered = /^@(?:layer|keyframes|font-face|property|import|charset)\b/u;
    for (const path of styles) {
      const tokens = name(path) === TOKENS;
      for (const [prelude] of topLevel(stripComments(text(path)))) {
        // Tokens are plain custom properties and are the one file that needs no layer (design/index.css says so).
        const fine =
          layered.test(prelude) || (tokens && /^(?::root|\[data-|@media|@supports)/u.test(prelude));
        if (!fine) offenders.push(`${name(path)}: ${prelude.slice(0, 70)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('declares nothing but custom properties in the tokens file, which has no layer to keep order', () => {
    const css = stripComments(text(join(source, TOKENS)));
    const offenders = [...css.matchAll(/^\s+([a-z][a-z-]*)\s*:/gmu)]
      .map((match) => match[1]!)
      .filter(
        (property) => !['color-scheme', 'syntax', 'inherits', 'initial-value'].includes(property),
      );
    expect(offenders).toEqual([]);
  });

  it('has no !important apart from the utility that hides things and the fallback that stops motion', () => {
    const offenders: string[] = [];
    for (const path of styles) {
      const css = stripComments(text(path));
      for (const match of css.matchAll(/!important/gu)) {
        if (name(path) !== BASE) offenders.push(`${name(path)}:${lineOf(css, match.index)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('prefixes every class with sw-, apart from is- states and the two utilities', () => {
    const offenders = new Set<string>();
    for (const path of styles) {
      // The design gallery is a development page that no build includes, and is the one place with its own names.
      if (name(path) === 'design/gallery.css') continue;
      const css = stripComments(text(path))
        .replace(/"[^"]*"|'[^']*'/gu, '""')
        .replace(/\{[^{}]*\}/gu, ' {}');
      for (const match of css.matchAll(/\.([a-zA-Z_][\w-]*)/gu)) {
        const cls = match[1]!;
        if (!/^(?:sw-|is-|sr-only$|num$)/u.test(cls)) offenders.add(`${name(path)}: .${cls}`);
      }
    }
    expect([...offenders]).toEqual([]);
  });
});

describe('motion', () => {
  const base = text(join(source, BASE));
  const tokens = text(join(source, TOKENS));

  it('animates only what costs no layout, in every keyframe', () => {
    const layout =
      /^(?:width|height|min-|max-|top|right|bottom|left|inset|margin|padding|gap|flex|grid|font|line-height|letter-spacing|border(?:-[a-z]+)?-width|display|position)/u;
    const offenders: string[] = [];
    for (const path of styles) {
      for (const [animation, frames] of keyframesOf(stripComments(text(path)))) {
        for (const property of frames.matchAll(/([a-z-]+)\s*:/gu)) {
          if (layout.test(property[1]!))
            offenders.push(`${name(path)} @keyframes ${animation}: ${property[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('stops animation and transition for a person who asked for less motion, whatever a stylesheet does', () => {
    expect(base).toMatch(/@media \(prefers-reduced-motion: reduce\)/u);
    expect(base).toMatch(/animation-duration:\s*1ms\s*!important/u);
    expect(base).toMatch(/transition-duration:\s*1ms\s*!important/u);
    expect(base).toMatch(/html\[data-motion='reduced'\]/u);
  });

  it('makes every duration token near-instant under reduced motion, by setting or by system', () => {
    expect(tokens).toMatch(/:root\[data-motion='reduced'\]\s*\{[^}]*--dur-base:\s*1ms/u);
    expect(tokens).toMatch(
      /prefers-reduced-motion: reduce\)\s*\{\s*:root:not\(\[data-motion='full'\]\)\s*\{[^}]*--dur-slow:\s*1ms/u,
    );
  });

  it('turns glass solid for a person who asked for less transparency, and in the high-contrast theme', () => {
    expect(tokens).toMatch(
      /prefers-reduced-transparency: reduce\)[^]*--glass:\s*var\(--bg-raised\)/u,
    );
    expect(tokens).toMatch(/\[data-theme='high-contrast'\][^]*--blur-md:\s*0px/u);
  });

  it('turns glass solid in a browser that cannot blur what is behind it, so text on it stays legible', () => {
    expect(tokens).toMatch(
      /@supports not \(\(backdrop-filter: blur\(1px\)\)[^]*--glass-overlay:\s*var\(--bg-raised\)/u,
    );
  });
});

describe('the code', () => {
  it('imports nothing from the interface it replaces', () => {
    const offenders: string[] = [];
    for (const path of code) {
      for (const match of text(path).matchAll(
        /from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gu,
      )) {
        const target = match[1] ?? match[2] ?? '';
        if (
          /(?:^|\/)(?:components|styles)(?:\/|$)|\/App(?:\.tsx?)?$|\.\/styles\.css$/u.test(target)
        ) {
          offenders.push(`${name(path)} imports ${target}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never writes server text as markup: no raw-HTML or dynamic-code sink anywhere', () => {
    const sinks =
      /dangerouslySetInnerHTML|\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/u;
    expect(code.filter((path) => sinks.test(text(path))).map(name)).toEqual([]);
  });

  it('loads no resource of any other origin: the page may load from itself and from data: only', () => {
    const offenders: string[] = [];
    for (const path of [...code, ...styles]) {
      const sources = stripComments(text(path)).replace(/\/\/.*$/gmu, '');
      for (const match of sources.matchAll(
        /@import\s+url\(\s*["']?https?:|(?:src|url)\s*[=(]\s*["']?(?:https?:)?\/\/[^"')\s]+/gu,
      )) {
        offenders.push(`${name(path)}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
