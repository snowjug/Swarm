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
} from '@opentelemetry/sdk-trace-base';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp } from '../src/app.js';
import { createModelFactory, taskRunnerFor } from '../src/models/factory.js';
import { ProviderTelemetry } from '../src/models/telemetry.js';
import type { RunnableTask } from '../src/models/runner.js';
import { ALLOWED_ATTRIBUTES } from '../src/telemetry/attributes.js';
import { testConfig } from './fixtures.js';
import { FAKE_FOUNDRY_KEY, startFakeFoundry, type FakeFoundry } from './support/fake-foundry.js';

// What the model layer tells monitoring: counts, codes, sizes and names, and never a prompt, a reply,
// a credential or an address. Everything is read from what actually leaves the process.

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

let fake: FakeFoundry;
beforeAll(async () => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  trace.setGlobalTracerProvider(tracerProvider);
  metrics.setGlobalMeterProvider(meterProvider);
  fake = await startFakeFoundry({
    deployments: { 'general-dep': {}, 'priced-dep': {}, 'spare-dep': {} },
    fallbackReply: () => ({ items: ['an answer'] }),
  });
});
afterEach(() => {
  fake.reset();
  spanExporter.reset();
});
afterAll(async () => {
  await fake.close();
  await Promise.all([tracerProvider.shutdown(), meterProvider.shutdown()]);
  trace.disable();
  metrics.disable();
  context.disable();
});

interface Point {
  name: string;
  attributes: Record<string, unknown>;
  value: unknown;
}

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

async function everythingExported(): Promise<string> {
  return JSON.stringify({
    spans: spanExporter.getFinishedSpans().map((span) => ({
      name: span.name,
      attributes: span.attributes,
      events: span.events,
      status: span.status,
    })),
    metrics: await measurements(),
  });
}

const schema = z.object({ items: z.array(z.string().min(1)).min(1).max(3) });
type Shape = z.infer<typeof schema>;
const rules: Shape = { items: ['from rules'] };

const task = (extra: Partial<RunnableTask<Shape>> = {}): RunnableTask<Shape> => ({
  role: 'extraction',
  name: 'extract-items.v1',
  schema,
  instructions: 'Return the items.',
  data: { passage: 'A passage.' },
  signal: new AbortController().signal,
  maxTokens: 300,
  fallback: () => rules,
  ...extra,
});

function runner(extra: Record<string, string> = {}) {
  const config = testConfig(
    fake.environment({
      AI_MODEL: 'general-dep',
      FOUNDRY_DEPLOYMENT_EXTRACTION: 'priced-dep',
      FOUNDRY_DEPLOYMENT_CRITIC: 'spare-dep',
      MODEL_PRICES: JSON.stringify([
        { deployment: 'priced-dep', inputPerMillionUsd: 2, outputPerMillionUsd: 8 },
      ]),
      ...extra,
    }),
  );
  const telemetry = new ProviderTelemetry(config.provider);
  const factory = createModelFactory(config, telemetry);
  return { config, telemetry, run: taskRunnerFor(config, factory, { onUsage: () => undefined }) };
}

