import { afterEach, describe, expect, it } from 'vitest';
import type { BridgeReply, BridgeRequest, Transport } from '../src/storage/postgres/bridge.js';
import { DatabaseError, PostgresDatabase } from '../src/storage/postgres/database.js';
import { toPostgres } from '../src/storage/postgres/translate.js';
import { Repository } from '../src/storage/repository.js';
import type { SqlDatabase } from '../src/storage/sql.js';
import { fixtureInput } from './fixtures.js';

describe('translating the stores’ SQL to PostgreSQL', () => {
  it('numbers the placeholders, and leaves a question mark inside a string alone', () => {
    expect(toPostgres("SELECT a FROM t WHERE b = ? AND c = '?' AND d = ?")).toBe(
      "SELECT a FROM t WHERE b = $1 AND c = '?' AND d = $2",
    );
    expect(toPostgres(`SELECT 'it''s ? fine', ? -- is it? \n, ?`)).toBe(
      `SELECT 'it''s ? fine', $1 -- is it? \n, $2`,
    );
    expect(toPostgres('SELECT "odd?name" FROM t WHERE x = ? /* why? */')).toBe(
      'SELECT "odd?name" FROM t WHERE x = $1 /* why? */',
    );
  });

  it('turns INSERT OR IGNORE into ON CONFLICT DO NOTHING, ahead of any RETURNING', () => {
    expect(toPostgres('INSERT OR IGNORE INTO t (a, b) VALUES (?, ?)')).toBe(
      'INSERT INTO t (a, b) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    );
    expect(toPostgres('insert or ignore into t (a) values (?) returning a;')).toBe(
      'insert into t (a) values ($1) ON CONFLICT DO NOTHING returning a',
    );
  });

  it('refuses INSERT OR REPLACE rather than guess what it should mean', () => {
    expect(() => toPostgres('INSERT OR REPLACE INTO t (a) VALUES (?)')).toThrow(/upsert/u);
  });

  it('quotes a mixed-case alias so that the row keeps the name the store reads, but not a type', () => {
    expect(toPostgres('SELECT project_id AS projectId, created_at AS createdAt FROM events')).toBe(
      'SELECT project_id AS "projectId", created_at AS "createdAt" FROM events',
    );
    expect(toPostgres('SELECT COUNT(*) AS count, CAST(x AS INTEGER) AS n FROM t')).toBe(
      'SELECT COUNT(*) AS count, CAST(x AS INTEGER) AS n FROM t',
    );
    expect(toPostgres("SELECT 'AS camelCase' AS plain")).toBe("SELECT 'AS camelCase' AS plain");
  });

  it('drops PRAGMA, and takes BEGIN IMMEDIATE as BEGIN, and IFNULL as COALESCE', () => {
    expect(toPostgres('PRAGMA user_version = 3')).toBe('');
    expect(toPostgres('BEGIN IMMEDIATE')).toBe('BEGIN');
    expect(toPostgres('SELECT IFNULL(a, 0) FROM t')).toBe('SELECT COALESCE(a, 0) FROM t');
  });
});

/** A transport that answers from a script, so that failures the database cannot be asked for can be played. */
function scripted(answer: (request: BridgeRequest, index: number) => BridgeReply) {
  const requests: BridgeRequest[] = [];
  const transport: Transport & { requests: BridgeRequest[] } = {
    requests,
    broken: false,
    activeSchema: null,
    call: (request) => {
      requests.push(request);
      return answer(request, requests.length - 1);
    },
    close: () => undefined,
  };
  return transport;
}

const ok = (rows: Record<string, unknown>[] = [], rowCount = rows.length): BridgeReply => ({
  ok: true,
  rows,
  rowCount,
});
const failed = (code: string | null, message = 'no'): BridgeReply => ({
  ok: false,
  error: { name: 'error', message, code },
});

describe('a PostgreSQL transaction', () => {
  it('is serializable, and commits when the operation succeeds', () => {
    const transport = scripted(() => ok());
    const result = PostgresDatabase.onTransport(transport).transaction(() => 7);
    expect(result).toBe(7);
    expect(transport.requests.map((request) => (request as { text?: string }).text)).toEqual([
      'BEGIN ISOLATION LEVEL SERIALIZABLE',
      'COMMIT',
    ]);
  });

  it('runs the operation again from the start when it loses a race', () => {
    let raced = 0;
    const transport = scripted((request) => {
      if ((request as { text?: string }).text === 'COMMIT' && raced++ < 2) return failed('40001');
      return ok();
    });
    let runs = 0;
    const database = PostgresDatabase.onTransport(transport);
    expect(database.transaction(() => ++runs)).toBe(3);
    const texts = transport.requests.map((request) => (request as { text?: string }).text);
    expect(texts.filter((text) => text === 'BEGIN ISOLATION LEVEL SERIALIZABLE')).toHaveLength(3);
    expect(texts.filter((text) => text === 'ROLLBACK')).toHaveLength(2);
    expect(database.inTransaction).toBe(false);
  });

  it('retries a deadlock too, but gives up after six attempts and reports the failure', () => {
    const transport = scripted((request) =>
      (request as { text?: string }).text === 'COMMIT' ? failed('40P01', 'deadlock') : ok(),
    );
    const database = PostgresDatabase.onTransport(transport);
    expect(() => database.transaction(() => 1)).toThrow(DatabaseError);
    expect(
      transport.requests.filter(
        (request) => (request as { text?: string }).text === 'BEGIN ISOLATION LEVEL SERIALIZABLE',
      ),
    ).toHaveLength(6);
  });

  it('does not retry any other failure, and rolls back', () => {
    const transport = scripted(() => ok());
    const database = PostgresDatabase.onTransport(transport);
    expect(() =>
      database.transaction(() => {
        throw new Error('the operation itself failed');
      }),
    ).toThrow('the operation itself failed');
    const texts = transport.requests.map((request) => (request as { text?: string }).text);
    expect(texts).toEqual(['BEGIN ISOLATION LEVEL SERIALIZABLE', 'ROLLBACK']);
    expect(database.inTransaction).toBe(false);

    const unique = PostgresDatabase.onTransport(
      scripted((request) =>
        (request as { type: string }).type === 'query' ? failed('23505', 'duplicate') : ok(),
      ),
    );
    let attempts = 0;
    expect(() =>
      unique.transaction(() => {
        attempts++;
        unique.prepare('INSERT INTO t (a) VALUES (?)').run(1);
      }),
    ).toThrow(DatabaseError);
    expect(attempts).toBe(1);
  });

  it('reports an unreachable database as unavailable, not as a bug', () => {
    const transport = scripted(() => {
      throw new Error('connect ECONNREFUSED 10.0.0.4:5432');
    });
    const database = PostgresDatabase.onTransport(transport);
    let caught: unknown;
    try {
      database.prepare('SELECT 1').get();
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: 'STORAGE_UNAVAILABLE', statusCode: 503 });
    // What the caller is told names no host.
    expect(String((caught as Error).message)).not.toContain('10.0.0.4');
  });

  it('does not retry a statement run inside a transaction on a fresh connection', () => {
    const seen: boolean[] = [];
    const transport = scripted((request) => {
      if (request.type === 'query') seen.push(request.retry);
      return ok();
    });
    const database = PostgresDatabase.onTransport(transport);
    database.prepare('SELECT 1').get();
    database.transaction(() => database.prepare('SELECT 2').get());
    expect(seen).toEqual([true, false]);
  });
});

