import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  apiContext,
  expectNoAxeViolations,
  expectNoBrokenFigures,
  expectNoHorizontalOverflow,
  watchPage,
} from '../support/helpers';
import { forget, makeLegacy, quiet } from '../support/shell';
import { briefed, compared, chapter, openDecide, tools, verdict } from '../support/decide';

// Every state the decision scene can be in: waiting for a brief, writing it, failing to write or to read it,
// out of date, with a review that is not run, and a record that has no comparison at all. Each says what is true,
// offers the one thing that can be done, and recovers. Rules mode.

let api: APIRequestContext;
const made: string[] = [];

test.beforeAll(async ({ playwright }) => {
  api = await apiContext(playwright);
});

test.afterAll(async () => {
  await forget(api, made);
  await api.dispose();
});

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });

/** The element that has focus is the one the brief means to be at: its answer, or a chapter. */
const focusedId = (page: import('@playwright/test').Page): Promise<string | undefined> =>
  page.evaluate(() => document.activeElement?.id);

const keep = <T extends string>(id: T): T => {
  made.push(id);
  return id;
};

test.describe('a comparison with no brief yet', () => {
  test('offers to write it, says what it will hold, and is clean in both themes', async ({
    page,
  }) => {
    const problems = watchPage(page);
    const project = keep(await compared(api, { name: 'States: no brief' }));
    for (const theme of ['light', 'dark'] as const) {
      await openDecide(page, project, undefined, { theme });
      await expect(
        page.getByRole('heading', { level: 2, name: 'Turn the comparison into a decision.' }),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Write the brief' })).toBeVisible();
      await expect(page.getByRole('list', { name: 'What the brief holds' })).toBeVisible();
      // What it is and is not, before it is written.
      await expect(page.getByRole('main')).toContainText('does not guarantee or precisely predict');
      await quiet(page);
      await expectNoAxeViolations(page, `${theme}: no brief yet`);
      await expectNoHorizontalOverflow(page);
    }
    expect(problems).toEqual([]);
  });

  test('writes it when asked, says that it is being written, and takes the reader to the answer', async ({
    page,
  }) => {
    const problems = watchPage(page);
    const project = keep(await compared(api, { name: 'States: write' }));
    // The server takes a moment, so that the page can be seen waiting for it.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/projects/*/brief', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await gate;
      return route.continue();
    });
    await openDecide(page, project);
    await page.getByRole('button', { name: 'Write the brief' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Writing the brief' })).toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: /^Writing the brief$/u }),
    ).toBeVisible();
    await expectNoAxeViolations(page, 'the brief is being written');
    release();
    await expect(verdict(page)).toContainText('the share of simulated members looking');
    // The button that asked is gone: the answer has the reader's place, and the toast says it is done.
    await expect.poll(() => focusedId(page)).toBe('brief-answer');
    await expect(page.getByRole('region', { name: 'Notifications' })).toContainText(
      'The brief is ready',
    );
    expect(problems).toEqual([]);
  });

  test('says when the brief could not be made, keeps the way to try again, and recovers', async ({
    page,
  }) => {
    const project = keep(await compared(api, { name: 'States: write fails' }));
    const problems = watchPage(page, { refusals: true });
    let refuse = true;
    await page.route('**/api/projects/*/brief', (route) => {
      if (route.request().method() !== 'POST' || !refuse) return route.continue();
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'BRIEF_FAILED', message: 'The brief could not be written just now.' },
        }),
      });
    });
    await openDecide(page, project);
    await page.getByRole('button', { name: 'Write the brief' }).click();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('The brief could not be made');
    await expect(alert).toContainText('The brief could not be written just now.');
    // Nothing was lost, and the same page can ask again.
    refuse = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(verdict(page)).toContainText('the share of simulated members looking');
    expect(problems.filter((problem) => !problem.includes('500'))).toEqual([]);
  });
});

