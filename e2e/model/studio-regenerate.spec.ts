import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  apiContext,
  expectNoAxeViolations,
  expectNoBrowserPaintedControls,
  expectNoHorizontalOverflow,
  getProject,
  watchPage,
} from '../support/helpers';
import { forget, quiet } from '../support/shell';
import {
  chooseSection,
  modelReport,
  openTool,
  sectionPage,
  sectionTools,
  startStudio,
  studio,
  studioDocument,
  workflow,
} from '../support/decide';

// Report Studio: a report written by a model, and writing a chapter again, in a real browser, against the
// protocol-faithful fake of the provider (e2e/support/fake-provider.ts). The fake speaks the real protocol and answers
// from what each request supplies; it says nothing about how a live model writes. The statements of a chapter are
// shown with the passages they quote; a chapter written again is a proposal that changes nothing until a person
// accepts it, it is checked the way the report was checked, and a failing provider leaves the document as it was.

const providerUrl = `http://127.0.0.1:${process.env.E2E_PROVIDER_PORT || 11999}`;
const THEMES = ['light', 'dark', 'high-contrast'] as const;
const HUMAN_TEXT = 'A person wrote this version of the chapter, and it says very little.';
const INSTRUCTION = 'Stress the uncertainty';

test.use({
  reducedMotion: 'reduce',
  viewport: { width: 1440, height: 900 },
  actionTimeout: 30_000,
});

let api: APIRequestContext;
let fake: APIRequestContext;
const made: string[] = [];

test.beforeAll(async ({ playwright }) => {
  api = await apiContext(playwright);
  fake = await playwright.request.newContext({ baseURL: providerUrl });
});

test.afterAll(async () => {
  await forget(api, made);
  await fake.dispose();
  await api.dispose();
});

async function resetProvider(control: object = {}): Promise<void> {
  await fake.post('/__reset');
  await fake.post('/__control', { data: { latencyMs: 0, ...control } });
}

const statsOf = async () =>
  (await (await fake.get('/__stats')).json()) as { calls: number; byKind: Record<string, number> };

/** A model-assisted project with a finished report, made through the real stages. */
async function reportProject(name: string): Promise<string> {
  await resetProvider();
  const id = await modelReport(api, name);
  made.push(id);
  return id;
}

/** The first chapter of the working copy: the report's own title for it, which is the provider's. */
async function firstChapter(project: string): Promise<{ title: string; index: number }> {
  const sections = (await studioDocument(api, project)).sections;
  const index = sections.findIndex((section) => section.kind === 'chapter');
  return { title: sections[index]!.title, index };
}

/** The rewrite of the section in view, waiting for a decision. */
const proposalBar = (page: Page) => page.getByRole('region', { name: 'Decide on the rewrite' });

async function editTo(page: Page, text: string): Promise<void> {
  await sectionPage(page).getByRole('button', { name: 'Edit', exact: true }).click();
  await sectionPage(page)
    .getByRole('textbox', { name: /^Text of/u })
    .fill(text);
  await page
    .getByRole('region', { name: 'Save your changes' })
    .getByRole('button', { name: /^Save as version/u })
    .click();
  await expect(sectionPage(page).getByText('Version 2', { exact: true })).toBeVisible();
}

async function writeAgain(page: Page, instruction: string | null): Promise<void> {
  const rewrite = await openTool(page, /^Rewrite/u);
  if (instruction) {
    await rewrite
      .getByRole('textbox', { name: 'What to emphasise, or how to say it' })
      .fill(instruction);
  }
  await rewrite.getByRole('button', { name: 'Write it again' }).click();
}

test('the statements of a chapter written by a model are shown with the passages they quote', async ({
  page,
}) => {
  test.setTimeout(10 * 60_000);
  const problems = watchPage(page);
  const project = await reportProject('Studio: model statements');
  await startStudio(page, project);
  const chapter = await firstChapter(project);
  await chooseSection(page, chapter.title);

  const panel = await openTool(page, /^Statements/u);
  const statements = panel
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name: /^Evidence ·/u }) });
  expect(await statements.count(), 'a chapter lists the statements checked').toBeGreaterThan(0);
  // How well the sources back them is said in words, with a key to the words.
  await expect(
    panel.getByRole('img', { name: /statements? by how well the sources back them/u }),
  ).toBeVisible();
  await panel.getByRole('button', { name: 'What the labels mean' }).click();
  await expect(page.getByRole('dialog', { name: 'What the labels mean' })).toContainText(
    'It does not show that the passages are true',
  );
  await page.keyboard.press('Escape');

  // Evidence is one press away: the passage a statement quotes, with its words marked.
  const cited = statements.filter({ hasText: /[1-9]\d* backing/u }).first();
  await cited.getByRole('button', { name: /^Evidence ·/u }).click();
  await expect(cited.getByText('Backs it').first()).toBeVisible();
  await expect(cited.locator('blockquote').first()).toBeVisible();
  await expect(cited).toContainText('The highlighted words were found exactly as written.');
  await quiet(page);
  await expectNoAxeViolations(page, 'studio: statements and their evidence');
  expect(problems).toEqual([]);
});

