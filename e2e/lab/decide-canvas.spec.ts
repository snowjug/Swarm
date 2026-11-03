import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  DECISION_STATUSES,
  DECISION_STATUS_INFO,
  EPISTEMIC_LABELS,
  EPISTEMIC_LABEL_INFO,
  type DecisionView,
} from '../../shared/decision';
import {
  emptyFixture,
  richFixture,
  statusFixture,
  viewFixture,
} from '../../frontend/src/test/decision';
import { claimsAgainst } from '../support/claims';
import {
  apiContext,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  expectReadableText,
  expectTouchTargets,
  watchPage,
} from '../support/helpers';
import { PHONE, forget, makeLegacy, quiet } from '../support/shell';
import {
  NINE,
  briefed,
  decisionView,
  holds,
  openDecide,
  printed,
  toFullReport,
  verdict,
  viewItem,
} from '../support/decide';

// The decision canvas: the first viewport of the Decide scene, an answer-first picture of the decision that says what
// it rests on, what limits it and what to check, and never more than the simulation shows. Rules mode: no model is
// called. A canvas that cannot be made from a real project (a blocked decision, an insufficient one) is served to the
// page by the route that it asks, from the same fixtures the page's own tests use.

let api: APIRequestContext;
let project = '';
const made: string[] = [];
const keep = (id: string): string => {
  made.push(id);
  return id;
};

test.beforeAll(async ({ playwright }) => {
  api = await apiContext(playwright);
  project = keep(await briefed(api, { name: 'Canvas: a decision' }));
});

test.afterAll(async () => {
  await forget(api, made);
  await api.dispose();
});

test.use({ reducedMotion: 'reduce' });

/** Serves the page a decision view of our own making, in place of the one the server would work out. */
async function serve(page: Page, view: DecisionView): Promise<void> {
  await page.route('**/api/projects/*/decision', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(view) }),
  );
}

const STATUS_LABELS = Object.values(DECISION_STATUS_INFO).map((info) => info.label);

