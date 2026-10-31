import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import { AppError } from '../errors.js';
import { AuditLog } from './audit.js';
import { copyDatabase, TABLES } from './copy.js';
import { LATEST_SCHEMA_VERSION, migrate, readSchemaVersion } from './migrations.js';
import { kindOf, openDatabase } from './open.js';
import { Repository } from './repository.js';
import type { SqlDatabase } from './sql.js';

type CopiedTable = (typeof TABLES)[number];

/** One cell as text, so that the same value is the same in SQLite and in PostgreSQL. */
const cell = (value: unknown): string =>
  value === null || value === undefined
    ? '\u0000'
    : `${typeof value === 'string' ? 's' : 'n'}${String(value)}`;

/**
 * What one table holds, as a digest: the same rows give the same digest in either database. The
 * identities that are only an ordering (and are made afresh in a copy) are left out.
 */
export function tableDigest(database: SqlDatabase, table: CopiedTable): string {
  const hash = createHash('sha256');
  const skipped: readonly string[] = table.skip;
  for (const row of database.prepare(`SELECT * FROM ${table.name} ORDER BY ${table.order}`).all()) {
    const cells = Object.keys(row)
      .filter((column) => !skipped.includes(column))
      .sort()
      .map((column) => `${column}=${cell(row[column])}`);
    hash.update(`${cells.join('\u001f')}\u001e`);
  }
  return hash.digest('hex');
}

/** The tables whose digests differ. Empty when the two databases hold the same data. */
export function differingTables(
  expected: Record<string, string>,
  actual: Record<string, string>,
): string[] {
  return TABLES.map((table) => table.name).filter((name) => expected[name] !== actual[name]);
}

const digestsOf = (database: SqlDatabase): Record<string, string> =>
  Object.fromEntries(TABLES.map((table) => [table.name, tableDigest(database, table)]));

export interface RestoreRehearsal {
  schemaVersion: number;
  /** Rows backed up, by table. */
  rows: Record<string, number>;
  /** Tables whose contents are not the same after the restore. Empty when the restore is exact. */
  differing: string[];
  auditChainIntact: boolean;
  /** Projects the restored database opened and read in full, as the application reads them. */
  projectsRead: number;
  /** Whether the restored database took a new audit entry and the chain still verified. */
  carriesOn: boolean;
  milliseconds: { backup: number; restore: number; verify: number };
}

export interface RehearsalOptions {
  /** For tests: damage the restored database, to show that the check notices. */
  afterRestore?: (restored: SqlDatabase) => void;
}

/**
 * Rehearses losing a database and getting it back. The data is backed up into a SQLite file, a new
 * database is made from that file, and the new database is checked against the old: every table
 * holds the same rows (by digest, so a changed cell is noticed, not only a missing row), the audit
 * chain verifies, the application can open every project, and the next audit entry follows the last.
 *
 * It only reads `source` and writes inside `directory`. The source must be at this release's schema
 * version, because a rehearsal that upgraded a live database would be a change, not a rehearsal.
 */
export function rehearseRestore(
  source: SqlDatabase,
  directory: string,
  options: RehearsalOptions = {},
): RestoreRehearsal {
  const schemaVersion = readSchemaVersion(source);
  if (schemaVersion !== LATEST_SCHEMA_VERSION) {
    throw new AppError(
      409,
      'DRILL_SCHEMA',
      `The database is at schema version ${schemaVersion} and this release is at ${LATEST_SCHEMA_VERSION}. Run the rehearsal with the release that wrote it, or start this release on a copy first.`,
    );
  }
  const backupPath = join(directory, 'backup.sqlite');
  const restoredPath = join(directory, 'restored.sqlite');

  let mark = performance.now();
  const expected = digestsOf(source);
  const backup = openDatabase(backupPath);
  let rows: Record<string, number>;
  try {
    migrate(backup, { path: backupPath });
    rows = copyDatabase(source, backup).tables;
  } finally {
    backup.close();
  }
  const backupMs = performance.now() - mark;

  // The database is "lost": what is restored is made from the backup file alone.
  mark = performance.now();
  const backedUp = openDatabase(backupPath);
  const restored = openDatabase(restoredPath);
  try {
    migrate(backedUp, { path: backupPath });
    migrate(restored, { path: restoredPath });
    copyDatabase(backedUp, restored);
    options.afterRestore?.(restored);
  } finally {
    backedUp.close();
    restored.close();
  }
  const restoreMs = performance.now() - mark;

  mark = performance.now();
  const inspected = openDatabase(restoredPath);
  let differing: string[];
  let auditChainIntact: boolean;
  let projectIds: string[];
  try {
    differing = differingTables(expected, digestsOf(inspected));
    auditChainIntact = new AuditLog(inspected).verify().ok;
    projectIds = inspected
      .prepare('SELECT id FROM projects ORDER BY created_at, id')
      .all()
      .map((row) => String(row.id));
  } finally {
    inspected.close();
  }
  const application = new Repository(restoredPath);
  let projectsRead = 0;
  let carriesOn = false;
  try {
    for (const id of projectIds) {
      application.get(id);
      application.chunks(id);
      application.studio.get(id);
      projectsRead++;
    }
    const last = application.audit.list({ limit: 1 }).at(-1)?.seq ?? 0;
    const next = application.audit.record({
      actor: 'restore-rehearsal',
      action: 'rehearsal.checked',
      targetType: 'database',
      targetId: 'restored',
    });
    carriesOn = next.seq === last + 1 && application.audit.verify().ok;
  } finally {
    application.close();
  }
  const verifyMs = performance.now() - mark;

  return {
    schemaVersion,
    rows,
    differing,
    auditChainIntact,
    projectsRead,
    carriesOn,
    milliseconds: { backup: backupMs, restore: restoreMs, verify: verifyMs },
  };
}

/**
 * Rehearses on whatever `target` names. A SQLite file is read through `VACUUM INTO`, which makes a
 * consistent snapshot of a database that is in use (including what is still in its write-ahead log)
 * without changing it, and the rehearsal runs on the snapshot. A PostgreSQL target is only read.
 */
export function rehearseRestoreOf(
  target: string,
  directory: string,
  options: RehearsalOptions & { entra?: boolean } = {},
): RestoreRehearsal {
  if (kindOf(target) !== 'sqlite') {
    const source = openDatabase(target, { entra: options.entra === true });
    try {
      return rehearseRestore(source, directory, options);
    } finally {
      source.close();
    }
  }
  if (target === ':memory:') {
    throw new AppError(400, 'DRILL_TARGET', 'Name a database file or a PostgreSQL server.');
  }
  const snapshotPath = join(directory, 'source.sqlite');
  const live = new DatabaseSync(target, { readOnly: true });
  try {
    live.prepare('VACUUM INTO ?').run(snapshotPath);
  } finally {
    live.close();
  }
  const snapshot = openDatabase(snapshotPath);
  try {
    // A database from an earlier release is upgraded here, in the snapshot, which also shows that
    // it can be.
    migrate(snapshot, { path: snapshotPath });
    return rehearseRestore(snapshot, directory, options);
  } finally {
    snapshot.close();
  }
}
