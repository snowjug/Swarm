import { randomBytes } from 'node:crypto';
import { AppError, storageUnavailable } from '../../errors.js';
import { DatabaseError } from '../failure.js';
import { SYSTEM_SCOPE, currentScope, runInScope } from '../scope.js';
import type { SqlDatabase, SqlRow, SqlStatement, SqlValue } from '../sql.js';
import {
  SyncBridge,
  sleepSync,
  type BridgeContext,
  type BridgeReply,
  type BridgeRequest,
  type Transport,
  type WorkerConfig,
} from './bridge.js';
import { toPostgres } from './translate.js';

// Declared in `../failure.ts`, which says which of its codes mean that the database cannot serve.
export { DatabaseError };

/** 40001 (could not serialize) and 40P01 (deadlock): the transaction lost a race and may be retried. */
const isRaceLost = (error: unknown): boolean =>
  error instanceof DatabaseError && (error.code === '40001' || error.code === '40P01');

const MAX_ATTEMPTS = 6;

interface Shared {
  bridge: Transport;
  users: number;
}
/**
 * One connection serves every database in the process that asks for the same server. A real server's
 * connection is closed when the last user closes; the in-process server for tests is kept, because
 * starting it takes seconds and the thread that holds it does not stop the process from exiting.
 */
const connections = new Map<string, Shared>();

function acquire(
  key: string,
  make: () => Transport,
  options: { keepOpen?: boolean } = {},
): { bridge: Transport; release: () => void } {
  let entry = connections.get(key);
  if (!entry || entry.bridge.broken) {
    entry = { bridge: make(), users: 0 };
    connections.set(key, entry);
  }
  entry.users++;
  const held = entry;
  return {
    bridge: held.bridge,
    release: () => {
      if (--held.users > 0 || options.keepOpen) return;
      held.bridge.close();
      if (connections.get(key) === held) connections.delete(key);
    },
  };
}

/**
 * Connections with a transaction open, whichever database began it. Databases made for one server in
 * one process share its connection, and one that reads a snapshot while another's transaction is open
 * takes part in it: beginning another would end it.
 */
const openTransactions = new WeakSet<Transport>();

const quote = (identifier: string): string => `"${identifier.replace(/"/gu, '""')}"`;

/**
 * PostgreSQL behind the same synchronous interface as SQLite, so that every store runs unchanged.
 * Transactions are SERIALIZABLE and retried when they lose a race, which is what keeps checks such as
 * "a workspace keeps one owner" true when several instances share one database; the operation given
 * to `transaction` must therefore be safe to run again, and every one in this code base is
 * (it reads and writes only the database).
 */
export class PostgresDatabase implements SqlDatabase {
  readonly dialect = 'postgres' as const;
  private active = false;
  private snapshotting = false;
  private closed = false;
  /** Set when the database enforces row-level security: the role every statement then runs as. */
  private rls: { role: string } | null = null;

  get inTransaction(): boolean {
    return this.active;
  }

  get broken(): boolean {
    return this.bridge.broken;
  }

  private constructor(
    private readonly bridge: Transport,
    /** A schema of its own, so that databases for tests can share one in-process server. */
    private readonly schema: string | null,
    private readonly release: () => void,
    /** Whether closing drops the schema: only for one made up for a single database. */
    private readonly ownsSchema = true,
  ) {
    if (schema) this.raw({ type: 'exec', text: `CREATE SCHEMA IF NOT EXISTS ${quote(schema)}` });
  }

  /**
   * A server in this process, for tests: real PostgreSQL code with no server to run. Giving a
   * `schema` name opens that schema, as reopening a database would, and leaves it in place on close.
   */
  static inMemory(schema?: string): PostgresDatabase {
    const { bridge, release } = acquire(
      'pglite',
      () => new SyncBridge({ kind: 'pglite' }, 30_000),
      {
        keepOpen: true,
      },
    );
    return new PostgresDatabase(
      bridge,
      schema ?? `swarm_${randomBytes(6).toString('hex')}`,
      release,
      schema === undefined,
    );
  }

  /** For tests of the retry logic: a database on a transport that can be made to fail. */
  static onTransport(transport: Transport): PostgresDatabase {
    return new PostgresDatabase(transport, null, () => undefined);
  }

