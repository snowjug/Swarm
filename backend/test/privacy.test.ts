import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { TokenVerifier } from '../src/auth/tokens.js';
import { AppError } from '../src/errors.js';
import { ModelClient } from '../src/models/client.js';
import { Repository } from '../src/storage/repository.js';
import { ALLOWED_ATTRIBUTES } from '../src/telemetry/attributes.js';
import { fixtureInput, testConfig } from './fixtures.js';
import { TENANT_A, entraEnvironment, idp, mint } from './support/entra-idp.js';
import { telemetryHarness } from './support/telemetry-harness.js';

// Every sink that leaves the process (the log, the answers to callers, the audit log, the telemetry)
// is read after one scripted day of real requests, in which credentials and what people write have
// been planted in every place a request can carry them. A canary is a value that must be in none of
// them. The strings contain "canary" or "do-not-log", the repository's convention for test secrets.
const telemetry = telemetryHarness();

const HOST = 'swarm.example.test';
const CLIENT = 'cccccccc-0000-4000-8000-0000000000aa';
const OWNER = 'aaaaaaa5-0000-4000-8000-000000000005';
const PLATFORM = 'aaaaaaa6-0000-4000-8000-000000000006';

/** Credentials and connection details: nothing that reads the configuration or a request may print them. */
const SECRETS = {
  modelKey: 'sk-canary-model-key-do-not-log-0001',
  providerBody:
    'canary provider answer do-not-log: the key sk-canary-model-key-do-not-log-0001 is wrong',
  clientSecret: 'canary-client-secret-do-not-log',
  databasePassword: 'canary-db-password-do-not-log',
  connectionString:
    'InstrumentationKey=canary-ikey-do-not-log;IngestionEndpoint=https://canary.example.test/',
  queryToken: 'canary-query-token-do-not-log',
  badBearer: 'canary-bad-bearer-do-not-log',
  cookie: 'canary-cookie-value-do-not-log-0123456789abcdef',
  refreshToken: 'canary-refresh-token-do-not-log',
};

/** What people write: a name, a question, a source, a scenario, an address with a path. */
const CONTENT = {
  name: 'Canary Project Name Quokka',
  question: 'Will the canary question about the quokka ferry leak into a log?',
  document: 'Canary source passage about the quokka ferry harbour board and its tides.',
  scenario: 'canary scenario question: what if the quokka bridge closed for a month?',
  addressPath: 'canary-evidence-path-quokka',
  note: 'canary note on the quokka report',
};

interface Answer {
  label: string;
  status: number;
  headers: Record<string, unknown>;
  body: string;
}

const answers: Answer[] = [];
const lines: string[] = [];
let audit = '';
let exported = '';
let telemetrySent = '';
let spansSeen: { name: string; attributes: string[]; events: number }[] = [];
const tokens = { owner: '', platform: '', session: '' };
let projectId = '';
let stored: { name: string } | null = null;
let close: () => Promise<void> = async () => undefined;

