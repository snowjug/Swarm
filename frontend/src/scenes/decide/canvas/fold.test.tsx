import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../../../design/ui';
import { canvasFixture } from '../../../test/decision';
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

describe('the decision canvas on a narrow screen', () => {
  it('keeps the question and the answer open and folds the other seven, in the same order', () => {
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
