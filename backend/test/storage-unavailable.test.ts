import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { TokenVerifier } from '../src/auth/tokens.js';
import { publicFailure, storageUnavailable } from '../src/errors.js';
import { DatabaseError, isStorageUnavailable } from '../src/storage/failure.js';
import { openDatabase } from '../src/storage/open.js';
import { PostgresDatabase } from '../src/storage/postgres/database.js';
import { Repository } from '../src/storage/repository.js';
import type { SqlDatabase } from '../src/storage/sql.js';
import { fixtureInput, testConfig } from './fixtures.js';
import { entraEnvironment, idp } from './support/entra-idp.js';
import { telemetryHarness } from './support/telemetry-harness.js';

// A database that is down, too slow or held by others is told to a person in words they can use and to a
// probe as a 503 it can retry. A defect is not: it stays an internal error. The two are told apart by the
// class and the code the driver gives, never by what it says, because what it says can hold a host, a
// statement or a credential, and none of that may reach an answer or a log.
const telemetry = telemetryHarness();

const HOST = 'swarm.example.test';
const PERSON = 'aaaaaaa5-0000-4000-8000-000000000005';

const CALM =
  'Swarm cannot use its database right now. Nothing you did caused this. Wait a minute, then try again.';

/** What a driver puts in its messages: a host, an address, a statement, a login and a connection string. */
const DRIVER_TEXT =
  'canary-driver-text: connection to server at "db.internal.example" (10.1.2.3), port 5432 failed: ' +
  'FATAL: password authentication failed for user "swarm_app" while running ' +
  "SELECT payload FROM projects WHERE id = 'canary-id' " +
  'postgres://swarm_app:canary-password-do-not-log@db.internal.example/swarm';
const LEAKS = /canary|db\.internal|10\.1\.2\.3|5432|swarm_app|SELECT|FROM projects|postgres:/iu;

const caught = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('It did not throw.');
};

