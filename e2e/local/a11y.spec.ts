import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import {
  SCENES,
  SCENE_LABEL,
  addressOf,
  expectScene,
  openApp,
  settled,
  type SceneName,
} from '../support/app';
import { apiContext, expectNoAxeViolations, seed, watchPage } from '../support/helpers';
import {
  PHONE,
  SCREENS,
  arrived,
  audit,
  focusName,
  forget,
  historyButton,
  makeProject,
  openHistory,
  openSettings,
  outlineWidth,
  quiet,
  provokeNotice,
  readJourney,
  screenPath,
  settingsButton,
  type Made,
  type ScreenProjects,
} from '../support/shell';

// Accessibility, in a real browser: axe on every screen at the sizes people use, and the behaviour axe cannot see: the
// skip link, one tab stop for a graph, the keys that move between its nodes, a dialog that keeps focus off the page
// behind it and gives it back, and a journey whose steps say what they are.

const projects: ScreenProjects = { ground: '', proposed: '', brief: '' };
let brief: Made;
/** A project the engine's own stages ran for, which is what the deep dive reads. */
let engine = '';
let api: APIRequestContext;
/** Names are made once per setup: a worker that restarts after a failure sets up again, and must not repeat them. */
const tag = Date.now().toString(36);
const nameOf = (what: string): string => `A11y ${tag}: ${what}`;

test.beforeAll(async ({ playwright }) => {
  api = await apiContext(playwright);
  projects.ground = (await makeProject(api, 'ground', { name: nameOf('ground') })).id;
  projects.proposed = (await makeProject(api, 'proposed', { name: nameOf('proposed') })).id;
  brief = await makeProject(api, 'brief', { name: nameOf('brief') });
  projects.brief = brief.id;
  engine = await seed(api, 'report', { name: nameOf('engine run') });
});

test.afterAll(async () => {
  await forget(api, [...Object.values(projects), engine]);
  await api.dispose();
});

test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

/**
 * Screens that fail a scan because of a defect written up in .scratch/e2e/issues-shell.md. Their tests wait for the
 * fix: take the name out of this list, and the test runs.
 */
const WAITING = new Set<string>([]);

// ---------------------------------------------------------------------------------------------

const SIZES = [
  { name: 'a tablet', viewport: { width: 768, height: 1024 }, theme: 'light' },
  { name: 'a phone', viewport: PHONE.viewport, theme: 'light' },
  { name: 'a phone, in the dark', viewport: PHONE.viewport, theme: 'dark' },
] as const;

for (const size of SIZES) {
  test.describe(`axe on ${size.name}`, () => {
    test.use({ viewport: size.viewport, hasTouch: true });
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(
        (value) => window.localStorage.setItem('swarm.theme', value),
        size.theme,
      );
    });

    for (const screen of SCREENS) {
      const run = WAITING.has(screen.name) ? test.fixme : test;
      run(`${screen.name} has nothing for axe to find`, async ({ page }) => {
        const problems = watchPage(page);
        await page.goto(screenPath(screen, projects));
        await audit(page, `${size.name}: ${screen.name}`);
        expect(problems).toEqual([]);
      });
    }
  });
}

// The views that other scenes are still being finished around: they are asked only to open without a fault and to
// pass axe, which is what the rest of the product is held to.
test.describe('the other views open without a fault and pass axe', () => {
  const VIEWS = [
    ['the decision, as a report', { scene: 'decide', view: 'report' }, true],
    // A sheet over the page: the page behind it is hidden, and there is no scene to wait for.
    ['the decision, with its independent review open', { scene: 'decide', view: 'review' }, false],
    ['the comparison of two recorded runs', { scene: 'compare', view: 'runs' }, true],
  ] as const;
  for (const [name, where, page_] of VIEWS) {
    test(`${name}`, async ({ page }) => {
      const problems = watchPage(page);
      await page.goto(addressOf({ project: brief.id, ...where }));
      await audit(page, name, { scene: page_ });
      expect(problems).toEqual([]);
    });
  }

  test('the report studio', async ({ page }) => {
    const problems = watchPage(page);
    await page.goto(addressOf({ project: brief.id, scene: 'decide', view: 'studio' }));
    await settled(page);
    await quiet(page);
    await expectNoAxeViolations(page, 'the report studio');
    expect(problems).toEqual([]);
  });

  // Written up in .scratch/e2e/issues-shell.md (3): label-content-name-mismatch ×6 in the deep dive.
  test.fixme('the deep dive of a project the engine ran', async ({ page }) => {
    const problems = watchPage(page);
    await page.goto(addressOf({ project: engine, scene: 'simulate', view: 'deep' }));
    await audit(page, 'the deep dive');
    expect(problems).toEqual([]);
  });
});

