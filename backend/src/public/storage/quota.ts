import type { SqlDatabase } from '../../storage/sql.js';

/**
 * How much stored text a workspace holds: the payloads of its projects and of what hangs off them. It is what a
 * workspace's storage quota is measured in, and what the account page shows. `LENGTH` counts characters in SQLite and in
 * PostgreSQL alike, which is what text is limited by.
 */
export function storageBytes(database: SqlDatabase, tenantId: string): number {
  const total = (sql: string): number => Number(database.prepare(sql).get(tenantId)?.n ?? 0);
  const ofProjects = (table: string): number =>
    total(
      `SELECT CAST(COALESCE(SUM(LENGTH(c.payload)), 0) AS BIGINT) AS n
         FROM ${table} c JOIN projects p ON p.id = c.project_id WHERE p.tenant_id = ?`,
    );
  return (
    total(
      'SELECT CAST(COALESCE(SUM(LENGTH(payload)), 0) AS BIGINT) AS n FROM projects WHERE tenant_id = ?',
    ) +
    ofProjects('chunks') +
    ofProjects('messages') +
    ofProjects('studio_documents') +
    ofProjects('project_artifacts') +
    ofProjects('claim_records') +
    ofProjects('source_conflicts')
  );
}
