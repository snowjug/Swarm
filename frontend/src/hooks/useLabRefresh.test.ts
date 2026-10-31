import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConsoleStep } from '../../../shared/guided';
import { LAB_POLL_MS, startLabPolling, useLabRefresh } from './useLabRefresh';

// The hook only needs refs and effects, so a few lines stand in for React's: effects run after each
// "render" whose dependencies changed, and the clean-up of the last one runs first.
const harness = vi.hoisted(() => {
  type Effect = { deps: unknown[]; cleanup: void | (() => void) };
  const state = {
    refs: [] as { current: unknown }[],
    effects: [] as Effect[],
    pending: [] as { index: number; run: () => void | (() => void); deps: unknown[] }[],
    nextRef: 0,
    nextEffect: 0,
  };
  return state;
});

vi.mock('react', () => ({
  useRef: (initial: unknown) => {
    const index = harness.nextRef++;
    harness.refs[index] ??= { current: initial };
    return harness.refs[index];
  },
  useEffect: (run: () => void | (() => void), deps: unknown[]) => {
    harness.pending.push({ index: harness.nextEffect++, run, deps });
  },
}));

interface Props {
  step: ConsoleStep;
  enabled: boolean;
  polling: boolean;
  refresh: () => void;
}

function render(props: Props): void {
  harness.nextRef = 0;
  harness.nextEffect = 0;
  harness.pending = [];
  // The stand-in for React above is what runs this, not a component.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useLabRefresh(props);
  for (const { index, run, deps } of harness.pending) {
    const previous = harness.effects[index];
    if (previous && deps.every((dep, at) => Object.is(dep, previous.deps[at]))) continue;
    if (previous) previous.cleanup?.();
    harness.effects[index] = { deps, cleanup: run() };
  }
}

function unmount(): void {
  for (const effect of harness.effects) effect.cleanup?.();
  harness.effects = [];
  harness.refs = [];
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  unmount();
  vi.useRealTimers();
});

describe('reading the project again while a comparison runs', () => {
  it('reads every four seconds until it is stopped', () => {
    const read = vi.fn();
    const stop = startLabPolling(read);
    expect(LAB_POLL_MS).toBe(4_000);
    vi.advanceTimersByTime(LAB_POLL_MS - 1);
    expect(read).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(read).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(LAB_POLL_MS * 2);
    expect(read).toHaveBeenCalledTimes(3);
    stop();
    vi.advanceTimersByTime(LAB_POLL_MS * 5);
    expect(read).toHaveBeenCalledTimes(3);
  });
});

describe('keeping the lab’s progress up to date in the workspace', () => {
  const idle = (refresh: () => void, step: ConsoleStep = 'knowledge'): Props => ({
    step,
    enabled: true,
    polling: false,
    refresh,
  });

  it('does not read the project again for the stage it was opened in', () => {
    const refresh = vi.fn();
    render(idle(refresh, 'simulation'));
    render(idle(refresh, 'simulation'));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('reads it once each time a stage that shows the lab’s result is opened', () => {
    const refresh = vi.fn();
    render(idle(refresh));
    render(idle(refresh, 'environment'));
    expect(refresh).not.toHaveBeenCalled();
    render(idle(refresh, 'simulation'));
    expect(refresh).toHaveBeenCalledTimes(1);
    render(idle(refresh, 'simulation'));
    expect(refresh).toHaveBeenCalledTimes(1);
    render(idle(refresh, 'report'));
    expect(refresh).toHaveBeenCalledTimes(2);
    render(idle(refresh, 'interaction'));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('reads nothing for a record with no guided stages', () => {
    const refresh = vi.fn();
    render({ ...idle(refresh), enabled: false });
    render({ ...idle(refresh, 'simulation'), enabled: false, polling: true });
    vi.advanceTimersByTime(LAB_POLL_MS * 3);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('reads every four seconds while polling, and stops when the comparison is over', () => {
    const refresh = vi.fn();
    render(idle(refresh, 'simulation'));
    render({ ...idle(refresh, 'simulation'), polling: true });
    vi.advanceTimersByTime(LAB_POLL_MS * 2);
    expect(refresh).toHaveBeenCalledTimes(2);
    render({ ...idle(refresh, 'simulation'), polling: false });
    vi.advanceTimersByTime(LAB_POLL_MS * 3);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('calls the latest way of reading, not the one it started with', () => {
    const first = vi.fn();
    const second = vi.fn();
    render({ ...idle(first, 'simulation'), polling: true });
    render({ ...idle(second, 'simulation'), polling: true });
    vi.advanceTimersByTime(LAB_POLL_MS);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops reading when the workspace goes away', () => {
    const refresh = vi.fn();
    render({ ...idle(refresh, 'report'), polling: true });
    unmount();
    vi.advanceTimersByTime(LAB_POLL_MS * 3);
    expect(refresh).not.toHaveBeenCalled();
  });
});
