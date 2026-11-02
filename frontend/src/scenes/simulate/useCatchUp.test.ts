// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceContext } from '../../app/context';
import { workspaceStub } from '../../test/dom';
import { useCatchUp } from './useCatchUp';

// What a scene gives to the hook that watches the comparisons: it has the shell read the project again, quietly, and it is
// the same function on every draw, so that handing it over never restarts the watching.

describe('catching the shell up', () => {
  it('has the shell read the project again without a spinner, with the latest workspace each time', () => {
    const before = vi.fn();
    const after = vi.fn();
    let workspace = workspaceStub({ refresh: before });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(WorkspaceContext.Provider, { value: workspace }, children);
    const { result, rerender } = renderHook(() => useCatchUp(), { wrapper });
    const catchUp = result.current;

    catchUp();
    expect(before).toHaveBeenCalledExactlyOnceWith({ quiet: true });

    // The shell makes a new workspace whenever the project changes; the function the scene holds does not change with it.
    workspace = workspaceStub({ refresh: after });
    rerender();
    expect(result.current).toBe(catchUp);
    catchUp();
    expect(after).toHaveBeenCalledExactlyOnceWith({ quiet: true });
    expect(before).toHaveBeenCalledTimes(1);
  });
});
