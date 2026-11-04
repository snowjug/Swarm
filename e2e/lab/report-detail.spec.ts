import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  apiContext,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  expectReadableText,
  viewports,
  watchPage,
} from '../support/helpers';
import { forget, makeLegacy, quiet } from '../support/shell';
import { openApp } from '../support/app';
import {
  asReader,
  briefed,
  deepDived,
  holds,
  openDecide,
  printed,
  saved,
  tools,
  verdict,
  withReport,
} from '../support/decide';

// The detailed report of the deep dive, beside the decision brief: the report the engine wrote from the recorded run,
// the sources it cites, how it is read (a contents that follows the reader, figures, chapters with their sources),
// and what leaves it (Markdown, the project as JSON, paper). Before it is written the page says what it is and offers
// to write it; the deep dive comes first. Rules mode: no model is called.

let api: APIRequestContext;
const made: string[] = [];

test.beforeAll(async ({ playwright }) => {
  api = await apiContext(playwright);
});

test.afterAll(async () => {
  await forget(api, made);
  await api.dispose();
});

test.use({
  reducedMotion: 'reduce',
  viewport: { width: 1440, height: 900 },
  actionTimeout: 30_000,
});

async function projectWithReport(name: string): Promise<string> {
  const id = await withReport(api, await briefed(api, { name, review: false }));
  made.push(id);
  return id;
}

const reportOf = async (project: string) =>
  (
    (await (await api.get(`/api/projects/${project}`)).json()) as {
      report: {
        title: string;
        executiveSummary: string;
        sections: { title: string; body: string }[];
        limitations: string[];
      };
    }
  ).report;

