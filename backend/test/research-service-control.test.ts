import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RESEARCH_BUDGET,
  RESEARCH_STOP_LABELS,
  type ResearchView,
} from '../../shared/research.js';
import { Orchestrator } from '../src/orchestration/runner.js';
import { PauseControl } from '../src/research/pause.js';
import { newRun } from '../src/research/store.js';
import { testConfig } from './fixtures.js';
import { HARBOUR, harbourWeb, researchApp, type ResearchApp } from './support/research-app.js';
import { drive, type Route } from './support/research-world.js';

const json = (response: { json(): unknown }) => response.json() as ResearchView;
const failure = (response: { json(): unknown }) =>
  (response.json() as { error: { code: string; message: string } }).error;
const messages = (app: ResearchApp, id: string): string[] =>
  app.run(id)?.events.map((event) => event.message) ?? [];

/** A web that tells a test each time one of its pages is asked for, before the page is answered. */
function watched(web: Record<string, Route>, when: (pages: number) => void): Record<string, Route> {
  let pages = 0;
  return Object.fromEntries(
    Object.entries(web).map(([url, route]) => [
      url,
      (call: number, address: string) => {
        pages += 1;
        when(pages);
        return typeof route === 'function' ? route(call, address) : route;
      },
    ]),
  );
}

/** An application whose web calls `act` when its `at`-th page is asked for: for a test that acts in the middle of a run. */
async function midway(at: number, options: Parameters<typeof researchApp>[0] = {}) {
  const plan = { act: (): void => undefined };
  const app = await researchApp({
    ...options,
    web: watched(options.web ?? harbourWeb(), (pages) => {
      if (pages === at) plan.act();
    }),
  });
  const id = await app.create();
  return {
    app,
    id,
    on: (act: () => void) => {
      plan.act = act;
    },
    start: () => app.post(id, '', { intake: { url: `${HARBOUR}/` } }),
  };
}

describe('pausing and resuming', () => {
  it('holds a run where it is, reads nothing while it is held, keeps the job, and goes on when resumed', async () => {
    const { app, id, on, start } = await midway(2);
    on(() => app.research.pause(id));
    await start();
    await app.runUntil(() => app.run(id)?.status === 'paused');
    await app.turns(300);
    const asked = app.network.pagesAsked().length;
    await app.turns(300);
    expect(app.network.pagesAsked()).toHaveLength(asked);
    expect(app.run(id)).toMatchObject({ status: 'paused', stage: 'reading' });
    // The job still holds its place, and the run says what it may do: it may be cancelled, and not paused again.
    expect(app.repository.jobs.live(id)).toMatchObject({ state: 'running' });
    expect((await app.view(id)).may).toEqual({ start: false, pause: false, cancel: true });
    const again = await app.post(id, '/pause');
    expect(again.statusCode).toBe(409);
    expect(failure(again).code).toBe('RESEARCH_NOT_PAUSABLE');

    const resumed = await app.post(id, '/resume');
    expect(resumed.statusCode).toBe(200);
    expect(json(resumed).run?.status).toBe('running');
    await app.settle();
    expect(app.run(id)).toMatchObject({
      status: 'completed',
      stoppedBecause: 'frontier-exhausted',
    });
    expect(app.run(id)?.used.pages).toBe(5);
    expect(messages(app, id)).toEqual(
      expect.arrayContaining([
        'Paused. It ends by itself with what has been read if it stays paused too long.',
        'Resumed.',
      ]),
    );
    expect(app.repository.get(id).status).toBe('ready');
  });

  it('ends by itself, with what it had read, when it is left paused for as long as it may be', async () => {
    const { app, id, on, start } = await midway(2, { seam: { maxPauseMs: 30 } });
    on(() => app.research.pause(id));
    await start();
    await app.runUntil(() => app.run(id)?.status === 'paused');
    await new Promise((resolve) => setTimeout(resolve, 150));
    await app.settle();
    const run = app.run(id);
    expect(run).toMatchObject({
      status: 'completed',
      stage: 'ready',
      stoppedBecause: 'time-limit',
    });
    expect(run?.used.pages).toBeLessThan(5);
    expect(messages(app, id)).toEqual(
      expect.arrayContaining([
        'The pause lasted too long, so research ends with what has been read.',
        RESEARCH_STOP_LABELS['time-limit'],
      ]),
    );
    expect(app.repository.get(id).documents.length).toBeGreaterThan(0);
    expect(app.repository.get(id).status).toBe('ready');
  });
});

