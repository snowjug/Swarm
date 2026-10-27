/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = [
  'styles.css',
  'entry.css',
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

function luminance(hex: string): number {
  const raw = hex.slice(1);
  const expanded =
    raw.length === 3
      ? raw
          .split('')
          .map((part) => part + part)
          .join('')
      : raw;
  const values = [0, 2, 4].map((offset) => {
    const value = Number.parseInt(expanded.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722;
}
function contrast(foreground: string, background: string) {
  const a = luminance(foreground),
    b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
const tokens = Object.fromEntries(
  [...styles[0]!.text.matchAll(/(--[\w-]+):\s*(#[\da-f]{3,8})/giu)].map((match) => [
    match[1],
    match[2]!,
  ]),
);
function color(value: string) {
  return value.startsWith('var(') ? tokens[value.slice(4, -1)]! : value;
}

describe('measured console accessibility CSS regressions', () => {
  it('has no text font declaration below 12 CSS pixels', () => {
    for (const style of styles) {
      for (const match of style.text.matchAll(/font(?:-size)?:\s*(?:italic\s+)?([\d.]+)px/gu))
        expect(Number(match[1]), `${style.name}: ${match[0]}`).toBeGreaterThanOrEqual(12);
    }
  });
  it('keeps all declared text colours above 4.5:1 on their console surfaces', () => {
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
        const surface = background
          ? color(background)
          : selector.includes('log-')
            ? '#17191d'
            : '#f7f7f5';
        expect(
          contrast(color(foreground), surface),
          `${selector.trim()}: ${foreground} on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
        pairs += 1;
      }
    }
    expect(pairs).toBeGreaterThan(70);
  });
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
    expect(header).toContain('background: #fff');
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
