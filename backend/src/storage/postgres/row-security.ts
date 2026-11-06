import { AppError } from '../../errors.js';
import type { SqlDatabase } from '../sql.js';

/**
 * Row-level security for the public edition (docs/public/DESIGN.md, section 5). Nothing here runs in the pilot.
 *
 * Every table is in exactly one class. A table that is in none stops the server from starting, so that a table added
 * later cannot skip the policies by being forgotten.
 */

/** What decides whether a role may see a row. */
export type TableClass =
  /** The row names its workspace in this column. */
  | { kind: 'tenant'; column: string }
  /** The row belongs to a project, and so to the project's workspace. */
  | { kind: 'project' }
  /** Only the platform may touch it: no tenant-scoped code ever reads or writes it. */
  | { kind: 'system' }
  /** Readable for the projects of the tenant; written by the platform only; never updated or deleted. */
  | { kind: 'audit' }
  /** Holds no user data (a schema version). The runtime role is given no access at all. */
  | { kind: 'none' };

export const TABLE_CLASSES: Readonly<Record<string, TableClass>> = {
  projects: { kind: 'tenant', column: 'tenant_id' },
  workspace_members: { kind: 'tenant', column: 'tenant_id' },
  sessions: { kind: 'tenant', column: 'tenant_id' },
  public_users: { kind: 'tenant', column: 'workspace_id' },

  chunks: { kind: 'project' },
  events: { kind: 'project' },
  messages: { kind: 'project' },
  claim_records: { kind: 'project' },
  source_conflicts: { kind: 'project' },
  ledger_state: { kind: 'project' },
  project_members: { kind: 'project' },
  jobs: { kind: 'project' },
  studio_documents: { kind: 'project' },
  project_usage: { kind: 'project' },
  project_artifacts: { kind: 'project' },
  project_funding: { kind: 'project' },

  audit_events: { kind: 'audit' },

  login_attempts: { kind: 'system' },
  public_login_attempts: { kind: 'system' },
  public_settings: { kind: 'system' },
  usage_daily: { kind: 'system' },
  usage_lifetime: { kind: 'system' },
  usage_reservations: { kind: 'system' },
  usage_blocked: { kind: 'system' },
  signup_log: { kind: 'system' },
  deleted_accounts: { kind: 'system' },

  swarm_schema: { kind: 'none' },
  public_schema: { kind: 'none' },
};

const ROLE_NAME = /^[a-z][a-z0-9_]{0,62}$/u;
const POLICY = 'swarm_scope';
/** Held for the length of the setup, so that two instances starting together do not race on the same policies. */
const SETUP_LOCK = 7_219_001;

const quote = (identifier: string): string => `"${identifier.replace(/"/gu, '""')}"`;

const TENANT = `current_setting('swarm.tenant', true)`;
const SYSTEM = `current_setting('swarm.system', true) = 'on'`;
const IN_TENANT = (column: string, alias = ''): string =>
  `(${alias}${quote(column)} = ${TENANT} AND ${TENANT} <> '')`;
const OF_PROJECT = (table: string): string =>
  `EXISTS (SELECT 1 FROM projects p WHERE p.id = ${quote(table)}.project_id AND ${IN_TENANT('tenant_id', 'p.')})`;

/** The tables of the schema the connection is using, other than the ones a view or a partition would add. */
export function tablesOf(database: SqlDatabase): string[] {
  return database
    .prepare(
      `SELECT table_name AS name FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name`,
    )
    .all()
    .map((row) => String(row.name));
}

/** Tables that exist and are in no class. */
export function unclassifiedTables(database: SqlDatabase): string[] {
  return tablesOf(database).filter((name) => !(name in TABLE_CLASSES));
}

/**
 * Makes the database ready to be used as the runtime role: creates the role if it does not exist (no login, no
 * superuser, no `BYPASSRLS`), grants it what the application needs and nothing more, and (re)creates one policy per
 * table. Idempotent, run at every start, as the connection's own role (the owner), which migrates and is never the
 * role that the policies are enforced on.
 *
 * Row security is enabled but **not forced**: the owner has to be able to migrate data, and the runtime role is never the
 * owner, so the policies bind it all the same. `checkRowSecurity` proves that on the real database.
 */
