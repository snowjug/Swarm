import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import type { StudioView } from '../../shared/studio';
import {
  apiContext,
  expectNoAxeViolations,
  expectNoBrowserPaintedControls,
  expectNoHorizontalOverflow,
  getProject,
  openDetails,
  seed,
  watchPage,
} from '../support/helpers';

// Report Studio: writing a chapter again, in a real browser, against the protocol-faithful fake of the
// provider (e2e/support/fake-provider.ts). The fake speaks the real protocol and answers from what each
// request supplies; it says nothing about how a live model writes. The chapter is a proposal that changes
// nothing until a person accepts it, it is checked the way the report was checked, and a failing provider
// leaves the document as it was.

const providerUrl = `http://127.0.0.1:${process.env.E2E_PROVIDER_PORT || 11999}`;
const THEMES = ['light', 'dark', 'high-contrast'] as const;
const HUMAN_TEXT = 'A person wrote this version of the chapter, and it says very little.';
const INSTRUCTION = 'Stress the uncertainty';

test.use({ actionTimeout: 30_000 });
test.describe.configure({ mode: 'serial' });

async function provider(playwright: Parameters<typeof apiContext>[0]): Promise<APIRequestContext> {
  return playwright.request.newContext({ baseURL: providerUrl });
}

async function resetProvider(fake: APIRequestContext, control: object = {}): Promise<void> {
  await fake.post('/__reset');
  await fake.post('/__control', { data: { latencyMs: 0, ...control } });
}

const statsOf = async (fake: APIRequestContext) =>
  (await (await fake.get('/__stats')).json()) as { calls: number; byKind: Record<string, number> };

/** A model-assisted project with a finished report, made through the real stages. */
async function reportProject(api: APIRequestContext, fake: APIRequestContext): Promise<string> {
  await resetProvider(fake);
  return seed(api, 'report', {
    name: 'Studio: model report',
    mode: 'llm',
    agents: 4,
    rounds: 3,
  });
}

const studioOf = (page: Page): Locator => page.getByRole('region', { name: 'Report Studio' });
const toolbarOf = (page: Page): Locator =>
  studioOf(page).getByRole('group', { name: 'Report workflow' });
const articleOf = (page: Page): Locator => studioOf(page).getByRole('article');
const proposalOf = (page: Page): Locator =>
  articleOf(page).getByRole('region', { name: /waiting for your decision$/u });

async function startStudio(page: Page, id: string): Promise<void> {
  await page.goto(`/?project=${id}`);
  await page
    .getByRole('navigation', { name: 'Guided workflow steps' })
    .getByRole('button', { name: /^Report/u })
    .click();
  await page.getByRole('button', { name: 'Open Report Studio' }).click();
  await studioOf(page).getByRole('button', { name: 'Open the report in the studio' }).click();
  await expect(toolbarOf(page)).toContainText('REVISION 1');
}

async function writeAgain(page: Page, instruction: string | null): Promise<void> {
  const article = articleOf(page);
  if (instruction) {
    await article.getByLabel('What to emphasise, or how to say it (optional)').fill(instruction);
  }
  await article.getByRole('button', { name: 'Write this chapter again' }).click();
}

const documentOf = async (page: Page, id: string) => {
  const response = await page.request.get(`/api/projects/${id}/studio`);
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as StudioView).document!;
};

