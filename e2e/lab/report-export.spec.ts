import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { BRIEF_SECTION_TITLES, type BriefView } from '../../shared/brief';
import { apiContext, watchPage } from '../support/helpers';
import { forget } from '../support/shell';
import {
  briefOf,
  briefed,
  holds,
  openDecide,
  openExportMenu,
  printed,
  saved,
} from '../support/decide';

// What leaves the brief: a Markdown file, a JSON file with the data behind the charts, a page made for paper,
// and the page itself printed. Each says what it is, holds all of the brief (what was closed on the screen
// included) and none of the controls of the screen, and the paper is legible: nothing drawn over anything else,
// nothing cut off, ink on white whatever theme the screen was in. Rules mode.

let api: APIRequestContext;
let project = '';
let view: BriefView;

test.beforeAll(async ({ playwright }) => {
  api = await apiContext(playwright);
  project = await briefed(api, { name: 'Export and print' });
  view = await briefOf(api, project);
});

test.afterAll(async () => {
  await forget(api, [project]);
  await api.dispose();
});

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });

const statementsOf = (): { section: string; id: string; text: string }[] =>
  view.brief!.sections.flatMap((section) =>
    section.statements
      // The recommendations and the checks are drawn from their own lists, which the page prints in full.
      .filter(
        (statement) =>
          !(section.id === 'recommendations' && statement.id.startsWith('rec-')) &&
          !(section.id === 'validation-plan' && statement.id.startsWith('val-')),
      )
      .map((statement) => ({
        section: section.id,
        id: statement.id,
        // A risk or an opportunity opens with its label, which the page sets as a tag and the paper keeps as one.
        text:
          section.id === 'risks-opportunities'
            ? statement.text.replace(/^(?:Risk|Opportunity)[^:]*:\s*/u, '')
            : statement.text,
      })),
  );

/** What the page may not print: the controls that do nothing on paper, and the application around the brief. */
const CHROME = [
  'Skip to content',
  'Open every chapter',
  'Close the reference',
  'Show this as a table',
  'Show all 22 groups',
  'More statements',
  'How this is counted',
  'See what to do',
  'Open the review',
  'Edit report',
  'Run the review again',
  'Run the independent review',
  'Write the brief again',
  'Contents of the decision brief',
  'Skip the contents',
];

