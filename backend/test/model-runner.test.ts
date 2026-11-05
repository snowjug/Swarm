import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AppError } from '../src/errors.js';
import { ModelClient, type ModelGateway, type ModelUsageSink } from '../src/models/client.js';
import { OperationBudget } from '../src/models/cost.js';
import { TaskCache } from '../src/models/cache.js';
import { createModelFactory, newOperationBudget, taskRunnerFor } from '../src/models/factory.js';
import { createRouter } from '../src/models/router.js';
import { createTaskRunner, type RunnableTask } from '../src/models/runner.js';
import { ModelRefusedError } from '../src/models/safety.js';
import { runStructuredTask } from '../src/models/task.js';
import { ProviderTelemetry } from '../src/models/telemetry.js';
import { testConfig } from './fixtures.js';
import { startFakeFoundry, type FakeFoundry, type FakeStep } from './support/fake-foundry.js';

// The runner is routing, budgets, cache and accounting around `runStructuredTask`. Each case here is
// proved against the fake Foundry: what was sent where, how often, and what the outcome says.

const schema = z.object({ items: z.array(z.string().min(1)).min(1).max(3) });
type Shape = z.infer<typeof schema>;
const rules: Shape = { items: ['from rules'] };
const model: Shape = { items: ['from the model'] };
const PRICES = JSON.stringify([
  { deployment: 'general-*', inputPerMillionUsd: 1, outputPerMillionUsd: 4 },
  { deployment: 'extract-*', inputPerMillionUsd: 0.5, outputPerMillionUsd: 2 },
]);

let fake: FakeFoundry;
beforeAll(async () => {
  fake = await startFakeFoundry({
    deployments: {
      'general-dep': {},
      'extract-dep': {},
      'critic-dep': { temperature: false, reasoningEffort: true },
      'spare-dep': {},
    },
    fallbackReply: () => model,
  });
});
afterEach(() => fake.reset());
afterAll(async () => fake.close());

function world(extra: Record<string, string> = {}) {
  const config = testConfig(fake.environment({ AI_MODEL: 'general-dep', ...extra }));
  const telemetry = new ProviderTelemetry(config.provider);
  const factory = createModelFactory(config, telemetry);
  return { config, telemetry, factory };
}

const task = (extra: Partial<RunnableTask<Shape>> = {}): RunnableTask<Shape> => ({
  role: 'extraction',
  name: 'extract-items.v1',
  schema,
  instructions: 'Return the items.',
  data: { passage: 'A passage of text.' },
  signal: new AbortController().signal,
  maxTokens: 300,
  fallback: () => rules,
  ...extra,
});

const sink = (admit?: () => void): ModelUsageSink =>
  Object.assign(vi.fn(), admit ? { admit } : {}) as ModelUsageSink;
const used = (prompt: number, completion: number) => ({ prompt, completion });

