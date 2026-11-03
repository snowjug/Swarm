import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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

  it('names the deployment that is not there, and shows nothing the provider said', async () => {
    const { app } = await start({ FOUNDRY_DEPLOYMENT_ACTOR: 'missing-dep' });
    const response = await check(app);
    expect(response.statusCode).toBe(502);
    expect(response.json().error).toMatchObject({ code: 'MODEL_NOT_FOUND' });
    expect(response.json().error.message).toContain('"missing-dep"');
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

  it('reports a rejected credential as an authentication failure', async () => {
    const config = testConfig(fake.environment({ AI_MODEL: 'general-dep' }));
    const wrong = { ...config, provider: { ...config.provider, apiKey: 'not-the-key-canary' } };
    const instance = await buildApp({ config: wrong });
    apps.push(instance);
    const response = await check(instance.app);
    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe('MODEL_AUTH');
    expect(response.body).not.toContain('not-the-key');
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