describe('the gate a pause holds a run at', () => {
  it('opens by itself when the pause has lasted as long as it may, and a pause that has run out cannot be taken again', async () => {
    const gate = new PauseControl();
    const signal = new AbortController().signal;
    let expired = 0;
    gate.pause(10, () => (expired += 1));
    expect(gate.closed).toBe(true);
    const waiting = gate.waitIfPaused(signal);
    await waiting;
    expect(expired).toBe(1);
    expect(gate).toMatchObject({ closed: false, expired: true });
    gate.pause(10, () => (expired += 1));
    expect(gate.closed).toBe(false);
    await gate.waitIfPaused(signal);
    expect(expired).toBe(1);
  });

  it('lets go of whoever is waiting when the run is cancelled, and of its timer when the run ends', async () => {
    const gate = new PauseControl();
    const controller = new AbortController();
    gate.pause(60_000, () => undefined);
    const waiting = gate.waitIfPaused(controller.signal);
    controller.abort(new Error('cancelled'));
    await expect(waiting).rejects.toThrow('cancelled');
    gate.dispose();
    expect(gate.closed).toBe(false);
    expect(gate.expired).toBe(false);
  });
});

describe('finishing early', () => {
  it('goes on with what has been read: it is not a cancellation, and the project is grounded from it', async () => {
    const { app, id, on, start } = await midway(2);
    on(() => app.research.pause(id));
    await start();
    await app.runUntil(() => app.run(id)?.status === 'paused');
    const finished = await app.post(id, '/finish');
    expect(finished.statusCode).toBe(200);
    await app.settle();
    const run = app.run(id);
    expect(run).toMatchObject({ status: 'completed', stage: 'ready', stoppedBecause: 'cancelled' });
    expect(run?.used.pages).toBeLessThan(5);
    expect(messages(app, id)).toEqual(
      expect.arrayContaining([
        'A person asked to finish with what had been read.',
        RESEARCH_STOP_LABELS.cancelled,
      ]),
    );
    expect(app.repository.get(id)).toMatchObject({ status: 'ready' });
    expect(app.repository.get(id).documents.length).toBeGreaterThan(0);
    expect(app.actions(id)).toContain('research.documents.added');
  });

  it('ends cancelled when nothing had been read, and leaves the project waiting for a source', async () => {
    const { app, id, on, start } = await midway(1, { web: { [`${HARBOUR}/`]: { status: 404 } } });
    on(() => app.research.finish(id));
    await start();
    await app.settle();
    expect(app.run(id)).toMatchObject({ status: 'cancelled', stoppedBecause: 'cancelled' });
    expect(messages(app, id).at(-1)).toBe('Research was stopped, and nothing had been read.');
    expect(app.repository.get(id)).toMatchObject({ status: 'draft', documents: [] });
    expect(app.repository.get(id).console?.steps.knowledge).toBe('pending');
    expect((await app.view(id)).may.start).toBe(true);
  });
});

describe('cancelling', () => {
  it('stops a run in the middle of reading and leaves no half-written state, and a new run can be started afterwards', async () => {
    const { app, id, on, start } = await midway(3);
    on(() => app.research.cancel(id));
    await start();
    await app.settle();

    const run = app.run(id);
    expect(run).toMatchObject({
      status: 'cancelled',
      stoppedBecause: 'cancelled',
      stage: 'reading',
    });
    expect(run?.finishedAt).toBeDefined();
    expect(messages(app, id)).toContain('Research was cancelled.');
    // Nothing of a run that was cancelled is in the project: no source, no passage, no record of adding any.
    const project = app.repository.get(id);
    expect(project.documents).toEqual([]);
    expect(app.repository.chunks(id)).toEqual([]);
    expect(app.actions(id)).not.toContain('research.documents.added');
    expect(project.status).toBe('cancelled');
    expect(project.console?.steps.knowledge).toBe('cancelled');
    expect(app.repository.jobs.recent(id, 1)[0]?.state).toBe('cancelled');
    expect((await app.view(id)).may).toEqual({ start: true, pause: false, cancel: false });
    expect(app.actions(id)).toEqual(['project.created', 'research.started', 'research.ended']);

    // And it is not poisoned: the person starts again, and it runs to the end.
    on(() => undefined);
    const again = await start();
    expect(again.statusCode).toBe(202);
    await app.settle();
    expect(app.run(id)).toMatchObject({ status: 'completed', stage: 'ready' });
    expect(app.run(id)?.id).toMatch(/^rr-0002-/u);
    expect(app.repository.get(id)).toMatchObject({ status: 'ready' });
  });

  it('stops a run that has not started, so that nothing reads and nothing waits for it', async () => {
    const app = await researchApp();
    const id = await app.create();
    // In one turn of the event loop, before the worker takes the job.
    app.research.start(id, { intake: { url: `${HARBOUR}/` } }, 'tester');
    const view = app.research.cancel(id);
    expect(view.run).toMatchObject({ status: 'cancelled', stoppedBecause: 'cancelled' });
    await app.settle();
    expect(app.run(id)?.events.at(-1)?.message).toBe('Research was cancelled before it started.');
    expect(app.network.calls).toEqual([]);
    expect(app.repository.jobs.live(id)).toBeNull();
    expect(app.repository.get(id).documents).toEqual([]);
  });

  it('says plainly what cannot be done now, and to a project that does not exist says it does not exist', async () => {
    const app = await researchApp();
    const id = await app.create();
    const refusals: [string, number, string][] = [
      ['/pause', 409, 'RESEARCH_NOT_PAUSABLE'],
      ['/resume', 409, 'RESEARCH_NOT_PAUSED'],
      ['/finish', 409, 'RESEARCH_NOT_FINISHABLE'],
      ['/cancel', 409, 'RESEARCH_NOT_ACTIVE'],
    ];
    for (const [path, status, code] of refusals) {
      const response = await app.post(id, path);
      expect(response.statusCode, path).toBe(status);
      expect(failure(response).code, path).toBe(code);
      const missing = await app.post('00000000-0000-4000-8000-000000000000', path);
      expect(missing.statusCode, path).toBe(404);
      expect(failure(missing).code, path).toBe('PROJECT_NOT_FOUND');
    }
    expect((await app.post('not-an-id', '/cancel')).statusCode).toBe(400);
  });
});

