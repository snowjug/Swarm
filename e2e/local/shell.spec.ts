import { readFile } from 'node:fs/promises';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  SCENES,
  SCENE_LABEL,
  addressOf,
  expectScene,
  goTo,
  journey,
  notices,
  openApp,
  projectOf,
  settled,
  step,
} from '../support/app';
import { apiContext, expectNoAxeViolations, listProjects, watchPage } from '../support/helpers';
import { claimsAgainst } from '../support/claims';
import {
  arrived,
  chooseSetting,
  failSceneCode,
  focusName,
  forget,
  historyButton,
  historyDialog,
  makeProject,
  openHistory,
  openSettings,
  PHONE,
  readJourney,
  settingsButton,
  startFromExample,
  stored,
  type Made,
} from '../support/shell';

// The shell around the scenes, in a real browser: the top bar, the journey, the settings, the history, the notices,
// the page that stands when a screen cannot be drawn, and what the product says about itself on each scene. It runs on
// the rules-mode server, so nothing here needs a model. What happens inside a scene belongs to that scene's own specs.

const POSITIONING =
  'Swarm explores scenarios. It does not guarantee or precisely predict real-world behavior.';

test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

const projects = {} as Record<'ground' | 'approved' | 'brief', Made>;
const tag = Date.now().toString(36);
const nameOf = (what: string): string => `Shell ${tag}: ${what}`;
let api: APIRequestContext;

test.beforeAll(async ({ playwright }) => {
  api = await apiContext(playwright);
  projects.ground = await makeProject(api, 'ground', { name: nameOf('ground') });
  projects.approved = await makeProject(api, 'approved', { name: nameOf('approved') });
  projects.brief = await makeProject(api, 'brief', { name: nameOf('brief') });
});

test.afterAll(async () => {
  await forget(
    api,
    Object.values(projects).map((made) => made.id),
  );
  await api.dispose();
});

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const row = (dialog: ReturnType<typeof historyDialog>, name: string) =>
  dialog.getByRole('button', { name: new RegExp(`^${escaped(name)}(?:\\s|$)`, 'u') });

// ---------------------------------------------------------------------------------------------

