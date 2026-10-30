import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PostgresDatabase } from './postgres/database.js';
import { SqliteDatabase, type SqlDatabase } from './sql.js';

export type DatabaseKind = 'sqlite' | 'postgres' | 'pglite';

/** Which database a target names: a file path or `:memory:` (SQLite), a `postgres://` URL, or `pglite:`. */
export function kindOf(target: string): DatabaseKind {
  if (/^postgres(?:ql)?:\/\//iu.test(target)) return 'postgres';
  if (target.startsWith('pglite:')) return 'pglite';
  return 'sqlite';
}

/**
 * Opens the database a target names: a SQLite file path or `:memory:`, a `postgres://` URL, or
 * `pglite:memory` / `pglite:<name>` for PostgreSQL running inside this process (tests; the same name
 * is the same data). `SWARM_TEST_DATABASE=pglite` makes every in-memory database a PostgreSQL one, so
 * that the whole test suite can be run against PostgreSQL code: `npm run test:postgres`. It is a test
 * switch, read here and nowhere else.
 */
export function openDatabase(target: string, options: { entra?: boolean } = {}): SqlDatabase {
  const effective =
    target === ':memory:' && process.env.SWARM_TEST_DATABASE === 'pglite'
      ? 'pglite:memory'
      : target;
  switch (kindOf(effective)) {
    case 'pglite': {
      const name = effective.slice('pglite:'.length);
      if (name !== 'memory' && !/^[a-z][a-z0-9_]{0,40}$/u.test(name)) {
        throw new Error('A pglite target is pglite:memory or pglite:<schema name>.');
      }
      return PostgresDatabase.inMemory(name === 'memory' ? undefined : `swarm_${name}`);
    }
    case 'postgres':
      return PostgresDatabase.connect(effective, options);
    case 'sqlite': {
      if (effective !== ':memory:') mkdirSync(dirname(effective), { recursive: true, mode: 0o700 });
      const database = new DatabaseSync(effective);
      database.exec(`
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 5000;
      `);
      return new SqliteDatabase(database);
    }
  }
}