test.describe('a brief that cannot be read', () => {
  test('says so, with a way to try again, and shows the brief once it can be read', async ({
    page,
  }) => {
    const project = keep(await briefed(api, { name: 'States: read fails' }));
    const problems = watchPage(page, { refusals: true });
    let refuse = true;
    await page.route('**/api/projects/*/brief', (route) => {
      if (route.request().method() !== 'GET' || !refuse) return route.continue();
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'READ_FAILED', message: 'The brief could not be read.' },
        }),
      });
    });
    await page.goto(`/?project=${project}&scene=decide`);
    await expect(
      page.getByRole('heading', { name: 'The decision brief could not be loaded' }),
    ).toBeVisible();
    await expect(page.getByRole('main')).toContainText('The brief could not be read.');
    await expectNoAxeViolations(page, 'the brief could not be read');
    refuse = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(verdict(page)).toContainText('the share of simulated members looking');
    expect(problems.filter((problem) => !problem.includes('500'))).toEqual([]);
  });
});

test.describe('a brief that is out of date', () => {
  test('says what changed, offers the one action that helps, and is current again once it is written again', async ({
    page,
  }) => {
    const problems = watchPage(page);
    const project = keep(await briefed(api, { name: 'States: stale' }));
    // A newer comparison exists: the brief describes an older one.
    const started = await api.post(`/api/projects/${project}/analysis`, {
      data: { runsPerVariant: 10 },
    });
    expect(started.status(), await started.text()).toBe(202);
    const { analysis } = (await started.json()) as { analysis: { id: string } };
    await expect
      .poll(
        async () =>
          (
            (await (await api.get(`/api/projects/${project}/analysis/${analysis.id}`)).json()) as {
              analysis: { status: string };
            }
          ).analysis.status,
        { timeout: 120_000 },
      )
      .toBe('completed');

    await openDecide(page, project);
    await expect(page.getByText('Out of date', { exact: true })).toBeVisible();
    const notice = page.getByRole('main').getByText('This brief may be out of date');
    await expect(notice).toBeVisible();
    await expect(page.getByRole('main')).toContainText('A newer comparison exists.');
    await expectNoAxeViolations(page, 'a brief that is out of date');

    await page.getByRole('button', { name: 'Write the brief again' }).first().click();
    await expect(page.getByRole('region', { name: 'Notifications' })).toContainText(
      'The brief is up to date',
    );
    await expect(page.getByText('Out of date', { exact: true })).toHaveCount(0);
    await expect(page.getByText('This brief may be out of date')).toHaveCount(0);
    // The page is at the answer again, which says what the new comparison says.
    await expect.poll(() => focusedId(page)).toBe('brief-answer');
    expect(problems).toEqual([]);
  });

  test('says that an independent review run after the brief was written is not in the brief', async ({
    page,
  }) => {
    const project = keep(await briefed(api, { name: 'States: review after', review: false }));
    const run = await api.post(`/api/projects/${project}/critiques/run`, {
      data: { useModel: false },
    });
    expect(run.ok(), await run.text()).toBe(true);
    await openDecide(page, project);
    await expect(page.getByText('Out of date', { exact: true })).toBeVisible();
    await expect(page.getByRole('main')).toContainText('the independent review');
    await expect(page.getByRole('button', { name: 'Write the brief again' }).first()).toBeVisible();
  });
});

test.describe('a record that has no comparison', () => {
  test('says there is nothing to decide from yet, and leads to the step that is missing and to the report it does have', async ({
    page,
  }) => {
    const problems = watchPage(page);
    const project = keep(await makeLegacy(api, 'States: legacy'));
    await openDecide(page, project);
    const nothing = page.getByRole('heading', { level: 2, name: 'Nothing to decide from yet' });
    await expect(nothing).toBeVisible();
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText(
      'Decision view',
    );
    await expect(page.getByRole('button', { name: 'Open Ask' })).toBeVisible();
    await expectNoAxeViolations(page, 'a record with no comparison');
    await page.getByRole('button', { name: 'Detailed report' }).click();
    await expect(page).toHaveURL(/view=report/u);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toContainText(
      'scenario findings',
    );
    // The way back is always there.
    await page.getByRole('button', { name: 'Decision brief' }).click();
    await expect(nothing).toBeVisible();
    expect(problems).toEqual([]);
  });
});

