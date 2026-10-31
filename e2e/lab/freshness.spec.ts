import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Locator,
  type Page,
} from '@playwright/test';
import type { BriefView } from '../../shared/brief';
import type { CritiquesView } from '../../shared/critique';
import type { StakeholdersView } from '../../shared/stakeholders';
import {
  advance,
  apiContext,
  createGuided,
  expectNoAxeViolations,
  watchPage,
} from '../support/helpers';
import { comparisonPanel, openStage, reviewPanel } from '../support/lab';

// What a person is told when what a brief and its review rest on changes somewhere else. "Another tab"
// is a second client of the same server (the API), as a colleague's browser would be. Each test makes its
// own project through the routes the pages use, with a finished comparison, the review and the brief,
// and then changes one thing the page has not been told about.

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(180_000);

let api: APIRequestContext;
test.beforeAll(async ({ playwright }) => {
  api = await apiContext(playwright);
});
test.afterAll(async () => {
  await api.dispose();
});

// ---------------------------------------------------------------------------------------------
// The server: a project with a brief, and what another tab does to it
// ---------------------------------------------------------------------------------------------

async function json<T>(response: APIResponse): Promise<T> {
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as T;
}

async function finishComparison(id: string): Promise<string> {
  const started = await json<{ analysis: { id: string } }>(
    await api.post(`/api/projects/${id}/analysis`, {
      data: { runsPerVariant: 10, sensitivity: false },
    }),
  );
  await expect
    .poll(
      async () =>
        (
          await json<{ analysis: { status: string } }>(
            await api.get(`/api/projects/${id}/analysis/${started.analysis.id}`),
          )
        ).analysis.status,
      { timeout: 60_000, intervals: [100, 250, 500] },
    )
    .toBe('completed');
  return started.analysis.id;
}

/** The scenario, the approved stakeholders and the actors made from them: where Simulation opens. */
async function throughActors(name: string): Promise<string> {
  const id = await createGuided(api, { name });
  await advance(api, id, 'knowledge');
  const project = await json<{ question: string; documents: { name: string }[] }>(
    await api.get(`/api/projects/${id}`),
  );
  const reading = await json<{ frame: unknown }>(
    await api.post('/api/scenario/parse', {
      data: {
        question: project.question,
        documents: project.documents.map((document) => ({ name: document.name, characters: 400 })),
      },
    }),
  );
  await json(await api.put(`/api/projects/${id}/scenario`, { data: { scenario: reading.frame } }));
  await approveAndMakeActors(id);
  return id;
}

