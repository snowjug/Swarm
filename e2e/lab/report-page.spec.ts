import { expect, test, type APIRequestContext } from '@playwright/test';
import { BRIEF_SECTION_TITLES, type BriefSectionId } from '../../shared/brief';
import { openApp } from '../support/app';
import {
  apiContext,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  expectReadableText,
  expectTouchTargets,
  viewports,
  watchPage,
} from '../support/helpers';
import { PHONE, forget, quiet } from '../support/shell';
import {
  blankAfterMain,
  briefOf,
  briefed,
  chapter,
  chapterToggle,
  contents,
  openDecide,
  tools,
  topOf,
  verdict,
} from '../support/decide';

// The decision brief as a page: an answer first, then the story of it, with the reference closed until it is
// wanted. The first screen answers what happened, why, what matters and what to consider next; a contents beside
// the document says where the reader is and opens a chapter before it takes the reader there; a bar keeps the
// tools in reach. Rules mode: no model is called.

const REFERENCE: readonly BriefSectionId[] = [
  'assumptions',
  'evidence-base',
  'sources',
  'limitations',
  'technical-appendix',
];

let api: APIRequestContext;
let project = '';

test.beforeAll(async ({ playwright }) => {
  api = await apiContext(playwright);
  project = await briefed(api, { name: 'Brief page' });
});

test.afterAll(async () => {
  await forget(api, [project]);
  await api.dispose();
});

test.use({ reducedMotion: 'reduce' });

