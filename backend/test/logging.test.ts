import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { TokenVerifier } from '../src/auth/tokens.js';
import { AppError } from '../src/errors.js';
import { Repository } from '../src/storage/repository.js';
import { testConfig } from './fixtures.js';
import { entraEnvironment, idp } from './support/entra-idp.js';

const HOST = 'swarm.example.test';
const PERSON = 'aaaaaaa5-0000-4000-8000-000000000005';
const QUERY = 'token=canary-query-token-do-not-log&code=canary-code-do-not-log';
const SECRET =
  'canary-secret-do-not-log: postgres://canary-user:canary-password@db.example.test/swarm';

const applications: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

async function start(level: 'info' | 'debug' = 'info') {
  const lines: Record<string, unknown>[] = [];
  const config = testConfig({
    ...entraEnvironment,
    AUTH_ENTRA_CLIENT_ID: 'cccccccc-0000-4000-8000-0000000000aa',
    AUTH_ENTRA_REDIRECT_URI: `https://${HOST}/auth/callback`,
    ALLOWED_HOSTS: `${HOST},localhost`,
    ALLOWED_ORIGINS: `https://${HOST}`,
    LOG_LEVEL: level,
  });
  const instance = await buildApp({
    config,
    repository: new Repository(':memory:'),
    tokenVerifier: new TokenVerifier(config.auth, idp.keys),
    logStream: { write: (line: string) => void lines.push(JSON.parse(line)) },
    frontendRoot: null,
  });
  applications.push(instance);
  return { ...instance, lines };
}

/** A signed-in person who may call the API, as the cookie that a browser would send. */
function signedIn(repository: Repository): { host: string; cookie: string } {
  const { token } = repository.sessions.create(
    { id: PERSON, tenantId: 'local-tenant', platformAdmin: false, bootstrapAdmin: false },
    { idleMs: 60_000, absoluteMs: 3_600_000 },
  );
  repository.members.setWorkspaceMember({
    tenantId: 'local-tenant',
    principalId: PERSON,
    role: 'owner',
    actor: { id: 'test-setup', workspaceRole: 'owner' },
  });
  return { host: HOST, cookie: `__Host-swarm_session=${token}` };
}

