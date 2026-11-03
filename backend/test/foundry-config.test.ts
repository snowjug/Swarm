import { describe, expect, it } from 'vitest';
import { loadConfig, publicConfig } from '../src/config.js';
import { foundryEndpoint } from '../src/models/foundry.js';

// AI_PROVIDER=foundry: what configures it, what refuses, and what never leaves the server.

const base = {
  AI_PROVIDER: 'foundry',
  AI_MODEL: 'general-deployment',
  FOUNDRY_ENDPOINT: 'https://swarm-test.openai.azure.com',
};
const KEY = 'fake-foundry-key-canary-9d41';
const identity = '3f2b8c1e-5d4a-4e6f-9a7b-0c1d2e3f4a5b';

describe('selecting the Foundry provider', () => {
  it('is Microsoft Entra ID by default, with no key and the v1 endpoint', () => {
    const { provider } = loadConfig(base);
    expect(provider).toMatchObject({
      name: 'foundry',
      model: 'general-deployment',
      configured: true,
      auth: 'entra',
      apiKey: null,
      baseUrl: 'https://swarm-test.openai.azure.com/openai/v1/',
      managedIdentityClientId: null,
    });
    expect(provider.reason).toContain('Entra');
    expect(provider.reason).toContain('Cognitive Services OpenAI User');
  });

  it('takes the client id of a user-assigned managed identity, and refuses one that is not an id', () => {
    expect(
      loadConfig({ ...base, AZURE_CLIENT_ID: identity }).provider.managedIdentityClientId,
    ).toBe(identity);
    expect(() => loadConfig({ ...base, AZURE_CLIENT_ID: 'not-an-id' })).toThrow('AZURE_CLIENT_ID');
  });

  it.each([
    'https://swarm-test.openai.azure.com',
    'https://swarm-test.openai.azure.com/',
    'https://swarm-test.openai.azure.com/openai/v1',
    'https://swarm-test.openai.azure.com/openai/v1/',
    'https://swarm-test.services.ai.azure.com/',
    'https://swarm-test.cognitiveservices.azure.com',
    'https://SWARM-TEST.OpenAI.Azure.com',
    'https://swarm-test.privatelink.openai.azure.com',
  ])('accepts the endpoint %s', (endpoint) => {
    const { provider } = loadConfig({ ...base, FOUNDRY_ENDPOINT: endpoint });
    expect(provider.configured, provider.reason).toBe(true);
    expect(provider.baseUrl).toMatch(/^https:\/\/[a-z.-]+\/openai\/v1\/$/u);
  });

  it.each([
    ['http://swarm-test.openai.azure.com', 'https'],
    ['https://example.com', 'must end in'],
    ['https://openai.azure.com.evil.example', 'must end in'],
    ['https://evilopenai.azure.com', 'must end in'],
    ['https://swarm-test.openai.azure.com.', 'must end in'],
    ['https://swarm-test.openai.azure.com@evil.example', 'credentials'],
    ['https://user:pass@swarm-test.openai.azure.com', 'credentials'],
    ['https://swarm-test.openai.azure.com/?api-version=1', 'query'],
    ['https://swarm-test.openai.azure.com/#frag', 'fragments'],
    ['https://swarm-test.openai.azure.com:8443', 'default https port'],
    ['https://swarm-test.openai.azure.com/openai/deployments/x', 'resource root'],
    ['https://swarm-test.openai.azure.com/anything', 'resource root'],
    ['https://swarm-test.openai.azure.com\\.evil.example', 'resource root'],
    ['not a url', 'valid absolute'],
    ['https://127.0.0.1', 'must end in'],
    ['https://localhost', 'must end in'],
    ['https://[::1]', 'must end in'],
  ])('refuses the endpoint %s, and the reason does not repeat it', (endpoint, reason) => {
    const { provider } = loadConfig({ ...base, FOUNDRY_ENDPOINT: endpoint });
    expect(provider.configured).toBe(false);
    expect(provider.baseUrl).toBeNull();
    expect(provider.reason).toContain('Invalid provider endpoint');
    expect(provider.reason).toContain(reason);
    expect(provider.reason).not.toContain('evil.example');
    expect(provider.reason).not.toContain('pass');
  });

  it('says what is missing, without a value', () => {
    expect(loadConfig({ ...base, FOUNDRY_ENDPOINT: undefined }).provider).toMatchObject({
      configured: false,
      reason: expect.stringContaining('FOUNDRY_ENDPOINT'),
    });
    expect(loadConfig({ ...base, AI_MODEL: '' }).provider).toMatchObject({
      configured: false,
      reason: expect.stringContaining('AI_MODEL'),
    });
    expect(loadConfig({ ...base, AI_MODEL: 'has space; and "quotes"' }).provider.configured).toBe(
      false,
    );
  });

  it('leaves the azure provider as it was: no role deployments, no foundry variables', () => {
    const config = loadConfig({
      AI_PROVIDER: 'azure',
      AI_MODEL: 'my-deployment',
      AZURE_OPENAI_ENDPOINT: 'https://swarm-test.openai.azure.com',
      FOUNDRY_ENDPOINT: 'https://ignored.openai.azure.com',
      FOUNDRY_DEPLOYMENT_ACTOR: 'ignored',
    });
    expect(config.provider).toMatchObject({ name: 'azure', configured: true, auth: 'entra' });
    expect(config.provider.baseUrl).toBe('https://swarm-test.openai.azure.com/openai/v1/');
    expect(config.routing.roles).toEqual({});
  });
});