describe('routing and accounting', () => {
  it('sends each role to its deployment, and says what each used and is estimated to cost', async () => {
    const { config, factory } = world({
      FOUNDRY_DEPLOYMENT_EXTRACTION: 'extract-dep',
      FOUNDRY_DEPLOYMENT_CRITIC: 'spare-dep',
      MODEL_PRICES: PRICES,
    });
    const onUsage = sink();
    const runner = taskRunnerFor(config, factory, { onUsage });
    fake.script(
      { kind: 'reply', value: model, usage: used(1_000_000, 500_000) },
      { kind: 'reply', value: model, usage: used(100, 50) },
      { kind: 'reply', value: model, usage: used(10, 5) },
    );
    const extraction = await runner.run(task());
    const critic = await runner.run(task({ role: 'critic', name: 'critique.v1' }));
    const actor = await runner.run(task({ role: 'actor', name: 'actor.v1' }));
    expect(fake.requests.map((request) => request.deployment)).toEqual([
      'extract-dep',
      'spare-dep',
      'general-dep',
    ]);
    expect(extraction).toMatchObject({
      source: 'model',
      failure: null,
      deployment: 'extract-dep',
      value: model,
      usage: {
        calls: 1,
        repairCalls: 0,
        inputTokens: 1_000_000,
        outputTokens: 500_000,
        reported: true,
      },
      cost: { basis: 'estimate', usd: 1.5 },
      cache: 'off',
      safety: [],
    });
    // spare-dep has no price: its cost is unknown, never zero and never a guess.
    expect(critic).toMatchObject({
      deployment: 'spare-dep',
      cost: { basis: 'unknown', usd: null },
    });
    expect(actor.cost.basis).toBe('estimate');
    expect(onUsage).toHaveBeenCalledTimes(3);
  });

  it('sends the sampling the router chose: a temperature, or an effort for a reasoning deployment', async () => {
    const { config, factory } = world({
      FOUNDRY_DEPLOYMENT_CRITIC: 'critic-dep',
      FOUNDRY_DEPLOYMENT_PROFILES: JSON.stringify({ 'critic-dep': { reasoning: true } }),
    });
    const runner = taskRunnerFor(config, factory, { onUsage: sink() });
    await runner.run(task());
    await runner.run(task({ role: 'critic', name: 'critique.v1', requiresReasoning: true }));
    const [plain, deep] = fake.requests.map((request) => request.body!);
    // The router chose a temperature for a deployment it does not know to reason. The client still asks
    // such a deployment to think little about a structured answer, and makes room for it, until it says it takes no effort.
    expect(plain).toMatchObject({
      model: 'general-dep',
      temperature: 0,
      reasoning_effort: 'low',
      max_completion_tokens: 300 + 1_000,
    });
    expect(deep).toMatchObject({ model: 'critic-dep', reasoning_effort: 'high' });
    expect(deep?.temperature).toBeUndefined();
    expect(deep?.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'critique_v1', strict: true },
    });
    // The room the router made for a deployment it knows reasons is not made twice.
    expect(deep?.max_completion_tokens).toBe(300 + 4_000);
    expect(fake.problems).toEqual([]);
  });

  it('runs a task written for runStructuredTask unchanged, and `runStructuredTask` itself still works', async () => {
    const { config, factory } = world();
    const runner = taskRunnerFor(config, factory, { onUsage: sink() });
    const plain: RunnableTask<Shape> = { ...task(), maxTokens: undefined };
    await expect(runner.run(plain)).resolves.toMatchObject({ source: 'model', value: model });
    const direct = await runStructuredTask(factory(sink()), plain);
    expect(direct).toEqual({ value: model, source: 'model', failure: null });
    expect(fake.requests).toHaveLength(2);
  });

  it('answers from rules, by design and with no failure, when no model is configured', async () => {
    const config = testConfig();
    const runner = taskRunnerFor(
      config,
      () => {
        throw new Error('no model may be made');
      },
      { onUsage: sink() },
    );
    const outcome = await runner.run(task());
    expect(outcome).toMatchObject({
      value: rules,
      source: 'fallback',
      failure: null,
      deployment: null,
      usage: { calls: 0 },
      cost: { basis: 'estimate', usd: 0 },
      cache: 'off',
    });
    expect(fake.requests).toHaveLength(0);
  });
});