/** Every key at any depth of a log line. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
  }
  return [];
}

describe.each(['info', 'debug'] as const)('a request, at log level %s', (level) => {
  it('is logged by method, path and host, without its query string, however it ends', async () => {
    const { app, lines } = await start(level);
    const sent = [
      `/api/health?${QUERY}`,
      `/api/projects?${QUERY}`,
      `/api/projects/00000000-0000-4000-8000-000000000000?${QUERY}`,
      `/api/nowhere?${QUERY}`,
      `/auth/login?returnTo=%2F&${QUERY}`,
      `/auth/callback?${QUERY}&state=canary-state-do-not-log-0123456789`,
      `/assets/app.js?${QUERY}`,
      `/api/projects/%E0%A4%A?${QUERY}`,
      `/api/projects/${'a'.repeat(200)}?${QUERY}`,
    ];
    for (const url of sent) await app.inject({ url, headers: { host: HOST } });

    const requests = lines.filter((line) => line.msg === 'incoming request');
    expect(requests.map((line) => (line.req as { url: string }).url)).toEqual(
      sent.map((url) => url.split('?')[0]),
    );
    expect(JSON.stringify(lines)).not.toMatch(/canary|[?&](?:token|code|state)=/u);
  });

  it('is described by three fields and an id, and never by a header, a cookie, a body or a query', async () => {
    const { app, lines } = await start(level);
    await app.inject({
      method: 'POST',
      url: `/api/projects?${QUERY}`,
      headers: {
        host: HOST,
        authorization: 'Bearer canary-bearer-do-not-log',
        cookie: '__Host-swarm_session=canary-cookie-do-not-log-0123456789',
        'content-type': 'application/json',
        'x-forwarded-for': '198.51.100.7',
        'user-agent': 'canary-agent',
      },
      payload: { name: 'canary-body-do-not-log' },
    });
    const request = lines.find((line) => line.msg === 'incoming request')!;
    expect(Object.keys(request.req as object).sort()).toEqual(['hostname', 'method', 'url']);
    const forbidden = new Set([
      'headers',
      'authorization',
      'cookie',
      'set-cookie',
      'body',
      'query',
      'params',
      'payload',
      'remoteAddress',
      'remotePort',
      'user-agent',
    ]);
    for (const line of lines) {
      expect(keysOf(line).filter((key) => forbidden.has(key))).toEqual([]);
    }
    expect(JSON.stringify(lines)).not.toMatch(/canary|198\.51\.100\.7/u);
  });

  it('is named, in its log lines and in its answer, by one correlation id', async () => {
    const { app, lines } = await start(level);
    const answer = await app.inject({ url: '/api/projects', headers: { host: HOST } });
    const id = answer.headers['x-request-id'];
    expect(id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(answer.json().error.requestId).toBe(id);
    expect(lines.filter((line) => line.reqId === id).length).toBeGreaterThanOrEqual(2);
  });
});

describe('a request that is refused before any route is found', () => {
  it('is answered without its address, in the shape of every error, and is logged without its query', async () => {
    const { app, lines } = await start();
    const unreadable = await app.inject({
      url: `/api/projects/%E0%A4%A?${QUERY}`,
      headers: { host: HOST },
    });
    expect(unreadable.statusCode).toBe(400);
    expect(unreadable.json()).toEqual({
      error: {
        code: 'HTTP_400',
        message: 'Malformed request. Supply valid JSON and URL encoding.',
        requestId: unreadable.headers['x-request-id'],
      },
    });
    const tooLong = await app.inject({
      url: `/api/projects/${'b'.repeat(200)}?${QUERY}`,
      headers: { host: HOST },
    });
    expect(tooLong.statusCode).toBe(414);
    expect(tooLong.json().error).toMatchObject({
      code: 'HTTP_414',
      message: 'The address is too long.',
    });
    for (const answer of [unreadable, tooLong]) {
      expect(answer.body).not.toMatch(/canary|bbbb|%E0|token=/u);
      expect(answer.headers['cache-control']).toBe('no-store');
      expect(answer.headers['x-content-type-options']).toBe('nosniff');
    }
    expect(lines.filter((line) => line.msg === 'incoming request')).toHaveLength(2);
    expect(JSON.stringify(lines)).not.toMatch(/canary|[?&]token=/u);
  });
});

describe('a failure on the server', () => {
  const failures: [string, () => unknown][] = [
    ['an error', () => new Error(SECRET)],
    ['a type error', () => new TypeError(SECRET)],
    ['an error with a cause', () => new Error('outer', { cause: new Error(SECRET) })],
    [
      'an error that calls itself a gateway failure',
      () => Object.assign(new Error(SECRET), { statusCode: 502 }),
    ],
    [
      'an error with a driver code',
      () => Object.assign(new Error(SECRET), { code: 'ECONNRESET', statusCode: 503 }),
    ],
    [
      'an error with a status of its own',
      () => Object.assign(new Error(SECRET), { statusCode: 599, code: 'FST_CANARY' }),
    ],
    ['a thrown string', () => SECRET],
  ];

  it.each(failures)(
    'is answered the same way whatever %s said, and logged without it',
    async (_name, make) => {
      const { app, repository, lines } = await start();
      const caller = signedIn(repository);
      vi.spyOn(repository, 'list').mockImplementation(() => {
        throw make();
      });
      const answer = await app.inject({ url: '/api/projects', headers: caller });
      expect(answer.statusCode).toBe(500);
      expect(answer.json()).toEqual({
        error: {
          code: 'INTERNAL_ERROR',
          message:
            'An internal operation failed. Check the server log using the request or project ID.',
          requestId: answer.headers['x-request-id'],
        },
      });
      expect(answer.body).not.toMatch(/canary|postgres/u);
      expect(JSON.stringify(lines)).not.toMatch(/canary|postgres|db\.example/u);
      const failed = lines.filter((line) => line.level === 50);
      expect(failed).toHaveLength(1);
      expect(failed[0]).toMatchObject({
        code: 'INTERNAL_ERROR',
        requestId: answer.headers['x-request-id'],
      });
    },
  );

  it('keeps the message of an error that was written to be shown, and nothing from its cause', async () => {
    const { app, repository, lines } = await start();
    const caller = signedIn(repository);
    vi.spyOn(repository, 'list').mockImplementation(() => {
      throw new AppError(503, 'STORAGE_UNAVAILABLE', 'The database is not responding.', {
        cause: new Error(SECRET),
      });
    });
    const answer = await app.inject({ url: '/api/projects', headers: caller });
    expect(answer.statusCode).toBe(503);
    expect(answer.json().error).toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
      message: 'The database is not responding.',
    });
    expect(answer.body).not.toMatch(/canary|postgres/u);
    expect(JSON.stringify(lines)).not.toMatch(/canary|postgres|db\.example/u);
  });
});

describe('an error that Fastify raises for a request that cannot be served', () => {
  it.each([
    ['a body that is not JSON', { 'content-type': 'application/json' }, '{"canary":', 400],
    [
      'a body of a type that is not accepted',
      { 'content-type': 'application/xml' },
      '<canary>body</canary>',
      415,
    ],
  ] as const)('is answered with a fixed sentence: %s', async (_name, headers, payload, status) => {
    const { app, repository } = await start();
    const answer = await app.inject({
      method: 'POST',
      url: `/api/projects?${QUERY}`,
      headers: { ...headers, ...signedIn(repository), 'x-swarm-csrf': '1' },
      payload,
    });
    expect(answer.statusCode).toBe(status);
    expect(answer.body).not.toMatch(/canary/u);
    expect(Object.keys(answer.json().error).sort()).toEqual(['code', 'message', 'requestId']);
  });
});
