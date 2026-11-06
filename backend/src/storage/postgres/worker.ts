/**
 * The thread that owns the PostgreSQL connection. It answers one request at a time and replies on
 * the port it was given; `bridge.ts` explains why. Nothing here is imported by the application
 * itself: it only ever runs as a worker.
 */
import { workerData } from 'node:worker_threads';
import type { BridgeContext, BridgeReply, BridgeRequest, WorkerConfig } from './bridge.js';

interface Backend {
  query(
    text: string,
    values: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number }>;
  exec(text: string): Promise<void>;
  /** Replaces a connection that was lost. Only for a real server. */
  reconnect(): Promise<void>;
  close(): Promise<void>;
}

const { shared, port, config } = workerData as {
  shared: SharedArrayBuffer;
  port: import('node:worker_threads').MessagePort;
  config: WorkerConfig;
};
const flag = new Int32Array(shared);

/** Whole numbers come back from PostgreSQL as text when they exceed 32 bits; the stores want numbers. */
const BIGINT_OID = 20;
const LOST_CONNECTION = /^(08|57P0)|ECONNRESET|ECONNREFUSED|ETIMEDOUT|Connection terminated/u;

async function openPglite(): Promise<Backend> {
  const { PGlite } = await import('@electric-sql/pglite');
  const database = await PGlite.create({
    parsers: { [BIGINT_OID]: (value: string) => Number(value) },
  });
  return {
    async query(text, values) {
      const result = await database.query<Record<string, unknown>>(text, values);
      return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
    },
    async exec(text) {
      await database.exec(text);
    },
    async reconnect() {
      // Nothing to reconnect: the database lives in this thread.
    },
    async close() {
      await database.close();
    },
  };
}

async function openPg(settings: Extract<WorkerConfig, { kind: 'pg' }>): Promise<Backend> {
  const { default: pg } = await import('pg');
  let credential: { getToken(scope: string): Promise<{ token: string } | null> } | null = null;
  if (settings.entra) {
    const { DefaultAzureCredential } = await import('@azure/identity');
    credential = new DefaultAzureCredential();
  }
  const password = async (): Promise<string> => {
    if (!credential) return settings.password ?? '';
    const token = await credential.getToken('https://ossrdbms-aad.database.windows.net/.default');
    if (!token) throw new Error('No access token was issued for the database.');
    return token.token;
  };
  let client: InstanceType<typeof pg.Client>;
  /** False once the driver says that this client's connection is gone, and until a new one is made. */
  let usable = false;
  const connect = async () => {
    const made = new pg.Client({
      host: settings.host,
      port: settings.port,
      database: settings.database,
      user: settings.user,
      password,
      ssl: settings.ssl ? { rejectUnauthorized: true } : false,
      statement_timeout: settings.statementTimeoutMs,
      application_name: 'swarm',
      types: {
        getTypeParser: ((oid: number, format?: 'text' | 'binary') =>
          oid === BIGINT_OID
            ? (value: string) => Number(value)
            : pg.types.getTypeParser(oid, format as 'text')) as never,
      },
    });
    client = made;
    usable = false;
    // An idle connection that the server drops raises this, or ends, and the client cannot be used again.
    const gone = () => {
      if (client === made) usable = false;
    };
    made.on('error', gone);
    made.on('end', gone);
    await made.connect();
    usable = true;
  };
  await connect();
  /**
   * What a call on a connection that is gone, or that goes while the call waits, is told. The driver
   * words it several ways and gives some no code ("Client has encountered a connection error and is
   * not queryable"), and a client in that state never works again: it is refused at once, as a
   * connection failure (SQLSTATE 08006), which is what `LOST_CONNECTION` below reconnects on and
   * what `isStorageUnavailable` reads as the database being out of reach. What the server itself
   * reports keeps its own code.
   */
  const lostConnection = () =>
    Object.assign(new Error('The connection to the database was lost.'), { code: '08006' });
  const guarded = async <T>(call: () => Promise<T>): Promise<T> => {
    if (!usable) throw lostConnection();
    try {
      return await call();
    } catch (error) {
      if (usable || error instanceof pg.DatabaseError) throw error;
      throw lostConnection();
    }
  };
  return {
    query: (text, values) =>
      guarded(async () => {
        const result = await client.query({ text, values: values as unknown[] });
        return { rows: result.rows as Record<string, unknown>[], rowCount: result.rowCount ?? 0 };
      }),
    exec: (text) =>
      guarded(async () => {
        await client.query(text);
      }),
    async reconnect() {
      await client.end().catch(() => undefined);
      try {
        await connect();
      } catch (error) {
        // What fails here is a connection that cannot be made again: the driver words it with no code when a proxy
        // accepts and ends it, and a token that could not be had is no driver error at all. Only what the server itself
        // reported (a login refused, a database that does not exist) keeps its own code.
        if (error instanceof pg.DatabaseError) throw error;
        throw lostConnection();
      }
    },
    async close() {
      await client.end().catch(() => undefined);
    },
  };
}

