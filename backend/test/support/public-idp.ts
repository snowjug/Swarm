import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from 'jose';
import { buildApp } from '../../src/app.js';
import type { PublicFetcher } from '../../src/ingest/url/fetcher.js';
import type { PublicEditionOptions } from '../../src/public/context.js';
import { publicEditionStorage } from '../../src/public/storage/edition.js';
import { Repository } from '../../src/storage/repository.js';
import { testConfig } from '../fixtures.js';

/**
 * A public edition for tests: its configuration, fake Google and GitHub, and an app on PostgreSQL (PGlite) with
 * row-level security in force, so that what the tests prove is what production does.
 */

export const BASE_URL = 'http://localhost:3001';
export const GOOGLE_CLIENT_ID = 'google-client-id.apps.googleusercontent.com';

export const publicEnvironment = {
  SWARM_EDITION: 'public',
  PUBLIC_BASE_URL: BASE_URL,
  ALLOWED_HOSTS: 'localhost',
  PUBLIC_GOOGLE_CLIENT_ID: GOOGLE_CLIENT_ID,
  PUBLIC_GOOGLE_CLIENT_SECRET: 'google-client-secret',
  PUBLIC_GITHUB_CLIENT_ID: 'github-client-id',
  PUBLIC_GITHUB_CLIENT_SECRET: 'github-client-secret',
  PUBLIC_PEPPER: 'test-pepper-test-pepper-test-pepper-0123456789',
  PUBLIC_ADMIN_EMAILS: 'admin@example.com',
  RATE_LIMIT_SCALE: '1000',
};

/** Real RSA keys and really signed ID tokens: only the fetch of Google's published key set is replaced. */
const keys = await (async () => {
  const pair = await generateKeyPair('RS256');
  const other = await generateKeyPair('RS256');
  const jwk: JWK = {
    ...(await exportJWK(pair.publicKey)),
    kid: 'google-test-key',
    alg: 'RS256',
    use: 'sig',
  };
  return {
    privateKey: pair.privateKey,
    otherKey: other.privateKey,
    jwk,
    resolver: createLocalJWKSet({ keys: [jwk] }),
  };
})();

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified?: boolean | string;
}

export interface GitHubIdentity {
  id: number;
  emails: { email: string; primary: boolean; verified: boolean }[];
}

interface Recorded {
  url: string;
  method: string;
  body: string;
  headers: Record<string, string>;
}

/** The identity providers, as far as the server can tell: it only ever sees a `fetch`. */
export class FakeProviders {
  readonly requests: Recorded[] = [];
  private readonly google = new Map<
    string,
    GoogleIdentity & {
      nonce: string;
      sign?: 'wrong-key' | 'expired' | 'wrong-audience' | 'wrong-issuer';
    }
  >();
  private readonly github = new Map<string, GitHubIdentity>();
  private readonly githubTokens = new Map<string, GitHubIdentity>();
  /** What the next call to a host should answer instead, to model an outage. */
  failHost: string | null = null;

  /** Registers what Google will say for an authorization code. `nonce` is the one the sign-in started with. */
  expectGoogle(
    code: string,
    identity: GoogleIdentity,
    nonce: string,
    sign?: 'wrong-key' | 'expired' | 'wrong-audience' | 'wrong-issuer',
  ): void {
    this.google.set(code, { ...identity, nonce, ...(sign ? { sign } : {}) });
  }

