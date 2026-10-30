import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { readCookie, serializeCookie } from '../src/auth/cookies.js';
import { pkceChallenge, safeReturnTo } from '../src/auth/oidc.js';
import { TokenVerifier } from '../src/auth/tokens.js';
import { loadConfig, publicConfig } from '../src/config.js';
import { Repository } from '../src/storage/repository.js';
import { fixtureInput, testConfig } from './fixtures.js';
import {
  TENANT_A,
  TENANT_B,
  authorization,
  entraEnvironment,
  idp,
  mint,
  type Minted,
} from './support/entra-idp.js';

const CLIENT_ID = 'cccccccc-0000-4000-8000-0000000000aa';
const HOST = 'swarm.example.test';
const REDIRECT = `https://${HOST}/auth/callback`;
const PERSON = 'eeeeeee1-0000-4000-8000-000000000001';
const OTHER = 'eeeeeee2-0000-4000-8000-000000000002';
const NO_ROLE = 'eeeeeee3-0000-4000-8000-000000000003';
const ACCESS_TOKEN_CANARY = 'ACCESS-TOKEN-CANARY-DO-NOT-STORE';

const environment = {
  ...entraEnvironment,
  AUTH_ENTRA_CLIENT_ID: CLIENT_ID,
  AUTH_ENTRA_REDIRECT_URI: REDIRECT,
  ALLOWED_HOSTS: `${HOST},localhost,127.0.0.1`,
  ALLOWED_ORIGINS: `https://${HOST}`,
  LOG_LEVEL: 'silent',
};

const applications: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

interface TokenCall {
  url: string;
  form: URLSearchParams;
}

/**
 * A test identity provider's token endpoint. It knows the codes it issued, and redeems one only for
 * the browser that was sent, with the verifier whose challenge was in the authorize request: that is
 * what PKCE is for, so a code taken in transit is no use without the verifier.
 */
function fakeProvider() {
  const issued = new Map<string, { challenge: string; idToken: () => Promise<string> }>();
  const calls: TokenCall[] = [];
  let mode: 'ok' | 'error' | 'garbage' | 'no-id-token' | 'network' = 'ok';
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    const form = new URLSearchParams(String(init?.body ?? ''));
    calls.push({ url, form });
    if (mode === 'network') throw new TypeError('connection refused');
    if (mode === 'error') return Response.json({ error: 'server_error' }, { status: 500 });
    if (mode === 'garbage') return new Response('<html>not json</html>', { status: 200 });
    if (mode === 'no-id-token') return Response.json({ access_token: ACCESS_TOKEN_CANARY });
    const code = form.get('code') ?? '';
    const grant = issued.get(code);
    const verifier = form.get('code_verifier') ?? '';
    if (
      !grant ||
      form.get('grant_type') !== 'authorization_code' ||
      form.get('client_id') !== CLIENT_ID ||
      form.get('redirect_uri') !== REDIRECT ||
      pkceChallenge(verifier) !== grant.challenge
    ) {
      return Response.json({ error: 'invalid_grant' }, { status: 400 });
    }
    issued.delete(code);
    return Response.json({
      token_type: 'Bearer',
      access_token: ACCESS_TOKEN_CANARY,
      id_token: await grant.idToken(),
    });
  };
  return {
    fetcher,
    calls,
    setMode: (next: typeof mode) => {
      mode = next;
    },
    /** The identity provider authenticates the person and hands back a code for this request. */
    approve(request: { challenge: string; nonce: string }, claims: Minted = {}): string {
      const code = `code-${issued.size + calls.length}-${Math.random().toString(36).slice(2)}`;
      issued.set(code, {
        challenge: request.challenge,
        idToken: () =>
          mint({
            aud: CLIENT_ID,
            oid: PERSON,
            roles: ['Swarm.User'],
            nonce: request.nonce,
            ...claims,
          }),
      });
      return code;
    },
  };
}

