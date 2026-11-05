import { expect, test, type APIRequestContext, type PlaywrightWorkerArgs } from '@playwright/test';
import { expectScene } from '../support/app';
import { chooseStarter } from '../support/ask';
import { stakeholdersViewOf } from '../support/ground-map';
import { apiContext, watchPage } from '../support/helpers';

// What a person is told, and what the server keeps, when the model is asked for the participants and cannot be used:
// the page stops and says what failed instead of handing over a list that rules made in its place, offers the three ways
// on, and, when rules are chosen, calls the list the rules fallback wherever it is shown. The model here is the fake
// provider (e2e/support/fake-provider.ts), which answers a request it has no kind for with a 400: a provider that
// cannot be used for this step. It is evidence about the server and the page, and about no real model.

const providerUrl = `http://127.0.0.1:${process.env.E2E_PROVIDER_PORT || 11999}`;

async function provider(playwright: PlaywrightWorkerArgs['playwright']) {
  const request: APIRequestContext = await playwright.request.newContext({ baseURL: providerUrl });
  return { reset: async () => void (await request.post('/__reset')) };
}

test.describe('the participants when the model could not be used (fake provider, not a live model)', () => {
  test.setTimeout(300_000);
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

  test('stops with what failed and three ways on, keeps nothing, and labels what rules then make as the rules fallback', async ({
    page,
    playwright,
  }) => {
    const problems = watchPage(page);
    const fake = await provider(playwright);
    await fake.reset();
    const api = await apiContext(playwright);
    await page.goto('/');

    await test.step('a model-assisted project is read, and the Map is open on "Who is in play?"', async () => {
      await page.getByRole('button', { name: 'Options' }).click();
      const options = page.getByRole('dialog', { name: 'Options' });
      await options.getByRole('radio', { name: 'Model assisted' }).click();
      await page.keyboard.press('Escape');
      await chooseStarter(page);
      await page.getByRole('button', { name: 'Explore', exact: true }).click();
      await page.getByRole('button', { name: 'Ground it', exact: true }).click();
      await page.getByRole('button', { name: 'Map the stakeholders' }).first().click({
        timeout: 120_000,
      });
      await expectScene(page, 'map');
    });
    const id = new URL(page.url()).searchParams.get('project')!;

    await test.step('asking the model for the participants stops: it says what failed and keeps nothing', async () => {
      await page.getByRole('button', { name: 'Find who is affected' }).click();
      const stopped = page
        .getByRole('alert')
        .filter({ hasText: 'The model could not propose the participants' });
      await expect(stopped).toBeVisible({ timeout: 90_000 });
      await expect(stopped).toContainText('Nothing was made: there are no participants yet.');
      await expect(stopped).toContainText('Participants from the rules fallback');
      for (const name of ['Retry with the model', 'Edit participants', 'Continue with rules']) {
        await expect(stopped.getByRole('button', { name })).toBeEnabled();
      }
      // No list stands in the model's place: the server holds nothing, and the page has no map.
      expect((await stakeholdersViewOf(api, id)).stakeholders).toBeNull();
      await expect(page.getByRole('button', { name: 'Find who is affected' })).toBeVisible();
    });

    await test.step('retrying asks the model again, and it is the same story while the model cannot be used', async () => {
      await page.getByRole('button', { name: 'Retry with the model' }).click();
      await expect(
        page.getByRole('alert').filter({ hasText: 'The model could not propose the participants' }),
      ).toBeVisible({ timeout: 90_000 });
      expect((await stakeholdersViewOf(api, id)).stakeholders).toBeNull();
    });

    await test.step('continuing with rules makes the list, and says on the Map that it is the rules fallback', async () => {
      await page.getByRole('button', { name: 'Continue with rules' }).click();
      await expect(
        page.getByRole('status').filter({ hasText: 'Swarm proposed these participants' }),
      ).toBeVisible({ timeout: 60_000 });
      await expect(page.getByRole('button', { name: 'Rules fallback' })).toBeVisible();
      const notice = page
        .getByRole('status')
        .filter({ hasText: 'Participants from the rules fallback' });
      await expect(notice).toContainText('no model proposed these');
      await expect(page.getByText('Found by a model')).toHaveCount(0);

      const view = await stakeholdersViewOf(api, id);
      expect(view.stakeholders?.discovery).toMatchObject({ mode: 'rules', model: null });
      expect(view.stakeholders?.discovery.note).toMatch(/^Participants from the rules fallback\./u);
      expect(view.stakeholders?.proposal).toMatchObject({ source: 'rules', model: null });
      expect(view.stakeholders?.proposal?.failure?.code).toMatch(/^MODEL_/u);
      expect(view.stakeholders?.proposal?.failure?.detail).toContain('so rules were used');
    });

    await test.step('the review says the same, and does not say that no model was asked', async () => {
      await page
        .getByRole('status')
        .filter({ hasText: 'Swarm proposed these participants' })
        .getByRole('button', { name: 'Review participants' })
        .click();
      await expect(
        page.getByRole('heading', { level: 2, name: 'Review the proposed participants' }),
      ).toBeVisible();
      await expect(
        page.locator('section.sw-prv').getByRole('status').filter({ hasText: 'rules fallback' }),
      ).toContainText('no model proposed these participants');
    });

    expect(problems).toEqual([]);
  });
});
