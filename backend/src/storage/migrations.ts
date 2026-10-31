import { existsSync } from 'node:fs';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { backupBeforeUpgrade } from './backup.js';
import {
  PG_V1,
  PG_V2,
  PG_V3,
  PG_V4,
  PG_V5,
  PG_V6,
  PG_V7,
  PG_VERSION_TABLE,
} from './postgres/schema.js';
import type { SqlDatabase } from './sql.js';

export interface Migration {
  version: number;
  name: string;
  /** Receives either dialect; a step with different SQL for each chooses by `database.dialect`. */
  up: (database: SqlDatabase) => void;
}

/** Runs the SQL for whichever database this is. */
const byDialect = (sqlite: string, postgres: string) => (database: SqlDatabase) =>
  database.exec(database.dialect === 'postgres' ? postgres : sqlite);

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

/**
 * Who belongs to a workspace (a tenant, in this release) and to each project, with the role they
 * hold. Every statement is idempotent, so a half-applied step can be retried. Existing projects
 * keep their owner as the project's lead and as a workspace member; nobody is an owner or admin of a
 * workspace until one is made, so that nothing is widened by an upgrade.
 */
const SCHEMA_V4 = `
  CREATE TABLE IF NOT EXISTS workspace_members (
    tenant_id TEXT NOT NULL, principal_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    added_by TEXT NOT NULL, added_at TEXT NOT NULL,
    PRIMARY KEY (tenant_id, principal_id)
  );
  CREATE INDEX IF NOT EXISTS workspace_members_role ON workspace_members(tenant_id, role);
  CREATE TABLE IF NOT EXISTS project_members (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    principal_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('lead', 'analyst', 'reviewer', 'viewer')),
    added_by TEXT NOT NULL, added_at TEXT NOT NULL,
    PRIMARY KEY (project_id, principal_id)
  );
  CREATE INDEX IF NOT EXISTS project_members_principal ON project_members(principal_id, project_id);
  INSERT OR IGNORE INTO project_members (project_id, principal_id, role, added_by, added_at)
    SELECT id, owner_id, 'lead', 'migration', created_at FROM projects;
  INSERT OR IGNORE INTO workspace_members (tenant_id, principal_id, role, added_by, added_at)
    SELECT tenant_id, owner_id, 'member', 'migration', MIN(created_at) FROM projects
    GROUP BY tenant_id, owner_id;
`;

/**
 * Browser sign-in. A login attempt is the state of one sign-in in flight: it holds hashes of the
 * state and of the browser binding, and the nonce and PKCE verifier that only this server needs, and
 * it lives ten minutes. A session is a hash of a random identifier with who it is for and when it
 * ends. Nothing a person's identity provider issued is stored in either.
 */
const SCHEMA_V5 = `
  CREATE TABLE IF NOT EXISTS login_attempts (
    state_hash TEXT PRIMARY KEY, binding_hash TEXT NOT NULL, nonce TEXT NOT NULL,
    verifier TEXT NOT NULL, return_to TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS login_attempts_created ON login_attempts(created_at);
  CREATE TABLE IF NOT EXISTS sessions (
    id_hash TEXT PRIMARY KEY, principal_id TEXT NOT NULL, tenant_id TEXT NOT NULL,
    platform_admin INTEGER NOT NULL, bootstrap_admin INTEGER NOT NULL,
    created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_principal ON sessions(tenant_id, principal_id);
  CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);
`;

/**
 * Durable jobs. A job is one stage of one project waiting to run, running, or finished; the table is
 * the queue, so a restart of any process loses nothing. A worker takes a job with an atomic update
 * that gives it a lease, renews the lease by heartbeats, and a job whose lease runs out is handed
 * on. The unique key makes asking twice for the same thing one job.
 */
const SCHEMA_V6 = `
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('quick', 'knowledge', 'environment', 'simulation', 'report')),
    resume INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'paused', 'cancelling', 'cancelled',
                                         'completed', 'partial', 'retrying', 'failed', 'expired')),
    idempotency_key TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL,
    not_before INTEGER NOT NULL,
    lease_owner TEXT, lease_expires_at INTEGER, heartbeat_at INTEGER,
    cancel_requested INTEGER NOT NULL DEFAULT 0, pause_requested INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, finished_at INTEGER,
    UNIQUE (project_id, idempotency_key)
  );
  CREATE INDEX IF NOT EXISTS jobs_claim ON jobs(state, not_before);
  CREATE INDEX IF NOT EXISTS jobs_project ON jobs(project_id, created_at);
`;