async function setup(
  options: {
    extra?: Record<string, string>;
    now?: () => number;
    logStream?: { write(m: string): void };
  } = {},
) {
  const config = testConfig({ ...environment, ...options.extra });
  const provider = fakeProvider();
  const repository = new Repository(':memory:', options.now ? { now: options.now } : {});
  const instance = await buildApp({
    config,
    repository,
    tokenVerifier: new TokenVerifier(config.auth, idp.keys),
    oidc: { fetcher: provider.fetcher },
    ...(options.logStream ? { logStream: options.logStream } : {}),
  });
  applications.push(instance);
  return { ...instance, provider, config };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const headers = (cookie?: string, extra: Record<string, string> = {}) => ({
  host: HOST,
  ...(cookie ? { cookie } : {}),
  ...extra,
});

const setCookies = (response: { headers: Record<string, unknown> }): string[] => {
  const value = response.headers['set-cookie'];
  return Array.isArray(value) ? (value as string[]) : value ? [String(value)] : [];
};

const cookieValue = (cookie: string): string => cookie.split(';')[0]!.split('=')[1]!;

interface Login {
  state: string;
  nonce: string;
  challenge: string;
  bindingCookie: string;
  location: URL;
}

async function beginLogin(instance: Setup, returnTo?: string): Promise<Login> {
  const response = await instance.app.inject({
    method: 'GET',
    url: `/auth/login${returnTo === undefined ? '' : `?returnTo=${encodeURIComponent(returnTo)}`}`,
    headers: headers(),
  });
  expect(response.statusCode, response.body).toBe(302);
  const location = new URL(String(response.headers.location));
  const binding = setCookies(response).find((cookie) => cookie.startsWith('__Host-swarm_login='));
  expect(binding, 'the login cookie').toBeDefined();
  return {
    state: location.searchParams.get('state')!,
    nonce: location.searchParams.get('nonce')!,
    challenge: location.searchParams.get('code_challenge')!,
    bindingCookie: `__Host-swarm_login=${cookieValue(binding!)}`,
    location,
  };
}

/** Sign in end to end as the browser would, and return the session cookie to send afterwards. */
async function signIn(instance: Setup, claims: Minted = {}, returnTo?: string) {
  const login = await beginLogin(instance, returnTo);
  const code = instance.provider.approve(login, claims);
  const response = await instance.app.inject({
    method: 'GET',
    url: `/auth/callback?code=${code}&state=${login.state}`,
    headers: headers(login.bindingCookie),
  });
  const session = setCookies(response).find((cookie) => cookie.startsWith('__Host-swarm_session='));
  return {
    response,
    login,
    session,
    cookie: session ? `__Host-swarm_session=${cookieValue(session)}` : null,
  };
}

describe('configuring browser sign-in', () => {
  it('is off unless a client and a redirect address are both given', () => {
    expect(testConfig(entraEnvironment).auth.session).toBeNull();
    expect(publicConfig(testConfig(entraEnvironment)).capabilities.authentication).toBe('entra');
    const config = testConfig(environment);
    expect(config.auth.session).toMatchObject({
      clientId: CLIENT_ID,
      redirectUri: REDIRECT,
      authorityTenant: 'organizations',
      clientSecret: null,
      idleMinutes: 30,
      absoluteHours: 8,
      secureCookies: true,
    });
    expect(publicConfig(config).capabilities.authentication).toBe('entra-session');
    // What the browser is told about it carries no identifier.
    expect(JSON.stringify(publicConfig(config))).not.toContain(CLIENT_ID);
    expect(JSON.stringify(publicConfig(config))).not.toContain(TENANT_A);
  });

  it('uses the one allowed tenant as the authority, and refuses half a setup', () => {
    const single = testConfig({ ...environment, AUTH_ENTRA_ALLOWED_TENANTS: '' });
    expect(single.auth.session?.authorityTenant).toBe(TENANT_A);
    expect(() => testConfig({ ...entraEnvironment, AUTH_ENTRA_CLIENT_ID: CLIENT_ID })).toThrow(
      /both AUTH_ENTRA_CLIENT_ID and AUTH_ENTRA_REDIRECT_URI/u,
    );
    expect(() => testConfig({ ...entraEnvironment, AUTH_ENTRA_REDIRECT_URI: REDIRECT })).toThrow(
      /both AUTH_ENTRA_CLIENT_ID and AUTH_ENTRA_REDIRECT_URI/u,
    );
  });

  it('accepts an https redirect, or http on localhost, and nothing else', () => {
    const redirect = (value: string) =>
      testConfig({
        ...environment,
        AUTH_ENTRA_REDIRECT_URI: value,
        ALLOWED_HOSTS: `${HOST},localhost`,
      });
    expect(redirect('http://localhost:3001/auth/callback').auth.session?.secureCookies).toBe(false);
    for (const bad of [
      `http://${HOST}/auth/callback`,
      `https://${HOST}/auth/other`,
      `https://${HOST}/auth/callback?x=1`,
      `https://${HOST}/auth/callback#frag`,
      `https://user:pass@${HOST}/auth/callback`,
      'not a url',
      'javascript:alert(1)',
    ]) {
      expect(() => redirect(bad), bad).toThrow(/AUTH_ENTRA_REDIRECT_URI/u);
    }
  });

  it('requires the redirect host to be an allowed host, or the reply would be refused', () => {
    expect(() => testConfig({ ...environment, ALLOWED_HOSTS: 'localhost' })).toThrow(
      /ALLOWED_HOSTS/u,
    );
  });

  it('bounds the lifetimes, and reads a secret only from the environment', () => {
    expect(() => testConfig({ ...environment, AUTH_SESSION_IDLE_MINUTES: '1' })).toThrow();
    expect(() => testConfig({ ...environment, AUTH_SESSION_ABSOLUTE_HOURS: '100' })).toThrow();
    const config = testConfig({ ...environment, AUTH_ENTRA_CLIENT_SECRET: 'from-a-secret-store' });
    expect(config.auth.session?.clientSecret).toBe('from-a-secret-store');
    expect(JSON.stringify(publicConfig(config))).not.toContain('from-a-secret-store');
  });

  it('ignores all of it when there is no sign-in', () => {
    const config = loadConfig({});
    expect(config.auth.session).toBeNull();
  });
});

describe('cookies and return addresses', () => {
  it('reads one cookie by name, and nothing malformed', () => {
    const value = 'A'.repeat(43);
    expect(readCookie(`a=1; __Host-swarm_session=${value}; b=2`, '__Host-swarm_session')).toBe(
      value,
    );
    expect(readCookie(undefined, 'x')).toBeNull();
    expect(readCookie(`s=short`, 's')).toBeNull();
    expect(readCookie(`s=${'A'.repeat(129)}`, 's')).toBeNull();
    expect(readCookie(`s=${value}%00`, 's')).toBeNull();
    expect(readCookie(`s=${value}`, 'not a name')).toBeNull();
    expect(readCookie('x'.repeat(5_000), 'x')).toBeNull();
  });

  it('writes a cookie that scripts cannot read, other sites do not send, and plain http does not carry', () => {
    const cookie = serializeCookie('__Host-swarm_session', 'B'.repeat(43), {
      maxAge: 600,
      secure: true,
    });
    expect(cookie).toBe(
      `__Host-swarm_session=${'B'.repeat(43)}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax; Secure`,
    );
    expect(
      serializeCookie('swarm_session', 'B'.repeat(43), { maxAge: 5, secure: false }),
    ).not.toContain('Secure');
    expect(serializeCookie('s', '', { maxAge: 0, secure: true })).toContain('Max-Age=0');
    expect(() => serializeCookie('s', 'a;b=c; Domain=evil', { maxAge: 1, secure: true })).toThrow();
    expect(() =>
      serializeCookie('bad name', 'B'.repeat(43), { maxAge: 1, secure: true }),
    ).toThrow();
  });

  it('only ever returns to a path on this site', () => {
    expect(safeReturnTo('/')).toBe('/');
    expect(safeReturnTo('/?project=abc#frag')).toBe('/?project=abc#frag');
    for (const bad of [
      undefined,
      '',
      'https://evil.example/',
      '//evil.example/',
      '/\\evil.example',
      '\\\\evil.example',
      'javascript:alert(1)',
      'evil.example',
      '/ok\r\nSet-Cookie: x=y',
      '/ok\u0000',
      `/${'a'.repeat(600)}`,
      42,
    ]) {
      expect(safeReturnTo(bad), String(bad)).toBe('/');
    }
  });
});

describe('starting a sign-in', () => {
  it('derives the PKCE challenge exactly as RFC 7636 appendix B does', () => {
    // Both sides of the other tests call this function, so only a known answer can catch a wrong one.
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('sends the browser to Microsoft with PKCE, a state and a nonce, and keeps the verifier to itself', async () => {
    const instance = await setup();
    const login = await beginLogin(instance, '/?project=abc');
    const { location } = login;
    expect(`${location.origin}${location.pathname}`).toBe(
      `https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize`,
    );
    const q = location.searchParams;
    expect(q.get('client_id')).toBe(CLIENT_ID);
    expect(q.get('response_type')).toBe('code');
    expect(q.get('redirect_uri')).toBe(REDIRECT);
    expect(q.get('response_mode')).toBe('query');
    // Identity only: no API access, and no offline_access, so no refresh token exists to steal.
    expect(q.get('scope')).toBe('openid profile');
    expect(q.get('code_challenge_method')).toBe('S256');
    for (const value of [login.state, login.nonce, login.challenge]) {
      expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    }
    expect(new Set([login.state, login.nonce, login.challenge]).size).toBe(3);
    expect(q.get('client_secret')).toBeNull();
    expect(location.search).not.toContain('returnTo');
  });

  it('keeps the browser binding in a cookie scripts cannot read, and only hashes in the database', async () => {
    const instance = await setup();
    const response = await instance.app.inject({
      method: 'GET',
      url: '/auth/login',
      headers: headers(),
    });
    const cookie = setCookies(response).find((value) => value.startsWith('__Host-swarm_login='))!;
    expect(cookie).toMatch(/Path=\/; Max-Age=600; HttpOnly; SameSite=Lax; Secure$/u);
    expect(response.headers['cache-control']).toBe('no-store');
    const database = (
      instance.repository as unknown as { database: { prepare(sql: string): { all(): unknown[] } } }
    ).database;
    const rows = JSON.stringify(database.prepare('SELECT * FROM login_attempts').all());
    const binding = cookieValue(cookie);
    const state = new URL(String(response.headers.location)).searchParams.get('state')!;
    expect(rows).not.toContain(binding);
    expect(rows).not.toContain(state);
  });

  it('is not there when sign-in is not configured', async () => {
    const config = testConfig(entraEnvironment);
    const instance = await buildApp({
      config,
      tokenVerifier: new TokenVerifier(config.auth, idp.keys),
    });
    applications.push(instance);
    for (const [method, url] of [
      ['GET', '/auth/login'],
      ['GET', '/auth/callback'],
      ['POST', '/auth/logout'],
    ] as const) {
      expect((await instance.app.inject({ method, url })).statusCode, url).toBe(404);
    }
  });
});

describe('finishing a sign-in', () => {
  it('turns a good reply into a session, redirects to where the person was going, and keeps no token', async () => {
    const instance = await setup();
    const { response, session, cookie, login } = await signIn(instance, {}, '/?project=abc');
    expect(response.statusCode, response.body).toBe(302);
    expect(response.headers.location).toBe('/?project=abc');
    expect(session).toMatch(
      /^__Host-swarm_session=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=28800; HttpOnly; SameSite=Lax; Secure$/u,
    );
    expect(response.headers['cache-control']).toBe('no-store');
    // The login cookie is cleared once it has done its job.
    expect(
      setCookies(response).some((value) => /^__Host-swarm_login=; .*Max-Age=0/u.test(value)),
    ).toBe(true);

    // The token request carried the verifier whose challenge went out, and no secret.
    const call = instance.provider.calls[0]!;
    expect(pkceChallenge(call.form.get('code_verifier')!)).toBe(login.challenge);
    expect(call.form.get('client_secret')).toBeNull();
    expect(call.url).toBe('https://login.microsoftonline.com/organizations/oauth2/v2.0/token');

    // Nothing the identity provider sent, and nothing derived from it, is stored.
    const database = (
      instance.repository as unknown as { database: { prepare(sql: string): { all(): unknown[] } } }
    ).database;
    const stored = JSON.stringify([
      database.prepare('SELECT * FROM sessions').all(),
      database.prepare('SELECT * FROM login_attempts').all(),
      database.prepare('SELECT * FROM audit_events').all(),
    ]);
    expect(stored).not.toContain(ACCESS_TOKEN_CANARY);
    expect(stored).not.toMatch(/eyJ[\w-]{10,}\./u);
    expect(stored).not.toContain(cookieValue(cookie!));
    expect(instance.repository.audit.list({ limit: 20 }).map((entry) => entry.action)).toContain(
      'session.started',
    );
  });

  it('lets the session reach the API, with the same rules as a token', async () => {
    const instance = await setup();
    instance.repository.members.setWorkspaceMember({
      tenantId: TENANT_A,
      principalId: PERSON,
      role: 'member',
      actor: { id: 'setup', workspaceRole: 'owner' },
    });
    const { cookie } = await signIn(instance);
    const created = await instance.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: headers(cookie!, { 'x-swarm-csrf': '1', origin: `https://${HOST}` }),
      payload: fixtureInput(),
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(instance.repository.members.projectRole(created.json().id, PERSON)).toBe('lead');
    const list = await instance.app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: headers(cookie!),
    });
    expect(list.json().total).toBe(1);
    // A person signed in, who belongs to nothing, sees nothing: membership decides, not the sign-in.
    const stranger = await signIn(instance, { oid: OTHER });
    const none = await instance.app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: headers(stranger.cookie!),
    });
    expect(none.json()).toMatchObject({ projects: [], total: 0 });
    expect(
      (
        await instance.app.inject({
          method: 'GET',
          url: `/api/projects/${created.json().id}`,
          headers: headers(stranger.cookie!),
        })
      ).statusCode,
    ).toBe(404);
  });

  it('gives every sign-in a new session, even for the same person', async () => {
    const instance = await setup();
    const first = await signIn(instance);
    const second = await signIn(instance);
    expect(first.cookie).not.toBe(second.cookie);
    expect(
      (
        await instance.app.inject({
          method: 'GET',
          url: '/api/workspace',
          headers: headers(first.cookie!),
        })
      ).statusCode,
    ).toBe(200);
  });

  it('sends a person who has no Swarm role to say so, and starts no session', async () => {
    const instance = await setup();
    const { response, session } = await signIn(instance, {
      oid: NO_ROLE,
      roles: ['Contoso.Admin'],
    });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/?signin=norole');
    expect(session).toBeUndefined();
  });

  describe('refuses, and starts nothing, when', () => {
    async function refused(instance: Setup, run: () => ReturnType<typeof signIn>) {
      const { response, session } = await run();
      expect(response.statusCode, response.body).toBe(302);
      expect(response.headers.location).toBe('/?signin=failed');
      expect(session).toBeUndefined();
      const database = (
        instance.repository as unknown as {
          database: { prepare(sql: string): { all(): unknown[] } };
        }
      ).database;
      expect(database.prepare('SELECT * FROM sessions').all()).toEqual([]);
      // The failure says nothing about why, and the login cookie is cleared.
      expect(
        setCookies(response).some((value) => /^__Host-swarm_login=; .*Max-Age=0/u.test(value)),
      ).toBe(true);
    }

    it('the reply is replayed', async () => {
      const instance = await setup();
      const login = await beginLogin(instance);
      const code = instance.provider.approve(login);
      const url = `/auth/callback?code=${code}&state=${login.state}`;
      const first = await instance.app.inject({
        method: 'GET',
        url,
        headers: headers(login.bindingCookie),
      });
      expect(first.headers.location).toBe('/');
      const again = await instance.app.inject({
        method: 'GET',
        url,
        headers: headers(login.bindingCookie),
      });
      expect(again.headers.location).toBe('/?signin=failed');
      expect(setCookies(again).some((value) => value.startsWith('__Host-swarm_session='))).toBe(
        false,
      );
    });

    it('it did not start in this browser, or came from nowhere', async () => {
      const instance = await setup();
      const login = await beginLogin(instance);
      const code = instance.provider.approve(login);
      const url = `/auth/callback?code=${code}&state=${login.state}`;
      // No cookie at all, and someone else's cookie, and the right cookie once the state is spent.
      for (const cookie of [undefined, `__Host-swarm_login=${'z'.repeat(43)}`]) {
        const response = await instance.app.inject({
          method: 'GET',
          url,
          headers: headers(cookie),
        });
        expect(response.headers.location, String(cookie)).toBe('/?signin=failed');
      }
      const unknown = await instance.app.inject({
        method: 'GET',
        url: `/auth/callback?code=${code}&state=${'y'.repeat(43)}`,
        headers: headers(login.bindingCookie),
      });
      expect(unknown.headers.location).toBe('/?signin=failed');
      // The attempts above spent nothing that belonged to this browser's own state.
      const real = await instance.app.inject({
        method: 'GET',
        url,
        headers: headers(login.bindingCookie),
      });
      expect(real.headers.location).toBe('/?signin=failed');
    });

    it('Microsoft reports an error, or sends no code', async () => {
      const instance = await setup();
      for (const query of ['error=access_denied&error_description=nope', 'state=x', '']) {
        const login = await beginLogin(instance);
        const url = `/auth/callback?${query}${query ? '&' : ''}state=${login.state}`;
        const response = await instance.app.inject({
          method: 'GET',
          url,
          headers: headers(login.bindingCookie),
        });
        expect(response.headers.location, query).toBe('/?signin=failed');
      }
    });

    it('Microsoft reports an error but a code is attached: the code is never redeemed', async () => {
      const instance = await setup();
      const login = await beginLogin(instance);
      const code = instance.provider.approve(login);
      const response = await instance.app.inject({
        method: 'GET',
        url: `/auth/callback?error=access_denied&code=${code}&state=${login.state}`,
        headers: headers(login.bindingCookie),
      });
      expect(response.headers.location).toBe('/?signin=failed');
      expect(setCookies(response).some((value) => value.startsWith('__Host-swarm_session='))).toBe(
        false,
      );
      expect(instance.provider.calls).toEqual([]);
    });

    it.each(['error', 'garbage', 'no-id-token', 'network'] as const)(
      'the token endpoint answers badly (%s)',
      async (mode) => {
        const instance = await setup();
        instance.provider.setMode(mode);
        await refused(instance, () => signIn(instance));
      },
    );

    it('the code was issued for another verifier', async () => {
      const instance = await setup();
      const login = await beginLogin(instance);
      const code = instance.provider.approve({
        challenge: pkceChallenge('someone-elses-verifier'),
        nonce: login.nonce,
      });
      const response = await instance.app.inject({
        method: 'GET',
        url: `/auth/callback?code=${code}&state=${login.state}`,
        headers: headers(login.bindingCookie),
      });
      expect(response.headers.location).toBe('/?signin=failed');
    });

    it.each([
      ['the nonce is not the one that was sent', { nonce: 'n'.repeat(43) }],
      ['the token has no nonce', { nonce: null }],
      ['it was issued for another application', { aud: 'api://elsewhere' }],
      [
        'it was issued by another tenant’s authority',
        { tid: '99999999-9999-4999-8999-999999999999' },
      ],
      [
        'it names a tenant this server was not told to accept',
        { tid: '33333333-3333-4333-8333-333333333333' },
      ],
      ['it has expired', { exp: Math.floor(Date.now() / 1000) - 3_600 }],
      ['it has no object id', { oid: null }],
      ['it was signed with another key', { key: idp.attackerKey }],
      ['it claims another issuer', { iss: 'https://evil.example/v2.0' }],
    ] as const)('the ID token is wrong: %s', async (_name, claims) => {
      const instance = await setup();
      await refused(instance, () => signIn(instance, claims as Minted));
    });

    it('the ID token is really an access token for this API', async () => {
      // A bearer token and an ID token must not be interchangeable. This one has no nonce.
      const instance = await setup();
      await refused(instance, () => signIn(instance, { nonce: null, aud: CLIENT_ID }));
    });

    it('the attempt is older than ten minutes', async () => {
      let clock = Date.now();
      const instance = await setup({ now: () => clock });
      const login = await beginLogin(instance);
      const code = instance.provider.approve(login);
      clock += 11 * 60_000;
      const response = await instance.app.inject({
        method: 'GET',
        url: `/auth/callback?code=${code}&state=${login.state}`,
        headers: headers(login.bindingCookie),
      });
      expect(response.headers.location).toBe('/?signin=failed');
    });
  });

  it('never goes anywhere but this site afterwards', async () => {
    const instance = await setup();
    for (const bad of ['https://evil.example/', '//evil.example', '/\\evil.example']) {
      const { response } = await signIn(instance, {}, bad);
      expect(response.headers.location, bad).toBe('/');
    }
  });

  it('sends the client secret only when one was configured', async () => {
    const instance = await setup({ extra: { AUTH_ENTRA_CLIENT_SECRET: 'from-a-secret-store' } });
    await signIn(instance);
    expect(instance.provider.calls[0]!.form.get('client_secret')).toBe('from-a-secret-store');
  });
});