async function approveAndMakeActors(id: string): Promise<void> {
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

/** A project with a finished comparison, the independent review of it and the brief written from it. */
async function briefedProject(name: string): Promise<string> {
  const id = await throughActors(name);
  await finishComparison(id);
  await json(await api.post(`/api/projects/${id}/critiques/run`, { data: {} }));
  await json(await api.post(`/api/projects/${id}/brief`, { data: {} }));
  return id;
}

const critiquesOf = async (id: string) =>
  json<CritiquesView>(await api.get(`/api/projects/${id}/critiques`));

/** What a second tab does: answers a critique, as someone reading the same review would. */
async function answerElsewhere(id: string, critique: number, text: string): Promise<void> {
  const view = await critiquesOf(id);
  const target = view.critiques!.critiques.at(critique)!;
  await json(
    await api.put(`/api/projects/${id}/critiques/${target.id}/response`, {
      data: { text, status: 'accepted', expectedRevision: view.revision },
    }),
  );
}

/** What a second tab does to the stakeholders: renames one, which also takes the approval away. */
async function renameElsewhere(id: string, name: string): Promise<void> {
  const view = await json<StakeholdersView>(await api.get(`/api/projects/${id}/stakeholders`));
  const set = view.stakeholders!;
  const first = set.stakeholders.find((stakeholder) => stakeholder.status !== 'removed')!;
  await json(
    await api.put(`/api/projects/${id}/stakeholders`, {
      data: {
        expectedRevision: view.revision,
        relations: set.relations,
        stakeholders: set.stakeholders.map((stakeholder) =>
          stakeholder.id === first.id ? { ...stakeholder, name } : stakeholder,
        ),
      },
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------------------------

const refreshButton = (page: Page): Locator =>
  page.getByRole('button', { name: 'Refresh project from server', exact: true });
const notice = (page: Page, title: string): Locator =>
  page.getByRole('status').filter({ hasText: title });
const briefNotice = (page: Page): Locator => notice(page, 'This brief may be out of date');
const reviewNotice = (page: Page): Locator => notice(page, 'This review may be out of date');
/** A response as the review shows it, not the words in a box that was opened to change it. */
const shownResponse = (page: Page, text: string): Locator =>
  reviewPanel(page).locator('dd.preserve-text').filter({ hasText: text });
const responseBox = (form: Locator): Locator => form.getByLabel('Your response', { exact: true });

async function openReport(page: Page, id: string): Promise<void> {
  await page.goto(`/?project=${id}`);
  await openStage(page, /Report/u);
  await expect(page.getByRole('article', { name: 'Decision brief', exact: true })).toBeVisible();
  await expect(reviewPanel(page)).toBeVisible();
}

/** Counts what the page asked of one resource, from now on. */
function countReads(page: Page, suffix: string): () => number {
  let count = 0;
  page.on('request', (request) => {
    if (request.method() === 'GET' && new URL(request.url()).pathname.endsWith(suffix)) count += 1;
  });
  return () => count;
}

// ---------------------------------------------------------------------------------------------

test.describe('a change made in another tab', () => {
  test('Refresh project from server shows a critique answered elsewhere, and the brief out of date', async ({
    page,
  }) => {
    const problems = watchPage(page);
    const id = await briefedProject('Freshness: a critique answered elsewhere');
    const briefReads = countReads(page, `/projects/${id}/brief`);
    const reviewReads = countReads(page, `/projects/${id}/critiques`);
    await openReport(page, id);
    await expect(briefNotice(page)).toHaveCount(0);
    const [openedBrief, openedReview] = [briefReads(), reviewReads()];

    const ANSWER = 'A second tab has now accepted this objection after reading the evidence again.';
    await answerElsewhere(id, 0, ANSWER);
    // The server already says so; the page has not been told, and says nothing yet.
    expect(
      (await json<BriefView>(await api.get(`/api/projects/${id}/brief`))).changedSince,
    ).toEqual(['critiques']);
    await expect(shownResponse(page, ANSWER)).toHaveCount(0);
    await expect(briefNotice(page)).toHaveCount(0);

    await refreshButton(page).click();
    await expect(briefNotice(page)).toBeVisible();
    await expect(briefNotice(page)).toContainText(
      'Since it was made, this has changed: critiques.',
    );
    await expect(briefNotice(page)).toContainText('Generate it again to bring it up to date.');
    await expect(shownResponse(page, ANSWER)).toBeVisible();
    // Both panels read again: the refresh is the person's explicit way to the server's truth.
    expect(briefReads()).toBeGreaterThan(openedBrief);
    expect(reviewReads()).toBeGreaterThan(openedReview);
    await expectNoAxeViolations(page, 'the Report stage with the brief out of date');

    // Writing the brief again is what brings it up to date, and it says so at once.
    await page.getByRole('button', { name: 'Generate again' }).click();
    await expect(briefNotice(page)).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test('Refresh project from server shows the stakeholders changed elsewhere, and asks for the comparison to be run again', async ({
    page,
  }) => {
    const problems = watchPage(page, { refusals: true });
    const id = await briefedProject('Freshness: a stakeholder changed elsewhere');
    await openReport(page, id);
    await expect(briefNotice(page)).toHaveCount(0);
    await expect(reviewNotice(page)).toHaveCount(0);

    await renameElsewhere(id, 'Residents renamed by a colleague');
    await refreshButton(page).click();

    // Writing the brief again from the same comparison would describe the change with the old runs,
    // so both notices ask for the comparison to be run again, and show the way there.
    await expect(briefNotice(page)).toContainText(
      'The comparison it rests on was run before the stakeholders changed, so it describes the project as it was.',
    );
    await expect(briefNotice(page)).toContainText(
      'Run the comparison again in the Simulation stage, then generate the brief again.',
    );
    await expect(reviewNotice(page)).toContainText(
      'The comparison it reviews was run before the stakeholders changed',
    );
    await expectNoAxeViolations(page, 'the Report stage with the comparison out of date');

    // The brief written again from that comparison is still said to be out of date, and says what to do.
    await page.getByRole('button', { name: 'Generate again' }).click();
    await expect(briefNotice(page)).toContainText(
      'Since it was made, this has changed: stakeholders.',
    );

    // The way to run it again is in the notice; the page that starts it refuses a cast that is no
    // longer approved, in words that say what to do, and shows nothing as running.
    await briefNotice(page).getByRole('button', { name: 'Open the Simulation stage' }).click();
    await expect(page.getByRole('region', { name: 'Simulation workbench' })).toBeVisible();
    await comparisonPanel(page).getByText('Run another comparison').click();
    await comparisonPanel(page).getByRole('button', { name: 'Compare scenarios again' }).click();
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'The stakeholders are not approved: they were found again or changed' }),
    ).toBeVisible();
    await expect(comparisonPanel(page).getByRole('progressbar')).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test('running the comparison again and writing the brief again brings it up to date', async ({
    page,
  }) => {
    const problems = watchPage(page);
    const id = await briefedProject('Freshness: the way back to a current brief');
    await openReport(page, id);
    await renameElsewhere(id, 'Residents renamed by a colleague');
    await refreshButton(page).click();
    await expect(briefNotice(page)).toBeVisible();

    // What a person does about it: approve what they have changed, make the actors again, compare again.
    await approveAndMakeActors(id);
    await briefNotice(page).getByRole('button', { name: 'Open the Simulation stage' }).click();
    await refreshButton(page).click();
    await comparisonPanel(page).getByText('Run another comparison').click();
    await comparisonPanel(page).getByRole('button', { name: 'Compare scenarios again' }).click();
    await expect(page.getByRole('button', { name: 'See the decision brief' })).toBeVisible({
      timeout: 90_000,
    });
    await page.getByRole('button', { name: 'See the decision brief' }).click();

    // The brief on show rests on the first comparison; a newer one has finished, so writing it again uses that.
    await expect(briefNotice(page)).toContainText('a newer analysis exists');
    await expect(briefNotice(page)).toContainText('Generate it again to bring it up to date.');
    await page.getByRole('button', { name: 'Generate again' }).click();
    await expect(briefNotice(page)).toHaveCount(0);
    const current = await json<BriefView>(await api.get(`/api/projects/${id}/brief`));
    expect(current.changedSince).toEqual([]);
    expect(problems).toEqual([]);
  });
});

test.describe('a change made on the same page', () => {
  test('answering a criticism makes the brief beside it say that it may be out of date, without a refresh', async ({
    page,
  }) => {
    const problems = watchPage(page);
    const id = await briefedProject('Freshness: a critique answered here');
    await openReport(page, id);
    await expect(briefNotice(page)).toHaveCount(0);

    const form = page.locator('form.critic-form').first();
    await form
      .locator('xpath=ancestor::details[1]')
      .getByText(/Respond to this criticism/u)
      .click();
    await responseBox(form).fill('We accept this objection after reading the evidence.');
    await form.getByRole('button', { name: 'Accept the objection' }).click();
    await expect(
      shownResponse(page, 'We accept this objection after reading the evidence.'),
    ).toBeVisible();
    await expect(briefNotice(page)).toContainText(
      'Since it was made, this has changed: critiques.',
    );
    expect(problems).toEqual([]);
  });

  test('a response written about a review that changed is refused, the review is read again, and the words are kept', async ({
    page,
  }) => {
    const problems = watchPage(page, { refusals: true });
    const id = await briefedProject('Freshness: two people answering');
    await openReport(page, id);

    const MINE = 'We dispute this: the cast was set up on purpose, and the evidence says so.';
    const THEIRS = 'Someone else accepted a different objection while this page was open.';
    const form = page.locator('form.critic-form').first();
    const details = form.locator('xpath=ancestor::details[1]');
    await details.getByText(/Respond to this criticism/u).click();
    await responseBox(form).fill(MINE);

    await answerElsewhere(id, -1, THEIRS);
    await form.getByRole('button', { name: 'Dispute it' }).click();

    // Refused in plain words; the page read the review again, and what was written is still in the box.
    await expect(
      page.getByRole('alert').filter({ hasText: 'This review changed while you were writing' }),
    ).toBeVisible();
    await expect(responseBox(form)).toHaveValue(MINE);
    await expect(shownResponse(page, THEIRS)).toBeVisible();
    expect((await critiquesOf(id)).critiques!.critiques[0]!.response).toBeNull();

    // Having seen the review as it is, the same words are taken.
    await form.getByRole('button', { name: 'Dispute it' }).click();
    await expect(shownResponse(page, MINE)).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'This review changed' })).toHaveCount(0);
    expect((await critiquesOf(id)).critiques!.critiques[0]!.response?.text).toBe(MINE);
    expect(problems).toEqual([]);
  });
});
