import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import {
  apiContext,
  expectNoAxeViolations,
  expectNoBrowserPaintedControls,
  expectNoHorizontalOverflow,
  expectReadableText,
  expectTouchTargets,
  watchPage,
} from '../support/helpers';
import { forget, quiet } from '../support/shell';
import {
  briefed,
  chooseSection,
  deepDived,
  holds,
  openDecide,
  openStudio,
  openTool,
  printed,
  saved,
  sectionPage,
  sectionTools,
  sectionsOf,
  startStudio,
  studio,
  studioDocument,
  verdict,
  withReport,
  workflow,
} from '../support/decide';

// Report Studio: a person works on the report of the deep dive as a document, section by section (every change a
// new version), sends it for review, a reviewer sends it back or approves it, and what is exported or printed says
// exactly what was approved. Rules mode: no model is called, so writing a chapter again is shown unavailable here
// (the model path is e2e/model/studio-regenerate.spec.ts), and a report computed from recorded results has no
// statements to check.

const NEW_SENTENCE = 'An analyst re-read these figures against the council briefing on 1 March.';
const NOTE = 'Please confirm the crossing figure against the council briefing.';
const REASON = 'The figure needs a second look.';
const SENT_BACK = 'Re-check the crossing figure.';
const MEMO_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const THEMES = ['light', 'dark', 'high-contrast'] as const;

let api: APIRequestContext;
const made: string[] = [];

test.beforeAll(async ({ playwright }) => {
  api = await apiContext(playwright);
});

test.afterAll(async () => {
  await forget(api, made);
  await api.dispose();
});

test.use({
  reducedMotion: 'reduce',
  viewport: { width: 1440, height: 900 },
  actionTimeout: 30_000,
});

/** A finished exploration with a brief and the deep dive's report, which is what the studio works on. */
async function reportProject(name: string): Promise<string> {
  const id = await withReport(api, await briefed(api, { name }));
  made.push(id);
  return id;
}

/** The second place of the review workflow: where the report is while a reviewer reads it. */
const inReview = (page: Page): Locator =>
  workflow(page).getByRole('listitem').filter({ hasText: 'In review' });

