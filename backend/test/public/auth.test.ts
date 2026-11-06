import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { fixtureInput, sourceText } from '../fixtures.js';
import {
  FakeProviders,
  publicApp,
  publicEnvironment,
  type PublicHarness,
} from '../support/public-idp.js';

const open: PublicHarness[] = [];
async function harness(...args: Parameters<typeof publicApp>): Promise<PublicHarness> {
  const made = await publicApp(...args);
  open.push(made);
  return made;
}
afterEach(async () => {
  await Promise.all(open.splice(0).map((made) => made.close()));
});

const json = { 'content-type': 'application/json' };
const csrf = { 'x-swarm-csrf': '1' };

describe('the public edition is a mode, and a safe one to start', () => {
  it('is the pilot unless it is asked for', () => {
    const config = loadConfig({});
    expect(config.edition).toBe('pilot');
    expect(config.public).toBeNull();
    expect(config.auth.mode).toBe('none');
  });

  it('refuses to start without what makes it safe, and names the setting', () => {
    const without = (name: string) => {
      const environment: Record<string, string | undefined> = { ...publicEnvironment };
      delete environment[name];
      return environment;
    };
    expect(() => loadConfig(without('PUBLIC_BASE_URL'))).toThrow(/PUBLIC_BASE_URL/u);
    expect(() => loadConfig(without('PUBLIC_PEPPER'))).toThrow(/PUBLIC_PEPPER/u);
    expect(() =>
      loadConfig({
        ...publicEnvironment,
        PUBLIC_GOOGLE_CLIENT_ID: undefined,
        PUBLIC_GOOGLE_CLIENT_SECRET: undefined,
        PUBLIC_GITHUB_CLIENT_ID: undefined,
        PUBLIC_GITHUB_CLIENT_SECRET: undefined,
      }),
    ).toThrow(/needs a way to sign in/u);
    expect(() =>
      loadConfig({ ...publicEnvironment, PUBLIC_GOOGLE_CLIENT_SECRET: undefined }),
    ).toThrow(/together/u);
    expect(() =>
      loadConfig({
        ...publicEnvironment,
        PUBLIC_BASE_URL: 'http://swarm.example.com',
        ALLOWED_HOSTS: 'swarm.example.com',
      }),
    ).toThrow(/https/u);
    expect(() =>
      loadConfig({ ...publicEnvironment, PUBLIC_BASE_URL: 'https://swarm.example.com/app' }),
    ).toThrow(/no path/u);
    expect(() => loadConfig({ ...publicEnvironment, ALLOWED_HOSTS: 'elsewhere.example' })).toThrow(
      /ALLOWED_HOSTS/u,
    );
    expect(() => loadConfig({ ...publicEnvironment, AUTH_MODE: 'entra' })).toThrow(
      /does not use AUTH_MODE/u,
    );
    expect(() => loadConfig({ ...publicEnvironment, PUBLIC_PEPPER: 'short' })).toThrow(
      /PUBLIC_PEPPER/u,
    );
  });

  it('never leaks a secret into the message of a bad value', () => {
    expect(() =>
      loadConfig({ ...publicEnvironment, PUBLIC_GOOGLE_CLIENT_SECRET: 'x'.repeat(600) }),
    ).toThrow(/PUBLIC_GOOGLE_CLIENT_SECRET\./u);
    try {
      loadConfig({ ...publicEnvironment, PUBLIC_PEPPER: 'short-secret-value' });
    } catch (error) {
      expect(String((error as Error).message)).not.toContain('short-secret-value');
    }
  });

  it('allows an https address, and a plain http one only on localhost', () => {
    const config = loadConfig({
      ...publicEnvironment,
      PUBLIC_BASE_URL: 'https://swarm.example.com',
      ALLOWED_HOSTS: 'swarm.example.com',
    });
    expect(config.public?.secureCookies).toBe(true);
    expect(config.public?.baseUrl).toBe('https://swarm.example.com');
    expect(config.allowedOrigins.has('https://swarm.example.com')).toBe(true);
    expect(loadConfig(publicEnvironment).public?.secureCookies).toBe(false);
  });

  it('keeps the model of the free tier to a priced model that does not reason', () => {
    const model = {
      AI_PROVIDER: 'foundry',
      FOUNDRY_ENDPOINT: 'https://example.openai.azure.com',
      AI_MODEL: 'gpt-4.1-mini',
    };
    const prices = JSON.stringify([
      { deployment: 'gpt-4.1-mini', inputPerMillionUsd: 0.4, outputPerMillionUsd: 1.6 },
    ]);
    expect(() => loadConfig({ ...publicEnvironment, ...model })).toThrow(/no price/u);
    expect(() =>
      loadConfig({ ...publicEnvironment, ...model, MODEL_PRICES: prices }),
    ).not.toThrow();
    expect(() =>
      loadConfig({
        ...publicEnvironment,
        ...model,
        AI_MODEL: 'gpt-5-mini',
        MODEL_PRICES: JSON.stringify([
          { deployment: 'gpt-5-mini', inputPerMillionUsd: 0.25, outputPerMillionUsd: 2 },
        ]),
      }),
    ).toThrow(/reasoning/u);
    expect(() =>
      loadConfig({
        ...publicEnvironment,
        ...model,
        MODEL_PRICES: prices,
        FOUNDRY_DEPLOYMENT_PROFILES: JSON.stringify({ 'gpt-4.1-mini': { reasoning: true } }),
      }),
    ).toThrow(/reasoning/u);
    expect(() =>
      loadConfig({
        ...publicEnvironment,
        ...model,
        MODEL_PRICES: prices,
        FOUNDRY_DEPLOYMENT_REASONING: 'swarm-reasoning',
      }),
    ).toThrow(/FOUNDRY_DEPLOYMENT_REASONING/u);
    // With the free tier off, nothing is asked of the model settings.
    expect(() =>
      loadConfig({ ...publicEnvironment, ...model, FREE_TIER_ENABLED: 'false' }),
    ).not.toThrow();
  });
});

