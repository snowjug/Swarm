import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { openApp } from '../support/app';
import {
  apiContext,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  expectReadableText,
  seed,
  watchPage,
} from '../support/helpers';
import {
  PHONE,
  expectPressable,
  forget,
  makeProject,
  openHistory,
  openSettings,
  quiet,
  settingsButton,
} from '../support/shell';

// The panels that open over the page, in rules mode, through the real server: Ask (the analyst, the actors, the surveys),
// the audit log and the history. Each is held to what it says: a lookup is said to be a lookup, a synthetic actor is said
// not to be a person, a chain that is checked is told as it came out (intact, or broken at an entry), and a list that
// cannot be read says so and can be read again.

test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

let api: APIRequestContext;
/** A project the engine ran to its written report: what Ask answers from. */
let engine = '';
let lab = '';
const tag = Date.now().toString(36);

test.beforeAll(async ({ playwright }) => {
  api = await apiContext(playwright);
  engine = await seed(api, 'report', { name: `Panels ${tag}: engine run` });
  lab = (
    await makeProject(api, 'compared', {
      name: `Panels ${tag}: Copilot in Teams, a phased opt-in with an admin-only first month`,
    })
  ).id;
});

test.afterAll(async () => {
  await forget(api, [engine, lab]);
  await api.dispose();
});