let backend: Promise<Backend> | null = null;
const open = (): Promise<Backend> =>
  (backend ??= config.kind === 'pglite' ? openPglite() : openPg(config));

function describe(error: unknown): BridgeReply {
  const source = error as { name?: unknown; message?: unknown; code?: unknown };
  return {
    ok: false,
    error: {
      name: typeof source.name === 'string' ? source.name : 'Error',
      message: typeof source.message === 'string' ? source.message : 'The database failed.',
      code: typeof source.code === 'string' ? source.code : null,
    },
  };
}

/** What the session is when nothing was asked for: the connection's own role, which is how the pilot has always run. */
const DEFAULT_CONTEXT: BridgeContext = { role: null, tenant: '', system: false };

/** What this connection's session is set to now. Null when that is not known: after a rollback, or on a new connection. */
let applied: BridgeContext | null = DEFAULT_CONTEXT;

const quoteIdentifier = (value: string): string => `"${value.replace(/"/gu, '""')}"`;

/**
 * Sets the session to what a statement asks for, and only what differs. The role is changed first, because the settings
 * are only read by a role that is subject to the policies. Anything that fails here fails the statement.
 */
async function withContext<T>(
  database: Backend,
  wanted: BridgeContext | undefined,
  call: () => Promise<T>,
): Promise<T> {
  const target = wanted ?? DEFAULT_CONTEXT;
  const before = applied;
  try {
    if (before === null || before.role !== target.role) {
      await database.exec(
        target.role === null ? 'RESET ROLE' : `SET ROLE ${quoteIdentifier(target.role)}`,
      );
    }
    if (
      target.role !== null &&
      (before === null || before.tenant !== target.tenant || before.system !== target.system)
    ) {
      await database.query('SELECT set_config($1, $2, false), set_config($3, $4, false)', [
        'swarm.tenant',
        target.tenant,
        'swarm.system',
        target.system ? 'on' : '',
      ]);
    }
  } catch (error) {
    // Part of it may have been applied: what the session is set to is no longer known.
    applied = null;
    throw error;
  }
  applied = target;
  return call();
}

/**
 * Runs `call`. When the connection turns out to be lost, and the caller says that a new one may take
 * its place, makes one and runs `call` again, once.
 */
async function withReconnect<T>(
  database: Backend,
  retry: boolean,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (!retry || !LOST_CONNECTION.test(describeText(error))) throw error;
    await database.reconnect();
    // A new connection starts with no role and no settings, whatever this one had.
    applied = null;
    return await call();
  }
}

const ROLLBACK = /^\s*ROLLBACK\b/iu;
/** Ending a transaction needs no context, and a rollback must not be preceded by a statement: the transaction may be aborted. */
const ENDS_TRANSACTION = /^\s*(?:ROLLBACK|COMMIT|END)\b/iu;

async function handle(request: BridgeRequest): Promise<BridgeReply> {
  const database = await open();
  switch (request.type) {
    case 'ping':
      return { ok: true, rows: [], rowCount: 0 };
    case 'exec':
      try {
        await withReconnect(database, request.retry === true, () =>
          ENDS_TRANSACTION.test(request.text)
            ? database.exec(request.text)
            : withContext(database, request.context, () => database.exec(request.text)),
        );
      } finally {
        // What a transaction that is rolled back set is undone with it, so what was applied is no longer known.
        if (ROLLBACK.test(request.text)) applied = null;
      }
      return { ok: true, rows: [], rowCount: 0 };
    case 'close':
      await database.close();
      return { ok: true, rows: [], rowCount: 0 };
    case 'query':
      return {
        ok: true,
        ...(await withReconnect(database, request.retry, () =>
          withContext(database, request.context, () =>
            database.query(request.text, request.values),
          ),
        )),
      };
  }
}

function describeText(error: unknown): string {
  const source = error as { code?: unknown; message?: unknown };
  return `${typeof source.code === 'string' ? source.code : ''} ${
    typeof source.message === 'string' ? source.message : ''
  }`;
}

port.on('message', (request: BridgeRequest) => {
  void (async () => {
    let reply: BridgeReply;
    try {
      reply = await handle(request);
    } catch (error) {
      reply = describe(error);
    }
    port.postMessage(reply);
    Atomics.store(flag, 0, 1);
    Atomics.notify(flag, 0);
  })();
});