describe('signing in with Google', () => {
  it('makes an account and a private workspace the first time, and signs the same person in the second time', async () => {
    const h = await harness();
    const first = await h.signIn({
      provider: 'google',
      subject: 'g-100',
      email: 'Alice@Example.com',
    });
    const again = await h.signIn({
      provider: 'google',
      subject: 'g-100',
      email: 'alice@example.com',
    });
    expect(first.cookie).not.toBe(again.cookie);
    const users = h.built.repository.asSystem(() => h.built.publicEdition!.context.users.count());
    expect(users).toBe(1);
    const view = await h.app.inject({
      method: 'GET',
      url: '/api/account',
      headers: { cookie: first.cookie },
    });
    expect(view.statusCode).toBe(200);
    expect(view.json()).toMatchObject({
      emailMasked: 'a***@example.com',
      provider: 'google',
      isAdmin: false,
      projects: { count: 0, limit: 10 },
    });
    expect(view.body).not.toContain('alice@example.com');
  });

  it('refuses an address Google has not verified', async () => {
    const h = await harness();
    const started = await h.app.inject({
      method: 'POST',
      url: '/auth/start/google',
      headers: { ...csrf, ...json },
      payload: {},
    });
    const url = new URL((started.json() as { url: string }).url);
    h.providers.expectGoogle(
      'c1',
      { sub: 'g-1', email: 'a@example.com', emailVerified: false },
      url.searchParams.get('nonce')!,
    );
    const finished = await h.app.inject({
      method: 'GET',
      url: `/auth/callback/google?code=c1&state=${url.searchParams.get('state')}`,
      headers: { cookie: String(started.headers['set-cookie']).split(';')[0]! },
    });
    expect(finished.statusCode).toBe(302);
    expect(finished.headers.location).toBe('/?signin=unverified');
    expect(String(finished.headers['set-cookie'])).not.toMatch(/swarm_session=[A-Za-z0-9_-]{16,}/u);
  });

  for (const sign of ['wrong-key', 'expired', 'wrong-audience', 'wrong-issuer'] as const) {
    it(`refuses an ID token that is ${sign}`, async () => {
      const h = await harness();
      const started = await h.app.inject({
        method: 'POST',
        url: '/auth/start/google',
        headers: { ...csrf, ...json },
        payload: {},
      });
      const url = new URL((started.json() as { url: string }).url);
      h.providers.expectGoogle(
        'c1',
        { sub: 'g-1', email: 'a@example.com' },
        url.searchParams.get('nonce')!,
        sign,
      );
      const finished = await h.app.inject({
        method: 'GET',
        url: `/auth/callback/google?code=c1&state=${url.searchParams.get('state')}`,
        headers: { cookie: String(started.headers['set-cookie']).split(';')[0]! },
      });
      expect(finished.headers.location).toBe('/?signin=failed');
    });
  }

  it('refuses an ID token whose nonce is not the one this sign-in started with', async () => {
    const h = await harness();
    const started = await h.app.inject({
      method: 'POST',
      url: '/auth/start/google',
      headers: { ...csrf, ...json },
      payload: {},
    });
    const url = new URL((started.json() as { url: string }).url);
    h.providers.expectGoogle(
      'c1',
      { sub: 'g-1', email: 'a@example.com' },
      'a-nonce-from-another-sign-in',
    );
    const finished = await h.app.inject({
      method: 'GET',
      url: `/auth/callback/google?code=c1&state=${url.searchParams.get('state')}`,
      headers: { cookie: String(started.headers['set-cookie']).split(';')[0]! },
    });
    expect(finished.headers.location).toBe('/?signin=failed');
  });

  it('asks Google for PKCE, a state and a nonce, and sends the person only to Google’s own address', async () => {
    const h = await harness();
    const started = await h.app.inject({
      method: 'POST',
      url: '/auth/start/google',
      headers: { ...csrf, ...json },
      payload: { returnTo: '/somewhere' },
    });
    const url = new URL((started.json() as { url: string }).url);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(url.searchParams.get('nonce')).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3001/auth/callback/google');
    expect(url.searchParams.get('scope')).toBe('openid email');
    expect(url.searchParams.get('client_id')).toBe(publicEnvironment.PUBLIC_GOOGLE_CLIENT_ID);
    expect(url.searchParams.get('client_secret')).toBeNull();
  });
});