test('a chapter written again is a proposal that changes nothing until a person accepts it', async ({
  page,
  playwright,
}) => {
  test.setTimeout(10 * 60_000);
  const problems = watchPage(page);
  const api = await apiContext(playwright);
  const fake = await provider(playwright);
  const id = await reportProject(api, fake);
  await page.setViewportSize({ width: 1440, height: 900 });
  await startStudio(page, id);
  const article = articleOf(page);

  await test.step('the studio offers to write a chapter again, because the provider is the one that wrote the report', async () => {
    await expect(article.getByRole('button', { name: 'Write this chapter again' })).toBeEnabled();
    await expect(article).not.toContainText('Local engine only');
  });

  await test.step('a person edits the chapter first, so that what the model writes differs from it', async () => {
    await article.getByRole('button', { name: 'Edit text' }).click();
    await article.getByRole('textbox', { name: /^Text of/u }).fill(HUMAN_TEXT);
    await article.getByRole('button', { name: 'Save as a new version' }).click();
    await expect(article.getByText('VERSION 2', { exact: true })).toBeVisible();
  });

  const callsBefore = (await getProject(api, id)).execution!.modelCalls;
  await resetProvider(fake);

  await test.step('asking for it makes real model calls and shows the result as waiting for a decision', async () => {
    await writeAgain(page, INSTRUCTION);
    const proposal = proposalOf(page);
    await expect(proposal).toBeVisible();
    await expect(proposal).toContainText('Regenerated text, waiting for your decision');
    await expect(proposal).toContainText(`The request: ${INSTRUCTION}`);
    await expect(proposal).toContainText('Checked the way the report was checked');
    await expect(proposal).toContainText(/It uses \d+ model calls/u);
    // What changed is shown in words and in marks, against the text as it stands.
    await expect(proposal.locator('.studio-diff ins').first()).toBeVisible();
    const removed = (await proposal.locator('.studio-diff del').allTextContents()).join(' ');
    const added = (await proposal.locator('.studio-diff ins').allTextContents()).join(' ');
    expect(removed, 'the person’s words are shown as removed').toContain('person');
    expect(added, 'and the model’s as added').toContain('differ');
    await expect(proposal.locator('.studio-statement').first()).toContainText('G1');

    const stats = await statsOf(fake);
    expect(stats.byKind.chapter, 'the chapter was written by a model call').toBeGreaterThanOrEqual(
      1,
    );
    expect(
      stats.byKind.entailment,
      'and checked by an independent model call',
    ).toBeGreaterThanOrEqual(1);
    expect((await getProject(api, id)).execution!.modelCalls, 'and counted').toBeGreaterThan(
      callsBefore,
    );
  });

  await test.step('nothing has changed until it is accepted, and the report cannot be submitted meanwhile', async () => {
    await expect(article.getByText('VERSION 2', { exact: true })).toBeVisible();
    await expect(article.locator('.studio-body').first()).toContainText(HUMAN_TEXT);
    await expect(article.getByRole('button', { name: 'Edit text' })).toBeDisabled();
    await expect(article.getByRole('button', { name: 'Write this chapter again' })).toBeDisabled();
    await expect(toolbarOf(page).getByRole('button', { name: 'Submit for review' })).toBeDisabled();
    await expect(toolbarOf(page)).toContainText(
      'Accept or reject the regenerated text before submitting',
    );
    const document = await documentOf(page, id);
    expect(document.sections[1]!.body).toBe(HUMAN_TEXT);
    expect(document.sections[1]!.version).toBe(2);
    expect(document.sections[1]!.proposal).not.toBeNull();
    await expect(page.locator('.spin:visible')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page, 'studio: regenerated text waiting');
  });

  await test.step('rejecting it leaves the text, the version and the history exactly as they were', async () => {
    await proposalOf(page).getByRole('button', { name: 'Reject it' }).click();
    await expect(proposalOf(page)).toHaveCount(0);
    await expect(article.getByText('VERSION 2', { exact: true })).toBeVisible();
    await expect(article.locator('.studio-body').first()).toContainText(HUMAN_TEXT);
    expect((await documentOf(page, id)).sections[1]!.versions).toHaveLength(2);
    await expect(article.getByRole('button', { name: 'Write this chapter again' })).toBeEnabled();
  });

  await test.step('accepting a second one makes it a new version, written by the model and checked by the server', async () => {
    await writeAgain(page, INSTRUCTION);
    await expect(proposalOf(page)).toBeVisible();
    await proposalOf(page).getByRole('button', { name: 'Accept the regenerated text' }).click();
    await expect(proposalOf(page)).toHaveCount(0);
    await expect(article.getByText('VERSION 3', { exact: true })).toBeVisible();
    await expect(article.locator('.chip-row').first()).toContainText('Regenerated, then accepted');
    await expect(article).toContainText(
      'The model wrote this text and the server checked its statements',
    );
    await expect(article).not.toContainText(HUMAN_TEXT);
    await expect(article).not.toContainText(
      'These statements describe an earlier text of this section',
    );
    await expect(article.locator('.studio-statement').first()).toContainText('G1');
    await openDetails(article, 'Version history (3)');
    await expect(article.locator('.studio-versions')).toContainText(`Regenerated: ${INSTRUCTION}`);
    const document = await documentOf(page, id);
    expect(document.sections[1]).toMatchObject({
      version: 3,
      origin: 'regenerated',
      proposal: null,
    });
    expect(document.sections[1]!.statements.every((claim) => /^G\d+$/u.test(claim.id))).toBe(true);
  });

  await test.step('the regenerated chapter goes through review, and its statements are in the memo', async () => {
    await toolbarOf(page).getByRole('button', { name: 'Submit for review' }).click();
    await toolbarOf(page).getByRole('button', { name: 'Approve…' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Approve this text' }).click();
    await expect(toolbarOf(page)).toContainText('Approved');
    const memo = await (
      await page.request.get(`/api/projects/${id}/studio/export?format=memo`)
    ).text();
    expect(memo).toContain('<strong>APPROVED</strong>');
    expect(memo).toMatch(/<span class="id">G1<\/span>/u);
  });

  await test.step('the audit log records each step, with no text', async () => {
    await page.getByRole('button', { name: 'Audit log' }).click();
    const table = page.getByRole('dialog', { name: 'Audit log' }).getByRole('table');
    for (const action of [
      'studio.regeneration.proposed',
      'studio.proposal.rejected',
      'studio.proposal.accepted',
    ]) {
      await expect(table, action).toContainText(action);
    }
    await expect(table).not.toContainText(INSTRUCTION);
    await expect(table).not.toContainText(HUMAN_TEXT);
    await page.keyboard.press('Escape');
  });

  expect(problems).toEqual([]);
  await fake.dispose();
  await api.dispose();
});

test('a provider that fails leaves the document as it was, says so, and can be tried again', async ({
  page,
  playwright,
}) => {
  test.setTimeout(10 * 60_000);
  const problems = watchPage(page, { refusals: true });
  const api = await apiContext(playwright);
  const fake = await provider(playwright);
  const id = await reportProject(api, fake);
  await page.setViewportSize({ width: 1440, height: 900 });
  await startStudio(page, id);
  const article = articleOf(page);
  const before = await documentOf(page, id);

  await resetProvider(fake, { failKind: 'chapter' });
  await writeAgain(page, null);
  const alert = studioOf(page).getByRole('alert');
  await expect(alert).toContainText('That change was not made');
  await expect(alert).not.toBeEmpty();
  await expect(proposalOf(page)).toHaveCount(0);
  const after = await documentOf(page, id);
  expect(after.revision, 'a failed request changes nothing').toBe(before.revision);
  expect(after.sections[1]!.version).toBe(1);
  // The control is usable again, and so is the rest of the studio.
  await expect(article.getByRole('button', { name: 'Write this chapter again' })).toBeEnabled();
  await expect(article.getByRole('button', { name: 'Edit text' })).toBeEnabled();

  await resetProvider(fake);
  await studioOf(page).getByRole('button', { name: 'Dismiss' }).click();
  await writeAgain(page, null);
  await expect(proposalOf(page)).toBeVisible();
  await expect(alert).toHaveCount(0);
  expect(problems.filter((problem) => !problem.startsWith('console'))).toEqual([]);
  await fake.dispose();
  await api.dispose();
});

for (const theme of THEMES) {
  test(`regenerated text waiting for a decision is readable in the ${theme} theme`, async ({
    page,
    playwright,
  }) => {
    test.setTimeout(10 * 60_000);
    const problems = watchPage(page);
    const api = await apiContext(playwright);
    const fake = await provider(playwright);
    const id = await reportProject(api, fake);
    await page.addInitScript((value) => window.localStorage.setItem('swarm.theme', value), theme);
    await page.setViewportSize({ width: 1360, height: 900 });
    await startStudio(page, id);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const article = articleOf(page);
    await article.getByRole('button', { name: 'Edit text' }).click();
    await article.getByRole('textbox', { name: /^Text of/u }).fill(HUMAN_TEXT);
    await article.getByRole('button', { name: 'Save as a new version' }).click();
    await expect(article.getByText('VERSION 2', { exact: true })).toBeVisible();
    await writeAgain(page, INSTRUCTION);
    await expect(proposalOf(page)).toBeVisible();
    await expect(page.locator('.spin:visible')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page, `${theme}: regenerated text waiting`);
    if (theme !== 'light') {
      await expectNoBrowserPaintedControls(page, `${theme}: regenerated text waiting`);
    }
    expect(problems).toEqual([]);
    await fake.dispose();
    await api.dispose();
  });
}