describe('the loopback seam of the tests', () => {
  const loopback = { ...base, FOUNDRY_ENDPOINT: 'http://127.0.0.1:4010' };

  it('is refused unless the seam is switched on', () => {
    expect(loadConfig(loopback).provider.configured).toBe(false);
  });

  it('lets a test point the provider at a server on this machine, and nowhere else', () => {
    const on = { ...loopback, FOUNDRY_TEST_ALLOW_LOOPBACK: '1' };
    expect(loadConfig(on).provider).toMatchObject({
      configured: true,
      baseUrl: 'http://127.0.0.1:4010/openai/v1/',
    });
    for (const endpoint of ['http://example.com', 'http://10.0.0.5', 'ftp://127.0.0.1']) {
      expect(loadConfig({ ...on, FOUNDRY_ENDPOINT: endpoint }).provider.configured).toBe(false);
    }
    expect(foundryEndpoint('http://127.0.0.1', { allowLoopback: false }).valid).toBe(false);
  });

  it('is not allowed for a production deployment, which then does not start', () => {
    expect(() =>
      loadConfig({ ...loopback, FOUNDRY_TEST_ALLOW_LOOPBACK: '1', DEPLOYMENT_MODE: 'production' }),
    ).toThrow('test seam');
  });
});

describe('API-key authentication for Foundry', () => {
  const withKey = { ...base, FOUNDRY_AUTH: 'key', FOUNDRY_API_KEY: KEY };

  it('is only used when it is chosen, and the key stays on the server', () => {
    const config = loadConfig(withKey);
    expect(config.provider).toMatchObject({ auth: 'api-key', apiKey: KEY, configured: true });
    const shown = JSON.stringify(publicConfig(config));
    expect(shown).not.toContain(KEY);
    expect(shown).not.toContain('swarm-test.openai.azure.com');
    expect(publicConfig(config).provider).toMatchObject({ name: 'foundry', auth: 'api-key' });
    expect(config.provider.reason).not.toContain(KEY);
  });

  it('is not read when Microsoft Entra ID is in use', () => {
    const config = loadConfig({ ...base, FOUNDRY_API_KEY: KEY });
    expect(config.provider).toMatchObject({ auth: 'entra', apiKey: null });
  });

  it('asks for the key when it was chosen and is not there', () => {
    expect(loadConfig({ ...base, FOUNDRY_AUTH: 'key' }).provider).toMatchObject({
      configured: false,
      reason: expect.stringContaining('FOUNDRY_API_KEY'),
    });
  });

  it('is refused for a production deployment: it does not start, and the refusal does not repeat the key', () => {
    for (const mode of ['production', 'Production', ' PRODUCTION ']) {
      let message = '';
      try {
        loadConfig({ ...withKey, DEPLOYMENT_MODE: mode });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message, mode).toContain('not allowed');
      expect(message).toContain('DEPLOYMENT_MODE=production');
      expect(message).not.toContain(KEY);
    }
    expect(loadConfig({ ...withKey, DEPLOYMENT_MODE: 'development' }).provider.auth).toBe(
      'api-key',
    );
    expect(loadConfig({ ...base, DEPLOYMENT_MODE: 'production' }).provider.auth).toBe('entra');
  });

  it('refuses an authentication mode it does not know, by name and without its value', () => {
    expect(() => loadConfig({ ...withKey, FOUNDRY_AUTH: 'secret-canary' })).toThrow(
      'Invalid server configuration: FOUNDRY_AUTH.',
    );
  });
});

