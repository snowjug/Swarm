import { Agent, request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, KEEP_ALIVE_TIMEOUT_MS } from '../src/app.js';
import { testConfig } from './fixtures.js';

// These run over real sockets. A client that is still sending when the server closes the
// connection sees "connection reset" instead of the response, so the behaviour cannot be seen
// through app.inject(). Each failed attempt below is a case the end-to-end suite used to meet at
// random; here it is a failure on every run.
type Harness = Awaited<ReturnType<typeof buildApp>>;
const open: Harness[] = [];
const agents: Agent[] = [];
afterEach(async () => {
  for (const agent of agents.splice(0)) agent.destroy();
  await Promise.all(open.splice(0).map(({ app }) => app.close()));
});

async function listen() {
  const harness = await buildApp({ config: testConfig() });
  open.push(harness);
  await harness.app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = harness.app.server.address() as AddressInfo;
  return { ...harness, port };
}

interface Outcome {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
  reused: boolean;
}

interface Send {
  method?: string;
  /** Sent in full. */
  body?: Buffer;
  /** Promised in the headers and never sent: what a client that has just started uploading looks like. */
  declared?: number;
  agent?: Agent;
  headers?: Record<string, string>;
}

function send(port: number, path: string, options: Send = {}): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    const length = options.declared ?? options.body?.length;
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method: options.method ?? 'POST',
        ...(options.agent ? { agent: options.agent } : {}),
        headers: {
          'content-type': 'application/json',
          ...(length === undefined ? {} : { 'content-length': String(length) }),
          ...options.headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            text: Buffer.concat(chunks).toString('utf8'),
            reused: request.reusedSocket,
          });
          if (options.declared !== undefined) request.destroy();
        });
      },
    );
    request.on('error', reject);
    if (options.body) request.end(options.body);
    else if (options.declared !== undefined) request.flushHeaders();
    else request.end();
  });
}

const oversized = Buffer.from(JSON.stringify({ padding: 'x'.repeat(700_000) }));

describe('how the server treats a connection', () => {
  it('keeps an idle connection open longer than a load balancer or a stalled client waits', async () => {
    const { app } = await listen();
    expect(KEEP_ALIVE_TIMEOUT_MS).toBeGreaterThan(60_000);
    expect(app.server.keepAliveTimeout).toBe(KEEP_ALIVE_TIMEOUT_MS);
  });

  it('answers an oversized body with 413 every time and leaves the connection usable', async () => {
    const { port } = await listen();
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    agents.push(agent);
    const outcomes: Outcome[] = [];
    const failures: string[] = [];
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        outcomes.push(await send(port, '/api/projects', { body: oversized, agent }));
      } catch (error) {
        failures.push((error as NodeJS.ErrnoException).code ?? String(error));
      }
    }
    expect(failures).toEqual([]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(Array<number>(60).fill(413));
    expect((JSON.parse(outcomes[0]!.text) as { error: { code: string } }).error.code).toBe(
      'HTTP_413',
    );
    // The remainder was drained, not abandoned: every request after the first rode the same socket.
    expect(outcomes.slice(1).every((outcome) => outcome.reused)).toBe(true);
    expect((await send(port, '/api/health', { method: 'GET', agent })).status).toBe(200);
  });

  it('refuses a declared length before any body arrives, and closes only when it is far beyond the limit', async () => {
    const { port } = await listen();
    const drained = await send(port, '/api/projects', { declared: 700_000 });
    expect(drained.status).toBe(413);
    expect(drained.headers.connection).not.toBe('close');

    const abandoned = await send(port, '/api/projects', { declared: 600_000 * 9 });
    expect(abandoned.status).toBe(413);
    expect(abandoned.headers.connection).toBe('close');
  });

  it('judges a body by the limit of the route it is sent to', async () => {
    const { port } = await listen();
    const pdf = Buffer.from(JSON.stringify({ name: 'notes.pdf', data: 'A'.repeat(700_000) }));
    const extraction = await send(port, '/api/documents/extract', { body: pdf });
    expect(extraction.status).not.toBe(413);
    expect(extraction.status).toBeLessThan(500);

    const inside = await send(port, '/api/projects', { body: Buffer.from('{}') });
    expect(inside.status).toBe(400);
    expect((JSON.parse(inside.text) as { error: { code: string } }).error.code).toBe(
      'INVALID_INPUT',
    );
  });

  it('still refuses a foreign origin before it looks at the length', async () => {
    const { port } = await listen();
    const refused = await send(port, '/api/projects', {
      declared: 700_000,
      headers: { origin: 'https://evil.example' },
    });
    expect(refused.status).toBe(403);
    expect((JSON.parse(refused.text) as { error: { code: string } }).error.code).toBe(
      'ORIGIN_NOT_ALLOWED',
    );
  });
});
