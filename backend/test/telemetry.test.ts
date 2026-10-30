import { context, metrics, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type DataPoint,
} from '@opentelemetry/sdk-metrics';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { TokenVerifier } from '../src/auth/tokens.js';
import { ProviderTelemetry } from '../src/models/telemetry.js';
import { ALLOWED_ATTRIBUTES, redact, safeAttributes } from '../src/telemetry/attributes.js';
import { fixtureInput, testConfig } from './fixtures.js';
import { entraEnvironment, idp } from './support/entra-idp.js';

const spanExporter = new InMemorySpanExporter();
const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
const reader = new PeriodicExportingMetricReader({
  exporter: metricExporter,
  exportIntervalMillis: 3_600_000,
});
const tracerProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(spanExporter)],
});
const meterProvider = new MeterProvider({ readers: [reader] });

beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  trace.setGlobalTracerProvider(tracerProvider);
  metrics.setGlobalMeterProvider(meterProvider);
});
afterAll(async () => {
  await Promise.all([tracerProvider.shutdown(), meterProvider.shutdown()]);
  trace.disable();
  metrics.disable();
  context.disable();
});

const applications: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
  spanExporter.reset();
});

async function start(options: Partial<Parameters<typeof buildApp>[0]> = {}) {
  const instance = await buildApp({ config: testConfig(), ...options });
  applications.push(instance);
  return instance;
}

interface Point {
  name: string;
  attributes: Record<string, unknown>;
  value: unknown;
}

/** The measurements as of now, one entry per name and set of attributes. */
async function measurements(): Promise<Point[]> {
  metricExporter.reset();
  await reader.forceFlush();
  const latest = metricExporter.getMetrics().at(-1);
  const points: Point[] = [];
  for (const scope of latest?.scopeMetrics ?? []) {
    for (const metric of scope.metrics) {
      for (const point of metric.dataPoints as DataPoint<unknown>[]) {
        points.push({
          name: metric.descriptor.name,
          attributes: { ...point.attributes },
          value: point.value,
        });
      }
    }
  }
  return points;
}

const named = (points: Point[], name: string, attributes: Record<string, unknown> = {}) =>
  points.filter(
    (point) =>
      point.name === name &&
      Object.entries(attributes).every(([key, value]) => point.attributes[key] === value),
  );

const spans = (name: string): ReadableSpan[] =>
  spanExporter.getFinishedSpans().filter((span) => span.name === name);

/** Everything that would leave the process, as text. */
async function everythingExported(): Promise<string> {
  return JSON.stringify({
    spans: spanExporter.getFinishedSpans().map((span) => ({
      name: span.name,
      attributes: span.attributes,
      events: span.events,
      links: span.links,
      status: span.status,
      resource: span.resource.attributes,
    })),
    metrics: await measurements(),
  });
}

describe('what telemetry may carry', () => {
  it('keeps only named attributes, and only plain values', () => {
    const clean = safeAttributes({
      'swarm.job.kind': 'simulation',
      'swarm.job.attempt': 2,
      'swarm.project.branch': true,
      'swarm.job.max_attempts': Number.NaN,
      prompt: 'Tell me about the fictional ferry',
      authorization: 'Bearer abcdefghijklmnop',
      'http.url': 'https://example.test/api?token=abc',
      'swarm.http.route': { nested: 'object' },
      'swarm.error.code': ['not', 'a', 'scalar'],
    });
    expect(clean).toEqual({
      'swarm.job.kind': 'simulation',
      'swarm.job.attempt': 2,
      'swarm.project.branch': true,
    });
    // The list is the boundary: nothing on it names content.
    for (const name of ALLOWED_ATTRIBUTES) {
      expect(name).toMatch(/^swarm\./u);
      expect(name).not.toMatch(
        /prompt|content|text|body|header|cookie|token|email|user|actor|author/u,
      );
    }
  });

  it('redacts what looks like a credential or a person even in a name that is allowed', () => {
    const jwt =
      'eyJhbGciOiJSUzI1NiJ9.eyJ0aWQiOiIxMTExMTExMS0xMTExLTQxMTEtODExMS0xMTExMTExMTExMTEifQ.c2lnbmF0dXJl';
    const hostile = [
      `Bearer ${jwt}`,
      jwt,
      'sk-abcdefghijklmnopqrstuvwxyz012345',
      'someone@example.test',
      'password=hunter2hunter2',
      'InstrumentationKey=00000000-0000-4000-8000-000000000000;IngestionEndpoint=https://x.test/',
      'postgres://swarm:s3cret@db.example.test/swarm',
      'a'.repeat(64),
    ];
    for (const value of hostile) {
      const clean = safeAttributes({ 'swarm.error.code': value })['swarm.error.code'] as string;
      expect(clean, value).toContain('[redacted]');
      expect(clean).not.toMatch(
        /eyJ|sk-abc|someone@|hunter2|InstrumentationKey=0|s3cret|aaaaaaaa/u,
      );
    }
    // Identifiers and codes are left alone, and long text is cut.
    expect(redact('3f2b8c1e-5d4a-4e6f-9a7b-0c1d2e3f4a5b')).toBe(
      '3f2b8c1e-5d4a-4e6f-9a7b-0c1d2e3f4a5b',
    );
    expect(redact('MODEL_RATE_LIMIT')).toBe('MODEL_RATE_LIMIT');
    expect(redact('x '.repeat(200)).length).toBeLessThanOrEqual(121);
  });
});

