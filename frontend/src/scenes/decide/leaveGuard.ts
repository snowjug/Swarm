import { createContext, useContext, useEffect, useRef } from 'react';

/**
 * A scene that is opened beside the brief (the editor, the detailed report) may hold words that are not saved. The
 * way back to the brief is the brief's own bar, which cannot know that, so the scene says it: while it holds
 * something, `ask` is called when the person asks to go back, and the way back waits for its answer.
 */
export interface LeaveGuard {
  /** Whether going back may go on: false when the scene has asked the person first. */
  allowed: () => boolean;
  register: (ask: (() => void) | null) => void;
}

export const LeaveGuardContext = createContext<LeaveGuard | null>(null);

/** Makes the way back to the brief ask first while `holding` is true. */
export function useLeaveGuard(holding: boolean, ask: () => void): void {
  const guard = useContext(LeaveGuardContext);
  const latest = useRef(ask);
  latest.current = ask;
  useEffect(() => {
    if (!guard || !holding) return undefined;
    guard.register(() => latest.current());
    return () => guard.register(null);
  }, [guard, holding]);
}