export function applyRowSecurity(database: SqlDatabase, role: string): void {
  if (database.dialect !== 'postgres') throw new Error('Row-level security needs PostgreSQL.');
  if (!ROLE_NAME.test(role)) throw new Error('PUBLIC_DB_RUNTIME_ROLE is not a valid role name.');
  const unknown = unclassifiedTables(database);
  if (unknown.length > 0) {
    throw new AppError(
      500,
      'ROW_SECURITY_UNCLASSIFIED',
      `These tables have no row-security class: ${unknown.join(', ')}.`,
    );
  }
  const r = quote(role);
  const schema = quote(String(database.prepare('SELECT current_schema() AS s').get()?.s));
  database.transaction(() => {
    database.prepare('SELECT pg_advisory_xact_lock(?)').get(SETUP_LOCK);
    database.exec(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
           CREATE ROLE ${r} NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
         END IF;
       END $$;
       GRANT ${r} TO CURRENT_USER;
       GRANT USAGE ON SCHEMA ${schema} TO ${r};
       GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO ${r};`,
    );
    for (const name of tablesOf(database)) {
      const table = TABLE_CLASSES[name]!;
      const t = quote(name);
      if (table.kind === 'none') {
        database.exec(`REVOKE ALL ON ${t} FROM ${r}`);
        continue;
      }
      database.exec(
        table.kind === 'audit'
          ? `GRANT SELECT, INSERT ON ${t} TO ${r}; REVOKE UPDATE, DELETE, TRUNCATE ON ${t} FROM ${r}`
          : `GRANT SELECT, INSERT, UPDATE, DELETE ON ${t} TO ${r}`,
      );
      database.exec(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
      database.exec(`DROP POLICY IF EXISTS ${POLICY} ON ${t}`);
      database.exec(`DROP POLICY IF EXISTS ${POLICY}_read ON ${t}`);
      database.exec(`DROP POLICY IF EXISTS ${POLICY}_write ON ${t}`);
      switch (table.kind) {
        case 'tenant': {
          const check = `${SYSTEM} OR ${IN_TENANT(table.column)}`;
          database.exec(
            `CREATE POLICY ${POLICY} ON ${t} FOR ALL TO ${r} USING (${check}) WITH CHECK (${check})`,
          );
          break;
        }
        case 'project': {
          const check = `${SYSTEM} OR ${OF_PROJECT(name)}`;
          database.exec(
            `CREATE POLICY ${POLICY} ON ${t} FOR ALL TO ${r} USING (${check}) WITH CHECK (${check})`,
          );
          break;
        }
        case 'system':
          database.exec(
            `CREATE POLICY ${POLICY} ON ${t} FOR ALL TO ${r} USING (${SYSTEM}) WITH CHECK (${SYSTEM})`,
          );
          break;
        case 'audit':
          database.exec(
            `CREATE POLICY ${POLICY}_read ON ${t} FOR SELECT TO ${r}
               USING (${SYSTEM} OR (project_id IS NOT NULL AND ${OF_PROJECT(name)}))`,
          );
          database.exec(
            `CREATE POLICY ${POLICY}_write ON ${t} FOR INSERT TO ${r} WITH CHECK (${SYSTEM})`,
          );
          break;
      }
    }
  });
}

export interface RowSecurityReport {
  ok: boolean;
  /** What is wrong, in words that can be shown to the operator. */
  problems: string[];
}

/**
 * What must be true on the real database before the first request is served. Read with the runtime role, so that it
 * reports on the role the application will actually be. A failure stops the server: it would otherwise run with
 * isolation that is not in force.
 */
export function checkRowSecurity(database: SqlDatabase, role: string): RowSecurityReport {
  const problems: string[] = [];
  const asRole = database.asSystem(() =>
    database
      .prepare(
        `SELECT rolsuper, rolbypassrls, current_user AS who FROM pg_roles WHERE rolname = current_user`,
      )
      .get(),
  );
  if (!asRole) problems.push('The runtime role could not be read.');
  else {
    if (String(asRole.who) !== role)
      problems.push(`The session is running as "${String(asRole.who)}", not "${role}".`);
    if (asRole.rolsuper === true)
      problems.push(`The role "${role}" is a superuser, which ignores every policy.`);
    if (asRole.rolbypassrls === true)
      problems.push(`The role "${role}" has BYPASSRLS, which ignores every policy.`);
  }
  const tables = database.asSystem(() =>
    database
      .prepare(
        `SELECT c.relname AS name, c.relrowsecurity AS enabled, pg_get_userbyid(c.relowner) AS owner,
                (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = current_schema() AND c.relkind = 'r'`,
      )
      .all(),
  );
  for (const row of tables) {
    const name = String(row.name);
    const table = TABLE_CLASSES[name];
    if (!table) {
      problems.push(`The table "${name}" has no row-security class.`);
      continue;
    }
    if (table.kind === 'none') continue;
    if (row.enabled !== true) problems.push(`Row security is not enabled on "${name}".`);
    if (Number(row.policies) < 1) problems.push(`The table "${name}" has no policy.`);
    if (String(row.owner) === role)
      problems.push(`The role "${role}" owns "${name}", so the policies would not bind it.`);
  }
  for (const name of Object.keys(TABLE_CLASSES)) {
    const table = TABLE_CLASSES[name]!;
    if (table.kind !== 'none' && !tables.some((row) => String(row.name) === name)) {
      problems.push(`The table "${name}" is missing.`);
    }
  }
  // The behaviour itself, not only its settings: a tenant that owns nothing must see nothing.
  const visible = database.asTenant('w_row_security_probe', () =>
    Number(database.prepare('SELECT count(*) AS n FROM projects').get()?.n ?? 0),
  );
  if (visible !== 0)
    problems.push('A workspace that owns nothing can see projects: the policies are not in force.');
  return { ok: problems.length === 0, problems };
}
