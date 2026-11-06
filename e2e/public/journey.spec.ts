import { expect, test } from '@playwright/test';
import { DELETE_CONFIRMATION } from '../../shared/public';
import { E2E_KEY, E2E_KEY_MODEL } from '../../backend/test/support/public-e2e-protocol';
import {
  backToQuestion,
  optionsButton,
  pasteSource,
  questionBox,
  readScenario,
} from '../support/ask';
import { watchPage } from '../support/helpers';
import {
  control,
  fakeGoogle,
  fromMenu,
  signUp,
  storedWith,
  watchRequests,
  type Person,
} from '../support/public';

// The public edition as a stranger meets it, in a real browser, against the real application on PostgreSQL with row security
// in force. Three things are fakes, and none of them leaves the machine: Google (the browser is sent to its address and the
// test answers there), the free tier's Azure deployment, and a person's own Gemini. What the fakes say proves the path (who
// pays, where the key goes, what the page shows), and nothing about any real model or sign-in.

const NOTES =
  'Illustrative notes written for a test. The transit office plans to move the night bus route to a new corridor next spring, and residents of the old corridor ask for a public hearing before the council decides.';
const ask = (n: number) =>
  `What could happen if the night bus route moves to a new corridor next spring? Reading ${n}.`;

test.describe('the public edition in a browser (fake Google, fake Azure, fake Gemini)', () => {
  test.setTimeout(300_000);
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

  test('a person signs up, uses the free tier until it is used up, brings their own key, takes it back, and deletes the account', async ({
    page,
    context,
    playwright,
  }) => {
    const problems = watchPage(page, { refusals: true });
    const requests = watchRequests(page);
    const fake = await control(playwright);
    await fake.reset();
    const who = { current: { sub: 'g-e2e-alice', email: 'alice@example.com' } satisfies Person };
    await fakeGoogle(context, fake, who);

    await test.step('a visitor sees what this is, and signs up with Google', async () => {
      await page.goto('/');
      await expect(page.getByTestId('landing')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        'Explore what could happen next.',
      );
      await expect(page.getByTestId('faq')).toContainText('What does it cost?');
      await signUp(page);
      // The account is the person's own, and so is the workspace: nothing in it yet.
      const account = await page.request.get('/api/account');
      expect(account.status()).toBe(200);
      expect(await account.json()).toMatchObject({
        emailMasked: 'a***@example.com',
        provider: 'google',
        projects: { count: 0, limit: 10 },
      });
      // The session is a cookie the page cannot read, and it is not in the page's storage.
      const cookies = await context.cookies();
      const session = cookies.find((cookie) => cookie.name.endsWith('swarm_session'));
      expect(session, 'a session cookie').toBeTruthy();
      expect(session).toMatchObject({ httpOnly: true, sameSite: 'Lax' });
      expect(await page.evaluate(() => document.cookie)).not.toContain('swarm_session');
      expect(await storedWith(page, session!.value)).toEqual({ session: false, local: false });
      await expect(page.getByTestId('usage-meter')).toHaveAttribute('data-usage', 'free');
    });

    await test.step('a free run: a question read by the free model, which is paid for by the site and counted for the person', async () => {
      await optionsButton(page).click();
      const options = page.getByRole('dialog', { name: 'Options' });
      await options.getByRole('radio', { name: /Model assisted/u }).click();
      await page.keyboard.press('Escape');
      await questionBox(page).fill(ask(1));
      await pasteSource(page, 'notes.md', NOTES);
      await readScenario(page);
      await expect(page.getByText('Read by a model · gpt-4.1-mini', { exact: true })).toBeVisible();
      const seen = await fake.seen();
      expect(seen.foundry).toHaveLength(1);
      expect(seen.gemini).toHaveLength(0);
      const usage = await (await page.request.get('/api/usage')).json();
      expect(usage).toMatchObject({ funding: 'free', free: { today: { calls: 1, callLimit: 1 } } });
    });

    await test.step('the free tier is then used up, and the page says so and what to do, without an error', async () => {
      await expect(page.getByTestId('usage-meter')).toHaveAttribute('data-usage', 'limit');
      await backToQuestion(page).click();
      await questionBox(page).fill(ask(2));
      await readScenario(page);
      // The question is read by rules, in the words of the refusal, and the free model is not asked.
      await expect(page.getByText('Read by rules, not a model', { exact: true })).toBeVisible();
      await expect(
        page.getByText(
          'The model was not used: You have used today’s free runs. They come back at 00:00 UTC, or you can use your own key now. The rules read this question instead.',
        ),
      ).toBeVisible();
      expect((await fake.seen()).foundry).toHaveLength(1);
    });

    await test.step('bringing their own key: it is checked once, shown as its last four characters, and kept only in the tab', async () => {
      await fromMenu(page, 'menu-byok');
      const panel = page.getByTestId('byok-panel');
      await expect(panel.getByTestId('byok-notice')).toHaveText(
        'Your key is used only for your requests and is never saved. Use a key with a spend limit.',
      );
      await expect(panel.getByTestId('byok-key')).toHaveAttribute('type', 'password');
      await panel.getByTestId('byok-key').fill(E2E_KEY);
      await panel.getByTestId('byok-connect').click();
      await expect(panel.getByTestId('byok-status')).toHaveAttribute('data-status', 'valid');
      await expect(panel.getByTestId('byok-hint')).toHaveText(`…${E2E_KEY.slice(-4)}`);
      await expect(panel.getByTestId('byok-model')).toHaveValue(E2E_KEY_MODEL);
      // Nothing on the page shows the key, and it is in no storage but the tab's.
      await expect(page.locator('body')).not.toContainText(E2E_KEY);
      expect(await page.getByTestId('byok-key').inputValue()).toBe('');
      expect(await storedWith(page, E2E_KEY)).toEqual({ session: true, local: false });
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('usage-meter')).toHaveAttribute('data-usage', 'byok');
    });

    await test.step('a run on their own key: Google reads the question, the free tier is not touched, and the key goes in a header only', async () => {
      await backToQuestion(page).click();
      await questionBox(page).fill(ask(3));
      await readScenario(page);
      await expect(
        page.getByText(`Read by a model · ${E2E_KEY_MODEL}`, { exact: true }),
      ).toBeVisible();
      const seen = await fake.seen();
      expect(seen.foundry).toHaveLength(1);
      const chats = seen.gemini.filter((entry) => entry.method === 'POST');
      expect(chats.length).toBeGreaterThanOrEqual(1);
      for (const entry of seen.gemini) {
        expect(entry.host).toBe('generativelanguage.googleapis.com');
        expect(entry.authorization).toBe(`Bearer ${E2E_KEY}`);
        expect(entry.bodyHasKey).toBe(false);
      }
      // The free tier's day is what it was, and the key's calls were counted as the person's own.
      const usage = await (
        await page.request.get('/api/usage', {
          headers: { 'x-swarm-provider': 'gemini', 'x-swarm-provider-key': E2E_KEY },
        })
      ).json();
      expect(usage).toMatchObject({ funding: 'byok', free: { today: { calls: 1 } } });
      expect(usage.byok.today.calls).toBeGreaterThanOrEqual(1);
    });

    await test.step('forgetting the key: it leaves the tab and the server, and nothing falls back to the site’s credits', async () => {
      const before = (await fake.seen()).gemini.length;
      await fromMenu(page, 'menu-byok');
      const panel = page.getByTestId('byok-panel');
      await panel.getByTestId('byok-forget').click();
      await expect(panel.getByTestId('byok-status')).toHaveAttribute('data-status', 'forgotten');
      await expect(panel.getByTestId('byok-status')).toContainText(
        'the server was told to drop its copy',
      );
      await expect(panel.getByTestId('byok-hint')).toHaveCount(0);
      expect(await storedWith(page, E2E_KEY)).toEqual({ session: false, local: false });
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('usage-meter')).toHaveAttribute('data-usage', 'limit');
      await backToQuestion(page).click();
      await questionBox(page).fill(ask(4));
      await readScenario(page);
      await expect(page.getByText('Read by rules, not a model', { exact: true })).toBeVisible();
      const seen = await fake.seen();
      expect(seen.gemini).toHaveLength(before);
      expect(seen.foundry).toHaveLength(1);
    });

    await test.step('deleting the account: it asks for the exact words, deletes everything, and the session is over', async () => {
      await fromMenu(page, 'menu-account');
      await page.getByTestId('account-delete').click();
      const confirm = page.getByTestId('account-delete-confirm');
      await expect(confirm).toBeDisabled();
      await page.getByTestId('account-delete-confirm-input').fill(DELETE_CONFIRMATION);
      await expect(confirm).toBeEnabled();
      await confirm.click();
      await expect(page.getByTestId('landing-note')).toHaveAttribute('data-kind', 'deleted', {
        timeout: 30_000,
      });
      expect((await page.request.get('/api/account')).status()).toBe(401);
      expect((await page.request.get('/api/projects')).status()).toBe(401);
      // Signing up again is a new account: nothing of the old one is in it.
      await signUp(page);
      const again = await (await page.request.get('/api/account')).json();
      expect(again.projects).toEqual({ count: 0, limit: 10 });
    });

    await test.step('through all of it, the key travelled only to this site, in a header, on the requests that may use a model', async () => {
      const origins = new Set(requests.map((entry) => entry.origin));
      expect([...origins].sort()).toEqual(
        ['http://127.0.0.1:3119', 'https://accounts.google.com'].sort(),
      );
      const allowed = (entry: (typeof requests)[number]) =>
        ['POST', 'PUT', 'PATCH', 'DELETE'].includes(entry.method) ||
        (entry.method === 'GET' && ['/api/usage', '/api/provider/status'].includes(entry.path));
      expect(requests.filter((entry) => entry.carriesKey && !allowed(entry))).toEqual([]);
      expect(requests.filter((entry) => entry.carriesKey).length).toBeGreaterThan(0);
      expect(requests.filter((entry) => entry.path.includes(E2E_KEY))).toEqual([]);
    });

    await fake.dispose();
    expect(problems).toEqual([]);
  });
});
