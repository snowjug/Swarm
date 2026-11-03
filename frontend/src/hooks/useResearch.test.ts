// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResearchView } from '../../../shared/research';
import { ApiError, request } from '../api';
import { researchApi } from '../api/research';
import { completed, run, runningAt, view } from '../scenes/ground/research/fixtures';
import { RESEARCH_BACKOFF_MS, RESEARCH_POLL_MS, nextReadIn, useResearch } from './useResearch';

// The research of one project as the page holds it: read when it opens, read again while a run is under way, and
// answered by what a person asks of it. Only the network is replaced, and the clock is the test's.

const live = (): ResearchView => view(runningAt('reading'));
const done = (): ResearchView => view(completed());

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Lets what is waiting (answers that have come, effects that follow them) happen, and the clock go on by `ms`. */
const tick = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));

describe('the pace of reading', () => {
  it('is the run’s: quick while it is under way, slower while it waits for a person, and slower again after each failure', () => {
    expect(nextReadIn(live(), 0)).toBe(RESEARCH_POLL_MS.live);
    expect(nextReadIn(view(run({ status: 'paused' })), 0)).toBe(RESEARCH_POLL_MS.paused);
    expect(nextReadIn(live(), 1)).toBe(2_000);
    expect(nextReadIn(live(), 2)).toBe(4_000);
    expect(nextReadIn(live(), 9)).toBe(RESEARCH_BACKOFF_MS);
  });
});