describe('using a session', () => {
  it('asks a person with no credentials to sign in, and says the same to a stale or forged cookie', async () => {
    const instance = await setup();
    const none = await instance.app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: headers(),
    });
    expect(none.statusCode).toBe(401);
    expect(none.json().error.code).toBe('SIGN_IN_REQUIRED');
    const forged = await instance.app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: headers(`__Host-swarm_session=${'q'.repeat(43)}`),
    });
    expect(forged.statusCode).toBe(401);
    expect(forged.json().error.code).toBe('SIGN_IN_REQUIRED');
    expect(forged.json().error.message).toBe(none.json().error.message);
    // The sign-in page itself needs no session, and neither does the health probe.
    expect(
      (await instance.app.inject({ method: 'GET', url: '/api/health', headers: headers() }))
        .statusCode,
    ).toBe(200);
  });

  it('does not fall back to the local user when nothing authenticates, in any form', async () => {
    const instance = await setup();
    for (const url of [
      '/api/projects',
      '/api/config',
      '/api/workspace',
      '/api/session',
      '/api/provider/status',
    ]) {
      expect(
        (await instance.app.inject({ method: 'GET', url, headers: headers() })).statusCode,
        url,
      ).toBe(401);
    }
    expect(
      (
        await instance.app.inject({
          method: 'POST',
          url: '/api/projects',
          headers: headers(undefined, { 'x-swarm-csrf': '1' }),
          payload: fixtureInput(),
        })
      ).statusCode,
    ).toBe(401);
  });

  it('still accepts a bearer token, which wins over a cookie, and a bad one is not rescued by it', async () => {
    const instance = await setup();
    const { cookie } = await signIn(instance);
    const token = await authorization({ oid: PERSON, roles: ['Swarm.User'] });
    const bearer = await instance.app.inject({
      method: 'GET',
      url: '/api/workspace',
      headers: { ...headers(), ...token },
    });
    expect(bearer.statusCode).toBe(200);
    const bad = await instance.app.inject({
      method: 'GET',
      url: '/api/workspace',
      headers: headers(cookie!, { authorization: 'Bearer not.a.token' }),
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('is not an access token: an ID token cannot be presented as a bearer token', async () => {
    const instance = await setup({ extra: { AUTH_ENTRA_AUDIENCE: CLIENT_ID } });
    const idToken = await mint({
      aud: CLIENT_ID,
      oid: PERSON,
      roles: ['Swarm.User'],
      nonce: 'n'.repeat(43),
    });
    const response = await instance.app.inject({
      method: 'GET',
      url: '/api/workspace',
      headers: { ...headers(), authorization: `Bearer ${idToken}` },
    });
    expect(response.statusCode).toBe(401);
    // The same claims without a nonce are an access token for this audience, and pass.
    const access = await mint({ aud: CLIENT_ID, oid: PERSON, roles: ['Swarm.User'] });
    expect(
      (
        await instance.app.inject({
          method: 'GET',
          url: '/api/workspace',
          headers: { ...headers(), authorization: `Bearer ${access}` },
        })
      ).statusCode,
    ).toBe(200);
  });

  it('carries the platform administrator role from the token, and only when the token had it', async () => {
    const instance = await setup();
    const ordinary = await signIn(instance);
    const admin = await signIn(instance, {
      oid: OTHER,
      roles: ['Swarm.User', 'Swarm.PlatformAdmin'],
    });
    const verify = (cookie: string) =>
      instance.app.inject({ method: 'GET', url: '/api/audit/verify', headers: headers(cookie) });
    expect((await verify(ordinary.cookie!)).statusCode).toBe(403);
    expect((await verify(admin.cookie!)).statusCode).toBe(200);
  });

  it('requires the anti-forgery header for any change made with a cookie, and not for a token', async () => {
    const instance = await setup();
    instance.repository.members.setWorkspaceMember({
      tenantId: TENANT_A,
      principalId: PERSON,
      role: 'member',
      actor: { id: 'setup', workspaceRole: 'owner' },
    });
    const { cookie } = await signIn(instance);
    const someone = 'eeeeeee4-0000-4000-8000-000000000004';
    const unknownProject = '99999999-0000-4000-8000-000000000009';
    const changes = [
      { method: 'POST', url: '/api/projects', payload: fixtureInput() },
      { method: 'PUT', url: `/api/workspace/members/${someone}`, payload: { role: 'admin' } },
      { method: 'PATCH', url: `/api/projects/${unknownProject}/environment`, payload: {} },
      { method: 'DELETE', url: `/api/workspace/members/${someone}`, payload: undefined },
    ] as const;
    for (const { method, url, payload } of changes) {
      const response = await instance.app.inject({
        method,
        url,
        headers: headers(cookie!, { origin: `https://${HOST}` }),
        ...(payload ? { payload } : {}),
      });
      expect(response.statusCode, `${method} ${url}`).toBe(403);
      expect(response.json().error.code, `${method} ${url}`).toBe('CSRF_REQUIRED');
    }
    expect(instance.repository.list(10, 0, TENANT_A).total).toBe(0);
    expect(instance.repository.members.workspaceRole(TENANT_A, someone)).toBeNull();
    const withHeader = await instance.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: headers(cookie!, { 'x-swarm-csrf': '1', origin: `https://${HOST}` }),
      payload: fixtureInput(),
    });
    expect(withHeader.statusCode, withHeader.body).toBe(201);
    // Reading needs no header, and a bearer token needs none either: it is not sent by a browser unasked.
    expect(
      (
        await instance.app.inject({
          method: 'GET',
          url: '/api/projects',
          headers: headers(cookie!),
        })
      ).statusCode,
    ).toBe(200);
    const token = await authorization({ oid: PERSON, roles: ['Swarm.User'] });
    expect(
      (
        await instance.app.inject({
          method: 'POST',
          url: '/api/projects',
          headers: { ...headers(), ...token },
          payload: fixtureInput(),
        })
      ).statusCode,
    ).toBe(201);
  });

  it('refuses a change from a site that is not this one, whatever the header says', async () => {
    const instance = await setup();
    const { cookie } = await signIn(instance);
    const response = await instance.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: headers(cookie!, { 'x-swarm-csrf': '1', origin: 'https://evil.example' }),
      payload: fixtureInput(),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('ORIGIN_NOT_ALLOWED');
  });

  it('says who is signed in and until when, without saying who they are', async () => {
    const start = Date.now();
    const instance = await setup({ now: () => start });
    const { cookie } = await signIn(instance);
    const body = (
      await instance.app.inject({ method: 'GET', url: '/api/session', headers: headers(cookie!) })
    ).json();
    expect(body).toEqual({
      authenticated: true,
      via: 'session',
      idleExpiresAt: new Date(start + 30 * 60_000).toISOString(),
      expiresAt: new Date(start + 8 * 3_600_000).toISOString(),
    });
    expect(JSON.stringify(body)).not.toContain(PERSON);
    expect(JSON.stringify(body)).not.toContain(TENANT_A);
    const token = await authorization({ oid: PERSON, roles: ['Swarm.User'] });
    const viaToken = (
      await instance.app.inject({
        method: 'GET',
        url: '/api/session',
        headers: { ...headers(), ...token },
      })
    ).json();
    expect(viaToken).toEqual({ authenticated: true, via: 'token' });
  });
});

