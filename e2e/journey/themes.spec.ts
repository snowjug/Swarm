import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DEMO_PROJECTS } from '../../shared/demo';
import { Repository } from '../../backend/src/storage/repository';
import { seedDemo } from '../../scripts/demo/lib/seed';
import { expectNoAxeViolations, expectNoHorizontalOverflow } from '../support/helpers';

// The colour themes, in a real browser: the page follows the device until a choice is made, keeps the
// choice, and is readable in every theme (axe, with its contrast rule, on every stage of the demonstration).

const THEMES = ['light', 'dark', 'high-contrast'] as const;
const STAGES = ['Graph Build', 'Env Setup', 'Simulation', 'Report', 'Interaction'] as const;
const [BASE] = DEMO_PROJECTS as [(typeof DEMO_PROJECTS)[number]];

const html = (page: Page) => page.locator('html');

test.beforeAll(() => {
  const root = process.env.E2E_DATA_ROOT;
  if (!root) throw new Error('E2E_DATA_ROOT is not set: this runs under playwright.config.ts.');
  const repository = new Repository(join(root, 'journey', 'swarm-lab.sqlite'));
  try {
    seedDemo(repository, { directory: 'docs/demo/seed' });
  } finally {
    repository.close();
  }
});

test.describe('choosing a theme', () => {
  test('follows the device until a choice is made, then keeps the choice across a reload', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light', contrast: 'no-preference' });
    await page.goto('/');
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
    await expect(page.getByTestId('theme-select')).toHaveValue('system');

    // The device changes its mind while the page is open: the page follows, with no reload.
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    await page.emulateMedia({ colorScheme: 'dark', contrast: 'more' });
    await expect(html(page)).toHaveAttribute('data-theme', 'high-contrast');
    await page.emulateMedia({ colorScheme: 'light', contrast: 'no-preference' });
    await expect(html(page)).toHaveAttribute('data-theme', 'light');

    // A choice beats the device, and survives a reload; the page is themed before it is drawn.
    await page.getByTestId('theme-select').selectOption('dark');
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByTestId('theme-select')).toHaveValue('dark');
    expect(await page.evaluate(() => window.localStorage.getItem('swarm.theme'))).toBe('dark');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#1c1f24');

    // Back to the device.
    await page.getByTestId('theme-select').selectOption('system');
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#ffffff');
  });

  test('never loses the page to a value it does not know', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('swarm.theme', 'solarized'));
    await page.goto('/');
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
    await expect(page.getByTestId('theme-select')).toHaveValue('system');
  });

  test('is operable from the keyboard and named for a screen reader', async ({ page }) => {
    await page.goto('/');
    const select = page.getByRole('combobox', { name: 'Colour theme' });
    await expect(select).toBeVisible();
    await select.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
  });
});

for (const theme of THEMES) {
  test(`is readable in the ${theme} theme on every stage of the demonstration`, async ({
    page,
  }) => {
    test.setTimeout(15 * 60_000);
    await page.addInitScript((value) => window.localStorage.setItem('swarm.theme', value), theme);
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.goto('/');
    await expect(html(page)).toHaveAttribute('data-theme', theme);
    await expectNoAxeViolations(page, `${theme}: entry`);

    await page
      .getByRole('region', { name: 'Demonstration workspace' })
      .getByRole('button', { name: `Open project: ${BASE.title}` })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: BASE.title })).toBeVisible();
    await expectNoAxeViolations(page, `${theme}: project`);

    for (const stage of STAGES) {
      await page
        .getByRole('navigation', { name: 'Guided workflow steps' })
        .getByRole('button', { name: new RegExp(`^${stage}`, 'u') })
        .click();
      await expect(page.getByRole('region', { name: `${stage} workbench` })).toBeVisible();
      await expect(page.locator('.spin:visible')).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page, `${theme}: ${stage}`);
    }
  });
}
