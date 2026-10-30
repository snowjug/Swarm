import type { DatabaseSync } from 'node:sqlite';

/** What a statement can be given. Booleans and dates are stored as numbers and text. */
export type SqlValue = string | number | bigint | null;
export type SqlRow = Record<string, unknown>;

export interface SqlStatement {
  run(...parameters: SqlValue[]): { changes: number | bigint };
  get(...parameters: SqlValue[]): SqlRow | undefined;
  all(...parameters: SqlValue[]): SqlRow[];
}

/**
 * The part of a database that the stores use. SQL is written once, in the SQLite dialect with `?`
 * placeholders and plain standard SQL otherwise; the PostgreSQL implementation translates the few
 * differences (see `postgres/translate.ts`). Calls are synchronous in both, so the stores read as
 * they always have.
 */
export interface SqlDatabase {
  readonly dialect: 'sqlite' | 'postgres';
  /** True while `transaction` is running its operation. */
  readonly inTransaction: boolean;
  /** True when the connection is lost for good and only a restart will help. */
  readonly broken: boolean;
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  /** Runs `operation` as one transaction: every change is saved, or none. Not re-entrant. */
  transaction<T>(operation: () => T): T;
  close(): void;
}

/** SQLite through `node:sqlite`. A write lock is taken when a transaction begins. */
export class SqliteDatabase implements SqlDatabase {
  readonly dialect = 'sqlite' as const;
  readonly broken = false;
  inTransaction = false;
  private closed = false;

  constructor(private readonly database: DatabaseSync) {}

  exec(sql: string): void {
    this.database.exec(sql);
  }

  prepare(sql: string): SqlStatement {
    return this.database.prepare(sql) as unknown as SqlStatement;
  }

  transaction<T>(operation: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    this.inTransaction = true;
    try {
      const result = operation();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }
}
