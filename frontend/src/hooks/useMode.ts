import { useCallback, useState } from 'react';
import { MODE_STORAGE_KEY, readStoredMode, type UiMode } from '../lib/mode';

/** Guided or Advanced: the person's choice, kept in this browser only. Guided until one is made. */
export function useMode(): { mode: UiMode; choose: (next: UiMode) => void } {
  const [mode, setMode] = useState<UiMode>(() =>
    readStoredMode(typeof localStorage === 'undefined' ? undefined : localStorage),
  );
  const choose = useCallback((next: UiMode) => {
    setMode(next);
    try {
      localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {
      // The choice then lasts until the page is closed.
    }
  }, []);
  return { mode, choose };
}
