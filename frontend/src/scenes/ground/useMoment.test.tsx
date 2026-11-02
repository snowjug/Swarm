// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '../../test/dom';
import { GroundDataContext, type GroundData, type LedgerView } from './context';
import { project } from './fixtures';
import type { GroundStage } from './model';
import { useMoment } from './useMoment';

// Whether the page says that the conflicts are being looked for. The clock is the test's.

const unread: LedgerView = {
  ledger: null,
  loading: true,
  error: null,
  reload: () => undefined,
  replace: () => undefined,
};

function held(stage: GroundStage, watchedRun: boolean, ledger: LedgerView = unread): GroundData {
  return {
    project: project(stage === 'running' ? 'running' : 'ready'),
    stage,
    conflictsKnown: stage === 'ready',
    watchedRun,
    ledger,
  } as unknown as GroundData;
}

describe('the moment of a page whose ledger is not read yet', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** The hook, in a page whose data the test changes between renders. */
  function page(first: GroundData) {
    let data = first;
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(GroundDataContext.Provider, { value: data }, children);
    const hook = renderHook(() => useMoment(), { wrapper });
    return {
      hook,
      show: (next: GroundData) => {
        data = next;
        hook.rerender();
      },
    };
  }

  it('says ready on a page opened on a project that is done, however long the ledger takes', () => {
    const { hook } = page(held('ready', false));
    act(() => void vi.advanceTimersByTime(5_000));
    expect(hook.result.current.checking).toBe(false);
    expect(hook.result.current.moment).toBe('ready');
  });

  it('says that the conflicts are being looked for on a page that watched the engine work, once that takes a moment', () => {
    const { hook, show } = page(held('running', true));
    expect(hook.result.current.moment).not.toBe('checking');
    show(held('ready', true));
    // A check that is over at once is not announced.
    act(() => void vi.advanceTimersByTime(200));
    expect(hook.result.current.checking).toBe(false);
    act(() => void vi.advanceTimersByTime(300));
    expect(hook.result.current.checking).toBe(true);
    expect(hook.result.current.moment).toBe('checking');

    show(
      held('ready', true, { ...unread, ledger: { contradictions: [] } as never, loading: false }),
    );
    expect(hook.result.current.checking).toBe(false);
    expect(hook.result.current.moment).toBe('ready');
  });
});
