import { expect, test, type Browser, type Page } from '@playwright/test';
import { optionsButton, pasteSource, questionBox, readScenario } from '../support/ask';
import { watchPage } from '../support/helpers';
import { control, fromMenu, storedWith, watchRequests } from '../support/public';

// The public edition in GUEST MODE, as it is deployed: no sign-in provider at all. A visitor opens the link, presses one button
// and uses the site. Real application on PostgreSQL with row security in force, serving the built page; the free tier's Azure
// deployment is a fake that never leaves the machine (backend/test/support/public-e2e-server.ts with E2E_PUBLIC_GUEST=1).

const NOTES =
  'Illustrative notes written for a test. The transit office plans to move the night bus route to a new corridor next spring, and residents of the old corridor ask for a public hearing before the change. Riders say the late service matters for shift workers.';
const QUESTION = 'What could happen if the night bus route moves to a new corridor next spring?';
const controlPort = Number(process.env.E2E_PUBLIC_GUEST_CONTROL_PORT || 3122);

/** A browser of their own: a visitor who has never been here. */
async function visitor(browser: Browser) {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL as string,
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  return { context, page, problems: watchPage(page, { refusals: true }) };
}

/** From the landing page to the application, by the one button. */
async function tryItNow(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('landing')).toBeVisible();
  await page.getByTestId('try-it-now').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'See how a decision could unfold.',
    { timeout: 30_000 },
  );
  await expect(page.getByTestId('usage-meter')).toBeVisible();
}