test.describe('the top bar and the journey', () => {
  test('the first screen has a top bar with the brand, the provider and the two menus, and no journey yet', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openApp(page);
    const bar = page.getByRole('banner');
    await expect(bar.getByRole('button', { name: 'Swarm: start a new question' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Local rules' })).toBeVisible();
    await expect(historyButton(page)).toBeVisible();
    await expect(settingsButton(page)).toBeVisible();
    // Nothing is open to ask about, and no step of a journey has begun.
    await expect(bar.getByRole('button', { name: 'Ask about this' })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Journey' })).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test('an open project adds the journey, in the order of the work, and a way to ask about it', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openApp(page, { project: projects.ground.id, scene: 'ground' });
    const bar = page.getByRole('banner');
    await expect(bar.getByRole('navigation', { name: 'Journey' })).toBeVisible();
    expect(
      await journey(page)
        .getByRole('button')
        .evaluateAll((buttons) => buttons.map((button) => (button.textContent ?? '').trim())),
    ).toEqual(['Ask', 'Ground', 'Map', 'Simulate', 'Compare', 'Decide']);
    await expect(bar.getByRole('button', { name: 'Ask about this' })).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('the brand starts a new question from any scene, and the exploration stays in the history', async ({
    page,
  }) => {
    await openApp(page, { project: projects.brief.id, scene: 'compare' });
    await page.getByRole('button', { name: 'Swarm: start a new question' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'See how a decision could unfold.',
    );
    await expect(page).not.toHaveURL(/[?&](?:project|scene)=/u);
    await expect(page.getByRole('navigation', { name: 'Journey' })).toHaveCount(0);

    const dialog = await openHistory(page);
    await expect(row(dialog, nameOf('brief'))).toBeVisible();
  });

  test('the journey opens each scene in turn, and the address, the title and the focus follow it', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openApp(page, { project: projects.brief.id, scene: 'ground' });
    for (const scene of ['map', 'simulate', 'compare', 'decide', 'ground'] as const) {
      // Wherever the person had got to on the page they leave, the next scene starts at its top.
      await page.evaluate(() => window.scrollTo(0, 400));
      await step(page, scene).click();
      await expectScene(page, scene);
      await expect(page).toHaveTitle(new RegExp(` · ${SCENE_LABEL[scene]} \\| Swarm$`, 'u'));
      await expect(page.getByRole('main')).toBeFocused();
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
      const found = await readJourney(page);
      expect(
        SCENES.filter((name) => found[name]?.current),
        `the step in view after opening ${scene}`,
      ).toEqual([scene]);
    }
    expect(problems).toEqual([]);
  });

  test('the browser’s Back and Forward buttons walk the scenes the person walked', async ({
    page,
  }) => {
    await openApp(page, { project: projects.brief.id, scene: 'ground' });
    await goTo(page, 'map');
    await goTo(page, 'simulate');
    await page.goBack();
    await expectScene(page, 'map');
    await page.goBack();
    await expectScene(page, 'ground');
    await page.goForward();
    await expectScene(page, 'map');
  });

  test('the browser’s Back button leaves a new exploration for the first screen, and Forward comes back to it', async ({
    page,
  }) => {
    const problems = watchPage(page);
    const id = await startFromExample(page, 'Online store checkout');
    await expectScene(page, 'ground');
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'See how a decision could unfold.',
    );
    await expect(page.getByRole('navigation', { name: 'Journey' })).toHaveCount(0);
    await page.goForward();
    await expectScene(page, 'ground');
    expect(projectOf(page)).toBe(id);
    await forget(api, [id]);
    expect(problems).toEqual([]);
  });

  test('the page title names the exploration and the scene in view, and the first screen has its own', async ({
    page,
  }) => {
    await openApp(page);
    await expect(page).toHaveTitle('Swarm | Explore what could happen next');
    await openApp(page, { project: projects.brief.id, scene: 'simulate' });
    await expect(page).toHaveTitle(`${nameOf('brief')} · Simulate | Swarm`);
  });
});

// ---------------------------------------------------------------------------------------------

test.describe('the settings menu', () => {
  test('is one menu of choices for how the page looks, moves and speaks, and holds the project’s tools only for an open project', async ({
    page,
  }) => {
    await openApp(page);
    let menu = await openSettings(page);
    await expect(menu.getByRole('menuitemradio')).toHaveText([
      'System',
      'Light',
      'Dark',
      'High contrast',
      'Follow device',
      'Reduced',
      'Full',
      /^Guided/u,
      /^Advanced/u,
    ]);
    await expect(menu.getByRole('menuitemradio', { name: 'System' })).toBeChecked();
    await expect(menu.getByRole('menuitemradio', { name: 'Follow device' })).toBeChecked();
    await expect(menu.getByRole('menuitemradio', { name: /^Guided/u })).toBeChecked();
    // No project, so no tools of one (only the way into the search); on a local installation nobody signs in.
    await expect(menu.getByRole('menuitem')).toHaveText([/^Search and commands/u]);
    await expect(menu).toContainText('Local · single user');
    await expect(menu).toContainText(/Swarm v\d[\w.-]* · AGPL-3\.0/u);
    await page.keyboard.press('Escape');

    await openApp(page, { project: projects.ground.id, scene: 'ground' });
    menu = await openSettings(page);
    await expect(menu.getByRole('menuitem')).toHaveText([
      /^Search and commands/u,
      'Refresh',
      'Duplicate as a new question',
      'Export snapshot',
      'Audit log',
    ]);
  });

  test('can be used from the keyboard alone: it opens, moves, chooses, and gives focus back', async ({
    page,
  }) => {
    await openApp(page, { project: projects.ground.id, scene: 'ground' });
    await settingsButton(page).focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu', { name: 'Settings and tools' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /^Search and commands/u })).toBeFocused();
    // One key at a time, as a person presses them: the menu moves focus after the key, not during it.
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitemradio', { name: 'System' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitemradio', { name: 'Light' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitemradio', { name: 'Dark' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(menu).toBeHidden();
    await expect(settingsButton(page)).toBeFocused();

    // Escape lets go of the menu without choosing anything.
    await page.keyboard.press('Enter');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(settingsButton(page)).toBeFocused();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('Advanced adds the engine’s own terms to a scene, Guided takes them away, and the choice is kept', async ({
    page,
  }) => {
    await openApp(page, { project: projects.brief.id, scene: 'ground' });
    const engineTerms = page.getByText(/Graph Build: ready/u);
    await expect(engineTerms).toHaveCount(0);
    expect(await stored(page, 'swarm.mode')).toBeNull();

    await chooseSetting(page, /^Advanced/u);
    await expect(engineTerms).toBeVisible();
    expect(await stored(page, 'swarm.mode')).toBe('advanced');

    await page.reload();
    await settled(page);
    await expect(engineTerms).toBeVisible();
    const menu = await openSettings(page);
    await expect(menu.getByRole('menuitemradio', { name: /^Advanced/u })).toBeChecked();
    await menu.getByRole('menuitemradio', { name: /^Guided/u }).click();
    await expect(engineTerms).toHaveCount(0);
    expect(await stored(page, 'swarm.mode')).toBe('guided');
  });

  test('never loses the page to a mode it does not know', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('swarm.mode', 'expert'));
    await openApp(page);
    const menu = await openSettings(page);
    await expect(menu.getByRole('menuitemradio', { name: /^Guided/u })).toBeChecked();
  });

  test('Duplicate opens the first screen with this question and its evidence, and makes nothing until it is asked to', async ({
    page,
  }) => {
    const id = projects.ground.id;
    const project = (await (await api.get(`/api/projects/${id}`)).json()) as {
      question: string;
      documents: { name: string }[];
    };
    await openApp(page, { project: id, scene: 'ground' });
    const before = (await listProjects(api)).length;
    await (
      await openSettings(page)
    )
      .getByRole('menuitem', { name: 'Duplicate as a new question' })
      .click();

    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'See how a decision could unfold.',
    );
    await expect(page.getByRole('textbox', { name: 'Your what-if question' })).toHaveValue(
      project.question,
    );
    await expect(
      page.getByRole('list', { name: 'Attached evidence' }).getByRole('listitem'),
    ).toHaveCount(project.documents.length);
    expect((await listProjects(api)).length).toBe(before);
  });

  test('Export snapshot downloads the exploration as a file that holds the record and its evidence', async ({
    page,
  }) => {
    const id = projects.brief.id;
    await openApp(page, { project: id, scene: 'decide' });
    const download = page.waitForEvent('download');
    await (await openSettings(page)).getByRole('menuitem', { name: 'Export snapshot' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`swarm-lab-${id}.json`);
    const snapshot = JSON.parse(await readFile(await file.path(), 'utf8')) as {
      schemaVersion: number;
      exportedAt: string;
      project: { id: string; name: string; workflow: string; question: string };
      evidence: unknown[];
    };
    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.project).toMatchObject({ id, name: nameOf('brief'), workflow: 'guided' });
    expect(snapshot.project.question.length).toBeGreaterThan(10);
    expect(Number.isNaN(Date.parse(snapshot.exportedAt))).toBe(false);
    expect(snapshot.evidence.length).toBeGreaterThan(0);
  });

  test('an export that fails says so in a notice that stays until it is dismissed, and nothing is downloaded', async ({
    page,
  }) => {
    await openApp(page, { project: projects.ground.id, scene: 'ground' });
    await page.route('**/api/projects/*/export*', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'EXPORT_FAILED', message: 'The export failed.' } }),
      }),
    );
    let downloaded = false;
    page.on('download', () => (downloaded = true));
    await (await openSettings(page)).getByRole('menuitem', { name: 'Export snapshot' }).click();

    const notice = notices(page).getByRole('alert');
    await expect(notice).toContainText('Could not export');
    await expect(notice).toContainText('The export failed.');
    // A failure is an alert, which is read out at once, and it waits for the person: it does not leave by itself.
    await notices(page).getByRole('button', { name: 'Dismiss' }).click();
    await expect(notice).toHaveCount(0);
    expect(downloaded).toBe(false);
  });

  test('the audit log opens over the page and gives focus back to the menu that opened it', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openApp(page, { project: projects.ground.id, scene: 'ground' });
    await (await openSettings(page)).getByRole('menuitem', { name: 'Audit log' }).click();
    const dialog = page.getByRole('dialog', { name: 'Audit log' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(settingsButton(page)).toBeFocused();
    expect(problems).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------

test.describe('the history', () => {
  test('lists the explorations, marks the one that is open, and opens another where its work has got to', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openApp(page, { project: projects.ground.id, scene: 'ground' });
    const dialog = await openHistory(page);
    await expect(row(dialog, nameOf('ground'))).toContainText('Open now');
    await expect(row(dialog, nameOf('brief'))).not.toContainText('Open now');
    // Newest first: the brief was made after the ground project.
    const names = await dialog
      .getByRole('listitem')
      .getByRole('button', { name: new RegExp(`^${escaped(`Shell ${tag}:`)}`, 'u') })
      .evaluateAll((buttons) => buttons.map((button) => button.textContent ?? ''));
    const order = (name: string) => names.findIndex((text) => text.startsWith(name));
    expect(order(nameOf('brief'))).toBeLessThan(order(nameOf('ground')));

    await row(dialog, nameOf('brief')).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`[?&]project=${projects.brief.id}`, 'u'));
    // A finished exploration opens on its answer.
    await expectScene(page, 'decide');
    await expect(page).toHaveTitle(`${nameOf('brief')} · Decide | Swarm`);
    expect(problems).toEqual([]);
  });

  test('can be searched, says when nothing matches, and gives the list back', async ({ page }) => {
    await openApp(page, { project: projects.ground.id, scene: 'ground' });
    const dialog = await openHistory(page);
    const search = dialog.getByRole('searchbox', { name: 'Search your explorations' });
    await search.fill(nameOf('approved'));
    await expect(dialog.getByRole('listitem')).toHaveCount(1);
    await expect(row(dialog, nameOf('approved'))).toBeVisible();

    await search.fill('zzz nothing is called this');
    await expect(dialog.getByText('No match')).toBeVisible();
    await expect(dialog.getByRole('listitem')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Clear the search' }).click();
    await expect(row(dialog, nameOf('ground'))).toBeVisible();
    await expect(search).toHaveValue('');
  });

  test('with nothing in it, offers to ask a question and leaves for the question field', async ({
    page,
  }) => {
    await page.route('**/api/projects', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({ projects: [], total: 0 }),
          })
        : route.continue(),
    );
    await openApp(page);
    const dialog = await openHistory(page);
    await expect(dialog.getByRole('heading', { name: 'Nothing yet' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Ask a question' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('textbox', { name: 'Your what-if question' })).toBeFocused();
  });

  test('deletes an exploration only when asked twice, and leaves the others alone', async ({
    page,
  }) => {
    const disposable = await makeProject(api, 'fresh', { name: nameOf('to delete') });
    await openApp(page, { project: projects.ground.id, scene: 'ground' });
    const dialog = await openHistory(page);
    await expect(row(dialog, nameOf('to delete'))).toBeVisible();

    await dialog.getByRole('button', { name: `Delete ${nameOf('to delete')}` }).click();
    const confirm = page.getByRole('dialog', { name: /Delete this exploration/u });
    await expect(confirm).toContainText('cannot be undone');
    await confirm.getByRole('button', { name: 'Keep it' }).click();
    await expect(confirm).toBeHidden();
    await expect(row(dialog, nameOf('to delete'))).toBeVisible();
    expect((await listProjects(api)).some((project) => project.id === disposable.id)).toBe(true);

    await dialog.getByRole('button', { name: `Delete ${nameOf('to delete')}` }).click();
    await page
      .getByRole('dialog', { name: /Delete this exploration/u })
      .getByRole('button', { name: 'Delete permanently' })
      .click();
    await expect(row(dialog, nameOf('to delete'))).toHaveCount(0);
    const left = await listProjects(api);
    expect(left.some((project) => project.id === disposable.id)).toBe(false);
    expect(left.some((project) => project.id === projects.ground.id)).toBe(true);
    expect(left.some((project) => project.id === projects.brief.id)).toBe(true);
  });

  test('deleting the exploration that is open leaves the page on the first screen, not on something that is gone', async ({
    page,
  }) => {
    const problems = watchPage(page);
    const disposable = await makeProject(api, 'ground', { name: nameOf('open and deleted') });
    await openApp(page, { project: disposable.id, scene: 'ground' });
    const dialog = await openHistory(page);
    await dialog.getByRole('button', { name: `Delete ${nameOf('open and deleted')}` }).click();
    const confirm = page.getByRole('dialog', { name: /Delete this exploration/u });
    await confirm.getByRole('button', { name: 'Delete permanently' }).click();
    await expect(confirm).toBeHidden();
    await expect(row(dialog, nameOf('open and deleted'))).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'See how a decision could unfold.',
    );
    await expect(page).not.toHaveURL(/[?&]project=/u);
    expect(problems).toEqual([]);
  });

  test('is a dialog for the keyboard: focus stays in it, the arrow keys move between rows, Escape gives focus back', async ({
    page,
  }) => {
    await openApp(page, { project: projects.ground.id, scene: 'ground' });
    await historyButton(page).focus();
    await page.keyboard.press('Enter');
    const dialog = historyDialog(page);
    await expect(dialog).toBeVisible();

    // The arrow keys, Home and End move between the rows, without a mouse.
    const rows = dialog.getByRole('listitem').getByRole('button').first();
    await rows.focus();
    const first = await focusName(page);
    await page.keyboard.press('ArrowDown');
    const second = await focusName(page);
    expect(second).not.toBe(first);
    await page.keyboard.press('End');
    const last = await focusName(page);
    expect(last).not.toBe(second);
    await page.keyboard.press('Home');
    expect(await focusName(page)).toBe(first);

    // Tabbing never reaches the page behind it.
    for (let press = 0; press < 30; press += 1) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(
        () => document.activeElement?.closest('[role="dialog"]') !== null,
      );
      expect(inside, `Tab ${press + 1} left the dialog: ${await focusName(page)}`).toBe(true);
    }
    // A tooltip that is still leaving takes an Escape of its own, so it is let go first.
    await dialog.getByRole('searchbox', { name: 'Search your explorations' }).focus();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(historyButton(page)).toBeFocused();
  });

  test('closes on the first Escape, and gives focus back to the button that opened it', async ({
    page,
  }) => {
    await openApp(page, { project: projects.ground.id, scene: 'ground' });
    await openHistory(page);
    await page.keyboard.press('Escape');
    await expect(historyDialog(page)).toBeHidden();
    await expect(historyButton(page)).toBeFocused();
  });
});

// ---------------------------------------------------------------------------------------------

test.describe('notices', () => {
  test('are announced politely, can be dismissed, and never pile up', async ({ page }) => {
    await openApp(page, { project: projects.approved.id, scene: 'map' });
    const region = notices(page);
    await expect(region).toHaveAttribute('aria-live', 'polite');
    const locked = step(page, 'compare');
    for (let press = 0; press < 6; press += 1) await locked.click({ force: true });
    await expect(region.getByRole('status').first()).toContainText('Run a simulation first');
    // The ones that were pushed out are still on their way out for a moment, and then there are four at most.
    await expect.poll(() => region.getByRole('status').count()).toBeLessThanOrEqual(4);

    const shown = await region.getByRole('status').count();
    await region.getByRole('button', { name: 'Dismiss' }).first().click();
    await expect(region.getByRole('status')).toHaveCount(shown - 1);
  });
});

// ---------------------------------------------------------------------------------------------

test.describe('a screen that cannot be drawn', () => {
  test('is replaced by a page that says so, offers a way out, takes focus, and recovers when the cause is gone', async ({
    page,
  }) => {
    await failSceneCode(page);
    await page.goto(addressOf({ project: projects.ground.id, scene: 'ground' }));

    const heading = page.getByRole('heading', {
      level: 1,
      name: 'Something didn’t render correctly.',
    });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    await expect(page).toHaveTitle('Something went wrong · Swarm');
    await expect(
      page.getByText('Your saved projects are held by the server. Reload to reconnect.'),
    ).toBeVisible();
    // The cause is one gesture away, for the person who has to report it.
    await expect(page.locator('details pre')).toBeHidden();
    await page.getByText('Technical details').click();
    await expect(page.locator('details pre')).not.toBeEmpty();
    await expectNoAxeViolations(page, 'the page that stands when a screen fails');

    // Reload reads everything again, and now the code arrives.
    await page.unroute('**/assets/index-*.js');
    await page.getByRole('button', { name: 'Reload' }).click();
    await settled(page);
    await expectScene(page, 'ground');
  });

  test('can be left from the front door, which needs none of the scenes', async ({ page }) => {
    await failSceneCode(page);
    await page.goto(addressOf({ project: projects.ground.id, scene: 'ground' }));
    await expect(
      page.getByRole('heading', { level: 1, name: 'Something didn’t render correctly.' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Start over' }).click();
    await settled(page);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'See how a decision could unfold.',
    );
  });

  test('looks right in the dark theme too', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('swarm.theme', 'dark'));
    await failSceneCode(page);
    await page.goto(addressOf({ project: projects.ground.id, scene: 'ground' }));
    await expect(
      page.getByRole('heading', { level: 1, name: 'Something didn’t render correctly.' }),
    ).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expectNoAxeViolations(page, 'dark: the page that stands when a screen fails');
  });
});

// ---------------------------------------------------------------------------------------------

test.describe('asking about an exploration', () => {
  test('the button opens the chat over the page, and Escape gives focus back to it', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openApp(page, { project: projects.brief.id, scene: 'decide' });
    const button = page.getByRole('button', { name: 'Ask about this' });
    await button.click();
    const dialog = page.getByRole('dialog', { name: 'Ask' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();
    expect(problems).toEqual([]);
  });

  test('with no report to read from, it says where the report is written and opens that place', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openApp(page, { project: projects.brief.id, scene: 'decide' });
    await page.getByRole('button', { name: 'Ask about this' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ask' });
    await expect(
      dialog.getByRole('heading', { name: 'Ask opens after the deep dive' }),
    ).toBeVisible();
    await expect(dialog).toContainText(
      'The analyst and the actors answer from the report it writes.',
    );
    await dialog.getByRole('button', { name: 'Open the deep dive' }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/[?&]scene=simulate&view=deep(?:&|$)/u);
    await expect(page.getByRole('main')).toBeFocused();
    expect(problems).toEqual([]);
  });

  test('where the deep dive is still shut, it says what opens it and offers nothing that would not work', async ({
    page,
  }) => {
    await openApp(page, { project: projects.ground.id, scene: 'ground' });
    await page.getByRole('button', { name: 'Ask about this' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ask' });
    await expect(
      dialog.getByRole('heading', { name: 'Ask opens after the deep dive' }),
    ).toBeVisible();
    await expect(dialog).toContainText('The deep dive opens once the actors are made.');
    await expect(dialog.getByRole('button', { name: /deep dive|Watch/u })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('the shortcut that the button advertises opens it, and Escape closes it', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openApp(page, { project: projects.brief.id, scene: 'decide' });
    const button = page.getByRole('button', { name: 'Ask about this' });
    await button.hover();
    await expect(page.getByRole('tooltip')).toContainText('/');
    await page.mouse.move(5, 400);
    await page.keyboard.press('/');
    const dialog = page.getByRole('dialog', { name: 'Ask' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(problems).toEqual([]);
  });

  test('a slash typed in a field is a slash: it is not taken for the shortcut', async ({
    page,
  }) => {
    await openApp(page, { project: projects.brief.id, scene: 'ground' });
    await page.getByRole('button', { name: 'Find a topic' }).click();
    const find = page.getByRole('searchbox', { name: 'Find in the graph' });
    await find.focus();
    await page.keyboard.type('and/or');
    await expect(find).toHaveValue('and/or');
    await expect(page.getByRole('dialog', { name: 'Ask' })).toHaveCount(0);

    // Nor on the first screen, where there is nothing yet to ask about.
    await page.goto(addressOf());
    await settled(page);
    const question = page.getByRole('textbox', { name: 'Your what-if question' });
    await question.fill('');
    await question.pressSequentially('a/b');
    await expect(question).toHaveValue('a/b');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('over a dialog or a menu, the slash goes to what is open and opens nothing more', async ({
    page,
  }) => {
    await openApp(page, { project: projects.brief.id, scene: 'ground' });
    const history = await openHistory(page);
    const search = history.getByRole('searchbox', { name: 'Search your explorations' });
    await search.focus();
    await page.keyboard.type('a/b');
    await expect(search).toHaveValue('a/b');
    await search.blur();
    await page.keyboard.press('/');
    await expect(page.getByRole('dialog', { name: 'Ask' })).toHaveCount(0);
    await expect(history).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(history).toBeHidden();

    const menu = await openSettings(page);
    await page.keyboard.press('/');
    await expect(menu).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });

  test('with the Control or Command key it is left to the browser, and there is no exploration to ask about on the first screen', async ({
    page,
  }) => {
    await openApp(page, { project: projects.brief.id, scene: 'ground' });
    await page.keyboard.press('Control+/');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.goto(addressOf());
    await settled(page);
    await page.getByRole('heading', { level: 1 }).click();
    await page.keyboard.press('/');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------------------------

/** The sentences that keep the product honest, scene by scene, and the short forms a phone has room for. */
const SAYS = [
  ['the first screen', '/', POSITIONING, POSITIONING],
  [
    'the map',
    'map',
    /synthetic stand-ins, not real people/iu,
    /synthetic stand-ins, not real people/iu,
  ],
  ['the simulation', 'simulate', /Not a prediction/iu, /Synthetic actors\. Not a prediction/iu],
  ['the comparison', 'compare', /not a forecast/iu, /not a forecast/iu],
  ['the decision brief', 'decide', /synthetic stand-ins/iu, /synthetic stand-ins/iu],
] as const;

/** Prose is judged a sentence at a time: a forecast is a claim, wherever it is made. */
async function expectNoForecasts(page: Page): Promise<void> {
  const prose = await page
    .getByRole('main')
    .locator('p, li, h1, h2, h3, dd, figcaption')
    .evaluateAll((elements) =>
      elements
        .filter((element) => !element.closest('svg, table, [role=img], blockquote, [role=meter]'))
        .map((element) => (element.textContent ?? '').replace(/\s+/gu, ' ').trim())
        .filter((text) => text.split(' ').length >= 6),
    );
  expect(prose.length).toBeGreaterThan(0);
  const predictions = prose.flatMap((text) =>
    claimsAgainst(text).filter((claim) => claim.startsWith('a prediction')),
  );
  expect(predictions).toEqual([]);
}

test.describe('what the product says about itself', () => {
  for (const [where, scene, says] of SAYS) {
    test(`${where} says what it is, where it says what it found, and never says what will happen`, async ({
      page,
    }) => {
      await openApp(
        page,
        scene === '/' ? {} : { project: projects.brief.id, scene: scene as 'map' },
      );
      // Said where it can be read, not only present in the page.
      await expect(
        page.getByRole('main').getByText(says).locator('visible=true').first(),
      ).toBeVisible();
      await expectNoForecasts(page);
    });
  }

  test.describe('on a phone', () => {
    test.use(PHONE);

    for (const [where, scene, , says] of SAYS) {
      test(`${where} still says it where there is little room`, async ({ page }) => {
        await openApp(
          page,
          scene === '/' ? {} : { project: projects.brief.id, scene: scene as 'map' },
        );
        await expect(
          page.getByRole('main').getByText(says).locator('visible=true').first(),
        ).toBeVisible();
        await expectNoForecasts(page);
      });
    }
  });
});

// The tab order of the top bar is the reading order: skip link, brand, the journey, then the tools.
test('the top bar is reached in reading order from the keyboard', async ({ page }) => {
  await page.goto(addressOf({ project: projects.ground.id, scene: 'ground' }));
  await arrived(page);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  const expected = [
    'Swarm: start a new question',
    'Ask, done',
    'Ground, done',
    'Map',
    /^Simulate, locked/u,
    /^Compare, locked/u,
    /^Decide, locked/u,
    'Local rules',
    'Search and commands',
    'Ask about this',
    'History',
    'Settings and tools',
  ];
  for (const name of expected) {
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('banner').getByRole('button', { name, exact: typeof name === 'string' }),
    ).toBeFocused();
  }
  // After the bar comes the page.
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.closest('main') !== null)).toBe(true);
});
