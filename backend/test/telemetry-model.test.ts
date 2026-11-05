import { SpanStatusCode, context, metrics, trace } from '@opentelemetry/api';
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
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { buildApp } from '../src/app.js';
import { CONSTRAINT_TASK } from '../src/constraints/model.js';
import { AppError } from '../src/errors.js';
import { ModelClient, type ModelGateway } from '../src/models/client.js';
import { createModelFactory, taskRunnerFor } from '../src/models/factory.js';
import { ProviderTelemetry } from '../src/models/telemetry.js';
import type { RunnableTask } from '../src/models/runner.js';
import { MODEL_ROLES, runStructuredTask } from '../src/models/task.js';
import {
  MODEL_TASKS,
  TASK_OUTCOMES,
  taskNameOf,
  traceTask,
  tracedGateway,
} from '../src/models/task-telemetry.js';
import { jsonValidated } from '../src/models/validated.js';
import { PLAN_TASK } from '../src/research/plan.js';
import { ALLOWED_ATTRIBUTES } from '../src/telemetry/attributes.js';
import { signals } from '../src/telemetry/signals.js';
import { testConfig } from './fixtures.js';
import {
  FAKE_FOUNDRY_KEY,
  startFakeFoundry,
  type FakeFoundry,
  type FakeStep,
} from './support/fake-foundry.js';

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

