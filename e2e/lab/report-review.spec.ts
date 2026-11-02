import { expect, test, type APIRequestContext } from '@playwright/test';
import type { CritiquesView } from '../../shared/critique';
import {
  apiContext,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  watchPage,
} from '../support/helpers';
import { forget, quiet } from '../support/shell';
import { openApp } from '../support/app';
import { briefed, chapter, openDecide, reviewSheet, tools } from '../support/decide';

// The independent review: critics challenge the analysis and never change it. It is a sheet over the brief, opened
// from the tools, from the contents of the brief or from the note that stands beside the statement it is about; a
// criticism can be answered, accepted or disputed, and what the person wrote is never lost. Rules mode.

let api: APIRequestContext;
let reviewed = '';

test.beforeAll(async ({ playwright }) => {
  api = await apiContext(playwright);
  reviewed = await briefed(api, { name: 'Review: shared' });
});

test.afterAll(async () => {
  await forget(api, [reviewed]);
  await api.dispose();
});

test.use({ reducedMotion: 'reduce' });

const critiquesOf = async (project: string): Promise<CritiquesView> =>
  (await (await api.get(`/api/projects/${project}/critiques`)).json()) as CritiquesView;

const filters = (page: import('@playwright/test').Page) =>
  reviewSheet(page).getByRole('group', { name: 'Filter the criticisms' });

test.describe('the review on a desktop screen', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('opens in a sheet from the tools, says what it is, counts what is open, and gives focus back', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openDecide(page, reviewed);
    const open = tools(page).getByRole('button', { name: /^Review/u });
    const view = await critiquesOf(reviewed);
    const raised = view.critiques!.critiques.length;
    expect(raised).toBeGreaterThan(0);
    await expect(open).toContainText(String(raised));

    await open.click();
    const sheet = reviewSheet(page);
    await expect(sheet).toBeVisible();
    await expect(page).toHaveURL(/[?&]view=review(?:&|$)/u);
    await expect(sheet).toContainText('Critics challenge the analysis and never change it.');
    await expect(filters(page).getByRole('button', { name: `Open ${raised}` })).toBeVisible();
    await expectNoAxeViolations(page, 'the review sheet');
    // The critics, each with what it asked, and the ones that raised nothing say that it proves nothing.
    expect(await sheet.getByRole('region').count()).toBeGreaterThan(0);

    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(page).not.toHaveURL(/[?&]view=review/u);
    await expect(open, 'focus goes back to what opened the sheet').toBeFocused();
    expect(problems).toEqual([]);
  });

  test('is named by an address, and closing it leaves the brief where it was', async ({ page }) => {
    await openDecide(page, reviewed, 'review');
    const sheet = reviewSheet(page);
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page).not.toHaveURL(/view=review/u);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('opens at the criticism that stands beside its statement, and gives focus back to the note', async ({
    page,
  }) => {
    await openDecide(page, reviewed);
    const note = chapter(page, 'Stakeholder landscape')
      .getByRole('button', { name: /^Criticism:/u })
      .first();
    await note.scrollIntoViewIfNeeded();
    // What the note says is the objection itself: the open criticism of the sheet is the one that says it.
    const objection = (await note.innerText())
      .split('\n')
      .map((line) => line.trim())
      .sort((a, b) => b.length - a.length)[0]!;
    await note.click();
    const sheet = reviewSheet(page);
    await expect(sheet).toBeVisible();
    const openOne = sheet.getByRole('button', { expanded: true });
    await expect(openOne).toHaveCount(1);
    await expect(openOne).toContainText(objection.slice(0, 40));
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(note).toBeFocused();
  });

  test('says that a critic that raised nothing does not show the analysis is right', async ({
    page,
  }) => {
    await openDecide(page, reviewed);
    const review = chapter(page, 'Independent review');
    await review.scrollIntoViewIfNeeded();
    await expect(review).toContainText('A criticism is a challenge, not a verdict');
    await expect(review).toContainText('raised nothing, which does not show the analysis is right');
    await expect(review).toContainText('Only the deterministic checks run');
  });
});

