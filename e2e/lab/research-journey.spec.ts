import { expect, test, type Locator, type Page } from '@playwright/test';
import { RESEARCH_STAGES } from '../../shared/research';
import { projectOf } from '../support/app';
import { exploreButton, goOn, openAsk, questionBox, readScenario, siteBox } from '../support/ask';
import { expectSound } from '../support/ground-map';
import { watchPage } from '../support/helpers';
import { claimsAgainst } from '../support/lab-api';
import {
  NEWS_PAGE,
  OFFICIAL_SITE,
  QUESTION,
  RESEARCH_URL,
  TITLES,
  fixtureLog,
  resetFixtureLog,
  serverResearches,
  startResearchServer,
} from '../support/research-site';

// The research journey against the real application: a question, perhaps a site, and the crawler reading the fixture
// web of backend/test/support/research-e2e-server.ts (real fetcher, real robots.txt, real extraction; no network). The
// surface in every state, on a stand-in for the server's research, is research-states.spec.ts.
//
// Written against the contract of docs/ and shared/research.ts and the test hook `research.fetcher` of `buildApp`; it
// has not been run against the application that implements them. Where the server does not research it is skipped.

test.use({
  baseURL: RESEARCH_URL,
  actionTimeout: 15_000,
  reducedMotion: 'reduce',
  viewport: { width: 1440, height: 900 },
});
test.describe.configure({ mode: 'serial', timeout: 300_000 });

let stopServer: (() => Promise<void>) | null = null;
test.beforeAll(async () => {
  stopServer = await startResearchServer();
});
test.afterAll(async () => {
  await stopServer?.();
});
test.beforeEach(async ({ request }) => {
  test.skip(!(await serverResearches(request)), 'This server does not research.');
  await resetFixtureLog(request);
});

const chip = (page: Page): Locator => page.locator('[data-moment]');
const researchSection = (page: Page): Locator => page.getByRole('region', { name: /^Research/u });
const stage = (page: Page, name: (typeof RESEARCH_STAGES)[number]): Locator =>
  page.getByRole('list', { name: 'Research progress' }).locator(`[data-stage="${name}"]`);
const pagesList = (page: Page): Locator => page.getByRole('list', { name: 'Pages' });
const pageRow = (page: Page, text: string | RegExp): Locator =>
  pagesList(page).getByRole('listitem').filter({ hasText: text });
const figureOf = (page: Page, label: string): Locator =>
  page.locator('.sw-ground__figures > li').filter({ hasText: label });
const press = (page: Page, name: string | RegExp): Locator =>
  page.getByRole('button', { name, exact: typeof name === 'string' });

const numberIn = async (locator: Locator): Promise<number> =>
  Number(/\d+/u.exec(await locator.innerText())?.[0] ?? Number.NaN);

/** From the first screen to Ground, with the question and, where given, the site. Nothing else is asked of the person. */
async function ask(page: Page, site?: string): Promise<void> {
  await openAsk(page);
  await questionBox(page).fill(QUESTION);
  if (site) await siteBox(page).fill(site);
  await expect(exploreButton(page)).toBeEnabled();
  await readScenario(page);
  await goOn(page).click();
  await expect(page).toHaveURL(/[?&]scene=ground(?:&|$)/u);
  expect(projectOf(page)).toBeTruthy();
}

test('a question and a site reach Ready with real sources, each page said in plain words and none judged', async ({
  page,
  request,
}) => {
  const problems = watchPage(page);
  await ask(page, OFFICIAL_SITE);

  // The page follows the run: it is under way, and then it is Ready with sources of its own.
  await expect(page.getByRole('list', { name: 'Research progress' })).toBeVisible({
    timeout: 60_000,
  });
  await expect(chip(page)).toHaveText('Ready', { timeout: 240_000 });
  for (const name of RESEARCH_STAGES) {
    await expect(stage(page, name)).toHaveAttribute('data-state', 'done');
  }
  expect(await numberIn(figureOf(page, 'Pages read'))).toBeGreaterThanOrEqual(3);
  expect(await numberIn(figureOf(page, 'Sources used'))).toBeGreaterThanOrEqual(1);

  // What became of each page, as the crawler decided it. A page that was not read has no title, and is called by its address.
  await expect(pageRow(page, TITLES.fees).filter({ hasText: 'Used' }).first()).toBeVisible();
  await expect(pageRow(page, TITLES.slow)).toHaveCount(1);
  await expect(pageRow(page, '/private/minutes')).toContainText('Blocked');
  await expect(pageRow(page, '/private/minutes')).toContainText('robots.txt');
  await expect(pageRow(page, '/missing-page')).toContainText('Failed');
  await expect(pageRow(page, /Members: sign in|\/members\/login/u)).toContainText('Quarantined');
  await expect(pageRow(page, /Notice for readers|\/notice\/for-readers/u)).toContainText(
    /Quarantined|Instruction-like text/u,
  );
  await expect(
    pagesList(page).getByRole('listitem').filter({ hasText: 'Duplicate' }).first(),
  ).toBeVisible();

  // Where a page came from: the address it ended at, when it was read, what its content hashes to, and the robots decision.
  await pageRow(page, TITLES.fees)
    .filter({ hasText: 'Used' })
    .first()
    .getByRole('button', { name: /^Provenance/u })
    .click();
  const card = page.getByRole('dialog');
  await expect(card).toContainText(`https://${OFFICIAL_SITE}/fees`);
  await expect(card).toContainText('SHA-256');
  await expect(card).toContainText('robots.txt');
  await page.keyboard.press('Escape');

  // What the research did to the web: it read robots.txt, and it never asked for the page that robots.txt closes.
  const log = await fixtureLog(request);
  expect(log.served.map((entry) => entry.path)).toContain('/robots.txt');
  expect(log.served.map((entry) => entry.path)).not.toContain('/private/minutes');
  expect(new Set(log.served.map((entry) => entry.host))).toEqual(new Set([OFFICIAL_SITE]));

  // The project holds the sources that were used, and says nothing that a page of Swarm may not say.
  await expect(page.getByRole('region', { name: /^Sources \d+$/u })).toBeVisible();
  expect(claimsAgainst(await researchSection(page).innerText())).toEqual([]);
  await expectSound(page, 'research journey: ready, with real sources');
  expect(problems).toEqual([]);
});

