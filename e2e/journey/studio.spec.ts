import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { DEMO_PROJECTS } from '../../shared/demo';
import type { StudioView } from '../../shared/studio';
import { Repository } from '../../backend/src/storage/repository';
import { seedDemo } from '../../scripts/demo/lib/seed';
import {
  expectNoAxeViolations,
  expectNoBrowserPaintedControls,
  expectNoHorizontalOverflow,
  openDetails,
  watchPage,
} from '../support/helpers';

// Report Studio in a real browser, on the committed demonstration: a person opens the generated report,
// works on it section by section (every change a new version), sends it for review, a reviewer sends it
// back or approves it, and what is exported or printed says exactly what was approved.
//
// The journey project has no model, so writing a chapter again is shown unavailable here; that path is
// tested against a protocol-faithful provider in backend/test/studio-regenerate.test.ts.

const [BASE] = DEMO_PROJECTS as [(typeof DEMO_PROJECTS)[number]];
const THEMES = ['light', 'dark', 'high-contrast'] as const;
const MEMO_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const SCREENS = process.env.JOURNEY_SCREENSHOTS;
const NEW_SENTENCE = 'An analyst re-read these figures against the council briefing on 1 March.';
const NOTE = 'Please confirm the crossing figure against the council briefing.';
const REASON = 'The figure needs a second look.';

/** With JOURNEY_SCREENSHOTS set, the screens of the studio join the backup set of the presentation. */
async function shot(page: Page, name: string): Promise<void> {
  if (SCREENS) await page.screenshot({ path: join(SCREENS, `${name}.png`) });
}

const studioPath = `/api/projects/${BASE.id}/studio`;
const studioOf = (page: Page): Locator => page.getByRole('region', { name: 'Report Studio' });
const toolbarOf = (page: Page): Locator =>
  studioOf(page).getByRole('group', { name: 'Report workflow' });
const articleOf = (page: Page): Locator => studioOf(page).getByRole('article');

async function openReportStage(page: Page): Promise<void> {
  await page.goto(`/?project=${BASE.id}`);
  await expect(page.getByRole('heading', { level: 1, name: BASE.title })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Guided workflow steps' })
    .getByRole('button', { name: /^Report/u })
    .click();
  await expect(page.getByRole('region', { name: 'Report workbench' })).toBeVisible();
}

async function openStudio(page: Page): Promise<Locator> {
  await openReportStage(page);
  await page.getByRole('button', { name: 'Open Report Studio' }).click();
  const studio = studioOf(page);
  await expect(studio).toBeVisible();
  return studio;
}

async function startStudio(page: Page): Promise<Locator> {
  const studio = await openStudio(page);
  await studio.getByRole('button', { name: 'Open the report in the studio' }).click();
  await expect(toolbarOf(page)).toContainText('REVISION 1');
  return studio;
}

/** The document as the server says it is, for what the page must agree with. */
async function documentOf(page: Page): Promise<NonNullable<StudioView['document']>> {
  const response = await page.request.get(studioPath);
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as StudioView).document!;
}

async function settled(page: Page, label: string): Promise<void> {
  await expect(page.locator('.spin:visible'), `${label}: a spinner is still running`).toHaveCount(
    0,
  );
  await expectNoHorizontalOverflow(page);
}

test.describe.configure({ mode: 'serial' });
// A regular expression is matched against the element's text as written, spaces included, so a text is found by a string here.
// An action on an element that never appears fails at once with its locator, instead of waiting out the test.
test.use({ actionTimeout: 30_000 });

test.beforeEach(() => {
  if (SCREENS) mkdirSync(SCREENS, { recursive: true });
  // The demonstration is restored before every test, which also removes any studio document: each
  // test starts from the committed recording and does not depend on another.
  const root = process.env.E2E_DATA_ROOT;
  if (!root) throw new Error('E2E_DATA_ROOT is not set: this runs under playwright.config.ts.');
  const repository = new Repository(join(root, 'journey', 'swarm-lab.sqlite'));
  try {
    seedDemo(repository, { directory: 'docs/demo/seed' });
  } finally {
    repository.close();
  }
});

