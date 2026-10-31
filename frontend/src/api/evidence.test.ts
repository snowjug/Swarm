import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import { evidenceApi } from './evidence';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('the evidence API client', () => {
  it('asks the server to fetch a page, with the address and nothing else, and sends no credentials of its own', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ document: {}, notes: [] }));
    vi.stubGlobal('fetch', fetch);
    await evidenceApi.fetchUrl('https://example.com/page?q=1');
    const [path, init] = fetch.mock.calls[0]!;
    expect(path).toBe('/api/evidence/url');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ url: 'https://example.com/page?q=1' });
    // The page is fetched by the server: the browser asks only the server, and never the address.
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(init.credentials).toBeUndefined();
    expect(Object.keys(init.headers as Record<string, string>).sort()).toEqual([
      'Accept',
      'Content-Type',
      'X-Swarm-CSRF',
    ]);
  });

  it('turns the server’s plain message into the error, with its code', async () => {
    const message = 'This address is not one that Swarm reads. You can paste the text instead.';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json({ error: { code: 'URL_BLOCKED', message } }, 422)),
    );
    await expect(evidenceApi.fetchUrl('http://10.0.0.1/')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'URL_BLOCKED',
      message,
    });
    await expect(evidenceApi.fetchUrl('http://10.0.0.1/')).rejects.toBeInstanceOf(ApiError);
  });

  it('sends a CSV or JSON file to the server to be read as text', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(json({ name: 'a.csv', content: 'Columns: a', bytes: 3, notes: [] }));
    vi.stubGlobal('fetch', fetch);
    const read = await evidenceApi.extractDataFile('a.csv', 'YSxiCjEsMg==');
    expect(read.name).toBe('a.csv');
    const [path, init] = fetch.mock.calls[0]!;
    expect(path).toBe('/api/documents/extract');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'a.csv', data: 'YSxiCjEsMg==' });
  });
});
