import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { TokenVerifier } from '../src/auth/tokens.js';
import { Repository } from '../src/storage/repository.js';
import { testConfig } from './fixtures.js';
import { entraEnvironment, idp } from './support/entra-idp.js';

const applications: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

async function start(options: { signedIn?: boolean; repository?: Repository } = {}) {
  const config = testConfig(options.signedIn ? entraEnvironment : {});
  const instance = await buildApp({
    config,
    ...(options.repository ? { repository: options.repository } : {}),
    ...(options.signedIn ? { tokenVerifier: new TokenVerifier(config.auth, idp.keys) } : {}),
  });
  applications.push(instance);
  return instance;
}

describe('the liveness and readiness probes', () => {
  it('say live and ready, and nothing else, with no sign-in even where sign-in is required', async () => {
    for (const signedIn of [false, true]) {
      const { app } = await start({ signedIn });
      const live = await app.inject('/api/health/live');
      expect(live.statusCode).toBe(200);
      expect(live.json()).toEqual({ status: 'live' });
      const ready = await app.inject('/api/health/ready');
      expect(ready.statusCode).toBe(200);
      expect(ready.json()).toEqual({ status: 'ready', checks: { database: 'ok' } });
      // Not a count, an address, a version or a name.
      expect(live.body + ready.body).not.toMatch(/\d|host|path|sqlite|postgres/iu);
    }
  });

  it('report not ready, but still live, when the database does not answer', async () => {
    const instance = await start();
    instance.repository.close();
    const ready = await instance.app.inject('/api/health/ready');
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({ status: 'not-ready', checks: { database: 'failed' } });
    // A database that is merely down is no reason for an orchestrator to restart a healthy process.
    expect((await instance.app.inject('/api/health/live')).statusCode).toBe(200);
  });

  it('report not live once the database connection is lost for good, which only a restart cures', async () => {
    const repository = new Repository(':memory:');
    Object.defineProperty(repository, 'broken', { get: () => true });
    const instance = await start({ repository });
    const live = await instance.app.inject('/api/health/live');
    expect(live.statusCode).toBe(503);
    expect(live.json()).toEqual({ status: 'broken' });
  });

  it('are not audited, counted or limited as if they were people', async () => {
    const instance = await start();
    for (let index = 0; index < 5; index++) await instance.app.inject('/api/health/live');
    expect(
      instance.repository.audit.list().filter((event) => event.action.includes('health')),
    ).toEqual([]);
  });
});