test('the checks this file relies on do fail when they should', async ({ page }) => {
  // A guard that has never failed has not been shown to work.
  const problems = watchPage(page);
  await page.goto('/');
  await page.evaluate(() => console.error('planted'));
  await expect.poll(() => problems.length).toBeGreaterThan(0);
  expect(problems[0]).toContain('planted');
  await page.evaluate(() => {
    const wide = document.createElement('div');
    wide.style.cssText = 'width:5000px;height:4px';
    document.body.append(wide);
  });
  await expect(expectNoHorizontalOverflow(page)).rejects.toThrow();
});

test('a person works on the report, a reviewer decides on it, and what is exported says what was approved', async ({
  page,
  context,
}) => {
  test.setTimeout(15 * 60_000);
  const problems = watchPage(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  await test.step('open the report studio from the report stage', async () => {
    await openReportStage(page);
    const open = page.getByRole('button', { name: 'Open Report Studio' });
    await expect(open).toBeEnabled();
    await open.click();
    const studio = studioOf(page);
    await expect(studio).toContainText(
      'Swarm explores possible scenarios. It does not predict the future.',
    );
    await expect(studio).toContainText('Nobody has opened this report in the studio yet');
    await settled(page, 'studio intro');
    await expectNoAxeViolations(page, 'studio: not yet opened');
  });

  await test.step('opening it makes a draft with every section of the generated report', async () => {
    const studio = studioOf(page);
    await studio.getByRole('button', { name: 'Open the report in the studio' }).click();
    await expect(toolbarOf(page)).toContainText('Draft');
    await expect(toolbarOf(page)).toContainText('REVISION 1');
    const document = await documentOf(page);
    const outline = studio.getByRole('navigation', { name: 'Report sections' });
    await expect(outline.getByRole('button')).toHaveCount(document.sections.length);
    expect(document.sections.map((section) => section.kind)).toEqual([
      'summary',
      ...document.sections.filter((section) => section.kind === 'chapter').map(() => 'chapter'),
      'limitations',
    ]);
    // The first chapter is open, not the summary.
    await expect(articleOf(page).getByRole('heading', { level: 3 })).toHaveText(
      document.sections.find((section) => section.kind === 'chapter')!.title,
    );
    await settled(page, 'studio draft');
    await expectNoAxeViolations(page, 'studio: draft');
    await shot(page, '22-studio-sections');
  });

  await test.step('inspect the statements of a chapter and the evidence behind them', async () => {
    const article = articleOf(page);
    await expect(
      article.getByRole('heading', { level: 4, name: 'Statements in this chapter' }),
    ).toBeVisible();
    const statements = article.locator('.studio-statement');
    expect(await statements.count(), 'a chapter lists the statements checked').toBeGreaterThan(0);
    const cited = article.locator('.studio-statement', { has: page.locator('.evidence-supports') });
    expect(await cited.count(), 'some statement cites a source passage').toBeGreaterThan(0);
    await cited.first().locator('summary').click();
    await expect(cited.first().locator('.evidence-supports blockquote').first()).toBeVisible();
    await expect(cited.first()).toContainText('Supporting passage');
  });

  await test.step('see the open conflicts between sources, and the assumptions, in the record', async () => {
    const studio = studioOf(page);
    await openDetails(studio, 'Open conflicts between sources');
    await expect(
      studio.getByText(/Neither passage is declared true|No conflict between the sources/u),
    ).toBeVisible();
    await openDetails(studio, 'Assumptions behind the simulated results');
    await expect(studio.locator('.studio-record')).toContainText('A');
  });

  let original = '';
  await test.step('edit a chapter: the change is a new version, by a person, and its statements are an earlier text’s', async () => {
    const article = articleOf(page);
    await article.getByRole('button', { name: 'Edit text' }).click();
    const box = article.getByRole('textbox', { name: /^Text of/u });
    original = await box.inputValue();
    expect(original.length).toBeGreaterThan(100);
    await expectNoAxeViolations(page, 'studio: editing');
    const save = article.getByRole('button', { name: 'Save as a new version' });
    await expect(save, 'nothing has changed yet').toBeDisabled();
    await box.fill(`${original}\n\n${NEW_SENTENCE}`);
    await article.getByLabel('Why (optional)').fill(REASON);
    await save.click();
    await expect(article.getByText('VERSION 2', { exact: true })).toBeVisible();
    await expect(article.locator('.chip-row').first()).toContainText('Written by a person');
    await expect(article).toContainText(
      'A person wrote this text. It has not been checked statement by statement.',
    );
    await expect(article).toContainText(
      'These statements describe an earlier text of this section',
    );
    await expect(articleOf(page)).toContainText(NEW_SENTENCE);
    await expect(toolbarOf(page)).toContainText('REVISION 2');
    await expect(studioOf(page).getByRole('navigation', { name: 'Report sections' })).toContainText(
      'Statements describe an earlier text',
    );
  });

  await test.step('compare the versions: the added sentence is marked as added, in words as well as in style', async () => {
    const article = articleOf(page);
    await openDetails(article, 'Version history (2)');
    await article.getByRole('button', { name: 'Compare with the current text' }).click();
    const added = article.locator('.studio-diff ins');
    await expect(added).toContainText(NEW_SENTENCE.split(' ').slice(0, 4).join(' '));
    await expect(added.first().locator('.sr-only').first()).toHaveText('[added: ');
    await expect(article.getByText(/words? added, 0 removed\./u)).toBeVisible();
    await expect(article.locator('.studio-versions').getByText(REASON)).toBeVisible();
    await shot(page, '23-studio-diff');
  });

  await test.step('lock a section: it cannot be edited until it is unlocked', async () => {
    const article = articleOf(page);
    await article.getByRole('button', { name: 'Lock this section' }).click();
    await expect(article.getByRole('button', { name: 'Unlock this section' })).toBeVisible();
    await expect(article.getByRole('button', { name: 'Edit text' })).toBeDisabled();
    await expect(article).toContainText('A locked section is final wording');
    await expect(article.getByRole('button', { name: 'Restore this version' }).first()).toHaveCount(
      0,
    );
    await article.getByRole('button', { name: 'Unlock this section' }).click();
    await expect(article.getByRole('button', { name: 'Edit text' })).toBeEnabled();
  });

  await test.step('writing a chapter again says why it is unavailable when there is no model', async () => {
    const article = articleOf(page);
    await expect(
      article.getByRole('heading', { level: 4, name: /Write this chapter again/u }),
    ).toBeVisible();
    await expect(article.getByRole('button', { name: 'Write this chapter again' })).toHaveCount(0);
    await expect(
      article.getByRole('region', { name: /^Write .* again$/u }).locator('.field-help'),
    ).not.toBeEmpty();
  });

  await test.step('leave a reviewer note on the section', async () => {
    const article = articleOf(page);
    await article.getByLabel('Add a note for the author').fill(NOTE);
    await article.getByRole('button', { name: 'Add note' }).click();
    await expect(article.getByText('Reviewer notes (1)')).toBeVisible();
    await expect(article.getByText(NOTE)).toBeVisible();
    await expect(article.getByLabel('Add a note for the author')).toHaveValue('');
    // Every change, a note included, is a revision of the document.
    await expect(toolbarOf(page)).toContainText('REVISION 5');
  });

  await test.step('submit for review: the report is frozen and the reviewer’s choices appear', async () => {
    await toolbarOf(page).getByRole('button', { name: 'Submit for review' }).click();
    await expect(toolbarOf(page)).toContainText('In review');
    const article = articleOf(page);
    await expect(article.getByRole('button', { name: 'Edit text' })).toHaveCount(0);
    await expect(article).toContainText('This report is in review. Withdraw it to change it.');
    await expect(toolbarOf(page).getByRole('button', { name: 'Approve…' })).toBeEnabled();
    await expect(toolbarOf(page).getByRole('button', { name: 'Request changes…' })).toBeEnabled();
    await expect(
      toolbarOf(page).getByRole('button', { name: 'Withdraw from review…' }),
    ).toBeEnabled();
  });

  await test.step('request changes needs a reason, and the report can be edited again', async () => {
    const trigger = toolbarOf(page).getByRole('button', { name: 'Request changes…' });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Send the report back for changes' });
    await expect(dialog).toBeVisible();
    await expectNoAxeViolations(page, 'studio: request changes dialog');
    const confirm = dialog.getByRole('button', { name: 'Send it back' });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel('What needs to change?').fill('ab');
    await expect(confirm, 'two characters are not a reason').toBeDisabled();
    await dialog.getByLabel('What needs to change?').fill('Re-check the crossing figure.');
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect(toolbarOf(page)).toContainText('Changes requested');
    await expect(articleOf(page).getByRole('button', { name: 'Edit text' })).toBeEnabled();
    await expect(studioOf(page)).toContainText('Re-check the crossing figure.');
  });

  await test.step('restoring the first version puts the generated text back, as a new version, with its statements current again', async () => {
    const article = articleOf(page);
    await openDetails(article, 'Version history (2)');
    await article.getByRole('button', { name: 'Restore this version' }).click();
    await expect(article.getByText('VERSION 3', { exact: true })).toBeVisible();
    await expect(article).toContainText('restored from version 1');
    await expect(article).not.toContainText(
      'These statements describe an earlier text of this section',
    );
    await expect(article).not.toContainText(NEW_SENTENCE);
    expect((await documentOf(page)).sections[1]!.versions).toHaveLength(3);
  });

  await test.step('submit again and approve: the dialog says what is being approved', async () => {
    await toolbarOf(page).getByRole('button', { name: 'Submit for review' }).click();
    await expect(toolbarOf(page)).toContainText('In review');
    await toolbarOf(page).getByRole('button', { name: 'Approve…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Approve this report' });
    await expect(dialog).toContainText('You are approving the text as it stands now');
    await expect(dialog).toContainText('are not findings');
    await expectNoAxeViolations(page, 'studio: approve dialog');
    await dialog.getByRole('button', { name: 'Approve this text' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(toolbarOf(page)).toContainText('Approved');
    await expect(toolbarOf(page)).toContainText('Approved by You (local user)');
    await expect(toolbarOf(page)).toContainText('who also wrote part of this text');
    await expect(articleOf(page)).toContainText('This report is approved. Reopen it to change it.');
    await expectNoAxeViolations(page, 'studio: approved');
    await shot(page, '24-studio-approved');
  });

  let hash = '';
  await test.step('the approval holds the hash of the text, and the printable memo says the same', async () => {
    const studio = studioOf(page);
    await openDetails(studio, 'Review record');
    const shown = await studio
      .locator('.studio-record .mono', { hasText: /^[0-9a-f]{64}$/u })
      .textContent();
    hash = shown!.trim();
    expect(hash).toMatch(/^[0-9a-f]{64}$/u);

    const [memo] = await Promise.all([
      context.waitForEvent('page'),
      studio.getByRole('link', { name: 'Open the printable memo' }).click(),
    ]);
    await memo.waitForLoadState('domcontentloaded');
    expect(new URL(memo.url()).pathname).toBe(`${studioPath}/export`);
    await expect(memo.locator('.status')).toContainText('APPROVED');
    await expect(memo.locator('.status')).not.toContainText('NOT APPROVED');
    await expect(memo.locator('.hash')).toHaveText(hash);
    await expect(memo.getByText('The approver also wrote part of this text.')).toBeVisible();
    await expect(memo.locator('script')).toHaveCount(0);
    await expect(memo.locator('h1')).toBeVisible();
    await shot(memo, '25-studio-memo');
    await memo.close();

    const headers = (await page.request.get(`${studioPath}/export?format=memo`)).headers();
    expect(headers['content-security-policy']).toBe(MEMO_CSP);
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['cache-control']).toBe('no-store');
    expect(headers['content-type']).toContain('text/html');
  });

  await test.step('export Markdown and JSON: both carry the status and the hash', async () => {
    const studio = studioOf(page);
    const markdown = page.waitForEvent('download');
    await studio.getByRole('button', { name: 'Export Markdown' }).click();
    const markdownFile = await markdown;
    expect(markdownFile.suggestedFilename()).toBe('swarm-report-studio.md');
    const markdownText = await readFile((await markdownFile.path())!, 'utf8');
    expect(markdownText).toContain('**Status:** APPROVED');
    expect(markdownText).toContain(hash);
    expect(markdownText).toContain(
      'Swarm explores possible scenarios. It does not predict the future.',
    );

    const json = page.waitForEvent('download');
    await studio.getByRole('button', { name: 'Export JSON' }).click();
    const jsonFile = await json;
    expect(jsonFile.suggestedFilename()).toBe('swarm-report-studio.json');
    const parsed = JSON.parse(await readFile((await jsonFile.path())!, 'utf8')) as {
      format: string;
      status: { label: string };
      record: { contentHash: string; approval: { alsoEdited: boolean } | null };
      document: { state: string };
    };
    expect(parsed.format).toBe('swarm-report-studio');
    expect(parsed.status.label).toBe('APPROVED');
    expect(parsed.document.state).toBe('approved');
    expect(parsed.record.contentHash).toBe(hash);
    expect(parsed.record.approval?.alsoEdited).toBe(true);
  });

  await test.step('reopening needs a reason, takes the approval away, and the memo stops saying approved', async () => {
    await toolbarOf(page).getByRole('button', { name: 'Reopen…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Reopen the approved report' });
    await expect(dialog.getByRole('button', { name: 'Reopen it' })).toBeDisabled();
    await dialog.getByLabel('Why is it being reopened?').fill('New figures arrived.');
    await dialog.getByRole('button', { name: 'Reopen it' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(toolbarOf(page)).toContainText('Draft');
    await expect(toolbarOf(page)).not.toContainText('Approved by');
    const memo = await (await page.request.get(`${studioPath}/export?format=memo`)).text();
    expect(memo).toContain('DRAFT: NOT APPROVED');
    expect(memo).not.toContain('The approver also wrote part of this text.');
    expect((await documentOf(page)).approval).toBeNull();
  });

  await test.step('the audit log names every step, and holds no text a person wrote', async () => {
    await page.getByRole('button', { name: 'Audit log' }).click();
    const dialog = page.getByRole('dialog', { name: 'Audit log' });
    const table = dialog.getByRole('table');
    await expect(table).toBeVisible();
    for (const action of [
      'studio.started',
      'studio.section.edited',
      'studio.section.locked',
      'studio.section.unlocked',
      'studio.note.added',
      'studio.submitted',
      'studio.changes.requested',
      'studio.section.restored',
      'studio.approved',
      'studio.exported',
      'studio.reopened',
    ]) {
      await expect(table, action).toContainText(action);
    }
    await expect(table).toContainText('Report approved');
    for (const text of [NEW_SENTENCE, NOTE, REASON, 'Re-check the crossing figure.']) {
      await expect(table, 'the log holds identifiers and counts, never text').not.toContainText(
        text,
      );
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  expect(problems).toEqual([]);
});

test('a page that is out of date is refused and reloaded, never allowed to overwrite another change', async ({
  page,
}) => {
  test.setTimeout(10 * 60_000);
  const problems = watchPage(page, { refusals: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await startStudio(page);
  const article = articleOf(page);
  const sectionId = (await documentOf(page)).sections[1]!.id;
  await article.getByRole('button', { name: 'Edit text' }).click();
  const box = article.getByRole('textbox', { name: /^Text of/u });
  const original = await box.inputValue();

  // Someone else saves the same section first.
  const other = await page.request.put(`${studioPath}/sections/${sectionId}`, {
    data: { body: `${original}\n\nAnother person’s sentence.`, expectedVersion: 1, reason: null },
  });
  expect(other.status(), await other.text()).toBe(200);

  await box.fill(`${original}\n\nMy sentence.`);
  await article.getByRole('button', { name: 'Save as a new version' }).click();
  const alert = studioOf(page).getByRole('alert');
  await expect(alert).toContainText('That change was not made');
  // The page now shows what the document says, and my sentence did not replace theirs.
  await expect(articleOf(page)).toContainText('Another person’s sentence.');
  await expect(articleOf(page)).not.toContainText('My sentence.');
  const current = await documentOf(page);
  expect(current.sections[1]!.versions).toHaveLength(2);
  expect(current.sections[1]!.body).toContain('Another person’s sentence.');
  expect(problems.filter((problem) => !problem.startsWith('console'))).toEqual([]);
});

test('the report studio can be used from the keyboard, and its dialogs return focus to what opened them', async ({
  page,
}) => {
  test.setTimeout(10 * 60_000);
  const problems = watchPage(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await startStudio(page);
  const outline = studioOf(page).getByRole('navigation', { name: 'Report sections' });

  // Choosing a section with the keyboard.
  const second = outline.getByRole('button').nth(2);
  await second.focus();
  await page.keyboard.press('Enter');
  await expect(second).toHaveAttribute('aria-current', 'true');
  await expect(articleOf(page).getByRole('heading', { level: 3 })).toHaveText(
    (await documentOf(page)).sections[2]!.title,
  );

  // A dialog takes focus, and Escape closes it and gives focus back.
  const edit = articleOf(page).getByRole('button', { name: 'Edit text' });
  await edit.focus();
  await page.keyboard.press('Enter');
  await articleOf(page)
    .getByRole('textbox', { name: /^Text of/u })
    .fill('A different text.');
  await articleOf(page).getByRole('button', { name: 'Save as a new version' }).focus();
  await page.keyboard.press('Enter');
  await expect(articleOf(page).getByText('VERSION 2', { exact: true })).toBeVisible();
  await toolbarOf(page).getByRole('button', { name: 'Submit for review' }).focus();
  await page.keyboard.press('Enter');
  await expect(toolbarOf(page)).toContainText('In review');
  const trigger = toolbarOf(page).getByRole('button', { name: 'Request changes…' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Send the report back for changes' });
  await expect(dialog).toBeVisible();
  expect(
    await page.evaluate(() => document.activeElement?.closest('dialog') !== null),
    'focus is inside the dialog',
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger, 'focus returns to the button that opened the dialog').toBeFocused();
  expect(problems).toEqual([]);
});

for (const theme of THEMES) {
  test(`the report studio is readable in the ${theme} theme, with every state of its controls`, async ({
    page,
  }) => {
    test.setTimeout(15 * 60_000);
    const problems = watchPage(page);
    await page.addInitScript((value) => window.localStorage.setItem('swarm.theme', value), theme);
    await page.setViewportSize({ width: 1360, height: 900 });
    await startStudio(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const check = async (label: string) => {
      await settled(page, `${theme}: ${label}`);
      await expectNoAxeViolations(page, `${theme}: studio ${label}`);
      if (theme !== 'light')
        await expectNoBrowserPaintedControls(page, `${theme}: studio ${label}`);
    };

    const article = articleOf(page);
    await check('draft');

    // Everything that opens is opened, so that what is inside is read as well.
    await article.getByRole('button', { name: 'Edit text' }).click();
    await check('editing');
    await article
      .getByRole('textbox', { name: /^Text of/u })
      .fill(
        `${await article.getByRole('textbox', { name: /^Text of/u }).inputValue()}\n\n${NEW_SENTENCE}`,
      );
    await article.getByRole('button', { name: 'Save as a new version' }).click();
    await expect(article.getByText('VERSION 2', { exact: true })).toBeVisible();
    await article.getByLabel('Add a note for the author').fill(NOTE);
    await article.getByRole('button', { name: 'Add note' }).click();
    await article.getByRole('button', { name: 'Lock this section' }).click();
    await openDetails(article, 'Version history (');
    await article.getByRole('button', { name: 'Compare with the current text' }).click();
    await article.locator('details.record-details > summary').evaluateAll((summaries) => {
      for (const summary of summaries) (summary.parentElement as HTMLDetailsElement).open = true;
    });
    await studioOf(page)
      .locator('.studio-record details')
      .evaluateAll((all) => {
        for (const details of all) (details as HTMLDetailsElement).open = true;
      });
    await check('with the history, the diff, the notes and the record open');

    await toolbarOf(page).getByRole('button', { name: 'Submit for review' }).click();
    await expect(toolbarOf(page)).toContainText('In review');
    await check('in review');
    await toolbarOf(page).getByRole('button', { name: 'Approve…' }).click();
    await check('approve dialog');
    await page.getByRole('dialog').getByRole('button', { name: 'Approve this text' }).click();
    await expect(toolbarOf(page)).toContainText('Approved');
    await check('approved');
    expect(problems).toEqual([]);
  });
}

test('the report studio fits a phone: nothing runs off the screen and the sections can be reached', async ({
  page,
}) => {
  test.setTimeout(10 * 60_000);
  const problems = watchPage(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await startStudio(page);
  await settled(page, 'phone: draft');
  const outline = studioOf(page).getByRole('navigation', { name: 'Report sections' });
  await expect(outline).toBeVisible();
  await outline.getByRole('button').nth(1).click();
  await articleOf(page).getByRole('button', { name: 'Edit text' }).click();
  await expect(articleOf(page).getByRole('textbox', { name: /^Text of/u })).toBeVisible();
  await settled(page, 'phone: editing');
  await articleOf(page).getByRole('button', { name: 'Cancel' }).click();
  await expectNoAxeViolations(page, 'phone: studio');
  expect(problems).toEqual([]);
});
