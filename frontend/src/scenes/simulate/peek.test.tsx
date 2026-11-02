import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PeekCard } from './PeekCard';

const card = (compact: boolean) =>
  renderToStaticMarkup(
    <PeekCard compact={compact} label="Round 3" peek={<span>3 of 12</span>} glance={<i>bar</i>}>
      <p>The rest of the card</p>
    </PeekCard>,
  );

describe('PeekCard', () => {
  it('is the whole card on a wide screen: no toggle, nothing set aside, the content readable', () => {
    const html = card(false);
    expect(html).not.toContain('sw-round__toggle');
    expect(html).not.toContain('inert');
    expect(html).toContain('The rest of the card');
    expect(html).toContain('aria-label="Round 3"');
  });

  it('is one line on a narrow screen that says what it holds and that it opens', () => {
    const html = card(true);
    expect(html).toMatch(
      /<button[^>]*class="sw-round__toggle"[^>]*aria-expanded="false"[^>]*aria-controls="[^"]+"/u,
    );
    expect(html).toContain('3 of 12');
    // The line that stays in view while it is closed.
    expect(html).toContain('sw-round__glance');
  });

  it('keeps what is folded away out of the tab order and out of the reading order until it is opened', () => {
    const html = card(true);
    expect(html).toMatch(/<div class="sw-round__fold"[^>]*inert/u);
    expect(html).not.toContain('is-open');
  });
});
