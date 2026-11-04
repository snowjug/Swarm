import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SCOPE_NOTICE } from '../../../../../shared/decision';
import { TooltipProvider } from '../../../design/ui';
import { canvasFixture, scopedFixture, viewFixture } from '../../../test/decision';
import { DecisionCanvasView } from './Canvas';
import { ITEMS, ITEM_TITLES, gistOf } from './model';
import { Viewport } from './Viewport';

// On a narrow screen the first two things keep their place and the rest fold, one line each, in the same order.
vi.mock('../../../hooks/useMediaQuery', () => ({ useMediaQuery: () => true }));

const render = () =>
  renderToStaticMarkup(
    <TooltipProvider>
      <Viewport canvas={canvasFixture()} openDetail={() => undefined} />
    </TooltipProvider>,
  );

const noop = () => undefined;
const page = (canvas: ReturnType<typeof canvasFixture>) =>
  renderToStaticMarkup(
    <TooltipProvider>
      <DecisionCanvasView
        handle={{
          view: viewFixture(canvas),
          loading: false,
          refreshing: false,
          error: null,
          reload: noop,
        }}
        go={{ ask: noop, ground: noop, map: noop, simulate: noop }}
        below
        onDetailed={null}
      />
    </TooltipProvider>,
  );

describe('the decision canvas on a narrow screen', () => {
  it('keeps the question and the answer open and folds the other eight, in the same order', () => {
    const markup = render();
    const items = [...markup.matchAll(/data-canvas-item="([a-z]+)"/gu)].map((match) => match[1]);
    expect(items).toEqual([...ITEMS]);
    const sections = markup.split('<section ').slice(1);
    for (const [index, item] of ITEMS.entries()) {
      const folded = sections[index]!.includes('sw-disc__head');
      expect(folded, item).toBe(index > 1);
    }
  });

  it('says in one line what each folded item holds, and starts every one closed', () => {
    const markup = render();
    const canvas = canvasFixture();
    for (const item of ITEMS.slice(2)) {
      expect(markup, item).toContain(ITEM_TITLES[item]);
      expect(markup, item).toContain(gistOf(item, canvas).replaceAll('&', '&amp;'));
    }
    expect(markup.match(/aria-expanded="false"/gu)).toHaveLength(ITEMS.length - 2);
    expect(markup).not.toContain('aria-expanded="true"');
  });

  it('keeps each folded item’s heading a level-two heading, with the button inside it', () => {
    const markup = render();
    expect(markup.match(/<h2 class="sw-disc__heading">/gu)).toHaveLength(ITEMS.length - 2);
  });
});

describe('what Swarm does not decide, on a narrow screen', () => {
  it.each([
    ['a matter in general', scopedFixture('domain')],
    ['a decision about one person', scopedFixture('individual')],
  ])('keeps the notice open above the question, never folded, for %s', (_name, canvas) => {
    const markup = page(canvas);
    const at = markup.indexOf(SCOPE_NOTICE);
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(markup.indexOf('data-canvas-item="question"'));
    expect(at).toBeLessThan(markup.indexOf('sw-disc__head'));
  });

  it('folds the other eight for one person too, with a line each that says what a person decides', () => {
    const canvas = scopedFixture('individual');
    const markup = page(canvas);
    for (const item of ITEMS.slice(2)) {
      expect(markup, item).toContain(ITEM_TITLES[item]);
      expect(markup, item).toContain(gistOf(item, canvas).replaceAll('&', '&amp;'));
    }
    const viewport = markup.slice(
      markup.indexOf('sw-canvas-grid'),
      markup.indexOf('class="sw-canvas-detail"'),
    );
    expect(viewport.match(/aria-expanded="false"/gu)).toHaveLength(ITEMS.length - 2);
  });
});
