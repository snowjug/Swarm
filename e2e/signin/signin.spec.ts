import { expect, test, type Page } from '@playwright/test';
import {
  expectNoAxeViolations,
  expectNoBrowserPaintedControls,
  expectNoHorizontalOverflow,
  expectReadableText,
  watchPage,
} from '../support/helpers';
import { microsoftSignsIn, microsoftVisits } from '../support/microsoft';
import { expectPressable, openSettings, quiet, startFromExample } from '../support/shell';
import { expectSignedIn } from '../support/signin';

// Browser sign-in with Microsoft Entra, on the real application and a test identity provider
// (backend/test/support/signin-e2e-server.ts): who is let in and who is not, what the page says when a sign-in does not
// produce a session, that nothing a script can reach holds a credential, and that a change needs the page's own header.

const visitCount = async () => (await microsoftVisits()).length;

const sessionCookie = async (page: Page) =>
  (await page.context().cookies()).find((cookie) => cookie.name === 'swarm_session');

test.use({ reducedMotion: 'reduce' });

test.describe('browser sign-in with Microsoft Entra', () => {
  test('sends a visitor to Microsoft, brings them back signed in, and leaves no token in the page', async ({
    page,
  }) => {
    await microsoftSignsIn('owner');
    await page.goto('/');
    await expectSignedIn(page);

    // Microsoft was asked once, for identity only, with PKCE and no secret.
    const visits = await microsoftVisits();
    expect(visits).toHaveLength(1);
    const asked = visits[0]!;
    expect(asked.response_type).toBe('code');
    expect(asked.scope).toBe('openid profile');
    expect(asked.code_challenge_method).toBe('S256');
    expect(asked).not.toHaveProperty('client_secret');
    expect(new URL(page.url()).search).toBe('');

    // What a script in the page can reach holds no credential; the session is an HttpOnly cookie.
    const cookie = await sessionCookie(page);
    expect(cookie, 'the session cookie').toMatchObject({
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
    });
    expect(cookie!.value).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    const reachable = await page.evaluate(() => ({
      cookie: document.cookie,
      stores: JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }),
    }));
    expect(reachable.cookie).toBe('');
    expect(reachable.stores).not.toContain(cookie!.value);
    expect(reachable.stores).not.toMatch(/eyJ|access_token|id_token/u);

    const session = await page.evaluate(async () => (await fetch('/api/session')).json());
    expect(session).toMatchObject({ authenticated: true, via: 'session' });
  });

  test('lets the page make changes as the signed-in person, and refuses the same change without its header', async ({
    page,
  }) => {
    const problems = watchPage(page, { refusals: true });
    await microsoftSignsIn('owner');
    // The exploration is made by the page, as a person makes it, and it is theirs: the journey opens on it.
    const id = await startFromExample(page, 'Online store checkout');
    expect(id).toMatch(/^[0-9a-f-]{36}$/u);
    await expect(page.getByRole('navigation', { name: 'Journey' }).first()).toBeVisible();

    const forged = await page.evaluate(async () => {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      return {
        status: response.status,
        body: (await response.json()) as { error: { code: string } },
      };
    });
    expect(forged.status).toBe(403);
    expect(forged.body.error.code).toBe('CSRF_REQUIRED');
    // The one refusal in the page's log is the one the test asked for.
    expect(problems.filter((problem) => !problem.startsWith('403 POST /api/projects'))).toEqual([]);
  });

  test('tells someone who is signed in but not in the workspace why they cannot create anything', async ({
    browser,
  }) => {
    // The owner claims the empty workspace first; the stranger is allowed in and added to nothing.
    await microsoftSignsIn('owner');
    const first = await browser.newContext();
    const owner = await first.newPage();
    await owner.goto('/');
    await expectSignedIn(owner);
    await first.close();

    await microsoftSignsIn('stranger');
    const second = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await second.newPage();
    await page.goto('/');
    await expectSignedIn(page);
    await page.getByRole('button', { name: 'Online store checkout', exact: true }).click();
    await page.getByRole('button', { name: 'Explore', exact: true }).click();
    // The refusal may come when the question is read or when the exploration is made; either way it is told, in words.
    const ground = page.getByRole('button', { name: 'Ground it' });
    const told = page
      .getByRole('alert')
      .getByText('You are not a member of this workspace.')
      .first();
    await expect(ground.or(told)).toBeVisible();
    if (await ground.isVisible()) await ground.click();
    await expect(told).toBeVisible();
    // Nothing was made: still the first screen, with no journey to walk.
    await expect(page).not.toHaveURL(/[?&]project=/u);
    await expect(page.getByRole('navigation', { name: 'Journey' })).toHaveCount(0);
    await second.close();
  });

  test('signing out ends the session on the server, not only in the page', async ({
    page,
    playwright,
    baseURL,
  }) => {
    await microsoftSignsIn('owner');
    await page.goto('/');
    await expectSignedIn(page);
    const before = (await sessionCookie(page))!.value;
    expect(await visitCount()).toBe(1);

    const menu = await openSettings(page);
    await menu.getByRole('menuitem', { name: 'Sign out' }).click();
    // The next load has no session, so the visitor is sent to Microsoft again and returns with a new one.
    await expect.poll(visitCount).toBe(2);
    await expectSignedIn(page);
    expect((await sessionCookie(page))!.value).not.toBe(before);

    // Anyone who kept a copy of the old cookie gets nothing from it.
    const copy = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { cookie: `swarm_session=${before}` },
    });
    const response = await copy.get('/api/projects');
    expect(response.status()).toBe(401);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'SIGN_IN_REQUIRED',
    );
    await copy.dispose();
  });

  test('tells a person who has no Swarm role so, once, and keeps no session', async ({ page }) => {
    await microsoftSignsIn('norole');
    await page.goto('/');
    await expect(
      page.getByRole('heading', { level: 1, name: 'You are signed in, but have no Swarm role' }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/\?signin=norole$/u);
    await expect(page).toHaveTitle('You are signed in, but have no Swarm role · Swarm');
    expect(await visitCount()).toBe(1);
    expect(await sessionCookie(page)).toBeUndefined();
    await expect(page.getByRole('link', { name: 'Sign in with Microsoft' })).toHaveAttribute(
      'href',
      '/auth/login',
    );
    await quiet(page);
    await expectNoAxeViolations(page, 'signed in without a role');
    await expectNoHorizontalOverflow(page);
  });

  test('does not loop when Microsoft declines, and offers one more try', async ({ page }) => {
    await microsoftSignsIn('declines');
    await page.goto('/');
    const heading = page.getByRole('heading', { level: 1, name: 'Sign-in did not complete' });
    await expect(heading).toBeVisible();
    expect(await visitCount()).toBe(1);
    expect(await sessionCookie(page)).toBeUndefined();
    await quiet(page);
    await expectNoAxeViolations(page, 'sign-in did not complete');

    await page.getByRole('link', { name: 'Sign in with Microsoft' }).click();
    await expect.poll(visitCount).toBe(2);
    await expect(heading).toBeVisible();
    expect(await visitCount()).toBe(2);
  });

  test('a form on another site does not make the browser send the session with a change', async ({
    page,
    baseURL,
  }) => {
    await microsoftSignsIn('owner');
    await page.goto('/');
    await expectSignedIn(page);
    const target = `${baseURL}/api/projects`;
    // What a hostile page would use, because a form needs no permission from the application.
    const postForm = (url: string) => {
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = url;
      form.enctype = 'text/plain';
      const field = document.createElement('input');
      field.name = '{"name":"planted","ignored":"';
      field.value = '"}';
      form.append(field);
      document.body.append(form);
      form.submit();
    };
    const post = (response: { url(): string; request(): { method(): string } }) =>
      response.url() === target && response.request().method() === 'POST';

    // The control: from the application's own page the cookie is sent, and the server, having
    // recognised the session, refuses the change for lacking the page's own header.
    const own = page.waitForResponse(post);
    await page.evaluate(postForm, target);
    const sameSite = await own;
    expect(await sameSite.request().allHeaders()).toHaveProperty('cookie');
    expect(sameSite.status()).toBe(403);

    // From another site the browser does not send the cookie at all, and the origin is refused.
    await page.route('http://evil.example/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Elsewhere</title><p>.</p>',
      }),
    );
    await page.goto('http://evil.example/');
    const foreign = page.waitForResponse(post);
    await page.evaluate(postForm, target);
    const crossSite = await foreign;
    const sent = await crossSite.request().allHeaders();
    expect(sent).not.toHaveProperty('cookie');
    expect(sent.origin).toBe('http://evil.example');
    expect(crossSite.status()).toBe(403);

    // And nothing was planted for the signed-in person.
    await page.waitForURL(target);
    await page.goto('/');
    const listed = await page.evaluate(
      async () => (await (await fetch('/api/projects')).json()) as { projects: { name: string }[] },
    );
    expect(listed.projects.map((project) => project.name)).not.toContain('planted');
  });
});

