import { expect, test, type Page } from '@playwright/test';
import { extractText, getDocumentProxy } from 'unpdf';
import { BRIEF_SECTION_IDS, BRIEF_SECTION_TITLES } from '../../shared/brief';
import type { CritiquesView } from '../../shared/critique';
import { expectNoAxeViolations, expectNoHorizontalOverflow, watchPage } from '../support/helpers';
import {
  CITY_BRIEFING,
  CITY_QUESTION,
  briefDocument,
  briefOf,
  expandBrief,
  getJson,
  openStage,
  reviewPanel,
  seedWithBrief,
} from '../support/lab';

// The Report stage with a decision brief of seventeen sections used to be forty screens long, with the
// independent review at the bottom of it. The answer is open when the page opens and the reference is
// closed until it is wanted; a bar that stays in view leads to the brief, the review and the detailed
// report; and the printed page is the brief, whole, and nothing of the application around it.
// Rules mode: no model is called.

const SEED = { title: 'Report page', question: CITY_QUESTION, documents: [CITY_BRIEFING] };
const SIZES = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '390x844', width: 390, height: 844 },
] as const;

const OPEN = [
  'decision',
  'reaction-patterns',
  'alternative-outcomes',
  'first-order',
  'second-order',
  'drivers',
  'risks-opportunities',
  'recommendations',
  'validation-plan',
] as const;
const CLOSED = BRIEF_SECTION_IDS.filter(
  (id) => id !== 'executive-answer' && !(OPEN as readonly string[]).includes(id),
);

const jumpBar = (page: Page) => page.getByRole('navigation', { name: 'Jump within the report' });
const contents = (page: Page) =>
  page.getByRole('navigation', { name: 'Sections of the decision brief' });
const section = (page: Page, id: string) => page.locator(`#brief-${id}`);
const isOpen = (page: Page, id: string) => section(page, id).locator('details.brief-collapse');

async function openReport(page: Page, project: string): Promise<void> {
  await page.goto(`/?project=${project}`);
  await openStage(page, /Report/u);
  await expect(briefDocument(page)).toBeVisible();
  await expect(reviewPanel(page)).toBeVisible();
}

/** Where the app header ends: the bar sticks under it where it stays at the top, and at the top where it does not. */
const headerBottom = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const header = document.querySelector('.app-header') as HTMLElement;
    return getComputedStyle(header).position === 'sticky'
      ? header.getBoundingClientRect().bottom
      : 0;
  });

const documentHeight = (page: Page): Promise<number> =>
  page.evaluate(() => document.documentElement.scrollHeight);

