import { expect, test, type APIRequestContext } from '@playwright/test';
import { openApp } from '../support/app';
import {
  apiContext,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  expectReadableText,
  openDisclosure,
  seed,
  viewports,
  watchPage,
} from '../support/helpers';
import { expectPressable, forget, quiet } from '../support/shell';

// What the product says about the model behind it, in rules mode (no provider is configured): the chip in the top bar
// says so, the popover that opens from it says there is nothing to verify and offers no way to, and a report written by
// rules says it has no model-written statements to check. Nothing on the page may suggest that a model was called.

let reportId = '';
let api: APIRequestContext;

test.beforeAll(async ({ playwright }) => {
  api = await apiContext(playwright);
  reportId = await seed(api, 'report', { name: 'Provider badge: local report' });
});

test.afterAll(async () => {
  await forget(api, [reportId]);
  await api.dispose();
});

for (const viewport of viewports) {
  test.describe(`local mode honesty at ${viewport.name}`, () => {
    // A tablet and a phone are pressed by a finger: every control is held to the size of one.
    const finger = viewport.width <= 768;
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: finger,
      reducedMotion: 'reduce',
    });

    test('the chip says rules mode, and the popover offers nothing to verify', async ({ page }) => {
      const problems = watchPage(page);
      await openApp(page);
      const chip = page.getByRole('banner').getByRole('button', { name: 'Local rules' });
      await expect(chip).toBeVisible();
      await expect(page.getByText(/REAL (MODEL|AZURE AI)/u)).toHaveCount(0);

      await chip.click();
      const popover = page.getByRole('dialog', { name: 'Model provider' });
      await expect(popover.getByRole('heading', { name: 'No model in use' })).toBeVisible();
      await expect(popover).toContainText('No model calls happen in this mode');
      // There is no connection to check, so no way to ask for one is offered.
      await expect(popover.getByRole('button', { name: 'Verify connection' })).toHaveCount(0);
      const details = await openDisclosure(popover, 'Details');
      await expect(details).toContainText('none: local rules only');
      await expect(details).toContainText('Nothing to verify: no model provider is configured');
      await expect(details).toContainText('none: no model is called');
      await expect(popover).not.toContainText(/connected|verified/iu);

      await quiet(page);
      await expectNoHorizontalOverflow(page);
      await expectReadableText(page, `provider popover, local mode, ${viewport.name}`);
      await expectPressable(page, `provider popover, local mode, ${viewport.name}`, {
        min: finger ? 44 : 24,
        scope: '[role="dialog"]',
      });
      await expectNoAxeViolations(page, `provider popover, local mode, ${viewport.name}`);

      await page.keyboard.press('Escape');
      await expect(popover).toBeHidden();
      await expect(chip).toBeFocused();
      expect(problems).toEqual([]);
    });

    test('a rules-based report says it has no model statements to check, and nothing says a model wrote it', async ({
      page,
    }) => {
      const problems = watchPage(page);
      await openApp(page, { project: reportId, scene: 'decide', view: 'report' });
      const section = page.getByRole('region', { name: 'Nothing to check' });
      await section.scrollIntoViewIfNeeded();
      await expect(section).toContainText(
        'The rules-based report is assembled from recorded metrics and verbatim excerpts, so it has no model-written statements to check.',
      );
      await expect(page.getByText(/REAL (MODEL|AZURE AI)/u)).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await quiet(page);
      await expectNoAxeViolations(page, `a rules-based report, ${viewport.name}`);
      expect(problems).toEqual([]);
    });
  });
}

// The popover is glass, and glass is one surface: its edge is drawn once, on a frame that stays where it is. When what
// it holds is longer than the screen (the details, on a phone), the body inside the frame scrolls and the frame does not;
// if the frame itself scrolled, the lower edge of the glass would travel up with the text and cross it.
for (const theme of ['light', 'dark'] as const) {
  for (const size of [
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    test(`on a phone ${size.width}px wide the model popover is one glass surface that does not scroll, in the ${theme} theme`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        viewport: size,
        hasTouch: true,
        reducedMotion: 'reduce',
      });
      await context.addInitScript(
        (value) => window.localStorage.setItem('swarm.theme', value),
        theme,
      );
      const page = await context.newPage();
      const problems = watchPage(page);
      await openApp(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.getByRole('banner').getByRole('button', { name: 'Local rules' }).click();
      const popover = page.getByRole('dialog', { name: 'Model provider' });
      await openDisclosure(popover, 'Details');
      await quiet(page);

      const measured = await popover.evaluate((frame) => {
        const scrolling = (element: Element) =>
          /auto|scroll/u.test(getComputedStyle(element).overflowY) &&
          element.scrollHeight > element.clientHeight + 1;
        const scrollers = [frame, ...frame.querySelectorAll('*')].filter(scrolling);
        const before = frame.getBoundingClientRect();
        for (const scroller of scrollers) scroller.scrollTop = scroller.scrollHeight;
        const after = frame.getBoundingClientRect();
        return {
          glass: frame.classList.contains('sw-glass'),
          frameOverflow: getComputedStyle(frame).overflowY,
          frameScrollTop: frame.scrollTop,
          frameOverflows: frame.scrollHeight > frame.clientHeight + 1,
          scrollers: scrollers.map((scroller) => scroller.className),
          bodyScrollTop: scrollers.find((scroller) => scroller !== frame)?.scrollTop ?? 0,
          moved: Math.abs(after.top - before.top) + Math.abs(after.bottom - before.bottom),
        };
      });
      // The glass is not what scrolls: it holds, and one body inside it scrolls.
      expect(measured.glass).toBe(true);
      expect(measured.frameOverflow).not.toMatch(/auto|scroll/u);
      expect(measured.frameOverflows).toBe(false);
      expect(measured.frameScrollTop).toBe(0);
      expect(measured.scrollers).toHaveLength(1);
      expect(measured.bodyScrollTop).toBeGreaterThan(0);
      expect(measured.moved).toBe(0);
      // Scrolled to the end, the end of what it says is there, inside the frame.
      await expect(
        popover.getByText(/^Counters cover every real provider round trip/u),
      ).toBeInViewport({
        ratio: 1,
      });
      await expectNoHorizontalOverflow(page);
      expect(problems).toEqual([]);
      await context.close();
    });
  }
}
