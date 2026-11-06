// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUBLIC_ERROR_CODES } from '../../../shared/public';
import { api, ApiError, errorMessage, request } from '../api';
import { clearByok, holdsByokKey, setByokKey } from './byokStore';
import { problemOf, raisesNotice } from './problems';
import { publicApi } from './publicApi';
import { onPublicSignal, setPublicEdition, type PublicSignal } from './runtime';
import { TEST_KEY } from './test/fixtures';
import { failure, fakeServer, json, noContent } from './test/server';

// The API client in the public edition: where the person's own key travels, where it does not, and what each answer
// that means something to the page is turned into.

const HEADERS = ['x-swarm-provider', 'x-swarm-provider-key', 'x-swarm-provider-model'] as const;
const carriesNothing = (headers: Record<string, string>) =>
  HEADERS.every((name) => headers[name] === undefined);

function listen() {
  const signals: PublicSignal[] = [];
  const stop = onPublicSignal((signal) => signals.push(signal));
  return { signals, stop };
}

beforeEach(() => setPublicEdition(true));

afterEach(() => {
  setPublicEdition(false);
  clearByok();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('where the key travels', () => {
  it('goes with every change, with the provider, the key and the model the person chose', async () => {
    const server = fakeServer({});
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
      server.set(`${method} /api/anything`, {});
    setByokKey(TEST_KEY, 'gemini-2.5-flash');
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      await request('/api/anything', { method });
    }
    expect(server.calls).toHaveLength(4);
    for (const call of server.calls) {
      expect(call.headers['x-swarm-provider'], call.method).toBe('gemini');
      expect(call.headers['x-swarm-provider-key'], call.method).toBe(TEST_KEY);
      expect(call.headers['x-swarm-provider-model'], call.method).toBe('gemini-2.5-flash');
      expect(call.headers['x-swarm-csrf'], call.method).toBe('1');
    }
  });

  it('goes with the two reads that say what a person’s funding is: their usage, and the model chip', async () => {
    const server = fakeServer({ 'GET /api/usage': {}, 'GET /api/provider/status': {} });
    setByokKey(TEST_KEY, null);
    await request('/api/usage');
    await request('/api/provider/status');
    expect(server.calls.map((call) => call.path)).toEqual(['/api/usage', '/api/provider/status']);
    for (const call of server.calls) {
      expect(call.headers['x-swarm-provider'], call.path).toBe('gemini');
      expect(call.headers['x-swarm-provider-key'], call.path).toBe(TEST_KEY);
      // No model has been chosen, so none is sent.
      expect(call.headers['x-swarm-provider-model'], call.path).toBeUndefined();
    }
  });

  it('goes with no other read: not the settings, not the projects, not the account, not a download', async () => {
    const reads = [
      '/api/config',
      '/api/projects',
      '/api/projects/p1',
      '/api/projects/p1/export?format=markdown',
      '/api/provider/status/extra',
      '/api/account',
      '/api/public/session',
      '/api/public/status',
      '/api/public/legal/terms',
      '/api/admin/usage?days=14',
      '/api/workspace',
    ];
    const server = fakeServer(Object.fromEntries(reads.map((path) => [`GET ${path}`, {}])));
    setByokKey(TEST_KEY, 'gemini-2.5-flash');
    for (const path of reads) await request(path);
    expect(server.calls.map((call) => call.path)).toEqual(reads);
    for (const call of server.calls) {
      expect(carriesNothing(call.headers), call.path).toBe(true);
    }
  });

  it('sends the key typed into the field when it is checked, and not the one that is held', async () => {
    const server = fakeServer({ 'POST /api/byok/connect': { status: 'valid' } });
    setByokKey(TEST_KEY, 'gemini-2.5-flash');
    await publicApi.connectByok('A-DIFFERENT-KEY-1234567890');
    const [call] = server.calls;
    expect(call!.headers['x-swarm-provider']).toBe('gemini');
    expect(call!.headers['x-swarm-provider-key']).toBe('A-DIFFERENT-KEY-1234567890');
    expect(call!.headers['x-swarm-provider-model']).toBeUndefined();
    expect(JSON.stringify(call)).not.toContain(TEST_KEY);
  });

  it('goes nowhere but this site', async () => {
    const server = fakeServer({});
    setByokKey(TEST_KEY, null);
    await request('//elsewhere.example/api/usage', { method: 'POST' }).catch(() => undefined);
    await request('https://elsewhere.example/api/usage', { method: 'POST' }).catch(() => undefined);
    expect(server.calls).toHaveLength(2);
    for (const call of server.calls) expect(carriesNothing(call.headers), call.path).toBe(true);
  });

  it('is not sent when no key is held, which leaves the headers as the pilot’s are', async () => {
    const server = fakeServer({ 'POST /api/anything': {}, 'GET /api/usage': {} });
    await request('/api/anything', { method: 'POST' });
    await request('/api/usage');
    expect(server.fetch.mock.calls[0]![1]!.headers).toEqual({
      Accept: 'application/json',
      'X-Swarm-CSRF': '1',
    });
    expect(server.fetch.mock.calls[1]![1]!.headers).toEqual({ Accept: 'application/json' });
  });

  it('is removed before a sign-out is sent, so that it does not travel with the request that ends the session', async () => {
    const server = fakeServer({ 'POST /auth/logout': noContent() });
    setByokKey(TEST_KEY, 'gemini-2.5-flash');
    await api.signOut();
    expect(holdsByokKey()).toBe(false);
    expect(carriesNothing(server.calls[0]!.headers)).toBe(true);
    expect(server.calls[0]!.headers['x-swarm-csrf']).toBe('1');
  });
});

describe('an answer that means something to the page', () => {
  it('sends a person whose session ended back to the landing page, not to the pilot’s sign-in, and forgets the key', async () => {
    fakeServer({ 'GET /api/config': failure(401, 'SIGN_IN_REQUIRED', 'Sign in to continue.') });
    const { signals, stop } = listen();
    setByokKey(TEST_KEY, 'gemini-2.5-flash');
    const settled = vi.fn();
    void request('/api/config').then(settled, settled);
    await vi.waitFor(() => expect(signals).toEqual([{ kind: 'signed-out', reason: 'expired' }]));
    stop();
    expect(holdsByokKey()).toBe(false);
    // The pilot's way of leaving marks the tab before it goes; this did not leave for it.
    expect(window.sessionStorage.getItem('swarm.signin.attempted')).toBeNull();
    // Whatever asked is let go of: the page is changing.
    expect(settled).not.toHaveBeenCalled();
  });

  it('tells a person whose account was switched off the same way, with its own reason', async () => {
    fakeServer({ 'POST /api/projects': failure(403, 'ACCOUNT_DISABLED', 'RAW MESSAGE') });
    const { signals, stop } = listen();
    setByokKey(TEST_KEY, null);
    void request('/api/projects', { method: 'POST' }).catch(() => undefined);
    await vi.waitFor(() => expect(signals).toEqual([{ kind: 'signed-out', reason: 'disabled' }]));
    stop();
    expect(holdsByokKey()).toBe(false);
  });

  it.each(PUBLIC_ERROR_CODES.filter((code) => code !== 'ACCOUNT_DISABLED'))(
    'puts %s in calm words, and never in the server’s',
    async (code) => {
      fakeServer({ 'POST /api/projects': failure(429, code, 'RAW SERVER MESSAGE') });
      const { signals, stop } = listen();
      const error = await request('/api/projects', { method: 'POST' }).catch((e: unknown) => e);
      stop();
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe(code);
      expect((error as ApiError).message).toBe(problemOf(code)!.message);
      expect(errorMessage(error)).not.toContain('RAW SERVER MESSAGE');
      expect(signals).toEqual(raisesNotice(code) ? [{ kind: 'refused', code }] : []);
    },
  );

  it('leaves every other answer as it was, with the server’s message and its request id', async () => {
    fakeServer({ 'POST /api/x': failure(409, 'STEP_LOCKED', 'Knowledge is not ready.') });
    const { signals, stop } = listen();
    const error = await request('/api/x', { method: 'POST' }).catch((e: unknown) => e);
    stop();
    expect(errorMessage(error)).toBe('Knowledge is not ready. Request ID: req-test');
    expect(signals).toEqual([]);
  });

  it('says it cannot reach the service, not that a local backend is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const error = await request('/api/config').catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'NETWORK_ERROR' });
    expect((error as ApiError).message).toBe(
      "We can't reach the service right now. Check your connection, then try again.",
    );
  });

  it('keeps the answer of a request that worked, and reads JSON as before', async () => {
    fakeServer({ 'GET /api/usage': json({ funding: 'free' }) });
    await expect(request('/api/usage')).resolves.toEqual({ funding: 'free' });
  });
});

describe('what is never written or said', () => {
  it('puts the key in no storage but the tab’s, and in no console line, through everything above', async () => {
    const writes: { area: string; name: string; value: string }[] = [];
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      name: string,
      value: string,
    ) {
      writes.push({
        area: this === window.localStorage ? 'local' : 'session',
        name,
        value,
      });
      return original.call(this, name, value);
    });
    const logged: unknown[][] = [];
    for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logged.push(args));
    }
    fakeServer({
      'POST /api/anything': {},
      'POST /api/rejected': failure(429, 'BYOK_KEY_REJECTED'),
      'GET /api/usage': {},
    });
    setByokKey(TEST_KEY, 'gemini-2.5-flash');
    await request('/api/anything', { method: 'POST' });
    await request('/api/rejected', { method: 'POST' }).catch(() => undefined);
    await request('/api/usage');
    clearByok();

    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) {
      if (write.value.includes(TEST_KEY)) expect(write.area).toBe('session');
    }
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(TEST_KEY);
    expect(JSON.stringify(logged)).not.toContain(TEST_KEY);
    expect(logged).toEqual([]);
  });
});