describe('the deployments of the roles', () => {
  it('is one deployment for every role when nothing else is set', () => {
    const { routing } = loadConfig(base);
    expect(routing).toMatchObject({
      defaultDeployment: 'general-deployment',
      roles: {},
      reasoningDeployment: null,
      fallbackDeployment: null,
      dataZone: null,
      production: false,
    });
  });

  it('reads one deployment per role, each falling back to the default, and no model name is built in', () => {
    const { routing } = loadConfig({
      ...base,
      FOUNDRY_DEPLOYMENT_RESEARCH_PLANNER: 'planner-dep',
      FOUNDRY_DEPLOYMENT_EXTRACTION: 'extract-dep',
      FOUNDRY_DEPLOYMENT_ACTOR: 'actor-dep',
      FOUNDRY_DEPLOYMENT_SCENARIO: 'scenario-dep',
      FOUNDRY_DEPLOYMENT_CRITIC: 'critic-dep',
      FOUNDRY_DEPLOYMENT_SYNTHESIS: 'synthesis-dep',
      FOUNDRY_DEPLOYMENT_REASONING: 'reasoning-dep',
      FOUNDRY_DEPLOYMENT_FALLBACK: 'spare-dep',
    });
    expect(routing.roles).toEqual({
      'research-planner': 'planner-dep',
      extraction: 'extract-dep',
      actor: 'actor-dep',
      scenario: 'scenario-dep',
      critic: 'critic-dep',
      synthesis: 'synthesis-dep',
    });
    expect(routing).toMatchObject({
      reasoningDeployment: 'reasoning-dep',
      fallbackDeployment: 'spare-dep',
    });
    expect(loadConfig({ ...base, FOUNDRY_DEPLOYMENT_CRITIC: 'critic-dep' }).routing.roles).toEqual({
      critic: 'critic-dep',
    });
  });

  it('refuses a name that is not a deployment name, by variable and without the value', () => {
    expect(() => loadConfig({ ...base, FOUNDRY_DEPLOYMENT_ACTOR: 'bad name; DROP TABLE' })).toThrow(
      'Invalid server configuration: FOUNDRY_DEPLOYMENT_ACTOR.',
    );
  });

  it('describes each deployment from the operator’s own words, and refuses what it does not know', () => {
    const profiles = {
      'fast-dep': { latency: 'fast', dataZone: 'eu', maxContextChars: 40_000 },
      'deep-dep': { reasoning: true, structuredOutputs: false },
    };
    const { routing } = loadConfig({
      ...base,
      FOUNDRY_DEPLOYMENT_REASONING: 'other-dep',
      FOUNDRY_DEPLOYMENT_PROFILES: JSON.stringify(profiles),
    });
    expect(routing.profiles['fast-dep']).toEqual({
      reasoning: false,
      dataZone: 'eu',
      maxContextChars: 40_000,
      latency: 'fast',
      structuredOutputs: true,
    });
    expect(routing.profiles['deep-dep']).toMatchObject({
      reasoning: true,
      structuredOutputs: false,
    });
    for (const bad of [
      'not json CANARY',
      JSON.stringify({ x: { modelName: 'gpt' } }),
      JSON.stringify({ x: { dataZone: 'EU West!' } }),
      JSON.stringify([]),
    ]) {
      let message = '';
      try {
        loadConfig({ ...base, FOUNDRY_DEPLOYMENT_PROFILES: bad });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toBe('Invalid server configuration: FOUNDRY_DEPLOYMENT_PROFILES.');
    }
  });

  it('holds every task to a data zone when one is configured', () => {
    expect(loadConfig({ ...base, FOUNDRY_DATA_ZONE: 'EU' }).routing.dataZone).toBe('eu');
    expect(() => loadConfig({ ...base, FOUNDRY_DATA_ZONE: 'not a zone' })).toThrow(
      'FOUNDRY_DATA_ZONE',
    );
  });
});

describe('prices, allowances, cache and tracing', () => {
  const prices = [{ deployment: 'general-*', inputPerMillionUsd: 0.5, outputPerMillionUsd: 2 }];

  it('ships no price: cost is unknown until the operator says what a deployment costs', () => {
    expect(loadConfig(base).routing.prices).toEqual([]);
    expect(loadConfig({ ...base, MODEL_PRICES: JSON.stringify(prices) }).routing.prices).toEqual(
      prices,
    );
    for (const bad of ['nope', JSON.stringify([{ deployment: 'x', inputPerMillionUsd: -1 }])]) {
      expect(() => loadConfig({ ...base, MODEL_PRICES: bad })).toThrow('MODEL_PRICES');
    }
  });

  it('never enforces a dollar limit from a price that is not there', () => {
    expect(() => loadConfig({ ...base, MODEL_OPERATION_COST_LIMIT_USD: '0.5' })).toThrow(
      'MODEL_PRICES',
    );
    const config = loadConfig({
      ...base,
      MODEL_PRICES: JSON.stringify(prices),
      MODEL_OPERATION_COST_LIMIT_USD: '0.5',
      MODEL_OPERATION_TOKEN_LIMIT: '50000',
    });
    expect(config.routing.operationBudget).toEqual({ tokens: 50_000, usd: 0.5 });
    expect(() => loadConfig({ ...base, MODEL_OPERATION_TOKEN_LIMIT: '-1' })).toThrow(
      'MODEL_OPERATION_TOKEN_LIMIT',
    );
    for (const bad of ['0x10', '1e3', '-1', 'free', '5,5', '99999999']) {
      expect(
        () =>
          loadConfig({
            ...base,
            MODEL_PRICES: JSON.stringify(prices),
            MODEL_OPERATION_COST_LIMIT_USD: bad,
          }),
        bad,
      ).toThrow('MODEL_OPERATION_COST_LIMIT_USD');
    }
  });

  it('is off for the cache and for content in traces unless chosen', () => {
    expect(loadConfig(base).routing).toMatchObject({
      cache: { mode: 'off', maxEntries: 256, ttlMs: 900_000 },
      traceContent: 'off',
    });
    expect(
      loadConfig({
        ...base,
        MODEL_CACHE: 'tenant',
        MODEL_CACHE_MAX_ENTRIES: '10',
        MODEL_CACHE_TTL_SECONDS: '60',
        TELEMETRY_TRACE_CONTENT: 'redacted',
      }).routing,
    ).toMatchObject({
      cache: { mode: 'tenant', maxEntries: 10, ttlMs: 60_000 },
      traceContent: 'redacted',
    });
    expect(() => loadConfig({ ...base, MODEL_CACHE: 'global' })).toThrow('MODEL_CACHE');
    expect(() => loadConfig({ ...base, TELEMETRY_TRACE_CONTENT: 'full' })).toThrow(
      'TELEMETRY_TRACE_CONTENT',
    );
    expect(() => loadConfig({ ...base, MODEL_CACHE_MAX_ENTRIES: '0' })).toThrow(
      'MODEL_CACHE_MAX_ENTRIES',
    );
  });

  it('applies to any provider: a price table and a cache are not about Foundry', () => {
    const config = loadConfig({
      AI_PROVIDER: 'openai',
      AI_MODEL: 'm',
      OPENAI_API_KEY: 'fake-key-canary',
      MODEL_CACHE: 'tenant',
    });
    expect(config.routing.cache.mode).toBe('tenant');
    expect(config.routing.defaultDeployment).toBe('m');
  });
});
