/**
 * Rehearses losing a database and getting it back: the data is backed up into a SQLite file, a new
 * database is made from that file alone, and what came back is checked against what went in (every
 * table by digest, the audit chain, every project opened as the application opens it, and the next
 * audit entry following the last). Run it before a restore is needed, and after any change to storage.
 *
 *   npm run db:drill -- --from ./data/swarm-lab.sqlite
 *   npm run db:drill -- --from postgres://swarm@host:5432/swarm
 *   npm run db:drill -- --from ./data/swarm-lab.sqlite --keep ./drill
 *
 * The database it is pointed at is only read. A SQLite file is read as a consistent snapshot, so it
 * may be in use; a PostgreSQL server is read as it is, so point it at a restored copy or a quiet
 * moment. `--from-entra` authenticates to PostgreSQL with a Microsoft Entra token instead of a
 * password. The scratch databases hold a copy of the data and are deleted, unless `--keep` names a
 * folder for them. The target is never printed, because a URL can hold a password.
 *
 * This rehearses the logical path (SQLite and PostgreSQL through `db:copy`). It does not rehearse
 * restoring a hosted PostgreSQL server to a point in time, which is the platform's own and has to be
 * rehearsed where it runs.
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { rehearseRestoreOf } from '../../backend/src/storage/drill.js';
import { kindOf } from '../../backend/src/storage/open.js';

function parse(argv: string[]) {
  const options = { from: '', fromEntra: false, keep: '' };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--from') options.from = argv[++index] ?? '';
    else if (argument === '--from-entra') options.fromEntra = true;
    else if (argument === '--keep') options.keep = argv[++index] ?? '';
    else throw new Error(`Unknown option ${argument}. See the top of scripts/db/drill.ts.`);
  }
  if (!options.from) throw new Error('Give --from, the database to rehearse on.');
  return options;
}

const seconds = (milliseconds: number): string => `${(milliseconds / 1000).toFixed(2)} s`;
const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

const scratch = mkdtempSync(join(tmpdir(), 'swarm-drill-'));
let failed = false;
try {
  const options = parse(process.argv.slice(2));
  const kind = kindOf(options.from) === 'sqlite' ? 'a SQLite file' : 'a PostgreSQL database';
  const report = rehearseRestoreOf(options.from, scratch, { entra: options.fromEntra });
  const tables = Object.keys(report.rows).length;
  const rows = Object.values(report.rows).reduce((sum, count) => sum + count, 0);

  console.log(`Rehearsed a restore of ${kind} at schema version ${report.schemaVersion}.`);
  console.log(
    `  backup    ${seconds(report.milliseconds.backup).padStart(8)}   ${rows.toLocaleString('en-GB')} rows in ${plural(tables, 'table')}`,
  );
  console.log(`  restore   ${seconds(report.milliseconds.restore).padStart(8)}`);
  console.log(
    `  verify    ${seconds(report.milliseconds.verify).padStart(8)}   ${tables - report.differing.length} of ${tables} tables identical; ${plural(report.projectsRead, 'project')} opened`,
  );
  if (report.differing.length > 0) {
    console.log(`DIFFERENT after the restore: ${report.differing.join(', ')}.`);
  }
  console.log(`  audit chain ${report.auditChainIntact ? 'verifies' : 'DOES NOT VERIFY'}`);
  console.log(
    `  next audit entry ${report.carriesOn ? 'follows the last' : 'DOES NOT FOLLOW THE LAST'}`,
  );
  failed = report.differing.length > 0 || !report.auditChainIntact || !report.carriesOn;
  console.log(
    failed
      ? 'The restore is NOT exact. Do not rely on this backup path until that is understood.'
      : 'The restore is exact.',
  );
  if (options.keep) {
    const destination = resolve(options.keep);
    mkdirSync(destination, { recursive: true, mode: 0o700 });
    cpSync(scratch, destination, { recursive: true });
    console.log('The scratch databases were kept. They hold a copy of the data: delete them.');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  failed = true;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
