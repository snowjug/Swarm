import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { journey, openApp } from '../support/app';
import {
  apiContext,
  expectNoHorizontalOverflow,
  expectReadableText,
  renderedSvgTextPx,
  svgLabelCollisions,
  viewports,
  watchPage,
} from '../support/helpers';
import {
  SCREENS,
  allOf,
  arrived,
  expectPressable,
  forget,
  makeProject,
  openHistory,
  quiet,
  screenPath,
  type Screen,
  type ScreenProjects,
} from '../support/shell';

// The layout, in a real browser, at the five sizes the product is designed for: nothing runs off the page, no text is
// too small to read, nothing that is pressed is too small to press, nothing sits on top of what it should not, and the
// labels of a map never lie on one another. Each screen is judged by every one of these, and a failure lists all that
// failed, not the first.

const projects: ScreenProjects = { ground: '', proposed: '', brief: '' };
let api: APIRequestContext;

test.beforeAll(async ({ playwright }) => {
  api = await apiContext(playwright);
  projects.ground = (await makeProject(api, 'ground', { name: 'Layout: ground' })).id;
  projects.proposed = (await makeProject(api, 'proposed', { name: 'Layout: proposed' })).id;
  projects.brief = (await makeProject(api, 'brief', { name: 'Layout: brief' })).id;
});

test.afterAll(async () => {
  await forget(api, Object.values(projects));
  await api.dispose();
});

test.use({ reducedMotion: 'reduce' });

/** The graphs of the product: the ecosystem of a map or a replay, and the graph of the evidence. */
const GRAPH = 'main svg[role="group"]';

/**
 * What each screen fails at today, for the defects written up in .scratch/e2e/issues-shell.md. A screen listed here is
 * not judged by that measure until the defect is fixed: take the entry out, and the measure applies. Each has a test
 * of its own below (`test.fixme`) that says what should be true.
 */
const KNOWN: Record<'targets' | 'text' | 'graph', ReadonlySet<string>> = {
  // Issue 8: on a phone, the pick of a scenario in the comparison is 23px tall. A screen that is held to this is held to
  // the finger measure too, and fails it the same way.
  targets: new Set(['compare@390']),
  text: new Set(),
  graph: new Set(),
};

/** The bar floats over the page: the page's first heading must start below it. */
async function expectClearOfTheBar(page: Page, label: string): Promise<void> {
  const [bar, heading] = await Promise.all([
    page.getByRole('banner').boundingBox(),
    page.getByRole('main').getByRole('heading', { level: 1 }).boundingBox(),
  ]);
  expect(bar, `${label}: the bar`).not.toBeNull();
  expect(heading, `${label}: the heading`).not.toBeNull();
  expect(heading!.y, `${label}: the main heading starts under the bar`).toBeGreaterThanOrEqual(
    bar!.y + bar!.height - 1,
  );
}

/** What is in a graph is drawn at a size that can be read, and its labels do not lie on one another. */
async function expectLegibleGraph(page: Page, label: string): Promise<void> {
  if ((await page.locator(GRAPH).count()) === 0) return;
  const sizes = await renderedSvgTextPx(page, GRAPH);
  if (sizes.length > 0) {
    expect(
      Math.min(...sizes),
      `${label}: graph labels must be drawn at 11px or more`,
    ).toBeGreaterThanOrEqual(11);
  }
  expect(await svgLabelCollisions(page, GRAPH), `${label}: labels that overlap`).toEqual([]);
}

// ---------------------------------------------------------------------------------------------