test.describe('a finished report', () => {
  test('is reached from the brief, says what it is, and holds the whole of what the engine wrote', async ({
    page,
  }) => {
    const problems = watchPage(page);
    const project = await projectWithReport('Report: reading');
    const report = await reportOf(project);

    await openDecide(page, project);
    await tools(page).getByRole('button', { name: 'Detailed report' }).click();
    await expect(page).toHaveURL(/view=report/u);
    const title = page.getByRole('main').getByRole('heading', { level: 1 });
    await expect(title).toHaveText(report.title);
    await expect(page.getByRole('main')).toContainText(
      'Fictional actors under stated assumptions. A simulation, not a forecast.',
    );
    await expect(page.getByRole('main').getByText('Rules-based', { exact: true })).toBeVisible();

    // The summary, every chapter, and the limitations are all there, in the words of the report.
    await expect(page.getByRole('region', { name: 'Summary' })).toContainText(
      report.executiveSummary.slice(0, 60),
    );
    for (const section of report.sections) {
      await expect(
        page.getByRole('heading', { level: 2, name: section.title }),
        section.title,
      ).toBeVisible();
    }
    await expect(page.getByRole('heading', { level: 2, name: 'Limitations' })).toBeVisible();
    for (const limit of report.limitations) {
      await expect(page.getByRole('main'), limit.slice(0, 40)).toContainText(limit.slice(0, 40));
    }
    // The figures are named, and numbers are never the only thing: the run in figures is a region of its own.
    await expect(page.getByRole('region', { name: 'The run in figures' })).toBeVisible();
    await quiet(page);
    await expectNoAxeViolations(page, 'the detailed report');
    await expectNoHorizontalOverflow(page);
    expect(problems).toEqual([]);
  });

  test('is read with a contents that follows the reader and takes the reader to a chapter', async ({
    page,
  }) => {
    const project = await projectWithReport('Report: contents');
    const report = await reportOf(project);
    await openDecide(page, project, 'report');
    const last = report.sections.at(-1)!.title;
    const contents = page
      .getByRole('navigation')
      .filter({ has: page.getByRole('button', { name: last }) })
      .first();
    await contents.getByRole('button', { name: last }).click();
    const heading = page.getByRole('heading', { level: 2, name: last });
    await expect(heading).toBeInViewport();
    await expect(contents.getByRole('button', { name: last })).toHaveAttribute(
      'aria-current',
      /true|location|step/u,
    );
    // The first chapter is back one press away.
    await contents.getByRole('button', { name: report.sections[0]!.title }).click();
    await expect(
      page.getByRole('heading', { level: 2, name: report.sections[0]!.title }),
    ).toBeInViewport();
  });

  test('says where each chapter’s statements come from: the sources it cites open on press', async ({
    page,
  }) => {
    const project = await projectWithReport('Report: sources');
    await openDecide(page, project, 'report');
    const cites = page.getByRole('complementary', { name: /^Sources and checks for / }).first();
    await expect(cites).toBeVisible();
    const first = cites.getByRole('button').first();
    await first.click();
    // A passage opens in a sheet with its text, which is only ever shown as text.
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await expectNoAxeViolations(page, 'a source passage of the detailed report');
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(first, 'focus goes back to the source that was pressed').toBeFocused();
  });

  test('leads to the studio and back, and the way back is always there', async ({ page }) => {
    const project = await projectWithReport('Report: ways');
    await openDecide(page, project, 'report');
    await page.getByRole('button', { name: 'Edit in the studio' }).click();
    await expect(page).toHaveURL(/view=studio/u);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText(
      'Work on the report',
    );
    await page.getByRole('button', { name: 'Detailed report' }).click();
    await expect(page).toHaveURL(/view=report/u);
    await page.getByRole('button', { name: 'Decision brief' }).click();
    await expect(page).not.toHaveURL(/view=/u);
    // The brief again: its verdict heads it, beneath the decision view, which holds the page's one level-one heading.
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText(
      'Decision view',
    );
    await expect(verdict(page)).toContainText('the share of simulated members');
  });

  test('exports: Markdown and the project as JSON are saved, and what they say is the report', async ({
    page,
  }) => {
    const project = await projectWithReport('Report: files');
    const report = await reportOf(project);
    await openDecide(page, project, 'report');

    await page.getByRole('main').getByRole('button', { name: 'Export' }).click();
    const markdown = await saved(page, () =>
      page.getByRole('menuitem', { name: 'Markdown' }).click(),
    );
    expect(markdown.name).toBe(`swarm-lab-${project}.md`);
    expect(markdown.text).toContain(report.title);
    for (const section of report.sections)
      expect(markdown.text, section.title).toContain(section.title);
    await expect(page.getByRole('region', { name: 'Notifications' })).toContainText(
      'Markdown exported',
    );

    await page.getByRole('main').getByRole('button', { name: 'Export' }).click();
    const json = await saved(page, () =>
      page.getByRole('menuitem', { name: /^Snapshot/u }).click(),
    );
    expect(json.name).toBe(`swarm-lab-${project}.json`);
    const snapshot = JSON.parse(json.text) as {
      project: { id: string; report: { title: string } | null };
    };
    expect(snapshot.project.id).toBe(project);
    expect(snapshot.project.report?.title).toBe(report.title);
  });

  test('prints whole, with none of the controls of the screen, and nothing drawn over anything else', async ({
    page,
  }) => {
    const project = await projectWithReport('Report: paper');
    const report = await reportOf(project);
    await openDecide(page, project, 'report');
    const out = await printed(page);
    expect(out.overlaps, 'text drawn over text').toEqual([]);
    expect(holds(out, report.title)).toBe(true);
    expect(holds(out, report.executiveSummary.slice(0, 60))).toBe(true);
    for (const section of report.sections) {
      expect(holds(out, section.title), section.title).toBe(true);
      expect(holds(out, section.body.slice(0, 50)), `the text of ${section.title}`).toBe(true);
    }
    for (const limit of report.limitations)
      expect(holds(out, limit.slice(0, 40)), limit).toBe(true);
    for (const chrome of [
      'Edit in the studio',
      'Ask about this',
      'Skip to content',
      'Decision brief',
      'Export',
    ]) {
      expect(holds(out, chrome), `"${chrome}" is not printed`).toBe(false);
    }
  });
});

test.describe('before the report is written', () => {
  test('a finished deep dive offers to write it, and writing it makes the report', async ({
    page,
  }) => {
    const problems = watchPage(page);
    const id = await deepDived(api, { name: 'Report: ready' });
    made.push(id);
    await openDecide(page, id, 'report');
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText(
      'Write the report',
    );
    await expect(page.getByRole('main')).toContainText('No model is used.');
    await expect(page.getByRole('main')).toContainText('Not a forecast');
    await quiet(page);
    await expectNoAxeViolations(page, 'the report that is ready to be written');
    await page.getByRole('button', { name: 'Write the report' }).click();
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).not.toHaveText(
      'Write the report',
      { timeout: 60_000 },
    );
    await expect(page.getByRole('heading', { level: 2, name: 'Limitations' })).toBeVisible({
      timeout: 60_000,
    });
    expect(problems).toEqual([]);
  });

  test('without a deep dive it says that the deep dive comes first, and leads to it', async ({
    page,
  }) => {
    const id = await briefed(api, { name: 'Report: blocked', review: false });
    made.push(id);
    await openDecide(page, id, 'report');
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText(
      'The deep dive comes first',
    );
    await quiet(page);
    await expectNoAxeViolations(page, 'the report that waits for the deep dive');
    // The way on is to the deep dive itself, at the view that runs it.
    await page.getByRole('button', { name: 'Go to the deep dive' }).click();
    await expect(page).toHaveURL(/scene=simulate/u);
    await expect(page).toHaveURL(/view=deep/u);
  });

  test('a record that was not made by the guided flow says there is nothing to write, with the way back', async ({
    page,
  }) => {
    const id = await makeLegacy(api, 'Report: legacy');
    made.push(id);
    await openApp(page, { project: id, scene: 'decide', view: 'report' });
    // A quick run of the earlier workflow wrote its report when it ran: it is read here.
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toContainText(
      'scenario findings',
    );
    await expect(page.getByRole('button', { name: 'Decision brief' })).toBeVisible();
  });
});