describe('how long a session lasts', () => {
  it('ends after it has been idle for too long, and each use keeps it alive', async () => {
    let clock = Date.now();
    const instance = await setup({ now: () => clock });
    const { cookie } = await signIn(instance);
    const use = () =>
      instance.app.inject({ method: 'GET', url: '/api/workspace', headers: headers(cookie!) });
    // Busy for four hours, never idle for more than twenty-nine minutes.
    for (let step = 0; step < 8; step += 1) {
      clock += 29 * 60_000;
      expect((await use()).statusCode, `after ${(step + 1) * 29} minutes`).toBe(200);
    }
    clock += 31 * 60_000;
    const idle = await use();
    expect(idle.statusCode).toBe(401);
    expect(idle.json().error.code).toBe('SIGN_IN_REQUIRED');
    // And it is gone, not merely refused.
    clock -= 31 * 60_000;
    expect((await use()).statusCode).toBe(401);
  });

  it('ends at its absolute limit however busy the person is', async () => {
    let clock = Date.now();
    const instance = await setup({ now: () => clock });
    const { cookie } = await signIn(instance);
    const use = () =>
      instance.app.inject({ method: 'GET', url: '/api/workspace', headers: headers(cookie!) });
    for (let minutes = 0; minutes < 8 * 60 - 20; minutes += 20) {
      clock += 20 * 60_000;
      expect((await use()).statusCode, `at ${minutes + 20} minutes`).toBe(200);
    }
    clock += 21 * 60_000;
    expect((await use()).statusCode).toBe(401);
  });

  it('removes what has ended', async () => {
    let clock = Date.now();
    const instance = await setup({ now: () => clock });
    await signIn(instance);
    await beginLogin(instance);
    clock += 9 * 3_600_000;
    instance.repository.sessions.purge();
    const database = (
      instance.repository as unknown as { database: { prepare(sql: string): { all(): unknown[] } } }
    ).database;
    expect(database.prepare('SELECT * FROM sessions').all()).toEqual([]);
    expect(database.prepare('SELECT * FROM login_attempts').all()).toEqual([]);
  });
});

