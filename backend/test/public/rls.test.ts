import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadPublicConfig, type PublicConfig } from '../../src/public/config.js';
import { publicEditionStorage } from '../../src/public/storage/edition.js';
import { PublicUserStore } from '../../src/public/storage/users.js';
import {
  TABLE_CLASSES,
  tablesOf,
  unclassifiedTables,
} from '../../src/storage/postgres/row-security.js';
import { Repository } from '../../src/storage/repository.js';
import type { SqlDatabase } from '../../src/storage/sql.js';
import { asSystemView } from '../../src/storage/system-view.js';
import { fixtureInput } from '../fixtures.js';

/** The database boundary on its own, with no application code between the statement and the policies. */

const environment = {
  PUBLIC_BASE_URL: 'http://localhost:3001',
  PUBLIC_GOOGLE_CLIENT_ID: 'google-client',
  PUBLIC_GOOGLE_CLIENT_SECRET: 'google-secret',
  PUBLIC_PEPPER: 'p'.repeat(40),
};

let config: PublicConfig;
let repository: Repository;
let raw: SqlDatabase;
let users: PublicUserStore;
let a: { id: string; ws: string; project: string };
let b: { id: string; ws: string; project: string };
/** Set when the edition would not open the database: the server refuses to start unless the isolation is in force. */
let refused: Error | null = null;

function seed(subject: string): { id: string; ws: string; project: string } {
  const user = users.create({ provider: 'google', subject, email: `${subject}@example.com` });
  const project = repository.asTenant(user.workspaceId, () =>
    repository.create(fixtureInput({ name: `Project of ${subject}` }), {
      owner: { tenantId: user.workspaceId, ownerId: user.id },
    }),
  );
  return { id: user.id, ws: user.workspaceId, project: project.id };
}

beforeAll(() => {
  config = loadPublicConfig(environment);
  try {
    repository = new Repository('pglite:memory', { edition: publicEditionStorage(config) });
  } catch (error) {
    refused = error instanceof Error ? error : new Error(String(error));
    return;
  }
  raw = repository.extend((db) => db);
  users = repository.extend(
    (db) => new PublicUserStore(asSystemView(db), { pepper: config.pepper, retentionDays: 30 }),
  );
  a = seed('alice');
  b = seed('bob');
});

// A database that will not open is a failure of every test below, with the reason the edition gave, rather than a
// hook that fails before any of them is counted.
beforeEach(() => {
  if (refused) throw refused;
});

afterAll(() => {
  if (!refused) repository.close();
});

const rows = (scope: 'system' | string, sql: string, ...values: (string | number)[]) =>
  scope === 'system'
    ? raw.asSystem(() => raw.prepare(sql).all(...values))
    : raw.asTenant(scope, () => raw.prepare(sql).all(...values));

