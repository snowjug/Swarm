import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { expectScene, notices, openApp, settled } from '../support/app';
import {
  apiContext,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  watchPage,
} from '../support/helpers';
import {
  forget,
  makeProject,
  openSettings,
  PHONE,
  settingsButton,
  stored,
  type Made,
} from '../support/shell';

// The command palette in a real browser: Ctrl K from anywhere, the top bar's button and the settings menu as other
// ways in, what it does with steps that are not open yet, settings and other explorations, where the keyboard is
// afterwards, and that it fits a phone. It is a shortcut: nothing here is reachable only through it.

test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

const tag = Date.now().toString(36);
const projects = {} as Record<'ground' | 'brief' | 'other', Made>;
const otherName = `Palette ${tag}: the other exploration`;
let api: APIRequestContext;

test.beforeAll(async ({ playwright }) => {
  api = await apiContext(playwright);
  projects.ground = await makeProject(api, 'ground', { name: `Palette ${tag}: ground` });
  projects.brief = await makeProject(api, 'brief', { name: `Palette ${tag}: brief` });
  projects.other = await makeProject(api, 'ground', { name: otherName });
});

test.afterAll(async () => {
  await forget(api, [projects.ground.id, projects.brief.id, projects.other.id]);
  await api.dispose();
});

const palette = (page: Page) => page.getByRole('dialog', { name: 'Commands' });
const search = (page: Page) => palette(page).getByRole('combobox', { name: 'Search commands' });
const rowNamed = (page: Page, name: string | RegExp) => palette(page).getByRole('option', { name });

async function openPalette(page: Page): Promise<void> {
  await page.keyboard.press('Control+k');
  await expect(palette(page)).toBeVisible();
  await expect(search(page)).toBeFocused();
}

test('Ctrl K goes to a scene, and the keyboard lands on the page it opened', async ({ page }) => {
  const problems = watchPage(page);
  await openApp(page, { project: projects.brief.id, scene: 'ground' });
  await openPalette(page);
  await search(page).fill('compare');
  await expect(rowNamed(page, /^Compare/u)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(palette(page)).toBeHidden();
  await expectScene(page, 'compare');
  await expect(page.getByRole('main')).toBeFocused();
  expect(problems).toEqual([]);
});

test('a view of a scene can be opened directly', async ({ page }) => {
  await openApp(page, { project: projects.brief.id, scene: 'ground' });
  await openPalette(page);
  await search(page).fill('simulate timeline');
  await page.keyboard.press('Enter');
  await expectScene(page, 'simulate');
  await expect(page).toHaveURL(/[?&]view=timeline(?:&|$)/u);
});

test('a step that is not open yet is listed with what opens it, and choosing it says why instead of going', async ({
  page,
}) => {
  await openApp(page, { project: projects.ground.id, scene: 'ground' });
  await openPalette(page);
  await search(page).fill('simulate');
  const row = rowNamed(page, /^Simulate\b/u).first();
  await expect(row).toHaveAttribute('aria-disabled', 'true');
  await expect(row).toContainText('Needs actors');
  await page.keyboard.press('Enter');
  await expect(notices(page)).toContainText('Needs actors');
  await expectScene(page, 'ground');
});

test('a setting can be changed from it, and stays changed', async ({ page }) => {
  await openApp(page, { project: projects.ground.id, scene: 'ground' });
  await openPalette(page);
  await search(page).fill('dark theme');
  await page.keyboard.press('Enter');
  await expect(palette(page)).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await stored(page, 'swarm.theme')).toBe('dark');

  await openPalette(page);
  await search(page).fill('motion reduced');
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');

  // The setting that is on says so, in words as well as by a tick.
  await openPalette(page);
  await search(page).fill('dark theme');
  await expect(rowNamed(page, /Dark theme.*on/u)).toBeVisible();
});

test('another exploration can be opened by its name', async ({ page }) => {
  await openApp(page, { project: projects.brief.id, scene: 'decide' });
  await openPalette(page);
  await search(page).fill('the other exploration');
  await expect(rowNamed(page, otherName)).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`[?&]project=${projects.other.id}(?:&|$)`, 'u'));
  await settled(page);
});

test('it opens while a person is typing, and Escape puts the keyboard back in the field', async ({
  page,
}) => {
  await openApp(page);
  const question = page.getByRole('textbox', { name: 'Your what-if question' });
  await question.fill('What could happen if the library opens later');
  await openPalette(page);
  await page.keyboard.press('Escape');
  await expect(palette(page)).toBeHidden();
  await expect(question).toBeFocused();
  await expect(question).toHaveValue('What could happen if the library opens later');
});

test('the top bar button and the settings menu open it, and closing it returns the keyboard to where it came from', async ({
  page,
}) => {
  await openApp(page, { project: projects.ground.id, scene: 'ground' });

  const button = page.getByRole('button', { name: 'Search and commands' });
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(palette(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette(page)).toBeHidden();
  await expect(button).toBeFocused();

  await settingsButton(page).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: /Search and commands/u }).click();
  await expect(palette(page)).toBeVisible();
  await expect(search(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(palette(page)).toBeHidden();
  await expect(settingsButton(page)).toBeFocused();
});

test('arrows move the mark, Enter runs it, and nothing found says so', async ({ page }) => {
  await openApp(page, { project: projects.brief.id, scene: 'ground' });
  await openPalette(page);
  const marked = palette(page).locator('[role="option"][aria-selected="true"]');
  await expect(marked).toHaveCount(1);
  const first = await marked.textContent();
  await page.keyboard.press('ArrowDown');
  expect(await marked.textContent()).not.toBe(first);
  await page.keyboard.press('ArrowUp');
  expect(await marked.textContent()).toBe(first);

  await search(page).fill('qqqqqq');
  await expect(palette(page)).toContainText('Nothing matches');
  await expect(palette(page).getByRole('status')).toHaveText('No commands match.');
  await page.keyboard.press('Enter');
  await expect(palette(page)).toBeVisible();
});

for (const theme of ['light', 'dark', 'high-contrast'] as const) {
  test(`it passes axe in the ${theme} theme, empty and with a search typed`, async ({ page }) => {
    await openApp(page, { project: projects.brief.id, scene: 'ground', theme });
    await openPalette(page);
    await expectNoAxeViolations(page, `palette, empty, ${theme}`);
    await search(page).fill('s');
    await expectNoAxeViolations(page, `palette, searching, ${theme}`);
  });
}

test.describe('on a phone', () => {
  test.use(PHONE);

  test('it is reached from the settings menu, fits the screen, and its rows are big enough for a finger', async ({
    page,
  }) => {
    await openApp(page, { project: projects.brief.id, scene: 'ground' });
    await expect(page.getByRole('button', { name: 'Search and commands' })).toBeHidden();
    await openSettings(page);
    await page.getByRole('menuitem', { name: /Search and commands/u }).tap();
    await expect(palette(page)).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const box = await palette(page).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(PHONE.viewport.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(PHONE.viewport.height);

    const heights = await palette(page)
      .getByRole('option')
      .evaluateAll((rows) => rows.map((row) => Math.round(row.getBoundingClientRect().height)));
    expect(heights.length).toBeGreaterThan(5);
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);

    await search(page).fill('ground');
    await rowNamed(page, /^Ground/u).tap();
    await expect(palette(page)).toBeHidden();
  });
});