describe('signing in with GitHub', () => {
  it('uses the primary address that GitHub has verified, and no other', async () => {
    const h = await harness();
    await h.signIn({ provider: 'github', subject: '4242', email: 'octo@example.com' });
    const user = h.built.repository.asSystem(() =>
      h.built.publicEdition!.context.users.find('github', '4242'),
    );
    expect(user?.email).toBe('octo@example.com');
    const hosts = new Set(h.providers.requests.map((request) => new URL(request.url).host));
    expect([...hosts].sort()).toEqual(['api.github.com', 'github.com']);
    const exchange = h.providers.requests.find((request) => request.url.endsWith('/access_token'))!;
    expect(exchange.body).toContain('code_verifier=');
  });

  it('refuses an account whose primary address is not verified', async () => {
    const h = await harness();
    const started = await h.app.inject({
      method: 'POST',
      url: '/auth/start/github',
      headers: { ...csrf, ...json },
      payload: {},
    });
    const url = new URL((started.json() as { url: string }).url);
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('user:email');
    h.providers.expectGitHub('c1', {
      id: 7,
      emails: [
        { email: 'verified-but-secondary@example.com', primary: false, verified: true },
        { email: 'primary-but-unverified@example.com', primary: true, verified: false },
      ],
    });
    const finished = await h.app.inject({
      method: 'GET',
      url: `/auth/callback/github?code=c1&state=${url.searchParams.get('state')}`,
      headers: { cookie: String(started.headers['set-cookie']).split(';')[0]! },
    });
    expect(finished.headers.location).toBe('/?signin=unverified');
  });

  it('keeps one person’s Google and GitHub accounts apart, even with the same address', async () => {
    const h = await harness();
    const google = await h.signIn({
      provider: 'google',
      subject: 'g-1',
      email: 'same@example.com',
    });
    const github = await h.signIn({ provider: 'github', subject: '55', email: 'same@example.com' });
    const a = (
      await h.app.inject({
        method: 'GET',
        url: '/api/projects',
        headers: { cookie: google.cookie },
      })
    ).json();
    expect(a).toBeDefined();
    expect(h.built.repository.asSystem(() => h.built.publicEdition!.context.users.count())).toBe(2);
    expect(github.cookie).not.toBe(google.cookie);
  });
});

