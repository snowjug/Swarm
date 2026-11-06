import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { ROUTE_POLICY } from '../../src/auth/policy.js';
import { loadConfig } from '../../src/config.js';
import { LATEST_SCHEMA_VERSION } from '../../src/storage/migrations.js';
import { Repository } from '../../src/storage/repository.js';
import { testConfig } from '../fixtures.js';

/**
 * The pilot is what it was. Each test here says one thing that must be true of a deployment that never asked for the
 * public edition: it has no part of it, and nothing of it has touched its database or its routes.
 */

const publicTables = [
  'public_users',
  'public_login_attempts',
  'public_settings',
  'public_schema',
  'usage_daily',
  'usage_lifetime',
  'usage_reservations',
  'usage_blocked',
  'signup_log',
  'deleted_accounts',
  'project_funding',
];

describe('a deployment that does not ask for the public edition', () => {
  it('is the pilot by default, with the sign-in modes it has always had', () => {
    expect(loadConfig({}).edition).toBe('pilot');
    expect(loadConfig({}).public).toBeNull();
    expect(loadConfig({}).auth.mode).toBe('none');
    expect(loadConfig({ SWARM_EDITION: 'pilot' }).edition).toBe('pilot');
    expect(() => loadConfig({ SWARM_EDITION: 'enterprise' })).toThrow(/SWARM_EDITION/u);
  });

  it('keeps the schema version, and so the release and roll-back story, where it was', () => {
    expect(LATEST_SCHEMA_VERSION).toBe(9);
  });

  for (const target of [':memory:', 'pglite:memory']) {
    it(`gets none of the public tables, and no role or policy, on ${target}`, () => {
      const repository = new Repository(target);
      try {
        const tables = repository
          .extend((db) =>
            db.dialect === 'postgres'
              ? db
                  .prepare(
                    `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema()`,
                  )
                  .all()
              : db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all(),
          )
          .map((row) => String(row.name));
        for (const name of publicTables) expect(tables, name).not.toContain(name);
        expect(repository.rowSecurity).toBe(false);
        if (target.startsWith('pglite')) {
          const state = repository.extend((db) => ({
            role: db.prepare('SELECT current_user AS who').get()?.who,
            policies: Number(db.prepare('SELECT COUNT(*) AS n FROM pg_policy').get()?.n),
            swarmApp: Number(
              db.prepare(`SELECT COUNT(*) AS n FROM pg_roles WHERE rolname = 'swarm_app'`).get()?.n,
            ),
            secured: Number(
              db.prepare(`SELECT COUNT(*) AS n FROM pg_class WHERE relrowsecurity`).get()?.n,
            ),
          }));
          expect(state).toEqual({ role: 'postgres', policies: 0, swarmApp: 0, secured: 0 });
        }
      } finally {
        repository.close();
      }
    });
  }

  it('registers none of the public routes, and refuses them as unknown', async () => {
    const built = await buildApp({ config: testConfig(), frontendRoot: null });
    try {
      const registered = built.routes.map(({ method, url }) => `${method} ${url}`);
      const stray = registered.filter(
        (route) =>
          /\/auth\/(?:start|callback)/u.test(route) ||
          /\/api\/(?:public|account|usage|byok|admin|ops)\b/u.test(route),
      );
      expect(stray).toEqual([]);
      for (const [method, url] of [
        ['POST', '/auth/start/google'],
        ['GET', '/auth/callback/google'],
        ['GET', '/api/public/session'],
        ['GET', '/api/account'],
        ['GET', '/api/usage'],
        ['POST', '/api/byok/connect'],
        ['GET', '/api/admin/usage'],
        ['POST', '/api/ops/free-tier/off'],
      ] as const) {
        const response = await built.app.inject({
          method,
          url,
          headers: { 'x-swarm-csrf': '1' },
          payload: method === 'POST' ? {} : undefined,
        });
        expect(response.statusCode, `${method} ${url}`).toBe(404);
      }
      expect(built.publicEdition).toBeNull();
    } finally {
      await built.app.close();
    }
  });

  it('has exactly the authorization table it had', () => {
    const digest = createHash('sha256')
      .update(
        Object.entries(ROUTE_POLICY)
          .map(([route, access]) => `${route} ${JSON.stringify(access)}`)
          .sort()
          .join('\n'),
      )
      .digest('hex');
    // Computed from `backend/src/auth/policy.ts`, which the public edition does not change (3926bd9).
    expect(Object.keys(ROUTE_POLICY)).toHaveLength(102);
    expect(digest).toBe('cc4a21d69005ffd9cd183d72f7216d031fde531c5a29deaddd60ec2615af8b28');
  });

  it('serves the page exactly as it was, with no edition tag', async () => {
    const built = await buildApp({ config: testConfig(), frontendRoot: null });
    try {
      expect((await built.app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    } finally {
      await built.app.close();
    }
  });
});
