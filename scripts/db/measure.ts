/**
 * How far one Swarm process can be pushed on each database, and what a slow database does to it.
 *
 * The stores are synchronous and PostgreSQL is reached through a bridge that blocks the calling
 * thread for the length of every query (`backend/src/storage/postgres/bridge.ts`), so one process does
 * one query at a time and a slow database stops every request, the health probes included. This
 * measures that: requests a second at saturation, how they queue, how many database round trips a
 * request makes, how much of the time the event loop is held by the database, and how late a probe is
 * answered meanwhile. Requests go through the whole application (guard, routes, stores) with
 * `inject`, signed in with a session cookie as a person in a hosted deployment is, so that each costs
 * what it would there. There is no HTTP client, no model and no job worker; the load is generated on
 * the thread that serves it, which costs a little for SQLite and nothing while a database is waited for.
 * A health probe is due every 5 ms and is timed from when it fell due.
 *
 *   npx tsx scripts/db/measure.ts --engine sqlite
 *   npx tsx scripts/db/measure.ts --engine pglite
 *   PGPASSWORD=... npx tsx scripts/db/measure.ts --engine postgres --url postgres://user@127.0.0.1:55432/swarm?sslmode=require --rtt 0,2,20
 *   node scripts/db/with-postgres.mjs -- npx tsx scripts/db/measure.ts --engine postgres --rtt 0,2,20
 *
 *   --url         the PostgreSQL server (default: SWARM_TEST_POSTGRES_URL, which with-postgres.mjs sets for the
 *                 server it starts, a throwaway one in Docker)
 *   --rtt         milliseconds added to every round trip, for a PostgreSQL server (through a delaying proxy in
 *                 a process of its own); each value is one run. Default 0.
 *   --seconds     how long each phase runs (default 4)
 *   --concurrency requests in flight in the phases that have several (default 1,16)
 *   --projects    projects to read from (default 20)
 *   --json        the full result as JSON, after the table
 *
 * The password of a PostgreSQL server is read from PGPASSWORD, and the address is never printed. These are
 * numbers for the machine they were taken on, at the moment, with whatever else it was doing: they say where
 * a ceiling is and what moves it, and are not a capacity guarantee. They have to be taken again on a quiet
 * machine, and against the server a deployment really has.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { join, resolve } from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { setImmediate as turn, setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createProjectSchema } from '../../shared/types.js';
import { buildApp } from '../../backend/src/app.js';
import { loadConfig } from '../../backend/src/config.js';
import { SyncBridge } from '../../backend/src/storage/postgres/bridge.js';
import { Repository } from '../../backend/src/storage/repository.js';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const HOST = 'swarm.example.test';
const TENANT = `measure-${Date.now().toString(36)}`;
const PERSON = '0f2f6b0e-3c9a-4d3e-9b1f-5a6d7e8f9a0b';

type Engine = 'sqlite' | 'pglite' | 'postgres';

interface Options {
  engine: Engine;
  url: string;
  rtt: number[];
  seconds: number;
  concurrency: number[];
  projects: number;
  json: boolean;
}

function parse(argv: string[]): Options {
  const options: Options = {
    engine: 'sqlite',
    url: process.env.SWARM_TEST_POSTGRES_URL ?? '',
    rtt: [0],
    seconds: 4,
    concurrency: [1, 16],
    projects: 20,
    json: false,
  };
  const numbers = (value: string | undefined): number[] =>
    (value ?? '').split(',').map((part) => Number(part.trim()));
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === '--engine') {
      if (value !== 'sqlite' && value !== 'pglite' && value !== 'postgres') {
        throw new Error('--engine is sqlite, pglite or postgres.');
      }
      options.engine = value;
      index += 1;
    } else if (argument === '--url') {
      options.url = value ?? '';
      index += 1;
    } else if (argument === '--rtt') {
      options.rtt = numbers(value);
      index += 1;
    } else if (argument === '--seconds') {
      options.seconds = Number(value);
      index += 1;
    } else if (argument === '--concurrency') {
      options.concurrency = numbers(value);
      index += 1;
    } else if (argument === '--projects') {
      options.projects = Number(value);
      index += 1;
    } else if (argument === '--json') {
      options.json = true;
    } else {
      throw new Error(`Unknown option ${argument}. See the top of scripts/db/measure.ts.`);
    }
  }
  if (options.engine === 'postgres' && !options.url)
    throw new Error('--engine postgres needs --url.');
  if (
    [...options.rtt, ...options.concurrency, options.seconds, options.projects].some(
      (value) => !Number.isFinite(value) || value < 0,
    )
  ) {
    throw new Error('--rtt, --seconds, --concurrency and --projects are non-negative numbers.');
  }
  return options;
}

/** Round trips to PostgreSQL, and how long this thread was held waiting for them. */
const bridge = { calls: 0, blockedMs: 0 };
/** The statements of the request being traced, as their first words: never the values. */
let recorded: string[] | null = null;
const originalCall = SyncBridge.prototype.call;
SyncBridge.prototype.call = function (this: SyncBridge, ...args: Parameters<typeof originalCall>) {
  const [request] = args;
  if (recorded && request.type !== 'ping') {
    recorded.push(
      request.type === 'query' || request.type === 'exec'
        ? request.text.replace(/\s+/gu, ' ').trim().slice(0, 100)
        : request.type,
    );
  }
  const started = performance.now();
  try {
    return originalCall.apply(this, args);
  } finally {
    bridge.calls += 1;
    bridge.blockedMs += performance.now() - started;
  }
};