/**
 * Report Studio: one document per project, holding the people's work on a generated report. The row is
 * one JSON payload; `revision` is what a save compares, so that two people never overwrite each other.
 * The document is deleted with its project.
 */
const SCHEMA_V7 = `
  CREATE TABLE IF NOT EXISTS studio_documents (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('draft', 'in-review', 'changes-requested', 'approved')),
    updated_at TEXT NOT NULL,
    payload TEXT NOT NULL
  );
`;

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'projects, passages, events and messages',
    up: byDialect(SCHEMA_V1, PG_V1),
  },
  {
    version: 2,
    name: 'claim ledger, source conflicts and append-only audit log',
    up: byDialect(SCHEMA_V2, PG_V2),
  },
  {
    version: 3,
    name: 'project ownership for tenant isolation',
    up: (db) => {
      if (db.dialect === 'postgres') {
        db.exec(PG_V3);
        return;
      }
      // Existing projects were made by the single local user, so that is who they belong to. Adding
      // a column is not idempotent in SQLite, so check first: a half-applied step must be safe to retry.
      const present = new Set(
        db
          .prepare('PRAGMA table_info(projects)')
          .all()
          .map((row) => String((row as { name: unknown }).name)),
      );
      if (!present.has('tenant_id')) {
        db.exec("ALTER TABLE projects ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'local'");
      }
      if (!present.has('owner_id')) {
        db.exec("ALTER TABLE projects ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'local-user'");
      }
      db.exec('CREATE INDEX IF NOT EXISTS projects_tenant ON projects(tenant_id, created_at)');
    },
  },
  {
    version: 4,
    name: 'workspace and project membership',
    up: byDialect(SCHEMA_V4, PG_V4),
  },
  {
    version: 5,
    name: 'browser sign-in: login attempts and sessions',
    up: byDialect(SCHEMA_V5, PG_V5),
  },
  {
    version: 6,
    name: 'durable jobs: queue, leases and retries',
    up: byDialect(SCHEMA_V6, PG_V6),
  },
  {
    version: 7,
    name: 'report studio: documents',
    up: byDialect(SCHEMA_V7, PG_V7),
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
const swarmVersionRow = z.object({ version: z.number() });

/** Arbitrary, but fixed: the key of the advisory lock that keeps two starting instances from both migrating. */
const MIGRATION_LOCK = 727_001;

export function readSchemaVersion(database: SqlDatabase): number {
  if (database.dialect === 'postgres') {
    database.exec(PG_VERSION_TABLE);
    const row = database.prepare('SELECT version FROM swarm_schema WHERE id = 1').get();
    return row ? swarmVersionRow.parse(row).version : 0;
  }
  return versionRow.parse(database.prepare('PRAGMA user_version').get()).user_version;
}

function writeSchemaVersion(database: SqlDatabase, version: number): void {
  if (database.dialect === 'postgres') {
    database
      .prepare(
        `INSERT INTO swarm_schema (id, version, updated_at) VALUES (1, ?, ?)
         ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version, updated_at = EXCLUDED.updated_at`,
      )
      .run(version, new Date().toISOString());
    return;
  }
  database.exec(`PRAGMA user_version = ${Math.trunc(version)}`);
}

/**
 * Brings the database up to the latest schema, one transactional step at a time. A database that
 * is newer than this build is refused untouched. An existing SQLite file is copied before it is
 * upgraded (PostgreSQL has its own point-in-time restore), and a failed step rolls back, so there is
 * always a known-good state to return to. On PostgreSQL an advisory lock makes instances that start
 * together take turns, and the second finds nothing left to do.
 */
export function migrate(
  database: SqlDatabase,
  options: { path: string; migrations?: readonly Migration[] },
): MigrationReport {
  const postgres = database.dialect === 'postgres';
  if (postgres) database.exec(`SELECT pg_advisory_lock(${MIGRATION_LOCK})`);
  try {
    return migrateLocked(database, options);
  } finally {
    if (postgres) database.exec(`SELECT pg_advisory_unlock(${MIGRATION_LOCK})`);
  }
}

function migrateLocked(
  database: SqlDatabase,
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

  if (
    database.dialect === 'sqlite' &&
    from > 0 &&
    options.path !== ':memory:' &&
    existsSync(options.path)
  ) {
    database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    report.backup = backupBeforeUpgrade(options.path, from);
  }

  for (const migration of pending) {
    try {
      database.transaction(() => {
        migration.up(database);
        writeSchemaVersion(database, migration.version);
      });
    } catch (cause) {
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
