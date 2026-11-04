import { spawn, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LATEST_SCHEMA_VERSION } from '../src/storage/migrations.js';
import { isStorageUnavailable } from '../src/storage/failure.js';
import { DatabaseError, PostgresDatabase } from '../src/storage/postgres/database.js';
import { Repository } from '../src/storage/repository.js';
import type { SqlDatabase } from '../src/storage/sql.js';
import { fixtureInput } from './fixtures.js';

/**
 * The same repository over the real `pg` client and the PostgreSQL wire protocol, against a server
 * in another process (PGlite behind a socket). What this adds to the in-process tests: the worker's
 * connection code, the driver's type handling, and error codes as the driver reports them.
 * It cannot show TLS, Microsoft Entra authentication or behaviour under real network failure.
 */
let server: ChildProcess;
let url: string;

/** A server in a process of its own, on `port` (0 for any free one), once it accepts connections. */
async function startServer(port = 0): Promise<{ child: ChildProcess; port: string }> {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'backend/test/support/pglite-server.ts'],
    {
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, PGLITE_PORT: String(port) },
    },
  );
  const listening = await new Promise<string>((resolve, reject) => {
    let seen = '';
    child.stdout!.on('data', (chunk: Buffer) => {
      seen += chunk.toString('utf8');
      const match = /LISTENING (\d+)/u.exec(seen);
      if (match?.[1]) resolve(match[1]);
    });
    child.once('exit', () => reject(new Error('The test database server stopped.')));
  });
  return { child, port: listening };
}

beforeAll(async () => {
  const started = await startServer();
  server = started.child;
  url = `postgres://swarm@127.0.0.1:${started.port}/postgres?sslmode=disable`;
}, 120_000);

afterAll(() => {
  server?.kill();
});

const rawOf = (repository: Repository): SqlDatabase =>
  (repository as unknown as { database: SqlDatabase }).database;

