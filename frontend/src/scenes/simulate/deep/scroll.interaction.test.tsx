// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../../../../shared/types';
import { reduceMotion, renderWithApp, screen } from '../../../test/dom';
import { deepFixture } from './fixture';
import DeepDive from './index';

// A link inside one tab can lead to another while the person is far down the page: the tabs are brought back into view,
// smoothly, and at once when motion is reduced.

const scrolled = vi.fn();
beforeEach(() => {
  scrolled.mockReset();
  Element.prototype.scrollIntoView = function (this: Element, options?: unknown) {
    scrolled(this.className, options);
  };
});

function open() {
  const view = renderWithApp(<DeepDive />, {
    workspace: {
      project: deepFixture({ simulation: 'pending', saved: 0 }),
      config: { capabilities: { whatIf: true } } as unknown as AppConfig,
      scene: 'simulate',
      view: 'deep',
    },
  });
  // The tabs are above the top of the screen: the person has scrolled far down the Setup.
  const tabs = view.container.querySelector<HTMLElement>('.sw-deep-tabs')!;
  tabs.getBoundingClientRect = () => ({ top: -240 }) as DOMRect;
  return view;
}

describe('coming back to the tabs of the deep dive', () => {
  it('scrolls to them smoothly when the tab changes while they are out of view', async () => {
    const { user } = open();
    await user.click(screen.getByRole('tab', { name: /^Memory/u }));
    expect(scrolled).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('sw-deep-tabs'), {
      block: 'start',
      behavior: 'smooth',
    });
  });

  it('does not scroll with motion when motion is reduced', async () => {
    reduceMotion();
    const { user } = open();
    await user.click(screen.getByRole('tab', { name: /^Memory/u }));
    expect(scrolled).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('sw-deep-tabs'), {
      block: 'start',
      behavior: 'auto',
    });
  });
});
