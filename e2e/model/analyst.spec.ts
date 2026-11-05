import { expect, test, type APIRequestContext } from '@playwright/test';
import { openApp } from '../support/app';
import { viewports } from '../support/helpers';
import { LIBRARY, deleteMade, expectSound, makeProject, runStep } from '../support/ground-map';

// What a person is told about the model behind a project, through the real page, on a server whose model is the fake
// provider (e2e/support/fake-provider.ts): the badge and its panel, which say what is real and verify with one round
// trip, and the analyst, which abstains where the project cannot answer and says how well it answered where it can.
// What the fake writes is a protocol-faithful stand-in, so what is checked here is what the server and the page do with it.

test.use({ actionTimeout: 15_000, reducedMotion: 'reduce' });
test.afterEach(({ request }) => deleteMade(request));

const providerUrl = `http://127.0.0.1:${process.env.E2E_PROVIDER_PORT || 11999}`;
const BADGE = /^REAL MODEL · Ollama \(local\)/u;
const ABSTENTION = 'The available project evidence does not support a confident answer.';

test.beforeEach(async ({ playwright }) => {
  const provider = await playwright.request.newContext({ baseURL: providerUrl });
  await provider.post('/__reset');
  await provider.post('/__control', { data: { latencyMs: 0 } });
  await provider.dispose();
});

for (const viewport of viewports) {
  test.describe(`the provider panel at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('states what is real, agrees with the badge, and verifies with one real round trip', async ({
      page,
      request,
    }) => {
      // A real request has already succeeded by the time a project is read, so that the badge and the panel agree that
      // the provider is connected, and neither repeats a stale "not yet verified".
      await makeProject(request, LIBRARY, 'ground', { mode: 'llm', agents: 4, rounds: 3 });
      await openApp(page);
      const badge = page.getByRole('button', { name: BADGE });
      await expect(badge).toBeVisible();
      await expect(badge).toContainText('connected');
      await badge.click();
      const panel = page.getByRole('dialog', { name: 'Model provider' });
      await expect(panel).toContainText(
        'Projects created in Model assisted mode send bounded context',
      );
      await expect(panel).toContainText('Connected');
      await expect(panel).not.toContainText('not yet verified');
      await expect(panel).not.toContainText('Configured is not a connectivity check');
      await expectSound(page, 'provider panel');

      await panel.getByRole('button', { name: 'Verify connection' }).click();
      await expect(panel).toContainText('Connection verified: the provider was reached');
      await expect(panel).toContainText('Connected');
      await expectSound(page, 'provider panel after verification');
    });
  });
}

test.describe('the analyst', () => {
  /** A project read by the model and taken through the report, so that the analyst has a report and its evidence to answer from. */
  async function reportOf(request: APIRequestContext): Promise<string> {
    const id = await makeProject(request, LIBRARY, 'ground', {
      mode: 'llm',
      agents: 4,
      rounds: 3,
    });
    for (const step of ['environment', 'simulation', 'report'] as const) {
      await runStep(request, id, step);
    }
    return id;
  }

  test('abstains when the project cannot answer, and labels how well it answered', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const id = await reportOf(request);
    await openApp(page, { project: id, scene: 'ground' });
    await page.getByRole('button', { name: 'Ask about this' }).click();
    const panel = page.getByRole('dialog');
    const messages = panel.getByRole('region', { name: 'Conversation with The analyst' });
    const box = panel.getByRole('textbox', { name: 'Question for the analyst' });

    await box.fill('What is the capital of France?');
    await box.press('Enter');
    await expect(messages).toContainText(ABSTENTION);
    await expect(messages).toContainText('Not enough evidence to answer');
    await expect(messages).toContainText('Not found in the project');

    await box.fill('What does the Library Service propose about weekday hours?');
    await box.press('Enter');
    await expect(messages).toContainText('Cited from project evidence');
    await expectSound(page, 'the analyst with its notes');
  });
});
