import { copyFileSync, existsSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { AppError } from '../errors.js';

export interface Migration {
  version: number;
  name: string;
  up: (database: DatabaseSync) => void;
}

/** The schema as shipped before migrations existed. Every statement is idempotent. */
const SCHEMA_V1 = `
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    status TEXT NOT NULL, payload TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chunks (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (project_id, id)
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    stage TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS events_project ON events(project_id, id);
  CREATE TABLE IF NOT EXISTS messages (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    target TEXT NOT NULL, payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS messages_project ON messages(project_id, target, seq);
`;

/**
 * The claim ledger, conflicts between sources and an append-only audit log. Ledger rows belong to a
 * project and go with it. Audit rows deliberately do not: they hold identifiers and counts, never
 * content, so they can outlive a deleted project and still prove what happened.
 */
const SCHEMA_V2 = `
  CREATE TABLE IF NOT EXISTS claim_records (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    id TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY (project_id, id)
  );
  CREATE TABLE IF NOT EXISTS source_conflicts (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    id TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY (project_id, id)
  );
  CREATE TABLE IF NOT EXISTS ledger_state (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    built_at TEXT NOT NULL, reviewed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS audit_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
    target_type TEXT NOT NULL, target_id TEXT NOT NULL, project_id TEXT,
    detail TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS audit_project ON audit_events(project_id, seq);
  CREATE TRIGGER IF NOT EXISTS audit_events_no_update BEFORE UPDATE ON audit_events
  BEGIN SELECT RAISE(ABORT, 'audit events are append-only'); END;
  CREATE TRIGGER IF NOT EXISTS audit_events_no_delete BEFORE DELETE ON audit_events
  BEGIN SELECT RAISE(ABORT, 'audit events are append-only'); END;
`;

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'projects, passages, events and messages', up: (db) => db.exec(SCHEMA_V1) },
  {
    version: 2,
    name: 'claim ledger, source conflicts and append-only audit log',
    up: (db) => db.exec(SCHEMA_V2),
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

export interface MigrationReport {
  from: number;
  to: number;
  applied: string[];
  /** Path of the copy taken before upgrading an existing database file. Null when none was needed. */
  backup: string | null;
}

const versionRow = z.object({ user_version: z.number() });

export function readSchemaVersion(database: DatabaseSync): number {
  return versionRow.parse(database.prepare('PRAGMA user_version').get()).user_version;
}

/**
 * Brings the database up to the latest schema, one transactional step at a time. A database that
 * is newer than this build is refused untouched. An existing database file is copied before it is
 * upgraded, and a failed step rolls back, so there is always a known-good state to return to.
 */
export function migrate(
  database: DatabaseSync,
  options: { path: string; migrations?: readonly Migration[] },
): MigrationReport {
  const migrations = options.migrations ?? MIGRATIONS;
  const latest = migrations[migrations.length - 1]?.version ?? 0;
  const from = readSchemaVersion(database);
  if (from > latest) {
    throw new AppError(
      500,
      'STORAGE_VERSION',
      'This database requires a newer application version.',
    );
  }
  const pending = migrations.filter((migration) => migration.version > from);
  const report: MigrationReport = { from, to: from, applied: [], backup: null };
  if (pending.length === 0) return report;

  if (from > 0 && options.path !== ':memory:' && existsSync(options.path)) {
    database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const backup = `${options.path}.v${from}.bak`;
    if (!existsSync(backup)) copyFileSync(options.path, backup);
    report.backup = backup;
  }

  for (const migration of pending) {
    database.exec('BEGIN IMMEDIATE');
    try {
      migration.up(database);
      database.exec(`PRAGMA user_version = ${Math.trunc(migration.version)}`);
      database.exec('COMMIT');
    } catch (cause) {
      database.exec('ROLLBACK');
      throw new AppError(
        500,
        'STORAGE_MIGRATION',
        `Migration ${migration.version} (${migration.name}) failed and was rolled back. The database is unchanged.`,
        { cause },
      );
    }
    report.applied.push(`${migration.version}: ${migration.name}`);
    report.to = migration.version;
  }
  return report;
}
