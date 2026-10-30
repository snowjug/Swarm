import { spawn, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseError } from '../src/storage/postgres/database.js';
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

beforeAll(async () => {
  server = spawn(process.execPath, ['--import', 'tsx', 'backend/test/support/pglite-server.ts'], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const port = await new Promise<string>((resolve, reject) => {
    let seen = '';
    server.stdout!.on('data', (chunk: Buffer) => {
      seen += chunk.toString('utf8');
      const match = /LISTENING (\d+)/u.exec(seen);
      if (match?.[1]) resolve(match[1]);
    });
    server.once('exit', () => reject(new Error('The test database server stopped.')));
  });
  url = `postgres://swarm@127.0.0.1:${port}/postgres?sslmode=disable`;
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
      expect(repository.migration.to).toBe(5);
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
