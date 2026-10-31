import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analysisFixture } from '../../../shared/lab-fixtures';
import { POLL_MS, RETRY_MS, watchAnalysis } from './useAnalysis';

const running = analysisFixture({ status: 'running', completedAt: null });
const done = analysisFixture({ status: 'completed' });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Watches a comparison whose successive reads are `reads`; the last of them is repeated for ever. */
function watch(reads: (() => Promise<typeof running>)[]) {
  let at = 0;
  const read = vi.fn(() => reads[Math.min(at++, reads.length - 1)]!());
  const seen = { updates: [] as string[], trouble: [] as (string | null)[], finished: 0 };
  const stop = watchAnalysis({
    read,
    onUpdate: (analysis) => seen.updates.push(analysis.status),
    onFinished: () => {
      seen.finished += 1;
    },
    onTrouble: (reason) => seen.trouble.push(reason),
    describe: (failure) => (failure as Error).message,
  });
  return { read, seen, stop };
}

describe('watching a running comparison', () => {
  it('reads once a second while it runs, and tells the page once it is no longer running', async () => {
    const { read, seen } = watch([
      () => Promise.resolve(running),
      () => Promise.resolve(running),
      () => Promise.resolve(done),
    ]);
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(read).toHaveBeenCalledTimes(3);
    expect(seen.updates).toEqual(['running', 'running', 'completed']);
    expect(seen.finished).toBe(1);
    await vi.advanceTimersByTimeAsync(POLL_MS * 5);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('keeps trying after a read fails, later each time, and says so only until a read works again', async () => {
    const down = () => Promise.reject(new Error('Cannot reach the local server.'));
    const { read, seen } = watch([
      down,
      down,
      () => Promise.resolve(running),
      () => Promise.resolve(done),
    ]);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(seen.trouble).toEqual(['Cannot reach the local server.']);
    // The first wait after a failure is the first of the retry waits, the second is the next.
    await vi.advanceTimersByTimeAsync(RETRY_MS[0]! - 1);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(RETRY_MS[1]!);
    expect(read).toHaveBeenCalledTimes(3);
    expect(seen.trouble).toEqual([
      'Cannot reach the local server.',
      'Cannot reach the local server.',
      null,
    ]);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(seen.updates).toEqual(['running', 'completed']);
    expect(seen.finished).toBe(1);
  });

  it('settles on the longest wait however long the server is away', async () => {
    const { read } = watch([() => Promise.reject(new Error('down'))]);
    await vi.advanceTimersByTimeAsync(POLL_MS + RETRY_MS.reduce((sum, ms) => sum + ms, 0));
    const calls = read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(RETRY_MS.at(-1)!);
    expect(read.mock.calls.length).toBe(calls + 1);
  });

  it('stops reading, and says nothing more, once it is told to stop', async () => {
    const { read, seen, stop } = watch([() => Promise.resolve(running)]);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    stop();
    await vi.advanceTimersByTimeAsync(POLL_MS * 10);
    expect(read).toHaveBeenCalledTimes(1);
    expect(seen.updates).toEqual(['running']);
  });
});
