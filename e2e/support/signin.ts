import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { watchPage } from './helpers';
import { microsoftSignsIn, type Person } from './microsoft';
import { openSettings } from './shell';

// What the sign-in specs share: a browser of its own for each person, signed in through the test identity provider
// (backend/test/support/signin-e2e-server.ts), and what the page says once a person is in.

/** The people of the sign-in test server, by the object ID that Microsoft gives them. */
export const OWNER = 'eeeeeee1-0000-4000-8000-000000000001';
export const COLLEAGUE = 'eeeeeee4-0000-4000-8000-000000000004';

/** How the page names a person: the first eight characters of the object ID. */
export const shortId = (id: string): string => `${id.slice(0, 8)}…`;

/** Two frames have been drawn, so what the page was last told is on the screen. */
export const rendered = (page: Page): Promise<void> =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );

/**
 * The page knows who is signed in: its settings menu says so, and offers to sign out. The menu is what the account
 * lives in now, so it is opened, read, and closed again.
 */
export async function expectSignedIn(page: Page): Promise<void> {
  const menu = await openSettings(page);
  await expect(menu).toContainText('Signed in · Microsoft Entra');
  await expect(menu.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
}

export interface SignedIn {
  context: BrowserContext;
  page: Page;
  /** What the page did that it must not do; a refusal the test provokes is not one of them. */
  problems: string[];
}

/** A browser of its own, signed in as this person, with the page's idea of their role already drawn. */
export async function signedInAs(
  browser: Browser,
  person: Person,
  closers: (() => Promise<unknown>)[],
  options: { path?: string; theme?: string } = {},
): Promise<SignedIn> {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  closers.push(() => context.close());
  const theme = options.theme;
  if (theme) {
    await context.addInitScript(
      (value) => window.localStorage.setItem('swarm.theme', value),
      theme,
    );
  }
  const page = await context.newPage();
  const problems = watchPage(page, { refusals: true });
  // The page offers what it offers on the strength of this answer.
  const role = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/workspace',
  );
  await microsoftSignsIn(person);
  await page.goto(options.path ?? '/');
  await role;
  await expect(page.getByRole('button', { name: 'Settings and tools' })).toBeVisible();
  await rendered(page);
  return { context, page, problems };
}

/** Changes made as the person who is signed in in that browser, with the header the page itself sends. */
export async function changesAs(
  playwright: { request: { newContext: (options: object) => Promise<APIRequestContext> } },
  context: BrowserContext,
  baseURL: string | undefined,
  closers: (() => Promise<unknown>)[],
): Promise<APIRequestContext> {
  const api = await playwright.request.newContext({
    baseURL,
    storageState: await context.storageState(),
    extraHTTPHeaders: { 'X-Swarm-CSRF': '1' },
  });
  closers.push(() => api.dispose());
  return api;
}
