import type { EditionStorage } from '../../storage/repository.js';
import { PostgresDatabase } from '../../storage/postgres/database.js';
import { applyRowSecurity, checkRowSecurity } from '../../storage/postgres/row-security.js';
import type { PublicConfig } from '../config.js';
import { migratePublic } from './migrations.js';

/**
 * What the public edition adds to the database, run once when it is opened: its own tables, and row-level security on
 * the role the application runs as. On PostgreSQL the server **refuses to start** unless the isolation is in force on
 * this very database, which is how an operator learns on the first deploy whether it is.
 */
export function publicEditionStorage(config: PublicConfig): EditionStorage {
  return {
    prepare(database) {
      migratePublic(database);
      if (database.dialect !== 'postgres') {
        if (!config.allowUnsafeSqlite) {
          throw new Error(
            'The public edition needs PostgreSQL: SQLite has no row-level security, so one person’s data would be kept apart by application code alone. Set DATABASE_URL, or PUBLIC_ALLOW_UNSAFE_SQLITE=1 for development only.',
          );
        }
        return;
      }
      applyRowSecurity(database, config.runtimeRole);
      if (!(database instanceof PostgresDatabase)) {
        throw new Error('Row-level security could not be switched on for this database.');
      }
      database.enableRowSecurity(config.runtimeRole);
      const report = checkRowSecurity(database, config.runtimeRole);
      if (!report.ok) {
        throw new Error(
          `Row-level security is not in force, so the public edition will not start: ${report.problems.join(' ')}`,
        );
      }
    },
  };
}
