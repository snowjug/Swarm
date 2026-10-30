import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { testConfig } from './fixtures.js';

const applications: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

async function start(environment: Record<string, string> = {}) {
  const instance = await buildApp({ config: testConfig(environment) });
  applications.push(instance);
  return instance;
}

/** Sends this many requests, each claiming the address `claim(index)`, and returns how many were limited. */
async function limited(
  app: Awaited<ReturnType<typeof start>>['app'],
  claim: (index: number) => string,
) {
  let refused = 0;
  for (let index = 0; index < 130; index++) {
    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { 'x-forwarded-for': claim(index) },
    });
    if (response.statusCode === 429) refused++;
  }
  return refused;
}

describe('trusting a reverse proxy to say who the caller is', () => {
  it('trusts none by default, and bounds what can be set', () => {
    expect(loadConfig({}).trustedProxies).toBe(0);
    expect(loadConfig({ TRUST_PROXY: '1' }).trustedProxies).toBe(1);
    expect(() => loadConfig({ TRUST_PROXY: '-1' })).toThrow();
    expect(() => loadConfig({ TRUST_PROXY: '9' })).toThrow();
  });

  it('ignores X-Forwarded-For when no proxy is trusted: a caller cannot choose its own address', async () => {
    const { app } = await start();
    expect(await limited(app, (index) => `203.0.113.${index % 250}`)).toBeGreaterThan(0);
  });

  it('behind one trusted proxy, each address it reports has its own limit', async () => {
    const { app } = await start({ TRUST_PROXY: '1' });
    expect(await limited(app, (index) => `203.0.113.${index % 250}`)).toBe(0);
  });

  it('believes only the hop the proxy added, not an address the caller put earlier in the list', async () => {
    const { app } = await start({ TRUST_PROXY: '1' });
    // The proxy appends the real peer last; everything before it is the caller's claim.
    expect(await limited(app, (index) => `198.51.100.${index % 250}, 203.0.113.9`)).toBeGreaterThan(
      0,
    );
  });
});
