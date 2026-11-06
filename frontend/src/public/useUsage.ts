import { useCallback, useEffect, useRef, useState } from 'react';
import { isAbort, onAcceptedChange } from '../api';
import { subscribeByok } from './byokStore';
import { publicApi } from './publicApi';
import { isUsageView, type UsageState } from './usageView';

/** How long after the last accepted change the meter is read, and how long after it for the work that is still running. */
const SOON_MS = 500;
const LATER_MS = 8_000;
const EVERY_MS = 30_000;

/**
 * What the person has left of the free tier, read when the page opens, after each change the server accepts (and once
 * more a few seconds later, when a run has had time to use some), when the key is added or forgotten, when the tab
 * comes back, and every half minute while it is in view. A reading that is no longer the latest is dropped.
 */
export function useUsage(): { usage: UsageState; refresh: () => void } {
  const [usage, setUsage] = useState<UsageState>({ view: null, failed: false });
  const current = useRef<AbortController | null>(null);

  const read = useCallback(async () => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    try {
      const view = await publicApi.usage(controller.signal);
      if (controller.signal.aborted) return;
      if (isUsageView(view)) setUsage({ view, failed: false });
      else setUsage((old) => ({ view: old.view, failed: true }));
    } catch (failure) {
      if (controller.signal.aborted || isAbort(failure)) return;
      setUsage((old) => ({ view: old.view, failed: true }));
    }
  }, []);

  useEffect(() => {
    let soon: ReturnType<typeof setTimeout> | undefined;
    let later: ReturnType<typeof setTimeout> | undefined;
    const visible = () => {
      if (document.visibilityState === 'visible') void read();
    };
    void read();
    const stopChanges = onAcceptedChange(() => {
      clearTimeout(soon);
      clearTimeout(later);
      soon = setTimeout(() => void read(), SOON_MS);
      later = setTimeout(() => void read(), LATER_MS);
    });
    const stopKey = subscribeByok(() => void read());
    const poll = setInterval(visible, EVERY_MS);
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearTimeout(soon);
      clearTimeout(later);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', visible);
      stopChanges();
      stopKey();
      current.current?.abort();
    };
  }, [read]);

  const refresh = useCallback(() => void read(), [read]);
  return { usage, refresh };
}
