import { describe, expect, it } from 'vitest';
import { checkReadyOn } from './release-http.js';

const answer = (status: number, body: unknown): typeof fetch =>
  (async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
    })) as typeof fetch;

describe('the readiness probe', () => {
  it('is ready only on 200 with a ready body and the database ok', async () => {
    const ready = { status: 'ready', checks: { database: 'ok' } };
    await expect(checkReadyOn('app.example.com', 1000, answer(200, ready))).resolves.toEqual({
      ok: true,
      detail: 'HTTP 200, ready, database ok',
    });
    for (const body of [
      { status: 'ready', checks: { database: 'down' } },
      { status: 'starting' },
      'not json',
      null,
    ]) {
      const verdict = await checkReadyOn('app.example.com', 1000, answer(200, body));
      expect(verdict.ok).toBe(false);
    }
    expect((await checkReadyOn('app.example.com', 1000, answer(503, ready))).detail).toBe(
      'HTTP 503',
    );
  });

  it('never returns a response body, and reports an unreachable host without its address', async () => {
    const leaky = answer(200, {
      status: 'starting',
      detail: 'canary-text-that-must-not-be-echoed',
    });
    expect(JSON.stringify(await checkReadyOn('app.example.com', 1000, leaky))).not.toContain(
      'canary-text',
    );
    const refused = (async () => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('x'), { code: 'ECONNREFUSED' }),
      });
    }) as typeof fetch;
    expect(await checkReadyOn('app.example.com', 1000, refused)).toEqual({
      ok: false,
      detail: 'cannot reach the host (ECONNREFUSED)',
    });
  });

  it('asks for the ready route over https with no credential, and refuses a host that is not a plain name', async () => {
    const seen: { url: string; init: RequestInit | undefined }[] = [];
    const spy = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), init });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    await checkReadyOn('app.example.com', 1000, spy);
    expect(seen[0]?.url).toBe('https://app.example.com/api/health/ready');
    expect(seen[0]?.init?.redirect).toBe('manual');
    expect(Object.keys((seen[0]?.init?.headers as Record<string, string>) ?? {})).toEqual([
      'user-agent',
    ]);
    expect((await checkReadyOn('a.example.com/evil?x=', 1000, spy)).ok).toBe(false);
    expect(seen).toHaveLength(1);
  });
});