test.describe('the report page', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('opens on the answer, keeps the reference one click away, and lists every section in the contents', async ({
    page,
  }) => {
    const problems = watchPage(page);
    const project = await seedWithBrief(page, SEED);
    await openReport(page, project);

    for (const id of OPEN) await expect(isOpen(page, id), id).toHaveJSProperty('open', true);
    for (const id of CLOSED) await expect(isOpen(page, id), id).toHaveJSProperty('open', false);
    await expect(page.locator('h1')).toHaveCount(1);

    const list = contents(page).getByRole('link');
    await expect(list).toHaveCount(BRIEF_SECTION_IDS.length);
    for (const id of ['validation-plan', 'limitations'] as const) {
      await expect(list.filter({ hasText: BRIEF_SECTION_TITLES[id] })).toHaveCount(1);
    }

    // Closed is closed on the screen: what is in the sections is still in the page.
    const brief = await briefOf(page, project);
    for (const id of CLOSED) {
      const first = brief.brief?.sections.find((entry) => entry.id === id)?.statements[0]?.text;
      if (first) await expect(section(page, id)).toContainText(first.slice(0, 40));
    }

    // The page is a few screens, not forty, and the review and the detailed report are not at the end of it.
    const closed = await documentHeight(page);
    const review = (await reviewPanel(page).boundingBox())!;
    await expandBrief(page);
    const expanded = await documentHeight(page);
    expect(closed, 'the page with the reference closed').toBeLessThan(expanded * 0.6);
    expect(
      review.y + (await page.evaluate(() => window.scrollY)),
      'where the review sits',
    ).toBeLessThan(closed);

    await expectNoHorizontalOverflow(page);
    expect(problems, 'what the page logged or failed at').toEqual([]);
  });

  test('can be moved around with the keyboard: a section opens and closes from its heading', async ({
    page,
  }) => {
    const project = await seedWithBrief(page, SEED);
    await openReport(page, project);
    const toggle = section(page, 'limitations').locator('summary.brief-section-toggle');
    await toggle.focus();
    await expect(toggle).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(isOpen(page, 'limitations')).toHaveJSProperty('open', true);
    await expect(
      section(page, 'limitations')
        .locator('.brief-text')
        .filter({ hasText: 'Synthetic actors are not real people' }),
    ).toBeVisible();
    await page.keyboard.press('Space');
    await expect(isOpen(page, 'limitations')).toHaveJSProperty('open', false);
    // The heading is still a heading of the page, whether its section is open or not.
    await expect(
      page.getByRole('heading', {
        level: 3,
        name: `${BRIEF_SECTION_IDS.indexOf('limitations') + 1}. ${BRIEF_SECTION_TITLES.limitations}`,
      }),
    ).toBeVisible();
  });

  test('opens a closed section before it scrolls to it: from the contents, from the address and from Expand all', async ({
    page,
  }) => {
    const project = await seedWithBrief(page, SEED);
    await openReport(page, project);
    const bar = jumpBar(page);

    await contents(page)
      .getByRole('link', { name: /Sources and provenance/u })
      .click();
    await expect(isOpen(page, 'sources')).toHaveJSProperty('open', true);
    await expect(section(page, 'sources')).toBeFocused();
    const barBox = (await bar.boundingBox())!;
    const sourcesBox = (await section(page, 'sources').boundingBox())!;
    expect(sourcesBox.y, 'the section is not under the bar').toBeGreaterThanOrEqual(
      barBox.y + barBox.height - 1,
    );
    expect(sourcesBox.y, 'the section is in view').toBeLessThan(300);

    await section(page, 'sources').getByRole('link', { name: 'Back to contents' }).click();
    await expect(contents(page)).toBeFocused();
    expect((await contents(page).boundingBox())!.y).toBeGreaterThanOrEqual(
      barBox.y + barBox.height - 1,
    );

    // An address that names a section, by what the contents link to or by its number.
    await page.evaluate(() => {
      window.location.hash = '#brief-limitations';
    });
    await expect(isOpen(page, 'limitations')).toHaveJSProperty('open', true);
    await expect(section(page, 'limitations')).toBeFocused();
    await expect(section(page, 'limitations')).toBeInViewport();
    await page.evaluate(() => {
      window.location.hash = '#brief-3';
    });
    await expect(isOpen(page, 'evidence-base')).toHaveJSProperty('open', true);
    await expect(section(page, 'evidence-base')).toBeInViewport();

    const collapse = briefDocument(page).getByRole('button', { name: 'Collapse all sections' });
    await collapse.click();
    await expect(briefDocument(page).locator('details.brief-collapse[open]')).toHaveCount(0);
    await expect(
      page.getByRole('status').filter({ hasText: 'All sections are closed' }),
    ).toHaveCount(1);
    await expandBrief(page);
    await expect(page.getByRole('status').filter({ hasText: 'sections are open' })).toHaveCount(1);
  });

  test('opens the section an address names when the report is first opened', async ({ page }) => {
    const project = await seedWithBrief(page, SEED);
    await page.goto(`/?project=${project}#brief-sources`);
    await openStage(page, /Report/u);
    await expect(isOpen(page, 'sources')).toHaveJSProperty('open', true);
    await expect(section(page, 'sources')).toBeInViewport();
    await expect(isOpen(page, 'limitations')).toHaveJSProperty('open', false);
  });
});