test.describe('the public edition for a guest (no sign-in, fake Azure)', () => {
  test.setTimeout(240_000);
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

  test('a visitor presses "Try it now", uses the free tier, and deletes their data, with no sign-in anywhere', async ({
    browser,
    playwright,
  }) => {
    const fake = await control(playwright, controlPort);
    await fake.reset();
    const { context, page, problems } = await visitor(browser);
    const requests = watchRequests(page);
    try {
      await test.step('the landing page offers one way in, and no sign-in', async () => {
        await page.goto('/');
        await expect(page.getByTestId('landing')).toBeVisible();
        await expect(page.getByTestId('try-it-now')).toBeVisible();
        await expect(page.getByTestId('guest-note')).toContainText('temporary');
        await expect(page.getByTestId('guest-note')).toContainText('24 hours');
        // No provider is configured, so there is nothing to sign in with and nothing that asks.
        await expect(page.getByTestId('signin-google')).toHaveCount(0);
        await expect(page.getByTestId('signin-github')).toHaveCount(0);
        await expect(page.getByTestId('signin-card')).toHaveCount(0);
        await expect(page.locator('body')).not.toContainText(/continue with google/iu);
        // Looking at the page made nobody: a guest exists only after the press.
        const before = await page.request.get('/api/public/session');
        expect(await before.json()).toMatchObject({
          signedIn: false,
          guestMode: true,
          guestRetentionHours: 24,
          providers: [],
        });
      });

      await test.step('one press starts a private workspace and opens the application', async () => {
        await page.getByTestId('try-it-now').click();
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(
          'See how a decision could unfold.',
          { timeout: 30_000 },
        );
        await expect(page.getByTestId('usage-meter')).toHaveAttribute('data-usage', 'free');
        const session = (await context.cookies()).find((cookie) =>
          cookie.name.endsWith('swarm_session'),
        );
        expect(session, 'a session cookie').toBeTruthy();
        expect(session).toMatchObject({ httpOnly: true, sameSite: 'Lax' });
        expect(await page.evaluate(() => document.cookie)).not.toContain('swarm_session');
        expect(await storedWith(page, session!.value)).toEqual({ session: false, local: false });
        const account = await page.request.get('/api/account');
        expect(await account.json()).toMatchObject({
          guest: true,
          provider: 'guest',
          emailMasked: 'guest',
          projects: { count: 0, limit: 10 },
        });
      });

      await test.step('a free run on the guest allowance, paid for by the site', async () => {
        await optionsButton(page).click();
        const options = page.getByRole('dialog', { name: 'Options' });
        await options.getByRole('radio', { name: /Model assisted/u }).click();
        await page.keyboard.press('Escape');
        await questionBox(page).fill(QUESTION);
        await pasteSource(page, 'notes.md', NOTES);
        await readScenario(page);
        await expect(
          page.getByText('Read by a model · gpt-4.1-mini', { exact: true }),
        ).toBeVisible();
        expect((await fake.seen()).foundry).toHaveLength(1);
        const usage = await (await page.request.get('/api/usage')).json();
        expect(usage).toMatchObject({
          funding: 'free',
          free: { today: { calls: 1, callLimit: 60, tokenLimit: 80_000 }, inFlight: { limit: 4 } },
        });
      });

      await test.step('"Delete my data" removes it at once, and the visitor can start again with nothing', async () => {
        await fromMenu(page, 'menu-account');
        await expect(page.getByTestId('account-email')).toHaveText('Guest');
        await expect(page.getByTestId('guest-reminder')).toContainText('24 hours');
        await expect(page.getByTestId('account-signout')).toHaveCount(0);
        await page.getByTestId('account-delete').click();
        // A guest is not asked to type a phrase: one confirmation.
        await expect(page.getByTestId('account-delete-confirm-input')).toHaveCount(0);
        await page.getByTestId('account-delete-confirm').click();
        await expect(page.getByTestId('landing-note')).toHaveAttribute('data-kind', 'deleted', {
          timeout: 30_000,
        });
        expect((await page.request.get('/api/account')).status()).toBe(401);
        await tryItNow(page);
        const again = await (await page.request.get('/api/account')).json();
        expect(again.projects).toEqual({ count: 0, limit: 10 });
      });

      // Nothing but this site was asked: no sign-in provider, no analytics, and no key anywhere.
      const origins = new Set(requests.map((entry) => entry.origin));
      expect([...origins]).toEqual([new URL(page.url()).origin]);
      expect(requests.some((entry) => entry.carriesKey)).toBe(false);
      expect(problems).toEqual([]);
    } finally {
      await context.close();
      await fake.dispose();
    }
  });

  test('two visitors are two private workspaces: one cannot reach the other’s project', async ({
    browser,
  }) => {
    const alice = await visitor(browser);
    const bob = await visitor(browser);
    try {
      await tryItNow(alice.page);
      await tryItNow(bob.page);
      const made = await alice.page.request.post('/api/projects', {
        headers: { 'x-swarm-csrf': '1' },
        data: {
          name: 'Guest A night bus canary',
          question: 'What could happen if the zebra canary route moves to a new corridor?',
          documents: [{ name: 'notes.md', content: NOTES }],
          settings: { mode: 'local', agentCount: 6, rounds: 4, seed: 42, network: 'community' },
        },
      });
      expect(made.status()).toBe(201);
      const id = ((await made.json()) as { id: string }).id;
      const theirs = await bob.page.request.get(`/api/projects/${id}`);
      const nowhere = await bob.page.request.get(
        '/api/projects/00000000-0000-4000-8000-000000000000',
      );
      expect(theirs.status()).toBe(404);
      expect(((await theirs.json()) as { error: { code: string } }).error.code).toBe(
        ((await nowhere.json()) as { error: { code: string } }).error.code,
      );
      expect(
        ((await (await bob.page.request.get('/api/projects')).json()) as { total: number }).total,
      ).toBe(0);
      // Alice has hers.
      expect(
        ((await (await alice.page.request.get('/api/projects')).json()) as { total: number }).total,
      ).toBe(1);
      expect(alice.problems).toEqual([]);
      expect(bob.problems).toEqual([]);
    } finally {
      await alice.context.close();
      await bob.context.close();
    }
  });
});