for (const viewport of viewports) {
  test.describe(`${viewport.name}`, () => {
    const touched = viewport.width <= 768;
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: touched,
    });

    for (const screen of SCREENS) {
      test(`${screen.name}: nothing runs off the page, the text is readable, the controls are big enough`, async ({
        page,
      }) => {
        const problems = watchPage(page);
        const label = `${screen.name} ${viewport.name}`;
        await page.goto(screenPath(screen, projects));
        await arrived(page);
        await quiet(page);
        const heldToTargets = !(
          KNOWN.targets.has(screen.name) || KNOWN.targets.has(`${screen.name}@${viewport.width}`)
        );

        await allOf({
          'no horizontal scroll': () => expectNoHorizontalOverflow(page),
          'the bar is clear of the heading': () => expectClearOfTheBar(page, label),
          ...(KNOWN.text.has(screen.name)
            ? {}
            : { 'text of 12px or more': () => expectReadableText(page, label) }),
          ...(heldToTargets
            ? { 'controls of 24px or more': () => expectPressable(page, label, { min: 24 }) }
            : {}),
          ...(KNOWN.graph.has(`${screen.name}@${viewport.width}`)
            ? {}
            : { 'a legible graph': () => expectLegibleGraph(page, label) }),
          // Where a finger presses, docs/UX.md asks for 44px.
          ...(touched && heldToTargets
            ? { 'controls a finger wide': () => expectPressable(page, label, { min: 44 }) }
            : {}),
        });
        expect(problems).toEqual([]);
      });
    }
  });
}

// ---------------------------------------------------------------------------------------------

const MAP: Screen = SCREENS.find((screen) => screen.name === 'map, with its actors')!;

for (const viewport of viewports) {
  test(`the map at ${viewport.name}: every party can be pressed, nothing covers it, and it is inside the map`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(screenPath(MAP, projects));
    await arrived(page);
    await quiet(page);
    const graph = page.getByRole('group', { name: 'Actors and how they relate' });
    const parties = graph.getByRole('button');
    const total = await parties.count();
    expect(total).toBeGreaterThanOrEqual(8);
    const frame = await graph.boundingBox();
    for (let index = 0; index < total; index += 1) {
      const party = parties.nth(index);
      // A trial press fails if something else would receive the pointer.
      await party.click({ trial: true });
      const box = await party.boundingBox();
      expect(box, `party ${index} is drawn`).not.toBeNull();
      const middle = box!.x + box!.width / 2;
      expect(middle, `party ${index} is inside the map`).toBeGreaterThanOrEqual(frame!.x - 1);
      expect(middle).toBeLessThanOrEqual(frame!.x + frame!.width + 1);
    }
  });
}

// ---------------------------------------------------------------------------------------------

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('the page leaves room for the dock under its last line, on every scene', async ({
    page,
  }) => {
    for (const screen of SCREENS.filter((item) => item.project !== null)) {
      await page.goto(screenPath(screen, projects));
      await arrived(page);
      const [dock, room] = await Promise.all([
        journey(page).boundingBox(),
        page
          .getByRole('main')
          .evaluate((main) => Number.parseFloat(getComputedStyle(main).paddingBottom)),
      ]);
      expect(dock, `${screen.name}: the dock`).not.toBeNull();
      expect(room, `${screen.name}: room under the page for the dock`).toBeGreaterThanOrEqual(
        dock!.height,
      );
    }
  });

  test('the end of a page can be scrolled clear of the dock', async ({ page }) => {
    for (const screen of SCREENS.filter((item) =>
      ['ground', 'compare', 'map, as a list'].includes(item.name),
    )) {
      await page.goto(screenPath(screen, projects));
      await arrived(page);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBeGreaterThan(0);
      const [dock, lowest] = await Promise.all([
        journey(page).boundingBox(),
        page.evaluate(() => {
          // The lowest thing in the page that is not itself fixed: its edge is what the dock must stay under.
          let low = 0;
          for (const element of document.querySelector('main')!.querySelectorAll('*')) {
            const style = getComputedStyle(element);
            if (['fixed', 'sticky'].includes(style.position)) continue;
            if (style.visibility === 'hidden' || style.display === 'none') continue;
            const box = element.getBoundingClientRect();
            if (box.width > 0 && box.height > 0 && box.bottom <= window.innerHeight + 1) {
              low = Math.max(low, box.bottom);
            }
          }
          return low;
        }),
      ]);
      expect(dock, `${screen.name}: the dock`).not.toBeNull();
      expect(
        lowest,
        `${screen.name}: the lowest content (${lowest}) sits above the dock (${dock!.y})`,
      ).toBeLessThanOrEqual(dock!.y + 1);
    }
  });

  test('the main action of each early scene can be pressed without reaching under the dock', async ({
    page,
  }) => {
    await openApp(page, { project: projects.ground, scene: 'ground' });
    const next = page.getByRole('button', { name: 'Map the stakeholders' });
    await next.scrollIntoViewIfNeeded();
    await next.click({ trial: true });

    await openApp(page, { project: projects.ground, scene: 'map' });
    const find = page.getByRole('button', { name: 'Find who is affected' });
    await find.scrollIntoViewIfNeeded();
    await find.click({ trial: true });

    await openApp(page, { project: projects.proposed, scene: 'map' });
    // On a phone the button says only "Approve".
    const approve = page.getByRole('button', { name: /^Approve/u });
    await approve.scrollIntoViewIfNeeded();
    await approve.click({ trial: true });
  });

  test('the history is a sheet that fits the screen and can be closed with a thumb', async ({
    page,
  }) => {
    await openApp(page, { project: projects.brief, scene: 'ground' });
    const dialog = await openHistory(page);
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(391);
    expect(box!.y + box!.height).toBeLessThanOrEqual(845);
    await expectNoHorizontalOverflow(page);
    await dialog.getByRole('button', { name: 'Close' }).click({ trial: true });
    await expectPressable(page, 'phone: the history', { min: 44, scope: '[role="dialog"]' });
  });
});

