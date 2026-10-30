import {
  MessageChannel,
  Worker,
  receiveMessageOnPort,
  type MessagePort,
} from 'node:worker_threads';

/** How the worker reaches PostgreSQL. PGlite is a PostgreSQL build that runs in-process, for tests. */
export type WorkerConfig =
  | { kind: 'pglite' }
  | {
      kind: 'pg';
      host: string;
      port: number;
      database: string;
      user: string;
      /** Null when the password is a Microsoft Entra access token, fetched for each connection. */
      password: string | null;
      entra: boolean;
      ssl: boolean;
      statementTimeoutMs: number;
    };

export type BridgeRequest =
  | { type: 'ping' }
  | { type: 'query'; text: string; values: unknown[]; retry: boolean }
  | { type: 'exec'; text: string }
  | { type: 'close' };

export type BridgeReply =
  | { ok: true; rows: Record<string, unknown>[]; rowCount: number }
  | { ok: false; error: { name: string; message: string; code: string | null } };

/** Longest the first call may take: starting the worker, connecting, and authenticating. */
const STARTUP_TIMEOUT_MS = 60_000;

function workerLocation(): { url: URL; execArgv: string[] } {
  // Built, the worker is plain JavaScript beside this file; run from source (tests, tsx) it is
  // TypeScript, which the worker is told to load through tsx.
  return import.meta.url.endsWith('.js')
    ? { url: new URL('./worker.js', import.meta.url), execArgv: [] }
    : { url: new URL('./worker.ts', import.meta.url), execArgv: ['--import', 'tsx'] };
}

/** What `PostgresDatabase` needs from the thing that carries its requests; tests supply their own. */
export interface Transport {
  call(request: BridgeRequest, timeoutMs?: number): BridgeReply;
  /** True once the connection is unusable. */
  readonly broken: boolean;
  /** Which schema the connection is set to use, so that databases sharing it can take turns. */
  activeSchema: string | null;
  close(): void;
}

/**
 * Lets synchronous code use an asynchronous database driver. The driver lives in a worker thread;
 * a call is posted to it and the calling thread sleeps on a shared flag until the answer is ready
 * (`Atomics.wait`), then reads it from the port without needing its event loop.
 *
 * This is a deliberate trade, and a limit: the thread that calls is blocked for the length of each
 * query, so one process serves one query at a time and a slow database slows every request. It
 * suits a pilot with a handful of people. Replacing it means making the stores asynchronous, which
 * touches every caller; see docs/adr/0009-postgres-through-a-synchronous-bridge.md.
 */
export class SyncBridge implements Transport {
  private readonly worker: Worker;
  private readonly port: MessagePort;
  private readonly flag: Int32Array;
  private failure: Error | null = null;
  activeSchema: string | null = null;

  constructor(
    config: WorkerConfig,
    private readonly timeoutMs: number,
  ) {
    const shared = new SharedArrayBuffer(4);
    this.flag = new Int32Array(shared);
    const { port1, port2 } = new MessageChannel();
    this.port = port1;
    const { url, execArgv } = workerLocation();
    this.worker = new Worker(url, {
      workerData: { shared, port: port2, config },
      transferList: [port2],
      execArgv,
    });
    // These run only when the thread's event loop does; a blocked caller learns of a dead worker by timing out.
    this.worker.on('error', (error) => {
      this.failure ??= error;
    });
    this.worker.on('exit', () => {
      this.failure ??= new Error('The database worker stopped.');
    });
    this.worker.unref();
    try {
      const reply = this.call({ type: 'ping' }, STARTUP_TIMEOUT_MS);
      if (!reply.ok) throw new Error(reply.error.message);
    } catch (error) {
      // Nothing will use this worker, so do not leave it holding a socket.
      void this.worker.terminate();
      this.port.close();
      throw error;
    }
  }

  /** True once a call has failed in a way that leaves the connection unusable. */
  get broken(): boolean {
    return this.failure !== null;
  }

  call(request: BridgeRequest, timeoutMs = this.timeoutMs): BridgeReply {
    if (this.failure) throw this.failure;
    Atomics.store(this.flag, 0, 0);
    this.port.postMessage(request);
    const deadline = Date.now() + timeoutMs;
    while (Atomics.load(this.flag, 0) === 0) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        this.failure = new Error('The database did not answer in time.');
        throw this.failure;
      }
      Atomics.wait(this.flag, 0, 0, remaining);
    }
    const message = receiveMessageOnPort(this.port);
    if (!message) throw new Error('The database bridge answered with nothing.');
    return message.message as BridgeReply;
  }

  close(): void {
    try {
      if (!this.failure) this.call({ type: 'close' }, 10_000);
    } catch {
      // The worker is stopped next whatever it did.
    }
    void this.worker.terminate();
    this.port.close();
  }
}

/** Sleeps this thread without spinning, for the pause between retries. */
export function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, milliseconds));
}