test.describe('the brief on a desktop screen', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('opens on its answer: what happened, why, what matters, what to consider next, and that none of it is a forecast', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openDecide(page, project);

    await expect(verdict(page)).toHaveCount(1);
    await expect(verdict(page)).toContainText('the share of simulated members looking');
    // The four questions are answered on the first screen, each under its own heading.
    for (const name of ['What happened', 'Why', 'What matters', 'What to consider next']) {
      await expect(
        page.getByRole('main').getByRole('heading', { level: 2, name }),
        `${name} is on the first screen`,
      ).toBeInViewport();
    }
    // What the answer rests on is said as numbers, and the words that say what they are come with them.
    const figures = page.getByRole('group', { name: /^The comparison of .+ with .+/u });
    await expect(figures).toContainText('Paired difference');
    await expect(figures).toContainText('Higher under the change');
    await expect(
      page.getByText('Counts from a simulation under stated assumptions, not a forecast.'),
    ).toBeInViewport();
    await expect(
      page.getByText(/Simulated members are synthetic stand-ins/u).first(),
    ).toBeVisible();
    // Who moved is named, and what is still open is said.
    await expect(
      page.getByRole('region', { name: 'Why' }).getByRole('listitem').first(),
    ).toContainText(/in 100 from/u);
    await expect(page.getByRole('region', { name: 'What matters' })).toContainText(
      'Biggest open caveat',
    );
    expect(problems, 'what the page logged or failed at').toEqual([]);
  });

  test('keeps the reference closed until it is wanted, and what is in it stays in the page', async ({
    page,
  }) => {
    await openDecide(page, project);
    const { brief } = await briefOf(api, project);
    for (const id of REFERENCE) {
      const title = BRIEF_SECTION_TITLES[id];
      const toggle = chapterToggle(page, title);
      await expect(toggle, `${title} is closed`).toHaveAttribute('aria-expanded', 'false');
      // Closed is closed on the screen: what it says is still in the page for find-in-page and for paper.
      const first = brief!.sections.find((section) => section.id === id)!.statements[0]!.text;
      await expect(chapter(page, title)).toContainText(first.slice(0, 40));
    }
    // The story is not closed: it has no button to open it.
    await expect(chapterToggle(page, BRIEF_SECTION_TITLES['reaction-patterns'])).toHaveCount(0);

    const limits = chapterToggle(page, BRIEF_SECTION_TITLES.limitations);
    await limits.click();
    await expect(limits).toHaveAttribute('aria-expanded', 'true');
    await expect(
      chapter(page, BRIEF_SECTION_TITLES.limitations).getByRole('listitem').first(),
    ).toBeVisible();
    await limits.click();
    await expect(limits).toHaveAttribute('aria-expanded', 'false');
  });

  test('a chapter of reference opens and closes from the keyboard, and its heading is still a heading', async ({
    page,
  }) => {
    await openDecide(page, project);
    const toggle = chapterToggle(page, BRIEF_SECTION_TITLES['technical-appendix']);
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(
      page.getByRole('heading', { level: 2, name: /^Technical appendix/u }),
    ).toBeVisible();
    // One headline for the page, and every chapter is a heading of the level below it.
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveCount(1);
    const { brief } = await briefOf(api, project);
    const titles = brief!.sections
      .filter((section) => section.id !== 'executive-answer')
      .map((section) => section.title);
    for (const title of titles) {
      await expect(
        page.getByRole('heading', { level: 2, name: new RegExp(`^${title}`, 'u') }),
        title,
      ).toHaveCount(1);
    }
  });

  test('lists every chapter in the contents, and opens a closed one before it takes the reader there', async ({
    page,
  }) => {
    await openDecide(page, project);
    const { brief } = await briefOf(api, project);
    const nav = contents(page);
    // The answer, each chapter the brief holds, and the independent review that stands among them.
    const chapters = brief!.sections.filter((section) => section.id !== 'executive-answer');
    await expect(nav.getByRole('link', { name: 'The answer' })).toBeVisible();
    for (const section of chapters) {
      await expect(nav.getByRole('link', { name: section.title }), section.title).toHaveCount(1);
    }
    await expect(nav.getByRole('link', { name: 'Independent review' })).toHaveCount(1);

    await nav.getByRole('link', { name: 'Sources and provenance' }).click();
    const sources = chapter(page, 'Sources and provenance');
    await expect(chapterToggle(page, 'Sources and provenance')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(sources).toBeFocused();
    await expect(sources).toBeInViewport();
    await expect(page).toHaveURL(/#brief-sources$/u);
    // The reader is told where they are, and the chapter is not hidden under the top bar.
    await expect(nav.getByRole('link', { name: 'Sources and provenance' })).toHaveAttribute(
      'aria-current',
      'location',
    );
    expect(await topOf(sources), 'the chapter starts below the top bar').toBeGreaterThan(70);

    await nav.getByRole('link', { name: 'The answer' }).click();
    await expect(verdict(page)).toBeInViewport();
  });

  test('opens the chapter that an address names, on the first visit and when the address changes', async ({
    page,
  }) => {
    await page.goto(`/?project=${project}&scene=decide#brief-limitations`);
    await expect(chapterToggle(page, 'Limitations')).toHaveAttribute('aria-expanded', 'true');
    await expect(chapter(page, 'Limitations')).toBeInViewport();
    await expect(chapterToggle(page, 'Sources and provenance')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await page.evaluate(() => {
      window.location.hash = '#brief-technical-appendix';
    });
    await expect(chapterToggle(page, 'Technical appendix')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(chapter(page, 'Technical appendix')).toBeInViewport();
  });

  test('can open every chapter at once and close the reference again', async ({ page }) => {
    await openDecide(page, project);
    const closed = await page.evaluate(() => document.documentElement.scrollHeight);
    await contents(page).getByRole('button', { name: 'Open every chapter' }).click();
    for (const id of REFERENCE) {
      await expect(chapterToggle(page, BRIEF_SECTION_TITLES[id])).toHaveAttribute(
        'aria-expanded',
        'true',
      );
    }
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
      .toBeGreaterThan(closed);
    await contents(page).getByRole('button', { name: 'Close the reference' }).click();
    for (const id of REFERENCE) {
      await expect(chapterToggle(page, BRIEF_SECTION_TITLES[id])).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    }
  });

  test('keeps the tools in reach once the first screen has gone by, and says where the reader is', async ({
    page,
  }) => {
    await openDecide(page, project);
    const bar = page.getByRole('region', { name: 'Brief tools' });
    // Not there while the tools are on the page: nothing in it can be reached.
    await expect(bar).toHaveJSProperty('inert', true);
    await contents(page).getByRole('link', { name: 'Behavioural drivers' }).click();
    await expect(bar).toHaveJSProperty('inert', false);
    await expect(bar).toContainText('Behavioural drivers');
    await expect(bar.getByRole('button', { name: /^Review/u })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Export' })).toBeVisible();
    await bar.getByRole('button', { name: /^Review/u }).click();
    await expect(page.getByRole('dialog', { name: 'Independent review' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('says what to do next, and leads to it', async ({ page }) => {
    await openDecide(page, project);
    const next = page.getByRole('region', { name: 'What to consider next' });
    await expect(next).toContainText('Recommendation, conditional on the premises below');
    await next.getByRole('button', { name: /See what to do/u }).click();
    await expect(chapter(page, 'Prioritised recommendations')).toBeFocused();
    await expect(chapter(page, 'Prioritised recommendations')).toBeInViewport();
  });

  test('ends with what it says: the page has no blank stretch after the brief', async ({
    page,
  }) => {
    await openDecide(page, project);
    expect(await blankAfterMain(page), 'pixels of blank page after the end').toBeLessThanOrEqual(1);
    await contents(page).getByRole('button', { name: 'Open every chapter' }).click();
    await quiet(page);
    expect(await blankAfterMain(page), 'with every chapter open').toBeLessThanOrEqual(1);
  });
});

test.describe('the brief on a phone', () => {
  test.use(PHONE);

  test('puts the answer first and the contents in a sheet, with controls a finger can press', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openDecide(page, project);
    await expect(verdict(page)).toBeInViewport();
    await expect(
      page.getByText('Counts from a simulation under stated assumptions, not a forecast.'),
    ).toBeVisible();
    await expectTouchTargets(page, 'the brief on a phone', 'main');
    // The contents is one press away and does not take the width of the page.
    await expect(contents(page)).toBeHidden();
    await chapter(page, 'Behavioural drivers').scrollIntoViewIfNeeded();
    await page
      .getByRole('region', { name: 'Brief tools' })
      .getByRole('button', { name: 'Contents' })
      .click();
    const sheet = page.getByRole('dialog', { name: 'Contents' });
    await sheet.getByRole('link', { name: 'Validation plan' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(chapter(page, 'Validation plan')).toBeFocused();
    await expect(chapter(page, 'Validation plan')).toBeInViewport();
    expect(problems).toEqual([]);
  });

  test('ends with what it says on a phone too, with its last line clear of the dock', async ({
    page,
  }) => {
    await openDecide(page, project);
    expect(await blankAfterMain(page)).toBeLessThanOrEqual(1);
    const dock = page.getByRole('navigation', { name: 'Journey' }).locator('visible=true');
    const last = page
      .getByRole('main')
      .getByText(/Swarm explores scenarios/u)
      .last();
    // The page may still be growing as what is below the first screen is drawn: scroll until it is at its end.
    await expect(async () => {
      await page.evaluate(() =>
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }),
      );
      const atEnd = await page.evaluate(
        () =>
          Math.ceil(window.scrollY + window.innerHeight) >=
          document.documentElement.scrollHeight - 2,
      );
      expect(atEnd, 'the page is at its end').toBe(true);
      const box = (await last.boundingBox())!;
      const bar = (await dock.boundingBox())!;
      expect(box.y + box.height, 'the end of the brief is clear of the dock').toBeLessThanOrEqual(
        bar.y + 1,
      );
    }).toPass();
  });
});

// Every size the product is designed for, in both themes and the high-contrast one: nothing runs off the page,
// nothing is too small to read, and axe finds nothing, with the reference closed and with all of it open.
for (const [viewport, theme] of [
  [viewports[0], 'light'],
  [viewports[1], 'dark'],
  [viewports[2], 'light'],
  [viewports[3], 'dark'],
  [viewports[4], 'high-contrast'],
] as const) {
  test.describe(`the brief at ${viewport.name} in the ${theme} theme`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: viewport.width <= 768,
    });

    test('is clean for a screen reader and for the eye, with the reference closed and open', async ({
      page,
    }) => {
      const problems = watchPage(page);
      await openApp(page, { project, scene: 'decide', theme });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await quiet(page);
      await expectNoAxeViolations(page, `${theme} ${viewport.name}: brief, reference closed`);
      await expectNoHorizontalOverflow(page);
      await expectReadableText(page, `${theme} ${viewport.name}: brief`);

      await tools(page).getByRole('button', { name: 'More' }).click();
      await page.getByRole('menuitem', { name: 'Open every chapter' }).click();
      await quiet(page);
      await expectNoAxeViolations(page, `${theme} ${viewport.name}: brief, every chapter open`);
      await expectNoHorizontalOverflow(page);
      await expectReadableText(page, `${theme} ${viewport.name}: brief, every chapter open`);
      expect(problems, 'what the page logged or failed at').toEqual([]);
    });
  });
}
