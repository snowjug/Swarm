import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import type { ServerConfig } from '../src/config.js';
import { AppError } from '../src/errors.js';
import { Orchestrator } from '../src/orchestration/runner.js';
import { Repository } from '../src/storage/repository.js';
import { fixtureInput, testConfig } from './fixtures.js';
import {
  graph,
  modelEnvironment,
  ontology,
  personas,
  prepared,
  ScriptedProvider,
} from './model-fixtures.js';

const LEASE = 10_000;
// One decision per proxy per platform per round.
const PER_ROUND = 4 * 2;
const WAIT = { timeout: 20_000, interval: 20 };

type Harness = Awaited<ReturnType<typeof buildApp>>;
const applications: Harness[] = [];
const workers: Orchestrator[] = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.stop()));
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

interface Rig {
  h: Harness;
  repository: Repository;
  provider: ScriptedProvider;
  clock: { now: number };
  id: string;
  failures: [string, string][];
  /** Another process working the same queue. */
  worker(workerId: string, role?: ServerConfig['role']): Orchestrator;
  /** The newest job of the project. */
  job(): ReturnType<Repository['jobs']['recent']>[number];
  /** Holds every actor call from number `from` on, until `release` is called. */
  holdFrom(from: number): () => void;
}

/**
 * A model-assisted guided project with its knowledge and environment stages done, on a queue whose
 * clock a test sets by hand, with no timers: a test does the heartbeat and the upkeep itself, which
 * is what makes a stalled or crashed worker something it can arrange.
 */
async function rig(
  options: { rounds?: number; retryDelayMs?: number; extra?: Record<string, string> } = {},
): Promise<Rig> {
  const clock = { now: 1_000_000 };
  const provider = new ScriptedProvider([ontology, graph, personas, prepared]);
  const config = testConfig({ ...modelEnvironment, ...options.extra });
  const repository = new Repository(':memory:', {
    now: () => clock.now,
    retryDelayMs: () => options.retryDelayMs ?? 0,
  });
  const h = await buildApp({
    config,
    repository,
    modelFactory: provider.factory,
    jobs: { timers: false, workerId: 'worker-a', leaseMs: LEASE },
  });
  applications.push(h);
  const failures: [string, string][] = [];
  const { id } = repository.create(
    fixtureInput({
      workflow: 'guided',
      settings: {
        mode: 'llm',
        agentCount: 4,
        rounds: options.rounds ?? 4,
        seed: 7,
        network: 'community',
      },
    }),
  );
  for (const step of ['knowledge', 'environment'] as const) {
    h.jobs.enqueueStep(id, step);
    await h.jobs.idle();
    clock.now += 1_000;
  }
  return {
    h,
    repository,
    provider,
    clock,
    id,
    failures,
    worker: (workerId, role = 'all') => {
      const worker = new Orchestrator(
        repository,
        config,
        (projectId, code) => failures.push([projectId, code]),
        provider.factory,
        { timers: false, workerId, leaseMs: LEASE, role },
      );
      workers.push(worker);
      return worker;
    },
    job: () => repository.jobs.recent(id)[0]!,
    holdFrom: (from) => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      provider.onActorCall = (index) => {
        if (index === from) provider.gate = held;
      };
      return () => {
        provider.onActorCall = null;
        provider.gate = null;
        release();
      };
    },
  };
}

const roundsOf = (r: Rig, round: number) =>
  r.provider.actorCalls.filter((call) => call.data.round === round).length;