  expectGitHub(code: string, identity: GitHubIdentity): void {
    this.github.set(code, identity);
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const body =
      init?.body instanceof URLSearchParams ? init.body.toString() : String(init?.body ?? '');
    this.requests.push({ url, method: init?.method ?? 'GET', body, headers });
    const host = new URL(url).host;
    if (this.failHost === host) return new Response('unavailable', { status: 503 });
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    const form = new URLSearchParams(body);

    if (url === 'https://oauth2.googleapis.com/token') {
      const issued = this.google.get(form.get('code') ?? '');
      if (!issued || form.get('client_id') !== GOOGLE_CLIENT_ID || !form.get('code_verifier')) {
        return json({ error: 'invalid_grant' }, 400);
      }
      const now = Math.floor(Date.now() / 1000);
      const token = await new SignJWT({
        sub: issued.sub,
        email: issued.email,
        email_verified: issued.emailVerified ?? true,
        nonce: issued.nonce,
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'google-test-key' })
        .setIssuer(
          issued.sign === 'wrong-issuer' ? 'https://evil.example' : 'https://accounts.google.com',
        )
        .setAudience(issued.sign === 'wrong-audience' ? 'someone-elses-client' : GOOGLE_CLIENT_ID)
        .setIssuedAt(issued.sign === 'expired' ? now - 7_200 : now)
        .setExpirationTime(issued.sign === 'expired' ? now - 3_600 : now + 600)
        .sign(issued.sign === 'wrong-key' ? keys.otherKey : keys.privateKey);
      return json({
        id_token: token,
        access_token: 'google-access-token-never-read',
        token_type: 'Bearer',
      });
    }
    if (url === 'https://github.com/login/oauth/access_token') {
      const identity = this.github.get(form.get('code') ?? '');
      if (!identity || !form.get('code_verifier')) return json({ error: 'bad_verification_code' });
      const token = `gho_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
      this.githubTokens.set(token, identity);
      return json({ access_token: token, token_type: 'bearer', scope: 'user:email' });
    }
    if (url === 'https://api.github.com/user' || url === 'https://api.github.com/user/emails') {
      const token = (headers.authorization ?? '').replace(/^Bearer /u, '');
      const identity = this.githubTokens.get(token);
      if (!identity) return json({ message: 'Bad credentials' }, 401);
      return url.endsWith('/emails')
        ? json(identity.emails)
        : json({ id: identity.id, login: 'someone' });
    }
    return new Response('not a host the fake provides', { status: 599 });
  };
}

export interface PublicHarness {
  app: Awaited<ReturnType<typeof buildApp>>['app'];
  repository: Repository;
  providers: FakeProviders;
  built: Awaited<ReturnType<typeof buildApp>>;
  config: ReturnType<typeof testConfig>;
  /** Signs a person in through the whole flow and returns the cookie header that proves it. */
  signIn(who: {
    provider: 'google' | 'github';
    subject: string;
    email: string;
    ip?: string;
  }): Promise<{ cookie: string; userId?: string }>;
  close(): Promise<void>;
}

export async function publicApp(
  environment: Record<string, string> = {},
  options: {
    now?: () => number;
    public?: PublicEditionOptions;
    fetcher?: FakeProviders;
    /** Where the server's log goes, with its level: for a test that reads what the server wrote. */
    log?: {
      stream: { write(chunk: string): unknown };
      level: 'fatal' | 'error' | 'warn' | 'info' | 'debug';
    };
    /** How pages are read from the web: a fetcher with a resolver of the test's choosing. */
    urlFetcher?: PublicFetcher;
    /** Serve the built page too (`frontend/dist`), for a browser. Without it there is no page, only the API. */
    serve?: boolean;
  } = {},
): Promise<PublicHarness> {
  const config = {
    ...testConfig({ ...publicEnvironment, ...environment }),
    databasePath: 'pglite:memory',
    ...(options.log ? { logLevel: options.log.level } : {}),
  };
  const providers = options.fetcher ?? new FakeProviders();
  const repository = new Repository(config.databasePath, {
    ...(options.now ? { now: options.now } : {}),
    edition: publicEditionStorage(config.public!),
  });
  const built = await buildApp({
    config,
    repository,
    ...(options.serve ? {} : { frontendRoot: null }),
    ...(options.log ? { logStream: options.log.stream } : {}),
    ...(options.urlFetcher ? { urlFetcher: options.urlFetcher } : {}),
    public: {
      fetcher: providers.fetch,
      googleKeys: keys.resolver,
      ...(options.now ? { now: options.now } : {}),
      ...(options.public ?? {}),
    },
  });
  const { app } = built;

  async function signIn(who: {
    provider: 'google' | 'github';
    subject: string;
    email: string;
    ip?: string;
  }) {
    const started = await app.inject({
      method: 'POST',
      url: `/auth/start/${who.provider}`,
      headers: { 'x-swarm-csrf': '1', 'content-type': 'application/json' },
      payload: {},
      ...(who.ip ? { remoteAddress: who.ip } : {}),
    });
    if (started.statusCode !== 200)
      throw new Error(`start failed: ${started.statusCode} ${started.body}`);
    const url = new URL((started.json() as { url: string }).url);
    const binding = String(started.headers['set-cookie']).split(';')[0]!;
    const state = url.searchParams.get('state')!;
    const code = `code-${Math.random().toString(36).slice(2)}`;
    if (who.provider === 'google') {
      providers.expectGoogle(
        code,
        { sub: who.subject, email: who.email },
        url.searchParams.get('nonce')!,
      );
    } else {
      providers.expectGitHub(code, {
        id: Number(who.subject),
        emails: [{ email: who.email, primary: true, verified: true }],
      });
    }
    const finished = await app.inject({
      method: 'GET',
      url: `/auth/callback/${who.provider}?code=${code}&state=${state}`,
      headers: { cookie: binding },
      ...(who.ip ? { remoteAddress: who.ip } : {}),
    });
    const setCookies = ([] as string[]).concat(
      (finished.headers['set-cookie'] as string | string[] | undefined) ?? [],
    );
    const session = setCookies.find((cookie) =>
      /^(?:__Host-)?swarm_session=[A-Za-z0-9_-]{16,}/u.test(cookie),
    );
    if (!session)
      throw new Error(`no session: ${finished.statusCode} ${String(finished.headers.location)}`);
    return { cookie: session.split(';')[0]! };
  }

  return {
    app,
    repository,
    providers,
    built,
    config,
    signIn,
    close: () => app.close(),
  };
}
