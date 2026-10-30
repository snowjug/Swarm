/**
 * The thread that owns the PostgreSQL connection. It answers one request at a time and replies on
 * the port it was given; `bridge.ts` explains why. Nothing here is imported by the application
 * itself: it only ever runs as a worker.
 */
import { workerData } from 'node:worker_threads';
import type { BridgeReply, BridgeRequest, WorkerConfig } from './bridge.js';

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
  const connect = async () => {
    client = new pg.Client({
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
    // An idle connection that the server drops raises this; the next call reconnects.
    client.on('error', () => undefined);
    await client.connect();
  };
  await connect();
  return {
    async query(text, values) {
      const result = await client.query({ text, values: values as unknown[] });
      return { rows: result.rows as Record<string, unknown>[], rowCount: result.rowCount ?? 0 };
    },
    async exec(text) {
      await client.query(text);
    },
    async reconnect() {
      await client.end().catch(() => undefined);
      await connect();
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

async function handle(request: BridgeRequest): Promise<BridgeReply> {
  const database = await open();
  switch (request.type) {
    case 'ping':
      return { ok: true, rows: [], rowCount: 0 };
    case 'exec':
      await database.exec(request.text);
      return { ok: true, rows: [], rowCount: 0 };
    case 'close':
      await database.close();
      return { ok: true, rows: [], rowCount: 0 };
    case 'query':
      try {
        return { ok: true, ...(await database.query(request.text, request.values)) };
      } catch (error) {
        const lost = request.retry && LOST_CONNECTION.test(describeText(error));
        if (!lost) throw error;
        await database.reconnect();
        return { ok: true, ...(await database.query(request.text, request.values)) };
      }
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
