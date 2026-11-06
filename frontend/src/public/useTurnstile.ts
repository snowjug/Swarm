import { useCallback, useEffect, useRef, useState } from 'react';
import { loadTurnstile, type TurnstileApi } from './turnstile';

type Phase = 'off' | 'loading' | 'ready' | 'failed';

/**
 * The bot check as the sign-in card uses it: it is off without a site key, and with one it loads the check, draws it
 * into `container` and hands over the token it gives. A token is good for one use, so the card asks for a new one with
 * `reset` after a try that did not work.
 */
export function useTurnstile(siteKey: string | null) {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<{ api: TurnstileApi; id: string } | null>(null);
  const [state, setState] = useState<{ phase: Phase; token: string | null }>({
    phase: siteKey ? 'loading' : 'off',
    token: null,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!siteKey) {
      setState({ phase: 'off', token: null });
      return undefined;
    }
    let cancelled = false;
    setState({ phase: 'loading', token: null });
    loadTurnstile().then(
      (api) => {
        const holder = container.current;
        if (cancelled || !holder) return;
        const id = api.render(holder, {
          sitekey: siteKey,
          theme: 'auto',
          callback: (token) => setState({ phase: 'ready', token }),
          'expired-callback': () => setState({ phase: 'loading', token: null }),
          'error-callback': () => setState({ phase: 'failed', token: null }),
        });
        widget.current = { api, id };
      },
      () => {
        if (!cancelled) setState({ phase: 'failed', token: null });
      },
    );
    return () => {
      cancelled = true;
      const drawn = widget.current;
      widget.current = null;
      try {
        drawn?.api.remove(drawn.id);
      } catch {
        // The widget is already gone.
      }
    };
  }, [siteKey, attempt]);

  const reset = useCallback(() => {
    const drawn = widget.current;
    if (!drawn) return;
    setState({ phase: 'loading', token: null });
    try {
      drawn.api.reset(drawn.id);
    } catch {
      setState({ phase: 'failed', token: null });
    }
  }, []);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  return { container, phase: state.phase, token: state.token, reset, retry };
}
