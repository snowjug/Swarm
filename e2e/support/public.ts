import {
  expect,
  type BrowserContext,
  type Page,
  type PlaywrightWorkerArgs,
} from '@playwright/test';
import { PUBLIC_E2E_PORTS, type Seen } from '../../backend/test/support/public-e2e-protocol';

// What the specs of the public edition share: the control interface of its server (what each fake model was asked, and what
// the fake Google will say), signing a person in through the browser the way a person does, and the checks that a key and a
// session are kept where they should be.

const controlUrl = `http://127.0.0.1:${process.env.E2E_PUBLIC_CONTROL_PORT || PUBLIC_E2E_PORTS.control}`;

/** The control interface of a server of the public edition: the default one, or the one on `port` (guest mode has its own). */
export async function control(playwright: PlaywrightWorkerArgs['playwright'], port?: number) {
  const request = await playwright.request.newContext({
    baseURL: port === undefined ? controlUrl : `http://127.0.0.1:${port}`,
  });
  return {
    seen: async (): Promise<Seen> => (await request.get('/__seen')).json() as Promise<Seen>,
    reset: async (): Promise<void> => void (await request.post('/__reset')),
    expectGoogle: async (identity: {
      code: string;
      sub: string;
      email: string;
      nonce: string;
    }): Promise<void> => {
      const response = await request.post('/__google', { data: identity });
      expect(response.status()).toBe(204);
    },
    dispose: () => request.dispose(),
  };
}
export type Control = Awaited<ReturnType<typeof control>>;

/** A person Google will vouch for: the identifier it knows them by, and the address it has verified. */
export interface Person {
  sub: string;
  email: string;
}

/**
 * Stands in for Google's sign-in page. The page sends the browser to https://accounts.google.com as it would, and this
 * answers there: it tells the application's server who Google would vouch for, and sends the browser back to the address
 * the page asked for, with a code and the state it was given. `who` can be changed between sign-ins.
 */
export async function fakeGoogle(
  context: BrowserContext,
  fake: Control,
  who: { current: Person },
): Promise<void> {
  await context.route('https://accounts.google.com/**', async (route) => {
    const asked = new URL(route.request().url());
    const state = asked.searchParams.get('state') ?? '';
    const nonce = asked.searchParams.get('nonce') ?? '';
    const back = asked.searchParams.get('redirect_uri') ?? '';
    const code = `code-${Math.random().toString(36).slice(2)}`;
    await fake.expectGoogle({ code, nonce, ...who.current });
    await route.fulfill({
      status: 302,
      headers: {
        location: `${back}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
      },
    });
  });
}

/** From the landing page to the application, by the buttons a person presses. */
export async function signUp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('landing')).toBeVisible();
  await page.getByTestId('try-it-free').click();
  await expect(page.getByTestId('signin-card')).toBeVisible();
  await page.getByTestId('signin-google').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'See how a decision could unfold.',
    { timeout: 30_000 },
  );
  await expect(page.getByTestId('usage-meter')).toBeVisible();
}

/** The settings menu, and the item of it with this test id. */
export async function fromMenu(page: Page, testId: string): Promise<void> {
  await page.getByRole('button', { name: 'Settings and tools' }).click();
  await page.getByTestId(testId).click();
}

/** What the tab holds of the person's own key: nothing but the tab's session storage, and only while it is held. */
export async function storedWith(
  page: Page,
  secret: string,
): Promise<{ session: boolean; local: boolean }> {
  return page.evaluate((needle) => {
    const held = (area: Storage) =>
      JSON.stringify(Object.fromEntries(Object.entries(area))).includes(needle);
    return { session: held(window.sessionStorage), local: held(window.localStorage) };
  }, secret);
}

/** Every request the page makes, with whether it carried a key and where it went. */
export function watchRequests(page: Page) {
  const made: { method: string; origin: string; path: string; carriesKey: boolean }[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    made.push({
      method: request.method(),
      origin: url.origin,
      path: url.pathname,
      carriesKey: Boolean(request.headers()['x-swarm-provider-key']),
    });
  });
  return made;
}