describe('the measurements of a task', () => {
  it('count the call, its tokens by role and deployment, and an estimated cost only where there is a price', async () => {
    const { run } = runner();
    fake.script(
      { kind: 'reply', value: { items: ['a'] }, usage: { prompt: 1_000, completion: 500 } },
      { kind: 'reply', value: { items: ['a'] }, usage: { prompt: 100, completion: 50 } },
    );
    await run.run(task());
    await run.run(task({ role: 'critic', name: 'critique.v1' }));
    const points = await measurements();
    expect(
      named(points, 'swarm.model.tokens', {
        'swarm.model.role': 'extraction',
        'swarm.model.name': 'priced-dep',
        'swarm.model.direction': 'input',
      })[0]?.value,
    ).toBe(1_000);
    expect(
      named(points, 'swarm.model.tokens', {
        'swarm.model.role': 'critic',
        'swarm.model.name': 'spare-dep',
        'swarm.model.direction': 'output',
      })[0]?.value,
    ).toBe(50);
    // 1,000 x $2/M + 500 x $8/M = $0.006; the other deployment has no price and so no cost point at all.
    const cost = named(points, 'swarm.model.cost.estimated_usd');
    expect(cost).toHaveLength(1);
    expect(cost[0]?.attributes['swarm.model.name']).toBe('priced-dep');
    expect(cost[0]?.value).toBeCloseTo(0.006, 9);
    expect(
      named(points, 'swarm.model.calls', {
        'swarm.model.role': 'extraction',
        'swarm.model.structured': 'json_schema',
        'swarm.model.outcome': 'ok',
      }),
    ).toHaveLength(1);
    expect(
      named(points, 'swarm.model.task.duration', {
        'swarm.model.role': 'extraction',
        'swarm.model.task': 'extract-items.v1',
        'swarm.model.source': 'model',
        'swarm.model.name': 'priced-dep',
      }),
    ).toHaveLength(1);
  });

  it('count a reply that failed its checks, and a task that rules had to answer, with a reason and a code', async () => {
    const { run } = runner();
    const wrong = { kind: 'text', text: '{"items":[]}' } as const;
    fake.script(wrong, wrong);
    const outcome = await run.run(task());
    expect(outcome.source).toBe('fallback');
    const points = await measurements();
    expect(
      named(points, 'swarm.model.schema_failures', { 'swarm.model.reason': 'schema' }),
    ).toHaveLength(2);
    expect(
      named(points, 'swarm.model.schema_failures', {
        'swarm.model.reason': 'schema',
        'swarm.model.repair': true,
      }),
    ).toHaveLength(1);
    expect(
      named(points, 'swarm.model.fallbacks', {
        'swarm.model.role': 'extraction',
        'swarm.error.code': 'MODEL_OUTPUT_INVALID',
      })[0]?.value,
    ).toBe(1);
  });

  it('do not call rules that were chosen a fallback', async () => {
    const config = testConfig();
    const none = taskRunnerFor(
      config,
      () => {
        throw new Error('no model');
      },
      { onUsage: () => undefined },
    );
    const before = named(await measurements(), 'swarm.model.fallbacks')[0]?.value ?? 0;
    await none.run(task());
    const after = named(await measurements(), 'swarm.model.fallbacks')[0]?.value ?? 0;
    expect(after).toBe(before);
    expect(
      named(await measurements(), 'swarm.model.task.duration', { 'swarm.model.source': 'fallback' })
        .length,
    ).toBeGreaterThan(0);
  });

  it('count what the provider’s safety did: a block by kind, and a detection that let the call through', async () => {
    const { run } = runner();
    fake.script(
      { kind: 'refusal' },
      { kind: 'filter-prompt', categories: ['jailbreak'] },
      { kind: 'detected', category: 'indirect_attack', value: { items: ['a'] } },
    );
    await run.run(task()).catch(() => undefined);
    await run.run(task()).catch(() => undefined);
    await run.run(task());
    const points = await measurements();
    expect(
      named(points, 'swarm.model.safety_blocks', { 'swarm.model.safety': 'refusal' })[0]?.value,
    ).toBe(1);
    expect(
      named(points, 'swarm.model.safety_blocks', { 'swarm.model.safety': 'jailbreak' })[0]?.value,
    ).toBe(1);
    expect(
      named(points, 'swarm.model.safety_signals', { 'swarm.model.safety': 'indirect_attack' })[0]
        ?.value,
    ).toBe(1);
    expect(
      named(points, 'swarm.model.task.duration', { 'swarm.model.source': 'refused' }).length,
    ).toBeGreaterThan(0);
  });

  it('count the cache’s hits and misses by role and task', async () => {
    const { run } = runner({ MODEL_CACHE: 'tenant' });
    await run.run(task({ tenantId: 't1' }));
    await run.run(task({ tenantId: 't1' }));
    const points = await measurements();
    const where = { 'swarm.model.role': 'extraction', 'swarm.model.task': 'extract-items.v1' };
    expect(named(points, 'swarm.model.cache.hits', where)[0]?.value).toBe(1);
    expect(named(points, 'swarm.model.cache.misses', where)[0]?.value).toBe(1);
  });

  it('use only attribute names on the allow-list', async () => {
    const { run } = runner({ MODEL_CACHE: 'tenant' });
    fake.script({ kind: 'text', text: '{"items":[]}' }, { kind: 'text', text: '{"items":[]}' });
    await run.run(task({ tenantId: 't1' }));
    await run.run(task({ tenantId: 't1' }));
    for (const point of (await measurements()).filter((entry) =>
      entry.name.startsWith('swarm.model.'),
    )) {
      for (const key of Object.keys(point.attributes)) {
        expect(ALLOWED_ATTRIBUTES.has(key), `${point.name} carries ${key}`).toBe(true);
      }
    }
    for (const span of spanExporter.getFinishedSpans()) {
      for (const key of Object.keys(span.attributes)) {
        expect(ALLOWED_ATTRIBUTES.has(key), `${span.name} carries ${key}`).toBe(true);
      }
    }
  });
});

