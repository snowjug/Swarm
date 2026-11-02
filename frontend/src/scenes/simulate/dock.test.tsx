import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Dock, SideCard } from './Dock';

const dock = (compact: boolean, open = false) =>
  renderToStaticMarkup(
    <Dock
      compact={compact}
      open={open}
      onOpenChange={() => undefined}
      label="Round 3"
      peek={<span>3 of 12</span>}
      glance={<i>bar</i>}
      fold={compact ? <p>The rest of the round</p> : undefined}
    >
      <p>The controls</p>
    </Dock>,
  );

describe('the dock at the bottom of the stage', () => {
  it('is only the controls on a wide screen: no toggle and nothing set aside', () => {
    const html = dock(false);
    expect(html).not.toContain('sw-sim-dock__toggle');
    expect(html).not.toContain('inert');
    expect(html).toContain('The controls');
    expect(html).toContain('aria-label="Round 3"');
  });

  it('is one line on a narrow screen that says what it holds and that it opens', () => {
    const html = dock(true);
    expect(html).toMatch(
      /<button[^>]*class="sw-sim-dock__toggle"[^>]*aria-expanded="false"[^>]*aria-controls="[^"]+"/u,
    );
    expect(html).toContain('3 of 12');
    // The line that stays in view while it is closed, with the controls below it.
    expect(html).toContain('sw-sim-dock__glance');
    expect(html).toContain('The controls');
  });

  it('keeps what is folded away out of the tab order and out of the reading order until it is opened', () => {
    expect(dock(true)).toMatch(/<div class="sw-sim-dock__fold"[^>]*inert/u);
    const open = dock(true, true);
    expect(open).not.toMatch(/<div class="sw-sim-dock__fold"[^>]*inert/u);
    expect(open).toContain('is-open');
    // The glance has nothing to add once the details are shown.
    expect(open).not.toContain('sw-sim-dock__glance');
  });
});

describe('the card beside the picture', () => {
  it('is a named region holding what it is given', () => {
    const html = renderToStaticMarkup(
      <SideCard label="Round 3">
        <p>Details</p>
      </SideCard>,
    );
    expect(html).toContain('<aside');
    expect(html).toContain('aria-label="Round 3"');
    expect(html).toContain('Details');
  });
});
