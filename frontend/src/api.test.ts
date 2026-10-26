import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, errorMessage } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('guided API client', () => {
  it('uses the staged endpoint instead of the legacy all-at-once runner', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'queued' }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    await api.step('project id', 'environment');
    expect(fetch).toHaveBeenCalledWith(
      '/api/projects/project%20id/steps/environment',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('preserves structured API errors and request IDs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'STEP_LOCKED',
              message: 'Knowledge is not ready.',
              requestId: 'request-test',
            },
          }),
          { status: 409 },
        ),
      ),
    );
    try {
      await api.step('test', 'simulation');
      expect.unreachable('The request should have failed.');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(errorMessage(error)).toContain('Knowledge is not ready.');
      expect(errorMessage(error)).toContain('request-test');
    }
  });

  it('sends PDF bytes as base64, not a data URL', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          name: 'test.pdf',
          content: 'Extracted source text.',
          pageCount: 1,
          bytes: 12,
        }),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    await api.extractPdf('test.pdf', 'JVBERg==');
    expect(fetch.mock.calls[0]![0]).toBe('/api/documents/extract');
    expect(JSON.parse(fetch.mock.calls[0]![1].body as string)).toEqual({
      name: 'test.pdf',
      data: 'JVBERg==',
    });
  });

  it('rejects unsuccessful or JSON-shaped Markdown exports', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{"status":"not ready"}', {
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    await expect(api.export('test', 'markdown')).rejects.toThrow(
      'did not return a Markdown report',
    );
  });

  it('does not download an HTML fallback page as a report', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html>not a report</html>', {
          headers: { 'Content-Type': 'text/html' },
        }),
      ),
    );
    await expect(api.export('test', 'markdown')).rejects.toThrow(
      'did not return a Markdown report',
    );
  });

  it('downloads a real Markdown response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('# Recorded report', {
          headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
        }),
      ),
    );
    const blob = await api.export('test', 'markdown');
    expect(await blob.text()).toBe('# Recorded report');
  });
});