describe('a stalled worker', () => {
  it('has its simulation continued from the saved round by another worker, and cannot write over it', async () => {
    const r = await rig({ rounds: 4 });
    const worker = r.h.jobs;
    // Worker A is held in the middle of round 3: rounds 1 and 2 are saved.
    const release = r.holdFrom(2 * PER_ROUND);
    worker.enqueueStep(r.id, 'simulation');
    await vi.waitFor(
      () => expect(r.provider.actorCalls.length).toBeGreaterThan(2 * PER_ROUND),
      WAIT,
    );
    expect(r.repository.get(r.id).rounds).toHaveLength(2);
    const held = r.job();
    expect(held).toMatchObject({ state: 'running', attempt: 1, leaseOwner: 'worker-a' });
    const callsWhenStalled = r.provider.actorCalls.length;

    // It stops answering. Its lease runs out, and worker B hands the job to itself.
    r.clock.now += LEASE + 1;
    const b = r.worker('worker-b');
    r.provider.gate = null;
    r.provider.onActorCall = null;
    b.maintain();
    expect(r.job()).toMatchObject({
      id: held.id,
      state: 'running',
      attempt: 2,
      leaseOwner: 'worker-b',
    });
    await b.idle();

    const finished = r.repository.get(r.id);
    expect(r.job()).toMatchObject({ id: held.id, state: 'completed', attempt: 2, errorCode: null });
    expect(finished.console?.steps.simulation).toBe('ready');
    expect(finished.rounds).toHaveLength(4);
    // Rounds 1 and 2 were not computed again: only rounds 3 and 4 were.
    expect(r.provider.actorCalls.length - callsWhenStalled).toBe(2 * PER_ROUND);
    expect(roundsOf(r, 1)).toBe(PER_ROUND);
    expect(roundsOf(r, 2)).toBe(PER_ROUND);
    expect(finished.events.map((event) => event.message)).toContain(
      'Resuming from the saved state after round 2; rounds 1-2 are not recomputed.',
    );

    // A wakes up. It learns that the job is not its own, and its late answers go nowhere.
    const snapshot = JSON.stringify(finished);
    const callsBefore = r.provider.calls.length;
    worker.heartbeat();
    release();
    await worker.idle();
    expect(JSON.stringify(r.repository.get(r.id))).toBe(snapshot);
    expect(r.provider.calls.length).toBe(callsBefore);
    expect(r.job()).toMatchObject({ id: held.id, state: 'completed', attempt: 2 });
    expect(r.failures).toEqual([]);

    // The lineage is still valid: a branch from round 2 of the resumed run carries its first two rounds.
    const branch = await r.h.app.inject({
      method: 'POST',
      url: `/api/projects/${r.id}/branches`,
      payload: { fromRound: 2, name: 'Branch after the hand-over' },
    });
    expect(branch.statusCode, branch.body).toBe(201);
    const created = branch.json<{ parentId: string; rounds: unknown[] }>();
    expect(created.parentId).toBe(r.id);
    expect(created.rounds).toEqual(finished.rounds.slice(0, 2));
  });
});