// The two pages that stand in place of the application when a sign-in does not produce a session are the first thing
// a person refused at the door sees: they are held to the whole product's standard, in every theme and on a phone.
const PROBLEMS = [
  ['failed', 'Sign-in did not complete'],
  ['norole', 'You are signed in, but have no Swarm role'],
] as const;

for (const [kind, title] of PROBLEMS) {
  for (const theme of ['light', 'dark', 'high-contrast'] as const) {
    test(`the "${title}" page is readable in the ${theme} theme, on a laptop and on a phone`, async ({
      page,
    }) => {
      const problems = watchPage(page);
      await page.addInitScript((value) => window.localStorage.setItem('swarm.theme', value), theme);
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(viewport);
        await page.goto(`/?signin=${kind}`);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Sign in with Microsoft' })).toBeVisible();
        await quiet(page);
        await expectNoHorizontalOverflow(page);
        await expectReadableText(page, `${kind} ${theme} ${viewport.width}px`);
        await expectPressable(page, `${kind} ${theme} ${viewport.width}px`, { min: 24 });
        await expectNoAxeViolations(page, `${kind} ${theme} ${viewport.width}px`);
        if (theme !== 'light') {
          await expectNoBrowserPaintedControls(page, `${kind} ${theme}`);
        }
      }
      expect(problems).toEqual([]);
    });
  }
}