// ---------------------------------------------------------------------------------------------

test.describe('between the sizes', () => {
  test('the journey moves from the bar to the dock at the breakpoint, and is never in both', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 641, height: 900 });
    await openApp(page, { project: projects.brief, scene: 'ground' });
    await expect(page.getByRole('navigation', { name: 'Journey' })).toHaveCount(1);
    expect(
      await journey(page).evaluate((nav) => nav.closest('header') !== null),
      'in the bar above 640px',
    ).toBe(true);
    await page.setViewportSize({ width: 640, height: 900 });
    await expect(page.getByRole('navigation', { name: 'Journey' })).toHaveCount(1);
    expect(
      await journey(page).evaluate((nav) => nav.closest('header') === null),
      'in the dock at 640px and below',
    ).toBe(true);
    await expectNoHorizontalOverflow(page);
  });

  for (const width of [320, 360, 480, 640, 900, 1024, 2560]) {
    test(`a width of ${width}px does not make the first screen or a scene run off the page`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await arrived(page);
      await expectNoHorizontalOverflow(page);
      await page.goto(
        screenPath(
          SCREENS.find((item) => item.name === 'ground')!,
          projects,
        ),
      );
      await arrived(page);
      await expectNoHorizontalOverflow(page);
    });
  }
});

// ---------------------------------------------------------------------------------------------
// What is written up in .scratch/e2e/issues-shell.md, and says what should be true.

test.describe('known defects of layout', () => {
  test('(8) a button that opens a passage is at least 24px tall', async ({ page }) => {
    await page.goto(
      screenPath(
        SCREENS.find((item) => item.name === 'ground')!,
        projects,
      ),
    );
    await arrived(page);
    await expectPressable(page, 'ground', { min: 24 });
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test.fixme('(8) the pick of a scenario in the comparison is at least 24px tall', async ({
      page,
    }) => {
      await page.goto(
        screenPath(
          SCREENS.find((item) => item.name === 'compare')!,
          projects,
        ),
      );
      await arrived(page);
      await expectPressable(page, 'compare 390x844', { min: 24 });
    });
  });
});

test.describe('known defects of the decision page', () => {
  test.fixme('(13) the page ends with the brief: the document is no taller than its main region', async ({
    page,
  }) => {
    await page.goto(
      screenPath(
        SCREENS.find((item) => item.name === 'decide')!,
        projects,
      ),
    );
    await arrived(page);
    const extra = await page.evaluate(
      () =>
        document.documentElement.scrollHeight -
        Math.round(document.querySelector('main')!.getBoundingClientRect().bottom + window.scrollY),
    );
    expect(extra, 'pixels of blank page after the end of the brief').toBeLessThanOrEqual(1);
  });
});
