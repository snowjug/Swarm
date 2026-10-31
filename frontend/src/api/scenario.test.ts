import { afterEach, describe, expect, it, vi } from 'vitest';
import { scenarioFixture } from '../../../shared/lab-fixtures';
import { scenarioApi } from './scenario';

afterEach(() => vi.unstubAllGlobals());

function respond(body: unknown, status = 200) {
  const fetch = vi.fn().mockImplementation(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const sent = (fetch: ReturnType<typeof respond>, call = 0) => ({
  url: String(fetch.mock.calls[call]![0]),
  init: fetch.mock.calls[call]![1] as RequestInit,
});

describe('the scenario API client', () => {
  it('sends the question and the documents’ names and sizes to be read, as a change the server will accept', async () => {
    const result = { frame: scenarioFixture(), notes: [], mode: 'rules', model: null };
    const fetch = respond(result);
    const documents = [{ name: 'a.md', characters: 10, excerpt: 'start' }];
    expect(await scenarioApi.parse('What could happen?', documents)).toEqual(result);
    const { url, init } = sent(fetch);
    expect(url).toBe('/api/scenario/parse');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ question: 'What could happen?', documents });
    // A change carries the header that a page of this site alone can add.
    expect(new Headers(init.headers).get('x-swarm-csrf')).toBe('1');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
  });

  it('can be stopped', async () => {
    const fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    await scenarioApi.parse('What could happen?', [], controller.signal);
    controller.abort();
    await expect(
      scenarioApi.parse('What could happen?', [], controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('reads and changes the scenario of one project, and names the project safely', async () => {
    const view = { scenario: scenarioFixture(), revision: 2 };
    const fetch = respond(view);
    expect(await scenarioApi.get('project id/with slash')).toEqual(view);
    expect(sent(fetch).url).toBe('/api/projects/project%20id%2Fwith%20slash/scenario');
    expect(sent(fetch).init.method).toBeUndefined();

    await scenarioApi.put('project', scenarioFixture(), 2);
    const put = sent(fetch, 1);
    expect(put.url).toBe('/api/projects/project/scenario');
    expect(put.init.method).toBe('PUT');
    expect(JSON.parse(String(put.init.body))).toEqual({
      scenario: scenarioFixture(),
      expectedRevision: 2,
    });

    await scenarioApi.put('project', scenarioFixture());
    expect(JSON.parse(String(sent(fetch, 2).init.body))).not.toHaveProperty('expectedRevision');
  });

  it('shows the server’s own words when it refuses', async () => {
    respond(
      {
        error: {
          code: 'ARTIFACT_CONFLICT',
          message: 'The scenario changed while you were editing it.',
        },
      },
      409,
    );
    await expect(scenarioApi.put('project', scenarioFixture(), 1)).rejects.toMatchObject({
      code: 'ARTIFACT_CONFLICT',
      message: 'The scenario changed while you were editing it.',
    });
  });
});