describe('reading', () => {
  it('reads once when the page opens and not again for a run that is over', async () => {
    const get = vi.spyOn(researchApi, 'get').mockResolvedValue(done());
    const { result } = renderHook(() => useResearch('p1', { enabled: true }));
    expect(result.current.loading).toBe(true);
    await tick();
    expect(result.current.view?.run?.status).toBe('completed');
    expect(result.current.loading).toBe(false);
    await tick(20_000);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('asks nothing where research is off', async () => {
    const get = vi.spyOn(researchApi, 'get').mockResolvedValue(done());
    const { result } = renderHook(() => useResearch('p1', { enabled: false }));
    await tick(5_000);
    expect(get).not.toHaveBeenCalled();
    expect(result.current.view).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('reads again at the pace of a run that is under way, and says once, when it ends, that it has', async () => {
    const get = vi
      .spyOn(researchApi, 'get')
      .mockResolvedValueOnce(live())
      .mockResolvedValueOnce(live())
      .mockResolvedValue(done());
    const onSettled = vi.fn();
    const { result } = renderHook(() => useResearch('p1', { enabled: true, onSettled }));
    await tick();
    expect(result.current.view?.run?.status).toBe('running');
    expect(get).toHaveBeenCalledTimes(1);

    await tick(RESEARCH_POLL_MS.live);
    expect(get).toHaveBeenCalledTimes(2);
    expect(onSettled).not.toHaveBeenCalled();

    await tick(RESEARCH_POLL_MS.live);
    expect(result.current.view?.run?.status).toBe('completed');
    expect(onSettled).toHaveBeenCalledTimes(1);

    await tick(30_000);
    expect(get).toHaveBeenCalledTimes(3);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('keeps the view it has when a read fails, says so, tries again more slowly, and is whole again when one succeeds', async () => {
    const timeout = () =>
      new ApiError('The server took too long to respond. Try again.', 'TIMEOUT');
    const get = vi
      .spyOn(researchApi, 'get')
      .mockResolvedValueOnce(live())
      .mockRejectedValueOnce(timeout())
      .mockRejectedValueOnce(timeout())
      .mockResolvedValue(live());
    const { result } = renderHook(() => useResearch('p1', { enabled: true }));
    await tick();
    const held = result.current.view;
    expect(held).not.toBeNull();

    await tick(RESEARCH_POLL_MS.live);
    expect(result.current.error).toMatch(/too long/u);
    expect(result.current.view).toBe(held);
    expect(get).toHaveBeenCalledTimes(2);

    await tick(1_999);
    expect(get).toHaveBeenCalledTimes(2);
    await tick(1);
    expect(get).toHaveBeenCalledTimes(3);
    await tick(3_999);
    expect(get).toHaveBeenCalledTimes(3);
    await tick(1);
    expect(get).toHaveBeenCalledTimes(4);
    expect(result.current.error).toBeNull();
    expect(result.current.view).not.toBe(held);
  });

  it('reports a first read that fails, with no view, tries again by itself, and offers to read at once', async () => {
    const get = vi
      .spyOn(researchApi, 'get')
      .mockRejectedValueOnce(new Error('Cannot reach the local server.'))
      .mockRejectedValueOnce(new Error('Cannot reach the local server.'))
      .mockResolvedValue(done());
    const { result } = renderHook(() => useResearch('p1', { enabled: true }));
    await tick();
    expect(result.current.error).toBe('Cannot reach the local server.');
    expect(result.current.view).toBeNull();
    expect(result.current.loading).toBe(false);

    await tick(2_000);
    expect(get).toHaveBeenCalledTimes(2);
    act(() => result.current.reload());
    await tick();
    expect(get).toHaveBeenCalledTimes(3);
    expect(result.current.view?.run?.status).toBe('completed');
    expect(result.current.error).toBeNull();
  });

  it('stops asking when the page is left', async () => {
    const get = vi.spyOn(researchApi, 'get').mockResolvedValue(live());
    const { result, unmount } = renderHook(() => useResearch('p1', { enabled: true }));
    await tick();
    expect(result.current.view).not.toBeNull();
    unmount();
    await tick(10_000);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('waits while the page is out of sight, and reads as soon as it is in sight again', async () => {
    const get = vi.spyOn(researchApi, 'get').mockResolvedValue(live());
    const seen = vi.spyOn(document, 'visibilityState', 'get');
    seen.mockReturnValue('visible');
    renderHook(() => useResearch('p1', { enabled: true }));
    await tick();
    expect(get).toHaveBeenCalledTimes(1);

    seen.mockReturnValue('hidden');
    await tick(RESEARCH_POLL_MS.live);
    expect(get).toHaveBeenCalledTimes(2);
    await tick(20_000);
    expect(get).toHaveBeenCalledTimes(2);

    seen.mockReturnValue('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await tick();
    expect(get).toHaveBeenCalledTimes(3);
  });
});

describe('what a person asks of it', () => {
  it('answers with the view the server returns, tells the page it changed, and does one thing at a time', async () => {
    vi.spyOn(researchApi, 'get').mockResolvedValue(live());
    let release: (next: ResearchView) => void = () => undefined;
    const pause = vi.spyOn(researchApi, 'pause').mockReturnValue(
      new Promise<ResearchView>((resolve) => {
        release = resolve;
      }),
    );
    const onChanged = vi.fn();
    const { result } = renderHook(() => useResearch('p1', { enabled: true, onChanged }));
    await tick();

    let first: Promise<boolean> = Promise.resolve(false);
    act(() => {
      first = result.current.pause();
    });
    expect(result.current.working).toBe('pause');
    let second = true;
    await act(async () => {
      second = await result.current.cancel();
    });
    expect(second).toBe(false);

    await act(async () => {
      release(view(run({ status: 'paused' })));
      await first;
    });
    expect(result.current.working).toBeNull();
    expect(result.current.view?.run?.status).toBe('paused');
    expect(pause).toHaveBeenCalledWith('p1', expect.any(AbortSignal));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('shows the run that is already under way when it is asked to start one, and calls it no problem', async () => {
    const get = vi
      .spyOn(researchApi, 'get')
      .mockResolvedValueOnce(view(null))
      .mockResolvedValue(live());
    vi.spyOn(researchApi, 'start').mockRejectedValue(
      new ApiError('Research is already running.', 'RESEARCH_ACTIVE'),
    );
    const { result } = renderHook(() => useResearch('p1', { enabled: true }));
    await tick();
    expect(result.current.view?.run).toBeNull();
    let ok = false;
    await act(async () => {
      ok = await result.current.start();
    });
    expect(ok).toBe(true);
    expect(result.current.problem).toBeNull();
    await tick();
    expect(result.current.view?.run?.status).toBe('running');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('says why a request was refused, and reads again so that the page shows what is true', async () => {
    const get = vi.spyOn(researchApi, 'get').mockResolvedValue(live());
    vi.spyOn(researchApi, 'addSource').mockRejectedValue(
      new ApiError('That address is on a private network, which Swarm never reads.', 'URL_BLOCKED'),
    );
    const { result } = renderHook(() => useResearch('p1', { enabled: true }));
    await tick();
    let ok = true;
    await act(async () => {
      ok = await result.current.addSource('https://10.0.0.1/');
    });
    expect(ok).toBe(false);
    expect(result.current.problem).toMatchObject({
      kind: 'add-source',
      message: expect.stringMatching(/private network/u),
    });
    await tick();
    expect(get).toHaveBeenCalledTimes(2);
    act(() => result.current.dismissProblem());
    expect(result.current.problem).toBeNull();
  });

  it('reads at the pace of a run after one is started, though there was none before', async () => {
    const get = vi
      .spyOn(researchApi, 'get')
      .mockResolvedValueOnce(view(null))
      .mockResolvedValue(live());
    vi.spyOn(researchApi, 'start').mockResolvedValue(
      view(run({ status: 'queued', stage: 'planning', plan: null })),
    );
    const { result } = renderHook(() => useResearch('p1', { enabled: true }));
    await tick();
    expect(result.current.view?.run).toBeNull();
    await tick(10_000);
    expect(get).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.view?.run?.status).toBe('queued');
    await tick(RESEARCH_POLL_MS.live);
    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe('what is done elsewhere on the page', () => {
  /** A change the server accepted, as the application's own client reports it to whoever listens. */
  async function accepted(path: string, method = 'POST') {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('{}', { status: 202, headers: { 'content-type': 'application/json' } }),
      ),
    );
    await act(async () => {
      await request(path, { method });
    });
    vi.unstubAllGlobals();
  }

  it('is read soon after: a question’s research that was started, a step, a run that was stopped', async () => {
    const get = vi
      .spyOn(researchApi, 'get')
      .mockResolvedValueOnce(view(null))
      .mockResolvedValue(live());
    const { result } = renderHook(() => useResearch('p1', { enabled: true }));
    await tick();
    expect(result.current.view?.run).toBeNull();

    await accepted('/api/projects/p1/research');
    await tick(399);
    expect(get).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(get).toHaveBeenCalledTimes(2);
    expect(result.current.view?.run?.status).toBe('running');

    await accepted('/api/projects/p1/cancel');
    await tick(400);
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('is not read for what has nothing to do with it, or for another project’s', async () => {
    const get = vi.spyOn(researchApi, 'get').mockResolvedValue(done());
    renderHook(() => useResearch('p1', { enabled: true }));
    await tick();
    await accepted('/api/projects/p1/claims/c1/review');
    await accepted('/api/projects/p2/research');
    await accepted('/api/projects/p2/steps/knowledge');
    await tick(1_000);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('is not read for what the hook asked itself, which the server answers in the same breath', async () => {
    const get = vi.spyOn(researchApi, 'get').mockResolvedValue(live());
    vi.spyOn(researchApi, 'pause').mockImplementation(async () => {
      await accepted('/api/projects/p1/research/pause');
      return view(run({ status: 'paused' }));
    });
    const { result } = renderHook(() => useResearch('p1', { enabled: true }));
    await tick();
    await act(async () => {
      await result.current.pause();
    });
    await tick(450);
    expect(get).toHaveBeenCalledTimes(1);
  });
});
