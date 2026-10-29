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
const ABSTENTION = 'The available project evidence does not support a confident answer.';
let id = '';

test.beforeAll(async ({ playwright }) => {
  const provider = await playwright.request.newContext({ baseURL: providerUrl });
  await provider.post('/__reset');
  await provider.post('/__control', { data: { latencyMs: 0 } });
  const api = await apiContext(playwright);
  id = await seed(api, 'report', {
    name: 'Ledger UI: model report',
    mode: 'llm',
    agents: 4,
    rounds: 3,
  });
  await provider.post('/__reset');
  await provider.dispose();
  await api.dispose();
});

/** Below 900px the console shows one pane at a time; the reader (and the ledger) is the Report pane. */
async function showReader(page: Page, narrow: boolean): Promise<void> {
  if (narrow) {
    await page
      .getByRole('group', { name: 'Console pane' })
      .getByRole('button', { name: 'Report' })
      .click();
  }
}

async function openLedger(page: Page, narrow: boolean) {
  await page.goto(`/?project=${id}`);
  await expect(page.getByRole('button', { name: /Open Interaction/ })).toBeVisible();
  await showReader(page, narrow);
  const ledger = page.getByRole('region', { name: 'Evidence ledger' });
  await ledger.scrollIntoViewIfNeeded();
  await expect(ledger.locator('.ledger-claim').first()).toBeVisible();
  return ledger;
}

for (const viewport of viewports) {
  test.describe(`model evidence ledger at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('lists statements with words and icons, and fits, reads and passes axe', async ({
      page,
    }, testInfo) => {
      const ledger = await openLedger(page, viewport.width <= 900);
      await expect(ledger.getByRole('status').first()).toContainText(/evidence/i);
      await expect(ledger).toContainText(/\d+ statements?/);
      expect(await ledger.locator('.ledger-claim').count()).toBeGreaterThan(0);
      // Each chip carries an icon as well as words: colour is never the only cue.
      const chips = ledger.locator('.ledger-claim .tone-chip');
      expect(await chips.count()).toBeGreaterThan(0);
      expect(await ledger.locator('.ledger-claim .tone-chip:not(:has(svg))').count()).toBe(0);
      await ledger.screenshot({ path: testInfo.outputPath(`ledger-model-${viewport.name}.png`) });
      await page.screenshot({
        path: testInfo.outputPath(`ledger-model-${viewport.name}-viewport.png`),
      });
      await expectNoHorizontalOverflow(page);
      await expectReadableText(page, 'model evidence ledger');
      await expectTargetSizes(page, 'model evidence ledger');
      await expectNoAxeViolations(page, 'model evidence ledger');
    });
  });
}

test('a statement opens an inspector, a review is recorded, and focus returns to the row', async ({
  page,
}) => {
  const ledger = await openLedger(page, false);
  const row = ledger.locator('.ledger-claim').first();
  await row.focus();
  await page.keyboard.press('Enter');
  const inspector = ledger.locator('.claim-inspector');
  await expect(inspector).toBeVisible();
  await expect(inspector.getByRole('heading', { level: 3 })).toBeFocused();
  for (const label of ['How it was checked', 'Why this class', 'Version']) {
    await expect(inspector).toContainText(label);
  }
  await expectNoAxeViolations(page, 'claim inspector open');

  await inspector.getByLabel('Note (optional)').fill('Needs a second source before use.');
  await inspector.getByRole('button', { name: 'Needs revision' }).click();
  await expect(inspector.locator('.review-form .tone-chip').first()).toContainText(
    'Needs revision',
  );
  await expect(row).toContainText('Needs revision');
  await expect(inspector).toContainText('Needs a second source before use.');

  await inspector.getByRole('button', { name: 'Close statement inspector' }).click();
  await expect(inspector).toHaveCount(0);
  await expect(row).toBeFocused();

  // The review is stored on the server, not just on the screen.
  await page.reload();
  const reloaded = page.getByRole('region', { name: 'Evidence ledger' });
  await reloaded.scrollIntoViewIfNeeded();
  await expect(reloaded.locator('.ledger-claim').first()).toContainText('Needs revision');
});

test('the assumptions behind the simulated results can filter the statements that rest on them', async ({
  page,
}) => {
  const ledger = await openLedger(page, false);
  await expect(
    ledger.getByRole('heading', {
      level: 3,
      name: /Assumptions behind the simulated results \(\d+\)/,
    }),
  ).toBeVisible();
  await expect(ledger).toContainText('inputs, not findings');
  const total = await ledger.locator('.ledger-claim').count();
  const dependent = ledger.locator('.assumption .text-button:not([disabled])').first();
  await expect(dependent).toHaveAttribute('aria-pressed', 'false');
  await dependent.click();
  await expect(dependent).toHaveAttribute('aria-pressed', 'true');
  await expect(dependent).toContainText(/^Showing \d+ dependent statements?$/);
  const shown = await ledger.locator('.ledger-claim').count();
  expect(shown).toBeGreaterThan(0);
  expect(shown).toBeLessThanOrEqual(total);
  await ledger.getByRole('button', { name: 'Clear filters' }).click();
  await expect(ledger.locator('.ledger-claim')).toHaveCount(total);
  await expectNoAxeViolations(page, 'assumption register');
});

test('filters narrow the statements and can be cleared', async ({ page }) => {
  const ledger = await openLedger(page, false);
  const total = await ledger.locator('.ledger-claim').count();
  await ledger.getByLabel('Not yet reviewed').check();
  const unreviewed = await ledger.locator('.ledger-claim').count();
  expect(unreviewed).toBeLessThanOrEqual(total);
  await expect(ledger.getByText(`Showing ${unreviewed} of ${total}`)).toBeVisible();
  await ledger.getByRole('button', { name: 'Clear filters' }).click();
  await expect(ledger.locator('.ledger-claim')).toHaveCount(total);
});

test('the analyst abstains when the project cannot answer, and labels how well it answered', async ({
  page,
}) => {
  await page.goto(`/?project=${id}`);
  await page.getByRole('button', { name: /Open Interaction/ }).click();
  await page.getByRole('tab', { name: /Report chat/ }).click();
  const messages = page.getByRole('region', { name: 'Saved conversation messages' });
  const box = page.getByRole('textbox', { name: /Question for the report/ });

  await box.fill('What is the capital of France?');
  await page.getByRole('button', { name: 'Ask model' }).click();
  await expect(messages).toContainText(ABSTENTION);
  await expect(messages).toContainText('Not enough evidence to answer');
  await expect(messages).toContainText('Not found in the project');

  await box.fill('What does the Library Service propose about weekday hours?');
  await page.getByRole('button', { name: 'Ask model' }).click();
  await expect(messages).toContainText('Cited from project evidence');
  await expectNoAxeViolations(page, 'chat with grounding notes');
});
