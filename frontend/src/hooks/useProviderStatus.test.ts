import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderStatus } from '../../../shared/types';
import { api, ApiError } from '../api';
import { localStatusFixture, realStatusFixture } from '../test/provider';
import {
  PROVIDER_POLL_MS,
  PROVIDER_STATUS_TIMEOUT_MS,
  createProviderMonitor,
} from './useProviderStatus';
import type { ProviderMonitorState } from './useProviderStatus';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The controller only needs window focus and document visibility, which plain event targets model. */
function browser() {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  return {
    hide() {
      doc.visibilityState = 'hidden';
      doc.dispatchEvent(new Event('visibilitychange'));
    },
    show() {
      doc.visibilityState = 'visible';
      doc.dispatchEvent(new Event('visibilitychange'));
    },
    focus: () => win.dispatchEvent(new Event('focus')),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** Rejects like fetch does when its signal aborts, and records every signal it was given. */
function abortable(signals: AbortSignal[]) {
  return (signal?: AbortSignal) =>
    new Promise<ProviderStatus>((_resolve, reject) => {
      signals.push(signal!);
      signal!.addEventListener('abort', () =>
        reject(new DOMException('The operation was aborted.', 'AbortError')),
      );
    });
}

function start(
  read: (signal?: AbortSignal) => Promise<ProviderStatus> = async () => realStatusFixture(),
) {
  const env = browser();
  const status = vi.spyOn(api, 'providerStatus').mockImplementation(read);
  const states: ProviderMonitorState[] = [];
  const monitor = createProviderMonitor((state) => states.push(state));
  return { env, status, monitor, states, latest: () => states.at(-1)! };
}

const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

describe('provider status polling', () => {
  it('reads the status as soon as it starts', async () => {
    const { status, latest, monitor } = start();
    await tick();
    expect(status).toHaveBeenCalledOnce();
    expect(latest().status).toEqual(realStatusFixture());
    expect(latest().error).toBeNull();
    expect(latest().verification).toEqual({ phase: 'idle' });
    monitor.dispose();
  });

  it('polls every 20 seconds while the tab is visible, one request at a time', async () => {
    const { status, monitor } = start();
    await tick();
    await tick(PROVIDER_POLL_MS - 1);
    expect(status).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(status).toHaveBeenCalledTimes(2);
    await tick(PROVIDER_POLL_MS);
    expect(status).toHaveBeenCalledTimes(3);
    monitor.dispose();
  });

  it('never starts a second read while one is still in flight', async () => {
    const read = deferred<ProviderStatus>();
    const { status, env, monitor } = start(() => read.promise);
    await tick();
    env.focus();
    await tick(PROVIDER_STATUS_TIMEOUT_MS - 1);
    expect(status).toHaveBeenCalledTimes(1);
    monitor.dispose();
  });

  it('refreshes when the window regains focus', async () => {
    const { status, env, monitor } = start();
    await tick();
    env.focus();
    await tick();
    expect(status).toHaveBeenCalledTimes(2);
    monitor.dispose();
  });

  it('pauses while the tab is hidden: no timer, no request, and an immediate read on return', async () => {
    const { status, env, monitor } = start();
    await tick();
    env.hide();
    expect(vi.getTimerCount()).toBe(0);
    await tick(PROVIDER_POLL_MS * 5);
    env.focus();
    await tick(PROVIDER_POLL_MS * 5);
    expect(status).toHaveBeenCalledTimes(1);
    env.show();
    await tick();
    expect(status).toHaveBeenCalledTimes(2);
    await tick(PROVIDER_POLL_MS);
    expect(status).toHaveBeenCalledTimes(3);
    monitor.dispose();
  });

  it('aborts an in-flight read when the tab is hidden and ignores its abort', async () => {
    const signals: AbortSignal[] = [];
    const { env, states, monitor } = start(abortable(signals));
    await tick();
    expect(signals[0]?.aborted).toBe(false);
    env.hide();
    await tick();
    expect(signals[0]?.aborted).toBe(true);
    expect(states).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    monitor.dispose();
  });

  it('does not poll at all when it starts in a hidden tab, and reads once it becomes visible', async () => {
    const env = browser();
    env.hide();
    const status = vi.spyOn(api, 'providerStatus').mockResolvedValue(realStatusFixture());
    const monitor = createProviderMonitor(() => {});
    await tick(PROVIDER_POLL_MS * 3);
    expect(status).not.toHaveBeenCalled();
    env.show();
    await tick();
    expect(status).toHaveBeenCalledOnce();
    monitor.dispose();
  });

  it('aborts the in-flight read, clears every timer and detaches listeners on dispose', async () => {
    const signals: AbortSignal[] = [];
    const { status, env, states, monitor } = start(abortable(signals));
    await tick();
    monitor.dispose();
    expect(signals[0]?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    env.focus();
    env.hide();
    env.show();
    await tick(PROVIDER_POLL_MS * 3);
    expect(status).toHaveBeenCalledTimes(1);
    expect(states).toHaveLength(0);
  });

  it('clears the polling timer on dispose after a completed read', async () => {
    const { status, monitor } = start();
    await tick();
    expect(vi.getTimerCount()).toBe(1);
    monitor.dispose();
    expect(vi.getTimerCount()).toBe(0);
    await tick(PROVIDER_POLL_MS * 2);
    expect(status).toHaveBeenCalledTimes(1);
  });
});

describe('provider status failures', () => {
  it('shows "unavailable" without discarding the last status, announces it once, then recovers', async () => {
    const reads = [
      async () => realStatusFixture({ connectivity: 'ok' }),
      async () => {
        throw new ApiError('Cannot reach the local server. Check that the backend is running.');
      },
      async () => {
        throw new ApiError('Cannot reach the local server. Check that the backend is running.');
      },
      async () => realStatusFixture({ connectivity: 'ok' }),
    ];
    const { latest, monitor } = start(() => reads.shift()!());
    await tick();
    expect(latest().announcement).toBe('');
    await tick(PROVIDER_POLL_MS);
    expect(latest().error).toContain('Cannot reach the local server');
    expect(latest().status?.connectivity).toBe('ok');
    expect(latest().announcement).toBe('Model provider status is unavailable.');
    await tick(PROVIDER_POLL_MS);
    expect(latest().announcement).toBe('Model provider status is unavailable.');
    await tick(PROVIDER_POLL_MS);
    expect(latest().error).toBeNull();
    expect(latest().announcement).toBe(
      'Model provider status is available again: REAL AZURE AI, swarm-dev-deployment, connected.',
    );
    monitor.dispose();
  });

  it('keeps polling after a failure', async () => {
    const { status, latest, monitor } = start(async () => {
      throw new ApiError('The request failed (503). Please retry.');
    });
    await tick();
    expect(latest()).toMatchObject({
      status: null,
      error: 'The request failed (503). Please retry.',
    });
    await tick(PROVIDER_POLL_MS * 2);
    expect(status).toHaveBeenCalledTimes(3);
    monitor.dispose();
  });

  it('gives up on a hung read after the timeout and reports it as unavailable', async () => {
    const signals: AbortSignal[] = [];
    const { status, latest, monitor } = start(abortable(signals));
    await tick(PROVIDER_STATUS_TIMEOUT_MS);
    expect(signals[0]?.aborted).toBe(true);
    expect(latest().error).toBe('The server did not answer the provider status request in time.');
    await tick(PROVIDER_POLL_MS);
    expect(status).toHaveBeenCalledTimes(2);
    monitor.dispose();
  });
});

describe('provider change announcements while polling', () => {
  it('speaks only when connectivity changes, never on every poll', async () => {
    const sequence: ProviderStatus['connectivity'][] = [
      'unverified',
      'unverified',
      'ok',
      'ok',
      'failing',
      'failing',
    ];
    const { latest, monitor } = start(async () =>
      realStatusFixture({ connectivity: sequence.shift()! }),
    );
    const spoken: string[] = [];
    for (let poll = 0; poll < 6; poll += 1) {
      await tick(poll === 0 ? 0 : PROVIDER_POLL_MS);
      spoken.push(latest().announcement);
    }
    expect(spoken).toEqual([
      '',
      '',
      'Model provider connectivity is now connected.',
      'Model provider connectivity is now connected.',
      'Model provider connectivity is now failing.',
      'Model provider connectivity is now failing.',
    ]);
    monitor.dispose();
  });
});

describe('explicit connection verification', () => {
  const connected = () =>
    realStatusFixture({
      connectivity: 'ok',
      lastCheckedAt: '2026-01-01T00:00:05.000Z',
      lastLatencyMs: 412,
    });

  it('runs one real check, applies the returned status and keeps the result for the panel', async () => {
    const { latest, monitor } = start();
    await tick();
    const check = vi.spyOn(api, 'checkProvider').mockResolvedValue(connected());
    await monitor.verify();
    expect(check).toHaveBeenCalledOnce();
    expect(latest().verification).toMatchObject({ phase: 'success', latencyMs: 412 });
    expect(latest().status?.connectivity).toBe('ok');
    expect(latest().announcement).toBe('');
    monitor.dispose();
  });

  it('shows the pending state while the request is outstanding', async () => {
    const { latest, monitor } = start();
    await tick();
    const request = deferred<ProviderStatus>();
    vi.spyOn(api, 'checkProvider').mockReturnValue(request.promise);
    const running = monitor.verify();
    expect(latest().verification).toEqual({ phase: 'pending' });
    request.resolve(connected());
    await running;
    expect(latest().verification.phase).toBe('success');
    monitor.dispose();
  });

  it('shows the server message on failure and then reads back the recorded failure', async () => {
    const failing = realStatusFixture({
      connectivity: 'failing',
      lastError: {
        code: 'MODEL_AUTH',
        message: 'The provider rejected or could not obtain credentials.',
      },
    });
    const reads = [async () => realStatusFixture(), async () => failing];
    const { status, latest, monitor } = start(() => reads.shift()!());
    await tick();
    vi.spyOn(api, 'checkProvider').mockRejectedValue(
      new ApiError('The provider rejected or could not obtain credentials.', 'MODEL_AUTH', 'req-7'),
    );
    await monitor.verify();
    await tick();
    expect(latest().verification).toMatchObject({
      phase: 'error',
      message: 'The provider rejected or could not obtain credentials. Request ID: req-7',
    });
    expect(status).toHaveBeenCalledTimes(2);
    expect(latest().status?.connectivity).toBe('failing');
    expect(latest().status?.lastError?.code).toBe('MODEL_AUTH');
    expect(latest().announcement).toBe('');
    monitor.dispose();
  });

  it('allows a retry after a failure', async () => {
    const { latest, monitor } = start();
    await tick();
    const check = vi
      .spyOn(api, 'checkProvider')
      .mockRejectedValueOnce(new ApiError('The provider endpoint could not be reached.'))
      .mockResolvedValueOnce(connected());
    await monitor.verify();
    await tick();
    expect(latest().verification.phase).toBe('error');
    await monitor.verify();
    expect(check).toHaveBeenCalledTimes(2);
    expect(latest().verification.phase).toBe('success');
    monitor.dispose();
  });

  it('guards against a double click: concurrent calls send exactly one request', async () => {
    const { monitor } = start();
    await tick();
    const request = deferred<ProviderStatus>();
    const check = vi.spyOn(api, 'checkProvider').mockReturnValue(request.promise);
    const first = monitor.verify();
    const second = monitor.verify();
    const third = monitor.verify();
    expect(check).toHaveBeenCalledOnce();
    request.resolve(connected());
    await Promise.all([first, second, third]);
    expect(check).toHaveBeenCalledOnce();
    await monitor.verify();
    expect(check).toHaveBeenCalledTimes(2);
    monitor.dispose();
  });

  it('never calls the provider in local mode or before the status is known', async () => {
    const check = vi.spyOn(api, 'checkProvider').mockResolvedValue(connected());
    const unknown = start(() => new Promise<ProviderStatus>(() => {}));
    await tick();
    await unknown.monitor.verify();
    unknown.monitor.dispose();
    const local = start(async () => localStatusFixture());
    await tick();
    await local.monitor.verify();
    expect(check).not.toHaveBeenCalled();
    expect(local.latest().verification).toEqual({ phase: 'idle' });
    local.monitor.dispose();
  });

  it('aborts an in-flight check on dispose without publishing a result', async () => {
    const { states, monitor } = start();
    await tick();
    let signal: AbortSignal | undefined;
    vi.spyOn(api, 'checkProvider').mockImplementation(
      (given) =>
        new Promise((_resolve, reject) => {
          signal = given;
          given!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    const running = monitor.verify();
    const before = states.length;
    monitor.dispose();
    await running;
    expect(signal?.aborted).toBe(true);
    expect(states).toHaveLength(before);
  });

  it('does not let an older status read overwrite a newer check result', async () => {
    const stale = deferred<ProviderStatus>();
    const reads = [async () => realStatusFixture(), () => stale.promise];
    const { latest, monitor } = start(() => reads.shift()!());
    await tick();
    await tick(PROVIDER_POLL_MS);
    vi.spyOn(api, 'checkProvider').mockResolvedValue(connected());
    await monitor.verify();
    expect(latest().status?.connectivity).toBe('ok');
    stale.resolve(realStatusFixture({ connectivity: 'unverified' }));
    await tick();
    expect(latest().status?.connectivity).toBe('ok');
    monitor.dispose();
  });
});