describe('what a sign-in has to prove', () => {
  async function started(h: PublicHarness, provider = 'google') {
    const response = await h.app.inject({
      method: 'POST',
      url: `/auth/start/${provider}`,
      headers: { ...csrf, ...json },
      payload: {},
    });
    const url = new URL((response.json() as { url: string }).url);
    return {
      url,
      binding: String(response.headers['set-cookie']).split(';')[0]!,
      state: url.searchParams.get('state')!,
      nonce: url.searchParams.get('nonce'),
    };
  }

  it('is started only from the page: a start with no anti-forgery header is refused', async () => {
    const h = await harness();
    const response = await h.app.inject({
      method: 'POST',
      url: '/auth/start/google',
      headers: json,
      payload: {},
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('CSRF_REQUIRED');
  });

  it('refuses a provider that is not configured or does not exist', async () => {
    const h = await harness({ PUBLIC_GITHUB_CLIENT_ID: '', PUBLIC_GITHUB_CLIENT_SECRET: '' });
    expect(
      (
        await h.app.inject({
          method: 'POST',
          url: '/auth/start/github',
          headers: { ...csrf, ...json },
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await h.app.inject({
          method: 'POST',
          url: '/auth/start/facebook',
          headers: { ...csrf, ...json },
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
  });

  it('can be finished once, by the browser that started it', async () => {
    const h = await harness();
    const one = await started(h);
    h.providers.expectGoogle('c1', { sub: 'g-1', email: 'a@example.com' }, one.nonce!);
    const first = await h.app.inject({
      method: 'GET',
      url: `/auth/callback/google?code=c1&state=${one.state}`,
      headers: { cookie: one.binding },
    });
    expect(first.headers.location).toBe('/');
    // The state is spent: the same reply, replayed, signs no one in.
    const replay = await h.app.inject({
      method: 'GET',
      url: `/auth/callback/google?code=c1&state=${one.state}`,
      headers: { cookie: one.binding },
    });
    expect(replay.headers.location).toBe('/?signin=failed');
    expect(String(replay.headers['set-cookie'])).not.toMatch(/swarm_session=[A-Za-z0-9_-]{16,}/u);
    // Another browser: the right state but no binding cookie.
    const two = await started(h);
    h.providers.expectGoogle('c2', { sub: 'g-2', email: 'b@example.com' }, two.nonce!);
    const stranger = await h.app.inject({
      method: 'GET',
      url: `/auth/callback/google?code=c2&state=${two.state}`,
    });
    expect(stranger.headers.location).toBe('/?signin=failed');
  });

  it('is bound to the provider that started it', async () => {
    const h = await harness();
    const one = await started(h, 'google');
    h.providers.expectGitHub('c1', {
      id: 9,
      emails: [{ email: 'a@example.com', primary: true, verified: true }],
    });
    const crossed = await h.app.inject({
      method: 'GET',
      url: `/auth/callback/github?code=c1&state=${one.state}`,
      headers: { cookie: one.binding },
    });
    expect(crossed.headers.location).toBe('/?signin=failed');
  });

  it('refuses a binding cookie that is not the one it issued', async () => {
    const h = await harness();
    const one = await started(h);
    h.providers.expectGoogle('c1', { sub: 'g-1', email: 'a@example.com' }, one.nonce!);
    const wrong = await h.app.inject({
      method: 'GET',
      url: `/auth/callback/google?code=c1&state=${one.state}`,
      headers: { cookie: 'swarm_login=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    });
    expect(wrong.headers.location).toBe('/?signin=failed');
  });

  it('refuses an attempt that is more than ten minutes old', async () => {
    let at = 1_000_000;
    const h = await harness({}, { now: () => at, public: { now: () => at } });
    const one = await started(h);
    h.providers.expectGoogle('c1', { sub: 'g-1', email: 'a@example.com' }, one.nonce!);
    at += 11 * 60_000;
    const late = await h.app.inject({
      method: 'GET',
      url: `/auth/callback/google?code=c1&state=${one.state}`,
      headers: { cookie: one.binding },
    });
    expect(late.headers.location).toBe('/?signin=failed');
  });

  it('says the same thing whatever went wrong, and a person who said no is not signed in', async () => {
    const h = await harness();
    const one = await started(h);
    const denied = await h.app.inject({
      method: 'GET',
      url: `/auth/callback/google?error=access_denied&state=${one.state}`,
      headers: { cookie: one.binding },
    });
    expect(denied.headers.location).toBe('/?signin=failed');
  });

  it('survives a provider that is down', async () => {
    const h = await harness();
    const one = await started(h);
    h.providers.expectGoogle('c1', { sub: 'g-1', email: 'a@example.com' }, one.nonce!);
    h.providers.failHost = 'oauth2.googleapis.com';
    const down = await h.app.inject({
      method: 'GET',
      url: `/auth/callback/google?code=c1&state=${one.state}`,
      headers: { cookie: one.binding },
    });
    expect(down.headers.location).toBe('/?signin=failed');
  });

  it('never redirects off the site after signing in', async () => {
    const h = await harness();
    for (const returnTo of [
      'https://evil.example/',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      '/ok\nlocation: x',
    ]) {
      const response = await h.app.inject({
        method: 'POST',
        url: '/auth/start/google',
        headers: { ...csrf, ...json },
        payload: { returnTo },
      });
      const url = new URL((response.json() as { url: string }).url);
      h.providers.expectGoogle(
        'c1',
        { sub: `g-${returnTo.length}`, email: 'a@example.com' },
        url.searchParams.get('nonce')!,
      );
      const finished = await h.app.inject({
        method: 'GET',
        url: `/auth/callback/google?code=c1&state=${url.searchParams.get('state')}`,
        headers: { cookie: String(response.headers['set-cookie']).split(';')[0]! },
      });
      expect(finished.headers.location, returnTo).toBe('/');
    }
    const fine = await h.app.inject({
      method: 'POST',
      url: '/auth/start/google',
      headers: { ...csrf, ...json },
      payload: { returnTo: '/status' },
    });
    const url = new URL((fine.json() as { url: string }).url);
    h.providers.expectGoogle(
      'c2',
      { sub: 'g-fine', email: 'b@example.com' },
      url.searchParams.get('nonce')!,
    );
    const ok = await h.app.inject({
      method: 'GET',
      url: `/auth/callback/google?code=c2&state=${url.searchParams.get('state')}`,
      headers: { cookie: String(fine.headers['set-cookie']).split(';')[0]! },
    });
    expect(ok.headers.location).toBe('/status');
  });
});

describe('the session cookie', () => {
  it('is HttpOnly, SameSite=Lax, Secure and __Host- prefixed on an https site', async () => {
    const h = await harness({
      PUBLIC_BASE_URL: 'https://swarm.example.com',
      ALLOWED_HOSTS: 'swarm.example.com',
    });
    const started = await h.app.inject({
      method: 'POST',
      url: '/auth/start/google',
      headers: { ...csrf, ...json, host: 'swarm.example.com' },
      payload: {},
    });
    const binding = String(started.headers['set-cookie']);
    expect(binding).toMatch(
      /^__Host-swarm_login=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=600; HttpOnly; SameSite=Lax; Secure$/u,
    );
    const url = new URL((started.json() as { url: string }).url);
    h.providers.expectGoogle(
      'c1',
      { sub: 'g-1', email: 'a@example.com' },
      url.searchParams.get('nonce')!,
    );
    const finished = await h.app.inject({
      method: 'GET',
      url: `/auth/callback/google?code=c1&state=${url.searchParams.get('state')}`,
      headers: { cookie: binding.split(';')[0]!, host: 'swarm.example.com' },
    });
    const session = ([] as string[])
      .concat(finished.headers['set-cookie'] as string[])
      .find((cookie) => cookie.includes('swarm_session'))!;
    expect(session).toMatch(
      /^__Host-swarm_session=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=28800; HttpOnly; SameSite=Lax; Secure$/u,
    );
    expect(session).not.toMatch(/Domain=/iu);
  });

  it('is an opaque identifier, and what the database keeps of it is only its hash', async () => {
    const h = await harness();
    const { cookie } = await h.signIn({
      provider: 'google',
      subject: 'g-1',
      email: 'a@example.com',
    });
    const token = cookie.split('=')[1]!;
    const stored = h.built.repository.asSystem(() =>
      h.built.repository.extend((db) => db.prepare('SELECT id_hash FROM sessions').all()),
    );
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it('gets a new identifier at every sign-in, so that a planted one is worth nothing', async () => {
    const h = await harness();
    const one = await h.signIn({ provider: 'google', subject: 'g-1', email: 'a@example.com' });
    const two = await h.signIn({ provider: 'google', subject: 'g-1', email: 'a@example.com' });
    expect(one.cookie).not.toBe(two.cookie);
  });

  it('ends after the idle time, and after the absolute time whatever happens', async () => {
    let at = 1_700_000_000_000;
    const h = await harness(
      { AUTH_SESSION_IDLE_MINUTES: '30', AUTH_SESSION_ABSOLUTE_HOURS: '2' },
      { now: () => at, public: { now: () => at } },
    );
    const { cookie } = await h.signIn({
      provider: 'google',
      subject: 'g-1',
      email: 'a@example.com',
    });
    const ask = () => h.app.inject({ method: 'GET', url: '/api/account', headers: { cookie } });
    expect((await ask()).statusCode).toBe(200);
    at += 20 * 60_000;
    expect((await ask()).statusCode).toBe(200);
    at += 20 * 60_000;
    expect((await ask()).statusCode).toBe(200);
    // Busy the whole time, and still over the absolute limit (40 + 75 = 115 minutes of a 120-minute day).
    for (let i = 0; i < 3; i++) {
      at += 25 * 60_000;
      expect((await ask()).statusCode).toBe(200);
    }
    at += 25 * 60_000;
    const over = await ask();
    expect(over.statusCode).toBe(401);
    expect(over.json().error.code).toBe('SIGN_IN_REQUIRED');
    // And idle: a session nobody uses ends.
    const second = await h.signIn({ provider: 'google', subject: 'g-1', email: 'a@example.com' });
    at += 31 * 60_000;
    expect(
      (
        await h.app.inject({
          method: 'GET',
          url: '/api/account',
          headers: { cookie: second.cookie },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('ends at sign-out, and the old cookie is then worth nothing', async () => {
    const h = await harness();
    const { cookie } = await h.signIn({
      provider: 'google',
      subject: 'g-1',
      email: 'a@example.com',
    });
    expect(
      (await h.app.inject({ method: 'POST', url: '/auth/logout', headers: { cookie } })).statusCode,
    ).toBe(403);
    const out = await h.app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie, ...csrf },
    });
    expect(out.statusCode).toBe(204);
    expect(String(out.headers['set-cookie'])).toContain('Max-Age=0');
    expect(
      (await h.app.inject({ method: 'GET', url: '/api/account', headers: { cookie } })).statusCode,
    ).toBe(401);
  });
});

describe('who may call what', () => {
  it('needs a session for everything that is not public, and a bearer token is not one', async () => {
    const h = await harness();
    expect((await h.app.inject({ method: 'GET', url: '/api/projects' })).statusCode).toBe(401);
    expect((await h.app.inject({ method: 'GET', url: '/api/account' })).statusCode).toBe(401);
    const bearer = await h.app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.e30.x' },
    });
    expect(bearer.statusCode).toBe(401);
    const { cookie } = await h.signIn({
      provider: 'google',
      subject: 'g-1',
      email: 'a@example.com',
    });
    const both = await h.app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { cookie, authorization: 'Bearer abc' },
    });
    expect(both.statusCode).toBe(401);
  });

  it('asks for the anti-forgery header on every change made with a cookie, and refuses a cross-site one', async () => {
    const h = await harness();
    const { cookie } = await h.signIn({
      provider: 'google',
      subject: 'g-1',
      email: 'a@example.com',
    });
    const without = await h.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { cookie, ...json },
      payload: {},
    });
    expect(without.statusCode).toBe(403);
    expect(without.json().error.code).toBe('CSRF_REQUIRED');
    const crossSite = await h.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { cookie, ...csrf, ...json, 'sec-fetch-site': 'cross-site' },
      payload: {},
    });
    expect(crossSite.statusCode).toBe(403);
    const foreignOrigin = await h.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { cookie, ...csrf, ...json, origin: 'https://evil.example' },
      payload: {},
    });
    expect(foreignOrigin.statusCode).toBe(403);
    expect(foreignOrigin.json().error.code).toBe('ORIGIN_NOT_ALLOWED');
  });

  it('has no members, no sharing and no workspace management, whoever asks', async () => {
    const h = await harness();
    const { cookie } = await h.signIn({
      provider: 'google',
      subject: 'g-1',
      email: 'a@example.com',
    });
    for (const [method, url] of [
      ['GET', '/api/workspace/members'],
      ['PUT', '/api/workspace/members/someone'],
      ['DELETE', '/api/workspace/members/someone'],
      ['GET', '/api/projects/00000000-0000-4000-8000-000000000000/members'],
      ['PUT', '/api/projects/00000000-0000-4000-8000-000000000000/members/someone'],
      ['DELETE', '/api/projects/00000000-0000-4000-8000-000000000000/members/someone'],
    ] as const) {
      const response = await h.app.inject({
        method,
        url,
        headers: { cookie, ...csrf, ...json },
        payload: method === 'PUT' ? { role: 'owner' } : undefined,
      });
      expect(response.statusCode, `${method} ${url}`).toBe(404);
      expect(response.json().error.code).toBe('NOT_AVAILABLE');
    }
    // Not even without a session: the answer does not depend on who asks.
    expect((await h.app.inject({ method: 'GET', url: '/api/workspace/members' })).statusCode).toBe(
      404,
    );
  });

  it('makes a person the owner of one workspace and nothing else, and decides administrators from the address', async () => {
    const h = await harness();
    const person = await h.signIn({ provider: 'google', subject: 'g-1', email: 'a@example.com' });
    const admin = await h.signIn({
      provider: 'google',
      subject: 'g-2',
      email: 'Admin@Example.com',
    });
    const workspace = await h.app.inject({
      method: 'GET',
      url: '/api/workspace',
      headers: { cookie: person.cookie },
    });
    expect(workspace.statusCode).toBe(200);
    expect(
      (
        await h.app.inject({
          method: 'GET',
          url: '/api/account',
          headers: { cookie: admin.cookie },
        })
      ).json().isAdmin,
    ).toBe(true);
    expect(
      (
        await h.app.inject({
          method: 'GET',
          url: '/api/account',
          headers: { cookie: person.cookie },
        })
      ).json().isAdmin,
    ).toBe(false);
    expect(
      (
        await h.app.inject({
          method: 'GET',
          url: '/api/audit/verify',
          headers: { cookie: person.cookie },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await h.app.inject({
          method: 'GET',
          url: '/api/audit/verify',
          headers: { cookie: admin.cookie },
        })
      ).statusCode,
    ).toBe(200);
  });
});

describe('who may sign up', () => {
  it('lets existing people in and refuses new accounts when sign-ups are closed', async () => {
    const h = await harness();
    await h.signIn({ provider: 'google', subject: 'g-1', email: 'a@example.com' });
    h.built.repository.asSystem(() =>
      h.built.publicEdition!.context.settings.setFlag('signups_enabled', false),
    );
    await h.signIn({ provider: 'google', subject: 'g-1', email: 'a@example.com' });
    await expect(
      h.signIn({ provider: 'google', subject: 'g-2', email: 'b@example.com' }),
    ).rejects.toThrow(/signin=closed/u);
    expect(
      (
        (await h.app.inject({ method: 'GET', url: '/api/public/session' })).json() as {
          signupsOpen: boolean;
        }
      ).signupsOpen,
    ).toBe(false);
  });

  it('refuses a domain that is blocked', async () => {
    const h = await harness({ PUBLIC_BLOCKED_EMAIL_DOMAINS: 'mailinator.com, tempmail.test' });
    await expect(
      h.signIn({ provider: 'google', subject: 'g-1', email: 'x@mailinator.com' }),
    ).rejects.toThrow(/signin=blocked/u);
    await h.signIn({ provider: 'google', subject: 'g-2', email: 'x@example.com' });
  });

  it('throttles accounts made from one address, and from everywhere together', async () => {
    const h = await harness({ PUBLIC_SIGNUPS_PER_IP_PER_DAY: '2', PUBLIC_SIGNUPS_PER_HOUR: '3' });
    await h.signIn({
      provider: 'google',
      subject: 'g-1',
      email: 'a@example.com',
      ip: '203.0.113.5',
    });
    await h.signIn({
      provider: 'google',
      subject: 'g-2',
      email: 'b@example.com',
      ip: '203.0.113.5',
    });
    await expect(
      h.signIn({ provider: 'google', subject: 'g-3', email: 'c@example.com', ip: '203.0.113.5' }),
    ).rejects.toThrow(/signin=blocked/u);
    await h.signIn({
      provider: 'google',
      subject: 'g-4',
      email: 'd@example.com',
      ip: '203.0.113.6',
    });
    await expect(
      h.signIn({ provider: 'google', subject: 'g-5', email: 'e@example.com', ip: '203.0.113.7' }),
    ).rejects.toThrow(/signin=blocked/u);
    // Signing in again to an account that exists is not signing up.
    await h.signIn({
      provider: 'google',
      subject: 'g-1',
      email: 'a@example.com',
      ip: '203.0.113.5',
    });
    // And nothing identifies the address that was throttled.
    const log = h.built.repository.asSystem(() =>
      h.built.repository.extend((db) => db.prepare('SELECT ip_hash FROM signup_log').all()),
    );
    expect(JSON.stringify(log)).not.toContain('203.0.113');
  });

  it('switches an account off at once, and refuses it at sign-in', async () => {
    const h = await harness();
    const { cookie } = await h.signIn({
      provider: 'google',
      subject: 'g-1',
      email: 'a@example.com',
    });
    const user = h.built.repository.asSystem(() =>
      h.built.publicEdition!.context.users.find('google', 'g-1')!,
    );
    h.built.repository.asSystem(() =>
      h.built.publicEdition!.context.users.setDisabled(user.id, true, 'abuse'),
    );
    const refused = await h.app.inject({ method: 'GET', url: '/api/account', headers: { cookie } });
    expect(refused.statusCode).toBe(401);
    await expect(
      h.signIn({ provider: 'google', subject: 'g-1', email: 'a@example.com' }),
    ).rejects.toThrow(/signin=disabled/u);
  });
});

describe('what anyone may ask without signing in', () => {
  it('describes the site, and offers the providers that are configured', async () => {
    const h = await harness();
    const response = await h.app.inject({ method: 'GET', url: '/api/public/session' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      edition: 'public',
      signedIn: false,
      signupsOpen: true,
      bot: null,
      byokEnabled: true,
      user: null,
      session: null,
      providers: [
        { id: 'google', label: 'Google' },
        { id: 'github', label: 'GitHub' },
      ],
      legal: { terms: '/legal/terms', privacy: '/legal/privacy' },
    });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('knows who is signed in, without naming them in full', async () => {
    const h = await harness();
    const { cookie } = await h.signIn({
      provider: 'github',
      subject: '12',
      email: 'octo@example.com',
    });
    const body = (
      await h.app.inject({ method: 'GET', url: '/api/public/session', headers: { cookie } })
    ).json();
    expect(body.signedIn).toBe(true);
    expect(body.user).toMatchObject({
      emailMasked: 'o***@example.com',
      provider: 'github',
      isAdmin: false,
    });
    expect(JSON.stringify(body)).not.toContain('octo@example.com');
  });

  it('serves the terms and the privacy notice as text, marked as not yet reviewed while they are stubs', async () => {
    const h = await harness();
    const terms = (await h.app.inject({ method: 'GET', url: '/api/public/legal/terms' })).json();
    expect(terms).toMatchObject({ title: 'Terms of use', reviewed: false });
    expect(terms.text).toContain('NOT YET REVIEWED');
    expect(
      (await h.app.inject({ method: 'GET', url: '/api/public/legal/privacy' })).json().reviewed,
    ).toBe(false);
    expect(
      (await h.app.inject({ method: 'GET', url: '/api/public/legal/secrets' })).statusCode,
    ).toBe(400);
  });

  it('reports its status, and a maintenance message when the owner sets one', async () => {
    const h = await harness();
    expect((await h.app.inject({ method: 'GET', url: '/api/public/status' })).json()).toMatchObject(
      { status: 'degraded', byokEnabled: true, signupsOpen: true, message: null },
    );
    h.built.repository.asSystem(() =>
      h.built.publicEdition!.context.settings.set('maintenance_message', 'Back in ten minutes.'),
    );
    expect((await h.app.inject({ method: 'GET', url: '/api/public/status' })).json()).toMatchObject(
      { status: 'maintenance', message: 'Back in ten minutes.' },
    );
  });
});

describe('deleting an account', () => {
  it('asks for the exact words, then deletes everything of the person’s, and nothing of anyone else’s', async () => {
    const h = await harness();
    const alice = await h.signIn({
      provider: 'google',
      subject: 'g-1',
      email: 'alice@example.com',
    });
    const bob = await h.signIn({ provider: 'github', subject: '77', email: 'bob@example.com' });
    const made = await h.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { cookie: alice.cookie, ...csrf, ...json },
      payload: fixtureInput({
        name: 'Alice project',
        documents: [
          {
            name: 'a.md',
            content: `${sourceText}\nAlice wrote this document about prices rising.`,
          },
        ],
      }),
    });
    expect(made.statusCode).toBe(201);
    await h.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { cookie: bob.cookie, ...csrf, ...json },
      payload: fixtureInput({
        name: 'Bob project',
        documents: [
          {
            name: 'b.md',
            content: `${sourceText}\nBob wrote this other document about rates falling.`,
          },
        ],
      }),
    });

    const wrong = await h.app.inject({
      method: 'DELETE',
      url: '/api/account',
      headers: { cookie: alice.cookie, ...csrf, ...json },
      payload: { confirm: 'yes' },
    });
    expect(wrong.statusCode).toBe(400);
    expect(
      (
        await h.app.inject({
          method: 'GET',
          url: '/api/account',
          headers: { cookie: alice.cookie },
        })
      ).statusCode,
    ).toBe(200);

    const gone = await h.app.inject({
      method: 'DELETE',
      url: '/api/account',
      headers: { cookie: alice.cookie, ...csrf, ...json },
      payload: { confirm: 'delete my account' },
    });
    expect(gone.statusCode).toBe(204);
    expect(String(gone.headers['set-cookie'])).toContain('Max-Age=0');
    expect(
      (
        await h.app.inject({
          method: 'GET',
          url: '/api/account',
          headers: { cookie: alice.cookie },
        })
      ).statusCode,
    ).toBe(401);

    // Nothing is left that names her, in any table, in any text column.
    const user = { id: '', workspace: '' };
    void user;
    const leftovers = h.built.repository.asSystem(() =>
      h.built.repository.extend((db) => {
        const tables = db
          .prepare(
            `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`,
          )
          .all()
          .map((row) => String(row.t));
        const found: string[] = [];
        for (const table of tables) {
          const columns = db
            .prepare(
              `SELECT column_name AS c FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?`,
            )
            .all(table)
            .map((row) => String(row.c));
          for (const column of columns) {
            for (const needle of ['alice@example.com', 'Alice wrote', 'Alice project', 'g-1']) {
              const hit = db
                .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE CAST(${column} AS TEXT) LIKE ?`)
                .get(`%${needle}%`);
              if (Number(hit?.n) > 0) found.push(`${table}.${column} ~ ${needle}`);
            }
          }
        }
        return found;
      }),
    );
    expect(leftovers).toEqual([]);
    // Bob is untouched.
    const bobs = await h.app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { cookie: bob.cookie },
    });
    expect(bobs.json().projects).toHaveLength(1);
    // The audit log kept that it happened, and that is all it kept.
    const audit = h.built.repository.asSystem(() => h.built.repository.audit.list({ limit: 500 }));
    expect(audit.some((event) => event.action === 'public.account.deleted')).toBe(true);
    expect(JSON.stringify(audit)).not.toContain('alice@example.com');
    expect(h.built.repository.asSystem(() => h.built.repository.audit.verify()).ok).toBe(true);
  });

  it('keeps a counter of the free tokens used for the retention period, and forgets it when told to keep nothing', async () => {
    const h = await harness();
    const { cookie } = await h.signIn({
      provider: 'google',
      subject: 'g-1',
      email: 'a@example.com',
    });
    const user = h.built.repository.asSystem(() =>
      h.built.publicEdition!.context.users.find('google', 'g-1')!,
    );
    h.built.repository.asSystem(() =>
      h.built.repository.extend((db) =>
        db
          .prepare(
            `INSERT INTO usage_lifetime (subject, tokens, calls, updated_at) VALUES (?, 12345, 3, 1)`,
          )
          .run(`u:${user.workspaceId}`),
      ),
    );
    await h.app.inject({
      method: 'DELETE',
      url: '/api/account',
      headers: { cookie, ...csrf, ...json },
      payload: { confirm: 'delete my account' },
    });
    const kept = h.built.repository.asSystem(() =>
      h.built.repository.extend((db) =>
        db.prepare('SELECT key_hash, lifetime_tokens FROM deleted_accounts').all(),
      ),
    );
    expect(kept).toHaveLength(1);
    expect(Number(kept[0]!.lifetime_tokens)).toBe(12345);
    expect(JSON.stringify(kept)).not.toContain('g-1');
    expect(String(kept[0]!.key_hash)).toMatch(/^[0-9a-f]{64}$/u);
    // Signing up again does not reset the allowance.
    await h.signIn({ provider: 'google', subject: 'g-1', email: 'a@example.com' });
    const again = h.built.repository.asSystem(() =>
      h.built.publicEdition!.context.users.find('google', 'g-1')!,
    );
    const restored = h.built.repository.asSystem(() =>
      h.built.repository.extend((db) =>
        db
          .prepare('SELECT tokens FROM usage_lifetime WHERE subject = ?')
          .get(`u:${again.workspaceId}`),
      ),
    );
    expect(Number(restored?.tokens)).toBe(12345);

    const nothing = await harness({ PUBLIC_DELETED_ACCOUNT_RETENTION_DAYS: '0' });
    const second = await nothing.signIn({
      provider: 'google',
      subject: 'g-9',
      email: 'z@example.com',
    });
    const u = nothing.built.repository.asSystem(() =>
      nothing.built.publicEdition!.context.users.find('google', 'g-9')!,
    );
    nothing.built.repository.asSystem(() =>
      nothing.built.repository.extend((db) =>
        db
          .prepare(
            `INSERT INTO usage_lifetime (subject, tokens, calls, updated_at) VALUES (?, 5, 1, 1)`,
          )
          .run(`u:${u.workspaceId}`),
      ),
    );
    await nothing.app.inject({
      method: 'DELETE',
      url: '/api/account',
      headers: { cookie: second.cookie, ...csrf, ...json },
      payload: { confirm: 'delete my account' },
    });
    expect(
      nothing.built.repository.asSystem(() =>
        nothing.built.repository.extend((db) =>
          db.prepare('SELECT COUNT(*) AS n FROM deleted_accounts').get(),
        ),
      )?.n,
    ).toBe(0);
  });
});

void FakeProviders;