const opened: Repository[] = [];
function repository(target = 'pglite:memory'): Repository {
  const instance = new Repository(target);
  opened.push(instance);
  return instance;
}
afterEach(() => {
  for (const instance of opened.splice(0)) instance.close();
});

const rawOf = (instance: Repository): SqlDatabase =>
  (instance as unknown as { database: SqlDatabase }).database;

describe('the repository on PostgreSQL (PGlite, which is PostgreSQL running in this process)', () => {
  it('migrates a new database to the latest schema and says which database it is', () => {
    const db = repository();
    expect(db.dialect).toBe('postgres');
    expect(db.migration).toMatchObject({ from: 0, to: 5, backup: null });
    expect(db.migration.applied).toHaveLength(5);
    expect(db.ping()).toBe(true);
  });

  it('opens an existing database again without migrating it, and a newer one not at all', () => {
    const first = repository('pglite:reopened');
    const project = first.create(fixtureInput());
    const again = repository('pglite:reopened');
    expect(again.migration).toMatchObject({ from: 5, to: 5, applied: [] });
    expect(again.get(project.id).name).toBe(project.name);

    rawOf(first).prepare('UPDATE swarm_schema SET version = 99 WHERE id = 1').run();
    expect(() => new Repository('pglite:reopened')).toThrow(/newer application version/u);
    // Refused untouched.
    expect(rawOf(first).prepare('SELECT version FROM swarm_schema WHERE id = 1').get()).toEqual({
      version: 99,
    });
  });

  it('stores, lists, counts, updates and deletes projects with their passages and events', () => {
    const db = repository();
    const created = db.create(fixtureInput({ name: 'Stored in PostgreSQL' }));
    expect(db.get(created.id).name).toBe('Stored in PostgreSQL');
    expect(db.ownership(created.id)).toEqual({ tenantId: 'local', ownerId: 'local-user' });
    expect(db.count()).toBe(1);
    expect(db.list(10, 0, 'local')).toMatchObject({ total: 1 });
    expect(db.list(10, 0, 'another-tenant')).toEqual({ projects: [], total: 0 });

    db.update(created.id, { status: 'failed', error: 'x' });
    expect(db.get(created.id).status).toBe('failed');
    db.addEvent(created.id, 'knowledge', 'A note');
    expect(db.get(created.id).events.at(-1)?.message).toBe('A note');
    expect(db.chunks(created.id).length).toBeGreaterThan(0);

    db.delete(created.id);
    expect(db.count()).toBe(0);
    // The passages and the project's membership went with it; the audit trail did not.
    expect(rawOf(db).prepare('SELECT COUNT(*) AS count FROM chunks').get()).toEqual({ count: 0 });
    expect(rawOf(db).prepare('SELECT COUNT(*) AS count FROM project_members').get()).toEqual({
      count: 0,
    });
    expect(db.audit.list({ projectId: created.id }).map((event) => event.action)).toContain(
      'project.deleted',
    );
  });

  it('orders passages by number, not as text, and returns event fields under their own names', () => {
    const db = repository();
    const text = Array.from(
      { length: 14 },
      (_, index) => `Sentence number ${index + 1} about transit.`,
    ).join(' ');
    const project = db.create(
      fixtureInput({ documents: [{ name: 'long.md', content: text.repeat(30) }] }),
    );
    const ids = db.chunks(project.id).map((chunk) => Number(chunk.id.slice(1)));
    expect(ids.length).toBeGreaterThan(10);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    const event = db.get(project.id).events[0];
    expect(event).toBeDefined();
    expect(Object.keys(event!).sort()).toEqual([
      'createdAt',
      'id',
      'message',
      'projectId',
      'stage',
    ]);
  });

  it('commits or rolls back a group of changes as one', () => {
    const db = repository();
    const created = db.create(fixtureInput());
    expect(() =>
      db.atomic(() => {
        db.update(created.id, { status: 'failed' });
        db.audit.record({ actor: 'a', action: 'x.y', targetType: 'project', targetId: created.id });
        throw new Error('stop');
      }),
    ).toThrow('stop');
    expect(db.get(created.id).status).toBe('draft');
    expect(db.audit.list().map((event) => event.action)).not.toContain('x.y');
    db.atomic(() => db.update(created.id, { status: 'failed' }));
    expect(db.get(created.id).status).toBe('failed');
  });

  it('keeps a hash-chained audit log that the database itself refuses to alter', () => {
    const db = repository();
    for (const action of ['a.one', 'a.two', 'a.three']) {
      db.audit.record({ actor: 'tester', action, targetType: 'test', targetId: 't' });
    }
    expect(db.audit.verify()).toEqual({ ok: true, checked: 3, brokenAt: null });
    const raw = rawOf(db);
    expect(() => raw.prepare("UPDATE audit_events SET actor = 'x' WHERE seq = 1").run()).toThrow(
      /append-only/u,
    );
    expect(() => raw.prepare('DELETE FROM audit_events WHERE seq = 1').run()).toThrow(
      /append-only/u,
    );
    expect(() => raw.exec('TRUNCATE audit_events')).toThrow(/append-only/u);
    expect(db.audit.verify().ok).toBe(true);
  });

  it('refuses a second row with the same unique key, with the code a caller can act on', () => {
    const db = repository();
    const raw = rawOf(db);
    const insert = () =>
      raw
        .prepare(
          'INSERT INTO login_attempts (state_hash, binding_hash, nonce, verifier, return_to, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('s', 'b', 'n', 'v', '/', 1);
    insert();
    try {
      insert();
      expect.unreachable('a duplicate must be refused');
    } catch (error) {
      expect(error).toBeInstanceOf(DatabaseError);
      expect((error as DatabaseError).code).toBe('23505');
    }
  });

  it('holds numbers above 32 bits as numbers', () => {
    const db = repository();
    const at = 1_900_000_000_000;
    db.sessions.createLogin({
      state: 'x'.repeat(43),
      binding: 'y'.repeat(43),
      nonce: 'n',
      verifier: 'v',
      returnTo: '/',
    });
    const row = rawOf(db).prepare('SELECT created_at FROM login_attempts').get();
    expect(typeof row?.created_at).toBe('number');
    expect(at).toBeGreaterThan(2 ** 31);
    rawOf(db).prepare('UPDATE login_attempts SET created_at = ?').run(at);
    expect(rawOf(db).prepare('SELECT created_at FROM login_attempts').get()).toEqual({
      created_at: at,
    });
  });
});