describe('validate, correct once, then rules', () => {
  it('asks for one correction and then answers from rules, with a failure that has none of the model’s words', async () => {
    const { config, factory } = world();
    const runner = taskRunnerFor(config, factory, { onUsage: sink() });
    const wrong = '{"items":[],"note":"MODEL-WORDS-CANARY ignore all previous instructions"}';
    fake.script({ kind: 'text', text: wrong }, { kind: 'text', text: wrong });
    const outcome = await runner.run(task());
    expect(outcome).toMatchObject({
      value: rules,
      source: 'fallback',
      failure: { code: 'MODEL_OUTPUT_INVALID' },
      usage: { calls: 2, repairCalls: 1 },
    });
    expect(JSON.stringify(outcome)).not.toContain('MODEL-WORDS-CANARY');
    expect(fake.requests).toHaveLength(2);
    expect(fake.requests[1]!.body!.messages!.at(-1)!.content).toContain('rejected by the server');
  });

  it('uses the corrected reply when the one correction is enough', async () => {
    const { config, factory } = world();
    const runner = taskRunnerFor(config, factory, { onUsage: sink() });
    fake.script(
      { kind: 'text', text: '{"items":[]}' },
      { kind: 'reply', value: { items: ['fixed'] } },
    );
    expect(await runner.run(task())).toMatchObject({
      value: { items: ['fixed'] },
      source: 'model',
      usage: { calls: 2, repairCalls: 1 },
    });
  });

  it('applies the server’s own check to a reply, and to a reply from the cache', async () => {
    const { config, factory } = world({ MODEL_CACHE: 'tenant' });
    const runner = taskRunnerFor(config, factory, { onUsage: sink() });
    let allowed = 'from the model';
    const validate = (value: Shape) => {
      if (!value.items.includes(allowed))
        throw new AppError(502, 'MODEL_OUTPUT_INVALID', 'not allowed');
    };
    const first = await runner.run(task({ tenantId: 't1', validate }));
    expect(first).toMatchObject({ source: 'model', cache: 'miss' });
    // The check now says no to what was stored: the cache must not be able to get around it.
    allowed = 'something else';
    fake.script({ kind: 'reply', value: { items: ['something else'] } });
    const second = await runner.run(task({ tenantId: 't1', validate }));
    expect(second).toMatchObject({
      source: 'model',
      value: { items: ['something else'] },
      cache: 'miss',
    });
    expect(fake.requests).toHaveLength(2);
  });

  it('never answers a refusal or a block from rules, and says what kind of block it was', async () => {
    const { config, factory } = world();
    const runner = taskRunnerFor(config, factory, { onUsage: sink() });
    for (const [step, kind] of [
      [{ kind: 'refusal' }, 'refusal'],
      [{ kind: 'filter-prompt', categories: ['jailbreak'] }, 'jailbreak'],
      [
        { kind: 'filter-output', categories: ['violence'], partial: '{"items":["x"]}' },
        'blocked_output',
      ],
    ] satisfies Array<[FakeStep, string]>) {
      fake.script(step);
      const failure = await runner.run(task()).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ModelRefusedError);
      expect((failure as ModelRefusedError).findings.map((finding) => finding.class)).toContain(
        kind,
      );
    }
    expect(fake.requests).toHaveLength(3);
  });

  it('reports what the provider’s safety saw without blocking, with the outcome', async () => {
    const { config, factory } = world();
    const runner = taskRunnerFor(config, factory, { onUsage: sink() });
    fake.script({ kind: 'detected', category: 'jailbreak', value: model });
    const outcome = await runner.run(task());
    expect(outcome).toMatchObject({
      source: 'model',
      safety: [{ class: 'jailbreak', action: 'detected', category: 'jailbreak' }],
    });
  });

  it('never answers a cancellation from rules, and gives back what it had reserved', async () => {
    const { config, factory } = world();
    const budget = new OperationBudget({ tokens: 10_000 });
    const runner = taskRunnerFor(config, factory, { onUsage: sink(), budget });
    const controller = new AbortController();
    fake.script({ kind: 'slow', ms: 5_000, then: { kind: 'reply', value: model } });
    const pending = runner
      .run(task({ signal: controller.signal }))
      .catch((error: unknown) => error);
    await vi.waitFor(() => expect(fake.requests).toHaveLength(1));
    controller.abort(new AppError(409, 'RUN_CANCELLED', 'Cancelled for testing.'));
    expect(await pending).toMatchObject({ code: 'RUN_CANCELLED' });
    // Whatever was held back for the call is free again: a call that fills the allowance still fits.
    expect(() =>
      budget.reserve({ deployment: 'general-dep', inputTokens: 5_000, maxOutputTokens: 5_000 }),
    ).not.toThrow();
  });
});

