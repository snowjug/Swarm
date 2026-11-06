import type { SqlDatabase } from '../../storage/sql.js';

/**
 * The public edition's tables. They are a **separate migration track**, with a version row of their own (`public_schema`),
 * and not a step of the pilot's `MIGRATIONS`: that keeps the pilot's schema version, and with it the pilot's release
 * and roll-back story (`docs/production/release-process.md`), exactly as they were. A pilot database never gets one of
 * these tables. Every statement is idempotent, written once for both dialects (`BIGINT` is a 64-bit integer in both).
 */

export interface PublicMigration {
  version: number;
  name: string;
  sql: string;
}

const PUBLIC_V1 = `
  CREATE TABLE IF NOT EXISTS public_users (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL,
    subject TEXT NOT NULL,
    email TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    last_login_at BIGINT NOT NULL,
    disabled INTEGER NOT NULL DEFAULT 0,
    disabled_reason TEXT,
    UNIQUE (provider, subject)
  );
  CREATE INDEX IF NOT EXISTS public_users_by_email ON public_users (email);

  CREATE TABLE IF NOT EXISTS public_login_attempts (
    state_hash TEXT PRIMARY KEY,
    binding_hash TEXT NOT NULL,
    provider TEXT NOT NULL,
    nonce TEXT NOT NULL,
    verifier TEXT NOT NULL,
    return_to TEXT NOT NULL,
    created_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS public_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS usage_daily (
    day TEXT NOT NULL,
    subject TEXT NOT NULL,
    calls BIGINT NOT NULL DEFAULT 0 CHECK (calls >= 0),
    input_tokens BIGINT NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
    output_tokens BIGINT NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
    reasoning_tokens BIGINT NOT NULL DEFAULT 0 CHECK (reasoning_tokens >= 0),
    reserved_tokens BIGINT NOT NULL DEFAULT 0 CHECK (reserved_tokens >= 0),
    cost_micro_usd BIGINT NOT NULL DEFAULT 0 CHECK (cost_micro_usd >= 0),
    reserved_micro_usd BIGINT NOT NULL DEFAULT 0 CHECK (reserved_micro_usd >= 0),
    reserved_calls BIGINT NOT NULL DEFAULT 0 CHECK (reserved_calls >= 0),
    PRIMARY KEY (day, subject)
  );

  CREATE TABLE IF NOT EXISTS usage_lifetime (
    subject TEXT PRIMARY KEY,
    tokens BIGINT NOT NULL DEFAULT 0 CHECK (tokens >= 0),
    reserved_tokens BIGINT NOT NULL DEFAULT 0 CHECK (reserved_tokens >= 0),
    calls BIGINT NOT NULL DEFAULT 0 CHECK (calls >= 0),
    updated_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS usage_reservations (
    id TEXT PRIMARY KEY,
    day TEXT NOT NULL,
    subject TEXT NOT NULL,
    tokens BIGINT NOT NULL,
    micro_usd BIGINT NOT NULL,
    created_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS usage_reservations_by_time ON usage_reservations (created_at);

  CREATE TABLE IF NOT EXISTS usage_blocked (
    day TEXT NOT NULL,
    reason TEXT NOT NULL,
    count BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (day, reason)
  );

  CREATE TABLE IF NOT EXISTS signup_log (
    id TEXT PRIMARY KEY,
    ip_hash TEXT NOT NULL,
    created_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS signup_log_by_time ON signup_log (created_at);

  CREATE TABLE IF NOT EXISTS deleted_accounts (
    key_hash TEXT PRIMARY KEY,
    lifetime_tokens BIGINT NOT NULL DEFAULT 0,
    deleted_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS project_funding (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    funding TEXT NOT NULL CHECK (funding IN ('free', 'byok')),
    updated_at BIGINT NOT NULL
  );
`;

export const PUBLIC_MIGRATIONS: readonly PublicMigration[] = [
  { version: 1, name: 'public edition: accounts, usage ledger, settings', sql: PUBLIC_V1 },
];

export const LATEST_PUBLIC_SCHEMA_VERSION =
  PUBLIC_MIGRATIONS[PUBLIC_MIGRATIONS.length - 1]!.version;

/** Brings the public tables up to date. Refuses a database that a newer public edition has changed. */
export function migratePublic(database: SqlDatabase): number {
  database.exec(
    `CREATE TABLE IF NOT EXISTS public_schema (
       id INTEGER PRIMARY KEY CHECK (id = 1),
       version INTEGER NOT NULL,
       updated_at BIGINT NOT NULL
     )`,
  );
  const row = database.prepare('SELECT version FROM public_schema WHERE id = 1').get();
  const current = row ? Number(row.version) : 0;
  if (current > LATEST_PUBLIC_SCHEMA_VERSION) {
    throw new Error('This database requires a newer public edition of Swarm.');
  }
  for (const migration of PUBLIC_MIGRATIONS) {
    if (migration.version <= current) continue;
    database.transaction(() => {
      database.exec(migration.sql);
      database
        .prepare(
          `INSERT INTO public_schema (id, version, updated_at) VALUES (1, ?, ?)
           ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version, updated_at = EXCLUDED.updated_at`,
        )
        .run(migration.version, Date.now());
    });
  }
  return LATEST_PUBLIC_SCHEMA_VERSION;
}