test.describe('the decision view at 1440 by 900', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('shows the nine things, in the order a decision is read, answer first, in the first viewport', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openDecide(page, project);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText(
      'Decision view',
    );
    await expect(page.getByText('Explore scenarios, not predictions.')).toBeVisible();

    const boxes: { title: string; x: number; y: number }[] = [];
    for (const title of NINE) {
      const heading = viewItem(page, title);
      await expect(heading, title).toBeVisible();
      const box = (await heading.boundingBox())!;
      boxes.push({ title, x: box.x, y: box.y });
    }
    // The order a reader meets them in: along a row from the left, and a row after the one above it.
    for (let index = 1; index < boxes.length; index += 1) {
      const before = boxes[index - 1]!;
      const after = boxes[index]!;
      const below = after.y > before.y + 14;
      const beside = Math.abs(after.y - before.y) <= 14 && after.x > before.x;
      expect(below || beside, `${before.title} comes before ${after.title}`).toBe(true);
    }
    // All of it is in the first viewport: nothing has to be scrolled to.
    const bottoms = await page
      .locator('[data-canvas-item]')
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().bottom));
    expect(bottoms).toHaveLength(NINE.length);
    expect(
      Math.max(...bottoms),
      'the lowest of the nine ends inside the window',
    ).toBeLessThanOrEqual(900);

    // The answer is a status in words, and the recommendation says how much of it is stated.
    const status = page.locator('[data-canvas-item="answer"] h3');
    await expect(status).toHaveText(new RegExp(`^(?:${STATUS_LABELS.join('|')})$`, 'u'));
    await expect(
      viewItem(page, 'Recommended next move').locator('xpath=ancestor::section[1]'),
    ).toContainText(/\d of \d parts stated/u);
    // Every statement says what kind of statement it is, as text that a screen reader reads too.
    await expect(page.locator('[data-canvas-item="answer"] .sw-canvas-label').first()).toHaveText(
      'Kind of statement: Recommendation',
    );
    await expect(page.locator('.sw-canvas-label .sr-only').first()).toHaveText(
      'Kind of statement: ',
    );

    await expectNoHorizontalOverflow(page);
    await expectReadableText(page, 'the decision view');
    expect(problems, 'what the page logged or failed at').toEqual([]);
  });

  test('says nothing the product may not say, and no figure without what it is a figure of', async ({
    page,
  }) => {
    await openDecide(page, project);
    const said = (await decisionView(page).innerText()).replace(/\s+/gu, ' ');
    // What the independent review says is quoted as it said it, with its own statistical terms; the rest has no percent sign.
    expect(said.replace(/“[^”]*”/gu, '')).not.toContain('%');
    expect(claimsAgainst(said), said).toEqual([]);
  });

  test('has one level-one heading, the nine as level-two headings, and the full report beneath it', async ({
    page,
  }) => {
    await openDecide(page, project);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveCount(1);
    for (const title of NINE) {
      await expect(viewItem(page, title), title).toHaveCount(1);
    }
    await expect(
      page.getByRole('main').getByRole('heading', { level: 2, name: 'Full report' }),
    ).toHaveCount(1);
    await expect(verdict(page)).toContainText('the share of simulated members looking');
  });

  test('explains what the labels mean, in a popover for the pointer and in the page for everyone', async ({
    page,
  }) => {
    await openDecide(page, project);
    await page.getByRole('button', { name: 'Labels', exact: true }).click();
    const legend = page.getByRole('dialog', { name: 'What the labels mean' });
    await expect(legend).toBeVisible();
    for (const label of EPISTEMIC_LABELS) {
      await expect(legend, label).toContainText(EPISTEMIC_LABEL_INFO[label].name);
      await expect(legend, label).toContainText(EPISTEMIC_LABEL_INFO[label].meaning);
    }
    await page.keyboard.press('Escape');
    await expect(legend).toBeHidden();
    await expect(page.getByRole('button', { name: 'Labels', exact: true })).toBeFocused();
    // The same words are in the page, under the nine, where print and find-in-page reach them.
    await expect(page.getByRole('button', { name: /^What the labels mean/u })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  test('opens what lies behind the status when asked, and takes the reader there', async ({
    page,
  }) => {
    await openDecide(page, project);
    const why = page.getByRole('button', { name: /^Why this status The rules/u });
    await expect(why).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('button', { name: 'Why this status', exact: true }).click();
    await expect(why).toHaveAttribute('aria-expanded', 'true');
    await expect(why).toBeFocused();
    await expect(
      page.getByText(
        'The rules are tried in this order, and the first that applies sets the status.',
      ),
    ).toBeInViewport();
    await expect(page.getByText('Applies', { exact: true })).toBeVisible();
  });

  test('keeps the full report one press below, and goes to it', async ({ page }) => {
    await openDecide(page, project);
    await expect(verdict(page)).not.toBeInViewport();
    await toFullReport(page);
    await expect(page.locator('#sw-full-report')).toBeFocused();
    await expect(verdict(page)).toBeVisible();
  });

  test('is clean in both themes and with every detail open', async ({ page }) => {
    for (const theme of ['light', 'dark', 'high-contrast'] as const) {
      await openDecide(page, project, undefined, { theme });
      await quiet(page);
      await expectNoAxeViolations(page, `the decision view: ${theme}`);
    }
    await openDecide(page, project);
    for (const button of await page.locator('.sw-canvas-detail .sw-disc__head').all()) {
      await button.click();
    }
    await quiet(page);
    await expectNoAxeViolations(page, 'the decision view with every detail open');
    await expectNoHorizontalOverflow(page);
    await expectReadableText(page, 'the decision view with every detail open');
  });
});

test.describe('every status, and a project with every part full', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const status of DECISION_STATUSES) {
    test(`says "${DECISION_STATUS_INFO[status].label}" in words, with what it means`, async ({
      page,
    }) => {
      const problems = watchPage(page);
      await serve(page, viewFixture(statusFixture(status)));
      await openDecide(page, project);
      const answer = page.locator('[data-canvas-item="answer"]');
      await expect(answer.getByRole('heading', { level: 3 })).toHaveText(
        DECISION_STATUS_INFO[status].label,
      );
      await expect(answer).toContainText(DECISION_STATUS_INFO[status].meaning);
      await quiet(page);
      await expectNoAxeViolations(page, `the decision view: ${status}`);
      await expectNoHorizontalOverflow(page);
      expect(problems).toEqual([]);
    });
  }

  test('keeps all nine in the first viewport when every part of the picture is full', async ({
    page,
  }) => {
    await serve(page, viewFixture(richFixture()));
    await openDecide(page, project);
    await expect(page.locator('[data-canvas-item="answer"]')).toContainText('Provisional');
    const bottoms = await page
      .locator('[data-canvas-item]')
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().bottom));
    expect(Math.max(...bottoms)).toBeLessThanOrEqual(900);
    // What does not fit is counted and one press away, and not left out.
    await expect(
      page.getByRole('button', { name: /4 views and 2 assumptions in full/u }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /more constraints and open questions/u }),
    ).toBeVisible();
    await expectNoAxeViolations(page, 'the decision view with every part full');
  });
});

test.describe('the decision view on a phone', () => {
  test.use(PHONE);

  test('puts the answer first, folds the other seven in the same order, and every control is a finger wide', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openDecide(page, project);
    await expect(viewItem(page, 'Question')).toBeVisible();
    await expect(page.locator('[data-canvas-item="answer"] h3')).toBeVisible();
    const tops: number[] = [];
    for (const title of NINE) tops.push((await viewItem(page, title).boundingBox())!.y);
    expect(tops, 'one above the next').toEqual([...tops].sort((a, b) => a - b));
    for (const title of NINE.slice(2)) {
      await expect(viewItem(page, title).getByRole('button'), title).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    }
    await viewItem(page, 'Most plausible futures').getByRole('button').click();
    await expect(viewItem(page, 'Most plausible futures').getByRole('button')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(page.locator('[data-canvas-item="futures"]')).toContainText('simulated members');
    await expectNoHorizontalOverflow(page);
    await expectTouchTargets(page, 'the decision view on a phone', '.sw-canvas');
    await expectNoAxeViolations(page, 'the decision view on a phone');
    expect(problems).toEqual([]);
  });
});

