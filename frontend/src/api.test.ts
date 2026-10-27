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

  describe('checkpoint, branch and comparison API requests', () => {
    function mockRequest() {
      const fetch = vi.fn().mockImplementation(
        async () =>
          new Response('{"status":"ready"}', {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
          }),
      );
      vi.stubGlobal('fetch', fetch);
      return fetch;
    }

    it('pauses using the bodyless pause endpoint', async () => {
      const fetch = mockRequest();
      await api.pause('project id');
      expect(fetch).toHaveBeenCalledWith(
        '/api/projects/project%20id/pause',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(fetch.mock.calls[0]![1].body).toBeUndefined();
    });

    it('distinguishes resume from a bodyless simulation restart', async () => {
      const fetch = mockRequest();
      await api.resume('project');
      await api.step('project', 'simulation');
      expect(fetch.mock.calls[0]![0]).toBe('/api/projects/project/steps/simulation');
      expect(JSON.parse(fetch.mock.calls[0]![1].body as string)).toEqual({ resume: true });
      expect(fetch.mock.calls[1]![0]).toBe('/api/projects/project/steps/simulation');
      expect(fetch.mock.calls[1]![1].body).toBeUndefined();
    });

    it('sends an intervention object or literal JSON null using PUT', async () => {
      const fetch = mockRequest();
      const intervention = {
        round: 2,
        label: 'Synthetic future input',
        stance: -0.5,
        strength: 0.4,
      };
      await api.intervention('project', intervention);
      await api.intervention('project', null);
      expect(fetch.mock.calls[0]![0]).toBe('/api/projects/project/intervention');
      expect(fetch.mock.calls[0]![1].method).toBe('PUT');
      expect(JSON.parse(fetch.mock.calls[0]![1].body as string)).toEqual(intervention);
      expect(fetch.mock.calls[1]![1].body).toBe('null');
    });

    it('preserves inherit versus remove in branch JSON', async () => {
      const fetch = mockRequest();
      await api.branch('parent', { fromRound: 1, agentEdits: [] });
      await api.branch('parent', { fromRound: 0, intervention: null, agentEdits: [] });
      expect(fetch.mock.calls[0]![0]).toBe('/api/projects/parent/branches');
      expect(JSON.parse(fetch.mock.calls[0]![1].body as string)).not.toHaveProperty('intervention');
      expect(JSON.parse(fetch.mock.calls[1]![1].body as string)).toHaveProperty(
        'intervention',
        null,
      );
    });

    it('requests a comparison with an encoded other ID', async () => {
      const fetch = mockRequest();
      await api.compare('base id', 'other id&query=unsafe');
      expect(fetch.mock.calls[0]![0]).toBe(
        '/api/projects/base%20id/compare?with=other%20id%26query%3Dunsafe',
      );
    });
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
