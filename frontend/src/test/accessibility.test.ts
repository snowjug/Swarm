/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PAGE_BACKGROUND, THEME_NAMES, colour, contrast, minimumContrast } from './palette';

const styles = [
  'styles.css',
  'entry.css',
  'home.css',
  'shell.css',
  'workspace.css',
  'graph.css',
  'stages.css',
  'report.css',
  'interaction.css',
  'what-if.css',
  'charts.css',
  'provider.css',
  'grounding.css',
  'statements.css',
  'transparency.css',
].map((name) => ({
  name,
  text: readFileSync(
    new URL(name === 'styles.css' ? '../styles.css' : `../styles/${name}`, import.meta.url),
    'utf8',
  ),
}));

describe('measured console accessibility CSS regressions', () => {
  it('has no text font declaration below 12 CSS pixels', () => {
    for (const style of styles) {
      for (const match of style.text.matchAll(/font(?:-size)?:\s*(?:italic\s+)?([\d.]+)px/gu))
        expect(Number(match[1]), `${style.name}: ${match[0]}`).toBeGreaterThanOrEqual(12);
    }
  });
  it.each(THEME_NAMES)(
    'keeps all declared text colours readable on their console surfaces in the %s theme',
    (theme) => {
      let pairs = 0;
      for (const style of styles) {
        for (const match of style.text.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
          const selector = match[1]!,
            declarations = match[2]!;
          const foreground = /(?:^|;)\s*color:\s*(#[\da-f]{3,6}|var\(--[\w-]+\))/iu.exec(
            declarations,
          )?.[1];
          if (!foreground || selector.includes('::backdrop')) continue;
          const background =
            /(?:^|;)\s*background(?:-color)?:\s*(#[\da-f]{3,6}|var\(--[\w-]+\))/iu.exec(
              declarations,
            )?.[1];
          // A rule that paints no background sits on the page, or on the dark log.
          const surface =
            background ?? (selector.includes('log-') ? 'var(--t-bg-17191d)' : PAGE_BACKGROUND);
          expect(
            contrast(colour(foreground, theme), colour(surface, theme)),
            `${style.name} ${selector.trim()}: ${foreground} on ${surface}`,
          ).toBeGreaterThanOrEqual(minimumContrast(theme));
          pairs += 1;
        }
      }
      expect(pairs).toBeGreaterThan(70);
    },
  );
  it('keeps the log in flow, caps only its expanded content and removes nested stage scrollers', () => {
    const css = styles.find((style) => style.name.endsWith('workspace.css'))!.text;
    const log = /\.diagnostic-log\s*\{([^}]+)\}/u.exec(css)![1]!;
    expect(log).toContain('position: static');
    expect(log).not.toContain('sticky');
    expect(css).toMatch(/\.log-lines\s*\{[^}]*max-height:\s*240px/u);
    expect(css).toMatch(/\.diagnostic-log\.open\s*\{[^}]*max-height:\s*240px/u);
    expect(css).not.toMatch(/\.console-stage\s*\{[^}]*(?:overflow-y:\s*auto|max-height:\s*min)/u);
  });
  it('uses viewport-bounded graph sizing and an opaque sticky header', () => {
    const graph = styles.find((style) => style.name.endsWith('graph.css'))!.text;
    expect(graph).toMatch(/height:\s*clamp\(320px,\s*62dvh,\s*720px\)/u);
    const header = /\.app-header\s*\{([^}]+)\}/u.exec(styles[0]!.text)![1]!;
    const fill = /(?:^|\s)background:\s*(var\(--[\w-]+\));/u.exec(header)?.[1];
    expect(fill, 'the header paints a solid colour').toBeDefined();
    // `colour` accepts only an opaque hex value, so a translucent fill in any theme fails here.
    for (const theme of THEME_NAMES) expect(colour(fill!, theme)).toMatch(/^#[\da-f]{6}$/u);
    expect(header).not.toContain('rgba');
  });
  it('sizes the actual text/search/number/select controls, without shrinking native checkboxes or radios', () => {
    const css = styles[0]!.text;
    expect(css).toMatch(
      /input\[type='text'\],\s*input\[type='search'\],\s*input\[type='number'\],\s*input:not\(\[type\]\),\s*select\s*\{[^}]*min-height:\s*32px/u,
    );
    const mobile = css.slice(css.indexOf('@media (max-width: 640px)'));
    expect(mobile).toMatch(
      /\.search-field input,[^{}]*input\[type='search'\][^{}]*select,[^{}]*\{[^}]*min-height:\s*44px/u,
    );
    for (const rules of [css, mobile])
      expect(rules).toMatch(
        /input\[type='checkbox'\],\s*input\[type='radio'\]\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px/u,
      );
  });
  it('keeps the complete mobile scenario question readable', () => {
    const css = styles.find((style) => style.name === 'workspace.css')!.text;
    const narrow = css.slice(css.indexOf('@media (max-width: 900px)'));
    expect(narrow).toMatch(
      /\.project-identity p\s*\{[^}]*white-space:\s*normal;[^}]*overflow:\s*visible;[^}]*text-overflow:\s*clip/u,
    );
    expect(css).not.toContain('mobile-pane-tabs');
  });
  it('keeps the provider panel in the page flow and the header wrapping instead of overflowing', () => {
    const provider = styles.find((style) => style.name === 'provider.css')!.text;
    for (const match of provider.matchAll(/(\.provider-panel[^{}]*)\{([^{}]*)\}/gu)) {
      expect(match[2], match[1]).not.toMatch(
        /position:|overflow(?:-[xy])?:\s*(?:auto|scroll|hidden)/u,
      );
      expect(match[2], match[1]).not.toContain('max-height');
    }
    const header = /\.app-header\s*\{([^}]+)\}/u.exec(styles[0]!.text)![1]!;
    expect(header).toContain('flex-wrap: wrap');
    expect(provider).toMatch(
      /@media \(max-width: 1100px\)\s*\{\s*\.provider-badge\s*\{\s*flex:\s*1 1 100%/u,
    );
    expect(provider).toMatch(
      /@media \(max-width: 640px\)\s*\{\s*\.provider-badge\s*\{\s*min-height:\s*44px/u,
    );
  });
});

/** The text of the `@media` block that opens with this query, braces matched. */
function mediaBlock(css: string, query: string): string {
  const start = css.indexOf(`@media ${query}`);
  if (start < 0) return '';
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}' && --depth === 0) return css.slice(open + 1, index);
  }
  return '';
}