const json = (body: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

async function openAsk(page: Page) {
  await openApp(page, { project: engine, scene: 'decide', view: 'report' });
  await page.getByRole('button', { name: 'Ask about this' }).click();
  const sheet = page.getByRole('dialog', { name: 'Ask' });
  await expect(sheet).toBeVisible();
  return sheet;
}

test.describe('Ask', () => {
  test('the analyst looks evidence up, says that it is a lookup, and what it said is still there on the next visit', async ({
    page,
  }) => {
    const problems = watchPage(page);
    const sheet = await openAsk(page);
    await expect(sheet.getByRole('tab', { name: /^Analyst/u })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // It says what it is before anything is asked: rules look evidence up, they do not speak.
    await expect(sheet.getByText('Evidence lookup · rules')).toBeVisible();

    const ask = 'What are the limits of this report?';
    await sheet.getByRole('button', { name: ask }).click();
    const field = sheet.getByRole('textbox', { name: 'Question for the analyst' });
    await expect(field).toHaveValue(ask);
    await sheet.getByRole('button', { name: 'Look up evidence' }).click();
    const log = sheet.getByRole('log', { name: 'Messages' });
    await expect(log).toContainText(ask);
    // The reply says how well it rests on the project's evidence, in a word and in a sentence: this one cites nothing.
    await expect(log.getByRole('button', { name: 'No citation: unverified' }).last()).toBeVisible();
    await expect(log).toContainText(
      'The reply cites nothing from the project. Treat it as unverified.',
    );
    await expect(log).toContainText('Evidence lookup');
    await expect(field).toHaveValue('');
    await quiet(page);
    await expectNoAxeViolations(page, 'ask, the analyst');
    expect(problems).toEqual([]);

    // Saved on the server: a reload, and the conversation is read back.
    await page.reload();
    await page.getByRole('button', { name: 'Ask about this' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Ask' }).getByRole('log', { name: 'Messages' }),
    ).toContainText(ask);
  });

  test('an actor is a stand-in: the page says no actor speaks, and a lookup about it is not testimony', async ({
    page,
  }) => {
    const sheet = await openAsk(page);
    await sheet.getByRole('tab', { name: /^Actors/u }).click();
    await expect(
      sheet.getByText('Actors stand in for groups. They are synthetic, not people.'),
    ).toBeVisible();
    await expect(sheet.getByText('Evidence lookup · no actor speaks')).toBeVisible();
    const picker = sheet.getByRole('radiogroup', { name: 'Actor to talk to' });
    const actors = picker.getByRole('radio');
    expect(await actors.count()).toBeGreaterThan(1);
    await actors.nth(1).click();
    const name = (await actors.nth(1).textContent())?.trim() ?? '';
    await expect(sheet.getByRole('heading', { name })).toBeVisible();
    await sheet
      .getByRole('textbox', { name: `Question for ${name}` })
      .fill('What matters most to you about the change?');
    await sheet.getByRole('button', { name: 'Look up evidence' }).click();
    const log = sheet.getByRole('log', { name: 'Messages' });
    await expect(log).toContainText('What matters most to you about the change?');
    // What comes back is a lookup of what is recorded, and says it does not generate speech or impersonate.
    await expect(log).toContainText(
      /Local evidence lookup|does not generate speech|Recorded synthetic memories|Not found/iu,
    );
  });

  test('a survey asks several actors at once, says they are not people, and keeps what it recorded', async ({
    page,
  }) => {
    const problems = watchPage(page);
    const sheet = await openAsk(page);
    await sheet.getByRole('tab', { name: /^Survey/u }).click();
    // Interviews need a model: with none, the choice is there and shut, and says why.
    await expect(sheet.getByRole('radio', { name: /^Interview/u })).toBeDisabled();
    await expect(sheet).toContainText(
      'Interviews need a model-assisted project and a configured provider.',
    );
    await expect(
      sheet.getByText(
        'Synthetic actors, not people. Their answers are never a poll or a forecast.',
      ),
    ).toBeVisible();

    const record = sheet.getByRole('button', { name: 'Record snapshot' });
    await expect(record).toBeDisabled();
    const question = 'Where do you stand on the change today?';
    await sheet.getByRole('textbox', { name: 'Snapshot question or label' }).fill(question);
    const targets = sheet.getByRole('group', { name: /^Actors/u });
    const names = await targets.getByRole('button').allTextContents();
    await targets.getByRole('button', { name: names[0]!.trim() }).click();
    await targets.getByRole('button', { name: names[1]!.trim() }).click();
    await expect(targets).toContainText('2 of 5');
    await record.click();
    const card = sheet.getByRole('region', { name: `Survey: ${question}` });
    await expect(card).toContainText('Completed');
    await expect(card).toContainText('2 of 2 answered');
    // A snapshot is a recorded position, not an answer; it says so rather than inventing one.
    await expect(card).toContainText('Recorded position only: no one answered.');
    await quiet(page);
    await expectNoAxeViolations(page, 'ask, a survey');
    expect(problems).toEqual([]);
  });

  test('on a phone it is a sheet from the bottom that fits, can be used with a thumb, and gives focus back', async ({
    browser,
  }) => {
    const context = await browser.newContext({ ...PHONE, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const problems = watchPage(page);
    const sheet = await openAsk(page);
    const box = await sheet.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(391);
    expect(box!.y + box!.height).toBeLessThanOrEqual(845);
    // A reply has controls of its own (how far it rests on the evidence): it is held to the same measure as the rest.
    await sheet
      .getByRole('textbox', { name: 'Question for the analyst' })
      .fill('What are the limits of this report?');
    await sheet.getByRole('button', { name: 'Look up evidence' }).click();
    // The conversation is kept on the server, so the reply that was just asked for is the last one.
    await expect(
      sheet
        .getByRole('log', { name: 'Messages' })
        .getByRole('button', { name: /^No citation/u })
        .last(),
    ).toBeVisible();
    for (const tab of ['Analyst', 'Actors', 'Survey']) {
      await sheet.getByRole('tab', { name: new RegExp(`^${tab}`, 'u') }).click();
      await expectNoHorizontalOverflow(page);
      await expectReadableText(page, `phone: ask, ${tab}`);
      await expectPressable(page, `phone: ask, ${tab}`, { min: 44, scope: '[role="dialog"]' });
    }
    await quiet(page);
    await expectNoAxeViolations(page, 'phone: ask');
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole('button', { name: 'Ask about this' })).toBeFocused();
    expect(problems).toEqual([]);
    await context.close();
  });
});

// ---------------------------------------------------------------------------------------------

test.describe('on a phone', () => {
  test('the settings menu, the audit log and the provider details fit and can be used with a thumb', async ({
    browser,
  }) => {
    const context = await browser.newContext({ ...PHONE, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const problems = watchPage(page);
    await openApp(page, { project: lab, scene: 'decide' });

    const menu = await openSettings(page);
    await expectPressable(page, 'phone: the settings menu', { min: 44, scope: '[role="menu"]' });
    await expectNoHorizontalOverflow(page);
    await menu.getByRole('menuitem', { name: 'Audit log' }).click();
    const audit = page.getByRole('dialog', { name: 'Audit log' });
    await expect(audit.getByRole('heading', { level: 4 }).first()).toBeVisible();
    await audit.getByRole('button', { name: 'Verify integrity' }).click();
    await expect(audit.getByRole('region', { name: 'Integrity of the log' })).toContainText(
      'Chain intact',
    );
    await expectNoHorizontalOverflow(page);
    await expectReadableText(page, 'phone: the audit log');
    await expectPressable(page, 'phone: the audit log', { min: 44, scope: '[role="dialog"]' });
    await quiet(page);
    await expectNoAxeViolations(page, 'phone: the audit log');
    await audit.getByRole('button', { name: 'Close' }).click();
    await expect(audit).toBeHidden();
    await expect(settingsButton(page)).toBeFocused();

    await page.getByRole('button', { name: /^Local rules/u }).click();
    const provider = page.getByRole('dialog', { name: 'Model provider' });
    await expect(provider).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectReadableText(page, 'phone: the provider details');
    await expectPressable(page, 'phone: the provider details', {
      min: 44,
      scope: '[role="dialog"]',
    });
    await quiet(page);
    await expectNoAxeViolations(page, 'phone: the provider details');
    expect(problems).toEqual([]);
    await context.close();
  });
});

// ---------------------------------------------------------------------------------------------

test.describe('the audit log', () => {
  const auditOf = async (page: Page) => {
    await openApp(page, { project: lab, scene: 'decide' });
    await (await openSettings(page)).getByRole('menuitem', { name: 'Audit log' }).click();
    const dialog = page.getByRole('dialog', { name: 'Audit log' });
    await expect(dialog).toBeVisible();
    return dialog;
  };

  test('lists what was done with plain titles, newest first, and can be searched and filtered', async ({
    page,
  }) => {
    const problems = watchPage(page);
    // A snapshot download is recorded, so that the log holds two kinds of thing and offers to be read by kind.
    expect((await api.get(`/api/projects/${lab}/export?format=json`)).ok()).toBe(true);
    const dialog = await auditOf(page);
    const titles = dialog.getByRole('heading', { level: 4 });
    await expect(titles.first()).toBeVisible();
    expect(await titles.count()).toBeGreaterThan(3);
    const texts = await titles.allTextContents();
    expect(texts).toContain('Project created');
    // The record is the newest first: the download is the latest entry, and what created the project comes last.
    expect(texts[0]).toBe('Export downloaded');
    expect(texts.at(-1)).toBe('Project created');

    const search = dialog.getByRole('searchbox', { name: 'Search the log' });
    await search.fill('Project created');
    await expect(titles.first()).toHaveText('Project created');
    await expect.poll(() => titles.count()).toBeLessThan(texts.length);
    await search.fill('zzzz nothing is called this');
    await expect(dialog.getByRole('heading', { name: 'No match' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Clear the search' }).click();
    await expect(titles.first()).toBeVisible();

    const filters = dialog.getByRole('group', { name: 'Show' });
    const exports = filters.getByRole('button', { name: /^Exports/u });
    await exports.click();
    await expect(exports).toHaveAttribute('aria-pressed', 'true');
    await expect(titles).toHaveText(['Export downloaded']);
    await filters.getByRole('button', { name: /^All/u }).click();
    expect(await titles.count()).toBe(texts.length);
    await quiet(page);
    await expectNoAxeViolations(page, 'the audit log');
    expect(problems).toEqual([]);
  });

  test('checks the chain on the server and says it is intact, with how many entries it covered', async ({
    page,
  }) => {
    const dialog = await auditOf(page);
    await dialog.getByRole('button', { name: 'Verify integrity' }).click();
    const seal = dialog.getByRole('region', { name: 'Integrity of the log' });
    await expect(seal).toContainText('Chain intact');
    await expect(seal).toContainText(
      /\d+ entries checked across the whole log\. None was altered or removed\./u,
    );
    // It can be asked again, and says what the check is for.
    await expect(seal.getByRole('button', { name: 'Check again' })).toBeVisible();
    await dialog.getByRole('button', { name: 'How the log is protected' }).click();
    await expect(dialog).toContainText(
      'Entries hold identifiers, counts and short labels, never questions, answers or source text.',
    );
  });

  test('says where the chain breaks when it does, and never calls the entries after it verified', async ({
    page,
  }) => {
    // The break is put at the second oldest entry of this project's own log, so that one entry is before it and the
    // rest are after it.
    const listed = (await (await api.get(`/api/projects/${lab}/audit`)).json()) as {
      events: { seq: number }[];
    };
    const seqs = listed.events.map((entry) => entry.seq).sort((a, b) => a - b);
    expect(seqs.length).toBeGreaterThan(3);
    const broken = seqs[1]!;
    await page.route('**/api/audit/verify', (route) =>
      route.fulfill(json({ ok: false, checked: 1, brokenAt: broken })),
    );
    const dialog = await auditOf(page);
    await dialog.getByRole('button', { name: 'Verify integrity' }).click();
    const seal = dialog.getByRole('region', { name: 'Integrity of the log' });
    await expect(seal).toContainText('Chain broken');
    await expect(seal).toContainText(
      `Entry #${broken} does not match the one before it, after 1 entries that did.`,
    );
    await expect(seal).toContainText('The log was altered, or an entry was removed.');
    // One entry is the break; the one before it is vouched for; every later one says it cannot be.
    await expect(dialog.getByText('The chain breaks at this entry.')).toHaveCount(1);
    await expect(dialog.getByText('Verified by the chain check.')).toHaveCount(1);
    await expect(dialog.getByText('After the break, so it cannot be vouched for.')).toHaveCount(
      seqs.length - 2,
    );
    await quiet(page);
    await expectNoAxeViolations(page, 'the audit log, broken');
  });

  test('a check that cannot be made says so, and a log that cannot be read can be read again', async ({
    page,
  }) => {
    let readable = false;
    await page.route('**/api/audit/verify', (route) =>
      route.fulfill(
        json(
          {
            error: {
              code: 'FORBIDDEN',
              message: 'Only a platform administrator can verify the log.',
            },
          },
          403,
        ),
      ),
    );
    await page.route('**/api/projects/*/audit', (route) =>
      readable
        ? route.continue()
        : route.fulfill(
            json({ error: { code: 'INTERNAL', message: 'The log could not be read.' } }, 500),
          ),
    );
    const dialog = await auditOf(page);
    await expect(
      dialog.getByRole('alert').filter({ hasText: 'The audit log could not be read' }),
    ).toBeVisible();
    readable = true;
    await dialog.getByRole('button', { name: 'Retry' }).click();
    await expect(dialog.getByRole('heading', { level: 4 }).first()).toBeVisible();
    await dialog.getByRole('button', { name: 'Verify integrity' }).click();
    await expect(
      dialog.getByRole('alert').filter({ hasText: 'Integrity could not be checked' }),
    ).toContainText('Only a platform administrator can verify the log.');
  });

  test('a long log shows its newest entries and the rest on request, and says how many are shown', async ({
    page,
  }) => {
    const entries = Array.from({ length: 140 }, (_, index) => ({
      seq: index + 1,
      at: new Date(Date.now() - (140 - index) * 60_000).toISOString(),
      actor: 'local-user',
      action: 'project.exported',
      projectId: lab,
      detail: { format: 'json' },
      hash: 'a'.repeat(64),
      previousHash: 'b'.repeat(64),
    }));
    await page.route('**/api/projects/*/audit', (route) =>
      route.fulfill(json({ events: entries })),
    );
    const dialog = await auditOf(page);
    const titles = dialog.getByRole('heading', { level: 4 });
    await expect(titles.first()).toBeVisible();
    const first = await titles.count();
    expect(first).toBeLessThan(140);
    await expect(dialog).toContainText(`${first} of 140`);
    await dialog.getByRole('button', { name: 'Show older entries' }).click();
    expect(await titles.count()).toBeGreaterThan(first);
  });
});

// ---------------------------------------------------------------------------------------------

test.describe('the history', () => {
  test('a record that cannot be opened is told, with a way out, and the history is not left open over it', async ({
    page,
  }) => {
    const ghost = '00000000-0000-4000-8000-0000000000ff';
    const real = await page.request.get('/api/projects');
    const { projects, total } = (await real.json()) as { projects: unknown[]; total: number };
    await page.route('**/api/projects', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill(
            json({
              projects: [
                {
                  id: ghost,
                  name: 'A record that is gone',
                  workflow: 'guided',
                  question: 'What could happen if this record were still here?',
                  status: 'ready',
                  stage: 'knowledge',
                  progress: 25,
                  mode: 'local',
                  agentCount: 6,
                  roundCount: 4,
                  currentRound: 0,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                  error: null,
                  parentId: null,
                },
                ...projects,
              ],
              total: total + 1,
            }),
          )
        : route.continue(),
    );
    await page.route(`**/api/projects/${ghost}`, (route) =>
      route.fulfill(
        json(
          { error: { code: 'PROJECT_NOT_FOUND', message: 'That project does not exist.' } },
          404,
        ),
      ),
    );
    await openApp(page, { project: lab, scene: 'decide' });
    const dialog = await openHistory(page);
    await dialog.getByRole('button', { name: /^A record that is gone/u }).click();
    await expect(dialog).toBeHidden();
    const banner = page
      .getByRole('alert')
      .filter({ hasText: 'This exploration could not be opened' });
    await expect(banner).toBeVisible();
    await banner.getByRole('button', { name: 'Start a new question' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'See how a decision could unfold.',
    );
  });

  test('says how much of a long history it shows, and the filters narrow it and say by how much', async ({
    page,
  }) => {
    const base = Date.now();
    const rows = Array.from({ length: 12 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      name: `Listed ${index + 1}`,
      workflow: 'guided',
      question: 'What could happen next?',
      status: index % 4 === 0 ? 'failed' : index % 4 === 1 ? 'completed' : 'ready',
      stage: index % 4 === 1 ? 'complete' : 'knowledge',
      progress: index % 4 === 1 ? 100 : 25,
      mode: 'local',
      agentCount: 6,
      roundCount: 4,
      currentRound: 0,
      createdAt: new Date(base - index * 3_600_000).toISOString(),
      updatedAt: new Date(base - index * 3_600_000).toISOString(),
      error: index % 4 === 0 ? 'It stopped.' : null,
      parentId: null,
    }));
    await page.route('**/api/projects', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill(json({ projects: rows, total: 134 }))
        : route.continue(),
    );
    await openApp(page, { project: lab, scene: 'decide' });
    const dialog = await openHistory(page);
    await expect(dialog).toContainText('Showing 12 of 134 explorations');
    const filters = dialog.getByRole('group', { name: 'Show' });
    const stopped = filters.getByRole('button', { name: /^Stopped/u });
    await expect(stopped).toContainText('3');
    await stopped.click();
    await expect(dialog.getByRole('listitem')).toHaveCount(3);
    await filters.getByRole('button', { name: /^All/u }).click();
    await expect(dialog.getByRole('listitem')).toHaveCount(12);
    await quiet(page);
    await expectNoAxeViolations(page, 'the history, a long list');
  });

  // WCAG 1.4.10 asks for the page to be read at 320px without scrolling or being squeezed out of shape: an exploration's
  // name has at least 10rem there, the badge of the open one sits under it, and the actions do not take its width.
  for (const [width, height] of [
    [320, 568],
    [360, 740],
    [390, 844],
  ] as const) {
    test(`at ${width}px the open exploration keeps room for its name, and its actions are under finger`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        viewport: { width, height },
        hasTouch: true,
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      const problems = watchPage(page);
      await openApp(page, { project: lab, scene: 'decide' });
      const dialog = await openHistory(page);
      const row = dialog.locator('[aria-current="true"]');
      await expect(row).toBeVisible();
      const name = row.locator('.sw-hist__name');
      await expect(name).toContainText('Copilot in Teams');
      const nameBox = (await name.boundingBox())!;
      expect(
        nameBox.width,
        `the name has the width of the row at ${width}px`,
      ).toBeGreaterThanOrEqual(160);
      const lines = await name.evaluate((element) =>
        Math.round(
          element.getBoundingClientRect().height /
            Number.parseFloat(getComputedStyle(element).lineHeight),
        ),
      );
      expect(lines, 'the name is at most two lines').toBeLessThanOrEqual(2);
      // The badge of the open exploration is under its name, not beside it.
      const badge = (await row.getByText('Open now').boundingBox())!;
      expect(badge.y).toBeGreaterThanOrEqual(nameBox.y + nameBox.height - 1);
      // The actions have room of their own: none of them lies on the words of the row.
      const text = (await row.locator('.sw-hist__text').boundingBox())!;
      const actions = dialog
        .getByRole('listitem')
        .filter({ has: page.locator('[aria-current="true"]') })
        .getByRole('button', { name: /^(Compare|Delete) / });
      expect(await actions.count()).toBeGreaterThan(0);
      for (const action of await actions.all()) {
        const box = (await action.boundingBox())!;
        const across = Math.min(text.x + text.width, box.x + box.width) - Math.max(text.x, box.x);
        const down = Math.min(text.y + text.height, box.y + box.height) - Math.max(text.y, box.y);
        expect(across > 1 && down > 1, 'an action lies on the words of its row').toBe(false);
      }
      await expectNoHorizontalOverflow(page);
      await expectPressable(page, `phone ${width}px: the history`, {
        min: 44,
        scope: '[role="dialog"]',
      });
      await quiet(page);
      await expectNoAxeViolations(page, `phone ${width}px: the history`);
      expect(problems).toEqual([]);
      await context.close();
    });
  }
});