test.describe('the files', () => {
  test('Markdown says what it is, holds every section and statement, and what is still open', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openDecide(page, project);
    const menu = await openExportMenu(page);
    await expect(menu.getByRole('menuitem')).toHaveText([
      'Markdown',
      'JSON, with the data behind the charts',
      'Printable page',
      /^Print this page/u,
    ]);
    const file = await saved(page, () => menu.getByRole('menuitem', { name: 'Markdown' }).click());

    expect(file.name).toBe('swarm-decision-brief.md');
    expect(file.text.startsWith('# Decision brief: ')).toBe(true);
    // Swarm says what it is before it says anything else, and says what is still open.
    // Markdown escapes its punctuation, so what is looked for is the words as they read.
    const plain = file.text.replace(/\\/gu, '');
    expect(plain).toContain('It does not predict the future.');
    expect(plain).toContain('Critiques not yet closed');
    expect(plain).toContain(view.brief!.question);
    for (const section of view.brief!.sections) {
      expect(plain, `the section "${section.title}"`).toContain(section.title);
    }
    for (const statement of statementsOf()) {
      expect(plain, `${statement.section}/${statement.id}`).toContain(statement.text.slice(0, 50));
    }
    // The recommendations and the checks are lists of their own in the file.
    for (const recommendation of view.brief!.recommendations) {
      expect(plain, recommendation.text).toContain(recommendation.text.slice(0, 50));
    }
    for (const check of view.brief!.validationPlan) {
      expect(plain, check.question).toContain(check.question.slice(0, 50));
    }
    // A file that anyone can open: no markup that was never rendered, no placeholder.
    expect(file.text).not.toMatch(/\b(?:undefined|NaN)\b|\[object /u);
    expect(problems).toEqual([]);
  });

  test('JSON carries the brief, the data behind every chart and where each came from', async ({
    page,
  }) => {
    await openDecide(page, project);
    const menu = await openExportMenu(page);
    const file = await saved(page, () => menu.getByRole('menuitem', { name: /^JSON/u }).click());

    expect(file.name).toBe('swarm-decision-brief.json');
    const parsed = JSON.parse(file.text) as {
      format: string;
      schemaVersion: number;
      notice: string;
      project: { id: string };
      brief: {
        question: string;
        sections: { id: string; statements: { id: string; text: string }[] }[];
      };
      data: Record<string, unknown>;
      provenance: { generatedAt: string; exportedAt: string; analysisId: string };
    };
    expect(parsed.format).toBe('swarm-decision-brief');
    expect(parsed.schemaVersion).toBeGreaterThanOrEqual(1);
    expect(parsed.notice).toContain('does not predict the future');
    expect(parsed.project.id).toBe(project);
    expect(parsed.brief.question).toBe(view.brief!.question);
    // Everything the page says is in the file, statement for statement.
    expect(parsed.brief.sections.map((section) => section.id)).toEqual(
      view.brief!.sections.map((section) => section.id),
    );
    for (const section of parsed.brief.sections) {
      const source = view.brief!.sections.find((entry) => entry.id === section.id)!;
      expect(section.statements.map((statement) => statement.id)).toEqual(
        source.statements.map((statement) => statement.id),
      );
    }
    // And so is what the charts are drawn from.
    for (const key of [
      'stakeholderMap',
      'outcomeDistribution',
      'scenarioComparison',
      'sensitivity',
      'assumptionRegister',
      'evidenceMap',
      'traitTable',
      'lookups',
    ]) {
      expect(parsed.data, `data behind ${key}`).toHaveProperty(key);
    }
    expect(parsed.provenance.analysisId).toBe(view.brief!.analysisId);
    expect(Date.parse(parsed.provenance.exportedAt)).toBeGreaterThanOrEqual(
      Date.parse(parsed.provenance.generatedAt),
    );
  });

  test('the printable page is a page of its own: sealed, without scripts, and the whole brief', async ({
    page,
    context,
  }) => {
    await openDecide(page, project);
    const menu = await openExportMenu(page);
    const [paper] = await Promise.all([
      context.waitForEvent('page'),
      menu.getByRole('menuitem', { name: 'Printable page' }).click(),
    ]);
    await paper.waitForLoadState('domcontentloaded');
    expect(new URL(paper.url()).pathname).toBe(`/api/projects/${project}/brief/export`);
    expect(new URL(paper.url()).searchParams.get('format')).toBe('html');
    await expect(paper.locator('h1')).toContainText('Decision brief');
    await expect(paper.locator('script')).toHaveCount(0);
    await expect(paper.getByText('It does not predict the future.').first()).toBeVisible();
    // Sealed: nothing in it can load from anywhere, run, or be framed.
    const headers = (await page.request.get(paper.url())).headers();
    expect(headers['content-security-policy']).toContain("default-src 'none'");
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['cache-control']).toBe('no-store');
    // It prints, whole and legible.
    const out = await printed(paper);
    expect(out.pages).toBeGreaterThan(5);
    expect(out.overlaps, 'text drawn over text').toEqual([]);
    for (const statement of statementsOf()) {
      expect(holds(out, statement.text.slice(0, 50)), `${statement.section}/${statement.id}`).toBe(
        true,
      );
    }
    await paper.close();
  });

  test('"Print this page" opens the browser’s print and nothing else', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __prints: number }).__prints = 0;
      window.print = () => {
        (window as unknown as { __prints: number }).__prints += 1;
      };
    });
    await openDecide(page, project);
    const menu = await openExportMenu(page);
    await menu.getByRole('menuitem', { name: /^Print this page/u }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __prints: number }).__prints))
      .toBe(1);
  });

  test('a role that may read the brief but not export it sees the files disabled and says why, and can still print', async ({
    page,
  }) => {
    await page.route(`**/api/projects/${project}/brief`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      const body = (await response.json()) as BriefView;
      return route.fulfill({
        response,
        json: { ...body, may: { ...body.may, export: false } },
      });
    });
    await openDecide(page, project);
    const menu = await openExportMenu(page);
    for (const name of ['Markdown', /^JSON/u, 'Printable page']) {
      await expect(menu.getByRole('menuitem', { name })).toBeDisabled();
    }
    await expect(menu.getByRole('menuitem', { name: /^Print this page/u })).toBeEnabled();
    await expect(menu).toContainText('Your role can read the brief but not export it.');
  });
});

