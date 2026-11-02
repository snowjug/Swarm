import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { LeaveDialog } from './LeaveDialog';
import { AwayContext, HoldContext, type Away } from './unsaved-context';

interface Asking {
  what: string;
  proceed: () => void;
}

/**
 * Keeps what the scene in view holds, asks before a way out that would lose it, and warns when the tab is closed or the
 * page reloaded with work that is not saved. It stands above the shell, so that the shell only has to wrap its exits.
 */
export function UnsavedWorkProvider({ children }: { children: ReactNode }) {
  const [held, hold] = useState<string | null>(null);
  const heldNow = useRef(held);
  heldNow.current = held;
  const [asking, setAsking] = useState<Asking | null>(null);

  const away = useCallback<Away>((proceed) => {
    const what = heldNow.current;
    if (what === null) proceed();
    else setAsking({ what, proceed });
  }, []);
  const stay = useCallback(() => setAsking(null), []);
  const leave = useCallback(() => {
    const exit = asking?.proceed;
    setAsking(null);
    exit?.();
  }, [asking]);

  useEffect(() => {
    if (held === null) return undefined;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [held]);

  return (
    <HoldContext.Provider value={hold}>
      <AwayContext.Provider value={away}>
        {children}
        {asking && <LeaveDialog what={asking.what} onStay={stay} onLeave={leave} />}
      </AwayContext.Provider>
    </HoldContext.Provider>
  );
}