describe('what never leaves the process', () => {
  const CANARIES = [
    'CANARY-PASSAGE-TEXT',
    'CANARY-INSTRUCTION-TEXT',
    'CANARY-REPLY-TEXT',
    'CANARY-TENANT-NAME',
  ];

  async function runWithContent(extra: Record<string, string>) {
    const { run } = runner(extra);
    fake.script(
      { kind: 'reply', value: { items: ['CANARY-REPLY-TEXT'] } },
      { kind: 'text', text: '{"items":[],"note":"CANARY-REPLY-TEXT"}' },
      { kind: 'text', text: '{"items":[],"note":"CANARY-REPLY-TEXT"}' },
    );
    const content = {
      instructions: 'CANARY-INSTRUCTION-TEXT: return the items.',
      data: { passage: 'CANARY-PASSAGE-TEXT about a ferry.' },
      tenantId: 'CANARY-TENANT-NAME',
    };
    await run.run(task(content));
    await run.run(task({ ...content, data: { passage: 'CANARY-PASSAGE-TEXT, another.' } }));
  }

  it('keeps every prompt, reply and name out of spans and metrics, and every content-derived attribute off, by default', async () => {
    await runWithContent({ MODEL_CACHE: 'tenant' });
    const exported = await everythingExported();
    for (const canary of CANARIES) expect(exported, canary).not.toContain(canary);
    const names = new Set(
      spanExporter.getFinishedSpans().flatMap((span) => Object.keys(span.attributes)),
    );
    for (const derived of [
      'swarm.model.input_chars',
      'swarm.model.output_chars',
      'swarm.model.input_hash',
    ]) {
      expect(names.has(derived), derived).toBe(false);
    }
    const task = spanExporter.getFinishedSpans().find((span) => span.name === 'swarm.model.task');
    expect(task?.attributes).toMatchObject({
      'swarm.model.role': 'extraction',
      'swarm.model.task': 'extract-items.v1',
    });
  });

  it('adds only a size and a hash when traces may carry what is derived from content, and still no text', async () => {
    await runWithContent({ TELEMETRY_TRACE_CONTENT: 'redacted' });
    const exported = await everythingExported();
    for (const canary of CANARIES) expect(exported, canary).not.toContain(canary);
    const spans = spanExporter
      .getFinishedSpans()
      .filter((span) => span.name === 'swarm.model.task');
    expect(spans.length).toBe(2);
    for (const span of spans) {
      expect(span.attributes['swarm.model.input_chars']).toEqual(expect.any(Number));
      expect(span.attributes['swarm.model.output_chars']).toEqual(expect.any(Number));
      expect(span.attributes['swarm.model.input_hash']).toMatch(/^[0-9a-f]{16}$/u);
    }
    const [first, second] = spans;
    expect(first?.attributes['swarm.model.input_hash']).not.toBe(
      second?.attributes['swarm.model.input_hash'],
    );
  });

  it('keeps credentials and the address of the resource out of every measurement and of the status', async () => {
    const { run, telemetry, config } = runner();
    await run.run(task());
    const exported = await everythingExported();
    const shown = JSON.stringify(telemetry.snapshot());
    for (const secret of [
      FAKE_FOUNDRY_KEY,
      fake.token,
      '127.0.0.1',
      String(new URL(fake.url).port),
    ]) {
      expect(exported, secret).not.toContain(secret);
      expect(shown, secret).not.toContain(secret);
    }
    expect(config.provider.apiKey).toBe(FAKE_FOUNDRY_KEY);
  });
});

describe('the logs and the answers of a running server', () => {
  it('never hold the key, the token or the endpoint, whichever way the model is signed in to', async () => {
    const lines: string[] = [];
    fake.respond(() => ({ kind: 'reply', value: { status: 'ok' } }));
    for (const auth of ['key', 'entra'] as const) {
      const config = testConfig(
        fake.environment({ AI_MODEL: 'general-dep', LOG_LEVEL: 'debug' }, auth),
      );
      const factory = createModelFactory(
        config,
        new ProviderTelemetry(config.provider),
        fake.tokens,
      );
      const instance = await buildApp({
        config,
        modelFactory: factory,
        logStream: { write: (message) => void lines.push(message) },
      });
      try {
        const headers = { 'x-swarm-csrf': '1' };
        const check = await instance.app.inject({
          method: 'POST',
          url: '/api/provider/check',
          headers,
        });
        expect(check.statusCode, check.body).toBe(200);
        const status = await instance.app.inject({ method: 'GET', url: '/api/provider/status' });
        const settings = await instance.app.inject({ method: 'GET', url: '/api/config' });
        for (const body of [check.body, status.body, settings.body]) lines.push(body);
      } finally {
        await instance.app.close();
      }
    }
    expect(fake.requests.length).toBeGreaterThan(1);
    const everything = lines.join('\n');
    for (const secret of [FAKE_FOUNDRY_KEY, fake.token, fake.url, '127.0.0.1']) {
      expect(everything, secret).not.toContain(secret);
    }
  });
});