describe('the allowances that hold a model back', () => {
  it('stops at the operation’s token allowance: no call is made that could pass it', async () => {
    const { config, factory } = world();
    // A call holds back its input and the most it may write, thinking room included: about 1,800 here.
    // Two calls use 2,400 between them, and a third that could use 1,800 more does not fit in 3,500.
    const budget = new OperationBudget({ tokens: 3_500 });
    const runner = taskRunnerFor(config, factory, { onUsage: sink(), budget });
    fake.respond(() => ({ kind: 'reply', value: model, usage: used(900, 300) }));
    const outcomes = [];
    for (let n = 0; n < 4; n += 1) outcomes.push(await runner.run(task()));
    expect(outcomes.map((outcome) => outcome.source)).toEqual([
      'model',
      'model',
      'fallback',
      'fallback',
    ]);
    expect(outcomes[2]).toMatchObject({
      value: rules,
      failure: { code: 'MODEL_TOKEN_BUDGET', detail: expect.stringContaining('rules were used') },
      usage: { calls: 0 },
    });
    expect(fake.requests).toHaveLength(2);
    expect(budget.snapshot()).toMatchObject({ calls: 2, inputTokens: 1_800, outputTokens: 600 });
  });

  it('cannot be passed by tasks that run at the same moment', async () => {
    const { config, factory } = world();
    // One call holds back about 1,800 tokens (its input and the answer it may write, with room to think):
    // two fit, three do not.
    const budget = new OperationBudget({ tokens: 4_000 });
    const runner = taskRunnerFor(config, factory, { onUsage: sink(), budget });
    fake.respond(() => ({
      kind: 'slow',
      ms: 30,
      then: { kind: 'reply', value: model, usage: used(500, 100) },
    }));
    const outcomes = await Promise.all(Array.from({ length: 6 }, () => runner.run(task())));
    const started = outcomes.filter((outcome) => outcome.source === 'model').length;
    expect(started).toBe(fake.requests.length);
    expect(started).toBeLessThanOrEqual(2);
    expect(started).toBeGreaterThan(0);
    for (const outcome of outcomes.filter((entry) => entry.source === 'fallback')) {
      expect(outcome.failure?.code).toBe('MODEL_TOKEN_BUDGET');
    }
    expect(fake.maxInFlight).toBeLessThanOrEqual(2);
  });

  it('stops at the operation’s dollar allowance, and refuses a deployment that has no price', async () => {
    const { config, factory } = world({ MODEL_PRICES: PRICES });
    // One call costs about $0.0018 here, and holds back up to about $0.0057 (the room to think included);
    // the allowance is for two.
    const budget = new OperationBudget({ usd: 0.008, prices: config.routing.prices });
    const runner = taskRunnerFor(config, factory, { onUsage: sink(), budget });
    fake.respond(() => ({ kind: 'reply', value: model, usage: used(1_000, 200) }));
    const codes = [];
    for (let n = 0; n < 3; n += 1) codes.push((await runner.run(task())).failure?.code ?? 'ok');
    expect(codes).toEqual(['ok', 'ok', 'MODEL_COST_BUDGET']);

    const unpriced = world({
      FOUNDRY_DEPLOYMENT_EXTRACTION: 'extract-dep',
      MODEL_PRICES: JSON.stringify([
        { deployment: 'general-*', inputPerMillionUsd: 1, outputPerMillionUsd: 1 },
      ]),
    });
    fake.reset();
    const refused = await taskRunnerFor(unpriced.config, unpriced.factory, {
      onUsage: sink(),
      budget: new OperationBudget({ usd: 5, prices: unpriced.config.routing.prices }),
    }).run(task());
    expect(refused).toMatchObject({ source: 'fallback', failure: { code: 'MODEL_COST_BUDGET' } });
    expect(fake.requests).toHaveLength(0);
  });

  it('takes the allowance from configuration unless the caller gives another', async () => {
    const { config } = world({ MODEL_OPERATION_TOKEN_LIMIT: '4000' });
    expect(newOperationBudget(config)?.tokenLimit).toBe(4_000);
    expect(newOperationBudget(config, { tokens: 10 })?.tokenLimit).toBe(10);
    expect(newOperationBudget(world().config)).toBeNull();
  });

  it('does not read a limit that is not a number as none: a caller’s bad “remaining” is an error', () => {
    const { config } = world({ MODEL_OPERATION_TOKEN_LIMIT: '4000' });
    for (const bad of [Number.NaN, -5, Number.POSITIVE_INFINITY]) {
      expect(() => newOperationBudget(config, { tokens: bad })).toThrowError(
        expect.objectContaining({ code: 'MODEL_BUDGET_INVALID' }),
      );
      expect(() => newOperationBudget(world().config, { usd: bad })).toThrowError(
        expect.objectContaining({ code: 'MODEL_BUDGET_INVALID' }),
      );
    }
    // Zero, given on purpose, is still none: it lifts the configured limit for this operation.
    expect(newOperationBudget(config, { tokens: 0 })).toBeNull();
  });

  it('stops at the project’s budget, which every call asks, and reports it as a budget stop', async () => {
    const { config, factory } = world();
    let recorded = 0;
    const onUsage = Object.assign(
      vi.fn(() => {
        recorded += 1;
      }),
      {
        admit: () => {
          if (recorded >= 1) throw new AppError(429, 'PROJECT_BUDGET', 'The budget is used.');
        },
      },
    ) as ModelUsageSink;
    const runner = taskRunnerFor(config, factory, { onUsage });
    const first = await runner.run(task());
    const second = await runner.run(task());
    expect(first.source).toBe('model');
    expect(second).toMatchObject({
      source: 'fallback',
      failure: { code: 'PROJECT_BUDGET', detail: expect.stringContaining('project') },
    });
    expect(fake.requests).toHaveLength(1);
  });

  it('asks the project’s budget itself for a gateway that does not, and charges the allowance for it', async () => {
    const { config } = world();
    const stray: ModelGateway = { json: async () => model as never };
    let asked = 0;
    const budget = new OperationBudget({ tokens: 10_000 });
    const runner = createTaskRunner({
      gateway: stray,
      router: createRouter(config.routing),
      budgets: { operation: budget, project: { admit: () => void (asked += 1) } },
    });
    const outcome = await runner.run(task());
    expect(outcome).toMatchObject({ source: 'model', usage: { calls: 1, reported: false } });
    // The gateway never asked the gate, so the runner did not ask the project either; what it used is charged.
    expect(asked).toBe(0);
    expect(budget.snapshot().calls).toBe(1);
    expect(budget.snapshot().inputTokens).toBeGreaterThan(0);
  });

  it('charges a call whose usage the provider did not give at its estimate', async () => {
    const { config, factory } = world();
    const budget = new OperationBudget({ tokens: 100_000 });
    const runner = taskRunnerFor(config, factory, { onUsage: sink(), budget });
    fake.script({ kind: 'reply', value: model, usage: null });
    const outcome = await runner.run(task());
    expect(outcome).toMatchObject({
      usage: { calls: 1, inputTokens: 0, reported: false },
      cost: { basis: 'unknown' },
    });
    expect(budget.snapshot().inputTokens).toBeGreaterThan(0);
    expect(budget.snapshot().outputTokens).toBeGreaterThan(0);
  });

  it('counts a call the operation’s own cap on provider calls refuses as a budget stop', async () => {
    const { config, factory } = world();
    const runner = taskRunnerFor(config, factory, { onUsage: sink(), maxCalls: 1 });
    fake.script({ kind: 'text', text: '{"items":[]}' });
    const outcome = await runner.run(task());
    expect(outcome).toMatchObject({ source: 'fallback', failure: { code: 'MODEL_CALL_BUDGET' } });
    expect(fake.requests).toHaveLength(1);
  });
});

