import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { DeploymentCheck, ProviderStatus } from '../../shared/types.js';
import { buildApp } from '../src/app.js';
import { testConfig } from './fixtures.js';
import { FAKE_FOUNDRY_KEY, startFakeFoundry, type FakeFoundry } from './support/fake-foundry.js';

// The provider routes of a server whose model is a Foundry resource, against the fake of one.

let fake: FakeFoundry;
beforeAll(async () => {
  fake = await startFakeFoundry({
    deployments: {
      'general-dep': {},
      'critic-dep': { temperature: false, reasoningEffort: true },
      'tiny-dep': {},
      // What the live pilot's deployment does: its thinking is counted against the limit of the reply.
      'think-dep': {
        temperature: false,
        thinks: { default: 3_000, medium: 3_000, low: 600, minimal: 80 },
      },
      'plain-dep': { jsonSchema: false },
      'classic-dep': { reasoningEffort: false },
      'o-dep': { temperature: false, minimalEffort: false },
    },
  });
  fake.respond(() => ({ kind: 'reply', value: { status: 'ok' } }));
});
afterEach(() => {
  fake.reset();
  fake.respond(() => ({ kind: 'reply', value: { status: 'ok' } }));
});
afterAll(async () => fake.close());

const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map(({ app }) => app.close()));
});

async function start(extra: Record<string, string> = {}) {
  const config = testConfig(fake.environment({ AI_MODEL: 'general-dep', ...extra }));
  const instance = await buildApp({ config });
  apps.push(instance);
  return { ...instance, config };
}

const check = (app: Awaited<ReturnType<typeof start>>['app']) =>
  app.inject({ method: 'POST', url: '/api/provider/check', headers: { 'x-swarm-csrf': '1' } });

describe('the connectivity check of a Foundry server', () => {
  it('asks each deployment that a task could be sent to, once, the way a task would', async () => {
    const { app } = await start({
      FOUNDRY_DEPLOYMENT_CRITIC: 'critic-dep',
      FOUNDRY_DEPLOYMENT_SCENARIO: 'general-dep',
      FOUNDRY_DEPLOYMENT_PROFILES: JSON.stringify({ 'critic-dep': { reasoning: true } }),
    });
    const response = await check(app);
    expect(response.statusCode, response.body).toBe(200);
    expect(fake.requests.map((request) => request.deployment)).toEqual([
      'general-dep',
      'critic-dep',
    ]);
    // The reasoning deployment is asked with an effort and no temperature, as a task would be.
    expect(fake.requests[0]?.body).toMatchObject({ temperature: expect.any(Number) });
    expect(fake.requests[1]?.body?.reasoning_effort).toBeTypeOf('string');
    expect(fake.requests[1]?.body?.temperature).toBeUndefined();
    expect(fake.requests[1]?.body?.response_format?.type).toBe('json_schema');
    expect(response.json()).toMatchObject({
      provider: 'foundry',
      connectivity: 'ok',
      counters: { calls: 2, failures: 0 },
    });
    expect(fake.problems).toEqual([]);
  });

  it('is one request when one deployment serves every role', async () => {
    const { app } = await start();
    expect((await check(app)).statusCode).toBe(200);
    expect(fake.requests).toHaveLength(1);
  });

  it('names the deployment that is not there, as the one thing that failed, and shows nothing the provider said', async () => {
    const { app } = await start({ FOUNDRY_DEPLOYMENT_ACTOR: 'missing-dep' });
    const response = await check(app);
    // The check ran, so it is an answer; what it found is in it, apart for each thing.
    expect(response.statusCode, response.body).toBe(200);
    const missing = response
      .json()
      .check.deployments.find((one: DeploymentCheck) => one.deployment === 'missing-dep');
    expect(missing).toMatchObject({
      code: 'MODEL_NOT_FOUND',
      reachable: { state: 'ok' },
      deploymentFound: { state: 'failed', detail: expect.stringContaining('"missing-dep"') },
    });
    expect(response.json()).toMatchObject({ connectivity: 'failing' });
    expect(response.body).not.toContain('PROVIDER_FREE_TEXT');
    expect(response.body).not.toContain(FAKE_FOUNDRY_KEY);
  });

  it('does not ask a deployment that no task could be sent to: not in the data zone tasks are held to', async () => {
    const { app } = await start({
      FOUNDRY_DATA_ZONE: 'eu',
      FOUNDRY_DEPLOYMENT_ACTOR: 'tiny-dep',
      FOUNDRY_DEPLOYMENT_PROFILES: JSON.stringify({ 'general-dep': { dataZone: 'eu' } }),
    });
    expect((await check(app)).statusCode).toBe(200);
    expect(fake.requests.map((request) => request.deployment)).toEqual(['general-dep']);
  });

  it('says so when no deployment could be used at all', async () => {
    const { app } = await start({ FOUNDRY_DATA_ZONE: 'eu' });
    const response = await check(app);
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('MODEL_ROUTE_UNAVAILABLE');
    expect(fake.requests).toHaveLength(0);
  });

  it('reports a rejected credential as an authentication failure, and as the only thing that failed', async () => {
    const config = testConfig(fake.environment({ AI_MODEL: 'general-dep' }));
    const wrong = { ...config, provider: { ...config.provider, apiKey: 'not-the-key-canary' } };
    const instance = await buildApp({ config: wrong });
    apps.push(instance);
    const response = await check(instance.app);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().check.deployments[0]).toMatchObject({
      code: 'MODEL_AUTH',
      reachable: { state: 'ok' },
      authenticated: { state: 'failed' },
      deploymentFound: { state: 'unknown' },
      structuredOutput: { state: 'unknown' },
    });
    expect(response.json().check).toMatchObject({ ok: false, connected: false });
    expect(response.json().connectivity).toBe('failing');
    expect(response.body).not.toContain('not-the-key');
  });
});

