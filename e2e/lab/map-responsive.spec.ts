import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openApp, type ThemeName } from '../support/app';
import {
  expectNoBrowserPaintedControls,
  expectTargetSizes,
  expectTouchTargets,
  openDisclosure,
  renderedSvgTextPx,
  svgLabelCollisions,
  viewports,
  watchPage,
} from '../support/helpers';
import {
  deleteMade,
  ecosystem,
  exampleSeed,
  expectControlsInside,
  expectSound,
  findWho,
  holdsStill,
  inspector,
  live,
  makeProject,
  mapControls,
  mapRegion,
  party,
  partyNodes,
  pill,
  roster,
  rosterRow,
  stakeholdersViewOf,
} from '../support/ground-map';

// The Map scene at every size a person uses it at, in each theme: no sideways scroll, text that reads, a picture whose
// parties are in view and clear of what floats over it, targets that can be reached (by a finger on a phone), and the
// detail of a party, which is a panel beside the map where there is room and a strip under it, with the rest in a
// sheet, where there is not.

test.use({ actionTimeout: 15_000, reducedMotion: 'reduce' });
test.afterEach(({ request }) => deleteMade(request));

const SHOP = exampleSeed('ecommerce-experience');
const THEMES: ThemeName[] = ['light', 'dark', 'high-contrast'];
const PICTURE = '[role="group"][aria-label$="how they relate"]';

/** Every party that is drawn is inside the screen, and none is under what floats over the picture. */
async function expectPartiesClear(page: Page, label: string): Promise<void> {
  const overlays: { name: string; box: Locator }[] = [
    { name: 'the heading', box: mapRegion(page).getByRole('heading', { level: 1 }) },
    { name: 'the controls', box: mapControls(page) },
    { name: 'the pill', box: pill(page) },
    { name: 'the key', box: page.getByRole('button', { name: 'How to read this map' }) },
    { name: 'the zoom', box: page.getByRole('group', { name: 'Zoom' }) },
    { name: 'the party that is open', box: page.getByRole('complementary') },
  ];
  const regions: { name: string; x: number; y: number; width: number; height: number }[] = [];
  for (const overlay of overlays) {
    if ((await overlay.box.count()) === 0) continue;
    const box = await overlay.box.first().boundingBox();
    if (box) regions.push({ name: overlay.name, ...box });
  }
  const parties = await partyNodes(page).evaluateAll((nodes) =>
    nodes
      .filter(
        (node) =>
          !node.closest('[aria-hidden="true"]') &&
          !node.parentElement?.classList.contains('is-dim'),
      )
      .map((node) => {
        const box = node.getBoundingClientRect();
        return {
          name: (node.getAttribute('aria-label') ?? '').split(', ')[0] ?? '',
          x: box.x + box.width / 2,
          y: box.y + box.height / 2,
        };
      }),
  );
  const viewport = page.viewportSize()!;
  const problems: string[] = [];
  for (const node of parties) {
    if (node.x < 0 || node.y < 0 || node.x > viewport.width || node.y > viewport.height) {
      problems.push(
        `${node.name} is outside the screen (${Math.round(node.x)}, ${Math.round(node.y)})`,
      );
    }
    for (const region of regions) {
      if (
        node.x > region.x &&
        node.x < region.x + region.width &&
        node.y > region.y &&
        node.y < region.y + region.height
      ) {
        problems.push(`${node.name} is under ${region.name}`);
      }
    }
  }
  expect(problems, `parties out of view: ${label}`).toEqual([]);
}