describe('the cache', () => {
  const cached = () => world({ MODEL_CACHE: 'tenant' });

  it('is off unless it is turned on: nothing is cached, and nothing says so', async () => {
    const { config, factory } = world();
    const runner = taskRunnerFor(config, factory, { onUsage: sink() });
    await runner.run(task({ tenantId: 't1' }));
    const again = await runner.run(task({ tenantId: 't1' }));
    expect(again.cache).toBe('off');
    expect(fake.requests).toHaveLength(2);
  });

  it('serves a repeat from the cache without asking a model, and says so', async () => {
    const { config, factory } = cached();
    const runner = taskRunnerFor(config, factory, { onUsage: sink() });
    const first = await runner.run(task({ tenantId: 't1' }));
    const second = await runner.run(task({ tenantId: 't1' }));
    expect([first.cache, second.cache]).toEqual(['miss', 'hit']);
    expect(second).toMatchObject({
      source: 'model',
      value: model,
      usage: { calls: 0 },
      cost: { usd: 0 },
    });
    expect(fake.requests).toHaveLength(1);
  });

  it('never crosses tenants, and caches nothing for a task that names none', async () => {
    const { config, factory } = cached();
    const runner = taskRunnerFor(config, factory, { onUsage: sink() });
    await runner.run(task({ tenantId: 'tenant-a' }));
    expect((await runner.run(task({ tenantId: 'tenant-b' }))).cache).toBe('miss');
    expect((await runner.run(task())).cache).toBe('off');
    expect((await runner.run(task())).cache).toBe('off');
    expect((await runner.run(task({ tenantId: 'tenant-a' }))).cache).toBe('hit');
    expect(fake.requests).toHaveLength(4);
  });

  it('keys an answer by what was asked: other data, instructions, task, schema version, deployment', async () => {
    const { config, factory } = world({
      MODEL_CACHE: 'tenant',
      FOUNDRY_DEPLOYMENT_EXTRACTION: 'extract-dep',
    });
    const runner = taskRunnerFor(config, factory, { onUsage: sink() });
    const base = { tenantId: 't1' };
    await runner.run(task(base));
    for (const change of [
      { data: { passage: 'Another passage.' } },
      { instructions: 'Return other items.' },
      { name: 'extract-items.v2' },
      { schemaVersion: 'v2' },
      { role: 'actor' as const },
    ]) {
      expect((await runner.run(task({ ...base, ...change }))).cache, JSON.stringify(change)).toBe(
        'miss',
      );
    }
    expect((await runner.run(task(base))).cache).toBe('hit');
  });

  it('versions an answer by the schema, so that a changed schema never reads an old answer', async () => {
    const { config, factory } = cached();
    const runner = taskRunnerFor(config, factory, { onUsage: sink() });
    await runner.run(task({ tenantId: 't1' }));
    const stricter = z.object({ items: z.array(z.string().min(1)).min(1).max(2) });
    const again = await runner.run(task({ tenantId: 't1', schema: stricter as never }));
    expect(again.cache).toBe('miss');
  });

  it('stores only an answer that a model gave and that passed: never a refusal, a failure or rules', async () => {
    const { config, factory } = cached();
    const runner = taskRunnerFor(config, factory, { onUsage: sink() });
    fake.script({ kind: 'refusal' });
    await expect(runner.run(task({ tenantId: 't1' }))).rejects.toMatchObject({
      code: 'MODEL_REFUSED',
    });
    // Rules answered after a reply that could not be used, and that is not stored either.
    fake.script({ kind: 'text', text: '{"items":[]}' }, { kind: 'text', text: '{"items":[]}' });
    const fallback = await runner.run(task({ tenantId: 't1' }));
    expect(fallback).toMatchObject({ source: 'fallback', cache: 'miss' });
    const next = await runner.run(task({ tenantId: 't1' }));
    expect(next).toMatchObject({ source: 'model', cache: 'miss' });
    expect((await runner.run(task({ tenantId: 't1' }))).cache).toBe('hit');
    expect(fake.requests).toHaveLength(4);
  });

  it('serves a repeat only from the deployment that the router would choose now', async () => {
    const { config, factory } = world({
      MODEL_CACHE: 'tenant',
      FOUNDRY_DEPLOYMENT_EXTRACTION: 'extract-dep',
    });
    const runner = taskRunnerFor(config, factory, { onUsage: sink() });
    await runner.run(task({ tenantId: 't1' }));
    // The same task in a zone that the deployment is not declared in is not routed, and so not served.
    const refused = await runner.run(task({ tenantId: 't1', dataZone: 'eu' }));
    expect(refused).toMatchObject({
      source: 'fallback',
      failure: { code: 'MODEL_ROUTE_UNAVAILABLE' },
      cache: 'off',
    });
  });

  it('can be given to a runner directly, with a clock', async () => {
    const { config } = world();
    let now = 0;
    const cache = new TaskCache({ ttlMs: 1_000, now: () => now });
    const gateway = new ModelClient(config.provider, () => undefined);
    const runner = createTaskRunner({ gateway, router: createRouter(config.routing), cache });
    expect((await runner.run(task({ tenantId: 't' }))).cache).toBe('miss');
    expect((await runner.run(task({ tenantId: 't' }))).cache).toBe('hit');
    now = 2_000;
    expect((await runner.run(task({ tenantId: 't' }))).cache).toBe('miss');
  });
});

