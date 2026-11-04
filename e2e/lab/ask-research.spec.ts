import { expect, test, type Locator, type Page } from '@playwright/test';
import { projectOf } from '../support/app';
import {
  apiCalls,
  goOn,
  openAsk,
  pasteSource,
  questionBox,
  readScenario,
  recordRequests,
  siteBox,
} from '../support/ask';
import { watchPage } from '../support/helpers';
import {
  NOTE,
  OFFICIAL_SITE,
  QUESTION,
  RESEARCH_PAGE_URL,
  TITLES,
  fixtureLog,
  resetFixtureLog,
  serverResearches,
  startResearchServer,
} from '../support/research-site';

// What the first screen asks of research, against the real application and the fixture web of
// backend/test/support/research-e2e-server.ts (real fetcher, real robots.txt, real extraction; no network): a site that
// is named is read beside the sources a person added, which are kept, and sources that were added with no site named are
// what is read, with no research at all. Where the server does not research the tests are skipped.

test.use({
  baseURL: RESEARCH_PAGE_URL,
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
const OWN = 'operator-note.txt';

/** The calls that change something, as the page made them, with the project's id left out of the address. */
const writes = (made: Parameters<typeof apiCalls>[0]): string[] =>
  apiCalls(made)
    .filter((call) => !call.startsWith('GET '))
    .map((call) => call.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gu, ':id'));

/** From the first screen to Ground with the question, a source of the person's own, and a site where one is named. */
async function walk(page: Page, options: { site?: string; own?: boolean }): Promise<void> {
  await openAsk(page);
  await questionBox(page).fill(QUESTION);
  if (options.own) await pasteSource(page, OWN, NOTE);
  if (options.site) await siteBox(page).fill(options.site);
  await readScenario(page);
}

test('a site that is named is read beside a source that was added, and the source is kept', async ({
  page,
}) => {
  const problems = watchPage(page);
  const made = recordRequests(page);
  await walk(page, { site: OFFICIAL_SITE, own: true });

  // The review says that the site is read, and the source that was added is there beside it.
  await expect(
    page.getByText(
      `Automatic research is on. After you continue, Swarm reads ${OFFICIAL_SITE} and the pages it links to, and lists every page it reads.`,
    ),
  ).toBeVisible();
  await goOn(page).click();
  await expect(page).toHaveURL(/[?&]scene=ground(?:&|$)/u);
  const id = projectOf(page);

  // Research reads first, and the job that does it grounds the project: the page starts the run and nothing else.
  await expect(chip(page)).toHaveText('Ready', { timeout: 240_000 });
  const calls = writes(made);
  expect(calls.slice(0, 3)).toEqual([
    'POST /api/scenario/parse',
    'POST /api/projects',
    'POST /api/projects/:id/research',
  ]);
  expect(calls).not.toContain('POST /api/projects/:id/steps/knowledge');

  // What the site gave is in the project beside the source that was added, which is as it was written.
  const sources = page.getByRole('region', { name: /^Sources \d+$/u });
  await expect(sources).toContainText(OWN);
  await expect(sources).toContainText(TITLES.fees);
  const project = (await (await page.request.get(`/api/projects/${id}`)).json()) as {
    documents: { name: string; content: string; provenance?: { kind?: string } }[];
  };
  const own = project.documents.find((document) => document.name === OWN);
  expect(own?.content).toBe(NOTE);
  expect(own?.provenance?.kind).toBe('paste');
  expect(project.documents.length).toBeGreaterThan(1);
  expect((await fixtureLog(page.request)).served.map((entry) => entry.path)).toContain(
    '/robots.txt',
  );
  expect(problems).toEqual([]);
});

test('sources that were added and no site that is named are what is read: nothing is researched', async ({
  page,
}) => {
  const problems = watchPage(page);
  const made = recordRequests(page);
  await walk(page, { own: true });

  // Said as it is: the review has nothing to say of research, because none will run.
  await expect(page.getByText(/Automatic research is on/u)).toHaveCount(0);
  await expect(page.getByText(/cannot look for sources/u)).toHaveCount(0);
  await goOn(page).click();
  await expect(page).toHaveURL(/[?&]scene=ground(?:&|$)/u);

  await expect(page.getByRole('region', { name: /^Sources \d+$/u })).toContainText(OWN, {
    timeout: 120_000,
  });
  const calls = writes(made);
  expect(calls.slice(0, 3)).toEqual([
    'POST /api/scenario/parse',
    'POST /api/projects',
    'POST /api/projects/:id/steps/knowledge',
  ]);
  expect(calls.join(' ')).not.toContain('/research');
  const log = await fixtureLog(page.request);
  expect(log.attempts).toEqual([]);
  expect(log.served).toEqual([]);
  expect(problems).toEqual([]);
});