describe('requests', () => {
  it('are answered with a correlation id that the error body and the span repeat', async () => {
    const { app } = await start();
    const ok = await app.inject('/api/health');
    expect(ok.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/u);

    const missing = await app.inject('/api/projects/00000000-0000-4000-8000-000000000000');
    expect(missing.statusCode).toBe(404);
    const id = missing.headers['x-request-id'];
    expect(missing.json().error.requestId).toBe(id);
    expect(id).not.toBe(ok.headers['x-request-id']);

    const span = spans('GET /api/projects/:id')[0]!;
    expect(span.attributes).toMatchObject({
      'swarm.request.id': id,
      'swarm.http.route': '/api/projects/:id',
      'swarm.http.status': 404,
      'swarm.error.code': 'PROJECT_NOT_FOUND',
    });

    // A refusal before any route runs is correlated too.
    const refused = await app.inject({ url: '/api/health', headers: { host: 'unlisted.example' } });
    expect(refused.statusCode).toBe(403);
    expect(refused.headers['x-request-id']).toBe(refused.json().error.requestId);
  });

  it('are counted by route template, status class and error code, never by address', async () => {
    const { app } = await start();
    await app.inject('/api/projects/00000000-0000-4000-8000-000000000000?note=canary-query');
    await app.inject({ url: '/api/health', headers: { host: 'unlisted.example' } });
    const points = await measurements();
    expect(
      named(points, 'swarm.http.server.duration', {
        'swarm.http.route': '/api/projects/:id',
        'swarm.http.status_class': '4xx',
      }),
    ).toHaveLength(1);
    expect(
      named(points, 'swarm.http.errors', {
        'swarm.error.code': 'PROJECT_NOT_FOUND',
        'swarm.http.status_class': '4xx',
      }),
    ).toHaveLength(1);
    expect(
      named(points, 'swarm.auth.denials', { 'swarm.auth.reason': 'HOST_NOT_ALLOWED' }),
    ).toHaveLength(1);
    expect(await everythingExported()).not.toMatch(/canary-query|unlisted\.example/u);
  });

  it('count a caller with no valid token as a denial', async () => {
    const config = testConfig(entraEnvironment);
    const { app } = await start({
      config,
      tokenVerifier: new TokenVerifier(config.auth, idp.keys),
    });
    const refused = await app.inject({ url: '/api/projects' });
    expect(refused.statusCode).toBe(401);
    const points = await measurements();
    expect(
      named(points, 'swarm.auth.denials', { 'swarm.auth.reason': 'UNAUTHENTICATED' }),
    ).toHaveLength(1);
    expect(spans('GET /api/projects')[0]?.attributes).toMatchObject({
      'swarm.http.status': 401,
      'swarm.error.code': 'UNAUTHENTICATED',
    });
  });
});