describe('a crash', () => {
  it('leaves a queued job to be run by whichever process starts next, with nothing lost', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'swarm-jobs-'));
    directories.push(directory);
    const path = join(directory, 'swarm.sqlite');
    const first = await buildApp({
      config: testConfig(),
      repository: new Repository(path),
      jobs: { role: 'api', timers: false },
    });
    const { id } = first.repository.create(fixtureInput({ workflow: 'guided' }));
    first.jobs.enqueueStep(id, 'knowledge');
    await first.jobs.idle();
    // The API only queues: nothing ran, and the job is on disk.
    expect(first.repository.jobs.recent(id)[0]).toMatchObject({ state: 'queued', attempt: 0 });
    expect(first.repository.get(id).console?.steps.knowledge).toBe('queued');
    await first.app.close();

    const second = await buildApp({
      config: testConfig(),
      repository: new Repository(path),
      jobs: { timers: false, workerId: 'worker-2' },
    });
    applications.push(second);
    // Starting up did not mark the run failed: the queue still owns it.
    expect(second.repository.get(id).status).toBe('queued');
    await second.jobs.idle();
    expect(second.repository.get(id).console?.steps.knowledge).toBe('ready');
    expect(second.repository.jobs.recent(id)[0]).toMatchObject({ state: 'completed', attempt: 1 });
  });

  it('does not stop another worker\u2019s run when an API process starts', async () => {
    const r = await rig({ rounds: 3 });
    const release = r.holdFrom(PER_ROUND);
    r.h.jobs.enqueueStep(r.id, 'simulation');
    await vi.waitFor(() => expect(r.provider.actorCalls.length).toBeGreaterThan(PER_ROUND), WAIT);
    // Another API replica starts while the run is in progress.
    r.repository.recoverInterrupted();
    expect(r.repository.get(r.id).status).toBe('running');
    expect(r.job().state).toBe('running');
    release();
    await r.h.jobs.idle();
    expect(r.repository.get(r.id).console?.steps.simulation).toBe('ready');
  });

  it('is retried a bounded number of times and then set aside as poison, and the run says so', async () => {
    const r = await rig({ retryDelayMs: 1_000 });
    const api = r.worker('api-1', 'api');
    api.enqueueStep(r.id, 'simulation');
    const queued = r.job();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      r.clock.now += 1_001;
      // A worker takes the job and is never heard from again.
      expect(r.repository.jobs.claim(`doomed-${attempt}`, LEASE)?.attempt).toBe(attempt);
      r.clock.now += LEASE + 1;
      api.maintain();
      expect(r.job().state).toBe(attempt < 3 ? 'retrying' : 'failed');
    }
    expect(r.job()).toMatchObject({ id: queued.id, errorCode: 'JOB_POISONED' });
    const project = r.repository.get(r.id);
    expect(project.status).toBe('failed');
    expect(project.error).toContain('stopped responding on every attempt');
    expect(project.console?.steps.simulation).toBe('failed');
    expect(r.failures).toEqual([[r.id, 'JOB_POISONED']]);
    // A person can start it again.
    r.h.jobs.enqueueStep(r.id, 'simulation');
    await r.h.jobs.idle();
    expect(r.job().state).toBe('completed');
  });

  it('shows a run waiting for its next attempt as queued, not as running', async () => {
    const r = await rig({ retryDelayMs: 60_000 });
    const api = r.worker('api-1', 'api');
    api.enqueueStep(r.id, 'simulation');
    r.clock.now += 61_000;
    expect(r.repository.jobs.claim('doomed', LEASE)?.attempt).toBe(1);
    r.clock.now += LEASE + 1;
    api.maintain();
    const project = r.repository.get(r.id);
    expect(r.job().state).toBe('retrying');
    expect(project.status).toBe('queued');
    expect(project.console?.steps.simulation).toBe('queued');
    expect(project.events.at(-1)?.message).toContain('stopped responding');
    expect(project.events.at(-1)?.message).toContain('attempt 2 of 3');
    // Nothing takes it before its delay has passed.
    const worker = r.worker('worker-b');
    worker.maintain();
    expect(r.job().state).toBe('retrying');
    r.clock.now += 60_001;
    await worker.idle();
    expect(r.job()).toMatchObject({ state: 'completed', attempt: 2 });
  });

  it('expires a run that no worker took in time, instead of running it late', async () => {
    const r = await rig();
    const api = r.worker('api-1', 'api');
    api.enqueueStep(r.id, 'simulation');
    r.clock.now += 3 * 60 * 60_000;
    api.maintain();
    expect(r.job()).toMatchObject({ state: 'expired', errorCode: 'JOB_EXPIRED' });
    expect(r.repository.get(r.id).status).toBe('failed');
    expect(r.failures).toEqual([[r.id, 'JOB_EXPIRED']]);
    const worker = r.worker('worker-b');
    await worker.idle();
    expect(r.provider.actorCalls).toHaveLength(0);
  });
});

describe('a backend that is stopped', () => {
  it('hands its job back without spending an attempt, and the next worker continues from the saved round', async () => {
    const r = await rig({ rounds: 3 });
    let stopped: Promise<void> | undefined;
    r.provider.onActorCall = (index) => {
      if (index === PER_ROUND) stopped = r.h.jobs.stop();
    };
    r.h.jobs.enqueueStep(r.id, 'simulation');
    await vi.waitFor(() => expect(stopped).toBeDefined(), WAIT);
    await stopped;
    r.provider.onActorCall = null;

    expect(r.job()).toMatchObject({
      state: 'queued',
      attempt: 0,
      errorCode: 'JOB_RELEASED',
      leaseOwner: null,
    });
    const project = r.repository.get(r.id);
    expect(project.status).toBe('queued');
    expect(project.rounds).toHaveLength(1);
    expect(project.events.at(-1)?.message).toContain('queued again');
    // A stopped backend takes no new work.
    expect(() => r.h.jobs.enqueueStep(r.id, 'simulation')).toThrow('stopping');

    const callsBefore = r.provider.actorCalls.length;
    const next = r.worker('worker-b');
    await next.idle();
    expect(r.job()).toMatchObject({ state: 'completed', attempt: 1 });
    expect(r.repository.get(r.id).rounds).toHaveLength(3);
    expect(r.provider.actorCalls.length - callsBefore).toBe(2 * PER_ROUND);
    expect(roundsOf(r, 1)).toBe(PER_ROUND);
  });
});

