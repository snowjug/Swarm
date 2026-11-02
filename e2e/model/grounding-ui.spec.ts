import { expect, test, type Page } from '@playwright/test';
import {
  apiContext,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  expectReadableText,
  expectTargetSizes,
  seed,
  viewports,
} from '../support/helpers';

const providerUrl = `http://127.0.0.1:${process.env.E2E_PROVIDER_PORT || 11999}`;
const ids = { graph: '' };

test.beforeAll(async ({ playwright }) => {
  const provider = await playwright.request.newContext({ baseURL: providerUrl });
  await provider.post('/__reset');
  await provider.post('/__control', { data: { latencyMs: 0 } });
  const api = await apiContext(playwright);
  const options = { mode: 'llm', agents: 4, rounds: 3 } as const;
  ids.graph = await seed(api, 'knowledge', { name: 'Grounding UI: graph', ...options });
  await provider.post('/__reset');
  await provider.dispose();
});

async function expectFits(page: Page, label: string): Promise<void> {
  await expectNoHorizontalOverflow(page);
  await expectReadableText(page, label);
  await expectTargetSizes(page, label);
  await expectNoAxeViolations(page, label);
}

for (const viewport of viewports) {
  test.describe(`model UI at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });
    const narrow = viewport.width <= 900;

    test('the provider panel states what is real and verifies with one real round trip', async ({
      page,
    }) => {
      await page.goto('/');
      const badge = page.getByRole('button', { name: /^REAL MODEL · Ollama \(local\)/ });
      await expect(badge).toBeVisible();
      await badge.click();
      const panel = page.getByRole('region', { name: 'Model provider' });
      await expect(panel).toContainText(
        'Projects created in Model assisted mode send bounded context',
      );
      // Real requests already succeeded while the fixtures were seeded, so the entry card and the
      // badge must agree that the provider is connected, not repeat a stale "not yet verified".
      await expect(page.locator('.readiness')).toContainText('Connected');
      await expect(page.locator('.readiness')).not.toContainText(
        'Configured is not a connectivity check',
      );
      await expect(page.locator('.readiness')).not.toContainText('not yet verified');
      await expectFits(page, 'provider panel');
      await panel.getByRole('button', { name: 'Verify connection' }).click();
      await expect(panel).toContainText('Connection verified: one real round trip completed');
      await expect(panel).toContainText('connected');
      await expectFits(page, 'provider panel after verification');
    });

    test('a model graph node shows the verified source quote', async ({ page }) => {
      await page.goto(`/?project=${ids.graph}`);
      await expect(page.getByRole('button', { name: /Prepare environment/ })).toBeVisible();
      if (narrow) {
        await page
          .getByRole('group', { name: 'Console pane' })
          .getByRole('button', { name: 'Graph' })
          .click();
      }
      await page.getByRole('combobox', { name: /Inspect node/ }).selectOption({ index: 1 });
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(/Source quote \(checked verbatim against S\d/);
      // The fake provider copies the start of the cited passage, which is what the server verified.
      await expect(dialog.locator('blockquote')).toContainText('This is a fictional scenario');
      await expectNoAxeViolations(page, 'node inspector with a source quote');
    });
  });
}