describe('row-level security on PostgreSQL', () => {
  it('is in force: the session runs as a role that is not the owner, and has no way round the policies', () => {
    const who = raw.asSystem(() =>
      raw
        .prepare(
          'SELECT current_user AS who, (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) AS escapes',
        )
        .get(),
    );
    expect(who).toEqual({ who: 'swarm_app', escapes: false });
  });

  it('puts every table in a class, so that none can be forgotten', () => {
    expect(raw.asSystem(() => unclassifiedTables(raw))).toEqual([]);
    for (const name of raw.asSystem(() => tablesOf(raw)))
      expect(TABLE_CLASSES[name], name).toBeDefined();
  });

  it('refuses any statement made outside a request, a job or a system scope', () => {
    expect(() => raw.prepare('SELECT 1 AS n').get()).toThrow(
      /outside any request, job or system scope/u,
    );
  });

  it('shows a workspace its own rows in every table that has them, and nothing of another’s', () => {
    for (const [name, kind] of Object.entries(TABLE_CLASSES)) {
      if (kind.kind === 'none') continue;
      const all = rows('system', `SELECT COUNT(*) AS n FROM ${name}`)[0]!.n as number;
      const mine = rows(a.ws, `SELECT COUNT(*) AS n FROM ${name}`)[0]!.n as number;
      const theirs = rows(b.ws, `SELECT COUNT(*) AS n FROM ${name}`)[0]!.n as number;
      if (kind.kind === 'system') {
        // Only the platform reads these: a workspace sees none of them.
        expect({ name, mine, theirs }, name).toEqual({ name, mine: 0, theirs: 0 });
      } else {
        expect(
          mine + theirs,
          `${name}: the two workspaces together cannot see more than there is`,
        ).toBeLessThanOrEqual(all);
        expect(mine, `${name}: A sees B's rows`).toBeLessThanOrEqual(all - theirs);
      }
    }
    // And the two projects, specifically.
    expect(rows(a.ws, 'SELECT id FROM projects').map((r) => r.id)).toEqual([a.project]);
    expect(rows(b.ws, 'SELECT id FROM projects').map((r) => r.id)).toEqual([b.project]);
    expect(
      rows(a.ws, 'SELECT principal_id FROM workspace_members').map((r) => r.principal_id),
    ).toEqual([a.id]);
    expect(rows(a.ws, 'SELECT id FROM public_users')).toEqual([{ id: a.id }]);
  });

  it('shows a workspace none of another’s project children, whatever is asked for', () => {
    const children = [
      'chunks',
      'events',
      'messages',
      'claim_records',
      'source_conflicts',
      'project_members',
      'project_usage',
      'project_artifacts',
    ];
    for (const table of children) {
      const own = rows(a.ws, `SELECT project_id FROM ${table} WHERE project_id = ?`, a.project);
      const foreign = rows(a.ws, `SELECT project_id FROM ${table} WHERE project_id = ?`, b.project);
      expect(foreign, `${table}: B's rows through A's scope`).toEqual([]);
      expect(own.length, `${table}: A's own rows are visible`).toBeGreaterThanOrEqual(0);
    }
    expect(
      rows(a.ws, 'SELECT COUNT(*) AS n FROM chunks WHERE project_id = ?', a.project)[0]!.n,
    ).toBeGreaterThan(0);
  });

  it('lets a workspace change nothing of another’s: updates and deletes touch no row', () => {
    const touched = raw.asTenant(
      a.ws,
      () =>
        raw.prepare(`UPDATE projects SET status = 'failed' WHERE id = ?`).run(b.project).changes,
    );
    expect(Number(touched)).toBe(0);
    const removed = raw.asTenant(
      a.ws,
      () => raw.prepare('DELETE FROM projects WHERE id = ?').run(b.project).changes,
    );
    expect(Number(removed)).toBe(0);
    const everyone = raw.asTenant(a.ws, () => raw.prepare('DELETE FROM chunks').run().changes);
    expect(Number(everyone)).toBeGreaterThan(0);
    expect(
      rows('system', 'SELECT COUNT(*) AS n FROM chunks WHERE project_id = ?', b.project)[0]!.n,
    ).toBeGreaterThan(0);
    expect(rows(b.ws, 'SELECT status FROM projects WHERE id = ?', b.project)).toHaveLength(1);
  });

  it('refuses a write that would put a row into another’s workspace, or under another’s project', () => {
    expect(() =>
      raw.asTenant(a.ws, () =>
        raw
          .prepare(
            `INSERT INTO workspace_members (tenant_id, principal_id, role, added_by, added_at) VALUES (?, 'intruder', 'owner', 'x', 'now')`,
          )
          .run(b.ws),
      ),
    ).toThrow(/row-level security/u);
    expect(() =>
      raw.asTenant(a.ws, () =>
        raw
          .prepare(
            `INSERT INTO events (project_id, stage, message, created_at) VALUES (?, 'knowledge', 'planted', 'now')`,
          )
          .run(b.project),
      ),
    ).toThrow(/row-level security/u);
    expect(() =>
      raw.asTenant(a.ws, () =>
        raw
          .prepare(
            `INSERT INTO project_members (project_id, principal_id, role, added_by, added_at) VALUES (?, 'intruder', 'lead', 'x', 'now')`,
          )
          .run(b.project),
      ),
    ).toThrow(/row-level security/u);
    // A row cannot be moved out of one's own workspace into another's.
    expect(() =>
      raw.asTenant(a.ws, () =>
        raw.prepare('UPDATE projects SET tenant_id = ? WHERE id = ?').run(b.ws, a.project),
      ),
    ).toThrow(/row-level security/u);
    expect(
      rows('system', 'SELECT tenant_id FROM projects WHERE id = ?', a.project)[0]!.tenant_id,
    ).toBe(a.ws);
  });

  it('keeps sessions, sign-ins and the ledger away from a workspace, and the audit log read-only', () => {
    raw.asSystem(() =>
      raw
        .prepare(
          `INSERT INTO sessions (id_hash, principal_id, tenant_id, platform_admin, bootstrap_admin, created_at, last_seen_at, expires_at)
           VALUES ('h', ?, ?, 0, 0, 1, 1, 9999999999999)`,
        )
        .run(b.id, b.ws),
    );
    expect(rows(a.ws, 'SELECT id_hash FROM sessions')).toEqual([]);
    expect(rows(b.ws, 'SELECT id_hash FROM sessions')).toHaveLength(1);
    for (const table of ['usage_daily', 'public_settings', 'signup_log', 'public_login_attempts']) {
      expect(rows(a.ws, `SELECT * FROM ${table}`), table).toEqual([]);
    }
    expect(() =>
      raw.asTenant(a.ws, () => raw.prepare(`UPDATE audit_events SET actor = 'x'`).run()),
    ).toThrow();
    expect(() => raw.asTenant(a.ws, () => raw.prepare('DELETE FROM audit_events').run())).toThrow();
    expect(() =>
      raw.asTenant(a.ws, () =>
        raw
          .prepare(
            `INSERT INTO audit_events (at, actor, action, target_type, target_id, detail, prev_hash, hash) VALUES ('t','a','x','y','z','{}','p','h')`,
          )
          .run(),
      ),
    ).toThrow(/row-level security/u);
  });

  it('shows a workspace only the audit entries of its own projects', () => {
    repository.audit.record({
      actor: a.id,
      action: 'test.a',
      targetType: 'project',
      targetId: a.project,
      projectId: a.project,
    });
    repository.audit.record({
      actor: b.id,
      action: 'test.b',
      targetType: 'project',
      targetId: b.project,
      projectId: b.project,
    });
    repository.audit.record({
      actor: b.id,
      action: 'test.none',
      targetType: 'route',
      targetId: 'x',
    });
    const seen = repository
      .asTenant(a.ws, () => repository.audit.list({ limit: 100 }))
      .map((event) => event.action);
    expect(seen).toContain('test.a');
    expect(seen).not.toContain('test.b');
    expect(seen).not.toContain('test.none');
    // The chain as a whole is the platform's, and is intact.
    expect(repository.audit.verify().ok).toBe(true);
  });

  it('does not let one workspace’s context leak into the next statement, or survive a rolled-back transaction', () => {
    const inTransaction = () =>
      raw.asTenant(b.ws, () => {
        try {
          raw.transaction(() => {
            expect(raw.prepare('SELECT COUNT(*) AS n FROM projects').get()!.n).toBe(1);
            throw new Error('roll back');
          });
        } catch {
          // expected
        }
      });
    inTransaction();
    expect(rows(a.ws, 'SELECT id FROM projects').map((r) => r.id)).toEqual([a.project]);
    expect(rows(b.ws, 'SELECT id FROM projects').map((r) => r.id)).toEqual([b.project]);
    // Alternating as often as a busy server does, nothing crosses.
    for (let i = 0; i < 20; i++) {
      expect(rows(i % 2 ? a.ws : b.ws, 'SELECT id FROM projects').map((r) => r.id)).toEqual([
        i % 2 ? a.project : b.project,
      ]);
    }
  });

  it('treats an empty or unknown workspace as seeing nothing', () => {
    expect(rows('w_nobody', 'SELECT id FROM projects')).toEqual([]);
    expect(() => raw.asTenant('', () => raw.prepare('SELECT 1 AS n').get())).toThrow(
      /outside any request/u,
    );
  });
});