const memoPath = (project: string): string => `/api/projects/${project}/studio/export?format=memo`;

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
  test.setTimeout(10 * 60_000);
  const problems = watchPage(page);
  const project = await reportProject('Studio: the workflow');

  await test.step('the brief leads to the studio, which says what opening it does', async () => {
    await page.goto(`/?project=${project}&scene=decide`);
    await page
      .getByRole('main')
      .getByRole('group', { name: 'Tools for the brief' })
      .getByRole('button', { name: 'Edit report' })
      .click();
    await expect(page).toHaveURL(/view=studio/u);
    const heading = page.getByRole('main').getByRole('heading', { level: 1 });
    await expect(heading).toHaveText('Work on the report');
    await expect(studio(page)).toContainText('Every change is kept as a version');
    await expect(studio(page)).toContainText('the generated report is never changed');
    // What the working copy would hold is listed before anything is made.
    const parts = studio(page).getByRole('list', { name: 'What the working copy holds' });
    await expect(parts.getByRole('listitem').first()).toContainText('Executive summary');
    await expect(parts.getByRole('listitem').last()).toContainText('Limitations');
    await quiet(page);
    await expectNoAxeViolations(page, 'studio: not yet opened');
  });

  await test.step('opening it makes a draft with every section of the generated report', async () => {
    await page.getByRole('button', { name: 'Open in the studio' }).click();
    await expect(workflow(page)).toContainText('Revision 1');
    await expect(workflow(page).getByRole('listitem').filter({ hasText: 'Draft' })).toHaveAttribute(
      'aria-current',
      'step',
    );
    const document = await studioDocument(api, project);
    await expect(sectionsOf(page).getByRole('button')).toHaveCount(document.sections.length);
    expect(document.sections.map((section) => section.kind)).toEqual([
      'summary',
      ...document.sections.filter((section) => section.kind === 'chapter').map(() => 'chapter'),
      'limitations',
    ]);
    // The first section is the one in view, and the text is the generated report's, word for word.
    await expect(sectionPage(page).getByRole('heading', { level: 2 })).toHaveText(
      document.sections[0]!.title,
    );
    await expect(sectionPage(page).getByText('Generated', { exact: true })).toBeVisible();
    await expect(sectionPage(page)).toContainText(document.sections[0]!.body.slice(0, 60));
    await quiet(page);
    await expectNoAxeViolations(page, 'studio: draft');
  });

  await test.step('a report with no statements to check says so, rather than showing none', async () => {
    await chooseSection(page, 'Scenario and evidence');
    const tools = sectionTools(page);
    await expect(tools.getByRole('tab', { name: /^Statements/u })).toBeVisible();
    const panel = await openTool(page, /^Statements/u);
    await expect(panel).toContainText('Nothing here was checked statement by statement');
    await expect(panel).toContainText(
      'a report computed from recorded results has no statements to check',
    );
  });

  const title = 'Scenario and evidence';
  await test.step('the record holds the open conflicts between sources and the assumptions behind the figures', async () => {
    await studio(page).getByRole('button', { name: 'Record', exact: true }).click();
    const record = page.getByRole('dialog', { name: 'Review record' });
    await record.getByRole('tab', { name: /^Conflicts/u }).click();
    await expect(
      record.getByText(
        /Neither passage is declared true|No conflict between the sources was detected/u,
      ),
    ).toBeVisible();
    await record.getByRole('tab', { name: /^Assumptions/u }).click();
    await expect(record.getByRole('tabpanel').getByRole('listitem').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(record).toHaveCount(0);
  });

  await test.step('edit a section: the change is a new version, by a person, and not checked statement by statement', async () => {
    await sectionPage(page).getByRole('button', { name: 'Edit', exact: true }).click();
    const box = sectionPage(page).getByRole('textbox', { name: `Text of ${title}` });
    const original = await box.inputValue();
    expect(original.length).toBeGreaterThan(100);
    const bar = page.getByRole('region', { name: 'Save your changes' });
    await expect(bar).toContainText('No changes yet');
    await expect(
      bar.getByRole('button', { name: 'Save as version 2' }),
      'nothing has changed yet',
    ).toBeDisabled();
    await expectNoAxeViolations(page, 'studio: editing');

    await box.fill(`${original}\n\n${NEW_SENTENCE}`);
    await expect(bar).toContainText('Unsaved changes');
    await bar.getByLabel('Why you changed it (optional)').fill(REASON);
    await bar.getByRole('button', { name: 'Save as version 2' }).click();

    await expect(sectionPage(page).getByText('Version 2', { exact: true })).toBeVisible();
    await expect(sectionPage(page).getByText('Written by a person', { exact: true })).toBeVisible();
    await expect(sectionPage(page)).toContainText(
      'A person wrote this text. It has not been checked statement by statement.',
    );
    await expect(sectionPage(page)).toContainText(NEW_SENTENCE);
    await expect(workflow(page)).toContainText('Revision 2');
    await expect(
      sectionsOf(page).getByRole('button', { name: /^Scenario and evidence/u }),
    ).toHaveAccessibleName(/Written by a person/u);
    expect((await studioDocument(api, project)).sections[1]!.body).toContain(NEW_SENTENCE);
  });

  await test.step('compare the versions: the added sentence is marked as added, in words as well as in style', async () => {
    const history = await openTool(page, /^History/u);
    await expect(history).toContainText('Version 2');
    await expect(history).toContainText(`“${REASON}”`);
    await history.getByRole('button', { name: 'Compare' }).click();
    const read = sectionPage(page);
    await expect(read).toContainText('Version 1 read against the text now');
    const added = read.locator('ins');
    await expect(added).toContainText(NEW_SENTENCE.split(' ').slice(0, 4).join(' '));
    await expect(added.first().getByText('[added: ')).toHaveCount(1);
    await expect(read.getByText(/words? added, 0 removed/u)).toBeVisible();
    await history.getByRole('button', { name: 'Stop comparing' }).first().click();
    await expect(sectionPage(page).locator('ins')).toHaveCount(0);
  });

  await test.step('lock a section: it cannot be edited or restored until it is unlocked', async () => {
    const lock = sectionPage(page).getByRole('button', {
      name: 'Lock this section as final wording',
    });
    await lock.click();
    const unlock = sectionPage(page).getByRole('button', { name: 'Unlock this section' });
    await expect(unlock).toHaveAttribute('aria-pressed', 'true');
    await expect(
      sectionPage(page).getByRole('button', { name: 'Edit', exact: true }),
    ).toBeDisabled();
    await expect(sectionPage(page).getByText(/^Locked by /u)).toBeVisible();
    await expect(sectionTools(page).getByRole('button', { name: 'Restore' })).toHaveCount(0);
    await expect(
      sectionsOf(page).getByRole('button', { name: /^Scenario and evidence/u }),
    ).toHaveAccessibleName(/Locked/u);
    await unlock.click();
    await expect(
      sectionPage(page).getByRole('button', { name: 'Edit', exact: true }),
    ).toBeEnabled();
  });

  await test.step('writing a chapter again says why it is unavailable when there is no model', async () => {
    const rewrite = await openTool(page, /^Rewrite/u);
    await expect(rewrite.getByRole('button', { name: 'Write it again' })).toHaveCount(0);
    await expect(rewrite.getByRole('status').or(rewrite.locator('.sw-notice'))).not.toBeEmpty();
    await expect(rewrite).not.toContainText('Nothing changes until you accept the result.');
  });

  await test.step('leave a reviewer note on the section', async () => {
    const notes = await openTool(page, /^Notes/u);
    const before = Number(/Revision (\d+)/u.exec((await workflow(page).textContent()) ?? '')![1]);
    await notes.getByRole('textbox', { name: 'Add a note for the author' }).fill(NOTE);
    await notes.getByRole('button', { name: 'Add note' }).click();
    await expect(notes.getByText(NOTE)).toBeVisible();
    await expect(notes.getByRole('textbox', { name: 'Add a note for the author' })).toHaveValue('');
    await expect(sectionTools(page).getByRole('tab', { name: /^Notes/u })).toContainText('1');
    // Every change, a note included, is a revision of the document.
    await expect(workflow(page)).toContainText(`Revision ${before + 1}`);
  });

  await test.step('submit for review: the report is frozen and the reviewer’s choices appear', async () => {
    await workflow(page).getByRole('button', { name: 'Submit for review' }).click();
    await expect(
      workflow(page).getByRole('listitem').filter({ hasText: 'In review' }),
    ).toHaveAttribute('aria-current', 'step');
    await expect(sectionPage(page).getByRole('button', { name: 'Edit', exact: true })).toHaveCount(
      0,
    );
    await expect(sectionPage(page)).toContainText('Frozen while in review');
    await expect(workflow(page).getByRole('button', { name: 'Approve…' })).toBeEnabled();
    await expect(workflow(page).getByRole('button', { name: 'Request changes…' })).toBeEnabled();
    await expect(workflow(page).getByRole('button', { name: 'Withdraw…' })).toBeEnabled();
  });

  await test.step('request changes needs a reason, and the report can be edited again', async () => {
    await workflow(page).getByRole('button', { name: 'Request changes…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Send it back for changes' });
    await expect(dialog).toBeVisible();
    await expectNoAxeViolations(page, 'studio: request changes dialog');
    const confirm = dialog.getByRole('button', { name: 'Send it back' });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel('What needs to change?').fill('ab');
    await expect(confirm, 'two characters are not a reason').toBeDisabled();
    await dialog.getByLabel('What needs to change?').fill(SENT_BACK);
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect(
      workflow(page).getByRole('listitem').filter({ hasText: 'Changes requested' }),
    ).toHaveAttribute('aria-current', 'step');
    await expect(
      sectionPage(page).getByRole('button', { name: 'Edit', exact: true }),
    ).toBeEnabled();
    await expect(studio(page)).toContainText('A reviewer sent it back for changes');
    await expect(studio(page)).toContainText(SENT_BACK);
  });

  await test.step('restoring the first version puts the generated text back, as a new version', async () => {
    const history = await openTool(page, /^History/u);
    await history.getByRole('button', { name: 'Restore' }).click();
    await expect(sectionPage(page).getByText('Version 3', { exact: true })).toBeVisible();
    await expect(history).toContainText('restored from version 1');
    await expect(sectionPage(page)).not.toContainText(NEW_SENTENCE);
    expect((await studioDocument(api, project)).sections[1]!.versions).toHaveLength(3);
  });

  await test.step('submit again and approve: the dialog says what is being approved', async () => {
    await workflow(page).getByRole('button', { name: 'Submit for review' }).click();
    await expect(inReview(page)).toHaveAttribute('aria-current', 'step');
    await workflow(page).getByRole('button', { name: 'Approve…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Approve this report' });
    await expect(dialog).toContainText('You are approving the text exactly as it stands now');
    await expect(dialog).toContainText('labelled, not findings');
    await expect(dialog).toContainText('It does not verify the statements in it.');
    await expectNoAxeViolations(page, 'studio: approve dialog');
    await dialog.getByRole('button', { name: 'Approve this text' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      workflow(page).getByRole('listitem').filter({ hasText: 'Approved' }),
    ).toHaveAttribute('aria-current', 'step');
    await expect(workflow(page)).toContainText('Approved by You (local user)');
    await expect(workflow(page)).toContainText('who also wrote part of this text');
    await expect(sectionPage(page)).toContainText('Approved: reopen to change');
    await quiet(page);
    await expectNoAxeViolations(page, 'studio: approved');
  });

  let hash = '';
  await test.step('the approval holds the hash of the text, and the printable memo says the same', async () => {
    await studio(page).getByRole('button', { name: 'Record', exact: true }).click();
    // It opens on the decisions, although an earlier step left it on the assumptions: it does not keep its place.
    const record = page.getByRole('dialog', { name: 'Review record' });
    hash = ((await record.locator('code').first().textContent()) ?? '').trim();
    expect(hash).toMatch(/^[0-9a-f]{64}$/u);
    await expect(record).toContainText('Fingerprint of the approved text');
    await expect(record).toContainText('A printed memo shows the same fingerprint');
    await page.keyboard.press('Escape');
    await expect(record).toHaveCount(0);

    await studio(page).getByRole('button', { name: 'Export' }).click();
    const [memo] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('menuitem', { name: 'Printable memo' }).click(),
    ]);
    await memo.waitForLoadState('domcontentloaded');
    expect(new URL(memo.url()).pathname).toBe(`/api/projects/${project}/studio/export`);
    await expect(memo.locator('.status')).toContainText('APPROVED');
    await expect(memo.locator('.status')).not.toContainText('NOT APPROVED');
    await expect(memo.locator('.hash')).toHaveText(hash);
    await expect(memo.getByText('The approver also wrote part of this text.')).toBeVisible();
    await expect(memo.locator('script')).toHaveCount(0);
    await expect(memo.locator('h1')).toBeVisible();
    await memo.close();

    const headers = (await page.request.get(memoPath(project))).headers();
    expect(headers['content-security-policy']).toBe(MEMO_CSP);
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['cache-control']).toBe('no-store');
    expect(headers['content-type']).toContain('text/html');
  });

  await test.step('export Markdown and JSON: both carry the status and the hash', async () => {
    await studio(page).getByRole('button', { name: 'Export' }).click();
    const markdown = await saved(page, () =>
      page.getByRole('menuitem', { name: 'Markdown' }).click(),
    );
    expect(markdown.name).toBe('swarm-report-studio.md');
    expect(markdown.text).toContain('**Status:** APPROVED');
    expect(markdown.text).toContain(hash);
    expect(markdown.text).toContain(
      'Swarm explores possible scenarios. It does not predict the future.',
    );

    await studio(page).getByRole('button', { name: 'Export' }).click();
    const json = await saved(page, () => page.getByRole('menuitem', { name: /^JSON/u }).click());
    expect(json.name).toBe('swarm-report-studio.json');
    const parsed = JSON.parse(json.text) as {
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
    await workflow(page).getByRole('button', { name: 'Reopen…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Reopen the approved report' });
    await expect(dialog.getByRole('button', { name: 'Reopen it' })).toBeDisabled();
    await dialog.getByLabel('Why is it being reopened?').fill('New figures arrived.');
    await dialog.getByRole('button', { name: 'Reopen it' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(workflow(page).getByRole('listitem').filter({ hasText: 'Draft' })).toHaveAttribute(
      'aria-current',
      'step',
    );
    await expect(workflow(page)).not.toContainText('Approved by');
    const memo = await (await page.request.get(memoPath(project))).text();
    expect(memo).toContain('DRAFT: NOT APPROVED');
    expect(memo).not.toContain('The approver also wrote part of this text.');
    expect((await studioDocument(api, project)).approval).toBeNull();
  });

  await test.step('the audit log names every step, and holds no text a person wrote', async () => {
    await studio(page).getByRole('button', { name: 'Record', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Review record' })
      .getByRole('button', { name: 'Open the audit log' })
      .click();
    const log = page.getByRole('dialog', { name: 'Audit log' });
    await expect(log).toBeVisible();
    for (const action of [
      'Report opened in the studio',
      'Report section edited',
      'Report section locked',
      'Report section unlocked',
      'Reviewer note added',
      'Report submitted for review',
      'Changes requested on the report',
      'Report section restored to an earlier version',
      'Report approved',
      'Report exported from the studio',
      'Report reopened',
    ]) {
      await expect(log.getByRole('heading', { name: action }).first(), action).toBeVisible();
    }
    for (const text of [NEW_SENTENCE, NOTE, REASON, SENT_BACK]) {
      await expect(log, 'the log holds identifiers and counts, never text').not.toContainText(text);
    }
    // The log opens over the record it was asked for from: Escape closes the log, and gives the record back.
    await page.keyboard.press('Escape');
    await expect(log).toHaveCount(0);
    const record = page.getByRole('dialog', { name: 'Review record' });
    await expect(record).toBeVisible();
    await expect(record.getByRole('button', { name: 'Open the audit log' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  expect(problems).toEqual([]);
});

test('a page that is out of date is refused and reloaded, never allowed to overwrite another change', async ({
  page,
}) => {
  test.setTimeout(5 * 60_000);
  const project = await reportProject('Studio: out of date');
  const problems = watchPage(page, { refusals: true });
  await startStudio(page, project);
  await chooseSection(page, 'Scenario and evidence');
  const sectionId = (await studioDocument(api, project)).sections[1]!.id;
  await sectionPage(page).getByRole('button', { name: 'Edit', exact: true }).click();
  const box = sectionPage(page).getByRole('textbox', { name: 'Text of Scenario and evidence' });
  const original = await box.inputValue();

  // Someone else saves the same section first.
  const other = await api.put(`/api/projects/${project}/studio/sections/${sectionId}`, {
    data: { body: `${original}\n\nAnother person’s sentence.`, expectedVersion: 1, reason: null },
  });
  expect(other.status(), await other.text()).toBe(200);

  await box.fill(`${original}\n\nMy sentence.`);
  await page
    .getByRole('region', { name: 'Save your changes' })
    .getByRole('button', { name: /^Save/u })
    .click();
  // The page says so, keeps what was written, and the other person's sentence was not replaced.
  await expect(studio(page).getByRole('alert')).toContainText('That change was not made');
  await expect(studio(page).getByRole('alert')).toContainText('What you wrote is kept.');
  const current = await studioDocument(api, project);
  expect(current.sections[1]!.versions).toHaveLength(2);
  expect(current.sections[1]!.body).toContain('Another person’s sentence.');
  expect(current.sections[1]!.body).not.toContain('My sentence.');
  await expect(box, 'what the person wrote is still in the box').toHaveValue(
    `${original}\n\nMy sentence.`,
  );
  expect(problems.filter((problem) => !problem.startsWith('console'))).toEqual([]);
});

test('the studio can be used from the keyboard, and its dialogs return focus to what opened them', async ({
  page,
}) => {
  test.setTimeout(5 * 60_000);
  const project = await reportProject('Studio: keyboard');
  const problems = watchPage(page);
  await startStudio(page, project);

  // Choosing a section with the keyboard.
  const third = sectionsOf(page).getByRole('button').nth(2);
  await third.focus();
  await page.keyboard.press('Enter');
  await expect(third).toHaveAttribute('aria-current', 'true');
  await expect(sectionPage(page).getByRole('heading', { level: 2 })).toHaveText(
    (await studioDocument(api, project)).sections[2]!.title,
  );

  // Editing and saving without the pointer.
  const edit = sectionPage(page).getByRole('button', { name: 'Edit', exact: true });
  await edit.focus();
  await page.keyboard.press('Enter');
  const box = sectionPage(page).getByRole('textbox', { name: /^Text of/u });
  await expect(box).toBeFocused();
  await box.fill('A different text.');
  await page.keyboard.press('Control+Enter');
  await expect(sectionPage(page).getByText('Version 2', { exact: true })).toBeVisible();
  await workflow(page).getByRole('button', { name: 'Submit for review' }).focus();
  await page.keyboard.press('Enter');
  await expect(inReview(page)).toHaveAttribute('aria-current', 'step');

  // A dialog takes focus, Escape closes it and gives focus back.
  const trigger = workflow(page).getByRole('button', { name: 'Request changes…' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Send it back for changes' });
  await expect(dialog).toBeVisible();
  expect(
    await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null),
    'focus is inside the dialog',
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger, 'focus returns to the button that opened the dialog').toBeFocused();
  expect(problems).toEqual([]);
});

test('leaving with words that are not saved asks first, and keeping them keeps them', async ({
  page,
}) => {
  test.setTimeout(5 * 60_000);
  const project = await reportProject('Studio: unsaved');
  await startStudio(page, project);
  await sectionPage(page).getByRole('button', { name: 'Edit', exact: true }).click();
  const box = sectionPage(page).getByRole('textbox', { name: /^Text of/u });
  const text = `${await box.inputValue()} Unsaved words.`;
  await box.fill(text);

  // The brief's own bar leads back, and it asks first.
  const back = page.getByRole('button', { name: 'Decision brief' });
  await back.click();
  const dialog = page.getByRole('dialog', { name: 'Leave with unsaved changes?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('words that have not been saved');
  await expectNoAxeViolations(page, 'studio: leave with unsaved changes');
  await dialog.getByRole('button', { name: 'Keep editing' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/view=studio/u);
  await expect(box).toHaveValue(text);

  // Leaving anyway is the person's choice, and loses only what was not saved.
  await back.click();
  await page
    .getByRole('dialog', { name: 'Leave with unsaved changes?' })
    .getByRole('button', { name: 'Leave anyway' })
    .click();
  await expect(page).not.toHaveURL(/view=studio/u);
  await expect(verdict(page)).toContainText('the share of simulated members');
  expect((await studioDocument(api, project)).sections[0]!.versions).toHaveLength(1);

  // With nothing unsaved the way back does not ask.
  await page.goto(`/?project=${project}&scene=decide&view=studio`);
  await page.getByRole('button', { name: 'Decision brief' }).click();
  await expect(page).not.toHaveURL(/view=studio/u);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test.describe('every way out of the studio while words are not saved', () => {
  // The shell asks before the ways out that are its own (the journey, the dock, the palette, another exploration, a new
  // question); the studio asks before the ones that only change the view (the brief's bar, the detailed report), and
  // the answer goes where the person was heading. Never two questions for one exit, and none for words that are saved.
  const SENTENCE = '1 section holds words that have not been saved. They are lost if you leave.';
  let project = '';
  const question = (page: Page): Locator =>
    page.getByRole('dialog', { name: 'Leave with unsaved changes?' });
  const warnsTheBrowser = (page: Page): Promise<boolean> =>
    page.evaluate(() => {
      const closing = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(closing);
      return closing.defaultPrevented;
    });

  /** Opens the studio and writes into its first section without saving: the words that would be lost. */
  async function writeWithoutSaving(page: Page): Promise<{ box: Locator; text: string }> {
    if (!project) {
      project = await reportProject('Studio: every way out');
      await startStudio(page, project);
    } else {
      await openStudio(page, project);
    }
    await sectionPage(page).getByRole('button', { name: 'Edit', exact: true }).click();
    const box = sectionPage(page).getByRole('textbox', { name: /^Text of/u });
    const text = `${await box.inputValue()} Unsaved words.`;
    await box.fill(text);
    return { box, text };
  }

  /**
   * Asks to leave, keeps the words, asks again and leaves anyway: where the person was heading is where they arrive, and
   * a keyboard that keeps the words is back at the control it used.
   */
  async function asksThenGoes(
    page: Page,
    way: { leave: () => Promise<void>; arrival: RegExp; control: Locator },
  ): Promise<void> {
    const { box, text } = await writeWithoutSaving(page);
    expect(await warnsTheBrowser(page), 'the browser is warned while words are not saved').toBe(
      true,
    );
    await way.leave();
    await expect(question(page)).toBeVisible();
    await expect(question(page)).toContainText(SENTENCE);
    // One question for one exit, and nothing has moved while it is open.
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(page).toHaveURL(/view=studio/u);
    await expect(question(page).getByRole('button', { name: 'Keep editing' })).toBeFocused();
    await question(page).getByRole('button', { name: 'Keep editing' }).click();
    await expect(question(page)).toHaveCount(0);
    await expect(page).toHaveURL(/view=studio/u);
    await expect(box).toHaveValue(text);
    await expect(way.control, 'focus goes back to the control that was used').toBeFocused();

    await way.leave();
    await question(page).getByRole('button', { name: 'Leave anyway' }).click();
    await expect(page).toHaveURL(way.arrival);
    await expect(question(page)).toHaveCount(0);
    expect(await warnsTheBrowser(page), 'nothing is held once the studio has been left').toBe(
      false,
    );
  }

  const journeyStep = (page: Page): Locator =>
    page.getByRole('navigation', { name: 'Journey' }).getByRole('button', { name: /^Ground/u });
  const reportButton = (page: Page): Locator =>
    studio(page).getByRole('button', { name: 'Detailed report', exact: true });

  test('the journey asks, with the studio’s words, and goes to the step that was pressed', async ({
    page,
  }) => {
    test.setTimeout(5 * 60_000);
    await asksThenGoes(page, {
      leave: () => journeyStep(page).click(),
      arrival: /scene=ground/u,
      control: journeyStep(page),
    });
  });

  test('the detailed report asks, and goes to the report and not to the brief', async ({
    page,
  }) => {
    test.setTimeout(5 * 60_000);
    await asksThenGoes(page, {
      leave: () => reportButton(page).click(),
      arrival: /view=report/u,
      control: reportButton(page),
    });
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).not.toHaveText(
      'Work on the report',
    );
  });

  test('the brief’s bar asks, and goes to the brief', async ({ page }) => {
    test.setTimeout(5 * 60_000);
    const bar = page.getByRole('button', { name: 'Decision brief' });
    await asksThenGoes(page, {
      leave: () => bar.click(),
      arrival: /^(?!.*view=)/u,
      control: bar,
    });
  });

  test('words that were saved are not asked about, and the browser is not warned', async ({
    page,
  }) => {
    test.setTimeout(5 * 60_000);
    await writeWithoutSaving(page);
    await page
      .getByRole('region', { name: 'Save your changes' })
      .getByRole('button', { name: /^Save/u })
      .click();
    await expect(sectionPage(page).getByText('Version 2', { exact: true })).toBeVisible();
    expect(await warnsTheBrowser(page)).toBe(false);

    await reportButton(page).click();
    await expect(page).toHaveURL(/view=report/u);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await openStudio(page, project);
    await journeyStep(page).click();
    await expect(page).toHaveURL(/scene=ground/u);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test('the detailed report of the menu asks as well, and goes to the report', async ({
      page,
    }) => {
      test.setTimeout(5 * 60_000);
      const more = studio(page).getByRole('button', { name: 'More' });
      await asksThenGoes(page, {
        leave: async () => {
          await more.click();
          await page.getByRole('menuitem', { name: 'Detailed report' }).click();
        },
        arrival: /view=report/u,
        control: more,
      });
    });
  });
});

test.describe('with no detailed report to work on', () => {
  // One project with a finished deep dive and no report is enough to look at the studio's explanation in every setting;
  // the test that writes the report has a project of its own.
  let unwritten: string | undefined;
  async function unwrittenProject(): Promise<string> {
    if (!unwritten) {
      unwritten = await deepDived(api, { name: 'Studio: no report to work on' });
      made.push(unwritten);
    }
    return unwritten;
  }

  test('the studio says so, writes the report from there with its progress in view, and opens on the result', async ({
    page,
  }) => {
    test.setTimeout(5 * 60_000);
    const problems = watchPage(page);
    const project = await deepDived(api, { name: 'Studio: nothing written yet' });
    made.push(project);
    const main = page.getByRole('main');
    const title = main.getByRole('heading', { level: 1 });

    await test.step('the address of the studio explains itself, and offers the one thing that helps', async () => {
      await openStudio(page, project);
      await expect(title).toHaveText('There is no report to work on yet');
      await expect(main).toContainText('Write it here, and the studio opens on it.');
      await expect(workflow(page)).toHaveCount(0);
      await expect(main.getByRole('button', { name: 'Write the detailed report' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Decision brief' })).toBeVisible();
      await quiet(page);
      await expectNoAxeViolations(page, 'studio: no report to work on');
    });

    // The request is held back, and the project is read as the engine reports it while it writes, so that what a person
    // sees while the report is made can be looked at; both are let go once that has been seen.
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**/api/projects/${project}/steps/report`, async (route) => {
      await held;
      await route.continue();
    });
    let writing = false;
    await page.route(
      (url) => url.pathname === `/api/projects/${project}`,
      async (route) => {
        const response = await route.fetch();
        if (!writing) {
          await route.fulfill({ response });
          return;
        }
        const body = (await response.json()) as {
          status: string;
          progress: number;
          console: { steps: Record<string, string>; activeStep: string };
        };
        body.status = 'running';
        body.progress = 40;
        body.console.steps.report = 'running';
        body.console.activeStep = 'report';
        await route.fulfill({ response, json: body });
      },
    );

    await test.step('writing starts from the button, which says that it has', async () => {
      const write = main.getByRole('button', { name: 'Write the detailed report' });
      await write.click();
      await expect(write).toBeDisabled();
      await expect(write).toHaveAttribute('aria-busy', 'true');
    });

    await test.step('while it goes on the studio shows how far it is, and the way to stop it', async () => {
      writing = true;
      release();
      await expect(title).toHaveText('The detailed report is being written', { timeout: 30_000 });
      await expect(main.getByRole('progressbar', { name: 'Report progress' })).toHaveAttribute(
        'aria-valuenow',
        '40',
      );
      await expect(main.getByRole('button', { name: 'Stop' })).toBeVisible();
      await expect(main).toContainText('This page updates by itself.');
      await expect(main.getByRole('button', { name: 'Write the detailed report' })).toHaveCount(0);
      await quiet(page);
      await expectNoAxeViolations(page, 'studio: the report is being written');
    });

    await test.step('once it is written the studio opens on it, says so, and has the reader’s place on the page', async () => {
      writing = false;
      await expect(title).toHaveText('Work on the report', { timeout: 60_000 });
      await expect(title).toBeFocused();
      await expect(
        studio(page).getByRole('status').filter({ hasText: 'The detailed report is written' }),
      ).toHaveCount(1);
      await expect(main.getByRole('button', { name: 'Write the detailed report' })).toHaveCount(0);
      await quiet(page);
      await expectNoAxeViolations(page, 'studio: the report just written');
    });

    await test.step('and what it opens is the report that was written', async () => {
      const written = (
        (await (await api.get(`/api/projects/${project}`)).json()) as {
          report: { sections: { title: string }[] } | null;
        }
      ).report;
      expect(written, 'the report was written').not.toBeNull();
      await main.getByRole('button', { name: 'Open in the studio' }).click();
      await expect(workflow(page)).toContainText('Revision 1');
      const document = await studioDocument(api, project);
      await expect(sectionsOf(page).getByRole('button')).toHaveCount(document.sections.length);
      for (const section of written!.sections) {
        expect(
          document.sections.map((each) => each.title),
          section.title,
        ).toContain(section.title);
      }
    });
    expect(problems).toEqual([]);
  });

  test('the brief leads to where it is written, and an address of the studio still explains itself, with the way back', async ({
    page,
  }) => {
    const project = await unwrittenProject();
    await openDecide(page, project);
    await page
      .getByRole('main')
      .getByRole('group', { name: 'Tools for the brief' })
      .getByRole('button', { name: 'Write the detailed report' })
      .click();
    await expect(page).toHaveURL(/view=report/u);
    // The studio is only reached from where there is a report; its address, when there is none, still explains itself.
    await page.goto(`/?project=${project}&scene=decide&view=studio`);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText(
      'There is no report to work on yet',
    );
    await page.getByRole('button', { name: 'Decision brief' }).click();
    await expect(page).not.toHaveURL(/view=/u);
    await expect(verdict(page)).toContainText('the share of simulated members');
  });

  for (const theme of THEMES) {
    test(`says so in the ${theme} theme, readably, with a button that is plainly one`, async ({
      page,
    }) => {
      const problems = watchPage(page);
      const project = await unwrittenProject();
      await openStudio(page, project, { theme });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const main = page.getByRole('main');
      await expect(main.getByRole('heading', { level: 1 })).toHaveText(
        'There is no report to work on yet',
      );
      await expect(main.getByRole('button', { name: 'Write the detailed report' })).toBeEnabled();
      await quiet(page);
      await expectNoHorizontalOverflow(page);
      await expectReadableText(page, `${theme}: studio with no report`);
      await expectNoAxeViolations(page, `${theme}: studio with no report`);
      if (theme !== 'light')
        await expectNoBrowserPaintedControls(page, `${theme}: studio with no report`);
      expect(problems).toEqual([]);
    });
  }

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test('says so within the screen, and its buttons are big enough for a finger', async ({
      page,
    }) => {
      const project = await unwrittenProject();
      await openStudio(page, project, { theme: 'dark' });
      const main = page.getByRole('main');
      const write = main.getByRole('button', { name: 'Write the detailed report' });
      await expect(write).toBeInViewport();
      await quiet(page);
      await expectNoHorizontalOverflow(page);
      await expectTouchTargets(page, 'phone: studio with no report', 'main');
      await expectNoAxeViolations(page, 'phone: studio with no report');
    });
  });
});

for (const theme of THEMES) {
  test(`the studio is readable in the ${theme} theme, with every state of its controls`, async ({
    page,
  }) => {
    test.setTimeout(8 * 60_000);
    const project = await reportProject(`Studio: ${theme}`);
    const problems = watchPage(page);
    await startStudio(page, project, { theme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const check = async (label: string) => {
      await quiet(page);
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page, `${theme}: studio ${label}`);
      if (theme !== 'light')
        await expectNoBrowserPaintedControls(page, `${theme}: studio ${label}`);
    };
    await check('draft');

    // Everything that opens is opened, so that what is inside is read as well.
    await chooseSection(page, 'Scenario and evidence');
    await sectionPage(page).getByRole('button', { name: 'Edit', exact: true }).click();
    await check('editing');
    const box = sectionPage(page).getByRole('textbox', { name: /^Text of/u });
    await box.fill(`${await box.inputValue()}\n\n${NEW_SENTENCE}`);
    await page
      .getByRole('region', { name: 'Save your changes' })
      .getByRole('button', { name: /^Save/u })
      .click();
    await expect(sectionPage(page).getByText('Version 2', { exact: true })).toBeVisible();
    const notes = await openTool(page, /^Notes/u);
    await notes.getByRole('textbox', { name: 'Add a note for the author' }).fill(NOTE);
    await notes.getByRole('button', { name: 'Add note' }).click();
    await expect(notes.getByText(NOTE)).toBeVisible();
    await sectionPage(page)
      .getByRole('button', { name: 'Lock this section as final wording' })
      .click();
    const history = await openTool(page, /^History/u);
    await history.getByRole('button', { name: 'Compare' }).click();
    await check('with the history, the diff, the notes and the lock');

    await workflow(page).getByRole('button', { name: 'Submit for review' }).click();
    await expect(inReview(page)).toHaveAttribute('aria-current', 'step');
    await check('in review');
    await workflow(page).getByRole('button', { name: 'Approve…' }).click();
    await check('approve dialog');
    await page.getByRole('dialog').getByRole('button', { name: 'Approve this text' }).click();
    await expect(workflow(page)).toContainText('Approved by');
    await check('approved');
    await studio(page).getByRole('button', { name: 'Record', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Review record' })).toBeVisible();
    await check('record');
    expect(problems).toEqual([]);
  });
}

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('the studio fits: nothing runs off the screen, the sections can be reached, and what is pressed is big enough', async ({
    page,
  }) => {
    test.setTimeout(5 * 60_000);
    const project = await reportProject('Studio: phone');
    const problems = watchPage(page);
    await startStudio(page, project);
    await quiet(page);
    await expectNoHorizontalOverflow(page);
    // The outline is a switcher on a phone: a step to the next section and a list that opens.
    const switcher = studio(page)
      .getByRole('button', { name: /^Next section|Next/u })
      .first();
    await expect(switcher).toBeVisible();
    await switcher.click();
    await expect(sectionPage(page).getByRole('heading', { level: 2 })).toHaveText(
      (await studioDocument(api, project)).sections[1]!.title,
    );
    await sectionPage(page).getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(sectionPage(page).getByRole('textbox', { name: /^Text of/u })).toBeVisible();
    await quiet(page);
    await expectNoHorizontalOverflow(page);
    const bar = page.getByRole('region', { name: 'Save your changes' });
    await expect(bar).toBeInViewport();
    // The bar floats over the page, above the dock, and nothing of it is cut off.
    const box = (await bar.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await sectionPage(page)
      .getByRole('button', { name: 'Cancel' })
      .or(bar.getByRole('button', { name: 'Cancel' }))
      .first()
      .click();
    await expectNoAxeViolations(page, 'phone: studio');
    expect(problems).toEqual([]);
  });
});

test.describe('on paper', () => {
  test('prints the whole working copy with where it stands in its review, and none of the editor', async ({
    page,
  }) => {
    test.setTimeout(5 * 60_000);
    const project = await reportProject('Studio: paper');
    await startStudio(page, project);
    await chooseSection(page, 'Scenario and evidence');
    await sectionPage(page).getByRole('button', { name: 'Edit', exact: true }).click();
    const box = sectionPage(page).getByRole('textbox', { name: /^Text of/u });
    await box.fill(`${await box.inputValue()}\n\n${NEW_SENTENCE}`);
    await page
      .getByRole('region', { name: 'Save your changes' })
      .getByRole('button', { name: /^Save/u })
      .click();
    await expect(sectionPage(page).getByText('Version 2', { exact: true })).toBeVisible();
    await workflow(page).getByRole('button', { name: 'Submit for review' }).click();
    await expect(inReview(page)).toHaveAttribute('aria-current', 'step');
    const document = await studioDocument(api, project);

    const out = await printed(page);
    expect(out.overlaps, 'text drawn over text').toEqual([]);
    expect(holds(out, 'Report studio · working copy')).toBe(true);
    expect(holds(out, 'In review')).toBe(true);
    expect(holds(out, 'Revision 3')).toBe(true);
    expect(holds(out, 'Not approved')).toBe(true);
    expect(holds(out, NEW_SENTENCE)).toBe(true);
    for (const section of document.sections) {
      expect(holds(out, section.title), section.title).toBe(true);
      expect(holds(out, section.body.slice(0, 50)), `the text of ${section.title}`).toBe(true);
    }
    expect(
      holds(
        out,
        'Swarm explores scenarios. It does not guarantee or precisely predict real-world behavior.',
      ),
    ).toBe(true);
    for (const chrome of [
      'Submit for review',
      'Save as version',
      'Lock this section',
      'Add a note for the author',
      'Write it again',
      'Back to the brief',
    ]) {
      expect(holds(out, chrome), `"${chrome}" is not printed`).toBe(false);
    }
  });
});
