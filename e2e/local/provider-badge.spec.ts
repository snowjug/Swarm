import { expect, test } from '@playwright/test';
import {
  apiContext,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  expectReadableText,
  expectTargetSizes,
  seed,
  viewports,
} from '../support/helpers';

let reportId = '';

test.beforeAll(async ({ playwright }) => {
  const api = await apiContext(playwright);
  reportId = await seed(api, 'report', { name: 'Provider badge: local report' });
});

for (const viewport of viewports) {
  test.describe(`local mode honesty at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('the badge says rules mode, and the panel offers nothing to verify', async ({ page }) => {
      await page.goto('/');
      const badge = page.getByRole('button', { name: /^LOCAL \/ RULES MODE/ });
      await expect(badge).toBeVisible();
      await expect(page.getByText(/REAL (MODEL|AZURE AI)/)).toHaveCount(0);

      await badge.click();
      const panel = page.getByRole('region', { name: 'Model provider' });
      await expect(panel).toContainText('No model calls happen in this mode');
      await expect(panel).toContainText('none: local rules only');
      await expect(panel).toContainText('Nothing to verify: no model provider is configured');
      await expect(panel.getByRole('button', { name: 'Verify connection' })).toBeDisabled();
      await expectNoHorizontalOverflow(page);
      await expectReadableText(page, 'provider panel, local mode');
      await expectTargetSizes(page, 'provider panel, local mode');
      await expectNoAxeViolations(page, 'provider panel, local mode');

      await badge.press('Escape');
      await expect(panel).toBeHidden();
    });

    test('a rules-based report says it has no model statements to check', async ({ page }) => {
      await page.goto(`/?project=${reportId}`);
      await expect(page.getByRole('button', { name: /Open Interaction/ })).toBeVisible();
      if (viewport.width <= 900) {
        await page
          .getByRole('group', { name: 'Console pane' })
          .getByRole('button', { name: 'Report' })
          .click();
      }
      const review = page.getByRole('region', { name: 'Grounding review' });
      await review.scrollIntoViewIfNeeded();
      await expect(review).toContainText('NOT APPLICABLE');
      await expect(review).toContainText(
        'The rules-based report is assembled from recorded metrics and verbatim excerpts, so it has no model-written statements to check.',
      );
      await expect(page.getByText(/REAL (MODEL|AZURE AI)/)).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page, 'local report with the grounding empty state');
    });
  });
}