  /** A server reached over the network. `url` is `postgres://user[:password]@host[:port]/database`. */
  static connect(
    url: string,
    options: { entra?: boolean; statementTimeoutMs?: number } = {},
  ): PostgresDatabase {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const loopback =
      host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
    const mode = parsed.searchParams.get('sslmode');
    const config: WorkerConfig = {
      kind: 'pg',
      host,
      port: parsed.port ? Number(parsed.port) : 5432,
      database: decodeURIComponent(parsed.pathname.replace(/^\//u, '')),
      user: decodeURIComponent(parsed.username),
      password: options.entra
        ? null
        : decodeURIComponent(parsed.password) || process.env.PGPASSWORD || '',
      entra: options.entra === true,
      ssl: mode ? mode !== 'disable' : !loopback,
      statementTimeoutMs: options.statementTimeoutMs ?? 30_000,
    };
    // The key names the server and the person, never the password.
    const key = `pg:${config.user}@${config.host}:${config.port}/${config.database}`;
    const { bridge, release } = acquire(
      key,
      () => new SyncBridge(config, config.statementTimeoutMs + 5_000),
    );
    return new PostgresDatabase(bridge, null, release);
  }

  private raw(
    request: Extract<BridgeRequest, { type: 'query' | 'exec' }>,
  ): Extract<BridgeReply, { ok: true }> {
    if (this.closed) throw new AppError(500, 'STORAGE_CLOSED', 'The database is closed.');
    if (this.schema && this.bridge.activeSchema !== this.schema) {
      this.bridge.activeSchema = null;
      this.send({ type: 'exec', text: `SET search_path TO ${quote(this.schema)}` });
      this.bridge.activeSchema = this.schema;
    }
    const context = this.contextFor();
    return this.send(context ? { ...request, context } : request);
  }

  /**
   * What the session must be for the statement about to be sent. With row security on, that is the role the policies
   * apply to and the scope of the code that is making the call; with none, nothing is asked for, and the connection
   * behaves as it always has. A call with no scope is refused, never treated as "everything".
   */
  private contextFor(): BridgeContext | undefined {
    if (!this.rls) return undefined;
    const scope = currentScope();
    if (!scope || (!scope.system && !scope.tenant)) {
      throw new AppError(
        500,
        'DB_CONTEXT_MISSING',
        'A database call was made outside any request, job or system scope.',
      );
    }
    return {
      role: this.rls.role,
      tenant: scope.system ? '' : (scope.tenant ?? ''),
      system: scope.system,
    };
  }

  get rowSecurity(): boolean {
    return this.rls !== null;
  }

  /**
   * From now on every statement runs as `role`, a role the policies apply to, in the scope of the code that makes
   * it. Called once, after the schema and the policies are in place, by the code that opens a public database.
   */
  enableRowSecurity(role: string): void {
    this.rls = { role };
  }

  asSystem<T>(operation: () => T): T {
    return this.rls ? runInScope(SYSTEM_SCOPE, operation) : operation();
  }

  asTenant<T>(tenantId: string, operation: () => T): T {
    return this.rls ? runInScope({ tenant: tenantId, system: false }, operation) : operation();
  }

  private send(request: BridgeRequest): Extract<BridgeReply, { ok: true }> {
    let reply: BridgeReply;
    try {
      reply = this.bridge.call(request);
    } catch (cause) {
      throw storageUnavailable(cause);
    }
    if (!reply.ok) throw new DatabaseError(reply.error.message, reply.error.code);
    return reply;
  }

  exec(sql: string): void {
    if (/^\s*PRAGMA\b/iu.test(sql)) return;
    this.raw({ type: 'exec', text: sql });
  }

  prepare(sql: string): SqlStatement {
    const text = toPostgres(sql);
    const run = (values: SqlValue[]) =>
      this.raw({ type: 'query', text, values, retry: !this.active && !this.snapshotting });
    if (text === '') {
      return { run: () => ({ changes: 0 }), get: () => undefined, all: () => [] };
    }
    return {
      run: (...values) => ({ changes: run(values).rowCount }),
      get: (...values): SqlRow | undefined => run(values).rows[0],
      all: (...values): SqlRow[] => run(values).rows,
    };
  }

  transaction<T>(operation: () => T): T {
    for (let attempt = 1; ; attempt++) {
      // A connection lost while no transaction is open may be replaced, so the first transaction after
      // an outage is not refused for what an earlier statement left behind.
      this.raw({
        type: 'exec',
        text: 'BEGIN ISOLATION LEVEL SERIALIZABLE',
        retry: !openTransactions.has(this.bridge),
      });
      this.active = true;
      openTransactions.add(this.bridge);
      try {
        const result = operation();
        this.raw({ type: 'exec', text: 'COMMIT' });
        return result;
      } catch (error) {
        try {
          this.raw({ type: 'exec', text: 'ROLLBACK' });
        } catch {
          // The connection is gone; the next call finds that out.
        }
        if (!isRaceLost(error) || attempt >= MAX_ATTEMPTS) throw error;
        // Others got there first. Wait a little, longer each time and never the same twice.
        sleepSync(Math.random() * 20 * 2 ** attempt);
      } finally {
        this.active = false;
        openTransactions.delete(this.bridge);
      }
    }
  }

  /**
   * One read-only transaction at REPEATABLE READ, which in PostgreSQL is a single snapshot taken at
   * its first statement: what others commit after that is not seen, and nobody waits for it. Nothing
   * inside it is retried on a fresh connection, because that would read another snapshot: a lost
   * connection is a failure.
   */
  readSnapshot<T>(operation: () => T): T {
    const outer = this.snapshotting;
    this.snapshotting = true;
    try {
      return openTransactions.has(this.bridge) ? operation() : this.inOwnSnapshot(operation);
    } finally {
      this.snapshotting = outer;
    }
  }

  private inOwnSnapshot<T>(operation: () => T): T {
    // `readSnapshot` has seen that no transaction is open on this connection, so a lost one may be replaced.
    this.raw({
      type: 'exec',
      text: 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
      retry: true,
    });
    openTransactions.add(this.bridge);
    try {
      const result = operation();
      this.raw({ type: 'exec', text: 'COMMIT' });
      return result;
    } catch (error) {
      try {
        this.raw({ type: 'exec', text: 'ROLLBACK' });
      } catch {
        // The connection is gone; the next call finds that out.
      }
      throw error;
    } finally {
      openTransactions.delete(this.bridge);
    }
  }

  close(): void {
    if (this.closed) return;
    try {
      if (this.schema && this.ownsSchema) {
        this.bridge.activeSchema = null;
        this.send({ type: 'exec', text: `SET search_path TO public` });
        this.send({ type: 'exec', text: `DROP SCHEMA IF EXISTS ${quote(this.schema)} CASCADE` });
      }
    } finally {
      this.closed = true;
      this.release();
    }
  }
}