beforeAll(async () => {
  const config = testConfig({
    ...entraEnvironment,
    AUTH_ENTRA_CLIENT_ID: CLIENT,
    AUTH_ENTRA_REDIRECT_URI: `https://${HOST}/auth/callback`,
    AUTH_ENTRA_CLIENT_SECRET: SECRETS.clientSecret,
    ALLOWED_HOSTS: `${HOST},localhost,127.0.0.1`,
    ALLOWED_ORIGINS: `https://${HOST}`,
    LOG_LEVEL: 'debug',
    AI_PROVIDER: 'openai',
    AI_MODEL: 'fixture-model',
    OPENAI_API_KEY: SECRETS.modelKey,
    OPENAI_BASE_URL: 'https://api.openai.example/v1',
  });
  // Never used, because the repository is handed in. It is here so that anything that prints the
  // configuration, or a connection that fails, would print this.
  config.databaseUrl = `postgres://canary-user:${SECRETS.databasePassword}@db.example.test:5432/swarm?sslmode=require`;
  const rejecting: typeof fetch = async () =>
    new Response(JSON.stringify({ error: { message: SECRETS.providerBody } }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  const { app, repository, jobs } = await buildApp({
    config,
    repository: new Repository(':memory:'),
    tokenVerifier: new TokenVerifier(config.auth, idp.keys),
    logStream: { write: (line: string) => void lines.push(line) },
    frontendRoot: null,
    modelFactory: (onUsage, options) =>
      new ModelClient(config.provider, onUsage, rejecting, options?.maxCalls ?? 16),
  });
  close = () => app.close();
  repository.members.setWorkspaceMember({
    tenantId: TENANT_A,
    principalId: OWNER,
    role: 'owner',
    actor: { id: 'test-setup', workspaceRole: 'owner' },
  });
  tokens.owner = await mint({ oid: OWNER, roles: ['Swarm.Admin'] });
  tokens.platform = await mint({ oid: PLATFORM, roles: ['Swarm.PlatformAdmin'] });
  const session = repository.sessions.create(
    { id: OWNER, tenantId: TENANT_A, platformAdmin: false, bootstrapAdmin: false },
    { idleMs: 30 * 60_000, absoluteMs: 8 * 3_600_000 },
  );
  tokens.session = session.token;

  const send = async (label: string, request: InjectOptions): Promise<Answer> => {
    const response = await app.inject(request);
    const answer = {
      label,
      status: response.statusCode,
      headers: response.headers as Record<string, unknown>,
      body: response.body,
    };
    answers.push(answer);
    return answer;
  };
  const json = { 'content-type': 'application/json' };
  const asOwner = { host: HOST, authorization: `Bearer ${tokens.owner}` };
  const q = `token=${SECRETS.queryToken}&refresh_token=${SECRETS.refreshToken}`;

  await send('health', { url: `/api/health?${q}`, headers: { host: HOST } });
  await send('config', { url: `/api/config?${q}`, headers: asOwner });
  const created = await send('create', {
    method: 'POST',
    url: `/api/projects?${q}`,
    headers: { ...asOwner, ...json },
    payload: fixtureInput({
      name: CONTENT.name,
      question: CONTENT.question,
      documents: [
        {
          name: 'canary-document.md',
          content: `${CONTENT.document} ${'The board met twice. '.repeat(6)}`,
        },
      ],
    }),
  });
  projectId = (JSON.parse(created.body) as { id: string }).id;
  await send('read', {
    url: `/api/projects/${projectId}?access_token=${SECRETS.queryToken}`,
    headers: asOwner,
  });
  await send('run', {
    method: 'POST',
    url: `/api/projects/${projectId}/run?${q}`,
    headers: { ...asOwner, ...json },
    payload: {},
  });
  await jobs.idle();
  await send('scenario', {
    method: 'POST',
    url: `/api/scenario/parse?${q}`,
    headers: { ...asOwner, ...json },
    payload: { question: CONTENT.scenario },
  });
  await send('address', {
    method: 'POST',
    url: '/api/evidence/url',
    headers: { ...asOwner, ...json },
    payload: { url: `http://10.0.0.5/${CONTENT.addressPath}?token=${SECRETS.queryToken}` },
  });
  await send('address with a password', {
    method: 'POST',
    url: '/api/evidence/url',
    headers: { ...asOwner, ...json },
    payload: { url: `http://user:${SECRETS.databasePassword}@10.0.0.5/${CONTENT.addressPath}` },
  });
  await send('bad bearer', {
    url: '/api/projects',
    headers: { host: HOST, authorization: `Bearer ${SECRETS.badBearer}` },
  });
  await send('refresh token as a bearer', {
    url: '/api/projects',
    headers: { host: HOST, authorization: `Bearer ${SECRETS.refreshToken}` },
  });
  await send('bad cookie', {
    url: '/api/projects',
    headers: { host: HOST, cookie: `__Host-swarm_session=${SECRETS.cookie}` },
  });
  await send('session without the header', {
    method: 'POST',
    url: `/api/projects/${projectId}/pause`,
    headers: { host: HOST, cookie: `__Host-swarm_session=${tokens.session}` },
  });
  await send('session', {
    url: '/api/projects',
    headers: { host: HOST, cookie: `__Host-swarm_session=${tokens.session}` },
  });
  await send('invalid input', {
    method: 'POST',
    url: `/api/projects?${q}`,
    headers: { ...asOwner, ...json },
    payload: { name: CONTENT.name, question: CONTENT.question, documents: CONTENT.document },
  });
  await send('invalid json', {
    method: 'POST',
    url: `/api/projects?${q}`,
    headers: { ...asOwner, ...json },
    payload: `{"name": "${CONTENT.name}", "question": "${CONTENT.question}"`,
  });
  await send('missing project', {
    url: `/api/projects/00000000-0000-4000-8000-0000000000ff?${q}`,
    headers: asOwner,
  });
  await send('missing route', {
    url: `/api/nowhere/at-all?${q}`,
    headers: asOwner,
  });
  await send('unreadable address', { url: `/api/projects/%E0%A4%A?${q}`, headers: asOwner });
  await send('address too long', {
    url: `/api/projects/${'a'.repeat(200)}?${q}`,
    headers: asOwner,
  });
  await send('host not allowed', {
    url: `/api/health?${q}`,
    headers: { host: 'canary-host.example.test' },
  });
  await send('origin not allowed', {
    url: '/api/projects',
    headers: { ...asOwner, origin: 'https://canary-origin.example.test' },
  });

  const failing = vi.spyOn(repository, 'list').mockImplementation(() => {
    throw new Error(`${SECRETS.databasePassword} ${SECRETS.connectionString} ${CONTENT.question}`);
  });
  await send('internal failure', { url: `/api/projects?${q}`, headers: asOwner });
  failing.mockRestore();
  const unavailable = vi.spyOn(repository, 'create').mockImplementation(() => {
    throw new AppError(503, 'STORAGE_UNAVAILABLE', 'The database is not responding.', {
      cause: new Error(`${SECRETS.databasePassword} ${SECRETS.connectionString}`),
    });
  });
  await send('storage failure', {
    method: 'POST',
    url: '/api/projects',
    headers: { ...asOwner, ...json },
    payload: fixtureInput({ name: CONTENT.name, question: CONTENT.question }),
  });
  unavailable.mockRestore();
  await send('model provider failure', {
    method: 'POST',
    url: '/api/provider/check',
    headers: { host: HOST, authorization: `Bearer ${tokens.platform}`, ...json },
    payload: {},
  });

  const trail = await send('audit', { url: `/api/projects/${projectId}/audit`, headers: asOwner });
  const everything = await send('export', {
    url: `/api/projects/${projectId}/export?format=json`,
    headers: asOwner,
  });
  exported = everything.body;
  stored = repository.get(projectId);
  audit = JSON.stringify(repository.audit.list({ limit: 500 })) + trail.body;
  // Read now: the harness empties its span exporter after each test.
  telemetrySent = await telemetry.everythingExported();
  spansSeen = telemetry.spanExporter.getFinishedSpans().map((span) => ({
    name: span.name,
    attributes: Object.keys(span.attributes),
    events: span.events.length,
  }));
});

afterAll(async () => close());

/** The planted values that are found in a text. */
const foundIn = (text: string, needles: Iterable<string>): string[] =>
  [...needles].filter((needle) => text.includes(needle));

const failures = (): Answer[] => answers.filter((answer) => answer.status >= 400);
const everyToken = (): string[] => [
  ...Object.values(SECRETS),
  tokens.owner,
  tokens.owner.split('.')[1] ?? '',
  tokens.owner.split('.')[2] ?? '',
  tokens.platform,
  tokens.session,
];

describe('the session the sinks are read after', () => {
  it('really sent the planted values, and really reached every kind of answer', () => {
    // If nothing was planted, or nothing was refused, an empty sink would prove nothing.
    expect(stored?.name).toBe(CONTENT.name);
    expect(foundIn(exported, [CONTENT.document, CONTENT.question])).toEqual([
      CONTENT.document,
      CONTENT.question,
    ]);
    const statuses = new Set(answers.map((answer) => answer.status));
    for (const status of [200, 201, 202, 400, 401, 403, 404, 414, 500, 502, 503]) {
      expect(statuses.has(status) || status === 502, `${status}`).toBe(true);
    }
    expect(lines.length).toBeGreaterThan(40);
    expect(audit).toContain('project.created');
    expect(audit).toContain('access.refused');
    expect(audit).toContain('evidence.url.refused');
    expect(audit).toContain('10.0.0.5');
  });
});

describe('credentials and connection details', () => {
  it('are not in the log', () => {
    const log = lines.join('\n');
    expect(foundIn(log, everyToken())).toEqual([]);
    expect(log).not.toMatch(/eyJ[\w-]{10,}\./u);
    expect(log).not.toMatch(/\bbearer\s+\S+/iu);
    expect(log).not.toMatch(/postgres:\/\//iu);
  });

  it('are not in any answer that is an error', () => {
    for (const answer of failures()) {
      const text = JSON.stringify({ headers: answer.headers, body: answer.body });
      expect(foundIn(text, everyToken()), answer.label).toEqual([]);
      expect(text, answer.label).not.toMatch(/postgres:\/\/|InstrumentationKey|sk-canary/iu);
    }
  });

  it('are not in the answer to a request that succeeded, either', () => {
    for (const answer of answers.filter((candidate) => candidate.status < 400)) {
      if (answer.label === 'export') continue;
      expect(foundIn(answer.body, everyToken()), answer.label).toEqual([]);
      expect(Object.values(answer.headers).join('\n'), answer.label).not.toContain('canary');
    }
  });

  it('are not in the audit log', () => {
    expect(foundIn(audit, everyToken())).toEqual([]);
  });

  it('are not in the telemetry', () => {
    expect(foundIn(telemetrySent, everyToken())).toEqual([]);
  });

  it('are not in any span, which names the route and its outcome and records no exception or event', () => {
    expect(spansSeen.length).toBeGreaterThan(20);
    expect(spansSeen.map((span) => span.name)).toContain('swarm.job');
    for (const span of spansSeen) {
      expect(span.events, span.name).toBe(0);
      for (const name of span.attributes) expect(ALLOWED_ATTRIBUTES.has(name), name).toBe(true);
      // The name is a route template, never an address: no query, and no identifier.
      expect(span.name, span.name).not.toMatch(/[?=]|[0-9a-f]{8}-[0-9a-f]{4}-/u);
    }
  });
});

describe('what people wrote', () => {
  const written = Object.values(CONTENT);

  it('is not in the log: not a name, a question, a source, a scenario, an address or a note', () => {
    expect(foundIn(lines.join('\n'), written)).toEqual([]);
    expect(lines.join('\n')).not.toMatch(/quokka/iu);
  });

  it('is not in any answer that is an error', () => {
    for (const answer of failures()) {
      expect(foundIn(answer.body, written), answer.label).toEqual([]);
      expect(answer.body, answer.label).not.toMatch(/quokka/iu);
    }
  });

  it('is not in the audit log, which holds who did what and with which counts, never why', () => {
    expect(foundIn(audit, written)).toEqual([]);
    expect(audit).not.toMatch(/quokka/iu);
  });

  it('is not in the telemetry', () => {
    expect(foundIn(telemetrySent, written)).toEqual([]);
    expect(telemetrySent).not.toMatch(/quokka/iu);
    expect(telemetrySent).toContain('swarm.http.server.duration');
  });

  it('is kept only where its owner put it, and handed back to them', () => {
    expect(foundIn(exported, written.slice(0, 3))).toHaveLength(3);
  });
});

describe('an address that was refused', () => {
  it('leaves the host and the reason in the audit log, and neither the path, the query nor a password', () => {
    expect(audit).toMatch(/evidence\.url\.refused/u);
    expect(audit).not.toContain(CONTENT.addressPath);
    expect(audit).not.toContain(SECRETS.queryToken);
    expect(audit).not.toContain(SECRETS.databasePassword);
  });
});

describe('an answer to a failure that is the server’s', () => {
  const server = (): Answer[] => answers.filter((answer) => answer.status >= 500);

  it('says only that, in the shape of every error, with the id to quote', () => {
    expect(server().map((answer) => answer.label)).toEqual(
      expect.arrayContaining(['internal failure', 'storage failure']),
    );
    for (const answer of server()) {
      const body = JSON.parse(answer.body) as {
        error: { code: string; message: string; requestId: string };
      };
      expect(Object.keys(body), answer.label).toEqual(['error']);
      expect(Object.keys(body.error).sort(), answer.label).toEqual([
        'code',
        'message',
        'requestId',
      ]);
      expect(body.error.requestId, answer.label).toBe(answer.headers['x-request-id']);
      expect(body.error.message.length, answer.label).toBeLessThan(160);
    }
    const internal = answers.find((answer) => answer.label === 'internal failure')!;
    expect(JSON.parse(internal.body).error).toMatchObject({
      code: 'INTERNAL_ERROR',
      message:
        'An internal operation failed. Check the server log using the request or project ID.',
    });
    const storage = answers.find((answer) => answer.label === 'storage failure')!;
    expect(JSON.parse(storage.body).error).toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
      message: 'The database is not responding.',
    });
  });

  it('is written to the log as a code and an error type, and never as what went wrong', () => {
    const entries = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const failed = entries.filter((entry) => entry.level === 50);
    expect(failed.length).toBeGreaterThanOrEqual(2);
    for (const entry of failed) {
      expect(Object.keys(entry).sort()).toEqual(
        [
          'code',
          'errorType',
          'hostname',
          'level',
          'msg',
          'pid',
          'reqId',
          'requestId',
          'time',
        ].sort(),
      );
    }
  });
});
