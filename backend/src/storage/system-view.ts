import type { SqlDatabase, SqlStatement } from './sql.js';

/**
 * The same database, with every call made as the platform (see `scope.ts`). For stores whose rows belong to no
 * workspace and are looked up before anyone is known: sign-in state and sessions, the audit chain's writes, the usage
 * ledger. Where the database has no row security this is the database itself, so a pilot's stores are handed exactly
 * what they were handed before.
 */
export function asSystemView(database: SqlDatabase): SqlDatabase {
  if (!database.rowSecurity) return database;
  return {
    get dialect() {
      return database.dialect;
    },
    get inTransaction() {
      return database.inTransaction;
    },
    get broken() {
      return database.broken;
    },
    rowSecurity: true,
    exec: (sql) => database.asSystem(() => database.exec(sql)),
    prepare(sql): SqlStatement {
      const statement = database.prepare(sql);
      return {
        run: (...values) => database.asSystem(() => statement.run(...values)),
        get: (...values) => database.asSystem(() => statement.get(...values)),
        all: (...values) => database.asSystem(() => statement.all(...values)),
      };
    },
    transaction: (operation) => database.asSystem(() => database.transaction(operation)),
    readSnapshot: (operation) => database.asSystem(() => database.readSnapshot(operation)),
    asSystem: (operation) => database.asSystem(operation),
    asTenant: (tenantId, operation) => database.asTenant(tenantId, operation),
    close: () => database.close(),
  };
}
