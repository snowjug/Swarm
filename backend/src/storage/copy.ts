import { AppError } from '../errors.js';
import { AuditLog } from './audit.js';
import type { SqlDatabase, SqlValue } from './sql.js';

/**
 * Copies everything that is data (not sign-in state, which is meant to be lost) from one database
 * to another, in either direction between SQLite and PostgreSQL. It is the one path for moving an
 * existing installation onto PostgreSQL, for taking a logical backup, and for restoring one.
 *
 * Tables are listed in the order that satisfies their foreign keys. The identity of an event or a
 * message is only an ordering, so it is regenerated; the sequence number of an audit entry is kept
 * so that the log reads the same on both sides.
 */
const TABLES = [
  { name: 'projects', order: 'created_at, id', skip: [] },
  { name: 'chunks', order: 'project_id, id', skip: [] },
  { name: 'events', order: 'id', skip: ['id'] },
  { name: 'messages', order: 'seq', skip: ['seq'] },
  { name: 'claim_records', order: 'project_id, id', skip: [] },
  { name: 'source_conflicts', order: 'project_id, id', skip: [] },
  { name: 'ledger_state', order: 'project_id', skip: [] },
  { name: 'workspace_members', order: 'tenant_id, principal_id', skip: [] },
  { name: 'project_members', order: 'project_id, principal_id', skip: [] },
  { name: 'audit_events', order: 'seq', skip: [], keepIdentity: true },
] as const;

export interface CopyReport {
  /** Rows read from the source and written to the destination, by table. */
  tables: Record<string, number>;
  /** Whether the audit chain verified in the destination. */
  auditChainIntact: boolean;
}

const countOf = (database: SqlDatabase, table: string): number =>
  Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count ?? 0);

/**
 * Both databases must already be at the same schema version (opening a `Repository` does that). The
 * destination must be empty, so a copy can never merge two histories or overwrite one. The writes are
 * one transaction, so a failure leaves the destination as it was.
 */
export function copyDatabase(from: SqlDatabase, to: SqlDatabase): CopyReport {
  for (const { name } of TABLES) {
    if (countOf(to, name) > 0) {
      throw new AppError(
        409,
        'DESTINATION_NOT_EMPTY',
        `The destination already holds data (${name}). Copy into an empty database.`,
      );
    }
  }
  const report: CopyReport = { tables: {}, auditChainIntact: false };
  to.transaction(() => {
    for (const table of TABLES) {
      const rows = from.prepare(`SELECT * FROM ${table.name} ORDER BY ${table.order}`).all();
      report.tables[table.name] = rows.length;
      const first = rows[0];
      if (!first) continue;
      const columns = Object.keys(first).filter(
        (column) => !(table.skip as readonly string[]).includes(column),
      );
      const keepIdentity = 'keepIdentity' in table && table.keepIdentity;
      // PostgreSQL refuses an explicit value for an identity column unless told it is meant.
      const override = keepIdentity && to.dialect === 'postgres' ? ' OVERRIDING SYSTEM VALUE' : '';
      const insert = to.prepare(
        `INSERT INTO ${table.name} (${columns.join(', ')})${override} VALUES (${columns
          .map(() => '?')
          .join(', ')})`,
      );
      for (const row of rows) insert.run(...columns.map((column) => row[column] as SqlValue));
    }
    if (to.dialect === 'postgres') {
      // The next audit entry must follow the last one that was copied.
      to.prepare(
        `SELECT setval(pg_get_serial_sequence('audit_events', 'seq'),
                       COALESCE((SELECT MAX(seq) FROM audit_events), 1),
                       (SELECT COUNT(*) > 0 FROM audit_events))`,
      ).get();
    }
    for (const { name } of TABLES) {
      const copied = countOf(to, name);
      if (copied !== report.tables[name]) {
        throw new AppError(
          500,
          'COPY_MISMATCH',
          `${name}: ${report.tables[name]} rows were read and ${copied} are present. Nothing was kept.`,
        );
      }
    }
    report.auditChainIntact = new AuditLog(to).verify().ok;
    if (!report.auditChainIntact) {
      throw new AppError(
        500,
        'COPY_AUDIT_CHAIN',
        'The audit chain does not verify in the destination. Nothing was kept.',
      );
    }
  });
  return report;
}