for (const size of [SIZES[0], SIZES[2]]) {
  test.describe(`the bar that stays in view at ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('sticks under the header however far the page is read, and leads to each part without covering it', async ({
      page,
    }) => {
      const project = await seedWithBrief(page, SEED);
      await openReport(page, project);
      const bar = jumpBar(page);
      await expect(bar.getByRole('link')).toHaveText([
        /Decision brief/u,
        /Independent review/u,
        /Detailed report and studio/u,
      ]);
      await expect(bar.getByRole('link', { name: 'Independent review not run yet' })).toBeVisible();

      await page.evaluate(() => window.scrollTo(0, 4_000));
      const top = await headerBottom(page);
      const barBox = (await bar.boundingBox())!;
      expect(Math.abs(barBox.y - top), 'the bar sits under the header').toBeLessThanOrEqual(1);
      await expect(bar).toBeInViewport({ ratio: 1 });
      const clear = barBox.y + barBox.height - 1;

      await bar.getByRole('link', { name: /^Independent review/u }).click();
      await expect(reviewPanel(page)).toBeFocused();
      expect(
        (await reviewPanel(page).boundingBox())!.y,
        'the review is not under the bar',
      ).toBeGreaterThanOrEqual(clear);
      await expect(
        reviewPanel(page).getByRole('heading', { name: 'Independent review', exact: true }),
      ).toBeInViewport();

      await bar.getByRole('link', { name: 'Detailed report and studio' }).click();
      const detailed = page.getByRole('heading', { name: 'Detailed report' });
      await expect(detailed).toBeFocused();
      expect((await detailed.boundingBox())!.y).toBeGreaterThanOrEqual(clear);

      await bar.getByRole('link', { name: 'Decision brief' }).click();
      await expect(briefDocument(page)).toBeFocused();
      expect((await briefDocument(page).boundingBox())!.y).toBeGreaterThanOrEqual(clear);
      await expect(bar).toBeInViewport({ ratio: 1 });
    });
  });
}

test.describe('the independent review in the bar', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('says what is not yet closed, from the one read the page makes, and follows an answer to a criticism', async ({
    page,
  }) => {
    const project = await seedWithBrief(page, SEED, { review: true });
    const reads: string[] = [];
    page.on('request', (request) => {
      if (
        request.method() === 'GET' &&
        request.url().endsWith(`/api/projects/${project}/critiques`)
      ) {
        reads.push(request.url());
      }
    });
    await openReport(page, project);

    const view = await getJson<CritiquesView>(page, `/api/projects/${project}/critiques`);
    const notClosed = (view.critiques?.critiques ?? []).filter(
      (c) => c.status !== 'accepted',
    ).length;
    expect(notClosed).toBeGreaterThan(0);
    const link = jumpBar(page).getByRole('link', { name: /^Independent review/u });
    await expect(link).toHaveText(new RegExp(`${notClosed} not yet closed`, 'u'));
    expect(reads.length, 'reads of the review made by the page').toBe(1);

    const first = reviewPanel(page).getByRole('article').first();
    await first.getByText('Respond to this criticism').click();
    await first.getByLabel('Your response', { exact: true }).fill('Accepted: this applies.');
    await first.getByRole('button', { name: 'Accept the objection' }).click();
    await expect(link).toHaveText(
      new RegExp(`${notClosed - 1} not yet closed|all \\d+ closed`, 'u'),
    );
    expect(reads.length, 'the answer is the page’s own, and asks for nothing more').toBe(1);
  });
});

test.describe('printing the report', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('prints the whole brief and the review, whatever is closed on the screen, and nothing of the application', async ({
    page,
  }) => {
    const project = await seedWithBrief(page, SEED, { review: true });
    await openReport(page, project);
    await briefDocument(page).getByRole('button', { name: 'Collapse all sections' }).click();
    await expect(briefDocument(page).locator('details.brief-collapse[open]')).toHaveCount(0);

    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    const { totalPages, text } = await extractText(await getDocumentProxy(new Uint8Array(pdf)), {
      mergePages: true,
    });
    const flat = String(text).replace(/\s+/gu, '');
    const has = (words: string) => flat.includes(words.replace(/\s+/gu, ''));
    expect(totalPages).toBeGreaterThan(5);

    // Every section is printed in full, though the screen had them all closed.
    const brief = await briefOf(page, project);
    for (const entry of brief.brief?.sections ?? []) {
      const first = entry.statements[0]?.text;
      if (first) expect(has(first.slice(0, 50)), `${entry.id}: ${first.slice(0, 50)}`).toBe(true);
    }
    expect(has('Independent review')).toBe(true);
    expect(has('What the review found')).toBe(true);
    expect(has('Decision brief')).toBe(true);
    expect(has('Executive answer')).toBe(true);

    // The application around the report, and the controls that are of no use on paper, are not.
    for (const chrome of [
      'Swarm Lab',
      'Skip to console',
      'Operation log',
      'Back to the comparison',
      'Audit log',
      'Jump to',
      'Expand all sections',
      'Back to contents',
      'Run independent review again',
      'Detailed report and studio',
    ]) {
      expect(has(chrome), chrome).toBe(false);
    }
    // A chart is printed once: the tables that say the same again are not, and neither is the button
    // that opens them. The one chart with no numbers of its own keeps its table, without the button.
    expect(has('Show this as a table')).toBe(false);
    expect(has('Stakeholder map, as a table')).toBe(false);
    expect(has('Sensitivity of the simulated outcome to each assumption moved')).toBe(false);
    expect(has('Mean number of simulated members in each response')).toBe(true);
  });

  test('prints the other stages as it always did', async ({ page }) => {
    const project = await seedWithBrief(page, SEED);
    await page.goto(`/?project=${project}`);
    await openStage(page, /Simulation/u);
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.app-header')).toBeVisible();
    await expect(page.locator('.journey')).toBeVisible();
  });
});

// One theme for each size keeps this to a few minutes; every size in every theme was audited by hand.
for (const [size, theme] of [
  [SIZES[0], 'light'],
  [SIZES[1], 'dark'],
  [SIZES[2], 'high-contrast'],
] as const) {
  test.describe(`the report in the ${theme} theme at ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('is clean for a screen reader and for the eye, with the reference closed and open', async ({
      page,
    }) => {
      const problems = watchPage(page);
      await page.addInitScript((value) => window.localStorage.setItem('swarm.theme', value), theme);
      const project = await seedWithBrief(page, SEED, { review: true });
      await openReport(page, project);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expectNoAxeViolations(page, `${theme} ${size.name}: report, reference closed`);
      await expectNoHorizontalOverflow(page);
      await expandBrief(page);
      await expectNoAxeViolations(page, `${theme} ${size.name}: report, every section open`);
      await expectNoHorizontalOverflow(page);
      expect(problems, 'what the page logged or failed at').toEqual([]);
    });
  });
}
