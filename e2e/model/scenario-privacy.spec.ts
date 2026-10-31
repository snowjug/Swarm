import { expect, test, type PlaywrightWorkerArgs } from '@playwright/test';
import { questionField, scenarioIntake } from '../support/lab';

// Where a person's question goes when they ask Swarm to read it into a scenario. The server in this
// project has a model provider configured (a protocol-faithful fake, never a live model), so the only
// thing that decides whether the question is sent to it is the project's mode: Local rules never ask
// the provider, and Model assisted asks it once. The unit tests hold the server and the client to this
// separately; this is the page, as a person uses it, with the provider watching.

const providerUrl = `http://127.0.0.1:${process.env.E2E_PROVIDER_PORT || 11999}`;

async function provider(playwright: PlaywrightWorkerArgs['playwright']) {
  const request = await playwright.request.newContext({ baseURL: providerUrl });
  return {
    reset: async () => void (await request.post('/__reset')),
    stats: async () =>
      (await (await request.get('/__stats')).json()) as {
        calls: number;
        requests: number;
        byKind: Record<string, number>;
      },
  };
}

const QUESTION =
  'What could happen if the harbour office doubles the mooring fee for visiting boats? Canary 7f3a91.';

interface Sent {
  question: string;
  useModel: boolean;
}

test.describe('a question is read by a model only when the project is Model assisted', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('Local rules: the request says that no model is used, the provider is never asked, and the page says rules read it', async ({
    page,
    playwright,
  }) => {
    const fake = await provider(playwright);
    await fake.reset();
    await page.goto('/');
    // A provider is configured, so the other choice is on offer: the person has not taken it.
    await expect(page.getByRole('radio', { name: /Model assisted/u })).toBeEnabled();
    await page.getByRole('radio', { name: /Local rules/u }).check();
    await questionField(page).fill(QUESTION);
    const intake = scenarioIntake(page);
    await expect(intake).toContainText(
      'Rules on this server read the question; it goes nowhere else.',
    );

    const [exchange] = await Promise.all([
      page.waitForResponse(
        (response) => new URL(response.url()).pathname === '/api/scenario/parse',
      ),
      intake.getByRole('button', { name: 'Understand my question' }).click(),
    ]);
    const sent = exchange.request().postDataJSON() as Sent;
    expect(sent.useModel).toBe(false);
    expect(sent.question).toBe(QUESTION);
    expect(await exchange.json()).toMatchObject({ mode: 'rules', model: null });
    await expect(intake).toContainText('Read by rules, not a model');
    await expect(intake).not.toContainText('Read by a model');

    // Nothing reached the provider: not a call it answered, and not a request it did not recognise.
    expect(await fake.stats()).toMatchObject({ calls: 0, requests: 0 });
  });

  test('Model assisted: the same click sends useModel true, the provider is asked once, and the page says a model read it', async ({
    page,
    playwright,
  }) => {
    const fake = await provider(playwright);
    await fake.reset();
    await page.goto('/');
    const model = page.getByRole('radio', { name: /Model assisted/u });
    await expect(model).toBeEnabled();
    await model.check();
    await questionField(page).fill(QUESTION);
    const intake = scenarioIntake(page);
    await expect(intake).toContainText(
      'You chose a model for this project, so your question is sent to the model provider this server uses.',
    );

    const [exchange] = await Promise.all([
      page.waitForResponse(
        (response) => new URL(response.url()).pathname === '/api/scenario/parse',
      ),
      intake.getByRole('button', { name: 'Understand my question' }).click(),
    ]);
    const sent = exchange.request().postDataJSON() as Sent;
    expect(sent.useModel).toBe(true);
    expect(await exchange.json()).toMatchObject({ mode: 'model', model: 'fake-model' });
    await expect(intake).toContainText('Read by a model');
    await expect(intake).toContainText('fake-model');

    const stats = await fake.stats();
    expect(stats.byKind.scenario).toBe(1);
    expect(stats.requests).toBe(stats.calls);
    expect(stats.requests).toBeGreaterThanOrEqual(1);
  });

  test('changing the mode changes where the next reading goes: back to Local rules, the provider is not asked again', async ({
    page,
    playwright,
  }) => {
    const fake = await provider(playwright);
    await fake.reset();
    await page.goto('/');
    await questionField(page).fill(QUESTION);
    const intake = scenarioIntake(page);
    const read = async (): Promise<Sent> => {
      const [exchange] = await Promise.all([
        page.waitForResponse(
          (response) => new URL(response.url()).pathname === '/api/scenario/parse',
        ),
        intake.getByRole('button', { name: 'Understand my question' }).click(),
      ]);
      return exchange.request().postDataJSON() as Sent;
    };

    await page.getByRole('radio', { name: /Model assisted/u }).check();
    expect((await read()).useModel).toBe(true);
    const asked = (await fake.stats()).requests;
    expect(asked).toBeGreaterThanOrEqual(1);

    // The reading is dropped, the mode is changed back, and the question is read again.
    await intake.getByRole('button', { name: 'Discard' }).click();
    await page.getByRole('radio', { name: /Local rules/u }).check();
    expect((await read()).useModel).toBe(false);
    await expect(intake).toContainText('Read by rules, not a model');
    expect((await fake.stats()).requests).toBe(asked);
  });
});
