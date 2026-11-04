import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  SCENE_LABEL,
  expectScene,
  goTo,
  openApp,
  settled,
  step,
  type ThemeName,
} from '../support/app';
import { chooseExampleNamed } from '../support/ask';
import { apiContext, expectNoBrowserPaintedControls, watchPage } from '../support/helpers';
import {
  arrived,
  audit,
  chooseSetting,
  forget,
  historyDialog,
  makeProject,
  openHistory,
  openSettings,
  provokeNotice,
  SCREENS,
  rootAttribute,
  screenPath,
  stored,
  type ScreenProjects,
} from '../support/shell';

// The three colour themes, in a real browser: the page follows the device until a choice is made, keeps the choice,
// is themed before it is drawn, and is readable in every theme on every screen (axe, with its contrast rule, and the
// check that no control is left in the browser's own palette).

const THEMES = ['light', 'dark', 'high-contrast'] as const satisfies readonly ThemeName[];
const THEME_LABEL: Record<ThemeName, string> = {
  light: 'Light',
  dark: 'Dark',
  'high-contrast': 'High contrast',
};
/** The colour of the browser's own chrome for each theme: what an address bar on a phone is painted with. */
const CHROME: Record<ThemeName, string> = {
  light: '#f8f7f4',
  dark: '#0a0b10',
  'high-contrast': '#000000',
};

test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

const html = (page: Page) => page.locator('html');
const chrome = (page: Page) => page.locator('meta[name="theme-color"]');

const projects: ScreenProjects = { ground: '', proposed: '', brief: '' };
let api: APIRequestContext;

test.beforeAll(async ({ playwright }) => {
  api = await apiContext(playwright);
  projects.ground = (await makeProject(api, 'ground', { name: 'Themes: ground' })).id;
  projects.proposed = (await makeProject(api, 'proposed', { name: 'Themes: proposed' })).id;
  projects.brief = (await makeProject(api, 'brief', { name: 'Themes: brief' })).id;
});

test.afterAll(async () => {
  await forget(api, Object.values(projects));
  await api.dispose();
});

// ---------------------------------------------------------------------------------------------

