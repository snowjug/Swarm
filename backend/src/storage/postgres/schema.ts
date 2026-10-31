/**
 * The PostgreSQL form of each migration in `../migrations.ts`, at the same version numbers, so that
 * "schema version 5" means the same tables on either database. Written out rather than translated:
 * identity columns, plpgsql triggers and `ADD COLUMN IF NOT EXISTS` have no SQLite equivalent, and a
 * reviewer should be able to read the DDL that runs. Every statement is idempotent.
 *
 * Whole numbers are BIGINT because SQLite's INTEGER is 64-bit and some columns hold epoch
 * milliseconds. Timestamps that SQLite keeps as ISO text stay text, so the stores need no
 * conversion in either direction.
 */

export const PG_V1 = `
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    status TEXT NOT NULL, payload TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chunks (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (project_id, id)
  );
  CREATE TABLE IF NOT EXISTS events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    stage TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS events_project ON events(project_id, id);
  CREATE TABLE IF NOT EXISTS messages (
    seq BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, id TEXT NOT NULL UNIQUE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    target TEXT NOT NULL, payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS messages_project ON messages(project_id, target, seq);
`;

/**
 * The audit log is append-only: rows cannot be updated, deleted or truncated, by the application or
 * by anyone using its credentials, short of dropping the trigger (which needs ownership of the table).
 */
export const PG_V2 = `
  CREATE TABLE IF NOT EXISTS claim_records (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    id TEXT NOT NULL, version BIGINT NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL,
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
    seq BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
    target_type TEXT NOT NULL, target_id TEXT NOT NULL, project_id TEXT,
    detail TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS audit_project ON audit_events(project_id, seq);
  CREATE OR REPLACE FUNCTION audit_events_append_only() RETURNS trigger AS $$
  BEGIN
    RAISE EXCEPTION 'audit events are append-only';
  END;
  $$ LANGUAGE plpgsql;
  DROP TRIGGER IF EXISTS audit_events_no_update ON audit_events;
  CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();
  DROP TRIGGER IF EXISTS audit_events_no_delete ON audit_events;
  CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();
  DROP TRIGGER IF EXISTS audit_events_no_truncate ON audit_events;
  CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
    FOR EACH STATEMENT EXECUTE FUNCTION audit_events_append_only();
`;

export const PG_V3 = `
  ALTER TABLE projects ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'local';
  ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT 'local-user';
  CREATE INDEX IF NOT EXISTS projects_tenant ON projects(tenant_id, created_at);
`;

export const PG_V4 = `
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
  INSERT INTO project_members (project_id, principal_id, role, added_by, added_at)
    SELECT id, owner_id, 'lead', 'migration', created_at FROM projects
    ON CONFLICT DO NOTHING;
  INSERT INTO workspace_members (tenant_id, principal_id, role, added_by, added_at)
    SELECT tenant_id, owner_id, 'member', 'migration', MIN(created_at) FROM projects
    GROUP BY tenant_id, owner_id
    ON CONFLICT DO NOTHING;
`;

export const PG_V5 = `
  CREATE TABLE IF NOT EXISTS login_attempts (
    state_hash TEXT PRIMARY KEY, binding_hash TEXT NOT NULL, nonce TEXT NOT NULL,
    verifier TEXT NOT NULL, return_to TEXT NOT NULL, created_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS login_attempts_created ON login_attempts(created_at);
  CREATE TABLE IF NOT EXISTS sessions (
    id_hash TEXT PRIMARY KEY, principal_id TEXT NOT NULL, tenant_id TEXT NOT NULL,
    platform_admin INTEGER NOT NULL, bootstrap_admin INTEGER NOT NULL,
    created_at BIGINT NOT NULL, last_seen_at BIGINT NOT NULL, expires_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_principal ON sessions(tenant_id, principal_id);
  CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);
`;

export const PG_V6 = `
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('quick', 'knowledge', 'environment', 'simulation', 'report')),
    resume INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'paused', 'cancelling', 'cancelled',
                                         'completed', 'partial', 'retrying', 'failed', 'expired')),
    idempotency_key TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL,
    not_before BIGINT NOT NULL,
    lease_owner TEXT, lease_expires_at BIGINT, heartbeat_at BIGINT,
    cancel_requested INTEGER NOT NULL DEFAULT 0, pause_requested INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, finished_at BIGINT,
    UNIQUE (project_id, idempotency_key)
  );
  CREATE INDEX IF NOT EXISTS jobs_claim ON jobs(state, not_before);
  CREATE INDEX IF NOT EXISTS jobs_project ON jobs(project_id, created_at);
`;

export const PG_V7 = `
  CREATE TABLE IF NOT EXISTS studio_documents (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('draft', 'in-review', 'changes-requested', 'approved')),
    updated_at TEXT NOT NULL,
    payload TEXT NOT NULL
  );
`;

/** Where the schema version is kept: SQLite has `PRAGMA user_version`, PostgreSQL has no such thing. */
export const PG_VERSION_TABLE = `
  CREATE TABLE IF NOT EXISTS swarm_schema (
    id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL, updated_at TEXT NOT NULL
  )
`;
