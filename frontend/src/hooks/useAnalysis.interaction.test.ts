// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Analysis } from '../../../shared/analysis';
import type { AnalysisList } from '../../../shared/analysis-plan';
import { analysisFixture } from '../../../shared/lab-fixtures';
import { analysisApi } from '../api/analysis';
import { useAnalysis } from './useAnalysis';

// Which comparison is on show is the one that was asked for last, whatever order the server answers in.

vi.mock('../api/analysis', () => ({
  analysisApi: { list: vi.fn(), get: vi.fn(), start: vi.fn(), cancel: vi.fn() },
}));

const NOTHING_YET: AnalysisList = {
  analyses: [],
  readiness: {
    actors: null,
    suggestedVariants: [],
    perturbations: 0,
    rounds: 0,
    warnings: [],
    may: { run: false },
  },
};

/** An answer that arrives when the test says so. */
function later() {
  let resolve!: (value: Analysis) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Analysis>((ok, no) => {
    resolve = ok;
    reject = no;
  });
  return {
    promise,
    /** Lets the answer arrive, and the page do what it does with it. */
    arrive: (analysis: Analysis) =>
      act(async () => {
        resolve(analysis);
        await promise;
      }),
    fail: (reason: Error) =>
      act(async () => {
        reject(reason);
        await promise.catch(() => undefined);
      }),
  };
}

const older = analysisFixture({ id: 'older', status: 'completed' });
const newer = analysisFixture({ id: 'newer', status: 'completed' });

/** The hook for a project with nothing compared yet, once it has read that. */
async function opened(project = 'p-1') {
  vi.mocked(analysisApi.list).mockResolvedValue(NOTHING_YET);
  const view = renderHook(({ id }) => useAnalysis(id), { initialProps: { id: project } });
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
}

/** The signal that the nth read of a comparison was given. */
const signalOf = (call: number): AbortSignal | undefined =>
  vi.mocked(analysisApi.get).mock.calls[call]?.[2];

beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

describe('choosing a comparison', () => {
  it('shows the comparison chosen last, though the answer for an earlier choice arrives after it', async () => {
    const first = later();
    const second = later();
    vi.mocked(analysisApi.get)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = await opened();

    act(() => result.current.select('older'));
    act(() => result.current.select('newer'));
    await second.arrive(newer);
    expect(result.current.current?.id).toBe('newer');
    await first.arrive(older);
    expect(result.current.current?.id).toBe('newer');
  });

  it('says nothing of an earlier choice that fails after a newer one was made', async () => {
    const first = later();
    vi.mocked(analysisApi.get).mockReturnValueOnce(first.promise).mockResolvedValueOnce(newer);
    const { result } = await opened();

    act(() => result.current.select('older'));
    act(() => result.current.select('newer'));
    await waitFor(() => expect(result.current.current?.id).toBe('newer'));
    await first.fail(new Error('Cannot reach the local server.'));
    expect(result.current.error).toBeNull();
    expect(result.current.current?.id).toBe('newer');
  });

  it('stops reading a choice that a newer one, a change of project or leaving the page has replaced', async () => {
    vi.mocked(analysisApi.get).mockReturnValue(later().promise);
    const { result, rerender, unmount } = await opened();

    act(() => result.current.select('older'));
    expect(signalOf(0)?.aborted).toBe(false);
    act(() => result.current.select('newer'));
    expect(signalOf(0)?.aborted).toBe(true);
    expect(signalOf(1)?.aborted).toBe(false);
    rerender({ id: 'p-2' });
    expect(signalOf(1)?.aborted).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.select('older'));
    expect(signalOf(2)?.aborted).toBe(false);
    unmount();
    expect(signalOf(2)?.aborted).toBe(true);
  });

  it('shows nothing of a comparison that was chosen in a project that has since been left', async () => {
    const slow = later();
    vi.mocked(analysisApi.get).mockReturnValueOnce(slow.promise);
    const { result, rerender } = await opened('p-1');

    act(() => result.current.select('older'));
    rerender({ id: 'p-2' });
    await waitFor(() => expect(vi.mocked(analysisApi.list)).toHaveBeenCalledTimes(2));
    await slow.arrive(older);
    expect(result.current.current).toBeNull();
  });

  it('keeps a comparison that was just started on show over a choice still being read', async () => {
    const slow = later();
    const started = analysisFixture({ id: 'started', status: 'running', completedAt: null });
    vi.mocked(analysisApi.get).mockReturnValueOnce(slow.promise);
    vi.mocked(analysisApi.start).mockResolvedValueOnce(started);
    const { result } = await opened();

    act(() => result.current.select('older'));
    await act(async () => {
      await result.current.start({ runsPerVariant: 10 });
    });
    expect(result.current.current?.id).toBe('started');
    await slow.arrive(older);
    expect(result.current.current?.id).toBe('started');
  });
});