for (const [where, make, heading] of [
  [
    'with no deep dive',
    () => briefed(api, { name: 'Report: tools, no deep dive', review: false }),
    'The deep dive comes first',
  ],
  [
    'with the deep dive done',
    () => deepDived(api, { name: 'Report: tools, deep dive done' }),
    'Write the report',
  ],
] as const) {
  test.describe(`the tools of a brief whose detailed report is not written, ${where}`, () => {
    test('offer to write it in place of editing it, and the offer leads to where it is written', async ({
      page,
    }) => {
      const problems = watchPage(page);
      const id = await make();
      made.push(id);
      await openDecide(page, id);
      const row = tools(page);
      const write = row.getByRole('button', { name: 'Write the detailed report' });
      await expect(write).toBeVisible();
      // The studio would only say that there is nothing to work on, so it is not offered; nor is the page to read.
      await expect(row.getByRole('button', { name: 'Edit report' })).toHaveCount(0);
      await expect(row.getByRole('button', { name: 'Detailed report', exact: true })).toHaveCount(
        0,
      );
      await quiet(page);
      await expectNoAxeViolations(page, `the tools of a brief with no detailed report, ${where}`);
      await write.click();
      await expect(page).toHaveURL(/view=report/u);
      await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText(heading);
      expect(problems).toEqual([]);
    });

    test.describe('on a phone', () => {
      test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

      test('put the same offer in the menu, where editing it would have been', async ({ page }) => {
        const id = await make();
        made.push(id);
        await openDecide(page, id);
        await tools(page).getByRole('button', { name: 'More' }).click();
        const menu = page.getByRole('menu');
        await expect(menu.getByRole('menuitem', { name: 'Edit report' })).toHaveCount(0);
        await expect(
          menu.getByRole('menuitem', { name: 'Detailed report', exact: true }),
        ).toHaveCount(0);
        await menu.getByRole('menuitem', { name: 'Write the detailed report' }).click();
        await expect(page).toHaveURL(/view=report/u);
        await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText(heading);
      });
    });
  });
}

test.describe('a role that may read the brief but not write the report', () => {
  test('is offered neither the writing nor an editor that has nothing to edit, and the studio says who can', async ({
    page,
  }) => {
    const problems = watchPage(page);
    const id = await deepDived(api, { name: 'Report: a reader' });
    made.push(id);
    await asReader(page, id);

    await openDecide(page, id);
    await expect(tools(page).getByRole('button', { name: 'Export' })).toBeVisible();
    await expect(
      tools(page).getByRole('button', { name: /detailed report|Edit report/iu }),
    ).toHaveCount(0);

    // The address of the studio is still good: it says what is missing, and who can supply it, and offers no button
    // that would be refused.
    await openDecide(page, id, 'studio');
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText(
      'There is no report to work on yet',
    );
    await expect(page.getByRole('main')).toContainText(
      'Someone with the analyst or lead role needs to write it.',
    );
    await expect(page.getByRole('button', { name: 'Write the detailed report' })).toHaveCount(0);
    // The way back is the one of the page's own bar: it is there in every state of the studio.
    await expect(page.getByRole('button', { name: 'Decision brief' })).toBeVisible();
    await quiet(page);
    await expectNoAxeViolations(page, 'the studio of a reader, with no report to work on');
    expect(problems).toEqual([]);
  });
});

for (const [viewport, theme] of [
  [viewports[1], 'light'],
  [viewports[3], 'dark'],
  [viewports[4], 'high-contrast'],
] as const) {
  test(`the detailed report fits ${viewport.name} in the ${theme} theme`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const problems = watchPage(page);
    const project = await projectWithReport(`Report: ${viewport.name} ${theme}`);
    await openApp(page, { project, scene: 'decide', view: 'report', theme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await quiet(page);
    await expectNoHorizontalOverflow(page);
    await expectReadableText(page, `the detailed report ${viewport.name}`);
    await expectNoAxeViolations(page, `${theme} ${viewport.name}: the detailed report`);
    expect(problems).toEqual([]);
  });
}