describe('two requests for the same thing', () => {
  it('makes one run and one job of a double click, and refuses the second as a run that is already live', async () => {
    const app = await researchApp();
    const id = await app.create();
    const body = { intake: { url: `${HARBOUR}/` } };
    const [first, second] = await Promise.all([app.post(id, '', body), app.post(id, '', body)]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([202, 409]);
    const refused = first.statusCode === 409 ? first : second;
    expect(failure(refused).code).toBe('RESEARCH_ACTIVE');
    expect(app.research.store.count(id)).toBe(1);
    expect(app.repository.jobs.recent(id)).toHaveLength(1);
    await app.settle();
    expect(app.run(id)).toMatchObject({ status: 'completed' });
  });

  it('makes one run of a request that is repeated with its key, and a second of one with another key only when the first is over', async () => {
    const app = await researchApp();
    const id = await app.create();
    const body = { intake: { url: `${HARBOUR}/` } };
    const key = { 'idempotency-key': 'research-start-0001' };
    const first = await app.post(id, '', body, key);
    const repeat = await app.post(id, '', body, key);
    expect([first.statusCode, repeat.statusCode]).toEqual([202, 202]);
    expect(json(repeat).run?.id).toBe(json(first).run?.id);
    expect(app.research.store.count(id)).toBe(1);
    expect(app.repository.jobs.recent(id)).toHaveLength(1);
    const other = await app.post(id, '', body, { 'idempotency-key': 'research-start-0002' });
    expect(other.statusCode).toBe(409);
    expect((await app.post(id, '', body, { 'idempotency-key': 'short' })).statusCode).toBe(400);
    await app.settle();
    // A request repeated after it has finished is still the one it repeats: it starts nothing.
    const late = await app.post(id, '', body, key);
    expect(late.statusCode).toBe(202);
    expect(json(late).run?.id).toBe(json(first).run?.id);
    expect(app.research.store.count(id)).toBe(1);
  });

  it('leaves no run waiting for a job that was refused', async () => {
    const app = await researchApp();
    const id = await app.create(undefined, {
      workflow: 'quick',
      research: undefined,
      documents: [
        {
          name: 'own-notes.txt',
          content:
            'The harbour authority publishes its berthing fees once a year, in a schedule that the board votes on in public.',
        },
      ],
    });
    const response = await app.post(id, '', { intake: { url: `${HARBOUR}/` } });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(app.research.store.count(id)).toBe(0);
    expect(app.repository.jobs.recent(id)).toEqual([]);
    expect(app.actions(id)).toEqual(['project.created']);
  });
});

describe('a server that stops, and one that starts again', () => {
  it('puts a run that was cut off back in the queue, and the next worker carries it out from its start', async () => {
    const { app, id, on, start } = await midway(2);
    on(() => void app.jobs.stop());
    await start();
    await app.settle();

    expect(app.run(id)).toMatchObject({ status: 'queued', stage: 'planning' });
    expect(messages(app, id).at(-1)).toBe(
      'The server stopped during this run. It starts again when a worker is free.',
    );
    expect(app.repository.get(id).documents).toEqual([]);
    expect(app.repository.jobs.live(id)).toMatchObject({ state: 'queued' });
    expect(app.repository.chunks(id)).toEqual([]);

    // A worker of the restarted server takes the job, and finds the run that was waiting for it.
    on(() => undefined);
    const restarted = new Orchestrator(app.repository, testConfig(), () => undefined, undefined, {
      timers: false,
    });
    await drive(app.clock, restarted.idle());
    expect(app.research.store.count(id)).toBe(1);
    expect(app.run(id)).toMatchObject({ status: 'completed', stage: 'ready' });
    expect(app.repository.get(id)).toMatchObject({ status: 'ready' });
    expect(app.repository.get(id).documents).toHaveLength(4);
    expect(messages(app, id)).toContain(
      'The server stopped during this run. It starts again when a worker is free.',
    );
  });

  it('marks a run that nobody is carrying out as ended when the server starts, never leaves it running', async () => {
    const app = await researchApp();
    const [lost, queued, owned] = [await app.create(), await app.create(), await app.create()];
    const orphan = (id: string, status: 'running' | 'paused' | 'queued') =>
      app.research.store.create(id, {
        ...newRun({
          sequence: 1,
          mode: 'url',
          intake: { auto: true, url: `${HARBOUR}/` },
          budget: DEFAULT_RESEARCH_BUDGET,
          discovery: app.research.discovery,
          at: new Date(app.clock.now()).toISOString(),
        }),
        status,
      });
    orphan(lost, 'running');
    orphan(queued, 'paused');
    // A run whose job is still in the queue is that job's to carry out, and is left for it.
    orphan(owned, 'queued');
    app.repository.jobs.enqueue({
      id: crypto.randomUUID(),
      projectId: owned,
      kind: 'knowledge',
      idempotencyKey: 'owned-0001',
    });

    app.research.recover();
    expect(app.run(lost)).toMatchObject({ status: 'failed' });
    expect(app.run(queued)).toMatchObject({ status: 'failed' });
    expect(messages(app, lost).at(-1)).toBe(
      'The server stopped before this run finished. Start it again.',
    );
    expect(app.run(owned)).toMatchObject({ status: 'queued' });
    // A run that was cut off can be started again, and the project goes on from there.
    expect((await app.view(lost)).may.start).toBe(true);
    await app.post(lost, '', { intake: { url: `${HARBOUR}/` } });
    await app.settle();
    expect(app.run(lost)).toMatchObject({ status: 'completed' });
    expect(app.run(lost)?.id).toMatch(/^rr-0002-/u);
  });

  it('settles a waiting run that has no job once it is old enough to have been given up on, as cancelled when its job was', async () => {
    const app = await researchApp();
    const [stale, cancelled] = [await app.create(), await app.create()];
    for (const id of [stale, cancelled]) {
      app.research.store.create(
        id,
        newRun({
          sequence: 1,
          mode: 'url',
          intake: { auto: true, url: `${HARBOUR}/` },
          budget: DEFAULT_RESEARCH_BUDGET,
          discovery: app.research.discovery,
          at: new Date(app.clock.now()).toISOString(),
        }),
      );
    }
    const job = app.repository.jobs.enqueue({
      id: crypto.randomUUID(),
      projectId: cancelled,
      kind: 'knowledge',
      idempotencyKey: 'cancelled-0001',
    }).job;
    app.repository.jobs.requestCancel(job.id);

    // A run is written just before its job is queued: it is given a moment before it is taken to be abandoned.
    expect((await app.view(stale)).run?.status).toBe('queued');
    app.clock.advance(61_000);
    expect((await app.view(stale)).run?.status).toBe('failed');
    expect((await app.view(cancelled)).run).toMatchObject({
      status: 'cancelled',
      stoppedBecause: 'cancelled',
    });
  });

  it('starts again from what it asked before, when the job of a run that was cut off is carried out', async () => {
    const app = await researchApp();
    const id = await app.create();
    app.research.store.create(id, {
      ...newRun({
        sequence: 1,
        mode: 'url',
        intake: { auto: true, url: `${HARBOUR}/` },
        budget: DEFAULT_RESEARCH_BUDGET,
        discovery: app.research.discovery,
        at: new Date(app.clock.now()).toISOString(),
      }),
      status: 'running',
    });
    const response = await app.app.inject({
      method: 'POST',
      url: `/api/projects/${id}/steps/knowledge`,
    });
    expect(response.statusCode).toBe(202);
    await app.settle();
    const runs = app.research.store;
    expect(runs.count(id)).toBe(2);
    expect(runs.get(id, runs.latest(id)?.data.id ?? '')?.data).toMatchObject({
      status: 'completed',
      mode: 'url',
    });
    expect(app.repository.get(id)).toMatchObject({ status: 'ready' });
  });
});