describe('stopping a run that another process is working on', () => {
  it('cancels it through the queue, and no further model work is done', async () => {
    const r = await rig({ rounds: 4 });
    const release = r.holdFrom(PER_ROUND);
    r.h.jobs.enqueueStep(r.id, 'simulation');
    await vi.waitFor(() => expect(r.provider.actorCalls.length).toBeGreaterThan(PER_ROUND), WAIT);

    // The API process cannot reach the worker's memory: it can only write the request down.
    const api = r.worker('api-1', 'api');
    api.cancel(r.id);
    expect(r.job().state).toBe('cancelling');
    expect(api.isBusy(r.id)).toBe(true);
    // Asking again changes nothing.
    expect(() => api.cancel(r.id)).not.toThrow();
    const callsAtCancel = r.provider.calls.length;

    // The worker finds out at its next heartbeat, and stops.
    r.h.jobs.heartbeat();
    release();
    await r.h.jobs.idle();
    expect(r.provider.calls.length).toBe(callsAtCancel);
    expect(r.job()).toMatchObject({
      state: 'cancelled',
      errorCode: 'RUN_CANCELLED',
      leaseOwner: null,
    });
    const project = r.repository.get(r.id);
    expect(project.status).toBe('cancelled');
    expect(project.console?.steps.simulation).toBe('cancelled');
    expect(api.isBusy(r.id)).toBe(false);
  });

  it('pauses it at the saved round through the queue, and resumes it from there', async () => {
    const r = await rig({ rounds: 3 });
    const release = r.holdFrom(PER_ROUND);
    r.h.jobs.enqueueStep(r.id, 'simulation');
    await vi.waitFor(() => expect(r.provider.actorCalls.length).toBeGreaterThan(PER_ROUND), WAIT);
    const api = r.worker('api-1', 'api');
    api.pause(r.id);
    expect(r.job()).toMatchObject({ state: 'running', pauseRequested: true });
    r.h.jobs.heartbeat();
    release();
    await r.h.jobs.idle();
    expect(r.job().state).toBe('paused');
    const paused = r.repository.get(r.id);
    expect(paused.console?.steps.simulation).toBe('paused');
    expect(paused.rounds).toHaveLength(1);
    expect(api.isBusy(r.id)).toBe(false);

    r.clock.now += 1_000;
    r.h.jobs.enqueueStep(r.id, 'simulation', true);
    await r.h.jobs.idle();
    expect(r.repository.get(r.id).rounds).toHaveLength(3);
    expect(r.job()).toMatchObject({ state: 'completed', kind: 'simulation' });
    expect(roundsOf(r, 1)).toBe(PER_ROUND);
  });

  it('takes a run that had not started out of the queue at once', async () => {
    const r = await rig();
    const api = r.worker('api-1', 'api');
    api.enqueueStep(r.id, 'simulation');
    api.cancel(r.id);
    expect(r.job()).toMatchObject({ state: 'cancelled', attempt: 0 });
    expect(r.repository.get(r.id).status).toBe('cancelled');
    const worker = r.worker('worker-b');
    await worker.idle();
    expect(r.provider.actorCalls).toHaveLength(0);
  });
});

describe('a failure during a simulation', () => {
  it('that may pass is tried again from the saved round, by the queue, without anyone clicking', async () => {
    const r = await rig({ rounds: 3 });
    let failed = false;
    r.provider.onActorCall = (index) => {
      if (index === 2 * PER_ROUND && !failed) {
        failed = true;
        throw new AppError(503, 'MODEL_TIMEOUT', 'The model provider timed out.');
      }
    };
    r.h.jobs.enqueueStep(r.id, 'simulation');
    await r.h.jobs.idle();
    expect(failed).toBe(true);
    expect(r.job()).toMatchObject({ state: 'completed', attempt: 2, errorCode: null });
    const project = r.repository.get(r.id);
    expect(project.console?.steps.simulation).toBe('ready');
    expect(project.rounds).toHaveLength(3);
    expect(project.events.map((event) => event.message).join('\n')).toContain(
      'MODEL_TIMEOUT: the model provider did not answer. Attempt 2 of 3 will continue from the last saved round.',
    );
    expect(roundsOf(r, 1)).toBe(PER_ROUND);
    expect(roundsOf(r, 2)).toBe(PER_ROUND);
  });

  it('that will not pass is not tried again; its saved rounds are kept and it is recorded as partial', async () => {
    const r = await rig({ rounds: 3 });
    let failed = false;
    r.provider.onActorCall = (index) => {
      if (index === 2 * PER_ROUND && !failed) {
        failed = true;
        throw new AppError(502, 'MODEL_OUTPUT_INVALID', 'The model output did not match.');
      }
    };
    r.h.jobs.enqueueStep(r.id, 'simulation');
    await r.h.jobs.idle();
    r.provider.onActorCall = null;
    expect(r.job()).toMatchObject({
      state: 'partial',
      attempt: 1,
      errorCode: 'MODEL_OUTPUT_INVALID',
    });
    const project = r.repository.get(r.id);
    expect(project.status).toBe('failed');
    expect(project.rounds).toHaveLength(2);
    expect(r.h.jobs.isBusy(r.id)).toBe(false);

    // The saved rounds are what a person resumes from.
    r.clock.now += 1_000;
    r.h.jobs.enqueueStep(r.id, 'simulation', true);
    await r.h.jobs.idle();
    expect(r.job().state).toBe('completed');
    expect(r.repository.get(r.id).rounds).toHaveLength(3);
  });

  it('is not retried when it saved nothing: that is a failure for a person to see', async () => {
    const r = await rig({ rounds: 3 });
    r.provider.onActorCall = (index) => {
      if (index === 0) throw new AppError(503, 'MODEL_TIMEOUT', 'The model provider timed out.');
    };
    r.h.jobs.enqueueStep(r.id, 'simulation');
    await r.h.jobs.idle();
    r.provider.onActorCall = null;
    expect(r.job()).toMatchObject({ state: 'failed', attempt: 1, errorCode: 'MODEL_TIMEOUT' });
    expect(r.repository.get(r.id).status).toBe('failed');
  });
});