describe('restrained decoration and motion', () => {
  const everything = [...styles];
  const home = styles.find((style) => style.name === 'home.css')!.text;
  const shell = styles.find((style) => style.name === 'shell.css')!.text;
  const theme = readFileSync(new URL('../styles/theme.css', import.meta.url), 'utf8');

  it('puts a gradient and a grid on the landing hero and nowhere else', () => {
    for (const style of everything) {
      const code = style.text.replace(/\/\*[^]*?\*\//gu, '');
      for (const match of code.matchAll(/([^{}]+)\{([^{}]*gradient\([^{}]*)\}/gu)) {
        expect(`${style.name} ${match[1]!.trim()}`).toBe('home.css .landing-hero::before');
      }
    }
    expect(home).toMatch(/\.landing-hero::before\s*\{[^}]*radial-gradient/u);
  });

  it('keeps the hero decoration off the page for the high-contrast theme and for forced colours', () => {
    expect(theme).toMatch(
      /:root\[data-theme='high-contrast'\] \.landing-hero::before\s*\{\s*display:\s*none/u,
    );
    expect(mediaBlock(theme, '(forced-colors: active)')).toMatch(
      /\.landing-hero::before\s*\{\s*display:\s*none/u,
    );
  });

  it('runs no animation of its own unless the person has not asked for less motion', () => {
    for (const style of everything) {
      for (const match of style.text.matchAll(/animation(?:-name)?:\s*([^;]+);/gu)) {
        const spinner = /spin\b/u.test(match[1]!) && style.name === 'styles.css';
        const gated = mediaBlock(style.text, '(prefers-reduced-motion: no-preference)').includes(
          match[0],
        );
        expect(spinner || gated, `${style.name}: ${match[0]}`).toBe(true);
      }
    }
    expect(shell).toContain('@media (prefers-reduced-motion: no-preference)');
  });

  it('keeps the global fallback that stops every animation and transition under reduced motion', () => {
    const base = styles[0]!.text;
    const reduced = mediaBlock(base, '(prefers-reduced-motion: reduce)');
    expect(reduced).toMatch(/animation-duration:\s*0\.01ms\s*!important/u);
    expect(reduced).toMatch(/animation-iteration-count:\s*1\s*!important/u);
    expect(reduced).toMatch(/transition:\s*none\s*!important/u);
  });

  it('lifts a card on hover only where there is a pointer to hover with and motion is welcome', () => {
    const moving = mediaBlock(home, '(hover: hover) and (prefers-reduced-motion: no-preference)');
    expect(moving).toMatch(/\.example-card:hover\s*\{\s*transform:\s*translateY/u);
    expect(home.replace(moving, '')).not.toMatch(/\.example-card:hover\s*\{[^}]*transform/u);
  });

  it('draws the page background, not the hero, behind everything else: the hero is not a layer over content', () => {
    const hero = /\.landing-hero\s*\{([^}]+)\}/u.exec(home)![1]!;
    expect(hero).toContain('isolation: isolate');
    const decoration = /\.landing-hero::before\s*\{([^}]+)\}/u.exec(home)![1]!;
    expect(decoration).toContain('z-index: -1');
    expect(decoration).toContain('pointer-events: none');
  });
});