test.describe('when there is no picture to show', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('says what is missing and offers the step that supplies it, with no report beneath', async ({
    page,
  }) => {
    // A record the guided journey did not make has no comparison, and Decide is open to it: the page says what is missing.
    const bare = keep(await makeLegacy(api, 'Canvas: no comparison'));
    const read = (await (await api.get(`/api/projects/${bare}/decision`)).json()) as DecisionView;
    expect(read.canvas).toBeNull();
    expect(read.readiness).toMatchObject({ state: 'no-analysis', next: 'ask' });
    await openDecide(page, bare);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Decision view');
    await expect(
      page.getByRole('heading', { level: 2, name: 'Nothing to decide from yet' }),
    ).toBeVisible();
    // What the server says is missing is what the page says.
    await expect(page.getByRole('main')).toContainText(read.readiness.missing[0]!);
    await expect(page.getByRole('button', { name: 'Open Ask' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Full report' })).toHaveCount(0);
    await expectNoAxeViolations(page, 'the decision view with no comparison');
  });

  test('says that a comparison is running, and that the last one did not finish', async ({
    page,
  }) => {
    await serve(page, emptyFixture('running'));
    await openDecide(page, project);
    await expect(page.getByRole('heading', { level: 2, name: 'Not ready yet' })).toBeVisible();
    await expect(page.getByRole('main')).toContainText(
      'The decision picture appears when it finishes.',
    );
    await expect(page.getByRole('button', { name: 'Open Simulate' })).toHaveCount(0);
    await expectNoAxeViolations(page, 'the decision view while a comparison runs');

    await page.unroute('**/api/projects/*/decision');
    await serve(page, emptyFixture('failed'));
    await openDecide(page, project);
    await expect(page.getByRole('main')).toContainText('The last comparison did not finish');
    await expect(page.getByRole('button', { name: 'Open Simulate' })).toBeVisible();
  });

  test('says when it cannot be read, keeps the way to try again, and shows the picture once it can be', async ({
    page,
  }) => {
    const problems = watchPage(page, { refusals: true });
    let refuse = true;
    await page.route('**/api/projects/*/decision', (route) =>
      refuse
        ? route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({
              error: {
                code: 'DECISION_FAILED',
                message: 'The decision view could not be read just now.',
              },
            }),
          })
        : route.continue(),
    );
    await page.goto(`/?project=${project}&scene=decide`);
    const alert = page
      .getByRole('alert')
      .filter({ hasText: 'The decision view could not be read' });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Nothing has been lost');
    await expectNoAxeViolations(page, 'the decision view could not be read');
    refuse = false;
    await alert.getByRole('button', { name: 'Try again' }).click();
    await expect(viewItem(page, 'Current best answer')).toBeVisible();
    await expect(alert).toHaveCount(0);
    expect(problems.filter((problem) => !problem.includes('500'))).toEqual([]);
  });

  test('says that it describes the project as it was once what it was made from has changed', async ({
    page,
  }) => {
    const changed = keep(await briefed(api, { name: 'Canvas: stale' }));
    await openDecide(page, changed);
    await expect(page.getByText('This picture describes the project as it was')).toHaveCount(0);
    const found = await api.post(`/api/projects/${changed}/stakeholders/discover`, {
      data: { mode: 'rules', confirm: true },
    });
    expect(found.ok(), await found.text()).toBe(true);
    await openDecide(page, changed);
    const notice = page
      .getByRole('status')
      .filter({ hasText: 'This picture describes the project as it was' });
    await expect(notice).toContainText('was run before the stakeholders changed');
    await expect(page.locator('[data-canvas-item="answer"]')).toContainText('Not current');
    await expect(notice.getByRole('button', { name: 'Open Simulate' })).toBeVisible();
    await expectNoAxeViolations(page, 'a decision view that is out of date');
  });
});

test.describe('on paper', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('opens on the decision view, with every detail open and no control that serves the screen', async ({
    page,
  }) => {
    await openDecide(page, project);
    const out = await printed(page);
    expect(out.overlaps, 'text drawn over text').toEqual([]);
    expect(holds(out, 'Decision view Explore scenarios, not predictions.')).toBe(true);
    // What is folded on the screen is open on the page.
    expect(
      holds(out, 'The rules are tried in this order, and the first that applies sets the status.'),
    ).toBe(true);
    expect(holds(out, EPISTEMIC_LABEL_INFO.fact.meaning)).toBe(true);
    expect(holds(out, 'Swarm recommends and explains. It does not contact anyone')).toBe(true);
    // The decision view comes before the brief it stands above.
    expect(out.flat.indexOf('decisionview'), 'the decision view is first').toBeGreaterThanOrEqual(
      0,
    );
    expect(out.flat.indexOf('decisionview')).toBeLessThan(out.flat.indexOf('decisionbrief'));
    await expect(page.getByRole('button', { name: 'Full report' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Labels', exact: true })).toBeHidden();
  });
});
