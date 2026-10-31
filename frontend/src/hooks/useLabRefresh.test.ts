import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConsoleStep } from '../../../shared/guided';
import type { LabWatch } from '../lib/console';
import { LAB_NUDGE_MS, LAB_POLL_MS, startLabPolling, useLabRefresh } from './useLabRefresh';

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
  watch: LabWatch | null;
  refresh: () => void;
}

function render(props: Props): { nudge: () => void } {
  harness.nextRef = 0;
  harness.nextEffect = 0;
  harness.pending = [];
  // The stand-in for React above is what runs this, not a component.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const result = useLabRefresh(props);
  for (const { index, run, deps } of harness.pending) {
    const previous = harness.effects[index];
    if (previous && deps.every((dep, at) => Object.is(dep, previous.deps[at]))) continue;
    if (previous) previous.cleanup?.();
    harness.effects[index] = { deps, cleanup: run() };
  }
  return result;
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

describe('reading the project again', () => {
  it('reads at the interval it is given until it is stopped', () => {
    const read = vi.fn();
    const stop = startLabPolling(read, 1_000);
    vi.advanceTimersByTime(999);
    expect(read).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(read).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2_000);
    expect(read).toHaveBeenCalledTimes(3);
    stop();
    vi.advanceTimersByTime(5_000);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('is quick while a comparison runs and slow while one could be started', () => {
    expect(LAB_POLL_MS).toEqual({ running: 2_000, waiting: 5_000 });
    expect(LAB_NUDGE_MS).toBeLessThan(LAB_POLL_MS.running);
  });
});

describe('keeping the lab’s progress up to date in the workspace', () => {
  const idle = (refresh: () => void, step: ConsoleStep = 'knowledge'): Props => ({
    step,
    enabled: true,
    watch: null,
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
    const { nudge } = render({ ...idle(refresh), enabled: false });
    render({ ...idle(refresh, 'simulation'), enabled: false, watch: 'running' });
    nudge();
    vi.advanceTimersByTime(LAB_POLL_MS.waiting * 3);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('reads every two seconds while a comparison runs, and stops when it is over', () => {
    const refresh = vi.fn();
    render(idle(refresh, 'simulation'));
    render({ ...idle(refresh, 'simulation'), watch: 'running' });
    vi.advanceTimersByTime(LAB_POLL_MS.running * 3);
    expect(refresh).toHaveBeenCalledTimes(3);
    render({ ...idle(refresh, 'simulation'), watch: null });
    vi.advanceTimersByTime(LAB_POLL_MS.waiting * 3);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('reads every five seconds while it waits for a comparison to be started, and is quick once it runs', () => {
    const refresh = vi.fn();
    render({ ...idle(refresh, 'simulation'), watch: 'waiting' });
    vi.advanceTimersByTime(LAB_POLL_MS.waiting - 1);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    render({ ...idle(refresh, 'simulation'), watch: 'running' });
    vi.advanceTimersByTime(LAB_POLL_MS.running);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('calls the latest way of reading, not the one it started with', () => {
    const first = vi.fn();
    const second = vi.fn();
    render({ ...idle(first, 'simulation'), watch: 'running' });
    render({ ...idle(second, 'simulation'), watch: 'running' });
    vi.advanceTimersByTime(LAB_POLL_MS.running);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops reading when the workspace goes away', () => {
    const refresh = vi.fn();
    const { nudge } = render({ ...idle(refresh, 'report'), watch: 'waiting' });
    nudge();
    unmount();
    vi.advanceTimersByTime(LAB_POLL_MS.waiting * 3);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('reading at once after a click in a stage that is being watched', () => {
  const watching = (refresh: () => void, watch: LabWatch | null = 'waiting'): Props => ({
    step: 'simulation',
    enabled: true,
    watch,
    refresh,
  });

  it('reads once, shortly after the click, not at the next read', () => {
    const refresh = vi.fn();
    const { nudge } = render(watching(refresh));
    nudge();
    vi.advanceTimersByTime(LAB_NUDGE_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(LAB_NUDGE_MS).toBeLessThan(LAB_POLL_MS.waiting);
  });

  it('reads once for a run of clicks, counted from the last', () => {
    const refresh = vi.fn();
    const { nudge } = render(watching(refresh));
    nudge();
    vi.advanceTimersByTime(LAB_NUDGE_MS - 100);
    nudge();
    vi.advanceTimersByTime(LAB_NUDGE_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('reads nothing for a click where the record cannot be changing', () => {
    const refresh = vi.fn();
    const { nudge } = render(watching(refresh, null));
    nudge();
    vi.advanceTimersByTime(LAB_NUDGE_MS * 3);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('follows what the workspace says now, not what it said when it rendered', () => {
    const refresh = vi.fn();
    const { nudge } = render(watching(refresh, null));
    render(watching(refresh, 'waiting'));
    nudge();
    vi.advanceTimersByTime(LAB_NUDGE_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not read after the workspace is gone', () => {
    const refresh = vi.fn();
    const { nudge } = render(watching(refresh));
    nudge();
    unmount();
    vi.advanceTimersByTime(LAB_NUDGE_MS * 3);
    expect(refresh).not.toHaveBeenCalled();
  });
});