const percentile = (sorted: number[], p: number): number =>
  sorted.length === 0
    ? 0
    : (sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0);
const round = (value: number, digits = 1): number =>
  Math.round(value * 10 ** digits) / 10 ** digits;

interface Phase {
  engine: Engine;
  rtt: number;
  phase: string;
  concurrency: number;
  requests: number;
  perSecond: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  databaseCallsPerRequest: number | null;
  databaseHeldPercent: number | null;
  loopDelayP99: number;
  loopDelayMax: number;
  probeP50: number;
  probeP99: number;
  probeMax: number;
}

interface Trace {
  engine: Engine;
  request: string;
  roundTrips: number;
  statements: { count: number; text: string }[];
}

const traces: Trace[] = [];

async function proxyTo(
  url: string,
  roundTripMs: number,
): Promise<{ url: string; child: ChildProcess | null }> {
  if (roundTripMs <= 0) return { url, child: null };
  const parsed = new URL(url);
  const child = spawn(
    process.execPath,
    [
      join(root, 'scripts/db/delay-proxy.mjs'),
      parsed.hostname,
      parsed.port || '5432',
      String(roundTripMs / 2),
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const port = await new Promise<string>((resolvePort, reject) => {
    child.once('error', reject);
    child.stdout!.on('data', (data: Buffer) => {
      const match = /LISTENING (\d+)/u.exec(String(data));
      if (match) resolvePort(match[1]!);
    });
  });
  parsed.hostname = '127.0.0.1';
  parsed.port = port;
  return { url: parsed.toString(), child };
}

async function measure(options: Options, rtt: number, results: Phase[]): Promise<void> {
  let scratch: string | null = null;
  let target: string;
  let child: ChildProcess | null = null;
  if (options.engine === 'sqlite') {
    mkdirSync(join(root, 'data'), { recursive: true });
    scratch = mkdtempSync(join(root, 'data', 'measure-'));
    target = join(scratch, 'swarm.sqlite');
  } else if (options.engine === 'pglite') {
    target = `pglite:measure_${Date.now()}`;
  } else {
    ({ url: target, child } = await proxyTo(options.url, rtt));
  }
  const repository = new Repository(target);
  const config = loadConfig({
    AUTH_MODE: 'entra',
    AUTH_ENTRA_TENANT_ID: '11111111-1111-4111-8111-111111111111',
    AUTH_ENTRA_AUDIENCE: 'api://measure',
    AUTH_ENTRA_CLIENT_ID: 'cccccccc-0000-4000-8000-0000000000aa',
    AUTH_ENTRA_REDIRECT_URI: `https://${HOST}/auth/callback`,
    ALLOWED_HOSTS: HOST,
    ALLOWED_ORIGINS: `https://${HOST}`,
    LOG_LEVEL: 'silent',
    RATE_LIMIT_SCALE: '1000',
  });
  const input = createProjectSchema.parse({
    name: 'Measured project',
    question: 'How might fictional stakeholders respond to the proposed ferry timetable change?',
    documents: [
      {
        name: 'notes.md',
        content: `A fictional note about a ferry timetable. ${'The harbour board met twice and noted the tides. '.repeat(5)}`,
      },
    ],
    settings: { mode: 'local', agentCount: 6, rounds: 4, seed: 42, network: 'community' },
  });
  const owner = { tenantId: TENANT, ownerId: PERSON };
  repository.members.setWorkspaceMember({
    tenantId: TENANT,
    principalId: PERSON,
    role: 'owner',
    actor: { id: 'measure', workspaceRole: 'owner' },
  });
  const ids = Array.from(
    { length: options.projects },
    () => repository.create(input, { owner }).id,
  );
  const { token } = repository.sessions.create(
    { id: PERSON, tenantId: TENANT, platformAdmin: false, bootstrapAdmin: false },
    { idleMs: 8 * 3_600_000, absoluteMs: 8 * 3_600_000 },
  );
  const { app } = await buildApp({ config, repository, jobs: { role: 'api', timers: false } });
  const signedIn = { host: HOST, cookie: `__Host-swarm_session=${token}`, 'x-swarm-csrf': '1' };

  const read = async (): Promise<number> =>
    (
      await app.inject({
        url: `/api/projects/${ids[Math.floor(Math.random() * ids.length)]}`,
        headers: signedIn,
      })
    ).statusCode;
  const list = async (): Promise<number> =>
    (await app.inject({ url: '/api/projects?limit=20', headers: signedIn })).statusCode;
  const write = async (): Promise<number> => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { ...signedIn, 'content-type': 'application/json' },
      payload: input,
    });
    if (created.statusCode !== 201) return created.statusCode;
    return (
      await app.inject({
        method: 'DELETE',
        url: `/api/projects/${(created.json() as { id: string }).id}`,
        headers: signedIn,
      })
    ).statusCode;
  };

  async function phase(
    name: string,
    concurrency: number,
    task: () => Promise<number>,
  ): Promise<void> {
    for (let warm = 0; warm < 10; warm += 1) await task();
    const latencies: number[] = [];
    const probes: number[] = [];
    let failures = 0;
    let running = true;
    const loop = monitorEventLoopDelay({ resolution: 1 });
    // A probe is due every 5 ms and is timed from when it was due, so that a loop that was blocked
    // when it fell due answers it late, as it would a real one.
    const prober = (async () => {
      while (running) {
        const due = performance.now() + 5;
        await sleep(5);
        await app.inject({ url: '/api/health/live', headers: { host: HOST } });
        probes.push(performance.now() - due);
      }
    })();
    let crash: unknown = null;
    // A request that is answered without touching the network never gives the timers a turn, and a
    // served one always does, so each one hands the loop a turn.
    const workers = Array.from({ length: concurrency }, async () => {
      while (running) {
        const started = performance.now();
        try {
          if ((await task()) >= 400) failures += 1;
        } catch (error) {
          crash ??= error;
          running = false;
        }
        latencies.push(performance.now() - started);
        await turn();
      }
    });
    bridge.calls = 0;
    bridge.blockedMs = 0;
    loop.enable();
    const started = performance.now();
    await sleep(options.seconds * 1_000);
    running = false;
    await Promise.all([...workers, prober]);
    const wall = performance.now() - started;
    loop.disable();
    if (crash) throw crash;
    if (failures > 0) throw new Error(`${name}: ${failures} requests were refused or failed.`);
    latencies.sort((a, b) => a - b);
    probes.sort((a, b) => a - b);
    const database = options.engine !== 'sqlite';
    results.push({
      engine: options.engine,
      rtt,
      phase: name,
      concurrency,
      requests: latencies.length,
      perSecond: round((latencies.length / wall) * 1_000),
      p50: round(percentile(latencies, 50)),
      p95: round(percentile(latencies, 95)),
      p99: round(percentile(latencies, 99)),
      max: round(latencies.at(-1) ?? 0),
      databaseCallsPerRequest: database
        ? round(bridge.calls / Math.max(1, latencies.length))
        : null,
      databaseHeldPercent: database ? round((bridge.blockedMs / wall) * 100, 0) : null,
      loopDelayP99: round(loop.percentile(99) / 1e6),
      loopDelayMax: round(loop.max / 1e6),
      probeP50: round(percentile(probes, 50)),
      probeP99: round(percentile(probes, 99)),
      probeMax: round(probes.at(-1) ?? 0),
    });
  }

  /** Which statements one request sends, once, so that what a request costs can be read off. */
  async function trace(name: string, task: () => Promise<number>): Promise<void> {
    await task();
    recorded = [];
    await task();
    const counted = new Map<string, number>();
    for (const text of recorded) counted.set(text, (counted.get(text) ?? 0) + 1);
    traces.push({
      engine: options.engine,
      request: name,
      roundTrips: recorded.length,
      statements: [...counted].map(([text, count]) => ({ count, text })),
    });
    recorded = null;
  }

  try {
    if (options.engine !== 'sqlite' && rtt === 0) {
      await trace('read one project', read);
      await trace('list 20 projects', list);
      await trace('create and delete one project', write);
    }
    for (const concurrency of options.concurrency) {
      await phase('read one project', concurrency, read);
    }
    await phase('list 20 projects', Math.max(...options.concurrency), list);
    await phase('create and delete one', Math.min(4, Math.max(...options.concurrency)), write);

    // The cost of one query, with nothing else going on: the fastest is what the machine and the
    // server can do, and the rest is whatever else they were doing.
    const durations: number[] = [];
    const began = performance.now();
    while (performance.now() - began < Math.min(options.seconds, 3) * 1_000) {
      const before = performance.now();
      repository.ping();
      durations.push(performance.now() - before);
    }
    const wall = performance.now() - began;
    durations.sort((a, b) => a - b);
    results.push({
      engine: options.engine,
      rtt,
      phase: `one query (SELECT 1), fastest ${round(durations[0] ?? 0, 3)} ms`,
      concurrency: 1,
      requests: durations.length,
      perSecond: round((durations.length / wall) * 1_000),
      p50: round(percentile(durations, 50), 3),
      p95: round(percentile(durations, 95), 3),
      p99: round(percentile(durations, 99), 3),
      max: round(durations.at(-1) ?? 0, 3),
      databaseCallsPerRequest: null,
      databaseHeldPercent: null,
      loopDelayP99: 0,
      loopDelayMax: 0,
      probeP50: 0,
      probeP99: 0,
      probeMax: 0,
    });
  } finally {
    for (const id of ids) {
      try {
        repository.delete(id, PERSON);
      } catch {
        // A project that is already gone is what was wanted.
      }
    }
    await app.close();
    child?.kill();
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
}