test('a question alone says that it cannot look for sources, searches nothing, and reads the page that a person names', async ({
  page,
  request,
}) => {
  const problems = watchPage(page);
  await ask(page);

  await expect(chip(page)).toHaveText('Blocked', { timeout: 120_000 });
  const section = researchSection(page);
  await expect(section).toContainText('Swarm cannot find sources from a question alone');
  await expect(section).toContainText('does not search the web');
  await expect(stage(page, 'finding-sources')).toHaveAttribute('data-state', 'blocked');
  // Not a request to any site, and not to a search engine.
  const idle = await fixtureLog(request);
  expect(idle.attempts).toEqual([]);
  expect(idle.served).toEqual([]);

  // A page that a person names is read, as a run of its own.
  await press(page, 'Add a site or page').click();
  const field = page.getByRole('textbox', { name: 'Site or page to add' });
  await expect(field).toBeFocused();
  await field.fill(NEWS_PAGE);
  await press(page, 'Add').click();
  await expect(chip(page)).toHaveText('Ready', { timeout: 240_000 });
  await expect(pageRow(page, TITLES.news).filter({ hasText: 'Used' })).toBeVisible();
  expect(claimsAgainst(await section.innerText())).toEqual([]);
  expect(problems.filter((problem) => !/status of 4\d\d/u.test(problem))).toEqual([]);
});

test('can be paused, let go on and finished early, and the run does what the page says', async ({
  page,
  request,
}) => {
  await ask(page, OFFICIAL_SITE);
  await expect(chip(page)).toHaveText('Reading', { timeout: 120_000 });

  await press(page, 'Pause').click();
  await expect(chip(page)).toHaveText('Paused');
  // A paused run reads nothing more: what was in flight may arrive, and then it is quiet.
  await page.waitForTimeout(2_000);
  const paused = (await fixtureLog(request)).served.length;
  await page.waitForTimeout(3_000);
  expect((await fixtureLog(request)).served.length).toBe(paused);

  await press(page, 'Resume').click();
  await expect(chip(page)).not.toHaveText('Paused');
  await expect
    .poll(async () => (await fixtureLog(request)).served.length, { timeout: 30_000 })
    .toBeGreaterThan(paused);

  await press(page, 'Finish early').click();
  await expect(chip(page)).toHaveText('Ready', { timeout: 240_000 });
  await expect(researchSection(page)).toContainText('Why it stopped');
});

test('can be cancelled after asking, keeps the pages that were read, and can be done again', async ({
  page,
}) => {
  await ask(page, OFFICIAL_SITE);
  await expect(chip(page)).toHaveText('Reading', { timeout: 120_000 });

  await press(page, 'Cancel').click();
  // The question is asked first, and keeping on is the way out.
  await expect(page.getByRole('dialog')).toContainText('Cancel the research?');
  await press(page, 'Keep going').click();
  await expect(chip(page)).toHaveText('Reading');

  await press(page, 'Cancel').click();
  await press(page, 'Cancel research').click();
  await expect(chip(page)).toHaveText('Stopped', { timeout: 60_000 });
  await expect(press(page, 'Pause')).toHaveCount(0);
  await expect(press(page, 'Research again')).toBeVisible();
  expect(await numberIn(figureOf(page, 'Pages read'))).toBeGreaterThanOrEqual(1);
});
