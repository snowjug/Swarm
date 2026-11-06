import type { SqlDatabase, SqlRow, SqlStatement } from '../../src/storage/sql.js';

/** A database that does what `real` does, except for the statements that `wrap` takes over. */
export function around(
  real: SqlDatabase,
  wrap: (sql: string, statement: SqlStatement) => Partial<SqlStatement> | undefined,
): SqlDatabase {
  return {
    get dialect() {
      return real.dialect;
    },
    get inTransaction() {
      return real.inTransaction;
    },
    get broken() {
      return real.broken;
    },
    get rowSecurity() {
      return real.rowSecurity;
    },
    asSystem: (operation) => real.asSystem(operation),
    asTenant: (tenantId, operation) => real.asTenant(tenantId, operation),
    exec: (sql) => real.exec(sql),
    transaction: (operation) => real.transaction(operation),
    readSnapshot: (operation) => real.readSnapshot(operation),
    close: () => real.close(),
    prepare: (sql): SqlStatement => {
      const statement = real.prepare(sql);
      const taken = wrap(sql, statement);
      if (!taken) return statement;
      return {
        run: (...values) => statement.run(...values),
        get: (...values) => statement.get(...values),
        all: (...values) => statement.all(...values),
        ...taken,
      };
    },
  };
}

/**
 * A database that is written to while it is being read. The application does not stop for a backup, so
 * a second connection to the same file (another process, in life) stands for it: `write` runs once,
 * right after the first table has been read, which is when a copy that read the tables one after
 * another, each as it was at that moment, would take half of whatever the write changed.
 */
export function writtenDuringRead(real: SqlDatabase, write: () => void): SqlDatabase {
  let written = false;
  return around(real, (sql, statement) =>
    /^SELECT \* FROM projects ORDER BY/u.test(sql)
      ? {
          all: (...values) => {
            const rows = statement.all(...values);
            if (!written) {
              written = true;
              write();
            }
            return rows;
          },
        }
      : undefined,
  );
}

const SESSION =
  "SELECT current_setting('transaction_isolation') AS isolation, current_setting('transaction_read_only') AS read_only, pg_current_snapshot()::text AS snapshot";

/**
 * A PostgreSQL database that notes, after every table that is read from it, how PostgreSQL holds the
 * session that reads: its isolation level, whether it can write, and which snapshot it sees. The
 * in-process PostgreSQL is one connection, so a second writer cannot be played against it; this shows
 * what is asked of the server instead.
 */
export function sessionsSeen(real: SqlDatabase): { database: SqlDatabase; seen: SqlRow[] } {
  const seen: SqlRow[] = [];
  const database = around(real, (sql, statement) =>
    /^SELECT \* FROM/u.test(sql)
      ? {
          all: (...values) => {
            const rows = statement.all(...values);
            seen.push(real.prepare(SESSION).get()!);
            return rows;
          },
        }
      : undefined,
  );
  return { database, seen };
}