test('a chapter written again is a proposal that changes nothing until a person accepts it', async ({
  page,
}) => {
  test.setTimeout(10 * 60_000);
  const problems = watchPage(page);
  const project = await reportProject('Studio: model report');
  await startStudio(page, project);
  const chapter = await firstChapter(project);
  await chooseSection(page, chapter.title);

  await test.step('the studio offers to write a chapter again, because the provider is the one that wrote the report', async () => {
    const rewrite = await openTool(page, /^Rewrite/u);
    await expect(rewrite.getByRole('button', { name: 'Write it again' })).toBeEnabled();
    await expect(rewrite).toContainText('Nothing changes until you accept the result.');
  });

  await test.step('a person edits the chapter first, so that what the model writes differs from it', async () => {
    await editTo(page, HUMAN_TEXT);
  });

  const callsBefore = (await getProject(api, project)).execution!.modelCalls;
  await resetProvider();

  await test.step('asking for it makes real model calls and shows the result as waiting for a decision', async () => {
    await writeAgain(page, INSTRUCTION);
    await expect(proposalBar(page)).toBeVisible();
    await expect(sectionPage(page)).toContainText('A rewrite is waiting for your decision');
    const tools = sectionTools(page);
    await expect(tools).toContainText(`“${INSTRUCTION}”`);
    await expect(tools).toContainText('Written by the model');
    await expect(tools).toContainText('Checked the way the report was');
    await expect(tools).toContainText(/\d+ model calls?/u);
    // What changed is shown in words and in marks, against the text as it stands.
    const removed = (await sectionPage(page).locator('del').allTextContents()).join(' ');
    const added = (await sectionPage(page).locator('ins').allTextContents()).join(' ');
    expect(removed, 'the person’s words are shown as removed').toContain('person');
    expect(added, 'and the model’s as added').toContain('differ');
    await expect(proposalBar(page)).toContainText(/Rewrite: \+\d+ −\d+ words/u);

    const stats = await statsOf();
    expect(stats.byKind.chapter, 'the chapter was written by a model call').toBeGreaterThanOrEqual(
      1,
    );
    expect(
      stats.byKind.entailment,
      'and checked by an independent model call',
    ).toBeGreaterThanOrEqual(1);
    expect((await getProject(api, project)).execution!.modelCalls, 'and counted').toBeGreaterThan(
      callsBefore,
    );
  });

  await test.step('nothing has changed until it is accepted, and the report cannot be submitted meanwhile', async () => {
    await expect(sectionPage(page).getByText('Version 2', { exact: true })).toBeVisible();
    await expect(
      sectionPage(page).getByRole('button', { name: 'Edit', exact: true }),
    ).toBeDisabled();
    await expect(workflow(page).getByRole('button', { name: 'Submit for review' })).toBeDisabled();
    await expect(workflow(page)).toContainText('Accept or reject the rewrite of');
    const document = await studioDocument(api, project);
    expect(document.sections[chapter.index]!.body).toBe(HUMAN_TEXT);
    expect(document.sections[chapter.index]!.version).toBe(2);
    expect(document.sections[chapter.index]!.proposal).not.toBeNull();
    await quiet(page);
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page, 'studio: regenerated text waiting');
  });

  await test.step('what is shown can be switched between the changes, the rewrite and the text as it stands', async () => {
    const view = sectionPage(page).getByRole('radiogroup', { name: 'What to show' });
    await view.getByRole('radio', { name: 'Current' }).click();
    await expect(sectionPage(page)).toContainText(HUMAN_TEXT);
    await view.getByRole('radio', { name: 'Rewrite' }).click();
    await expect(sectionPage(page)).not.toContainText(HUMAN_TEXT);
    await view.getByRole('radio', { name: 'Changes' }).click();
  });

  await test.step('rejecting it leaves the text, the version and the history exactly as they were', async () => {
    await proposalBar(page).getByRole('button', { name: 'Reject' }).click();
    await expect(proposalBar(page)).toHaveCount(0);
    await expect(sectionPage(page).getByText('Version 2', { exact: true })).toBeVisible();
    await expect(sectionPage(page)).toContainText(HUMAN_TEXT);
    expect((await studioDocument(api, project)).sections[chapter.index]!.versions).toHaveLength(2);
    const rewrite = await openTool(page, /^Rewrite/u);
    await expect(rewrite.getByRole('button', { name: 'Write it again' })).toBeEnabled();
  });

  await test.step('accepting a second one makes it a new version, written by the model and checked by the server', async () => {
    await writeAgain(page, INSTRUCTION);
    await expect(proposalBar(page)).toBeVisible();
    await proposalBar(page).getByRole('button', { name: 'Accept the rewrite' }).click();
    await expect(proposalBar(page)).toHaveCount(0);
    await expect(sectionPage(page).getByText('Version 3', { exact: true })).toBeVisible();
    await expect(
      sectionPage(page).getByText('Regenerated, then accepted', { exact: true }),
    ).toBeVisible();
    await expect(sectionPage(page)).toContainText(
      'The model wrote this text and the server checked its statements',
    );
    await expect(sectionPage(page)).not.toContainText(HUMAN_TEXT);
    const history = await openTool(page, /^History/u);
    await expect(history).toContainText(`Regenerated: ${INSTRUCTION}`);
    const document = await studioDocument(api, project);
    expect(document.sections[1]).toMatchObject({
      version: 3,
      origin: 'regenerated',
      proposal: null,
    });
    expect(document.sections[1]!.statements.every((claim) => /^G\d+$/u.test(claim.id))).toBe(true);
    // Its statements are the new text's own, and are listed.
    await openTool(page, /^Statements/u);
    await expect(
      sectionTools(page).getByRole('tabpanel').getByText('G1', { exact: true }),
    ).toBeVisible();
  });

  await test.step('the regenerated chapter goes through review, and its statements are in the memo', async () => {
    await workflow(page).getByRole('button', { name: 'Submit for review' }).click();
    await workflow(page).getByRole('button', { name: 'Approve…' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Approve this text' }).click();
    await expect(workflow(page)).toContainText('Approved by');
    const memo = await (
      await page.request.get(`/api/projects/${project}/studio/export?format=memo`)
    ).text();
    expect(memo).toContain('<strong>APPROVED</strong>');
    expect(memo).toMatch(/<span class="id">G1<\/span>/u);
  });

  await test.step('the audit log records each step, with no text', async () => {
    await studio(page).getByRole('button', { name: 'Record', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Review record' })
      .getByRole('button', { name: 'Open the audit log' })
      .click();
    const log = page.getByRole('dialog', { name: 'Audit log' });
    for (const action of [
      'Regenerated text proposed',
      'Regenerated text rejected',
      'Regenerated text accepted',
    ]) {
      await expect(log.getByRole('heading', { name: action }).first(), action).toBeVisible();
    }
    await expect(log).not.toContainText(INSTRUCTION);
    await expect(log).not.toContainText(HUMAN_TEXT);
    await page.keyboard.press('Escape');
  });

  expect(problems).toEqual([]);
});

test('a provider that fails leaves the document as it was, says so, and can be tried again', async ({
  page,
}) => {
  test.setTimeout(10 * 60_000);
  const problems = watchPage(page, { refusals: true });
  const project = await reportProject('Studio: model fails');
  await startStudio(page, project);
  const chapter = await firstChapter(project);
  await chooseSection(page, chapter.title);
  const before = await studioDocument(api, project);

  await resetProvider({ failKind: 'chapter' });
  await writeAgain(page, null);
  const alert = studio(page).getByRole('alert');
  await expect(alert).toContainText('That change was not made');
  await expect(alert).not.toBeEmpty();
  await expect(proposalBar(page)).toHaveCount(0);
  const after = await studioDocument(api, project);
  expect(after.revision, 'a failed request changes nothing').toBe(before.revision);
  expect(after.sections[chapter.index]!.version).toBe(1);
  // The control is usable again, and so is the rest of the studio.
  await expect(sectionPage(page).getByRole('button', { name: 'Edit', exact: true })).toBeEnabled();
  const rewrite = await openTool(page, /^Rewrite/u);
  await expect(rewrite.getByRole('button', { name: 'Write it again' })).toBeEnabled();

  await resetProvider();
  await alert.getByRole('button', { name: 'Dismiss' }).click();
  await rewrite.getByRole('button', { name: 'Write it again' }).click();
  await expect(proposalBar(page)).toBeVisible();
  await expect(studio(page).getByRole('alert')).toHaveCount(0);
  expect(problems.filter((problem) => !problem.startsWith('console'))).toEqual([]);
});

for (const theme of THEMES) {
  test(`regenerated text waiting for a decision is readable in the ${theme} theme`, async ({
    page,
  }) => {
    test.setTimeout(10 * 60_000);
    const problems = watchPage(page);
    const project = await reportProject(`Studio: model ${theme}`);
    await startStudio(page, project, { theme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await chooseSection(page, (await firstChapter(project)).title);
    await editTo(page, HUMAN_TEXT);
    await writeAgain(page, INSTRUCTION);
    await expect(proposalBar(page)).toBeVisible();
    await quiet(page);
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page, `${theme}: regenerated text waiting`);
    if (theme !== 'light')
      await expectNoBrowserPaintedControls(page, `${theme}: regenerated text waiting`);
    expect(problems).toEqual([]);
  });
}