test.describe('axe over a dialog, on a phone', () => {
  test.use(PHONE);

  test('the history is a sheet from the bottom that passes axe, and so does the question of deleting', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openApp(page, { project: projects.brief, scene: 'ground' });
    const dialog = await openHistory(page);
    await audit(page, 'phone: the history', { scene: false });
    await dialog
      .getByRole('button', { name: new RegExp(`^Delete ${nameOf('ground')}`, 'u') })
      .click();
    await expect(page.getByRole('dialog', { name: /Delete this exploration/u })).toBeVisible();
    await audit(page, 'phone: deleting', { scene: false });
    await page.getByRole('button', { name: 'Keep it' }).click();
    expect(problems).toEqual([]);
  });

  test('a notice passes axe and sits clear of the dock', async ({ page }) => {
    const problems = watchPage(page, { refusals: true });
    await openApp(page, { project: projects.ground, scene: 'ground' });
    const notice = await provokeNotice(page);
    await audit(page, 'phone: a notice');
    // Over the page, not under the dock that a thumb is on.
    const [toast, dock] = await Promise.all([
      notice.boundingBox(),
      page.getByRole('navigation', { name: 'Journey' }).boundingBox(),
    ]);
    expect(
      toast && dock && toast.y + toast.height <= dock.y + 1,
      'the notice is above the dock',
    ).toBe(true);
    expect(problems.filter((problem) => !problem.includes('500'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------

test.describe('the skip link and where a page starts', () => {
  test('is the first stop, shows itself when it has focus, and takes the person to the page', async ({
    page,
  }) => {
    for (const address of [addressOf(), addressOf({ project: brief.id, scene: 'ground' })]) {
      await page.goto(address);
      await arrived(page);
      await page.keyboard.press('Tab');
      const skip = page.getByRole('link', { name: 'Skip to content' });
      await expect(skip).toBeFocused();
      await expect(skip).toBeInViewport({ ratio: 1 });
      expect(await outlineWidth(skip), 'a visible focus').toBeGreaterThanOrEqual(2);
      await page.keyboard.press('Enter');
      await expect(page.getByRole('main')).toBeFocused();
    }
  });

  for (const scene of ['map', 'simulate', 'decide'] as const) {
    test(`a page that is loaded starts at the top, whichever scene its address names: ${scene}`, async ({
      page,
    }) => {
      await page.goto(addressOf({ project: brief.id, scene }));
      await arrived(page);
      await page.keyboard.press('Tab');
      await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    });
  }

  test('every stop of the top bar shows where focus is, with a ring that is not a hair', async ({
    page,
  }) => {
    await openApp(page, { project: brief.id, scene: 'ground' });
    const seen: string[] = [];
    for (let press = 0; press < 12; press += 1) {
      await page.keyboard.press('Tab');
      const stop = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement;
        const style = getComputedStyle(element);
        return {
          inBar: element.closest('header') !== null || element.matches('a[href="#main-content"]'),
          width: Number.parseFloat(style.outlineWidth),
          style: style.outlineStyle,
        };
      });
      seen.push(`${await focusName(page)}: ${stop.style} ${stop.width}px`);
      if (!stop.inBar) break;
      expect(stop.style, seen.join('\n')).not.toBe('none');
      expect(stop.width, seen.join('\n')).toBeGreaterThanOrEqual(2);
    }
    expect(seen.length, 'the bar has stops').toBeGreaterThan(5);
  });
});

// ---------------------------------------------------------------------------------------------

test.describe('the journey is named for assistive technology', () => {
  test('each step is named by its own text, the one in view is the current step, and a locked step says what it needs', async ({
    page,
  }) => {
    await openApp(page, { project: projects.proposed, scene: 'map' });
    const labels = await page
      .getByRole('navigation', { name: 'Journey' })
      .getByRole('button')
      .evaluateAll((buttons) =>
        buttons.map((button) => ({
          visible: (button.textContent ?? '').trim(),
          name: button.getAttribute('aria-label') ?? '',
          current: button.getAttribute('aria-current'),
        })),
      );
    expect(labels.map((label) => label.visible)).toEqual(SCENES.map((scene) => SCENE_LABEL[scene]));
    for (const label of labels) {
      // What a person sees is what a person who cannot see is told, and more.
      expect(label.name.startsWith(label.visible), `${label.visible}: name "${label.name}"`).toBe(
        true,
      );
    }
    expect(
      labels.filter((label) => label.current === 'step').map((label) => label.visible),
    ).toEqual(['Map']);
    expect(labels.map((label) => label.name)).toEqual([
      'Ask, done',
      'Ground, done',
      'Map',
      'Simulate, locked: Needs actors',
      'Compare, locked: Run a simulation first',
      'Decide, locked: Run a simulation first',
    ]);
  });

  test('says in its names which steps are done, so that a glyph is not the only way to know', async ({
    page,
  }) => {
    await openApp(page, { project: brief.id, scene: 'ground' });
    const found = await readJourney(page);
    expect(SCENES.map((scene) => found[scene]?.name)).toEqual([
      'Ask, done',
      'Ground, done',
      'Map, done',
      'Simulate, done',
      'Compare',
      'Decide, done',
    ]);
  });

  test('is one landmark, named Journey, whichever width the page has', async ({ page }) => {
    for (const viewport of [{ width: 1440, height: 900 }, PHONE.viewport]) {
      await page.setViewportSize(viewport);
      await openApp(page, { project: brief.id, scene: 'ground' });
      await expect(page.getByRole('navigation', { name: 'Journey' })).toHaveCount(1);
    }
  });
});

// ---------------------------------------------------------------------------------------------

test.describe('landmarks and headings', () => {
  const SCENES_OF_THE_BRIEF: { name: string; scene: SceneName | null; view?: string }[] = [
    { name: 'the first screen', scene: null },
    ...(['ground', 'map', 'simulate', 'compare', 'decide'] as const).map((scene) => ({
      name: SCENE_LABEL[scene],
      scene,
    })),
  ];
  for (const { name, scene } of SCENES_OF_THE_BRIEF) {
    test(`${name} has one page, one bar and one main heading`, async ({ page }) => {
      await page.goto(scene ? addressOf({ project: brief.id, scene }) : addressOf());
      await arrived(page);
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page.getByRole('banner')).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(page.getByRole('region', { name: 'Notifications' })).toHaveCount(1);
    });
  }
});

// ---------------------------------------------------------------------------------------------

/** The nodes of a graph, by the one that can be reached by Tab: a graph is a single stop, not one for each node. */
async function tabStops(graph: Locator): Promise<number> {
  return graph.locator('[tabindex="0"]').count();
}

test.describe('a graph is one tab stop, and its nodes are reached by keys', () => {
  test('the map of who is in play: one stop, the arrow keys move between parties, Enter reads one, Escape lets go', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openApp(page, { project: brief.id, scene: 'map' });
    const graph = page.getByRole('group', { name: 'Actors and how they relate' });
    const parties = graph.getByRole('button');
    await expect(parties.first()).toBeVisible();
    expect(await parties.count(), 'a map with people on it').toBeGreaterThan(5);
    expect(await tabStops(graph), 'tab stops inside the map').toBe(1);

    // The one stop is the way in; the arrow keys move from party to party, and the stop moves with focus.
    await graph.locator('[tabindex="0"]').focus();
    const first = await focusName(page);
    const visited = new Set([first]);
    for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
      await page.keyboard.press(key);
      visited.add(await focusName(page));
    }
    expect(
      visited.size,
      `parties reached by the arrow keys: ${[...visited].join(' | ')}`,
    ).toBeGreaterThan(2);
    expect(await tabStops(graph), 'still one stop after moving').toBe(1);

    // Enter reads the party in focus, in a panel named for it, and Escape lets go and keeps focus where it was.
    const before = await focusName(page);
    await page.keyboard.press('Enter');
    const name = /"([^,"]+),/u.exec(before)?.[1] ?? '';
    await expect(page.getByRole('complementary', { name })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('complementary', { name })).toHaveCount(0);
    expect(await focusName(page)).toBe(before);
    expect(problems).toEqual([]);
  });

  test('the graph of the evidence: one stop, [ and ] move between topics, Enter opens one, Escape closes it', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openApp(page, { project: brief.id, scene: 'ground' });
    const graph = page.getByRole('group', { name: /^Source graph:/u });
    await expect(graph.getByRole('button').first()).toBeVisible();
    expect(await tabStops(graph), 'tab stops inside the graph').toBe(1);

    await graph.locator('[tabindex="0"]').focus();
    const first = await focusName(page);
    await page.keyboard.press(']');
    const second = await focusName(page);
    expect(second).not.toBe(first);
    await page.keyboard.press('[');
    expect(await focusName(page)).toBe(first);
    await page.keyboard.press(']');

    await page.keyboard.press('Enter');
    const topic = /"([^,"]+),/u.exec(second)?.[1] ?? '';
    await expect(page.getByRole('heading', { level: 2, name: topic })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { level: 2, name: topic })).toHaveCount(0);
    expect(await focusName(page)).toBe(second);
    expect(problems).toEqual([]);
  });

  test('the live replay: one stop among the actors, and the arrow keys move between them', async ({
    page,
  }) => {
    await openApp(page, { project: brief.id, scene: 'simulate' });
    const graph = page.getByRole('group', { name: /^The actors, coloured by where each stands/u });
    await expect(graph.getByRole('button').first()).toBeVisible();
    expect(await tabStops(graph), 'tab stops inside the replay').toBe(1);
    await graph.locator('[tabindex="0"]').focus();
    const first = await focusName(page);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    expect(await focusName(page)).not.toBe(first);
    expect(await tabStops(graph)).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------

test.describe('a dialog keeps focus off the page behind it, closes with Escape, and gives focus back', () => {
  async function trapped(page: Page, dialog: Locator): Promise<void> {
    await expect(dialog).toBeVisible();
    for (let press = 0; press < 30; press += 1) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(
        () => document.activeElement?.closest('[role="dialog"]') !== null,
      );
      expect(inside, `Tab ${press + 1} left the dialog: ${await focusName(page)}`).toBe(true);
    }
  }

  test('the chat about an exploration', async ({ page }) => {
    await openApp(page, { project: brief.id, scene: 'decide' });
    const trigger = page.getByRole('button', { name: 'Ask about this' });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Ask' });
    await trapped(page, dialog);
    await dialog.focus();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('the audit log, opened from the menu: focus goes back to the menu’s button', async ({
    page,
  }) => {
    await openApp(page, { project: brief.id, scene: 'ground' });
    await (await openSettings(page)).getByRole('menuitem', { name: 'Audit log' }).click();
    const dialog = page.getByRole('dialog', { name: 'Audit log' });
    await trapped(page, dialog);
    await dialog.focus();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(settingsButton(page)).toBeFocused();
  });

  test('the question of deleting, opened over the history: Escape closes it first, and the history stays', async ({
    page,
  }) => {
    await openApp(page, { project: brief.id, scene: 'ground' });
    const history = await openHistory(page);
    const remove = history.getByRole('button', {
      name: new RegExp(`^Delete ${nameOf('ground')}`, 'u'),
    });
    await remove.focus();
    await page.keyboard.press('Enter');
    const confirm = page.getByRole('dialog', { name: /Delete this exploration/u });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole('button', { name: 'Keep it' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(confirm).toBeHidden();
    // Nothing was deleted and the history is still open.
    await expect(history).toBeVisible();
    await expect(remove).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(history).toBeHidden();
    await expect(historyButton(page)).toBeFocused();
  });

  test('closing the question of deleting gives focus back to the Delete button that asked', async ({
    page,
  }) => {
    await openApp(page, { project: brief.id, scene: 'ground' });
    const history = await openHistory(page);
    const remove = history.getByRole('button', {
      name: new RegExp(`^Delete ${nameOf('ground')}`, 'u'),
    });
    await remove.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: /Delete this exploration/u })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(remove).toBeFocused();
  });

  test('the page behind is hidden from a screen reader while it is open, and a press on the dimmed part closes it', async ({
    page,
  }) => {
    await openApp(page, { project: brief.id, scene: 'ground' });
    const dialog = await openHistory(page);
    // To a screen reader the page's content is gone: it is not in the tree, the dialog is.
    await expect(page.getByRole('main')).toHaveCount(0);
    await expectNoAxeViolations(page, 'a dialog over a page');
    // Nothing behind it can be pressed: a press outside the sheet closes it, and focus goes back to its button.
    await page.mouse.click(40, 450);
    await expect(dialog).toBeHidden();
    await expect(historyButton(page)).toBeFocused();
    await settled(page);
    await expectScene(page, 'ground');
  });

  test('the top bar is hidden too while a dialog is open, so that nothing but the dialog can be read', async ({
    page,
  }) => {
    await openApp(page, { project: brief.id, scene: 'ground' });
    await openHistory(page);
    await expect(page.getByRole('banner')).toHaveCount(0);
  });
});
