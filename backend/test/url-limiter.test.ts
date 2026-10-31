import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { FetchBusy, FetchLimiter } from '../src/ingest/url/limiter.js';
import { PublicFetcher } from '../src/ingest/url/fetcher.js';
import { testConfig } from './fixtures.js';
import { startServer, type TestServer } from './support/url-server.js';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Lets everything that is ready to run, run. */
const settle = () => new Promise<void>((done) => setImmediate(done));
type Gate = ReturnType<typeof deferred<void>>;

describe('FetchLimiter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('never runs more than its limit at once, however many ask together, and serves them in turn', async () => {
    const limiter = new FetchLimiter({ maxActive: 8, maxQueued: 50, maxWaitMs: 60_000 });
    let running = 0;
    let peak = 0;
    const gates: Gate[] = [];
    const started: number[] = [];
    const calls = Array.from({ length: 50 }, (_, i) =>
      limiter.run(async () => {
        started.push(i);
        running += 1;
        peak = Math.max(peak, running);
        const gate = deferred();
        gates.push(gate);
        await gate.promise;
        running -= 1;
        return i;
      }),
    );
    await settle();
    expect(running).toBe(8);
    expect(limiter.load).toEqual({ active: 8, waiting: 42 });

    for (let finished = 0; finished < 50; finished += 1) {
      gates[finished]?.resolve();
      await settle();
    }
    expect(await Promise.all(calls)).toEqual(Array.from({ length: 50 }, (_, i) => i));
    expect(peak).toBe(8);
    // First come, first served: the order in which the work began is the order in which it was asked.
    expect(started).toEqual(Array.from({ length: 50 }, (_, i) => i));
    expect(limiter.load).toEqual({ active: 0, waiting: 0 });
  });

  it('refuses at once a request that finds the line full, and starts none of its work', async () => {
    const limiter = new FetchLimiter({ maxActive: 2, maxQueued: 3, maxWaitMs: 60_000 });
    const gate = deferred();
    const work = vi.fn(async () => {
      await gate.promise;
    });
    const accepted = Array.from({ length: 5 }, () => limiter.run(work));
    await settle();
    expect(work).toHaveBeenCalledTimes(2);
    expect(limiter.load).toEqual({ active: 2, waiting: 3 });

    const refused = limiter.run(work);
    await expect(refused).rejects.toBeInstanceOf(FetchBusy);
    await expect(refused).rejects.toMatchObject({ reason: 'queue-full' });
    expect(work).toHaveBeenCalledTimes(2);
    expect(limiter.load).toEqual({ active: 2, waiting: 3 });

    gate.resolve();
    await Promise.all(accepted);
    expect(work).toHaveBeenCalledTimes(5);
    expect(limiter.load).toEqual({ active: 0, waiting: 0 });
  });

  it('refuses everything beyond the limit when it has no line at all', async () => {
    const limiter = new FetchLimiter({ maxActive: 1, maxQueued: 0, maxWaitMs: 60_000 });
    const hold = await limiter.acquire();
    await expect(limiter.acquire()).rejects.toMatchObject({ reason: 'queue-full' });
    hold();
    await expect(limiter.run(async () => 'served')).resolves.toBe('served');
  });

  it.each([
    ['an error that arrives later', async () => Promise.reject(new Error('the site failed'))],
    [
      'an error thrown at once',
      () => {
        throw new Error('the site failed');
      },
    ],
  ])('gives the place back after %s', async (_name, work) => {
    const limiter = new FetchLimiter({ maxActive: 1, maxQueued: 0, maxWaitMs: 60_000 });
    await expect(limiter.run(work)).rejects.toThrow('the site failed');
    expect(limiter.load).toEqual({ active: 0, waiting: 0 });
    await expect(limiter.run(async () => 'served')).resolves.toBe('served');
  });

  it('hands a place to a waiting request that fails to the next one, and not to a failed one', async () => {
    const limiter = new FetchLimiter({ maxActive: 1, maxQueued: 5, maxWaitMs: 60_000 });
    const gate = deferred();
    const first = limiter.run(() => gate.promise);
    const second = limiter.run(async () => Promise.reject(new Error('failed')));
    const third = limiter.run(async () => 'third');
    gate.resolve();
    await first;
    await expect(second).rejects.toThrow('failed');
    await expect(third).resolves.toBe('third');
    expect(limiter.load).toEqual({ active: 0, waiting: 0 });
  });

  it('refuses a request that has waited too long, and the place it never had is not lost', async () => {
    vi.useFakeTimers();
    const limiter = new FetchLimiter({ maxActive: 1, maxQueued: 2, maxWaitMs: 5_000 });
    const hold = await limiter.acquire();
    const expiring = limiter.acquire();
    const refusal = expect(expiring).rejects.toMatchObject({ reason: 'wait-expired' });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(limiter.load).toEqual({ active: 1, waiting: 1 });
    await vi.advanceTimersByTimeAsync(1);
    await refusal;
    expect(limiter.load).toEqual({ active: 1, waiting: 0 });

    // A later request takes the place when it is given back; the one that gave up does not.
    const later = limiter.acquire();
    hold();
    const release = await later;
    expect(limiter.load).toEqual({ active: 1, waiting: 0 });
    release();
    expect(limiter.load).toEqual({ active: 0, waiting: 0 });
  });

  it('starts the wait of a request when it joins the line, not when the line began', async () => {
    vi.useFakeTimers();
    const limiter = new FetchLimiter({ maxActive: 1, maxQueued: 2, maxWaitMs: 5_000 });
    const hold = await limiter.acquire();
    const early = limiter.acquire();
    const earlyFate = early.then(
      () => 'served',
      (error: FetchBusy) => error.reason,
    );
    await vi.advanceTimersByTimeAsync(3_000);
    const late = limiter.acquire();
    const lateFate = late.then(
      () => 'served',
      (error: FetchBusy) => error.reason,
    );
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await earlyFate).toBe('wait-expired');
    await vi.advanceTimersByTimeAsync(2_999);
    expect(limiter.load).toEqual({ active: 1, waiting: 1 });
    hold();
    expect(await lateFate).toBe('served');
  });

  it('takes a request out of the line when the person who asked goes away', async () => {
    const limiter = new FetchLimiter({ maxActive: 1, maxQueued: 2, maxWaitMs: 60_000 });
    const hold = await limiter.acquire();
    const gone = new AbortController();
    const abandoned = limiter.acquire(gone.signal);
    const refusal = expect(abandoned).rejects.toMatchObject({ reason: 'abandoned' });
    expect(limiter.load).toEqual({ active: 1, waiting: 1 });
    gone.abort();
    await refusal;
    expect(limiter.load).toEqual({ active: 1, waiting: 0 });
    hold();
    expect(limiter.load).toEqual({ active: 0, waiting: 0 });

    const already = new AbortController();
    already.abort();
    await expect(limiter.acquire(already.signal)).rejects.toMatchObject({ reason: 'abandoned' });
    expect(limiter.load).toEqual({ active: 0, waiting: 0 });
  });

  it('gives back one place however many times it is told to', async () => {
    const limiter = new FetchLimiter({ maxActive: 1, maxQueued: 1, maxWaitMs: 60_000 });
    const release = await limiter.acquire();
    release();
    release();
    expect(limiter.load).toEqual({ active: 0, waiting: 0 });
    const next = await limiter.acquire();
    const waiting = limiter.acquire();
    expect(limiter.load).toEqual({ active: 1, waiting: 1 });
    next();
    (await waiting)();
    expect(limiter.load).toEqual({ active: 0, waiting: 0 });
  });
});

