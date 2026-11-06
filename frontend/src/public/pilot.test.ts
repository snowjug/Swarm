import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEST_KEY } from './test/fixtures';
import { failure, fakeServer } from './test/server';

// The pilot is a page without the edition tag, and its API client must be exactly what it was. This file runs where
// there is no page at all (the Node environment) and puts a stand-in for one only where a test needs it, so that anything
// the public edition did on its own would show.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function stubPage(options: { held?: string | null } = {}) {
  const reads: string[] = [];
  const storage = new Map<string, string>();
  const assign = vi.fn();
  const sessionStorage = {
    getItem: (key: string) => {
      reads.push(key);
      return key.startsWith('swarm.byok') ? (options.held ?? null) : (storage.get(key) ?? null);
    },
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  };
  vi.stubGlobal('window', {
    location: { pathname: '/projects/p', search: '?tab=report', assign },
    sessionStorage,
  });
  return { reads, assign };
}

async function freshClient() {
  vi.resetModules();
  const [client, runtime] = await Promise.all([import('../api'), import('./runtime')]);
  const signals: unknown[] = [];
  runtime.onPublicSignal((signal) => signals.push(signal));
  return { ...client, runtime, signals };
}

describe('the API client of a page that is not the public edition', () => {
  it('is off until a page says otherwise', async () => {
    const { runtime } = await freshClient();
    expect(runtime.inPublicEdition()).toBe(false);
  });

  it('reads nothing of the page, and nothing of the tab’s storage, to make a request', async () => {
    const touched: string[] = [];
    vi.stubGlobal(
      'window',
      new Proxy({}, { get: (_target, name) => void touched.push(String(name)) }),
    );
    const server = fakeServer({ 'GET /api/config': {}, 'POST /api/projects/p/pause': {} });
    const { request, api } = await freshClient();
    await request('/api/config');
    await api.pause('p');
    expect(server.calls).toHaveLength(2);
    expect(touched).toEqual([]);
  });

  it('sends what it always sent, with a key in the tab or not', async () => {
    const { reads } = stubPage({ held: 'AIzaSyAKEYINTHETAB000000000000000000' });
    const server = fakeServer({ 'POST /api/projects/p/pause': {}, 'GET /api/usage': {} });
    const { api, request } = await freshClient();
    await api.pause('p');
    await request('/api/usage');
    expect(server.fetch.mock.calls[0]![1]!.headers).toEqual({
      Accept: 'application/json',
      'X-Swarm-CSRF': '1',
    });
    expect(server.fetch.mock.calls[1]![1]!.headers).toEqual({ Accept: 'application/json' });
    expect(reads.filter((key) => key.startsWith('swarm.byok'))).toEqual([]);
  });

  it('still sends a person who is not signed in to the pilot’s sign-in, and tells the public page nothing', async () => {
    const { assign } = stubPage();
    fakeServer({ 'GET /api/config': failure(401, 'SIGN_IN_REQUIRED', 'Sign in to continue.') });
    const { request, signals } = await freshClient();
    void request('/api/config');
    await vi.waitFor(() =>
      expect(assign).toHaveBeenCalledWith('/auth/login?returnTo=%2Fprojects%2Fp%3Ftab%3Dreport'),
    );
    expect(signals).toEqual([]);
  });

  it('keeps the server’s message for every code, the public ones included', async () => {
    stubPage();
    fakeServer({
      'POST /api/projects': failure(429, 'FREE_TIER_USER_CAP', 'RAW SERVER MESSAGE'),
      'POST /api/other': failure(403, 'ACCOUNT_DISABLED', 'ANOTHER RAW MESSAGE'),
    });
    const { request, errorMessage, signals } = await freshClient();
    const first = await request('/api/projects', { method: 'POST' }).catch((e: unknown) => e);
    const second = await request('/api/other', { method: 'POST' }).catch((e: unknown) => e);
    expect(errorMessage(first)).toBe('RAW SERVER MESSAGE Request ID: req-test');
    expect(errorMessage(second)).toBe('ANOTHER RAW MESSAGE Request ID: req-test');
    expect(signals).toEqual([]);
  });

  it('still says the local server cannot be reached', async () => {
    stubPage();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const { request, errorMessage } = await freshClient();
    const error = await request('/api/config').catch((e: unknown) => e);
    expect(errorMessage(error)).toContain('Cannot reach the local server');
  });

  it('keeps the key it is given only if the page says it is the public edition', async () => {
    stubPage();
    const server = fakeServer({ 'POST /api/projects/p/pause': {} });
    const { api, runtime } = await freshClient();
    const store = await import('./byokStore');
    store.setByokKey(TEST_KEY, null);
    await api.pause('p');
    expect(server.calls[0]!.headers['x-swarm-provider-key']).toBeUndefined();
    runtime.setPublicEdition(true);
    await api.pause('p');
    expect(server.calls[1]!.headers['x-swarm-provider-key']).toBe(TEST_KEY);
  });
});