const directories: string[] = [];
function workDirectory(): string {
  mkdirSync('data', { recursive: true });
  const directory = mkdtempSync(join('data', 'storage-unavailable-'));
  directories.push(directory);
  return directory;
}
afterAll(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

describe('which failures of the store mean that it cannot serve', () => {
  const driver = (code: string | null, message = DRIVER_TEXT) => new DatabaseError(message, code);

  it.each([
    ['a connection that failed', '08006'],
    ['a connection that could not be made', '08001'],
    ['a connection exception that is not told apart', '08000'],
    ['a connection that does not exist', '08003'],
    ['a connection that the server refused', '08004'],
    ['a connection that ended with its outcome unknown', '08007'],
    ['a server that is shutting down', '57P01'],
    ['a server that cannot take connections yet', '57P03'],
    ['a statement that ran past its timeout', '57014'],
    ['no connection left to take', '53300'],
    ['a disk that is full', '53100'],
    ['a login that was refused', '28P01'],
    ['a server that turned read-only, as one does when it fails over', '25006'],
    ['a transaction that lost its race too often', '40001'],
    ['a deadlock that came up every time', '40P01'],
    ['a lock that was not given in time', '55P03'],
    ['a connection that was refused', 'ECONNREFUSED'],
    ['a connection that was reset', 'ECONNRESET'],
    ['a connection that timed out', 'ETIMEDOUT'],
    ['a pipe that broke', 'EPIPE'],
    ['a name that cannot be found', 'ENOTFOUND'],
    ['a name server that does not answer', 'EAI_AGAIN'],
  ])('is %s (%s)', (_what, code) => {
    expect(isStorageUnavailable(driver(code))).toBe(true);
  });

  it.each([
    '23505',
    '23503',
    '42P01',
    '42601',
    '22P02',
    'XX000',
    '0A000',
    'P0001',
    'EACCES',
    // A protocol violation, such as a statement sent with the wrong number of parameters, is a defect of ours, and
    // is the one code of class 08 that is not a connection that failed.
    '08P01',
    null,
  ])('is not a statement the database refused as a defect of what was asked: code %s', (code) => {
    expect(isStorageUnavailable(driver(code))).toBe(false);
  });

  it.each(['econnrefused', ' 08006', '08006 ', '08', '0800', '080061', '57', 'E08006'])(
    'is not a code that only resembles one on the list: %j',
    (code) => {
      expect(isStorageUnavailable(driver(code))).toBe(false);
    },
  );

  it('never goes by what a message says', () => {
    for (const message of [
      'connect ECONNREFUSED 10.1.2.3:5432',
      'Connection terminated unexpectedly',
      'canceling statement due to statement timeout',
      'database is locked',
      'SQLITE_BUSY',
    ]) {
      expect(isStorageUnavailable(driver(null, message)), message).toBe(false);
      expect(isStorageUnavailable(driver('23505', message)), message).toBe(false);
      expect(isStorageUnavailable(new Error(message)), message).toBe(false);
    }
  });

  it('is not taken in by what only looks like a driver error', () => {
    expect(isStorageUnavailable(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBe(false);
    expect(isStorageUnavailable(Object.assign(new Error('x'), { code: '57014' }))).toBe(false);
    expect(isStorageUnavailable({ name: 'DatabaseError', code: '08006', message: 'x' })).toBe(
      false,
    );
    expect(isStorageUnavailable('08006')).toBe(false);
    expect(isStorageUnavailable(null)).toBe(false);
    expect(isStorageUnavailable(undefined)).toBe(false);
  });

  it('reads an error of node:sqlite, which has no class of its own, by the result code it carries', () => {
    const sqlite = (errcode: unknown, code = 'ERR_SQLITE_ERROR') =>
      Object.assign(new Error('x'), { code, errcode, errstr: 'x' });
    // BUSY, LOCKED, READONLY, IOERR, FULL, CANTOPEN, and BUSY_SNAPSHOT and BUSY_TIMEOUT, which share BUSY's low byte.
    for (const errcode of [5, 6, 8, 10, 13, 14, 517, 773]) {
      expect(isStorageUnavailable(sqlite(errcode)), String(errcode)).toBe(true);
    }
    // ERROR, CORRUPT, CONSTRAINT, NOTADB: waiting does not mend them.
    for (const errcode of [1, 11, 19, 26, 0, '5', undefined]) {
      expect(isStorageUnavailable(sqlite(errcode)), String(errcode)).toBe(false);
    }
    expect(isStorageUnavailable(sqlite(5, 'ERR_INVALID_STATE'))).toBe(false);
  });

  it('is what SQLite itself throws when another connection holds the database, and not for a statement that is wrong', () => {
    const file = join(workDirectory(), 'held.sqlite');
    const holder = new DatabaseSync(file);
    holder.exec('PRAGMA journal_mode = WAL; CREATE TABLE t (x INTEGER)');
    const waiter = new DatabaseSync(file);
    waiter.exec('PRAGMA busy_timeout = 0');
    try {
      holder.exec('BEGIN IMMEDIATE');
      const held = caught(() => waiter.exec('BEGIN IMMEDIATE'));
      holder.exec('ROLLBACK');
      const wrong = caught(() => waiter.prepare('SELECT * FROM missing').all());
      expect(held).toMatchObject({ code: 'ERR_SQLITE_ERROR', errcode: 5 });
      expect(isStorageUnavailable(held)).toBe(true);
      expect(isStorageUnavailable(wrong)).toBe(false);
    } finally {
      holder.close();
      waiter.close();
    }
  });

  it('is not what PostgreSQL reports for a statement sent with the wrong number of parameters: that is a defect, and stays one', () => {
    const database = PostgresDatabase.inMemory();
    try {
      const wrong = caught(() => database.prepare('SELECT ? AS a').get(1, 2));
      expect(wrong).toMatchObject({ code: '08P01' });
      expect(isStorageUnavailable(wrong)).toBe(false);
    } finally {
      database.close();
    }
  });

  it('is what SQLite itself throws when a disk fills inside a transaction, and not the failed rollback that comes after it', () => {
    const database = openDatabase(join(workDirectory(), 'full.sqlite'));
    try {
      database.exec('CREATE TABLE t (x TEXT)');
      database.exec('PRAGMA max_page_count = 12');
      const full = caught(() =>
        database.transaction(() => {
          for (let row = 0; row < 500; row += 1)
            database.prepare('INSERT INTO t (x) VALUES (?)').run('x'.repeat(2_000));
        }),
      );
      // SQLite rolls the transaction back itself, so a ROLLBACK of ours finds none ("cannot rollback"), which would
      // have been the error to report; the error is the one that came first.
      expect(full).toMatchObject({ code: 'ERR_SQLITE_ERROR', errcode: 13 });
      expect(isStorageUnavailable(full)).toBe(true);
      // And the database is usable afterwards: nothing is left open.
      expect(database.transaction(() => database.prepare('SELECT 1 AS ok').get())).toEqual({
        ok: 1,
      });
    } finally {
      database.close();
    }
  });

  it('is what PostgreSQL itself reports: a server that cannot write is not serving, a refused statement is a defect', () => {
    const database = PostgresDatabase.inMemory();
    try {
      database.exec('CREATE TABLE u (a INTEGER PRIMARY KEY)');
      database.prepare('INSERT INTO u (a) VALUES (?)').run(1);
      const duplicate = caught(() => database.prepare('INSERT INTO u (a) VALUES (?)').run(1));
      const missing = caught(() => database.prepare('SELECT * FROM nowhere').all());
      const readOnly = caught(() =>
        database.readSnapshot(() => database.prepare('INSERT INTO u (a) VALUES (?)').run(2)),
      );
      expect(duplicate).toMatchObject({ code: '23505' });
      expect(missing).toMatchObject({ code: '42P01' });
      expect(readOnly).toMatchObject({ code: '25006' });
      expect(isStorageUnavailable(duplicate)).toBe(false);
      expect(isStorageUnavailable(missing)).toBe(false);
      expect(isStorageUnavailable(readOnly)).toBe(true);
    } finally {
      database.close();
    }
  });

  it('is told to a person, whoever raised it, in one sentence that holds none of what the driver said', () => {
    const fromDriver = publicFailure(driver('08006'));
    const fromAdapter = publicFailure(storageUnavailable(new Error(DRIVER_TEXT)));
    for (const failure of [fromDriver, fromAdapter]) {
      expect(failure).toEqual({ code: 'STORAGE_UNAVAILABLE', message: CALM });
    }
    expect(publicFailure(driver('23505')).code).toBe('INTERNAL_ERROR');
    expect(storageUnavailable(new Error(DRIVER_TEXT))).toMatchObject({
      statusCode: 503,
      code: 'STORAGE_UNAVAILABLE',
      message: CALM,
    });
  });
});

const applications: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

async function start(options: { repository?: Repository; signedIn?: boolean } = {}) {
  const lines: Record<string, unknown>[] = [];
  const config = testConfig({
    ...(options.signedIn
      ? {
          ...entraEnvironment,
          AUTH_ENTRA_CLIENT_ID: 'cccccccc-0000-4000-8000-0000000000aa',
          AUTH_ENTRA_REDIRECT_URI: `https://${HOST}/auth/callback`,
          ALLOWED_HOSTS: `${HOST},localhost`,
          ALLOWED_ORIGINS: `https://${HOST}`,
        }
      : {}),
    LOG_LEVEL: 'info',
  });
  const instance = await buildApp({
    config,
    repository: options.repository ?? new Repository(':memory:'),
    ...(options.signedIn ? { tokenVerifier: new TokenVerifier(config.auth, idp.keys) } : {}),
    logStream: { write: (line: string) => void lines.push(JSON.parse(line)) },
    frontendRoot: null,
  });
  applications.push(instance);
  return { ...instance, lines };
}

/** The answer to a person must say this, in this shape, and nothing of the cause. */
function expectUnavailable(
  answer: Awaited<ReturnType<Awaited<ReturnType<typeof start>>['app']['inject']>>,
) {
  expect(answer.statusCode).toBe(503);
  expect(answer.json()).toEqual({
    error: {
      code: 'STORAGE_UNAVAILABLE',
      message: CALM,
      requestId: answer.headers['x-request-id'],
    },
  });
  expect(answer.headers['retry-after']).toBe('60');
  expect(answer.headers['cache-control']).toBe('no-store');
  expect(answer.body).not.toMatch(LEAKS);
}

describe('an answer when the store cannot serve', () => {
  const causes: [string, () => unknown][] = [
    ['a lost connection', () => new DatabaseError(DRIVER_TEXT, '08006')],
    ['a server that is shutting down', () => new DatabaseError(DRIVER_TEXT, '57P01')],
    ['a connection that was refused', () => new DatabaseError(DRIVER_TEXT, 'ECONNREFUSED')],
    ['a statement past its timeout', () => new DatabaseError(DRIVER_TEXT, '57014')],
    ['no connection left to take', () => new DatabaseError(DRIVER_TEXT, '53300')],
    ['a login that was refused', () => new DatabaseError(DRIVER_TEXT, '28P01')],
    ['a transaction that lost its race too often', () => new DatabaseError(DRIVER_TEXT, '40001')],
    ['an adapter that gave up waiting', () => storageUnavailable(new Error(DRIVER_TEXT))],
  ];

  it.each(causes)(
    'is a 503 with a code, a calm sentence and a time to wait, whatever the cause was: %s',
    async (_what, make) => {
      const { app, repository, lines } = await start();
      vi.spyOn(repository, 'list').mockImplementation(() => {
        throw make();
      });
      const answer = await app.inject('/api/projects');
      expectUnavailable(answer);
      expect(Object.keys(answer.json().error).sort()).toEqual(['code', 'message', 'requestId']);
      // The operator is told by the code and the kind of error, in one line, and by nothing the driver said.
      const failed = lines.filter((line) => line.level === 50);
      expect(failed).toHaveLength(1);
      expect(failed[0]).toMatchObject({
        code: 'STORAGE_UNAVAILABLE',
        requestId: answer.headers['x-request-id'],
      });
      expect(['DatabaseError', 'AppError']).toContain(failed[0]!.errorType);
      expect(JSON.stringify(lines)).not.toMatch(LEAKS);
    },
  );

  it.each([
    ['a statement the database refused', () => new DatabaseError(DRIVER_TEXT, '23505')],
    ['a statement that cannot be run', () => new DatabaseError(DRIVER_TEXT, '42P01')],
    ['a driver failure that names no code', () => new DatabaseError(DRIVER_TEXT, null)],
    [
      'an error that only carries a driver code',
      () => Object.assign(new Error(DRIVER_TEXT), { code: 'ECONNRESET' }),
    ],
  ])('is still an internal error, with no time to wait, for %s', async (_what, make) => {
    const { app, repository, lines } = await start();
    vi.spyOn(repository, 'list').mockImplementation(() => {
      throw make();
    });
    const answer = await app.inject('/api/projects');
    expect(answer.statusCode).toBe(500);
    expect(answer.json().error).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(answer.headers['retry-after']).toBeUndefined();
    expect(answer.body).not.toMatch(LEAKS);
    expect(JSON.stringify(lines)).not.toMatch(LEAKS);
  });

  it('is counted as an error of its own code, so that an alert can be set on it', async () => {
    const { app, repository } = await start();
    const before = telemetry.total(await telemetry.measurements(), 'swarm.http.errors', {
      'swarm.error.code': 'STORAGE_UNAVAILABLE',
      'swarm.http.status_class': '5xx',
    });
    vi.spyOn(repository, 'list').mockImplementation(() => {
      throw new DatabaseError(DRIVER_TEXT, '08006');
    });
    await app.inject('/api/projects');
    const after = telemetry.total(await telemetry.measurements(), 'swarm.http.errors', {
      'swarm.error.code': 'STORAGE_UNAVAILABLE',
      'swarm.http.status_class': '5xx',
    });
    expect(after - before).toBe(1);
  });

  it('is the answer to a write that a SQLite database held by another connection refuses, and the same write goes through once it is let go', async () => {
    const file = join(workDirectory(), 'busy.sqlite');
    const repository = new Repository(file);
    const { app } = await start({ repository });
    // The wait is what the lock is for; a test should not spend it.
    (repository as unknown as { database: SqlDatabase }).database.exec('PRAGMA busy_timeout = 0');
    const other = new DatabaseSync(file);
    other.exec('BEGIN IMMEDIATE');
    try {
      const refused = await app.inject({
        method: 'POST',
        url: '/api/projects',
        payload: fixtureInput(),
      });
      expectUnavailable(refused);
    } finally {
      other.exec('ROLLBACK');
      other.close();
    }
    const made = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: fixtureInput(),
    });
    expect(made.statusCode).toBe(201);
  });
});

/** Makes every use of the repository's database fail, as an outage does, and lets it work again. */
function cutOff(repository: Repository): (down: boolean) => void {
  const held = (repository as unknown as { database: SqlDatabase }).database;
  const real = {
    prepare: held.prepare.bind(held),
    exec: held.exec.bind(held),
    transaction: held.transaction.bind(held),
    readSnapshot: held.readSnapshot.bind(held),
  };
  let down = false;
  const refuse = (): never => {
    throw new DatabaseError(DRIVER_TEXT, '08006');
  };
  held.prepare = (sql) => (down ? refuse() : real.prepare(sql));
  held.exec = (sql) => (down ? refuse() : real.exec(sql));
  held.transaction = (operation) => (down ? refuse() : real.transaction(operation));
  held.readSnapshot = (operation) => (down ? refuse() : real.readSnapshot(operation));
  return (value) => {
    down = value;
  };
}

describe('a database that is down', () => {
  it('is said to be so by a signed-in person’s every request, while the process is live and not ready, and all is as it was when the database returns', async () => {
    const repository = new Repository(':memory:');
    const { app } = await start({ repository, signedIn: true });
    const { token } = repository.sessions.create(
      { id: PERSON, tenantId: 'local-tenant', platformAdmin: false, bootstrapAdmin: false },
      { idleMs: 60_000, absoluteMs: 3_600_000 },
    );
    repository.members.setWorkspaceMember({
      tenantId: 'local-tenant',
      principalId: PERSON,
      role: 'owner',
      actor: { id: 'test-setup', workspaceRole: 'owner' },
    });
    const person = { host: HOST, cookie: `__Host-swarm_session=${token}`, 'x-swarm-csrf': '1' };
    const made = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: person,
      payload: fixtureInput(),
    });
    expect(made.statusCode).toBe(201);
    const id = made.json().id as string;

    const setDown = cutOff(repository);
    setDown(true);
    // The platform is told that it cannot serve, and that the process need not be restarted for it.
    const live = await app.inject({ url: '/api/health/live', headers: { host: HOST } });
    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({ status: 'live' });
    const ready = await app.inject({ url: '/api/health/ready', headers: { host: HOST } });
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({ status: 'not-ready', checks: { database: 'failed' } });
    expect(ready.body).not.toMatch(LEAKS);
    // A person with a valid session is told that the database is out of reach, not that they must sign in.
    for (const request of [
      { url: `/api/projects/${id}` },
      { url: '/api/projects' },
      { method: 'POST' as const, url: '/api/projects', payload: fixtureInput() },
      { method: 'DELETE' as const, url: `/api/projects/${id}` },
    ]) {
      expectUnavailable(await app.inject({ ...request, headers: person }));
    }

    setDown(false);
    expect(
      (await app.inject({ url: '/api/health/ready', headers: { host: HOST } })).statusCode,
    ).toBe(200);
    const back = await app.inject({ url: `/api/projects/${id}`, headers: person });
    expect(back.statusCode).toBe(200);
    expect(back.json()).toMatchObject({ id, name: 'Community transit pilot' });
    // The refused write left nothing behind, and the refused delete took nothing away.
    const listed = await app.inject({ url: '/api/projects', headers: person });
    expect(listed.json().total).toBe(1);
  });
});