describe('what never leaves the process', () => {
  it('keeps credentials, cookies, documents, questions and names out of every span and metric', async () => {
    const bearer = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJjYW5hcnktc3ViamVjdCJ9.Y2FuYXJ5LXNpZw';
    const { app, jobs, repository } = await start();
    const headers = {
      authorization: `Bearer ${bearer}`,
      cookie: '__Host-swarm_session=canary-session-cookie',
      'content-type': 'application/json',
    };
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers,
      payload: fixtureInput({
        name: 'Canary project name',
        question: 'Will the canary question leak?',
        documents: [
          {
            name: 'canary-document.md',
            content: `Canary source text about the fictional ferry service. ${'The harbour board met twice. '.repeat(8)}`,
          },
        ],
      }),
    });
    expect(created.statusCode, created.body).toBe(201);
    const { id } = created.json<{ id: string }>();
    jobs.enqueue(id);
    await jobs.idle();
    expect(repository.get(id).status).toBe('completed');
    await app.inject({ url: `/api/projects/${id}?access_token=canary-query-token`, headers });
    await app.inject({ url: `/api/projects/${id}/export.md`, headers });

    const exported = await everythingExported();
    for (const canary of [
      bearer,
      'canary-session-cookie',
      'canary-query-token',
      'Canary project name',
      'canary question',
      'canary-document',
      'Canary source text',
      'harbour board',
    ]) {
      expect(exported, canary).not.toContain(canary);
    }
    // What was recorded is only a name from the list.
    for (const span of spanExporter.getFinishedSpans()) {
      for (const key of Object.keys(span.attributes))
        expect(ALLOWED_ATTRIBUTES.has(key), key).toBe(true);
    }
    for (const point of await measurements()) {
      for (const key of Object.keys(point.attributes))
        expect(ALLOWED_ATTRIBUTES.has(key), key).toBe(true);
    }
  });
});

describe('jobs', () => {
  it('leave a span, a count and a duration with their kind and outcome', async () => {
    const { jobs, repository } = await start();
    const { id } = repository.create(fixtureInput({ workflow: 'guided' }));
    jobs.enqueueStep(id, 'knowledge');
    await jobs.idle();

    const span = spans('swarm.job')[0]!;
    expect(span.attributes).toMatchObject({
      'swarm.job.kind': 'knowledge',
      'swarm.job.outcome': 'completed',
      'swarm.job.attempt': 1,
      'swarm.project.id': id,
      'swarm.role': 'all',
    });
    const points = await measurements();
    expect(
      named(points, 'swarm.jobs.finished', {
        'swarm.job.kind': 'knowledge',
        'swarm.job.outcome': 'completed',
      })[0]?.value,
    ).toBeGreaterThanOrEqual(1);
    expect(
      named(points, 'swarm.jobs.duration', { 'swarm.job.kind': 'knowledge' }),
    ).not.toHaveLength(0);
  });

  it('report the queue, its oldest job, the database and the worker through gauges, and stop when the app closes', async () => {
    const instance = await start({ jobs: { role: 'api', timers: false } });
    const { jobs, repository } = instance;
    const { id } = repository.create(fixtureInput({ workflow: 'guided' }));
    jobs.enqueueStep(id, 'knowledge');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const points = await measurements();
    expect(
      named(points, 'swarm.jobs.by_state', { 'swarm.job.state': 'queued', 'swarm.role': 'api' })[0]
        ?.value,
    ).toBe(1);
    expect(named(points, 'swarm.jobs.oldest_waiting', { 'swarm.role': 'api' })).toHaveLength(1);
    expect(named(points, 'swarm.db.up', { 'swarm.role': 'api' })[0]?.value).toBe(1);
    expect(named(points, 'swarm.worker.busy', { 'swarm.role': 'api' })[0]?.value).toBe(0);

    // Once the app is closed its gauges are not read again: a closed database is never asked.
    const asked = vi.spyOn(jobs, 'summary');
    await instance.app.close();
    applications.splice(applications.indexOf(instance), 1);
    asked.mockClear();
    await measurements();
    expect(asked).not.toHaveBeenCalled();
  });
});