test.describe('the page on paper', () => {
  test('prints the whole brief and the review, whatever is closed on the screen, and none of the controls', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openDecide(page, project);
    // Closed on the screen: the reference chapters, and the statements past the first few.
    await expect(
      page.getByRole('button', { name: new RegExp(`^${BRIEF_SECTION_TITLES.limitations}`, 'u') }),
    ).toHaveAttribute('aria-expanded', 'false');

    const out = await printed(page);
    expect(out.pages).toBeGreaterThan(10);
    expect(out.overlaps, 'text drawn over text').toEqual([]);

    // The first page is the answer.
    for (const words of [
      'Decision brief',
      view.brief!.question,
      'raised the share of simulated members looking for an alternative or resisting',
      'Counts from a simulation under stated assumptions, not a forecast.',
      'Simulated members are synthetic stand-ins for groups, not people.',
    ]) {
      expect(holds(out, words), words).toBe(true);
    }
    // Every statement of every chapter, closed or folded or not.
    const statements = statementsOf();
    expect(statements.length).toBeGreaterThan(50);
    for (const statement of statements) {
      expect(holds(out, statement.text.slice(0, 50)), `${statement.section}/${statement.id}`).toBe(
        true,
      );
    }
    // Every chapter has its heading, and the review is among them with what it found.
    for (const section of view.brief!.sections.filter((entry) => entry.id !== 'executive-answer')) {
      expect(holds(out, section.title), section.title).toBe(true);
    }
    expect(holds(out, 'Independent review')).toBe(true);
    // Each recommendation and each check is on paper.
    for (const recommendation of view.brief!.recommendations) {
      expect(holds(out, recommendation.text.slice(0, 50)), recommendation.text).toBe(true);
    }
    for (const check of view.brief!.validationPlan) {
      expect(holds(out, check.question.slice(0, 50)), check.question).toBe(true);
    }
    // What the screen has for moving about is not on the paper.
    for (const chrome of CHROME)
      expect(holds(out, chrome), `"${chrome}" is not printed`).toBe(false);
    expect(out.text).not.toMatch(/\b(?:undefined|NaN)\b|\[object /u);
    expect(problems).toEqual([]);
  });

  test('is ink on white from every theme, and every block fits the width of the paper', async ({
    page,
  }) => {
    for (const theme of ['dark', 'high-contrast'] as const) {
      await page.setViewportSize({ width: 794, height: 1123 });
      await openDecide(page, project, undefined, { theme });
      await page.emulateMedia({ media: 'print' });
      // What is painted at rest: a colour that is still changing from the screen's to the paper's is not yet either.
      await page.evaluate(() =>
        Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => 0))),
      );
      const paper = await page.evaluate(() => {
        const root = document.querySelector('.sw-decide')!;
        const width = document.documentElement.clientWidth;
        const wide: string[] = [];
        for (const element of root.querySelectorAll('*')) {
          const box = element.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) continue;
          if (getComputedStyle(element).display === 'none') continue;
          if (box.right > width + 1) {
            wide.push(
              `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 40)} ends at ${Math.round(box.right)} of ${width}`,
            );
          }
        }
        const ink = (selector: string): string =>
          getComputedStyle(document.querySelector(selector)!).color;
        return {
          canvas: getComputedStyle(document.documentElement).backgroundColor,
          page: getComputedStyle(root).backgroundColor,
          inks: [
            ink('.sw-decide-verdict'),
            ink('.sw-decide-stmt__text'),
            ink('.sw-decide-chapter__name'),
          ],
          wide: wide.slice(0, 8),
        };
      });
      expect(paper.canvas, `${theme}: the paper is white`).toBe('rgb(255, 255, 255)');
      expect(paper.page, `${theme}: the brief is on white`).toBe('rgb(255, 255, 255)');
      for (const colour of paper.inks) {
        // Ink is written in the colour space the stylesheet mixed it in: read its lightness from a pixel.
        const lightness = await page.evaluate((value) => {
          const canvas = document.createElement('canvas');
          canvas.width = 1;
          canvas.height = 1;
          const context = canvas.getContext('2d')!;
          context.fillStyle = value;
          context.fillRect(0, 0, 1, 1);
          const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
          return Math.max(r!, g!, b!);
        }, colour);
        expect(lightness, `${theme}: ink ${colour} is dark`).toBeLessThan(110);
      }
      expect(paper.wide, `${theme}: blocks wider than the paper`).toEqual([]);
      await page.emulateMedia({ media: 'screen' });
    }
  });

  test('prints the brief from a phone as it prints from a desktop', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      reducedMotion: 'reduce',
    });
    try {
      const page = await context.newPage();
      await openDecide(page, project);
      const out = await printed(page);
      expect(out.pages).toBeGreaterThan(10);
      expect(out.overlaps, 'text drawn over text').toEqual([]);
      for (const statement of statementsOf().slice(0, 60)) {
        expect(
          holds(out, statement.text.slice(0, 50)),
          `${statement.section}/${statement.id}`,
        ).toBe(true);
      }
    } finally {
      await context.close();
    }
  });
});

/** A guard for the helper itself: it must see text drawn over text when there is some. */
test('the check for text drawn over text does see it when it is there', async ({ page }) => {
  await page.setContent(
    '<p style="position:absolute;top:100px;left:50px;font:20px sans-serif">The first line of the page</p>' +
      '<p style="position:absolute;top:104px;left:60px;font:20px sans-serif">A second line over it</p>',
  );
  const out = await printed(page as Page);
  expect(out.overlaps.length).toBeGreaterThan(0);
});
