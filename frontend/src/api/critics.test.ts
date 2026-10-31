import { afterEach, describe, expect, it, vi } from 'vitest';
import { viewFixture } from '../test/critics';
import { criticsApi } from './critics';

// What the page asks of the server: the address, the method, the body, and the header that every
// change carries. The server's own behaviour is tested in backend/test/critiques-routes.test.ts.

interface Sent {
  path: string;
  init: RequestInit;
}

function serve(body: unknown = viewFixture(), status = 200): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
    sent.push({ path, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return sent;
}

afterEach(() => vi.unstubAllGlobals());

describe('the independent review API', () => {
  it('reads the review with one GET, and sends nothing else', async () => {
    const sent = serve();
    const view = await criticsApi.read('p-1');
    expect(view.analysis?.id).toBe('analysis-1');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.path).toBe('/api/projects/p-1/critiques');
    expect(sent[0]?.init.method).toBeUndefined();
    expect(sent[0]?.init.body).toBeUndefined();
  });

  it('runs the review with a POST that says whether a model is wanted, and carries the anti-forgery header', async () => {
    const sent = serve();
    await criticsApi.run('p-1', { useModel: true });
    expect(sent[0]?.path).toBe('/api/projects/p-1/critiques/run');
    expect(sent[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(sent[0]?.init.body))).toEqual({ useModel: true });
    expect(sent[0]?.init.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-Swarm-CSRF': '1',
    });
  });

  it('answers a criticism with a PUT to the response of that criticism, its id made safe for an address', async () => {
    const sent = serve();
    await criticsApi.respond('p-1', 'model-bias/1 a', {
      text: 'We accept this.',
      status: 'accepted',
      remainingDisagreement: null,
    });
    expect(sent[0]?.path).toBe('/api/projects/p-1/critiques/model-bias%2F1%20a/response');
    expect(sent[0]?.init.method).toBe('PUT');
    expect(JSON.parse(String(sent[0]?.init.body))).toEqual({
      text: 'We accept this.',
      status: 'accepted',
      remainingDisagreement: null,
    });
    expect(sent[0]?.init.headers).toMatchObject({ 'X-Swarm-CSRF': '1' });
  });

  it('says in the server’s own words why a request was refused', async () => {
    serve(
      {
        error: {
          code: 'ANALYSIS_NOT_READY',
          message: 'There is no finished analysis to review yet.',
        },
      },
      409,
    );
    await expect(criticsApi.run('p-1', {})).rejects.toMatchObject({
      code: 'ANALYSIS_NOT_READY',
      message: 'There is no finished analysis to review yet.',
    });
  });
});