describe('what the connection check reports, apart for each thing', () => {
  /**
   * Whatever a check found, "connected" and "failed" must not be said of the same thing: the chip is
   * connected exactly when the first three are confirmed, failing when one of them failed, and the check
   * passes only when all four are.
   */
  function consistent(status: ProviderStatus): void {
    const found = status.check;
    expect(found).toBeTruthy();
    const check = found!;
    const connection = (one: DeploymentCheck) => [
      one.reachable,
      one.authenticated,
      one.deploymentFound,
    ];
    // The chip is connected exactly when the first three are confirmed, and failing exactly when they are
    // not: the same result decides both, so they cannot disagree.
    expect(status.connectivity).toBe(check.connected ? 'ok' : 'failing');
    expect(check.connected).toBe(
      check.deployments.every((one) => connection(one).every((stage) => stage.state === 'ok')),
    );
    expect(check.ok).toBe(
      check.connected && check.deployments.every((one) => one.structuredOutput.state === 'ok'),
    );
  }

  async function run(extra: Record<string, string> = {}) {
    const { app } = await start(extra);
    const response = await check(app);
    expect(response.statusCode, response.body).toBe(200);
    const status = response.json() as ProviderStatus;
    consistent(status);
    expect(fake.problems).toEqual([]);
    return status;
  }
  const first = (status: ProviderStatus) => status.check!.deployments[0]!;
  const efforts = () => fake.requests.map((request) => request.body?.reasoning_effort);

  it('is not cut off by a deployment that spends its output limit thinking: one tiny request, at the lowest effort, with room to finish', async () => {
    // The live check asked for 50 tokens at the default effort. A deployment that thinks 3,000 tokens at
    // that effort used all of them, and the retry's 100 as well: "the output was truncated".
    const status = await run({ AI_MODEL: 'think-dep' });
    // The deployment refuses the temperature that a task would be sent, as the live one did; that is found
    // out once, and the request that counts is the second. It is a tiny one, with room to finish.
    expect(fake.requests.map((request) => request.status)).toEqual([400, 200]);
    expect(fake.requests[1]?.body).toMatchObject({
      model: 'think-dep',
      reasoning_effort: 'minimal',
      // What it is allowed to write, and the room that the lowest effort is given to think.
      max_completion_tokens: 1_024 + 500,
      response_format: { type: 'json_schema' },
    });
    expect(fake.requests[1]?.body?.temperature).toBeUndefined();
    expect(status.check).toMatchObject({ ok: true, connected: true });
    expect(first(status)).toMatchObject({
      deployment: 'think-dep',
      reachable: { state: 'ok' },
      authenticated: { state: 'ok' },
      deploymentFound: { state: 'ok' },
      structuredOutput: { state: 'ok', detail: 'strict JSON schema' },
      structuredMode: 'json_schema',
      code: null,
    });
    expect(status).toMatchObject({ connectivity: 'ok', lastError: null });
    // Nothing was cut off; the one failure is the refused temperature.
    expect(status.counters).toMatchObject({
      calls: 1,
      failures: 1,
      truncated: 0,
      schemaInvalid: 0,
    });
  });

  it('says a deployment that cannot finish even so is not giving structured output, and is still connected', async () => {
    fake.respond((request) =>
      request.body?.temperature === undefined
        ? { kind: 'truncated', usage: { prompt: 40, completion: 1_500, reasoning: 1_480 } }
        : undefined,
    );
    const status = await run({ AI_MODEL: 'think-dep' });
    // The refused temperature, then a reply that was cut off, then that asked again once with more room.
    expect(fake.requests.map((request) => request.status)).toEqual([400, 200, 200]);
    expect(status.check).toMatchObject({ ok: false, connected: true });
    expect(first(status)).toMatchObject({
      code: 'MODEL_TRUNCATED',
      reachable: { state: 'ok' },
      authenticated: { state: 'ok' },
      deploymentFound: { state: 'ok' },
      structuredOutput: {
        state: 'failed',
        detail: expect.stringContaining('cut off at its limit, asked again once'),
      },
    });
    // The chip and the check agree: it is connected, and what failed is the structured output.
    expect(status.connectivity).toBe('ok');
    expect(status.lastError?.code).toBe('MODEL_TRUNCATED');
    expect(status.lastError?.message).toContain('Connected, but structured output is not working');
    expect(status.lastError?.message).not.toContain('Connection check failed');
    expect(status.counters).toMatchObject({ calls: 0, truncated: 2, failures: 3 });
  });

  it('says a reply that was whole and was not the JSON asked for is the same finding, and a different one', async () => {
    fake.respond(() => ({ kind: 'text', text: 'REPLY-CANARY this is not JSON' }));
    const status = await run();
    expect(first(status)).toMatchObject({
      code: 'MODEL_OUTPUT_INVALID',
      structuredOutput: {
        state: 'failed',
        detail: 'the reply was complete but it was not one JSON object',
      },
    });
    expect(status.check?.connected).toBe(true);
    expect(JSON.stringify(status)).not.toContain('CANARY');
    expect(status.counters).toMatchObject({ schemaInvalid: 1, truncated: 0 });
  });

  it('says it could not be reached, and nothing after that was checked', async () => {
    const status = await run({ FOUNDRY_ENDPOINT: 'http://127.0.0.1:1' });
    expect(first(status)).toMatchObject({
      code: 'MODEL_UNREACHABLE',
      reachable: { state: 'failed' },
      authenticated: { state: 'unknown' },
      deploymentFound: { state: 'unknown' },
      structuredOutput: { state: 'unknown' },
    });
    expect(status).toMatchObject({
      connectivity: 'failing',
      check: { ok: false, connected: false },
    });
  });

  it('says the provider did not answer in time as a finding, not as a cancellation', async () => {
    fake.respond(() => ({ kind: 'hang' }));
    const status = await run({ AI_TIMEOUT_MS: '300' });
    expect(first(status)).toMatchObject({
      code: 'MODEL_TIMEOUT',
      reachable: { state: 'failed', detail: 'the provider did not answer in time' },
    });
    expect(status.connectivity).toBe('failing');
  });

  it('says a provider that answers with an error status is not reachable as one that can be used', async () => {
    fake.respond(() => ({ kind: 'status', status: 500, code: 'server_error' }));
    const status = await run();
    expect(first(status)).toMatchObject({
      code: 'MODEL_HTTP_ERROR',
      reachable: { state: 'failed', detail: expect.stringContaining('HTTP 500') },
      authenticated: { state: 'unknown' },
    });
    expect(status).toMatchObject({ connectivity: 'failing', check: { connected: false } });
    expect(JSON.stringify(status)).not.toContain('PROVIDER_FREE_TEXT');
  });

  it('says a deployment that is not there is the one thing that is not found, and that sign-in was not confirmed', async () => {
    const status = await run({ AI_MODEL: 'missing-dep' });
    expect(first(status)).toMatchObject({
      code: 'MODEL_NOT_FOUND',
      reachable: { state: 'ok' },
      authenticated: { state: 'unknown' },
      deploymentFound: { state: 'failed' },
      structuredOutput: { state: 'unknown' },
    });
    expect(status.connectivity).toBe('failing');
  });

  it('is not made to look failing by a throttle: it is reached, signed in to and found, and structured output was not tested', async () => {
    fake.respond(() => ({ kind: 'status', status: 429, retryAfterSeconds: 0 }));
    const status = await run();
    expect(first(status)).toMatchObject({
      code: 'MODEL_RATE_LIMIT',
      reachable: { state: 'ok' },
      authenticated: { state: 'ok' },
      deploymentFound: { state: 'ok' },
      structuredOutput: { state: 'unknown', detail: expect.stringContaining('rate limiting') },
    });
    // A call that was throttled marked the chip failing; the check, which asked for each thing, put it right.
    expect(status).toMatchObject({ connectivity: 'ok', check: { ok: false, connected: true } });
  });

  it('says a deployment that rejects a request parameter does not give structured output', async () => {
    fake.respond(() => ({
      kind: 'status',
      status: 400,
      code: 'unsupported_parameter',
      param: 'max_completion_tokens',
    }));
    const status = await run();
    expect(first(status)).toMatchObject({
      code: 'MODEL_PARAMETER_UNSUPPORTED',
      structuredOutput: {
        state: 'failed',
        detail: expect.stringContaining('(max_completion_tokens)'),
      },
    });
    expect(JSON.stringify(status)).not.toContain('PROVIDER_FREE_TEXT');
  });

  it('says a request the provider declined was not tested, and is not a failure of the connection', async () => {
    fake.respond(() => ({ kind: 'refusal' }));
    const status = await run();
    expect(first(status)).toMatchObject({
      code: 'MODEL_REFUSED',
      structuredOutput: { state: 'unknown' },
    });
    expect(status.check?.connected).toBe(true);
  });

  it('says plain JSON was what it got, when the deployment refuses a strict schema', async () => {
    const status = await run({ AI_MODEL: 'plain-dep' });
    expect(status.check?.ok).toBe(true);
    expect(first(status)).toMatchObject({
      structuredMode: 'json_object',
      structuredOutput: { state: 'ok', detail: expect.stringContaining('plain JSON') },
    });
  });

  it('works for a deployment that does not reason, and for one that does not take the lowest effort', async () => {
    expect((await run({ AI_MODEL: 'classic-dep' })).check?.ok).toBe(true);
    expect(efforts()).toEqual(['minimal', undefined]);
    fake.reset();
    fake.respond(() => ({ kind: 'reply', value: { status: 'ok' } }));
    expect((await run({ AI_MODEL: 'o-dep' })).check?.ok).toBe(true);
    // The temperature a task would be sent is refused first, then the lowest effort, and the next one up is taken.
    expect(efforts()).toEqual(['minimal', 'minimal', 'low']);
  });

  it('keeps one answer for each deployment, and passes only when every one does', async () => {
    fake.scriptFor('critic-dep', { kind: 'text', text: 'nope' });
    const status = await run({
      FOUNDRY_DEPLOYMENT_CRITIC: 'critic-dep',
      FOUNDRY_DEPLOYMENT_PROFILES: JSON.stringify({ 'critic-dep': { reasoning: true } }),
    });
    expect(status.check?.deployments.map((one) => one.deployment)).toEqual([
      'general-dep',
      'critic-dep',
    ]);
    expect(status.check).toMatchObject({ ok: false, connected: true });
    expect(status.check?.deployments[0]?.structuredOutput.state).toBe('ok');
    expect(status.check?.deployments[1]?.structuredOutput.state).toBe('failed');
    // Even the reasoning deployment is checked at the lowest effort, with room for it, and not as a critic would be.
    expect(fake.requests[1]?.body).toMatchObject({
      reasoning_effort: 'minimal',
      max_completion_tokens: 1_024 + 500,
    });
  });

  it('changes what the chip says with the next check, and the status keeps the last one', async () => {
    const { app } = await start();
    fake.respond(() => ({ kind: 'status', status: 401, code: '401' }));
    const failed = (await check(app)).json() as ProviderStatus;
    consistent(failed);
    expect(failed).toMatchObject({ connectivity: 'failing', check: { connected: false } });
    fake.respond(() => ({ kind: 'reply', value: { status: 'ok' } }));
    const passed = (await check(app)).json() as ProviderStatus;
    consistent(passed);
    expect(passed).toMatchObject({ connectivity: 'ok', lastError: null, check: { ok: true } });
    const status = (await app.inject({ method: 'GET', url: '/api/provider/status' })).json();
    expect(status.check).toMatchObject({ ok: true, checkedAt: passed.check?.checkedAt });
  });
});

describe('the status of a Foundry server', () => {
  it('says which provider, deployment and sign-in it uses, and nothing that could reach the resource', async () => {
    const { app } = await start();
    const status = await app.inject({ method: 'GET', url: '/api/provider/status' });
    expect(status.json()).toMatchObject({
      mode: 'real-model',
      provider: 'foundry',
      model: 'general-dep',
      auth: 'api-key',
      configured: true,
    });
    const config = await app.inject({ method: 'GET', url: '/api/config' });
    expect(config.json().provider).toMatchObject({ name: 'foundry', model: 'general-dep' });
    for (const body of [status.body, config.body]) {
      expect(body).not.toContain(FAKE_FOUNDRY_KEY);
      expect(body).not.toContain('127.0.0.1');
    }
  });
});