test.describe('the independent review while it is being made', () => {
  test('says that it is running, and does not let it be started twice', async ({ page }) => {
    const project = keep(await briefed(api, { name: 'States: review running', review: false }));
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/critiques/run', async (route) => {
      await gate;
      return route.continue();
    });
    await openDecide(page, project);
    const review = chapter(page, 'Independent review');
    await review.scrollIntoViewIfNeeded();
    await review.getByRole('button', { name: 'Run the independent review' }).click();
    await expect(review.getByRole('status')).toBeVisible();
    await expect(review.getByRole('button', { name: /^Run/u })).toBeDisabled();
    await expect(tools(page).getByRole('button', { name: /^Review/u })).toBeVisible();
    release();
    await expect(review).toContainText('criticisms raised by');
  });
});

test.describe('words that are longer than the screen', () => {
  test('a very long word in the brief or in its review breaks where it must and widens nothing', async ({
    page,
  }) => {
    const problems = watchPage(page);
    const project = keep(await briefed(api, { name: 'States: long words' }));
    const LONG = 'Unbroken'.repeat(45);
    // What a source or a person wrote can be that long (an address, a code), and no page may be made wider by it:
    // every sentence the server wrote is followed by such a word.
    const plain =
      /(^id$|Id$|At$|^kind$|^status$|^verdict$|^tone$|^level$|hash|fingerprint|^severity$|^category$|^lens$|^label$|^name$|^key$)/u;
    const longer = (value: unknown, key = ''): unknown => {
      if (typeof value === 'string') {
        const fixed =
          plain.test(key) ||
          value.length < 28 ||
          /^[0-9a-f-]{20,}$/iu.test(value) ||
          /^\d{4}-\d\d-\d\d/u.test(value);
        return fixed ? value : `${value} ${LONG}`;
      }
      if (Array.isArray(value)) return value.map((entry) => longer(entry, key));
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value).map(([name, entry]) => [name, longer(entry, name)]),
        );
      }
      return value;
    };
    for (const pattern of [
      `**/api/projects/${project}/brief`,
      `**/api/projects/${project}/critiques*`,
    ]) {
      await page.route(pattern, async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        const response = await route.fetch();
        return route.fulfill({ response, json: longer(await response.json()) });
      });
    }
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await openDecide(page, project);
      await expect(page.getByRole('main')).toContainText('UnbrokenUnbroken');
      await tools(page).getByRole('button', { name: 'More' }).click();
      await page.getByRole('menuitem', { name: 'Open every chapter' }).click();
      await quiet(page);
      await expectNoHorizontalOverflow(page);
      await expectNoBrokenFigures(page);

      await tools(page)
        .getByRole('button', { name: /^Review/u })
        .click();
      const sheet = page.getByRole('dialog', { name: 'Independent review' });
      await expect(sheet).toContainText('UnbrokenUnbroken');
      await quiet(page);
      await expectNoHorizontalOverflow(page);
      // Nothing in the sheet is wider than the sheet: it does not scroll sideways, and neither does what it holds.
      const wider = await sheet.evaluate((element) => {
        const right = element.getBoundingClientRect().right;
        return [...element.querySelectorAll('*')].filter(
          (inner) => inner.getBoundingClientRect().right > right + 1,
        ).length;
      });
      expect(wider, `elements wider than the review at ${width}px`).toBe(0);
      await page.keyboard.press('Escape');
      await expect(sheet).toHaveCount(0);
    }
    expect(problems).toEqual([]);
  });
});