describe('signing out and taking access away', () => {
  it('ends the session on the server and clears the cookie, only when asked the right way', async () => {
    const instance = await setup();
    const { cookie } = await signIn(instance);
    const forged = await instance.app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: headers(cookie!, { origin: `https://${HOST}` }),
    });
    expect(forged.statusCode).toBe(403);
    expect(
      (
        await instance.app.inject({
          method: 'GET',
          url: '/api/workspace',
          headers: headers(cookie!),
        })
      ).statusCode,
    ).toBe(200);

    const out = await instance.app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: headers(cookie!, { 'x-swarm-csrf': '1', origin: `https://${HOST}` }),
    });
    expect(out.statusCode).toBe(204);
    expect(
      setCookies(out).some((value) =>
        /^__Host-swarm_session=; Path=\/; Max-Age=0; HttpOnly; SameSite=Lax; Secure$/u.test(value),
      ),
    ).toBe(true);
    // The old cookie is worthless now, even if something kept a copy.
    expect(
      (
        await instance.app.inject({
          method: 'GET',
          url: '/api/workspace',
          headers: headers(cookie!),
        })
      ).statusCode,
    ).toBe(401);
    expect(instance.repository.audit.list({ limit: 20 }).map((entry) => entry.action)).toContain(
      'session.ended',
    );
    // Signing out twice, or when never signed in, is not an error.
    const twice = await instance.app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: headers(cookie!, { 'x-swarm-csrf': '1', origin: `https://${HOST}` }),
    });
    expect(twice.statusCode).toBe(204);
  });

  it('takes effect on the next request when a person is removed from a project', async () => {
    const instance = await setup();
    const setupActor = { id: 'setup', workspaceRole: 'owner' as const };
    instance.repository.members.setWorkspaceMember({
      tenantId: TENANT_A,
      principalId: PERSON,
      role: 'member',
      actor: setupActor,
    });
    instance.repository.members.setWorkspaceMember({
      tenantId: TENANT_A,
      principalId: OTHER,
      role: 'member',
      actor: setupActor,
    });
    const project = instance.repository.create(fixtureInput(), {
      owner: { tenantId: TENANT_A, ownerId: OTHER },
    });
    instance.repository.members.setProjectMember({
      projectId: project.id,
      tenantId: TENANT_A,
      principalId: PERSON,
      role: 'viewer',
      actor: { id: OTHER },
    });
    const { cookie } = await signIn(instance);
    const read = () =>
      instance.app.inject({
        method: 'GET',
        url: `/api/projects/${project.id}`,
        headers: headers(cookie!),
      });
    expect((await read()).statusCode).toBe(200);
    instance.repository.members.removeProjectMember({
      projectId: project.id,
      principalId: PERSON,
      actor: { id: OTHER },
    });
    expect((await read()).statusCode).toBe(404);
  });

  it('ends every session of a person who is removed from the workspace', async () => {
    const instance = await setup();
    instance.repository.members.setWorkspaceMember({
      tenantId: TENANT_A,
      principalId: PERSON,
      role: 'member',
      actor: { id: 'setup', workspaceRole: 'owner' },
    });
    const one = await signIn(instance);
    const two = await signIn(instance);
    const owner = await signIn(instance, { oid: OTHER });
    instance.repository.members.setWorkspaceMember({
      tenantId: TENANT_A,
      principalId: OTHER,
      role: 'owner',
      actor: { id: 'setup', workspaceRole: 'owner' },
    });
    const removed = await instance.app.inject({
      method: 'DELETE',
      url: `/api/workspace/members/${PERSON}`,
      headers: headers(owner.cookie!, { 'x-swarm-csrf': '1', origin: `https://${HOST}` }),
    });
    expect(removed.json()).toEqual({ removed: true });
    for (const cookie of [one.cookie, two.cookie]) {
      expect(
        (
          await instance.app.inject({
            method: 'GET',
            url: '/api/workspace',
            headers: headers(cookie!),
          })
        ).statusCode,
      ).toBe(401);
    }
    // Someone else's session is untouched.
    expect(
      (
        await instance.app.inject({
          method: 'GET',
          url: '/api/workspace',
          headers: headers(owner.cookie!),
        })
      ).statusCode,
    ).toBe(200);
  });
});