test.describe('at every size', () => {
  for (const viewport of viewports) {
    test(`fits at ${viewport.name}: before it finds anyone, with the stakeholders, in the list and with the actors, in every theme`, async ({
      page,
      request,
    }) => {
      test.setTimeout(300_000);
      const problems = watchPage(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const first = await makeProject(request, SHOP, 'ground');
      const proposed = await makeProject(request, SHOP, 'proposed');
      const actors = await makeProject(request, SHOP, 'actors');
      const names = live(await stakeholdersViewOf(request, proposed)).map((item) => item.name);
      const label = (what: string, theme: string) => `map at ${viewport.name}, ${theme}: ${what}`;

      for (const theme of THEMES) {
        const light = theme === 'light';
        // A control the browser paints itself, in a theme that is not the light one, is a white box on a dark page.
        const sound = async (what: string): Promise<void> => {
          await expectSound(page, label(what, theme));
          if (!light) await expectNoBrowserPaintedControls(page, label(what, theme));
        };
        // Before anything is found: the way in.
        if (light) {
          await openApp(page, { project: first, scene: 'map', theme });
          await expect(page.getByRole('button', { name: 'Find who is affected' })).toBeVisible();
          await sound('nothing found yet');
        }

        // The stakeholders, none chosen and one chosen.
        await openApp(page, { project: proposed, scene: 'map', theme });
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(partyNodes(page)).toHaveCount(names.length);
        await sound('the stakeholders');
        if (light) {
          await expectPartiesClear(page, label('the stakeholders', theme));
          expect(
            await svgLabelCollisions(page, PICTURE),
            label('names that overlap', theme),
          ).toEqual([]);
          const sizes = await renderedSvgTextPx(page, PICTURE);
          expect(sizes.length).toBeGreaterThan(0);
          expect(
            Math.min(...sizes),
            label('the smallest name drawn', theme),
          ).toBeGreaterThanOrEqual(11.5);
        }
        await party(page, 'Sellers').click();
        await expect(inspector(page, 'Sellers')).toBeVisible();
        await sound('a party chosen');
        // Where the panel floats over the map, the map has moved so that no party is under it.
        if (light && viewport.width >= 1024) {
          await page.keyboard.press('f');
          await expectPartiesClear(page, label('a party chosen', theme));
        }

        // The list.
        await openApp(page, { project: proposed, scene: 'map', view: 'list', theme });
        await expect(roster(page)).toBeVisible();
        await sound('the list');
        if (light) {
          await rosterRow(page, 'Sellers').click();
          await expect(inspector(page, 'Sellers')).toBeVisible();
          await sound('the list with a party open');

          // The actors.
          await openApp(page, { project: actors, scene: 'map', theme });
          await expect(partyNodes(page)).toHaveCount(names.length);
          await sound('the actors');
        }
      }
      expect(problems).toEqual([]);
    });
  }

  test('the button that reviews the next party is named by what it says', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const proposed = await makeProject(request, SHOP, 'proposed');
    await openApp(page, { project: proposed, scene: 'map' });
    const button = pill(page).getByRole('button', { name: /to review/u });
    await expect(button).toBeVisible();
    const result = await new AxeBuilder({ page })
      .include('.sw-pill__progress')
      .withRules(['label-content-name-mismatch'])
      .analyze();
    expect(
      result.violations.map((violation) => `${violation.id}: ${violation.help}`),
      `the accessible name is "${await button.getAttribute('aria-label')}", the words on it are "${(await button.innerText()).replace(/\s+/gu, ' ')}"`,
    ).toEqual([]);
  });

  test('every control a pointer has to reach is large enough, on the map, in the list and in the panel of a party', async ({
    page,
    request,
  }) => {
    const proposed = await makeProject(request, SHOP, 'proposed');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page, { project: proposed, scene: 'map' });
    await expect(partyNodes(page)).not.toHaveCount(0);
    await expectTargetSizes(page, 'map: the stakeholders');
    await party(page, 'Sellers').click();
    await expectTargetSizes(page, 'map: a party chosen');
    await openApp(page, { project: proposed, scene: 'map', view: 'list' });
    await rosterRow(page, 'Sellers').click();
    await expectTargetSizes(page, 'map: the list with a party open');
  });
});

