import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProviderStatus } from '../../../shared/types';
import { api, errorMessage, isAbort } from '../api';
import { PROVIDER_BADGE_ID, providerChangeAnnouncement } from '../lib/provider';

export const PROVIDER_POLL_MS = 20_000;
export const PROVIDER_STATUS_TIMEOUT_MS = 15_000;

export type ProviderVerification =
  | { phase: 'idle' }
  | { phase: 'pending' }
  | { phase: 'success'; at: string; latencyMs: number | null }
  | { phase: 'error'; at: string; message: string };

export interface ProviderMonitorState {
  status: ProviderStatus | null;
  /** Set while the latest status read failed; the page keeps working and says "status unavailable". */
  error: string | null;
  verification: ProviderVerification;
  /** Changes only when something worth announcing changed, so a routine poll is silent. */
  announcement: string;
}

export const INITIAL_PROVIDER_STATE: ProviderMonitorState = {
  status: null,
  error: null,
  verification: { phase: 'idle' },
  announcement: '',
};

export interface ProviderMonitor {
  refresh: (options?: { force?: boolean; announce?: boolean }) => Promise<void>;
  verify: () => Promise<void>;
  dispose: () => void;
}

/**
 * Reads the credential-free provider status on start, on window focus and every 20 seconds while
 * the tab is visible, and runs the one explicit connection check on request. Nothing here calls
 * the model on its own: only `verify` reaches the provider.
 */
export function createProviderMonitor(
  onState: (state: ProviderMonitorState) => void,
): ProviderMonitor {
  const doc = document;
  const win = window;
  let state = INITIAL_PROVIDER_STATE;
  let disposed = false;
  let statusRequest: AbortController | null = null;
  let statusTimeout: ReturnType<typeof setTimeout> | undefined;
  let checkRequest: AbortController | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  // Bumped when a check result lands so an older in-flight status read cannot overwrite it.
  let revision = 0;

  const visible = () => doc.visibilityState !== 'hidden';
  const publish = (patch: Partial<ProviderMonitorState>) => {
    if (disposed) return;
    state = { ...state, ...patch };
    onState(state);
  };
  const accept = (
    next: ProviderStatus,
    announce: boolean,
    extra: Partial<ProviderMonitorState> = {},
  ) => {
    const announcement = announce
      ? providerChangeAnnouncement(state.status, next, state.error !== null)
      : '';
    publish({ ...extra, status: next, error: null, ...(announcement ? { announcement } : {}) });
  };
  const fail = (message: string, announce: boolean) => {
    publish({
      error: message,
      ...(announce && state.error === null
        ? { announcement: 'Model provider status is unavailable.' }
        : {}),
    });
  };
  const stopTimer = () => {
    if (pollTimer !== undefined) clearTimeout(pollTimer);
    pollTimer = undefined;
  };
  const abortStatus = () => {
    statusRequest?.abort();
    statusRequest = null;
    if (statusTimeout !== undefined) clearTimeout(statusTimeout);
    statusTimeout = undefined;
  };
  const schedule = () => {
    stopTimer();
    if (disposed || !visible()) return;
    pollTimer = setTimeout(() => {
      pollTimer = undefined;
      void refresh();
    }, PROVIDER_POLL_MS);
  };

  const refresh: ProviderMonitor['refresh'] = async ({ force = false, announce = true } = {}) => {
    if (disposed || !visible() || (statusRequest && !force)) return;
    abortStatus();
    stopTimer();
    const controller = new AbortController();
    statusRequest = controller;
    const started = revision;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, PROVIDER_STATUS_TIMEOUT_MS);
    statusTimeout = timeout;
    try {
      const next = await api.providerStatus(controller.signal);
      if (disposed || controller.signal.aborted || started !== revision) return;
      accept(next, announce);
    } catch (failure) {
      if (disposed || started !== revision) return;
      if (!timedOut && (controller.signal.aborted || isAbort(failure))) return;
      fail(
        timedOut
          ? 'The server did not answer the provider status request in time.'
          : errorMessage(failure),
        announce,
      );
    } finally {
      clearTimeout(timeout);
      if (statusTimeout === timeout) statusTimeout = undefined;
      if (statusRequest === controller) {
        statusRequest = null;
        schedule();
      }
    }
  };

  const verify = async () => {
    // The synchronous guard makes a double click send exactly one request.
    if (disposed || checkRequest || state.status?.mode !== 'real-model') return;
    const controller = new AbortController();
    checkRequest = controller;
    publish({ verification: { phase: 'pending' } });
    try {
      const next = await api.checkProvider(controller.signal);
      if (disposed || controller.signal.aborted) return;
      revision += 1;
      accept(next, false, {
        verification: {
          phase: 'success',
          at: new Date().toISOString(),
          latencyMs: next.lastLatencyMs,
        },
      });
    } catch (failure) {
      if (disposed || controller.signal.aborted || isAbort(failure)) return;
      publish({
        verification: {
          phase: 'error',
          at: new Date().toISOString(),
          message: errorMessage(failure),
        },
      });
      // The server records a failed check, so read it back instead of guessing the connectivity.
      void refresh({ force: true, announce: false });
    } finally {
      if (checkRequest === controller) checkRequest = null;
    }
  };

  const onVisibility = () => {
    if (visible()) {
      void refresh();
      return;
    }
    abortStatus();
    stopTimer();
  };
  const onFocus = () => void refresh();
  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('focus', onFocus);
  void refresh();

  return {
    refresh,
    verify,
    dispose: () => {
      disposed = true;
      abortStatus();
      checkRequest?.abort();
      stopTimer();
      doc.removeEventListener('visibilitychange', onVisibility);
      win.removeEventListener('focus', onFocus);
    },
  };
}

export function useProviderStatus() {
  const [state, setState] = useState<ProviderMonitorState>(INITIAL_PROVIDER_STATE);
  const [open, setOpen] = useState(false);
  const monitor = useRef<ProviderMonitor | null>(null);
  useEffect(() => {
    const created = createProviderMonitor(setState);
    monitor.current = created;
    return () => {
      created.dispose();
      if (monitor.current === created) monitor.current = null;
    };
  }, []);
  useEffect(() => {
    // The panel is in the page flow directly under the header, so bring it into view.
    if (open && window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'instant' });
  }, [open]);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) document.getElementById(PROVIDER_BADGE_ID)?.focus();
  }, []);
  const verify = useCallback(() => monitor.current?.verify() ?? Promise.resolve(), []);
  const retry = useCallback(
    () => monitor.current?.refresh({ force: true }) ?? Promise.resolve(),
    [],
  );
  return { state, open, toggle, close, verify, retry };
}