describe('what is written to the logs', () => {
  it('never holds a code, a state, a token, a session or a cookie', async () => {
    const lines: string[] = [];
    const instance = await setup({
      extra: { LOG_LEVEL: 'debug' },
      logStream: { write: (line) => lines.push(line) },
    });
    const login = await beginLogin(instance);
    const code = instance.provider.approve(login);
    const callback = await instance.app.inject({
      method: 'GET',
      url: `/auth/callback?code=${code}&state=${login.state}`,
      headers: headers(login.bindingCookie),
    });
    const session = setCookies(callback).find((value) =>
      value.startsWith('__Host-swarm_session='),
    )!;
    const cookie = `__Host-swarm_session=${cookieValue(session)}`;
    await instance.app.inject({ method: 'GET', url: '/api/workspace', headers: headers(cookie) });
    await instance.app.inject({
      method: 'GET',
      url: '/api/workspace',
      headers: headers(`__Host-swarm_session=${'x'.repeat(43)}`),
    });
    // A failed sign-in, too.
    instance.provider.setMode('error');
    const second = await beginLogin(instance);
    await instance.app.inject({
      method: 'GET',
      url: `/auth/callback?code=${instance.provider.approve(second)}&state=${second.state}`,
      headers: headers(second.bindingCookie),
    });
    const logged = lines.join('\n');
    expect(logged.length).toBeGreaterThan(0);
    for (const secret of [
      code,
      login.state,
      login.nonce,
      login.challenge,
      cookieValue(session),
      cookieValue(login.bindingCookie.split('=')[1] ? login.bindingCookie : ''),
      ACCESS_TOKEN_CANARY,
      'code_verifier',
      'id_token',
    ]) {
      expect(logged, secret).not.toContain(secret);
    }
    expect(logged).not.toMatch(/eyJ[\w-]{10,}\./u);
  });
});

describe('another workspace’s person signing in', () => {
  it('reaches only their own workspace, even with the same project identifier in play', async () => {
    const instance = await setup();
    const mine = instance.repository.create(fixtureInput(), {
      owner: { tenantId: TENANT_A, ownerId: OTHER },
    });
    instance.repository.members.setWorkspaceMember({
      tenantId: TENANT_B,
      principalId: PERSON,
      role: 'member',
      actor: { id: 'setup', workspaceRole: 'owner' },
    });
    const foreign = await signIn(instance, { tid: TENANT_B });
    expect(foreign.cookie).not.toBeNull();
    const response = await instance.app.inject({
      method: 'GET',
      url: `/api/projects/${mine.id}`,
      headers: headers(foreign.cookie!),
    });
    expect(response.statusCode).toBe(404);
    expect(
      (
        await instance.app.inject({
          method: 'GET',
          url: '/api/projects',
          headers: headers(foreign.cookie!),
        })
      ).json().total,
    ).toBe(0);
  });
});
