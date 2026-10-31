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
export const TABLES = [
  { name: 'projects', order: 'created_at, id', skip: [] },
  { name: 'chunks', order: 'project_id, id', skip: [] },
  { name: 'events', order: 'id', skip: ['id'] },
  { name: 'messages', order: 'seq', skip: ['seq'] },
  { name: 'claim_records', order: 'project_id, id', skip: [] },
  { name: 'source_conflicts', order: 'project_id, id', skip: [] },
  { name: 'ledger_state', order: 'project_id', skip: [] },
  { name: 'studio_documents', order: 'project_id', skip: [] },
  { name: 'project_usage', order: 'project_id', skip: [] },
  { name: 'project_artifacts', order: 'project_id, kind, artifact_key', skip: [] },
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

/** Copies one table, and says how many rows it held. */
function copyTable(from: SqlDatabase, to: SqlDatabase, table: (typeof TABLES)[number]): number {
  const rows = from.prepare(`SELECT * FROM ${table.name} ORDER BY ${table.order}`).all();
  const first = rows[0];
  if (!first) return 0;
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
  return rows.length;
}

/**
 * Both databases must already be at the same schema version (opening a `Repository` does that). The
 * destination must be empty, so a copy can never merge two histories or overwrite one. The writes are
 * one transaction, so a failure leaves the destination as it was.
 *
 * Every table is read from one snapshot of the source, so a source that is being written to is copied
 * as it was at one moment and never as half of a change: a project without the actors that were added
 * with it, or one that was deleted after its row was read and is left without anything else. What is
 * written to the source after that moment is not in the copy. Row counts and the audit chain cannot
 * show the difference, since a copy can be complete in both and still be of no moment that ever was.
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
    // Inside the transaction of the destination, the order that a connection shared by both (the
    // in-process PostgreSQL of the tests) can follow. A copy that is tried again reads a new snapshot.
    from.readSnapshot(() => {
      for (const table of TABLES) report.tables[table.name] = copyTable(from, to, table);
    });
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
