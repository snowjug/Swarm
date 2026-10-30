/**
 * Copies the data of one Swarm database into another: SQLite to PostgreSQL to move an existing
 * installation, PostgreSQL to a SQLite file to take a logical backup, and the reverse to restore it.
 *
 *   npm run db:copy -- --from ./data/swarm-lab.sqlite --to postgres://swarm@host:5432/swarm
 *   npm run db:copy -- --from postgres://swarm@host:5432/swarm --to ./backup/swarm.sqlite
 *
 * The destination must be empty; the copy is one transaction and is checked (row counts, and the
 * audit chain) before it is kept. A PostgreSQL password comes from the URL or from PGPASSWORD, and
 * `--from-entra` / `--to-entra` authenticate with a Microsoft Entra token instead. Targets are
 * never printed, because a URL can hold a password.
 */
import { copyDatabase } from '../../backend/src/storage/copy.js';
import { migrate } from '../../backend/src/storage/migrations.js';
import { kindOf, openDatabase } from '../../backend/src/storage/open.js';

function parse(argv: string[]) {
  const options = { from: '', to: '', fromEntra: false, toEntra: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--from') options.from = argv[++index] ?? '';
    else if (argument === '--to') options.to = argv[++index] ?? '';
    else if (argument === '--from-entra') options.fromEntra = true;
    else if (argument === '--to-entra') options.toEntra = true;
    else throw new Error(`Unknown option ${argument}. See the top of scripts/db/copy.ts.`);
  }
  if (!options.from || !options.to) throw new Error('Give --from and --to.');
  return options;
}

const describeKind = (target: string) =>
  kindOf(target) === 'sqlite' ? 'a SQLite file' : 'a PostgreSQL database';

try {
  const options = parse(process.argv.slice(2));
  const source = openDatabase(options.from, { entra: options.fromEntra });
  const destination = openDatabase(options.to, { entra: options.toEntra });
  try {
    migrate(source, { path: options.from });
    migrate(destination, { path: options.to });
    console.log(`Copying ${describeKind(options.from)} into ${describeKind(options.to)}...`);
    const report = copyDatabase(source, destination);
    for (const [table, rows] of Object.entries(report.tables)) {
      console.log(`  ${table.padEnd(18)} ${rows}`);
    }
    console.log(
      `Done. Row counts match and the audit chain ${report.auditChainIntact ? 'verifies' : 'DOES NOT VERIFY'}.`,
    );
  } finally {
    source.close();
    destination.close();
  }
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