test.describe('on a laptop', () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test('the one thing to do next stays on the screen before, during and after the review', async ({
    page,
    request,
  }) => {
    const ground = await makeProject(request, SHOP, 'ground');
    await openApp(page, { project: ground, scene: 'map' });
    const find = page.getByRole('button', { name: 'Find who is affected' });
    await expect(find).toBeInViewport({ ratio: 1 });
    await find.click();
    await expect(ecosystem(page)).toBeVisible();

    const approve = pill(page).getByRole('button', { name: 'Approve & create actors' });
    await expect(approve).toBeInViewport({ ratio: 1 });
    // A party that is open is a panel beside the map: it does not push the action off the screen.
    await pill(page)
      .getByRole('button', { name: /to review, next/iu })
      .click();
    await expect(page.getByRole('complementary')).toBeVisible();
    await expect(approve).toBeInViewport({ ratio: 1 });
    await expectPartiesClear(page, 'laptop: a party open during the review');

    await approve.click();
    await expect(pill(page).getByRole('button', { name: 'Simulate' })).toBeInViewport({ ratio: 1 });
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the controls fit the screen: a menu for what is secondary, the key, the pill', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const proposed = await makeProject(request, SHOP, 'proposed');
    await openApp(page, { project: proposed, scene: 'map' });
    await expect(partyNodes(page)).not.toHaveCount(0);
    await expectControlsInside(mapControls(page), 'the controls of the map on a phone');
    await expectControlsInside(pill(page), 'the pill on a phone');
    // The responsible-use line is short here, not gone: the long sentence is for the screens that have the room.
    await expect(
      page.getByText('Synthetic stand-ins, not real people.', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Actors are synthetic stand-ins, not real people: every number is an assumption you can change.',
      ),
    ).toBeHidden();

    // Groups, focus and adding are in one menu, and the picture has a key.
    await mapControls(page).getByRole('button', { name: 'More' }).tap();
    const menu = page.getByRole('menu');
    await expect(menu.getByText('Groups', { exact: true })).toBeVisible();
    await expect(menu.getByRole('menuitemcheckbox').first()).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Add a stakeholder…' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'How to read this map' }).tap();
    await expect(page.getByRole('dialog')).toContainText('Lines are relations');
    await expectSound(page, 'map on a phone: the key open');
    expect(problems).toEqual([]);
  });

  test('a party chosen on the map is a strip under it with its actions, and the strip fits the screen', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const proposed = await makeProject(request, SHOP, 'proposed');
    await openApp(page, { project: proposed, scene: 'map' });
    await expect(partyNodes(page)).not.toHaveCount(0);

    await party(page, 'Sellers').tap({ force: true });
    const strip = inspector(page, 'Sellers');
    await expect(strip).toBeVisible();
    await expect(strip.getByRole('heading', { level: 2, name: 'Sellers' })).toBeVisible();
    // The pill gives the strip the room, and everything the strip offers is on the screen.
    await expect(page.getByRole('group', { name: 'Next' })).toHaveCount(0);
    await expectSound(page, 'map on a phone: the strip of a party');
    await expectControlsInside(strip, 'the strip of a party on a phone');
    expect(problems).toEqual([]);
  });

  test('the rest of a party is a sheet from the bottom, which fits the screen and closes', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const proposed = await makeProject(request, SHOP, 'proposed');
    await openApp(page, { project: proposed, scene: 'map' });
    await party(page, 'Sellers').tap({ force: true });
    await holdsStill(inspector(page, 'Sellers'));
    await inspector(page, 'Sellers').getByRole('button', { name: 'Details' }).tap({ force: true });
    const sheet = page.getByRole('dialog', { name: 'Sellers' });
    await expect(sheet).toBeVisible();
    const box = (await sheet.boundingBox())!;
    expect(box.x).toBeLessThanOrEqual(1);
    expect(box.x + box.width).toBeGreaterThanOrEqual(389);
    expect(box.y + box.height).toBeGreaterThanOrEqual(843);
    await expectControlsInside(sheet, 'the sheet of a party on a phone');
    await openDisclosure(sheet, /^Evidence \d+$/u);
    await expectSound(page, 'map on a phone: the sheet of a party');
    await sheet.getByRole('button', { name: 'Close', exact: true }).tap();
    await expect(sheet).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test('every control on the map is large enough for a finger', async ({ page, request }) => {
    const proposed = await makeProject(request, SHOP, 'proposed');
    await openApp(page, { project: proposed, scene: 'map' });
    await expect(partyNodes(page)).not.toHaveCount(0);
    await expectTouchTargets(page, 'map on a phone: the stakeholders', 'main');
  });

  test('every control of a party is large enough for a finger: in the strip and in the sheet', async ({
    page,
    request,
  }) => {
    const proposed = await makeProject(request, SHOP, 'proposed');
    await openApp(page, { project: proposed, scene: 'map', view: 'list' });
    await rosterRow(page, 'Sellers').tap();
    await expect(inspector(page, 'Sellers')).toBeVisible();
    await expectTouchTargets(
      page,
      'map on a phone: the strip of a party',
      '[role="region"][aria-label="Sellers"]',
    );
    await holdsStill(inspector(page, 'Sellers'));
    await inspector(page, 'Sellers').getByRole('button', { name: 'Details' }).tap({ force: true });
    await expect(page.getByRole('dialog', { name: 'Sellers' })).toBeVisible();
    await expectTouchTargets(page, 'map on a phone: the sheet of a party', '[role="dialog"]');
  });

  test('the list of actors and the traits of an actor fit the screen', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const actors = await makeProject(request, SHOP, 'actors');
    await openApp(page, { project: actors, scene: 'map', view: 'list' });
    await expect(roster(page)).toBeVisible();
    await expectSound(page, 'map on a phone: the list of actors');

    await rosterRow(page, 'Buyers').tap();
    await holdsStill(inspector(page, 'Buyers'));
    await inspector(page, 'Buyers').getByRole('button', { name: 'Details' }).tap({ force: true });
    const sheet = page.getByRole('dialog', { name: 'Buyers' });
    await openDisclosure(sheet, 'Traits 11');
    await expect(sheet.getByRole('slider').first()).toBeVisible();
    await expectControlsInside(sheet, 'the traits of an actor on a phone');
    await expectSound(page, 'map on a phone: the traits of an actor');
    expect(problems).toEqual([]);
  });

  test('every control of the list and of the traits is large enough for a finger', async ({
    page,
    request,
  }) => {
    const actors = await makeProject(request, SHOP, 'actors');
    await openApp(page, { project: actors, scene: 'map', view: 'list' });
    await expect(roster(page)).toBeVisible();
    await expectTouchTargets(page, 'map on a phone: the list of actors', '[aria-label="Actors"]');
    await rosterRow(page, 'Buyers').tap();
    await holdsStill(inspector(page, 'Buyers'));
    await inspector(page, 'Buyers').getByRole('button', { name: 'Details' }).tap({ force: true });
    const sheet = page.getByRole('dialog', { name: 'Buyers' });
    await expect(sheet.getByRole('heading', { level: 2, name: 'Buyers' })).toBeVisible();
    await openDisclosure(sheet, 'Traits 11');
    await expectTouchTargets(page, 'map on a phone: the traits of an actor', '[role="dialog"]');
  });

  test('before anything is found, the first screen fits and is within reach too', async ({
    page,
    request,
  }) => {
    const first = await makeProject(request, SHOP, 'ground');
    await openApp(page, { project: first, scene: 'map' });
    await expect(page.getByRole('button', { name: 'Find who is affected' })).toBeVisible();
    await expectSound(page, 'map on a phone: nothing found yet');
    await expectTouchTargets(page, 'map on a phone: nothing found yet', 'main');
    await findWho(page);
    await expectSound(page, 'map on a phone: found');
    await expect(ecosystem(page)).toBeVisible();
  });
});
