import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import type { BriefView } from '../../shared/brief';
import { apiContext, watchPage } from '../support/helpers';
import { addressOf } from '../support/app';
import { arrived, forget } from '../support/shell';
import {
  BUS_RELATIONS,
  BUS_STAKEHOLDERS,
  chooseRuns,
  compared,
  compareAt,
  finished,
  rename,
  run,
  seedByHand,
  setup,
  simulateAt,
  startViaApi,
  waitForTheatre,
} from '../support/simulate';

// What a person is told when what a comparison, and the brief written from it, rest on changes somewhere else. "Elsewhere"
// is a second client of the same server (the API), as a colleague's browser would be. Each test makes its own project
// through the routes the pages use, with a finished comparison, the independent review and the brief, and then changes
// one thing the page has not been told about. The page is opened again afterwards, as a person who comes back would.

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(180_000);

let api: APIRequestContext;
const made: string[] = [];
test.beforeAll(async ({ playwright }) => {
  api = await apiContext(playwright);
});
test.afterAll(async () => {
  await forget(api, made);
  await api.dispose();
});

async function json<T>(response: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> {
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as T;
}

/** A project with a finished comparison, the independent review of it and the brief written from it. */
async function briefedProject(name: string): Promise<string> {
  const id = await seedByHand(api, name, BUS_STAKEHOLDERS, BUS_RELATIONS);
  made.push(id);
  await compared(api, id, { runsPerVariant: 10, sensitivity: false });
  await json(await api.post(`/api/projects/${id}/critiques/run`, { data: {} }));
  await json(await api.post(`/api/projects/${id}/brief`, { data: {} }));
  return id;
}

/** What a person does about stakeholders that were changed: find and approve them again, and make the actors again. */
async function approveAgain(id: string): Promise<void> {
  const found = await json<{ revision: number }>(
    await api.post(`/api/projects/${id}/stakeholders/discover`, {
      data: { mode: 'rules', confirm: true },
    }),
  );
  await json(
    await api.post(`/api/projects/${id}/stakeholders/approve`, {
      data: { expectedRevision: found.revision },
    }),
  );
  await json(await api.post(`/api/projects/${id}/actors/generate`, { data: { confirm: true } }));
}

const decideAt = (project: string): string => addressOf({ project, scene: 'decide' });
const outOfDate = (page: Page): Locator => page.getByRole('button', { name: 'Out of date' });
const olderOne = (page: Page): Locator => page.getByRole('button', { name: 'An older comparison' });
/** What the decision page says about its brief when what it rests on has changed. */
const briefNotice = (page: Page): Locator =>
  page.getByRole('status').filter({ hasText: 'This brief may be out of date' });

test.describe('a change made elsewhere', () => {
  test('the comparison says it is out of date once the stakeholders changed, and the way to make it current is refused until they are approved again', async ({
    page,
  }) => {
    const problems = watchPage(page, { refusals: true });
    const id = await briefedProject('Freshness: a stakeholder changed elsewhere');
    await page.goto(compareAt(id));
    await arrived(page);
    await expect(outOfDate(page)).toHaveCount(0);

    await rename(api, id, 'Residents renamed by a colleague');
    await page.reload();
    await arrived(page);
    await expect(outOfDate(page)).toBeVisible();
    await outOfDate(page).click();
    const popover = page.getByRole('dialog', { name: 'Out of date' });
    await expect(popover.getByText('so it describes the project as it was.')).toBeVisible();
    await expect(popover).toContainText('Only simulating again brings it up to date.');

    // The decision page says so too, and names the way: the comparison has to be run again.
    await page.keyboard.press('Escape');
    await page.goto(decideAt(id));
    await arrived(page);
    await expect(briefNotice(page)).toContainText(
      'The comparison it rests on was run before the stakeholders changed, so it describes the project as it was.',
    );
    await expect(
      briefNotice(page).getByRole('button', { name: 'Re-run the comparison' }),
    ).toBeVisible();

    // The page that starts it refuses a cast that is no longer approved, in words that say what to do, and shows nothing as running.
    await page.goto(simulateAt(id, 'setup'));
    await expect(setup(page)).toBeVisible();
    await chooseRuns(page, 10);
    await run(page);
    const refusal = page.getByRole('alert').filter({ hasText: 'The simulation did not start' });
    await expect(refusal).toContainText(
      'The stakeholders are not approved: they were found again or changed',
    );
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    expect(problems.filter((problem) => !/\b4\d\d\b/u.test(problem))).toEqual([]);
  });

  test('running the comparison again and writing the brief again brings it up to date', async ({
    page,
  }) => {
    const problems = watchPage(page);
    const id = await briefedProject('Freshness: the way back to a current brief');
    await rename(api, id, 'Residents renamed by a colleague');
    await page.goto(decideAt(id));
    await arrived(page);
    await expect(briefNotice(page)).toBeVisible();

    // What a person does about it: approve what they have changed, make the actors again, run the comparison again.
    await approveAgain(id);
    await page.goto(simulateAt(id, 'setup'));
    await expect(setup(page)).toBeVisible();
    await chooseRuns(page, 10);
    await run(page);
    await waitForTheatre(page);

    // The brief on show rests on the first comparison; a newer one has finished, so writing it again uses that.
    await page.goto(decideAt(id));
    await arrived(page);
    await expect(briefNotice(page)).toContainText('A newer comparison exists.');
    await briefNotice(page).getByRole('button', { name: 'Write the brief again' }).click();
    await expect(briefNotice(page)).toHaveCount(0);
    const current = await json<BriefView>(await api.get(`/api/projects/${id}/brief`));
    expect(current.changedSince).toEqual([]);
    expect(problems).toEqual([]);
  });

  test('an older comparison says that a newer one exists, and offers it; a cancelled one is not newer', async ({
    page,
  }) => {
    const problems = watchPage(page);
    const id = await briefedProject('Freshness: a newer comparison');
    const first = (await (await api.get(`/api/projects/${id}/analysis`)).json()) as {
      analyses: { id: string }[];
    };
    const olderId = first.analyses[0]!.id;

    // A comparison that was stopped is not a newer one: nothing is called out of date by it.
    const stopped = await startViaApi(api, id, { runsPerVariant: 200 });
    await api.post(`/api/projects/${id}/analysis/${stopped.id}/cancel`);
    await finished(api, id, stopped.id);
    await page.goto(compareAt(id));
    await arrived(page);
    await expect(olderOne(page)).toHaveCount(0);
    await expect(outOfDate(page)).toHaveCount(0);

    // A finished one is: the newest is on show, the brief rests on the first, and the first says so when it is read.
    await compared(api, id, { runsPerVariant: 12, baseSeed: 77, sensitivity: false });
    await page.goto(compareAt(id));
    await arrived(page);
    await page.getByRole('button', { name: 'Parts of the page, saved comparisons' }).click();
    const saved = page.getByRole('menuitemradio').filter({ hasText: '10 runs' });
    await saved.click();
    await expect(page.getByRole('main')).toContainText('10 seeded runs each');
    await expect(olderOne(page)).toBeVisible();
    await olderOne(page).click();
    await expect(page.getByText('A newer one finished')).toBeVisible();
    await page.getByRole('button', { name: 'Read the newest' }).click();
    await expect(page.getByRole('main')).toContainText('12 seeded runs each');
    expect(olderId).toBeTruthy();
    expect(problems).toEqual([]);
  });
});