function table(results: Phase[]): string {
  const header = [
    'engine',
    '+rtt ms',
    'phase',
    'conc',
    'req/s',
    'p50',
    'p95',
    'p99',
    'max',
    'db/req',
    'held %',
    'loop p99/max',
    'probe p50/p99/max',
  ];
  const rows = results.map((row) => [
    row.engine,
    String(row.rtt),
    row.phase,
    String(row.concurrency),
    String(row.perSecond),
    String(row.p50),
    String(row.p95),
    String(row.p99),
    String(row.max),
    row.databaseCallsPerRequest === null ? '-' : String(row.databaseCallsPerRequest),
    row.databaseHeldPercent === null ? '-' : String(row.databaseHeldPercent),
    `${row.loopDelayP99}/${row.loopDelayMax}`,
    `${row.probeP50}/${row.probeP99}/${row.probeMax}`,
  ]);
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...rows.map((row) => row[column]!.length)),
  );
  const line = (cells: string[]): string =>
    cells.map((cell, column) => cell.padEnd(widths[column]!)).join('  ');
  return [line(header), line(widths.map((width) => '-'.repeat(width))), ...rows.map(line)].join(
    '\n',
  );
}

const options = parse(process.argv.slice(2));
const results: Phase[] = [];
const machine = {
  node: process.version,
  platform: `${process.platform} ${process.arch}`,
  cpus: cpus().length,
  loadAverageAtStart: loadavg().map((value) => round(value, 2)),
};
for (const rtt of options.engine === 'postgres' ? options.rtt : [0]) {
  await measure(options, rtt, results);
}
console.log(
  `Measured on ${machine.cpus} CPUs (${machine.platform}, node ${machine.node}), load average at the start ${machine.loadAverageAtStart.join(' ')}, ${options.seconds} s a phase.`,
);
console.log(
  'Times are milliseconds. "held" is the share of the run that this thread spent waiting for the database. "loop" is how long the event loop went without a turn (99th percentile, longest). "probe" is the time from when a /api/health/live probe was due until it was answered, which includes waiting behind the requests in flight.',
);
console.log(table(results));
for (const traced of traces) {
  console.log(`\n${traced.request}: ${traced.roundTrips} round trips to the database`);
  for (const { count, text } of traced.statements) console.log(`  ${count} x ${text}`);
}
if (options.json) console.log(JSON.stringify({ machine, results, traces }, null, 2));
process.exit(0);