describe('model calls and the ledger', () => {
  it('are counted with their provider, model and outcome, and tokens by direction, without content', async () => {
    const config = testConfig({
      AI_PROVIDER: 'openai',
      AI_MODEL: 'fixture-model',
      OPENAI_API_KEY: 'canary-api-key-0123456789',
      OPENAI_BASE_URL: 'https://api.openai.example/v1',
    });
    const provider = new ProviderTelemetry(config.provider);
    provider.onCall({
      ok: true,
      repair: false,
      latencyMs: 120,
      inputTokens: 300,
      outputTokens: 40,
      tokensReported: true,
      errorCode: null,
    });
    provider.onCall({
      ok: true,
      repair: true,
      latencyMs: 80,
      inputTokens: 100,
      outputTokens: 10,
      tokensReported: true,
      errorCode: null,
    });
    provider.onCall({
      ok: false,
      repair: false,
      latencyMs: 900,
      inputTokens: 0,
      outputTokens: 0,
      tokensReported: false,
      errorCode: 'MODEL_RATE_LIMIT',
    });
    const points = await measurements();
    const calls = (outcome: string) =>
      named(points, 'swarm.model.calls', {
        'swarm.model.provider': 'openai',
        'swarm.model.name': 'fixture-model',
        'swarm.model.outcome': outcome,
      });
    expect(calls('ok')[0]?.value).toBe(1);
    expect(calls('repaired')[0]?.value).toBe(1);
    expect(calls('failed')[0]).toMatchObject({
      value: 1,
      attributes: { 'swarm.error.code': 'MODEL_RATE_LIMIT' },
    });
    expect(
      named(points, 'swarm.model.tokens', { 'swarm.model.direction': 'input' })[0]?.value,
    ).toBe(400);
    expect(
      named(points, 'swarm.model.tokens', { 'swarm.model.direction': 'output' })[0]?.value,
    ).toBe(50);
    expect(named(points, 'swarm.model.latency')).not.toHaveLength(0);
    expect(await everythingExported()).not.toContain('canary-api-key');
  });

  it('count the support class of every statement the grounding review judged', async () => {
    const { repository } = await start();
    const { id } = repository.create(
      fixtureInput({
        workflow: 'guided',
        documents: [
          {
            name: 'council-note.md',
            content:
              'Annual ferry ridership reached 412,000 passengers in 2024 according to the island council. The council supports the electric ferry plan for the island route this winter.',
          },
          {
            name: 'operator-memo.md',
            content:
              'Annual ferry ridership was 365,000 passengers in 2024 according to the ferry operator. The operator reports it will deliver the island route plan with the current diesel vessel.',
          },
        ],
      }),
    );
    const claim = (
      n: number,
      text: string,
      verdict: string,
      sourceIds: string[],
      kind = 'extracted-claim',
    ) => ({
      id: `C${n}`,
      section: 'Evidence',
      text,
      kind,
      sourceIds,
      memoryIds: [],
      quote: null,
      verdict,
      checks: {
        quote: null,
        overlap: verdict === 'unchecked' ? null : 0.9,
        numbers: verdict === 'unchecked' ? null : 'match',
        entailment: null,
      },
      reason: 'Matches the cited passage.',
    });
    repository.update(id, {
      report: {
        generatedBy: 'llm',
        title: 'Ferry report',
        executiveSummary: 'Summary.',
        sections: [
          { title: 'Evidence', body: 'Body text of the evidence chapter.', sourceIds: ['S1'] },
        ],
        limitations: [],
        grounding: {
          checkedAt: '2026-10-29T09:00:00.000Z',
          method: 'deterministic',
          claims: [
            claim(1, 'The council note reports 412,000 annual passengers.', 'supported', ['S1']),
            claim(
              2,
              'The council supports the electric ferry plan for the island route.',
              'supported',
              ['S1'],
            ),
            claim(3, 'The operator reports annual ridership of 365,000 passengers.', 'partial', [
              'S2',
            ]),
            claim(
              4,
              'Residents may switch to the ferry if fares fall.',
              'unchecked',
              [],
              'ai-hypothesis',
            ),
          ],
          counts: { supported: 2, partial: 1, unsupported: 0, contradicted: 0, unchecked: 1 },
          unverifiedFigures: [],
          notes: [],
        },
        metrics: {
          initialMean: 0,
          finalMean: 0,
          finalSupport: 0.5,
          finalOpposition: 0.3,
          polarization: 0.2,
          totalInteractions: 10,
        },
      } as never,
    });
    const { LedgerService } = await import('../src/grounding/service.js');
    new LedgerService(repository).rebuild(id);
    const points = await measurements();
    const count = (supportClass: string) =>
      named(points, 'swarm.grounding.statements', { 'swarm.grounding.class': supportClass })[0]
        ?.value;
    // The conflict between the two sources weighs on the statement that repeats a conflicting figure.
    expect(count('directly-supported')).toBe(1);
    expect(count('partially-supported')).toBe(2);
    expect(count('not-checkable')).toBe(1);
  });

  it('count audit entries by action, so that exports, runs, branches and refusals can be watched', async () => {
    const { app, repository } = await start();
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: fixtureInput(),
      headers: { 'content-type': 'application/json' },
    });
    const { id } = created.json<{ id: string }>();
    repository.audit.record({
      actor: 'tester',
      action: 'export.markdown',
      targetType: 'project',
      targetId: id,
      projectId: id,
    });
    const points = await measurements();
    expect(
      named(points, 'swarm.audit.events', { 'swarm.audit.action': 'project.created' })[0]?.value,
    ).toBeGreaterThanOrEqual(1);
    expect(
      named(points, 'swarm.audit.events', { 'swarm.audit.action': 'export.markdown' })[0]?.value,
    ).toBe(1);
  });
});