describe('the queue as seen from outside', () => {
  it('lets a process that only queues leave the work to a worker', async () => {
    const r = await rig();
    const api = r.worker('api-1', 'api');
    api.enqueueStep(r.id, 'simulation');
    await api.idle();
    expect(r.job().state).toBe('queued');
    expect(api.state()).toEqual({ active: null, pending: 1 });
    const worker = r.worker('worker-b');
    await worker.idle();
    expect(r.job().state).toBe('completed');
    expect(worker.summary()).toMatchObject({ role: 'all', oldestWaitingMs: null });
    expect(worker.summary().counts.completed).toBe(3);
  });

  it('makes a repeated request with the same Idempotency-Key one job, and refuses a different key while busy', async () => {
    const r = await rig();
    // An API-only process in front of the same queue: it queues, and leaves the work to a worker.
    const front = await buildApp({
      config: testConfig(modelEnvironment),
      repository: r.repository,
      modelFactory: r.provider.factory,
      jobs: { role: 'api', timers: false },
    });
    const send = (key: string | undefined) =>
      front.app.inject({
        method: 'POST',
        url: `/api/projects/${r.id}/steps/simulation`,
        headers: key === undefined ? {} : { 'idempotency-key': key },
        payload: {},
      });
    expect((await send('request-0001')).statusCode).toBe(202);
    expect((await send('request-0001')).statusCode).toBe(202);
    const simulations = () =>
      r.repository.jobs.recent(r.id).filter((job) => job.kind === 'simulation');
    expect(simulations()).toHaveLength(1);
    const other = await send('request-0002');
    expect(other.statusCode).toBe(409);
    expect(other.json<{ error: { code: string } }>().error.code).toBe('RUN_ACTIVE');
    expect((await send(undefined)).statusCode).toBe(409);
    expect((await send('not a valid key!')).statusCode).toBe(400);
    expect(simulations()).toHaveLength(1);
    // The worker runs the one job; sending the same key after it finished still makes no second job.
    await r.h.jobs.idle();
    expect(simulations()[0]?.state).toBe('completed');
    expect((await send('request-0001')).statusCode).toBe(202);
    expect(simulations()).toHaveLength(1);
  });
  it('lists the jobs of a project without the identity of the worker or the key', async () => {
    const r = await rig();
    const response = await r.h.app.inject({ method: 'GET', url: `/api/projects/${r.id}/jobs` });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ jobs: Record<string, unknown>[] }>();
    expect(body.jobs.map((job) => job.kind)).toEqual(['environment', 'knowledge']);
    for (const job of body.jobs) {
      expect(Object.keys(job).sort()).toEqual([
        'attempt',
        'createdAt',
        'errorCode',
        'finishedAt',
        'id',
        'kind',
        'maxAttempts',
        'state',
        'updatedAt',
      ]);
      expect(job.state).toBe('completed');
    }
    expect(JSON.stringify(body)).not.toContain('worker-a');
  });
});
