import { randomUUID } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { UsageError } from './args.js';
import {
  fetchSmoke,
  formatSmokeSummary,
  parseSmokeArgs,
  PILOT_CHECKS,
  runPilotSmoke,
  SMOKE_PATHS,
  Unreachable,
  type SmokeCheckId,
  type SmokeHttp,
  type SmokeReport,
  type SmokeResponse,
} from './pilot-smoke.js';

const BASE = 'https://swarm.example.test';
const TENANT = '11111111-2222-3333-4444-555555555555';
const CLIENT = '66666666-7777-8888-9999-aaaaaaaaaaaa';
const CSP = "default-src 'self'; frame-ancestors 'none'";
const COOKIE_VALUE = 'cookie-marker-value-0123456789';
const COOKIE = `__Host-swarm_login=${COOKIE_VALUE}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax; Secure`;
const REQUEST_ID = randomUUID();

function authorizeUrl(overrides: Record<string, string | null> = {}): string {
  const parameters: Record<string, string> = {
    client_id: CLIENT,
    response_type: 'code',
    redirect_uri: `${BASE}/auth/callback`,
    response_mode: 'query',
    scope: 'openid profile',
    state: 'state-marker-value',
    nonce: 'nonce-marker-value',
    code_challenge: 'challenge-marker-value',
    code_challenge_method: 'S256',
  };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) delete parameters[name];
    else parameters[name] = value;
  }
  return `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize?${new URLSearchParams(parameters).toString()}`;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): SmokeResponse {
  return {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-security-policy': CSP,
      ...headers,
    },
    setCookies: [],
    body: JSON.stringify(body),
  };
}

function redirect(location: string, setCookies: string[] = [COOKIE]): SmokeResponse {
  return {
    status: 302,
    headers: { location, 'content-security-policy': CSP, 'cache-control': 'no-store' },
    setCookies,
    body: '',
  };
}

type Site = Record<string, SmokeResponse | Error>;

function healthy(): Site {
  return {
    '/api/health/live': json(200, { status: 'live' }),
    '/api/health/ready': json(200, { status: 'ready', checks: { database: 'ok' } }),
    '/api/config': json(401, {
      error: { code: 'SIGN_IN_REQUIRED', message: 'Sign in to continue.', requestId: REQUEST_ID },
    }),
    '/auth/login': redirect(authorizeUrl()),
  };
}

class FakeSite implements SmokeHttp {
  readonly requests: string[] = [];

  constructor(private readonly responses: Site) {}

  async get(path: string): Promise<SmokeResponse> {
    this.requests.push(path);
    const answer = this.responses[path];
    if (answer === undefined) throw new Error(`The fake site was asked for ${path}.`);
    if (answer instanceof Error) throw answer;
    return answer;
  }
}

async function run(overrides: Site = {}, baseUrl = BASE) {
  const site = new FakeSite({ ...healthy(), ...overrides });
  const lines: string[] = [];
  const report = await runPilotSmoke(site, { baseUrl, log: (line) => lines.push(line) });
  return { report, site, lines };
}

const status = (report: SmokeReport, id: SmokeCheckId): string =>
  report.checks.find((check) => check.id === id)?.status ?? 'missing';
const detail = (report: SmokeReport, id: SmokeCheckId): string =>
  report.checks.find((check) => check.id === id)?.detail ?? '';
const failed = (report: SmokeReport): SmokeCheckId[] =>
  report.checks.filter((check) => check.status === 'fail').map((check) => check.id);

