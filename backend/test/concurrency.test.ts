import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_PROJECTS } from '../../shared/types.js';
import { Repository } from '../src/storage/repository.js';
import type { SqlDatabase } from '../src/storage/sql.js';
import { fixtureInput } from './fixtures.js';
import { around } from './support/concurrent-database.js';
import { newId, runScenario, scenarioDocument, type Scenario } from './support/race-worker.js';

// Rules that hold "when two instances share a database" are claims about writers that run at once. Each
// is made here about the same three things, on every engine this machine can run: a document that
// several writers edit from the same revision, a limit that several writers try to pass together, and a
// job that several workers try to take together. SQLite is raced for real: each writer is a thread
// with a connection of its own to one file. PGlite has one connection in a process, so its writers
// take turns (the outcomes asserted are the same). A real PostgreSQL server is raced the same way as
// SQLite when SWARM_TEST_POSTGRES_URL names an empty database that this test may fill.
const WRITERS = 4;
const ROUNDS = 5;
const JOBS = 12;
const root = fileURLToPath(new URL('../../', import.meta.url));

interface Opened {
  target: string;
  cleanup: () => void;
}
interface Engine {
  name: string;
  /** Whether its writers run at the same moment. */
  parallel: boolean;
  open: () => Opened;
}

const directories: string[] = [];
function sqliteFile(): Opened {
  // Inside the project, where `data/` is ignored by Git, and not in a shared temporary directory.
  mkdirSync(join(root, 'data'), { recursive: true });
  const directory = mkdtempSync(join(root, 'data', 'concurrency-'));
  directories.push(directory);
  return {
    target: join(directory, 'race.sqlite'),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}
afterAll(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const postgres = process.env.SWARM_TEST_POSTGRES_URL;
const engines: Engine[] = [
  { name: 'SQLite', parallel: true, open: sqliteFile },
  {
    name: 'PGlite',
    parallel: false,
    open: () => ({ target: `pglite:race_${Date.now()}`, cleanup: () => undefined }),
  },
  ...(postgres
    ? [
        {
          name: 'PostgreSQL',
          parallel: true,
          open: () => ({ target: postgres, cleanup: () => undefined }),
        },
      ]
    : []),
];

type Message = { type: string; result?: unknown };

function next(worker: Worker, type: string): Promise<Message> {
  return new Promise((resolve, reject) => {
    const onMessage = (message: Message): void => {
      if (message.type !== type) return;
      cleanup();
      resolve(message);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      worker.off('message', onMessage);
      worker.off('error', onError);
    };
    worker.on('message', onMessage);
    worker.once('error', onError);
  });
}

/** Writers that are threads, each with a connection of its own, released together. */
class Racers {
  private constructor(private readonly workers: Worker[]) {}

  static async start(target: string, count: number): Promise<Racers> {
    const url = new URL('./support/race-worker.ts', import.meta.url);
    const workers = Array.from(
      { length: count },
      () => new Worker(url, { workerData: { target }, execArgv: ['--import', 'tsx'] }),
    );
    await Promise.all(workers.map((worker) => once(worker, 'message')));
    return new Racers(workers);
  }

  async race(scenario: Scenario, params: (index: number) => unknown): Promise<unknown[]> {
    const shared = new SharedArrayBuffer(4);
    const armed = this.workers.map((worker) => next(worker, 'armed'));
    const done = this.workers.map((worker) => next(worker, 'result'));
    this.workers.forEach((worker, index) =>
      worker.postMessage({ type: 'round', scenario, params: params(index), gate: shared }),
    );
    await Promise.all(armed);
    Atomics.store(new Int32Array(shared), 0, 1);
    Atomics.notify(new Int32Array(shared), 0);
    return (await Promise.all(done)).map((message) => message.result);
  }

  async stop(): Promise<void> {
    for (const worker of this.workers) worker.postMessage({ type: 'stop' });
    await Promise.all(this.workers.map((worker) => worker.terminate()));
  }
}

const rawOf = (repository: Repository): SqlDatabase =>
  (repository as unknown as { database: SqlDatabase }).database;

/** What every writer should have been told when one wins: asserting it whole shows a surprise in full. */
const oneWinner = (winner: string, others: string): unknown[] =>
  [winner, ...Array.from({ length: WRITERS - 1 }, () => others)].sort();

describe.each(engines)('$name: writers that run at once', (engine) => {
  const owner = { tenantId: `tenant-${newId()}`, ownerId: 'owner' };
  let opened: Opened;
  let parent: Repository;
  let others: Repository[] = [];
  let racers: Racers | null = null;

  beforeAll(async () => {
    opened = engine.open();
    parent = new Repository(opened.target);
    if (engine.parallel) racers = await Racers.start(opened.target, WRITERS);
    else others = Array.from({ length: WRITERS - 1 }, () => new Repository(opened.target));
  });
  afterAll(async () => {
    await racers?.stop();
    for (const repository of others) repository.close();
    parent.close();
    opened.cleanup();
  });

  const compete = async (scenario: Scenario, params: (index: number) => unknown) =>
    racers
      ? racers.race(scenario, params)
      : [parent, ...others].map((repository, index) =>
          runScenario(repository, scenario, params(index)),
        );

  describe('a document that several of them edit from the same revision', () => {
    it('is won by exactly one, and the others are told it changed', async () => {
      const project = parent.create(fixtureInput({ name: 'revision race' }), { owner });
      parent.artifacts.put(project.id, 'scenario', 'default', scenarioDocument('before'));
      const outcomes = await compete('artifact', (index) => ({
        projectId: project.id,
        key: 'default',
        expectedRevision: 1,
        decision: `writer ${index}`,
      }));
      expect([...outcomes].sort()).toEqual(oneWinner('won:2', 'ARTIFACT_CONFLICT'));
      const stored = parent.artifacts.get(project.id, 'scenario');
      expect(stored?.revision).toBe(2);
      // What is stored is the winner's document, whole, and not a mixture.
      expect(stored?.data.decision).toBe(`writer ${outcomes.indexOf('won:2')}`);
    });

    it('is created by exactly one when they all expect that there is none', async () => {
      // Several rounds, because losing at the insert is a matter of timing that one round can miss.
      for (let round = 0; round < ROUNDS; round += 1) {
        const project = parent.create(fixtureInput({ name: `first write race ${round}` }), {
          owner,
        });
        const outcomes = await compete('artifact', (index) => ({
          projectId: project.id,
          key: 'default',
          expectedRevision: 0,
          decision: `first ${index}`,
        }));
        expect([...outcomes].sort()).toEqual(oneWinner('won:1', 'ARTIFACT_CONFLICT'));
        expect(parent.artifacts.get(project.id, 'scenario')?.revision).toBe(1);
      }
    });
  });

  describe('a limit that several of them try to pass together', () => {
    it('lets exactly one of them take the last place, and refuses the rest with the limit', async () => {
      const tenant = `tenant-${newId()}`;
      for (let index = 0; index < MAX_PROJECTS - 1; index += 1) {
        parent.create(fixtureInput({ name: `seed ${index}` }), {
          owner: { tenantId: tenant, ownerId: 'seeder' },
        });
      }
      const outcomes = await compete('create', (index) => ({
        tenantId: tenant,
        ownerId: `racer-${index}`,
        name: `racer ${index}`,
      }));
      expect([...outcomes].sort()).toEqual(oneWinner('won', 'PROJECT_LIMIT'));
      expect(parent.count(tenant)).toBe(MAX_PROJECTS);
    });
  });

  describe('a job that several workers try to take together', () => {
    it('is taken by exactly one worker, with one lease, on its first attempt', async () => {
      const project = parent.create(fixtureInput({ name: 'queue race' }), { owner });
      const queued = Array.from(
        { length: JOBS },
        (_, index) =>
          parent.jobs.enqueue({
            id: newId(),
            projectId: project.id,
            kind: 'quick',
            idempotencyKey: `race-${index}`,
          }).job.id,
      );
      let claims: Record<string, string[]>;
      if (racers) {
        const results = (await racers.race('claim', (index) => ({ owner: `worker-${index}` }))) as {
          claimed: string[];
        }[];
        claims = Object.fromEntries(
          results.map((result, index) => [`worker-${index}`, result.claimed]),
        );
      } else {
        // One at a time, in turn, so that every worker has had its chance at every job.
        const workers = [parent, ...others];
        claims = Object.fromEntries(workers.map((_, index) => [`worker-${index}`, [] as string[]]));
        for (let more = true; more;) {
          more = false;
          workers.forEach((repository, index) => {
            const job = repository.jobs.claim(`worker-${index}`, 30_000);
            if (job) {
              claims[`worker-${index}`]!.push(job.id);
              more = true;
            }
          });
        }
      }
      const taken = Object.values(claims).flat();
      expect([...taken].sort()).toEqual([...queued].sort());
      for (const [worker, ids] of Object.entries(claims)) {
        for (const id of ids) {
          const job = parent.jobs.get(id);
          expect(job, id).toMatchObject({ state: 'running', attempt: 1, leaseOwner: worker });
        }
      }
    });
  });
});

describe('SQLite: a second connection commits between the limit check and the insert', () => {
  it('cannot take the place that the check counted on', () => {
    const { target, cleanup } = sqliteFile();
    const first = new Repository(target);
    const second = new Repository(target);
    try {
      const tenant = 'tenant-interleaved';
      for (let index = 0; index < MAX_PROJECTS - 1; index += 1) {
        first.create(fixtureInput({ name: `seed ${index}` }), {
          owner: { tenantId: tenant, ownerId: 'seeder' },
        });
      }
      // The other connection must not wait for a lock held by this thread: it would wait for ever.
      rawOf(second).exec('PRAGMA busy_timeout = 0');
      let rival: unknown = 'never ran';
      let fired = false;
      const counted = first as unknown as { database: SqlDatabase };
      counted.database = around(rawOf(first), (sql, statement) =>
        /^SELECT COUNT\(\*\) AS count FROM projects WHERE tenant_id/u.test(sql)
          ? {
              get: (...values) => {
                const row = statement.get(...values);
                if (!fired) {
                  fired = true;
                  // The rival makes its move right after the count has been read.
                  try {
                    second.create(fixtureInput({ name: 'rival' }), {
                      owner: { tenantId: tenant, ownerId: 'rival' },
                    });
                    rival = 'created';
                  } catch (error) {
                    rival = (error as Error).message;
                  }
                }
                return row;
              },
            }
          : undefined,
      );
      first.create(fixtureInput({ name: 'first' }), {
        owner: { tenantId: tenant, ownerId: 'first' },
      });
      // Whichever of the two was let in first, the tenant is at its limit and not beyond it.
      expect(first.count(tenant), String(rival)).toBe(MAX_PROJECTS);
      expect(rival).toMatch(/locked|busy|PROJECT_LIMIT|limit/iu);
    } finally {
      first.close();
      second.close();
      cleanup();
    }
  });
});
