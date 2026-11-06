import { expect, test, type Browser, type Page, type PlaywrightWorkerArgs } from '@playwright/test';
import { watchPage } from '../support/helpers';
import {
  control,
  fakeGoogle,
  fromMenu,
  signUp,
  type Control,
  type Person,
} from '../support/public';

// People who are not the person of the journey: a visitor who has no account, two people at once (one of them the site's
// administrator), and what one can reach of the other's. Each is a browser of their own, with the fake Google.

const NOTES =
  'Illustrative notes written for a test. The transit office plans to move the night bus route to a new corridor next spring, and residents of the old corridor ask for a public hearing before the council decides.';

/** A browser of their own, signed in as this person once the page is asked to. */
async function person(browser: Browser, fake: Control, who: Person) {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL as string,
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await fakeGoogle(context, fake, { current: who });
  return { context, page, problems: watchPage(page, { refusals: true }) };
}

const open = (playwright: PlaywrightWorkerArgs['playwright']) => control(playwright);

test.describe('people of the public edition (fake Google)', () => {
  test.setTimeout(240_000);
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

  test('a visitor with no account reads what the site is, what it costs, whether it is private, how it is doing, and its terms', async ({
    page,
  }) => {
    const problems = watchPage(page, { refusals: true });
    await page.goto('/');
    await expect(page.getByTestId('landing')).toBeVisible();
    await expect(page.getByTestId('try-it-free')).toBeVisible();

    await page.goto('/faq');
    const faq = page.getByTestId('faq');
    for (const question of ['What does it cost?', 'Is my key safe?', 'Is my data private?']) {
      await expect(faq.getByRole('button', { name: question })).toBeVisible();
    }
    await faq.getByRole('button', { name: 'Is my key safe?' }).click();
    await expect(faq).toContainText('Use a key with a spend limit');

    await page.goto('/status');
    await expect(page.getByTestId('status-page')).toHaveAttribute('data-status', 'ok');
    await expect(page.getByTestId('status-free-tier')).toBeVisible();

    await page.goto('/legal/terms');
    await expect(page.getByTestId('legal-page')).toHaveAttribute('data-doc', 'terms');
    // The owner has not written the terms yet, and the page says so in as many words.
    await expect(page.getByTestId('legal-unreviewed')).toBeVisible();

    // Nothing of any account is reachable with no session.
    for (const path of ['/api/account', '/api/projects', '/api/usage', '/api/admin/usage']) {
      expect((await page.request.get(path)).status(), path).toBe(401);
    }
    expect(problems).toEqual([]);
  });

  test('the administrator turns the free tier off for everyone, a person is told at once what to do, and it comes back on', async ({
    browser,
    playwright,
  }) => {
    const fake = await open(playwright);
    const admin = await person(browser, fake, { sub: 'g-e2e-admin', email: 'admin@example.com' });
    const bob = await person(browser, fake, { sub: 'g-e2e-bob', email: 'bob@example.com' });
    try {
      await signUp(bob.page);
      await expect(bob.page.getByTestId('usage-meter')).toHaveAttribute('data-usage', 'free');

      await signUp(admin.page);
      await admin.page.goto('/admin');
      await expect(admin.page.getByTestId('admin-page')).toBeVisible();
      await admin.page.getByTestId('admin-free-tier').click();
      await expect(admin.page.getByText('Free tier is off')).toBeVisible();

      // The person's page learns it on its next look, and says what the free tier's state means for them.
      await bob.page.reload();
      await expect(bob.page.getByTestId('usage-meter')).toHaveAttribute('data-usage', 'limit');
      await expect(bob.page.getByTestId('usage-meter')).toHaveAttribute('data-reason', 'disabled');
      const status = await (await bob.page.request.get('/api/public/status')).json();
      expect(status.freeTier).toMatchObject({ available: false, reason: 'disabled' });

      await admin.page.getByTestId('admin-free-tier').click();
      await expect(admin.page.getByText('Free tier is on')).toBeVisible();
      await bob.page.reload();
      await expect(bob.page.getByTestId('usage-meter')).toHaveAttribute('data-usage', 'free');

      // A person who is not an administrator is not shown the page, and the server refuses what it would do.
      await bob.page.goto('/admin');
      await expect(bob.page.getByTestId('admin-denied')).toBeVisible();
      expect((await bob.page.request.get('/api/admin/usage')).status()).toBe(403);
      expect(
        (
          await bob.page.request.post('/api/admin/free-tier', {
            headers: { 'x-swarm-csrf': '1' },
            data: { enabled: false },
          })
        ).status(),
      ).toBe(403);
      expect(admin.problems).toEqual([]);
      expect(bob.problems).toEqual([]);
    } finally {
      await admin.context.close();
      await bob.context.close();
      await fake.dispose();
    }
  });

  test('one person cannot reach another’s project by its address, by the list or by the API, and signing out ends the session', async ({
    browser,
    playwright,
  }) => {
    const fake = await open(playwright);
    const alice = await person(browser, fake, {
      sub: 'g-e2e-iso-a',
      email: 'iso-alice@example.com',
    });
    const carol = await person(browser, fake, {
      sub: 'g-e2e-iso-c',
      email: 'iso-carol@example.com',
    });
    try {
      await signUp(alice.page);
      await signUp(carol.page);
      const made = await alice.page.request.post('/api/projects', {
        headers: { 'x-swarm-csrf': '1' },
        data: {
          name: 'Alice night bus canary',
          question: 'What could happen if the zebra canary route moves to a new corridor?',
          documents: [{ name: 'notes.md', content: NOTES }],
          settings: { mode: 'local', agentCount: 6, rounds: 4, seed: 42, network: 'community' },
        },
      });
      expect(made.status()).toBe(201);
      const id = ((await made.json()) as { id: string }).id;

      // Alice has it, and Carol is told it is not there, exactly as for an address that never existed.
      expect(
        ((await (await alice.page.request.get('/api/projects')).json()) as { total: number }).total,
      ).toBe(1);
      const theirs = await carol.page.request.get(`/api/projects/${id}`);
      const nowhere = await carol.page.request.get(
        '/api/projects/00000000-0000-4000-8000-000000000000',
      );
      expect(theirs.status()).toBe(404);
      expect(nowhere.status()).toBe(404);
      expect(((await theirs.json()) as { error: { code: string } }).error.code).toBe(
        ((await nowhere.json()) as { error: { code: string } }).error.code,
      );
      expect(
        ((await (await carol.page.request.get('/api/projects')).json()) as { total: number }).total,
      ).toBe(0);
      expect(
        (
          await carol.page.request.delete(`/api/projects/${id}`, {
            headers: { 'x-swarm-csrf': '1' },
          })
        ).status(),
      ).toBe(404);

      // In the page, the address shows nothing of Alice's: the same address shows Alice her own project's question, so that the
      // page can be seen to show one when it may.
      await alice.page.goto(`/?project=${id}`);
      await expect(alice.page.locator('body')).toContainText('zebra canary route', {
        timeout: 30_000,
      });
      await carol.page.goto(`/?project=${id}`);
      await expect(carol.page.getByRole('main')).toBeVisible();
      await carol.page.waitForTimeout(1_500);
      await expect(carol.page.locator('body')).not.toContainText('zebra canary');
      await expect(carol.page.locator('body')).not.toContainText('Alice night bus canary');
      await expect(alice.page.locator('body')).not.toContainText('Carol');

      // Alice signs out: the page says so, and her session is no longer one.
      await alice.page.goto('/');
      await fromMenu(alice.page, 'menu-signout');
      await expect(alice.page.getByTestId('landing-note')).toHaveAttribute(
        'data-kind',
        'signed-out',
        {
          timeout: 30_000,
        },
      );
      expect((await alice.page.request.get('/api/account')).status()).toBe(401);
      // Carol is still signed in, and Alice's project is still Alice's.
      expect((await carol.page.request.get('/api/account')).status()).toBe(200);
      expect(alice.problems).toEqual([]);
      expect(carol.problems).toEqual([]);
    } finally {
      await alice.context.close();
      await carol.context.close();
      await fake.dispose();
    }
  });
});

export type { Page };