/** What a counter went up by between two readings, over the points that carry these attributes. */
function rose(
  before: Point[],
  after: Point[],
  name: string,
  attributes: Record<string, unknown> = {},
): number {
  const total = (points: Point[]) =>
    named(points, name, attributes).reduce((sum, point) => sum + Number(point.value), 0);
  return total(after) - total(before);
}

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
  name: 'ontology.v1',
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
    await run.run(task({ role: 'critic', name: 'critic-review.v1' }));
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
        'swarm.model.task': 'ontology.v1',
        'swarm.model.task_outcome': 'ok',
        'swarm.model.provider': 'foundry',
        'swarm.model.source': 'model',
        'swarm.model.name': 'priced-dep',
      }),
    ).toHaveLength(1);
  });

  it('count a reply that failed its checks, and a task that rules had to answer, with a reason and a code', async () => {
    const { run } = runner();
    const wrong = { kind: 'text', text: '{"items":[]}' } as const;
    fake.script(wrong, wrong);
    const before = await measurements();
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
    // Each whole reply that was refused is a call of its own that gave no answer, kept apart from one
    // that failed and from one that was cut off; none of them is counted as a call that went well.
    const calls = (outcome: string) =>
      rose(before, points, 'swarm.model.calls', {
        'swarm.model.outcome': outcome,
      });
    expect(calls('schema-invalid')).toBe(2);
    expect(
      named(points, 'swarm.model.calls', { 'swarm.model.outcome': 'schema-invalid' })[0]
        ?.attributes,
    ).toMatchObject({
      'swarm.model.role': 'extraction',
      'swarm.model.finish_reason': 'stop',
      'swarm.error.code': 'MODEL_OUTPUT_INVALID',
    });
    expect(calls('ok')).toBe(0);
    expect(calls('failed')).toBe(0);
    expect(calls('truncated')).toBe(0);
  });

  it('count a reply that was cut off at its limit as truncated, with what it used, and not as a failed call', async () => {
    const { run } = runner();
    fake.script(
      { kind: 'truncated', usage: { prompt: 500, completion: 1_300, reasoning: 1_300 } },
      { kind: 'truncated', usage: { prompt: 500, completion: 2_600, reasoning: 2_500 } },
    );
    const before = await measurements();
    const outcome = await run.run(task());
    expect(outcome).toMatchObject({
      source: 'fallback',
      failure: { code: 'MODEL_TRUNCATED', detail: expect.stringContaining('asked again once') },
    });
    const points = await measurements();
    const calls = (outcome: string) =>
      rose(before, points, 'swarm.model.calls', {
        'swarm.model.outcome': outcome,
        'swarm.model.role': 'extraction',
      });
    expect(calls('truncated')).toBe(2);
    expect(calls('failed')).toBe(0);
    expect(
      named(points, 'swarm.model.calls', { 'swarm.model.outcome': 'truncated' })[0]?.attributes,
    ).toMatchObject({
      'swarm.model.finish_reason': 'length',
      'swarm.model.effort': 'low',
      'swarm.error.code': 'MODEL_TRUNCATED',
    });
    // Both were billed: the tokens are counted, and so is the thinking, on a counter of its own.
    const spent = (name: string, attributes: Record<string, unknown> = {}) =>
      rose(before, points, name, { 'swarm.model.role': 'extraction', ...attributes });
    expect(spent('swarm.model.tokens', { 'swarm.model.direction': 'output' })).toBe(3_900);
    expect(spent('swarm.model.tokens', { 'swarm.model.direction': 'input' })).toBe(1_000);
    expect(spent('swarm.model.reasoning_tokens')).toBe(3_800);
    expect(
      rose(before, points, 'swarm.model.fallbacks', { 'swarm.error.code': 'MODEL_TRUNCATED' }),
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
    const where = { 'swarm.model.role': 'extraction', 'swarm.model.task': 'ontology.v1' };
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
      'swarm.model.task': 'ontology.v1',
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

// ---------------------------------------------------------------------------------------------
// Every structured task is recorded, once per invocation, by whatever path it runs: the task runner,
// `runStructuredTask`, or a plain call that handles its own failure.
// ---------------------------------------------------------------------------------------------

const spansOf = () =>
  spanExporter.getFinishedSpans().filter((span) => span.name === 'swarm.model.task');

/** How many tasks the duration histogram has counted with these attributes. */
async function tally(attributes: Record<string, unknown>): Promise<number> {
  return named(await measurements(), 'swarm.model.task.duration', attributes).reduce(
    (total, point) => total + (point.value as { count: number }).count,
    0,
  );
}

async function fallbacks(attributes: Record<string, unknown>): Promise<number> {
  return named(await measurements(), 'swarm.model.fallbacks', attributes).reduce(
    (total, point) => total + (point.value as number),
    0,
  );
}

function client(extra: Record<string, string> = {}): ModelClient {
  const config = testConfig(fake.environment({ AI_MODEL: 'general-dep', ...extra }));
  return new ModelClient(config.provider, () => undefined, undefined, 16, {
    observer: new ProviderTelemetry(config.provider),
  });
}

const wrong = { kind: 'text', text: '{"items":[]}' } as const;
const right = { kind: 'reply', value: { items: ['a'] } } as const;
const signal = () => new AbortController().signal;
/** The deployments `runner()` routes the roles to. */
const deploymentOf = (role: string): string =>
  role === 'extraction' ? 'priced-dep' : role === 'critic' ? 'spare-dep' : 'general-dep';

describe('every task of the product is recorded once, as a span and a duration', () => {
  it('has a role that is one of the roles, and a versioned name, for every task on the list', () => {
    for (const [name, role] of Object.entries(MODEL_TASKS)) {
      expect(MODEL_ROLES, name).toContain(role);
      expect(name, name).toMatch(/^[a-z]+(?:-[a-z]+)*\.v\d+$/u);
    }
    expect(Object.keys(MODEL_TASKS).length).toBeGreaterThanOrEqual(20);
  });

  it.each(Object.entries(MODEL_TASKS))(
    '%s, a task of the %s, goes through the runner as one span and one duration, and nothing else',
    async (name, role) => {
      const { run } = runner();
      const expected = {
        'swarm.model.role': role,
        'swarm.model.task': name,
        'swarm.model.provider': 'foundry',
        'swarm.model.task_outcome': 'ok',
        'swarm.model.source': 'model',
        'swarm.model.name': deploymentOf(role),
      };
      const before = [await tally(expected), await tally({ 'swarm.model.task': name })];
      // The counts are cumulative for the file, and an earlier test may have made this task fall back: what is
      // asserted is that this run did not add one.
      const fellBack = await fallbacks({ 'swarm.model.task': name });
      const outcome = await run.run(task({ role, name }));
      expect(outcome).toMatchObject({ source: 'model', failure: null });
      // One span, with exactly these attributes: no text, no id, no address has a name to be recorded under.
      expect(spansOf().map((span) => span.attributes)).toEqual([expected]);
      expect(spansOf()[0]?.status.code).toBe(SpanStatusCode.UNSET);
      expect([await tally(expected), await tally({ 'swarm.model.task': name })]).toEqual([
        before[0]! + 1,
        before[1]! + 1,
      ]);
      expect(await fallbacks({ 'swarm.model.task': name })).toBe(fellBack);
    },
  );
});

describe('how a task ended', () => {
  interface Ending {
    outcome: (typeof TASK_OUTCOMES)[number];
    script: FakeStep[];
    source: 'model' | 'fallback' | 'refused' | null;
    code: string | null;
    throws?: string;
    fallback?: () => Shape;
  }
  const endings: Ending[] = [
    { outcome: 'ok', script: [right], source: 'model', code: null },
    // The first reply failed the schema, and the correction round gave a valid one.
    { outcome: 'corrected', script: [wrong, right], source: 'model', code: null },
    // Rules stood in for a model that was asked and could not be used.
    {
      outcome: 'fell-back',
      script: [wrong, wrong],
      source: 'fallback',
      code: 'MODEL_OUTPUT_INVALID',
    },
    // A refusal is never answered from rules: it is thrown, and it is recorded.
    {
      outcome: 'refused',
      script: [{ kind: 'refusal' }],
      source: 'refused',
      code: 'MODEL_REFUSED',
      throws: 'MODEL_REFUSED',
    },
    // The rules answer did not pass its own checks: the task failed.
    {
      outcome: 'failed',
      script: [wrong, wrong],
      source: null,
      code: 'FALLBACK_INVALID',
      throws: 'FALLBACK_INVALID',
      fallback: () => ({ items: [] }),
    },
  ];

  it.each(endings)('is recorded as $outcome', async (ending) => {
    const { run } = runner();
    const identity = {
      'swarm.model.role': 'scenario',
      'swarm.model.task': 'scenario-frame.v1',
      'swarm.model.task_outcome': ending.outcome,
    };
    const before = await tally(identity);
    const failuresBefore = await fallbacks({ 'swarm.model.task': 'scenario-frame.v1' });
    fake.script(...ending.script);
    const asked = run.run(
      task({
        role: 'scenario',
        name: 'scenario-frame.v1',
        ...(ending.fallback ? { fallback: ending.fallback } : {}),
      }),
    );
    if (ending.throws) await expect(asked).rejects.toMatchObject({ code: ending.throws });
    else await asked;
    expect(spansOf().map((span) => span.attributes)).toEqual([
      {
        ...identity,
        'swarm.model.provider': 'foundry',
        'swarm.model.name': 'general-dep',
        ...(ending.source ? { 'swarm.model.source': ending.source } : {}),
        ...(ending.code ? { 'swarm.error.code': ending.code } : {}),
      },
    ]);
    // Only a task that failed is an error of the span; a refusal or a fallback is an answer of a kind.
    expect(spansOf()[0]?.status.code).toBe(
      ending.outcome === 'failed' ? SpanStatusCode.ERROR : SpanStatusCode.UNSET,
    );
    expect(await tally(identity)).toBe(before + 1);
    // Rules that stood in for a model are counted as a fallback, once; nothing else is.
    expect(await fallbacks({ 'swarm.model.task': 'scenario-frame.v1' })).toBe(
      failuresBefore + (ending.outcome === 'fell-back' ? 1 : 0),
    );
  });

  it('is recorded as cancelled when the task is cancelled in flight, and when it was cancelled before it began', async () => {
    const { run } = runner();
    const controller = new AbortController();
    fake.script({ kind: 'slow', ms: 5_000, then: right });
    const pending = run.run(task({ signal: controller.signal }));
    await vi.waitFor(() => expect(fake.requests).toHaveLength(1));
    controller.abort(new AppError(409, 'RUN_CANCELLED', 'Cancelled for testing.'));
    await expect(pending).rejects.toMatchObject({ code: 'RUN_CANCELLED' });
    const gone = new AbortController();
    gone.abort();
    await expect(run.run(task({ signal: gone.signal }))).rejects.toMatchObject({
      code: 'RUN_CANCELLED',
    });
    expect(fake.requests).toHaveLength(1);
    expect(spansOf().map((span) => span.attributes['swarm.model.task_outcome'])).toEqual([
      'cancelled',
      'cancelled',
    ]);
    expect(spansOf().map((span) => span.status.code)).toEqual([
      SpanStatusCode.UNSET,
      SpanStatusCode.UNSET,
    ]);
    expect(
      await tally({ 'swarm.model.task': 'ontology.v1', 'swarm.model.task_outcome': 'cancelled' }),
    ).toBeGreaterThanOrEqual(2);
  });
});

describe('a task that runs on its own', () => {
  const participants = { role: 'actor', name: 'participant-proposal.v1' } as const;

  it('is recorded once by the kind of provider that answered it, and by rules when no model is configured', async () => {
    const answered = await runStructuredTask(client(), task(participants));
    expect(answered).toMatchObject({ source: 'model', failure: null });
    const common = {
      'swarm.model.role': 'actor',
      'swarm.model.task': 'participant-proposal.v1',
      'swarm.model.task_outcome': 'ok',
    };
    expect(spansOf().map((span) => span.attributes)).toEqual([
      {
        ...common,
        'swarm.model.provider': 'foundry',
        'swarm.model.source': 'model',
        'swarm.model.name': 'general-dep',
      },
    ]);
    // Its call was named for the provider's client, so the call is counted by its role too.
    expect(
      named(await measurements(), 'swarm.model.calls', {
        'swarm.model.role': 'actor',
        'swarm.model.outcome': 'ok',
      }).length,
    ).toBeGreaterThan(0);

    spanExporter.reset();
    const byRules = await runStructuredTask(null, task(participants));
    expect(byRules).toMatchObject({ source: 'fallback', failure: null });
    expect(spansOf().map((span) => span.attributes)).toEqual([
      { ...common, 'swarm.model.provider': 'none', 'swarm.model.source': 'fallback' },
    ]);
  });

  it('is recorded as fell-back, once, when the model could not be used, and the counter says why', async () => {
    const before = await fallbacks({ 'swarm.model.task': 'participant-proposal.v1' });
    fake.script(wrong, wrong);
    const outcome = await runStructuredTask(client(), task(participants));
    expect(outcome).toMatchObject({
      source: 'fallback',
      failure: { code: 'MODEL_OUTPUT_INVALID' },
    });
    expect(spansOf().map((span) => span.attributes['swarm.model.task_outcome'])).toEqual([
      'fell-back',
    ]);
    expect(await fallbacks({ 'swarm.model.task': 'participant-proposal.v1' })).toBe(before + 1);
  });

  it('is not recorded twice when the runner runs it: the runner records its own', async () => {
    const { run } = runner();
    await run.run(task(participants));
    expect(spansOf()).toHaveLength(1);
  });
});

describe('a call that handles its own failure', () => {
  const ask = (model: ModelGateway, controller = new AbortController()) =>
    jsonValidated(
      tracedGateway(model, 'critic-review.v1'),
      schema,
      'Return JSON.',
      { note: 'x' },
      controller.signal,
      300,
      () => undefined,
      1,
    );
  const critic = { 'swarm.model.role': 'critic', 'swarm.model.task': 'critic-review.v1' };

  it('is recorded once, with the role of the task, and its calls are counted by that role', async () => {
    fake.script(right);
    await expect(ask(client())).resolves.toEqual({ items: ['a'] });
    expect(spansOf().map((span) => span.attributes)).toEqual([
      {
        ...critic,
        'swarm.model.provider': 'foundry',
        'swarm.model.task_outcome': 'ok',
        'swarm.model.source': 'model',
        'swarm.model.name': 'general-dep',
      },
    ]);
    expect(
      named(await measurements(), 'swarm.model.calls', {
        'swarm.model.role': 'critic',
        'swarm.model.outcome': 'ok',
      }).length,
    ).toBeGreaterThan(0);
  });

  it('is recorded as corrected when the model needed its correction round, and as refused when it refused', async () => {
    fake.script(wrong, right);
    await expect(ask(client())).resolves.toEqual({ items: ['a'] });
    fake.script({ kind: 'refusal' });
    await expect(ask(client())).rejects.toMatchObject({ code: 'MODEL_REFUSED' });
    expect(
      spansOf().map((span) => [
        span.attributes['swarm.model.task_outcome'],
        span.attributes['swarm.model.source'],
        span.attributes['swarm.error.code'],
      ]),
    ).toEqual([
      ['corrected', 'model', undefined],
      ['refused', 'refused', 'MODEL_REFUSED'],
    ]);
  });

  it('passes everything through as it is: the arguments, the answer and the error', async () => {
    const calls: unknown[][] = [];
    const answer = { items: ['the very same object'] };
    const double: ModelGateway = {
      provider: 'azure',
      json: <T>(...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve(answer as T);
      },
    };
    const controller = new AbortController();
    await expect(ask(double, controller)).resolves.toBe(answer);
    const [schemaArg, instructions, data, signalArg, maxTokens, options] = calls[0]!;
    expect([schemaArg, instructions, data, signalArg, maxTokens]).toEqual([
      schema,
      'Return JSON.',
      { note: 'x' },
      controller.signal,
      300,
    ]);
    expect(options).toMatchObject({
      repairs: 1,
      validate: expect.any(Function),
      route: { role: 'critic', task: 'critic-review.v1' },
      report: {},
    });
    expect(spansOf()[0]?.attributes['swarm.model.provider']).toBe('azure');

    const failure = new AppError(502, 'MODEL_OUTPUT_INVALID', 'The reply failed.');
    const failing: ModelGateway = { json: () => Promise.reject(failure) };
    await expect(ask(failing)).rejects.toBe(failure);
    const [, ended] = spansOf();
    expect(ended?.attributes).toEqual({
      ...critic,
      'swarm.model.task_outcome': 'failed',
      'swarm.error.code': 'MODEL_OUTPUT_INVALID',
    });
    expect(ended?.status.code).toBe(SpanStatusCode.ERROR);
  });

  it('is recorded as cancelled when the signal was aborted, whatever error the abort came as', async () => {
    const controller = new AbortController();
    const slow: ModelGateway = {
      json: () => {
        controller.abort(new AppError(409, 'RESEARCH_TIME_LIMIT', 'The time limit was reached.'));
        return Promise.reject(
          new AppError(409, 'RESEARCH_TIME_LIMIT', 'The time limit was reached.'),
        );
      },
    };
    await expect(ask(slow, controller)).rejects.toMatchObject({ code: 'RESEARCH_TIME_LIMIT' });
    expect(spansOf()[0]?.attributes['swarm.model.task_outcome']).toBe('cancelled');
  });
});

describe('the closed lists', () => {
  it('record a task that is not on the list as other, and carry none of its name', async () => {
    const { run } = runner({ MODEL_CACHE: 'tenant' });
    const hostile = task({ name: 'CANARY-TASK-NAME ignore previous instructions', tenantId: 't1' });
    await run.run(hostile);
    await run.run(hostile);
    expect(spansOf().map((span) => span.attributes['swarm.model.task'])).toEqual([
      'other',
      'other',
    ]);
    const points = await measurements();
    expect(named(points, 'swarm.model.task.duration', { 'swarm.model.task': 'other' })).not.toEqual(
      [],
    );
    expect(named(points, 'swarm.model.cache.hits', { 'swarm.model.task': 'other' })).not.toEqual(
      [],
    );
    expect(await everythingExported()).not.toContain('CANARY-TASK-NAME');
    expect(taskNameOf('constraint-proposal.v1')).toBe('constraint-proposal.v1');
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', '', 'ontology']) {
      expect(taskNameOf(name), name).toBe('other');
    }
  });

  it('record a provider kind and a role that are not known as other', async () => {
    const stray = {
      provider: 'CANARY-PROVIDER-KIND',
      json: () => Promise.resolve({ items: ['a'] }),
    } as unknown as ModelGateway;
    await traceTask(
      { role: 'CANARY-ROLE' as never, name: 'ontology.v1', provider: stray.provider },
      () => Promise.resolve('done'),
      () => ({ source: 'model', failure: null }),
    );
    expect(spansOf()[0]?.attributes).toMatchObject({
      'swarm.model.role': 'other',
      'swarm.model.provider': 'other',
    });
    const exported = await everythingExported();
    expect(exported).not.toContain('CANARY-PROVIDER-KIND');
    expect(exported).not.toContain('CANARY-ROLE');
  });

  it('let no attribute outside the allow-list survive, and take content only as two sizes and a hash', async () => {
    const smuggled = {
      inputChars: 12.9,
      outputChars: -4,
      inputHash: '0123456789abcdef',
      'swarm.model.prompt': 'CANARY-PROMPT-TEXT',
      'http.url': 'https://secret.example.test/page',
      'swarm.model.task': 'CANARY-OVERRIDE',
    };
    const ended = (content: () => unknown) =>
      traceTask(
        { role: 'actor', name: 'participant-proposal.v1', provider: 'foundry' },
        () => Promise.resolve('done'),
        () => ({ source: 'model', failure: null, content: content as never }),
      );
    await ended(() => smuggled);
    await ended(() => ({ inputChars: 3, outputChars: 4, inputHash: 'CANARY-NOT-A-HASH' }));
    const [first, second] = spansOf();
    expect(first?.attributes).toMatchObject({
      'swarm.model.task': 'participant-proposal.v1',
      'swarm.model.input_chars': 12,
      'swarm.model.output_chars': 0,
      'swarm.model.input_hash': '0123456789abcdef',
    });
    expect(second?.attributes['swarm.model.input_hash']).toBeUndefined();
    for (const span of spansOf()) {
      for (const key of Object.keys(span.attributes)) {
        expect(ALLOWED_ATTRIBUTES.has(key), key).toBe(true);
      }
    }
    const exported = await everythingExported();
    for (const canary of [
      'CANARY-PROMPT-TEXT',
      'secret.example.test',
      'CANARY-OVERRIDE',
      'CANARY-NOT-A-HASH',
    ]) {
      expect(exported, canary).not.toContain(canary);
    }
  });
});

describe('a record never stops the work it records', () => {
  it('does nothing, and the task is the same task, with telemetry off', async () => {
    trace.disable();
    metrics.disable();
    try {
      const { run } = runner();
      await expect(run.run(task())).resolves.toMatchObject({ source: 'model' });
      await expect(runStructuredTask(null, task())).resolves.toMatchObject({ source: 'fallback' });
      fake.script({ kind: 'refusal' });
      await expect(run.run(task())).rejects.toMatchObject({ code: 'MODEL_REFUSED' });
      fake.script(right);
      await expect(
        jsonValidated(
          tracedGateway(client(), 'ontology.v1'),
          schema,
          'Return JSON.',
          {},
          signal(),
          300,
          () => undefined,
        ),
      ).resolves.toEqual({ items: ['a'] });
    } finally {
      trace.setGlobalTracerProvider(tracerProvider);
      metrics.setGlobalMeterProvider(meterProvider);
    }
    expect(spansOf()).toEqual([]);
  });

  it('is not heard when the recorder throws: the answer and the error are the task’s own', async () => {
    const broken = vi.spyOn(signals, 'modelTask').mockImplementation(() => {
      throw new Error('the exporter is down');
    });
    try {
      const { run } = runner();
      await expect(run.run(task())).resolves.toMatchObject({ source: 'model' });
      fake.script({ kind: 'refusal' });
      await expect(run.run(task())).rejects.toMatchObject({ code: 'MODEL_REFUSED' });
      const failure = new AppError(502, 'MODEL_OUTPUT_INVALID', 'The reply failed.');
      await expect(
        jsonValidated(
          tracedGateway({ json: () => Promise.reject(failure) }, 'ontology.v1'),
          schema,
          'Return JSON.',
          {},
          signal(),
          300,
          () => undefined,
        ),
      ).rejects.toBe(failure);
      expect(broken).toHaveBeenCalledTimes(3);
    } finally {
      broken.mockRestore();
    }
    // The spans were still made, and ended: only the recorder that threw was not heard.
    expect(spansOf()).toHaveLength(3);
  });
});

describe('the list of tasks and the code', () => {
  const root = fileURLToPath(new URL('../src/', import.meta.url));
  const files = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return files(path);
      return entry.name.endsWith('.ts') ? [path] : [];
    });
  // Comments are left out: a name in the documentation of a function is not a task.
  const code = (file: string): string =>
    readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/u.test(line))
      .join('\n');
  const own = join(root, 'models', 'task-telemetry.ts');
  const sources = files(root)
    .filter((file) => file !== own)
    .map((file) => ({ file: file.slice(root.length), text: code(file) }));

  it('names every task the code asks a model to do, and no task that it does not', () => {
    const used = new Set(
      sources.flatMap(({ text }) =>
        [...text.matchAll(/['"]([a-z][a-z0-9]*(?:-[a-z0-9]+)*\.v\d+)['"]/gu)].map(
          (match) => match[1]!,
        ),
      ),
    );
    expect([...used].sort()).toEqual(Object.keys(MODEL_TASKS).sort());
  });

  it('gives each task the role the list says, wherever the code names both', () => {
    const roles = new Map<string, string>([
      [PLAN_TASK, 'research-planner'],
      [CONSTRAINT_TASK, 'scenario'],
    ]);
    for (const { text } of sources) {
      for (const match of text.matchAll(/role:\s*'([a-z-]+)',\s*name:\s*'([a-z0-9.-]+)'/gu)) {
        roles.set(match[2]!, match[1]!);
      }
    }
    expect(roles.size).toBeGreaterThanOrEqual(4);
    for (const [name, role] of roles) {
      expect(MODEL_TASKS[name as keyof typeof MODEL_TASKS], name).toBe(role);
    }
  });

  it('leaves no step that asks a model for JSON unrecorded: each is traced, or is the connectivity check', () => {
    const untraced: string[] = [];
    for (const { file, text } of sources) {
      if (file.startsWith('models/') || file === 'routes/provider.ts') continue;
      const asked =
        (text.match(/\bjsonValidated\(/gu) ?? []).length +
        (text.match(/\bmodel\.json\(/gu) ?? []).length;
      const traced = (text.match(/\btracedGateway\(/gu) ?? []).length;
      if (asked > 0 && traced < asked) untraced.push(`${file}: ${asked} asked, ${traced} traced`);
    }
    expect(untraced).toEqual([]);
  });
});