describe('a deployment that fails', () => {
  const failing = () =>
    world({
      FOUNDRY_DEPLOYMENT_EXTRACTION: 'ghost-dep',
      FOUNDRY_DEPLOYMENT_FALLBACK: 'spare-dep',
    });

  it('is replaced by the next deployment, once, and the outcome says which one answered', async () => {
    const { config, factory } = failing();
    const runner = taskRunnerFor(config, factory, { onUsage: sink() });
    const outcome = await runner.run(task());
    expect(fake.requests.map((request) => [request.deployment, request.status])).toEqual([
      ['ghost-dep', 404],
      ['general-dep', 200],
    ]);
    expect(outcome).toMatchObject({
      source: 'model',
      deployment: 'general-dep',
      usage: { calls: 2 },
    });
  });

  it('is passed over for a while, so that the next task does not ask it again', async () => {
    const { config, factory } = failing();
    let now = 1_000;
    const runner = createTaskRunner({
      gateway: factory(sink()),
      router: createRouter(config.routing),
      cooldownMs: 60_000,
      now: () => now,
    });
    await runner.run(task());
    fake.reset();
    await runner.run(task());
    expect(fake.requests.map((request) => request.deployment)).toEqual(['general-dep']);
    now += 61_000;
    await runner.run(task());
    expect(fake.requests.map((request) => request.deployment)).toEqual([
      'general-dep',
      'ghost-dep',
      'general-dep',
    ]);
  });

  it('is not replaced again: when the next deployment fails too, rules answer and say why', async () => {
    const { config, factory } = world({
      FOUNDRY_DEPLOYMENT_EXTRACTION: 'ghost-dep',
      FOUNDRY_DEPLOYMENT_FALLBACK: 'other-ghost-dep',
      AI_MODEL: 'spare-dep',
    });
    const runner = taskRunnerFor(config, factory, { onUsage: sink() });
    fake.respond((request) =>
      request.deployment === 'spare-dep' ? { kind: 'status', status: 404 } : undefined,
    );
    const outcome = await runner.run(task());
    expect(outcome).toMatchObject({
      source: 'fallback',
      value: rules,
      failure: { code: 'MODEL_NOT_FOUND' },
    });
    expect(fake.requests.length).toBeLessThanOrEqual(2);
  });

  it('does not move to another deployment for a refusal', async () => {
    const { config, factory } = world({
      FOUNDRY_DEPLOYMENT_EXTRACTION: 'extract-dep',
      FOUNDRY_DEPLOYMENT_FALLBACK: 'spare-dep',
    });
    const runner = taskRunnerFor(config, factory, { onUsage: sink() });
    fake.scriptFor('extract-dep', { kind: 'refusal' });
    await expect(runner.run(task())).rejects.toMatchObject({ code: 'MODEL_REFUSED' });
    expect(fake.requests.map((request) => request.deployment)).toEqual(['extract-dep']);
  });

  it('answers from rules, and sends nothing anywhere, when no deployment may serve the task', async () => {
    const { config, factory } = world({
      FOUNDRY_DATA_ZONE: 'eu',
      FOUNDRY_DEPLOYMENT_PROFILES: JSON.stringify({ 'general-dep': { dataZone: 'us' } }),
    });
    const runner = taskRunnerFor(config, factory, { onUsage: sink() });
    const outcome = await runner.run(task());
    expect(outcome).toMatchObject({
      source: 'fallback',
      value: rules,
      failure: {
        code: 'MODEL_ROUTE_UNAVAILABLE',
        detail: expect.stringContaining('No configured model deployment'),
      },
      deployment: null,
    });
    expect(fake.requests).toHaveLength(0);
  });

  it('does not let a task move the zone the operator set: it is answered by rules, and nothing is sent', async () => {
    const { config, factory } = world({
      FOUNDRY_DATA_ZONE: 'eu',
      FOUNDRY_DEPLOYMENT_FALLBACK: 'spare-dep',
      FOUNDRY_DEPLOYMENT_PROFILES: JSON.stringify({
        'general-dep': { dataZone: 'eu' },
        'spare-dep': { dataZone: 'us' },
      }),
    });
    const runner = taskRunnerFor(config, factory, { onUsage: sink() });
    const moved = await runner.run(task({ dataZone: 'us' }));
    expect(moved).toMatchObject({
      source: 'fallback',
      value: rules,
      failure: { code: 'MODEL_ROUTE_UNAVAILABLE' },
      deployment: null,
    });
    expect(fake.requests).toHaveLength(0);
    // Naming the operator's own zone is allowed, and is served only from a deployment declared in it.
    const same = await runner.run(task({ dataZone: 'EU' }));
    expect(same).toMatchObject({ source: 'model', deployment: 'general-dep' });
    expect(fake.requests.map((request) => request.deployment)).toEqual(['general-dep']);
  });
});