test.describe('choosing a theme', () => {
  test('follows the device until a choice is made, then keeps the choice across a reload', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light', contrast: 'no-preference' });
    await openApp(page);
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
    let menu = await openSettings(page);
    await expect(menu.getByRole('menuitemradio', { name: 'System' })).toBeChecked();
    await page.keyboard.press('Escape');
    expect(await stored(page, 'swarm.theme')).toBeNull();

    // The device changes its mind while the page is open: the page follows, with no reload.
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    await expect(chrome(page)).toHaveAttribute('content', CHROME.dark);
    await page.emulateMedia({ colorScheme: 'dark', contrast: 'more' });
    await expect(html(page)).toHaveAttribute('data-theme', 'high-contrast');
    await expect(chrome(page)).toHaveAttribute('content', CHROME['high-contrast']);
    await page.emulateMedia({ colorScheme: 'light', contrast: 'no-preference' });
    await expect(html(page)).toHaveAttribute('data-theme', 'light');

    // A choice beats the device, and survives a reload.
    await chooseSetting(page, 'Dark');
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    expect(await stored(page, 'swarm.theme')).toBe('dark');
    await page.reload();
    await settled(page);
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    menu = await openSettings(page);
    await expect(menu.getByRole('menuitemradio', { name: 'Dark' })).toBeChecked();
    await expect(chrome(page)).toHaveAttribute('content', CHROME.dark);

    // The device no longer matters while a choice stands, and matters again when "System" is chosen.
    await menu.getByRole('menuitemradio', { name: 'System' }).click();
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
    await expect(chrome(page)).toHaveAttribute('content', CHROME.light);
    expect(await stored(page, 'swarm.theme')).toBe('system');
  });

  test('more contrast asked for by the device wins over dark, because it is a need and not a taste', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark', contrast: 'more' });
    await openApp(page);
    await expect(html(page)).toHaveAttribute('data-theme', 'high-contrast');
    // A person's own choice still beats it.
    await chooseSetting(page, 'Light');
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
  });

  for (const theme of THEMES) {
    test(`${THEME_LABEL[theme]} is chosen in the menu, applied at once, and stays through every scene`, async ({
      page,
    }) => {
      await openApp(page, { project: projects.brief, scene: 'ground' });
      await chooseSetting(page, THEME_LABEL[theme]);
      await expect(html(page)).toHaveAttribute('data-theme', theme);
      await expect(chrome(page)).toHaveAttribute('content', CHROME[theme]);
      for (const scene of ['map', 'simulate', 'compare', 'decide'] as const) {
        await goTo(page, scene);
        expect(await rootAttribute(page, 'data-theme'), `the theme in ${SCENE_LABEL[scene]}`).toBe(
          theme,
        );
      }
    });
  }

  test('paints three palettes that are really different: light on light, dark on dark, white on black', async ({
    page,
  }) => {
    const colours = async () =>
      page.evaluate(() => {
        const read = (value: string): number[] =>
          (value.match(/[\d.]+/gu) ?? []).slice(0, 3).map(Number);
        const brightness = ([r = 0, g = 0, b = 0]: number[]): number => {
          const channel = (value: number): number => {
            const unit = value / 255;
            return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
        };
        const style = getComputedStyle(document.body);
        return {
          page: brightness(read(style.backgroundColor)),
          text: brightness(read(style.color)),
          scheme: getComputedStyle(document.documentElement).colorScheme,
        };
      });
    await openApp(page);
    await chooseSetting(page, 'Light');
    const light = await colours();
    expect(light.page, 'a light page').toBeGreaterThan(0.8);
    expect(light.text, 'dark text on it').toBeLessThan(0.1);
    expect(light.scheme).toBe('light');

    await chooseSetting(page, 'Dark');
    const dark = await colours();
    expect(dark.page, 'a dark page').toBeLessThan(0.05);
    expect(dark.text, 'light text on it').toBeGreaterThan(0.8);
    expect(dark.scheme).toBe('dark');

    await chooseSetting(page, 'High contrast');
    const high = await colours();
    expect(high.page, 'black').toBe(0);
    expect(high.text, 'white').toBe(1);
    expect(high.scheme).toBe('dark');
  });

  test('is applied before the application draws anything, so that there is no flash of the wrong theme', async ({
    page,
  }) => {
    await page.addInitScript(() => window.localStorage.setItem('swarm.theme', 'dark'));
    // The application's own scripts never run: what themes the page is the small script that comes first.
    await page.route('**/assets/*.js', (route) => route.abort());
    await page.goto('/');
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    await expect(chrome(page)).toHaveAttribute('content', CHROME.dark);
  });

  test('never loses the page to a value it does not know: it follows the device instead', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('swarm.theme', 'solarized');
      window.localStorage.setItem('swarm.motion', 'warp');
      window.localStorage.setItem('swarm.mode', 'expert');
    });
    await page.emulateMedia({ colorScheme: 'light', contrast: 'no-preference' });
    await openApp(page);
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
    await expect(html(page)).not.toHaveAttribute('data-motion', /./u);
    const menu = await openSettings(page);
    await expect(menu.getByRole('menuitemradio', { name: 'System' })).toBeChecked();
    await expect(menu.getByRole('menuitemradio', { name: 'Follow device' })).toBeChecked();
  });

  test('when the device forces its own palette, the step in view is still drawn by its edge', async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await openApp(page, { project: projects.brief, scene: 'simulate' });
    await expectScene(page, 'simulate');
    // The fills that told the steps apart are gone; what is left must still tell the one in view from the rest: an
    // edge drawn around the whole step, not only around its icon.
    const edges = await step(page, 'simulate')
      .locator('xpath=ancestor::nav')
      .getByRole('button')
      .evaluateAll((buttons) =>
        buttons.map((button) => {
          const whole = button.getBoundingClientRect();
          return {
            current: button.getAttribute('aria-current') === 'step',
            edged: [...button.querySelectorAll('*')].some((element) => {
              const box = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              return (
                box.width >= whole.width * 0.9 &&
                box.height >= whole.height * 0.9 &&
                style.borderTopStyle !== 'none' &&
                Number.parseFloat(style.borderTopWidth) > 0
              );
            }),
          };
        }),
      );
    expect(edges.filter((item) => item.current && item.edged)).toHaveLength(1);
    expect(edges.filter((item) => !item.current && item.edged)).toHaveLength(0);
  });

  test('when the device forces its own palette, the settings row the keys are on is outlined', async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await openApp(page);
    const menu = await openSettings(page);
    await page.keyboard.press('ArrowDown');
    // Its tint is a background, and the device takes backgrounds away: without an outline the person could not tell
    // which row Enter would act on.
    const row = menu.locator('[data-highlighted]');
    await expect(row).toHaveCount(1);
    const outline = await row.evaluate((element) => {
      const style = getComputedStyle(element);
      return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
    });
    expect(outline.style).toBe('solid');
    expect(outline.width).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------------------------

for (const theme of THEMES) {
  test.describe(`readable in the ${THEME_LABEL[theme]} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((value) => window.localStorage.setItem('swarm.theme', value), theme);
    });

    for (const screen of SCREENS) {
      test(`${screen.name} passes axe and leaves no control in the browser's own colours`, async ({
        page,
      }) => {
        const problems = watchPage(page);
        await page.goto(screenPath(screen, projects));
        await expect(html(page)).toHaveAttribute('data-theme', theme);
        await audit(page, `${theme}: ${screen.name}`);
        if (theme !== 'light')
          await expectNoBrowserPaintedControls(page, `${theme}: ${screen.name}`);
        expect(problems).toEqual([]);
      });
    }

    test(`the first screen filled in from an example passes axe`, async ({ page }) => {
      const problems = watchPage(page);
      await page.goto('/');
      await chooseExampleNamed(page, 'Online store checkout');
      await audit(page, `${theme}: first screen, filled in`);
      if (theme !== 'light') await expectNoBrowserPaintedControls(page, `${theme}: filled in`);
      expect(problems).toEqual([]);
    });

    test('the scenario that is read from a question passes axe', async ({ page }) => {
      const problems = watchPage(page);
      await page.goto('/');
      await chooseExampleNamed(page, 'Online store checkout');
      await page.getByRole('button', { name: 'Explore', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Ground it' })).toBeVisible();
      await audit(page, `${theme}: the scenario that was read`);
      if (theme !== 'light') await expectNoBrowserPaintedControls(page, `${theme}: scenario`);
      expect(problems).toEqual([]);
    });

    test('the history passes axe, and so does a notice', async ({ page }) => {
      const problems = watchPage(page, { refusals: true });
      await page.goto(`/?project=${projects.brief}&scene=ground`);
      await arrived(page);
      await openHistory(page);
      await audit(page, `${theme}: the history`, { scene: false });
      if (theme !== 'light') await expectNoBrowserPaintedControls(page, `${theme}: history`);
      await page.keyboard.press('Escape');
      await expect(historyDialog(page)).toBeHidden();

      // A notice that stays while it is looked at: a failed export is told in an alert.
      await provokeNotice(page);
      await audit(page, `${theme}: a notice`);
      expect(problems.filter((problem) => !problem.includes('500'))).toEqual([]);
    });

    test('the settings menu passes axe', async ({ page }) => {
      await page.goto(`/?project=${projects.brief}&scene=ground`);
      await arrived(page);
      await openSettings(page);
      await audit(page, `${theme}: the settings menu`, { scene: false });
      if (theme !== 'light') await expectNoBrowserPaintedControls(page, `${theme}: settings menu`);
    });
  });
}