describe('the repository over the pg driver', () => {
  it('migrates, stores and reads back, and keeps the audit chain', () => {
    const repository = new Repository(url);
    try {
      expect(repository.dialect).toBe('postgres');
      expect(repository.migration.to).toBe(LATEST_SCHEMA_VERSION);
      const project = repository.create(fixtureInput({ name: 'Over the wire' }));
      expect(repository.get(project.id).name).toBe('Over the wire');
      expect(repository.list(10, 0, 'local').total).toBeGreaterThanOrEqual(1);
      repository.audit.record({
        actor: 'a',
        action: 'driver.checked',
        targetType: 't',
        targetId: '1',
      });
      expect(repository.audit.verify().ok).toBe(true);
      repository.delete(project.id);
    } finally {
      repository.close();
    }
  });

  it('returns whole numbers beyond 32 bits as numbers, and reports a duplicate with its SQLSTATE', () => {
    const repository = new Repository(url);
    try {
      const raw = rawOf(repository);
      const insert = (createdAt: number) =>
        raw
          .prepare(
            'INSERT INTO login_attempts (state_hash, binding_hash, nonce, verifier, return_to, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run('over-the-wire', 'b', 'n', 'v', '/', createdAt);
      raw.prepare('DELETE FROM login_attempts').run();
      insert(1_900_000_000_000);
      expect(raw.prepare('SELECT created_at FROM login_attempts').get()).toEqual({
        created_at: 1_900_000_000_000,
      });
      expect(raw.prepare('SELECT COUNT(*) AS count FROM login_attempts').get()).toEqual({
        count: 1,
      });
      let code: string | null = null;
      try {
        insert(1);
      } catch (error) {
        if (error instanceof DatabaseError) code = error.code;
      }
      expect(code).toBe('23505');
    } finally {
      repository.close();
    }
  });

  it('rolls a transaction back over the wire, and a mixed-case alias keeps its name', () => {
    const repository = new Repository(url);
    try {
      const project = repository.create(fixtureInput());
      expect(() =>
        repository.atomic(() => {
          repository.update(project.id, { status: 'failed' });
          throw new Error('stop');
        }),
      ).toThrow('stop');
      expect(repository.get(project.id).status).toBe('draft');
      expect(Object.keys(repository.get(project.id).events[0] ?? {})).toContain('projectId');
      repository.delete(project.id);
    } finally {
      repository.close();
    }
  });

  it('refuses to start, without repeating the password, when the server cannot be reached', () => {
    let message = '';
    try {
      new Repository('postgres://swarm:Sup3rSecret@127.0.0.1:1/postgres?sslmode=disable');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toBe('');
    expect(message).not.toContain('Sup3rSecret');
  }, 60_000);
});

describe('a server that goes away and comes back, over the pg driver', () => {
  const address = (port: string) => `postgres://swarm@127.0.0.1:${port}/postgres?sslmode=disable`;
  const failure = (run: () => unknown): unknown => {
    try {
      run();
    } catch (error) {
      return error;
    }
    return undefined;
  };

  it('is reported as unavailable when it goes while a statement of a transaction is running, as the driver words that with no code of its own', async () => {
    const first = await startServer();
    const database = PostgresDatabase.connect(address(first.port));
    try {
      expect(database.prepare('SELECT 1 AS ok').get()).toEqual({ ok: 1 });
      // The call holds this thread until the statement ends, so another process ends the server meanwhile.
      spawn(
        process.execPath,
        ['-e', `setTimeout(() => process.kill(${first.child.pid}, 'SIGKILL'), 500)`],
        { stdio: 'ignore' },
      ).unref();
      // Inside a transaction a lost connection is not replaced: what ran there is gone with it.
      const refused = failure(() =>
        database.transaction(() => database.prepare('SELECT pg_sleep(20) AS slept').get()),
      );
      expect(refused).toBeInstanceOf(DatabaseError);
      expect((refused as DatabaseError).code).toBe('08006');
      expect(isStorageUnavailable(refused)).toBe(true);
    } finally {
      database.close();
      first.child.kill();
    }
  }, 120_000);

  it('is reported as unavailable at once and every time while it is gone, and served again from the first transaction when it returns', async () => {
    const first = await startServer();
    const database = PostgresDatabase.connect(address(first.port));
    let second: Awaited<ReturnType<typeof startServer>> | undefined;
    try {
      expect(database.prepare('SELECT 1 AS ok').get()).toEqual({ ok: 1 });

      // Lost in the middle of a transaction: it is not run again on another connection, and the
      // failure says that the database is out of reach, not that something is wrong with the statement.
      let runs = 0;
      const midway = failure(() =>
        database.transaction(() => {
          runs++;
          database.prepare('SELECT 1 AS ok').get();
          first.child.kill('SIGKILL');
          // Time for the system to close the connection the process held.
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
          database.prepare('SELECT 2 AS ok').get();
        }),
      );
      expect(runs).toBe(1);
      expect(midway).toBeInstanceOf(DatabaseError);
      expect(isStorageUnavailable(midway)).toBe(true);

      // Whatever is asked while it is gone fails the same way, at once, and does not wait on a dead client.
      for (const ask of [
        () => database.prepare('SELECT 1 AS ok').get(),
        () => database.prepare('SELECT 1 AS ok').get(),
        () => database.transaction(() => 1),
        () => database.readSnapshot(() => 1),
      ]) {
        const refused = failure(ask);
        expect(refused).toBeInstanceOf(DatabaseError);
        expect(isStorageUnavailable(refused)).toBe(true);
      }

      second = await startServer(Number(first.port));
      // The first thing asked is the beginning of a transaction, which is enough to be served again.
      expect(database.transaction(() => database.prepare('SELECT 1 AS ok').get())).toEqual({
        ok: 1,
      });
      expect(database.readSnapshot(() => database.prepare('SELECT 2 AS ok').get())).toEqual({
        ok: 2,
      });
      expect(database.prepare('SELECT 3 AS ok').get()).toEqual({ ok: 3 });
    } finally {
      database.close();
      second?.child.kill();
    }
  }, 180_000);
});