describe('runPilotSmoke', () => {
  it('passes only when every check holds, asking for each address once and in order', async () => {
    const { report, site, lines } = await run();

    expect(report.checks.map((check) => check.id)).toEqual(PILOT_CHECKS.map((check) => check.id));
    expect(report.checks.every((check) => check.status === 'pass')).toBe(true);
    expect(report.passed).toBe(true);
    expect(site.requests).toEqual([...SMOKE_PATHS]);
    expect(lines).toHaveLength(PILOT_CHECKS.length);
    expect(lines.every((line) => line.startsWith('PASS  '))).toBe(true);
    expect(formatSmokeSummary(report)).toBe('RESULT: PASSED. All 8 checks passed.');
  });

  it('refuses to send anything over plain HTTP and skips every later check', async () => {
    const { report, site } = await run({}, 'http://swarm.example.test');

    expect(status(report, 'https')).toBe('fail');
    expect(report.checks.slice(1).every((check) => check.status === 'skipped')).toBe(true);
    expect(site.requests).toEqual([]);
    expect(report.passed).toBe(false);
    expect(formatSmokeSummary(report)).toBe('RESULT: FAILED. 8 of 8 checks did not pass.');
  });

  it('stops at the first request that cannot be made and never counts the rest as passed', async () => {
    const down = new Unreachable('Cannot reach swarm.example.test (ENOTFOUND).');
    const { report, site } = await run({ '/api/health/live': down });

    expect(status(report, 'live')).toBe('fail');
    expect(detail(report, 'live')).toBe('Cannot reach swarm.example.test (ENOTFOUND).');
    expect(report.checks.slice(2).every((check) => check.status === 'skipped')).toBe(true);
    expect(site.requests).toEqual(['/api/health/live']);
    expect(report.passed).toBe(false);
  });

  it('keeps going after a check that failed, so one run shows every problem', async () => {
    const { report } = await run({
      '/api/health/live': json(503, { status: 'broken' }),
      '/api/health/ready': json(503, { status: 'not-ready', checks: { database: 'failed' } }),
    });

    expect(failed(report)).toEqual(['live', 'ready']);
    expect(status(report, 'sign-in-enforced')).toBe('pass');
    expect(detail(report, 'live')).toContain('restarts the replica');
    expect(detail(report, 'ready')).toContain('The database did not answer');
    expect(formatSmokeSummary(report)).toBe('RESULT: FAILED. 2 of 8 checks did not pass.');
  });

  it('reports an unexpected error as a failure instead of crashing', async () => {
    const { report } = await run({ '/api/health/live': new TypeError('boom') });

    expect(detail(report, 'live')).toBe('Unexpected error: boom');
    expect(report.passed).toBe(false);
  });

  it('never prints a cookie value, an authorization-request value, an identifier or a body', async () => {
    const insecure = COOKIE.replace('; Secure', '');
    const text = [
      ...(await run()).lines,
      ...(await run({ '/auth/login': redirect(authorizeUrl(), [insecure]) })).lines,
      ...(await run({ '/auth/login': redirect(authorizeUrl({ code_challenge_method: 'plain' })) }))
        .lines,
    ].join('\n');

    expect(text).toContain('FAIL');
    for (const secret of [
      COOKIE_VALUE,
      'state-marker-value',
      'nonce-marker-value',
      'challenge-marker-value',
      TENANT,
      CLIENT,
      REQUEST_ID,
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe('the health checks', () => {
  it('requires the readiness body to be exactly the one documented', async () => {
    for (const body of [
      { status: 'ready', checks: { database: 'ok' }, version: '1' },
      { status: 'ready', checks: { database: 'ok', queue: 'ok' } },
      { status: 'ready', checks: { database: 'failed' } },
      { status: 'ok', checks: { database: 'ok' } },
      { status: 'ready' },
    ]) {
      const { report } = await run({ '/api/health/ready': json(200, body) });
      expect(failed(report)).toEqual(['ready']);
      expect(detail(report, 'ready')).toContain('not exactly');
    }
  });

  it('accepts the readiness body whatever the order of its keys', async () => {
    const reordered = { checks: { database: 'ok' }, status: 'ready' };
    const { report } = await run({ '/api/health/ready': json(200, reordered) });
    expect(report.passed).toBe(true);
  });

  it('names a host that the allow-list refused, which a probe without the right Host header meets', async () => {
    const refused = json(403, {
      error: {
        code: 'HOST_NOT_ALLOWED',
        message: 'This HTTP host is not in the configured allowlist.',
      },
    });
    const { report } = await run({ '/api/health/live': refused });
    expect(detail(report, 'live')).toContain('HTTP 403 HOST_NOT_ALLOWED');
  });
});

describe('sign-in enforcement', () => {
  it('fails when the configuration is readable without credentials', async () => {
    const { report } = await run({ '/api/config': json(200, { version: '1' }) });
    expect(failed(report)).toEqual(['sign-in-enforced']);
    expect(detail(report, 'sign-in-enforced')).toContain('NOT enforced');
  });

  it.each([
    [401, 'NO_ROLE'],
    [403, 'FORBIDDEN'],
    [500, 'INTERNAL_ERROR'],
  ])('fails on %i %s: only 401 SIGN_IN_REQUIRED proves the guard answered', async (code, name) => {
    const { report } = await run({ '/api/config': json(code, { error: { code: name } }) });
    expect(failed(report)).toEqual(['sign-in-enforced']);
    expect(detail(report, 'sign-in-enforced')).toContain(`HTTP ${code} ${name}`);
  });
});

describe('the sign-in redirect', () => {
  it('accepts the scope however it is encoded', async () => {
    const encoded = authorizeUrl().replace('scope=openid+profile', 'scope=openid%20profile');
    expect(encoded).toContain('scope=openid%20profile');
    const { report } = await run({ '/auth/login': redirect(encoded) });
    expect(report.passed).toBe(true);
  });

  it('explains a server on which browser sign-in is not configured', async () => {
    const { report } = await run({ '/auth/login': json(404, { error: { code: 'NOT_FOUND' } }) });
    expect(status(report, 'login-redirect')).toBe('fail');
    expect(detail(report, 'login-redirect')).toContain('Browser sign-in is not configured');
  });

  it('fails on a response that is not a 302', async () => {
    const { report } = await run({ '/auth/login': json(200, { ok: true }) });
    expect(detail(report, 'login-redirect')).toContain('Expected 302');
  });

  it.each([
    ['another host', 'https://evil.example.test/authorize?response_type=code', 'evil.example.test'],
    [
      'plain http',
      authorizeUrl().replace('https://', 'http://'),
      'http://login.microsoftonline.com',
    ],
    ['a relative address', '/login', 'no usable address'],
  ])('fails when the redirect goes to %s', async (_name, location, shown) => {
    const { report } = await run({ '/auth/login': redirect(location) });
    expect(status(report, 'login-redirect')).toBe('fail');
    expect(detail(report, 'login-redirect')).toContain(shown);
  });

  it.each([
    ['response_type is not code', { response_type: 'token' }],
    ['code_challenge_method is not S256', { code_challenge_method: 'plain' }],
    ['there is no code_challenge', { code_challenge: null }],
    ['the scope is not exactly "openid profile"', { scope: 'openid profile offline_access' }],
    ['the scope is not exactly "openid profile"', { scope: 'openid' }],
    ['there is no state', { state: null }],
    ['there is no nonce', { nonce: null }],
    ['client_id is not a GUID', { client_id: 'not-a-guid' }],
    [
      'redirect_uri is not this address followed by /auth/callback',
      { redirect_uri: 'https://elsewhere.example.test/auth/callback' },
    ],
    ['a client credential parameter is present', { client_secret: 'x' }],
    ['a client credential parameter is present', { Client_Secret: 'x' }],
    ['a client credential parameter is present', { client_assertion: 'x' }],
  ])('fails when %s', async (problem, overrides) => {
    const { report } = await run({ '/auth/login': redirect(authorizeUrl(overrides)) });
    expect(failed(report)).toEqual(['login-redirect']);
    expect(detail(report, 'login-redirect')).toContain(problem);
  });
});

describe('the login cookie', () => {
  const noValue = COOKIE.replace(COOKIE_VALUE, '');
  it.each([
    ['HttpOnly is missing', COOKIE.replace('; HttpOnly', '')],
    ['Secure is missing', COOKIE.replace('; Secure', '')],
    ['SameSite is not Lax', COOKIE.replace('SameSite=Lax', 'SameSite=Strict')],
    ['SameSite is not Lax', COOKIE.replace('; SameSite=Lax', '')],
    ['Path is not /', COOKIE.replace('Path=/', 'Path=/app')],
    ['a Domain attribute is set', `${COOKIE}; Domain=swarm.example.test`],
    ['it has no value', noValue],
  ])('fails when %s', async (problem, header) => {
    const { report } = await run({ '/auth/login': redirect(authorizeUrl(), [header]) });
    expect(failed(report)).toEqual(['login-cookie']);
    expect(detail(report, 'login-cookie')).toContain(problem);
  });

  it('fails when the cookie is not set, naming the cookies that were', async () => {
    const other = 'other_cookie=value-0123456789abcdef; Path=/; HttpOnly';
    const { report } = await run({ '/auth/login': redirect(authorizeUrl(), [other]) });
    expect(failed(report)).toEqual(['login-cookie']);
    expect(detail(report, 'login-cookie')).toContain('cookie names seen: other_cookie)');
    expect(detail(report, 'login-cookie')).not.toContain('value-0123456789abcdef');
  });

  it('wants the __Host- prefix, which only a Secure https deployment gets', async () => {
    const unprefixed = COOKIE.replace('__Host-', '');
    const { report } = await run({ '/auth/login': redirect(authorizeUrl(), [unprefixed]) });
    expect(failed(report)).toEqual(['login-cookie']);
    expect(detail(report, 'login-cookie')).toContain('cookie names seen: swarm_login');
  });

  it('finds the cookie among several and ignores the case of its attributes', async () => {
    const lower = COOKIE.replace('HttpOnly', 'httponly').replace('SameSite=Lax', 'samesite=lax');
    const other = 'swarm_session=abc; Path=/';
    const { report } = await run({ '/auth/login': redirect(authorizeUrl(), [other, lower]) });
    expect(status(report, 'login-cookie')).toBe('pass');
  });
});

describe('the Content-Security-Policy', () => {
  it('is required on every response, and the failure names the ones without it', async () => {
    const bare = json(
      401,
      { error: { code: 'SIGN_IN_REQUIRED' } },
      { 'content-security-policy': '' },
    );
    const { report } = await run({ '/api/config': bare });
    expect(failed(report)).toEqual(['csp']);
    expect(detail(report, 'csp')).toContain('/api/config');
    expect(detail(report, 'csp')).not.toContain('/api/health/live');
  });

  it('must be a policy, not just a header', async () => {
    const odd = json(200, { status: 'live' }, { 'content-security-policy': 'report-only' });
    const { report } = await run({ '/api/health/live': odd });
    expect(failed(report)).toEqual(['csp']);
  });
});

describe('the leak check', () => {
  it('sets aside the per-request error id and nothing else', async () => {
    const { report } = await run();
    expect(status(report, 'no-leaks')).toBe('pass');

    const second = randomUUID();
    const withSecondGuid = json(401, {
      error: { code: 'SIGN_IN_REQUIRED', requestId: REQUEST_ID, tenant: second },
    });
    const leaked = await run({ '/api/config': withSecondGuid });
    expect(failed(leaked.report)).toEqual(['no-leaks']);
    expect(detail(leaked.report, 'no-leaks')).toBe('/api/config holds a GUID-shaped value.');
    expect(leaked.lines.join('\n')).not.toContain(second);
  });

  it('does not set aside an id that is not a plain UUID', async () => {
    const odd = json(401, {
      error: { code: 'SIGN_IN_REQUIRED', requestId: `subscription-${REQUEST_ID}` },
    });
    const { report } = await run({ '/api/config': odd });
    expect(failed(report)).toEqual(['no-leaks']);
    expect(detail(report, 'no-leaks')).toContain('/api/config holds a GUID-shaped value');
    expect(detail(report, 'no-leaks')).toContain(
      '/api/config mentions an endpoint or subscription',
    );
  });

  it.each(['endpoint', 'Subscription', 'AZURE_OPENAI_ENDPOINT'])(
    'flags the word %s',
    async (word) => {
      const { report } = await run({
        '/api/health/ready': json(200, { status: 'ready', note: word }),
      });
      expect(status(report, 'no-leaks')).toBe('fail');
      expect(detail(report, 'no-leaks')).toContain(
        '/api/health/ready mentions an endpoint or subscription',
      );
    },
  );

  it('flags a credential-shaped value without printing it', async () => {
    // Assembled at run time so no credential-shaped literal exists in the source.
    const jwt = [`${'eyJ'}${'a'.repeat(12)}`, `${'eyJ'}${'b'.repeat(12)}`, 'c'.repeat(12)].join(
      '.',
    );
    const { report, lines } = await run({ '/api/health/live': json(200, { status: 'live', jwt }) });
    expect(detail(report, 'no-leaks')).toBe('/api/health/live holds a JSON web token.');
    expect(lines.join('\n')).not.toContain(jwt);
  });

  it('reads a redirect body too, where an echoed address would carry the tenant and client ids', async () => {
    const echoed: SmokeResponse = { ...redirect(authorizeUrl()), body: authorizeUrl() };
    const { report } = await run({ '/auth/login': echoed });
    expect(failed(report)).toEqual(['no-leaks']);
    expect(detail(report, 'no-leaks')).toContain('/auth/login holds a GUID-shaped value');
  });
});

describe('parseSmokeArgs', () => {
  it('keeps only the origin of an https address', () => {
    expect(parseSmokeArgs(['https://swarm.example.test']).baseUrl).toBe(BASE);
    expect(parseSmokeArgs(['https://Swarm.Example.test:443/some/path?x=1#y']).baseUrl).toBe(BASE);
  });

  it.each([
    [[], /Usage: npx tsx scripts\/azure\/pilot-smoke\.ts/u],
    [['https://a.example.test', 'https://b.example.test'], /Usage:/u],
    [['http://swarm.example.test'], /never sends a request over plain HTTP/u],
    [['ftp://swarm.example.test'], /must start with https:\/\//u],
    [['not an address'], /is not a valid address/u],
    [[`https://${'user'}:${'pass'}@swarm.example.test`], /must not contain credentials/u],
  ])('rejects %j', (argv, message) => {
    expect(() => parseSmokeArgs(argv)).toThrow(UsageError);
    expect(() => parseSmokeArgs(argv)).toThrow(message);
  });
});

interface Received {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingHttpHeaders;
}

/** A loopback server that answers like the deployed app, and remembers what it was sent. */
async function withServer<T>(
  handle: (request: Received, answer: import('node:http').ServerResponse) => void,
  body: (base: string, received: Received[]) => Promise<T>,
): Promise<T> {
  const received: Received[] = [];
  const server: Server = createServer((request, response) => {
    const seen = { method: request.method, url: request.url, headers: request.headers };
    received.push(seen);
    handle(seen, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    return await body(base, received);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

function answerLikeTheApp(request: Received, response: import('node:http').ServerResponse): void {
  const site = healthy();
  const answer = site[request.url ?? ''];
  if (!answer || answer instanceof Error) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(answer.status, {
    ...answer.headers,
    ...(answer.setCookies.length > 0 ? { 'set-cookie': [...answer.setCookies] } : {}),
  });
  response.end(answer.body);
}

describe('fetchSmoke', () => {
  it('does not follow a redirect, keeps every Set-Cookie and sends no credential', async () => {
    await withServer(
      (request, response) => {
        if (request.url === '/auth/login') {
          response
            .writeHead(302, {
              location: authorizeUrl(),
              'Content-Security-Policy': CSP,
              'set-cookie': [COOKIE, 'swarm_other=1; Path=/'],
            })
            .end();
          return;
        }
        response.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"live"}');
      },
      async (base, received) => {
        const http = fetchSmoke(base, 5_000);
        const login = await http.get('/auth/login');
        const live = await http.get('/api/health/live');

        expect(login.status).toBe(302);
        expect(login.headers.location).toBe(authorizeUrl());
        expect(login.headers['content-security-policy']).toBe(CSP);
        expect(login.setCookies).toEqual([COOKIE, 'swarm_other=1; Path=/']);
        expect(login.headers['set-cookie']).toBeUndefined();
        expect(live).toMatchObject({ status: 200, body: '{"status":"live"}', setCookies: [] });

        expect(received.map((request) => `${request.method} ${request.url}`)).toEqual([
          'GET /auth/login',
          'GET /api/health/live',
        ]);
        for (const request of received) {
          expect(request.headers.cookie).toBeUndefined();
          expect(request.headers.authorization).toBeUndefined();
          expect(request.headers['user-agent']).toBe('swarm-pilot-smoke');
        }
      },
    );
  });

  it('explains an unreachable server without a stack trace', async () => {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const port = (probe.address() as AddressInfo).port;
    await new Promise((resolve) => probe.close(resolve));

    const http = fetchSmoke(`http://127.0.0.1:${port}`, 2_000);
    await expect(http.get('/api/health/live')).rejects.toThrow(Unreachable);
    await expect(http.get('/api/health/live')).rejects.toThrow(
      /^Cannot reach 127\.0\.0\.1:\d+ \(ECONNREFUSED\)\.$/u,
    );
  });

  it('gives up on a server that does not answer', async () => {
    await withServer(
      () => undefined,
      async (base) => {
        await expect(fetchSmoke(base, 150).get('/api/health/live')).rejects.toThrow(
          /\(the request timed out\)\.$/u,
        );
      },
    );
  });

  it('reads a bounded amount of a body', async () => {
    await withServer(
      (_request, response) => {
        response.writeHead(200).end('x'.repeat(200_000));
      },
      async (base) => {
        const answer = await fetchSmoke(base, 5_000).get('/api/health/live');
        expect(answer.body).toHaveLength(65_536);
      },
    );
  });
});

describe('through a real HTTP stack', () => {
  it('passes against a server that answers like the deployed app', async () => {
    // The server listens on loopback over plain HTTP, so the checks are told the public address it stands in for.
    await withServer(answerLikeTheApp, async (base, received) => {
      const lines: string[] = [];
      const report = await runPilotSmoke(fetchSmoke(base, 5_000), {
        baseUrl: BASE,
        log: (line) => lines.push(line),
      });

      expect(report.passed).toBe(true);
      expect(received.map((request) => request.url)).toEqual([...SMOKE_PATHS]);
      expect(lines.join('\n')).not.toContain(COOKIE_VALUE);
    });
  });

  it('fails the cookie check when the server drops the Secure flag', async () => {
    await withServer(
      (request, response) => {
        if (request.url === '/auth/login') {
          response
            .writeHead(302, {
              location: authorizeUrl(),
              'content-security-policy': CSP,
              'set-cookie': COOKIE.replace('; Secure', ''),
            })
            .end();
          return;
        }
        answerLikeTheApp(request, response);
      },
      async (base) => {
        const report = await runPilotSmoke(fetchSmoke(base, 5_000), { baseUrl: BASE });
        expect(failed(report)).toEqual(['login-cookie']);
        expect(report.passed).toBe(false);
      },
    );
  });
});