describe('POST /api/evidence/url when the server is busy', () => {
  const servers: TestServer[] = [];
  const applications: Awaited<ReturnType<typeof buildApp>>[] = [];
  afterEach(async () => {
    await Promise.all(applications.splice(0).map(({ app }) => app.close()));
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  const PAGE = `<!doctype html><html><head><title>Notes</title></head><body><p>${'The pilot ran for twelve weeks across three sites and was reviewed each month. '.repeat(4)}</p></body></html>`;
  const CANARY = 'zq-canary-path-4417';

  /** A site whose `/held/*` pages answer only when `release` is called, and whose other pages answer at once. */
  async function setup(environment: Record<string, string>) {
    const gate = deferred();
    const held: ServerResponse[] = [];
    const handler = (request: IncomingMessage, response: ServerResponse) => {
      const path = new URL(request.url ?? '/', 'http://x').pathname;
      if (path === '/robots.txt') {
        response.writeHead(200, { 'content-type': 'text/plain' });
        return response.end('User-agent: *\nAllow: /\n');
      }
      const answer = () => {
        if (path.includes('missing')) {
          response.writeHead(404, { 'content-type': 'text/plain' });
          return response.end('not here');
        }
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(PAGE);
      };
      if (path.startsWith('/held/')) {
        held.push(response);
        void gate.promise.then(answer);
        return undefined;
      }
      return answer();
    };
    const server = await startServer(handler);
    servers.push(server);
    const config = testConfig({ URL_INGEST_ALLOWED_PORTS: String(server.port), ...environment });
    const instance = await buildApp({
      config,
      urlFetcher: new PublicFetcher({ allowPrivateForTests: true }),
    });
    applications.push(instance);
    const fetchPage = (path: string) =>
      instance.app.inject({
        method: 'POST',
        url: '/api/evidence/url',
        payload: { url: server.url(path) },
      });
    const waitUntilHeld = async (count: number) => {
      for (let attempt = 0; attempt < 300 && held.length < count; attempt += 1) {
        await new Promise((done) => setTimeout(done, 10));
      }
      expect(held.length).toBe(count);
    };
    const post = (url: string) =>
      instance.app.inject({ method: 'POST', url: '/api/evidence/url', payload: { url } });
    return { ...instance, server, fetchPage, post, release: gate.resolve, waitUntilHeld };
  }

  const errorOf = (response: { json: () => { error: { code: string; message: string } } }) =>
    response.json().error;

  it('answers 503 with a Retry-After and a plain message that says nothing of the address', async () => {
    const { fetchPage, release, waitUntilHeld } = await setup({
      URL_INGEST_CONCURRENCY: '1',
      URL_INGEST_QUEUE: '0',
    });
    const running = fetchPage('/held/one');
    await waitUntilHeld(1);

    const refused = await fetchPage(`/${CANARY}?secret=1`);
    expect(refused.statusCode).toBe(503);
    expect(refused.headers['retry-after']).toBe('5');
    expect(errorOf(refused)).toMatchObject({ code: 'URL_BUSY' });
    expect(errorOf(refused).message).toContain(
      'Too many page fetches are running; try again in a moment.',
    );
    expect(refused.body).not.toContain(CANARY);
    expect(refused.body).not.toContain('127.0.0.1');

    // The page that has the place is read, and when it is done the next request is not refused.
    release();
    expect((await running).statusCode).toBe(200);
    expect((await fetchPage('/after')).statusCode).toBe(200);
  });

  it('refuses a request that waits longer than the limit, and still serves the one that holds the place', async () => {
    const { fetchPage, release, waitUntilHeld } = await setup({
      URL_INGEST_CONCURRENCY: '1',
      URL_INGEST_QUEUE: '2',
      URL_INGEST_QUEUE_WAIT_MS: '100',
    });
    const running = fetchPage('/held/one');
    await waitUntilHeld(1);
    const waited = await fetchPage('/two');
    expect(waited.statusCode).toBe(503);
    expect(errorOf(waited).code).toBe('URL_BUSY');
    expect(waited.headers['retry-after']).toBe('1');
    release();
    expect((await running).statusCode).toBe(200);
  });

  it('gives the place back when a page fails and when an address is refused', async () => {
    const { fetchPage, post, server } = await setup({
      URL_INGEST_CONCURRENCY: '1',
      URL_INGEST_QUEUE: '0',
    });
    expect(errorOf(await fetchPage('/missing')).code).toBe('URL_FETCH_FAILED');
    expect(errorOf(await post(`http://10.0.0.1:${server.port}/`)).code).toBe('URL_BLOCKED');
    expect(errorOf(await post('not an address')).code).toBe('URL_INVALID');
    // With no line to wait in, a place that had not been given back would make this a 503.
    expect((await fetchPage('/again')).statusCode).toBe(200);
  });

  it('takes a waiting request out of the line when its client disconnects', async () => {
    const { app, server, release, waitUntilHeld } = await setup({
      URL_INGEST_CONCURRENCY: '1',
      URL_INGEST_QUEUE: '1',
      URL_INGEST_QUEUE_WAIT_MS: '15000',
      RATE_LIMIT_SCALE: '100',
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as { port: number };
    const post = (path: string, signal?: AbortSignal) =>
      fetch(`http://127.0.0.1:${port}/api/evidence/url`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-swarm-csrf': '1' },
        body: JSON.stringify({ url: server.url(path) }),
        signal,
      });
    const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

    const running = post('/held/one');
    await waitUntilHeld(1);
    const leaving = new AbortController();
    const waiting = post('/held/two', leaving.signal).catch((error: Error) => error.name);
    await pause(300);
    // The line is one long and is full, so this one is refused.
    expect((await post('/probe')).status).toBe(503);

    leaving.abort();
    expect(await waiting).toBe('AbortError');
    // Once the server has seen the client go, a request is taken into the line again instead of refused.
    let next: Promise<Response> | undefined;
    for (let attempt = 0; attempt < 40 && !next; attempt += 1) {
      const probe = post('/next');
      const outcome = await Promise.race([
        probe.then((response) => response.status),
        pause(150).then(() => 'waiting' as const),
      ]);
      if (outcome === 'waiting') next = probe;
      else await pause(50);
    }
    expect(next, 'the request that left was still in the line').toBeDefined();

    release();
    expect((await running).status).toBe(200);
    expect((await next!).status).toBe(200);
  });
});