test.describe('answering a criticism', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('a criticism can be answered, accepted or disputed, and the answer is kept with the review', async ({
    page,
  }) => {
    const project = await briefed(api, { name: 'Review: answers' });
    try {
      const problems = watchPage(page);
      await openDecide(page, project, 'review');
      const sheet = reviewSheet(page);
      const before = (await critiquesOf(project)).critiques!.critiques;
      const raised = before.length;
      expect(raised).toBeGreaterThanOrEqual(3);

      // Each criticism is found by what it says, since an answered one moves down the sheet.
      const chosen = before.slice(0, 3);
      for (const [index, [choice, status]] of (
        [
          ['Respond', 'responded'],
          ['Accept', 'accepted'],
          ['Dispute', 'disputed'],
        ] as const
      ).entries()) {
        const article = sheet.getByRole('article').filter({ hasText: chosen[index]!.objection });
        await article.getByRole('button').first().click();
        await article
          .getByRole('textbox', { name: 'Your response', exact: true })
          .fill(`${choice}: written in the review (${index}).`);
        await article.getByRole('radio', { name: choice }).click();
        await expect(article.getByRole('radio', { name: choice })).toBeChecked();
        await article.getByRole('button', { name: 'Save response' }).click();
        await expect(article).toContainText(
          { responded: 'Answered', accepted: 'Accepted', disputed: 'Disputed' }[status],
        );
      }
      // The sheet counts what is still open, and the server holds what was written.
      await expect(filters(page).getByRole('button', { name: `Answered 3` })).toBeVisible();
      await expect
        .poll(async () =>
          (await critiquesOf(project))
            .critiques!.critiques.filter((critique) => critique.status !== 'open')
            .map((critique) => critique.status)
            .sort(),
        )
        .toEqual(['accepted', 'disputed', 'responded']);

      // It is still there after the page is read again.
      await page.reload();
      await expect(reviewSheet(page)).toBeVisible();
      await expect(filters(page).getByRole('button', { name: 'Answered 3' })).toBeVisible();
      expect(problems).toEqual([]);
    } finally {
      await forget(api, [project]);
    }
  });

  test('an answer that the server refuses because the review changed is told, and what was written stays', async ({
    page,
  }) => {
    await openDecide(page, reviewed, 'review');
    const sheet = reviewSheet(page);
    const before = await critiquesOf(reviewed);
    // The refusal the server gives when someone else answered or the review was run again since the page read it.
    await page.route('**/critiques/*/response', (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'CRITIQUES_CHANGED', message: 'The review has changed.' },
        }),
      }),
    );
    const article = sheet.getByRole('article').first();
    await article.getByRole('button').first().click();
    const mine = 'My answer, written while the review was changed.';
    await article.getByRole('textbox', { name: 'Your response', exact: true }).fill(mine);
    await article.getByRole('button', { name: 'Save response' }).click();
    await expect(sheet.getByRole('alert')).toContainText(
      'This review changed while you were writing',
    );
    await expect(
      sheet
        .getByRole('article')
        .first()
        .getByRole('textbox', { name: 'Your response', exact: true }),
    ).toHaveValue(mine);
    // Nothing was kept of it: the review is as it was.
    const after = await critiquesOf(reviewed);
    expect(after.revision).toBe(before.revision);
    expect(after.critiques!.critiques.map((critique) => critique.status)).toEqual(
      before.critiques!.critiques.map((critique) => critique.status),
    );
  });
});

test.describe('a brief whose review has not been run', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('says so, runs it when asked, and shows what the critics raised', async ({ page }) => {
    const project = await briefed(api, { name: 'Review: not run', review: false });
    try {
      const problems = watchPage(page);
      await openDecide(page, project);
      await expect(tools(page).getByRole('button', { name: /^Review/u })).toContainText(
        'not run yet',
      );
      const review = chapter(page, 'Independent review');
      await review.scrollIntoViewIfNeeded();
      await expect(review).toContainText('Seven critics can challenge this analysis');
      await review.getByRole('button', { name: 'Run the independent review' }).click();
      await expect(page.getByRole('region', { name: 'Notifications' })).toContainText(
        'The independent review is ready',
      );
      await expect(review).toContainText('criticisms raised by');
      expect((await critiquesOf(project)).critiques).not.toBeNull();
      await expect(tools(page).getByRole('button', { name: /^Review/u })).not.toContainText(
        'not run yet',
      );
      expect(problems).toEqual([]);
    } finally {
      await forget(api, [project]);
    }
  });
});

test.describe('the review on a tablet and a phone', () => {
  test.describe('at 768 wide', () => {
    test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true });

    test('puts a mark under the statement a criticism is about, which opens the review at it', async ({
      page,
    }) => {
      await openDecide(page, reviewed);
      const mark = chapter(page, 'Stakeholder landscape')
        .getByRole('button', { name: /criticism of this statement/u })
        .first();
      await mark.scrollIntoViewIfNeeded();
      await expect(mark).toBeVisible();
      const box = await mark.boundingBox();
      expect(box!.height, 'a mark a finger can press').toBeGreaterThanOrEqual(43.5);
      await mark.click();
      const sheet = reviewSheet(page);
      await expect(sheet).toBeVisible();
      await expect(sheet.getByRole('button', { expanded: true })).toHaveCount(1);
      await expectNoHorizontalOverflow(page);
      await page.keyboard.press('Escape');
      await expect(mark).toBeFocused();
    });
  });

  test.describe('at 390 wide', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test('is a sheet from the bottom with every control a finger can press, in light and dark', async ({
      page,
    }) => {
      const problems = watchPage(page);
      for (const theme of ['light', 'dark'] as const) {
        await openApp(page, { project: reviewed, scene: 'decide', view: 'review', theme });
        const sheet = reviewSheet(page);
        await expect(sheet).toBeVisible();
        await quiet(page);
        const box = (await sheet.boundingBox())!;
        expect(box.width, `${theme}: the sheet fits the screen`).toBeLessThanOrEqual(390);
        await expectNoAxeViolations(page, `${theme}: the review on a phone`);
        const small = await sheet.getByRole('button').evaluateAll((buttons) =>
          buttons
            .map((button) => ({
              name: (button.textContent ?? '').trim().slice(0, 30),
              box: button.getBoundingClientRect(),
            }))
            .filter(
              ({ box: b }) => b.width > 0 && b.height > 0 && (b.height < 43.5 || b.width < 43.5),
            )
            .map(({ name, box: b }) => `${name}: ${Math.round(b.width)}x${Math.round(b.height)}`),
        );
        expect(small, `${theme}: buttons under 44px`).toEqual([]);
        await page.keyboard.press('Escape');
        await expect(sheet).toHaveCount(0);
      }
      expect(problems).toEqual([]);
    });
  });
});
