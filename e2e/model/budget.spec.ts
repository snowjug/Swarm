import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import {
  advance,
  apiContext,
  createGuided,
  expectNoAxeViolations,
  expectNoBrowserPaintedControls,
  expectNoHorizontalOverflow,
  getProject,
  watchPage,
} from '../support/helpers';

// The model budget of a project, in a real browser, against the protocol-faithful fake of the provider
// (e2e/support/fake-provider.ts). A project that has used what it may goes no further: the stage that
// needed the model stops with a message that says why, the page says so before anyone asks, and a person
// with the standing to do it lifts the limit and carries on. The fake says nothing about a live model.

const providerUrl = `http://127.0.0.1:${process.env.E2E_PROVIDER_PORT || 11999}`;
const THEMES = ['light', 'dark', 'high-contrast'] as const;

test.use({ actionTimeout: 30_000 });
test.describe.configure({ mode: 'serial' });

async function resetProvider(playwright: Parameters<typeof apiContext>[0]): Promise<void> {
  const fake = await playwright.request.newContext({ baseURL: providerUrl });
  await fake.post('/__reset');
  await fake.post('/__control', { data: { latencyMs: 0 } });
  await fake.dispose();
}

/** A model-assisted project that has not begun, with room for one model call and no more. */
async function limitedProject(
  api: APIRequestContext,
  playwright: Parameters<typeof apiContext>[0],
): Promise<string> {
  await resetProvider(playwright);
  const id = await createGuided(api, {
    name: 'Budget: model project',
    mode: 'llm',
    agents: 4,
    rounds: 3,
  });
  const response = await api.put(`/api/projects/${id}/budget`, {
    data: { callLimit: 1, tokenLimit: null },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return id;
}

async function stopAtTheBudget(api: APIRequestContext, id: string): Promise<void> {
  const started = await api.post(`/api/projects/${id}/steps/knowledge`);
  expect(started.status(), await started.text()).toBe(202);
  await expect
    .poll(async () => (await getProject(api, id)).console?.steps.knowledge, {
      timeout: 90_000,
      intervals: [100, 250, 500],
    })
    .toBe('failed');
}

const dialogOf = (page: Page) => page.getByRole('dialog', { name: 'Model budget' });

/** The notice with this title. The stage's own error repeats the words, so they are not what finds it. */
const noticeTitled = (page: Page, title: string, within?: Locator) =>
  (within ?? page).locator('.notice', { has: page.locator('strong', { hasText: title }) });

test('a project that has used its budget says so, and a person who may lifts the limit and carries on', async ({
  page,
  playwright,
}) => {
  test.setTimeout(5 * 60_000);
  const problems = watchPage(page);
  const api = await apiContext(playwright);
  const id = await limitedProject(api, playwright);

  await test.step('the stage that needs a second model call stops at the budget, with the reason, and sends no more', async () => {
    await stopAtTheBudget(api, id);
    const project = await getProject(api, id);
    expect(project.status).toBe('failed');
    expect(project.execution?.modelCalls).toBe(1);
    const budget = (await (await api.get(`/api/projects/${id}/budget`)).json()).budget;
    expect(budget).toMatchObject({
      calls: 1,
      callLimit: 1,
      state: 'exhausted',
      may: { edit: true },
    });
    const audit = (await (await api.get(`/api/projects/${id}/audit`)).json()).events as {
      action: string;
      detail: Record<string, unknown>;
    }[];
    expect(audit.filter((entry) => entry.action === 'model.budget.exhausted')).toHaveLength(1);
    expect(audit.find((entry) => entry.action === 'project.budget.changed')?.detail).toEqual({
      callLimit: 1,
      tokenLimit: null,
    });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?project=${id}`);

  await test.step('the page says it before anyone asks, in words, and gives the reason the stage failed', async () => {
    const warning = noticeTitled(page, 'This project has used its model budget');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('model calls: 1 of 1');
    await expect(warning).toContainText('Reading, editing and exporting are not affected');
    await expect(warning).toContainText('You can raise the limit in the model budget.');
    await expect(noticeTitled(page, 'Recorded execution error')).toContainText(
      'used its model budget (1 of 1 model calls)',
    );
    await expect(page.getByRole('button', { name: 'Model budget · used up' })).toBeVisible();
  });

  await test.step('the dialog shows what was used against the limit, as words and as a meter', async () => {
    await page.getByRole('button', { name: 'Model budget · used up' }).first().click();
    const dialog = dialogOf(page);
    await expect(dialog).toBeVisible();
    const calls = dialog.getByRole('meter', { name: 'Model calls' });
    await expect(calls).toHaveAttribute('aria-valuenow', '1');
    await expect(calls).toHaveAttribute('aria-valuemax', '1');
    await expect(calls).toHaveAttribute('aria-valuetext', '1 of 1');
    await expect(dialog).toContainText('Used up');
    await expect(dialog).toContainText('Set for this project');
    await expectNoAxeViolations(page, 'model budget dialog, used up');
    await expectNoHorizontalOverflow(page);
  });

  await test.step('a limit that is not a number is refused in the form, and nothing is sent', async () => {
    const dialog = dialogOf(page);
    await dialog.getByLabel('Model call limit').fill('lots');
    await dialog.getByRole('button', { name: 'Save the limits' }).click();
    await expect(noticeTitled(page, 'The limits were not saved', dialog)).toContainText(
      'Model call limit: Use a whole number',
    );
    expect((await getProject(api, id)).status).toBe('failed');
    const budget = (await (await api.get(`/api/projects/${id}/budget`)).json()).budget;
    expect(budget.callLimit).toBe(1);
  });

  await test.step('lifting the limit is saved, shown, recorded, and clears the warning', async () => {
    const dialog = dialogOf(page);
    await dialog.getByLabel('Model call limit').fill('0');
    await dialog.getByRole('button', { name: 'Save the limits' }).click();
    await expect(dialog).toContainText('The limits were saved');
    await expect(dialog.getByRole('meter', { name: 'Model calls' })).toHaveAttribute(
      'aria-valuetext',
      '1, no limit',
    );
    await expect(dialog).toContainText('Lifted for this project');
    await expectNoAxeViolations(page, 'model budget dialog, lifted');
    const audit = (await (await api.get(`/api/projects/${id}/audit`)).json()).events as {
      action: string;
      detail: Record<string, unknown>;
    }[];
    expect(
      audit.filter((entry) => entry.action === 'project.budget.changed').at(-1)?.detail,
    ).toEqual({
      callLimit: 0,
      tokenLimit: null,
    });
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    await expect(dialogOf(page)).toHaveCount(0);
    await expect(noticeTitled(page, 'This project has used its model budget')).toHaveCount(0);
  });

  await test.step('the stage that was stopped runs again and finishes, and the budget does not start over', async () => {
    await advance(api, id, 'knowledge');
    const budget = (await (await api.get(`/api/projects/${id}/budget`)).json()).budget;
    expect(budget.calls).toBeGreaterThan(1);
    expect(budget.state).toBe('none');
  });

  expect(problems.filter((problem) => !problem.startsWith('console'))).toEqual([]);
  await api.dispose();
});

test('a project that is running low is told so before it runs out, and one that is not is left alone', async ({
  page,
  playwright,
}) => {
  test.setTimeout(5 * 60_000);
  const problems = watchPage(page);
  const api = await apiContext(playwright);
  await resetProvider(playwright);
  const id = await createGuided(api, {
    name: 'Budget: running low',
    mode: 'llm',
    agents: 4,
    rounds: 3,
  });
  await advance(api, id, 'knowledge');
  const budget = async () =>
    (await (await api.get(`/api/projects/${id}/budget`)).json()).budget as {
      calls: number;
      inputTokens: number;
      outputTokens: number;
      state: string;
    };
  const before = await budget();
  const used = before.inputTokens + before.outputTokens;
  expect(before.calls).toBeGreaterThan(0);
  expect(used).toBeGreaterThan(10);
  expect(before.state).toBe('none');

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?project=${id}`);
  await expect(page.getByRole('button', { name: 'Model budget', exact: true })).toBeVisible();
  await expect(noticeTitled(page, 'model budget')).toHaveCount(0);

  // A token limit just above what has been used, so that the project is at about 85% of it: low, not out.
  const limit = Math.ceil(used / 0.85);
  const response = await api.put(`/api/projects/${id}/budget`, {
    data: { callLimit: null, tokenLimit: limit },
  });
  expect(response.ok(), await response.text()).toBe(true);
  expect((await budget()).state).toBe('warning');
  await page.reload();
  const warning = noticeTitled(page, 'This project is running low on its model budget');
  await expect(warning).toBeVisible();
  await expect(warning).toContainText(
    `tokens: ${used.toLocaleString('en-GB')} of ${limit.toLocaleString('en-GB')}`,
  );
  await expect(page.getByRole('button', { name: 'Model budget · running low' })).toBeVisible();
  // Running low is not out: the project is still allowed to use the model.
  await expect(noticeTitled(page, 'This project has used its model budget')).toHaveCount(0);
  expect(problems.filter((problem) => !problem.startsWith('console'))).toEqual([]);
  await api.dispose();
});
for (const theme of THEMES) {
  test(`the model budget dialog is readable in the ${theme} theme, and on a phone`, async ({
    page,
    playwright,
  }) => {
    test.setTimeout(5 * 60_000);
    const problems = watchPage(page);
    const api = await apiContext(playwright);
    const id = await limitedProject(api, playwright);
    await stopAtTheBudget(api, id);
    await page.addInitScript((value) => window.localStorage.setItem('swarm.theme', value), theme);
    for (const viewport of [
      { width: 1360, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(`/?project=${id}`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.getByRole('button', { name: 'Model budget · used up' }).first().click();
      const dialog = dialogOf(page);
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Save the limits' })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page, `${theme} ${viewport.width}px: model budget dialog`);
      if (theme !== 'light') {
        await expectNoBrowserPaintedControls(page, `${theme}: model budget dialog`);
      }
    }
    expect(problems.filter((problem) => !problem.startsWith('console'))).toEqual([]);
    await api.dispose();
  });
}
