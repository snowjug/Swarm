import { expect, test, type PlaywrightWorkerArgs } from '@playwright/test';
import { watchPage } from '../support/helpers';
import {
  HARBOUR_NOTES,
  bar,
  exploreButton,
  goOn,
  openAsk,
  optionsButton,
  pasteSource,
  questionBox,
  reviewHeading,
} from '../support/ask';

// Where a person's question goes when they ask Swarm to read it into a scenario. The server in this
// project has a model provider configured (a protocol-faithful fake, never a live model), so the only
// thing that decides whether the question is sent to it is the engine the person chose in the options:
// Local rules never ask the provider, and Model assisted asks it once. The unit tests hold the server
// and the client to this separately; this is the page, as a person uses it, with the provider watching.

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

test.describe('a question is read by a model only when the person chose Model assisted', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  /** Presses Explore and returns what the page sent to be read, and what came back. */
  const explore = async (page: import('@playwright/test').Page) => {
    const [exchange] = await Promise.all([
      page.waitForResponse(
        (response) => new URL(response.url()).pathname === '/api/scenario/parse',
      ),
      exploreButton(page).click(),
    ]);
    await expect(reviewHeading(page)).toBeVisible();
    await expect(goOn(page)).toBeVisible();
    return {
      sent: exchange.request().postDataJSON() as Sent,
      answer: (await exchange.json()) as { mode: string; model: string | null },
    };
  };

  const choose = async (page: import('@playwright/test').Page, engine: RegExp) => {
    await optionsButton(page).click();
    const options = page.getByRole('dialog', { name: 'Options' });
    await options.getByRole('radio', { name: engine }).click();
    return options;
  };

  test('Local rules: the request says that no model is used, the provider is never asked, and the page says rules read it', async ({
    page,
    playwright,
  }) => {
    const problems = watchPage(page);
    const fake = await provider(playwright);
    await fake.reset();
    await openAsk(page);

    // A provider is configured, so the other choice is on offer; the person has not taken it.
    await optionsButton(page).click();
    const options = page.getByRole('dialog', { name: 'Options' });
    await expect(options.getByRole('radio', { name: /Model assisted/u })).toBeEnabled();
    await expect(options.getByRole('radio', { name: /Local rules/u })).toBeChecked();
    await expect(options).toContainText('Rules run on this machine. Nothing is sent anywhere.');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('main').getByText('Model assisted', { exact: true })).toHaveCount(0);

    await questionBox(page).fill(QUESTION);
    await pasteSource(page, HARBOUR_NOTES.name, HARBOUR_NOTES.content);
    const { sent, answer } = await explore(page);
    expect(sent.useModel).toBe(false);
    expect(sent.question).toBe(QUESTION);
    expect(answer).toMatchObject({ mode: 'rules', model: null });
    await expect(page.getByText('Read by rules, not a model', { exact: true })).toBeVisible();
    await expect(page.getByText('Read by a model')).toHaveCount(0);

    // Nothing reached the provider: not a call it answered, and not a request it did not recognise.
    expect(await fake.stats()).toMatchObject({ calls: 0, requests: 0 });
    expect(problems).toEqual([]);
  });

  test('Model assisted: the options say where the question goes, the same press sends useModel true, the provider is asked once, and the page says a model read it', async ({
    page,
    playwright,
  }) => {
    const problems = watchPage(page);
    const fake = await provider(playwright);
    await fake.reset();
    await openAsk(page);
    await questionBox(page).fill(QUESTION);
    await pasteSource(page, HARBOUR_NOTES.name, HARBOUR_NOTES.content);

    // Choosing the model is the moment the person is told what it means; nothing has been sent yet.
    const options = await choose(page, /Model assisted/u);
    await expect(options.getByRole('radio', { name: /Model assisted/u })).toBeChecked();
    await expect(options).toContainText('fake-model');
    await expect(options).toContainText(
      'Your question and evidence context are sent to this provider.',
    );
    expect(await fake.stats()).toMatchObject({ calls: 0, requests: 0 });
    await page.keyboard.press('Escape');
    // With the options closed, the way forward still says that pressing it asks a model.
    await expect(page.getByRole('main').getByText('Model assisted', { exact: true })).toBeVisible();

    const { sent, answer } = await explore(page);
    expect(sent.useModel).toBe(true);
    expect(answer).toMatchObject({ mode: 'model', model: 'fake-model' });
    await expect(page.getByText('Read by a model · fake-model', { exact: true })).toBeVisible();

    const stats = await fake.stats();
    expect(stats.byKind.scenario).toBe(1);
    expect(stats.requests).toBe(stats.calls);
    expect(stats.requests).toBeGreaterThanOrEqual(1);
    expect(problems).toEqual([]);
  });

  test('changing the engine changes where the next reading goes: back to Local rules the provider is not asked again, and the model’s reading is not passed off as the rules’', async ({
    page,
    playwright,
  }) => {
    const fake = await provider(playwright);
    await fake.reset();
    await openAsk(page);
    await questionBox(page).fill(QUESTION);
    await pasteSource(page, HARBOUR_NOTES.name, HARBOUR_NOTES.content);

    await choose(page, /Model assisted/u);
    await page.keyboard.press('Escape');
    expect((await explore(page)).sent.useModel).toBe(true);
    const asked = (await fake.stats()).requests;
    expect(asked).toBeGreaterThanOrEqual(1);

    // The question is taken back, the engine is changed, and the same question is read again by the other.
    await bar(page).getByRole('button', { name: 'Question' }).click();
    await expect(questionBox(page)).toHaveValue(QUESTION);
    await choose(page, /Local rules/u);
    await page.keyboard.press('Escape');
    const again = await explore(page);
    expect(again.sent.useModel).toBe(false);
    expect(again.answer).toMatchObject({ mode: 'rules', model: null });
    await expect(page.getByText('Read by rules, not a model', { exact: true })).toBeVisible();
    expect((await fake.stats()).requests, 'the provider was not asked again').toBe(asked);

    // And the other way: the person who goes back to the model gets a reading by it.
    await bar(page).getByRole('button', { name: 'Question' }).click();
    await choose(page, /Model assisted/u);
    await page.keyboard.press('Escape');
    expect((await explore(page)).sent.useModel).toBe(true);
    expect((await fake.stats()).requests).toBeGreaterThan(asked);
  });
});
