import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

/** Marks an element of the panel that focus can be sent to by name, such as `toggle:customers`. */
export const FOCUS_ATTRIBUTE = 'data-stk-focus';

/** How long a request to move focus stays good: enough for a saved change to come back and be drawn. */
const REQUEST_MS = 4_000;

export type RequestFocus = (keys: readonly string[]) => void;

/**
 * Moves focus to a named element of the panel as soon as it is drawn. After a change the element that
 * had focus is often gone (an accepted row loses its Accept button, a removed one leaves the list), and
 * focus must not fall back to the top of the page. Several names may be given, in order of preference:
 * the first that is on the screen wins, so that a row that no longer exists falls back to its neighbour.
 *
 * An element that is on its way out (inert, or hidden from assistive technology: a panel that is being
 * replaced) is not a place to put focus, and the request waits for the one that replaces it, which is drawn
 * by something other than this component; so while a request is open the panel is watched for changes.
 */
export function useFocusRequest(scope: RefObject<HTMLElement | null>): RequestFocus {
  const wanted = useRef<{ keys: readonly string[]; until: number } | null>(null);
  const watcher = useRef<MutationObserver | null>(null);
  const [, redraw] = useState(0);

  const stop = useCallback(() => {
    watcher.current?.disconnect();
    watcher.current = null;
  }, []);

  const attempt = useCallback(() => {
    const request = wanted.current;
    if (!request) {
      stop();
      return;
    }
    if (Date.now() > request.until) {
      wanted.current = null;
      stop();
      return;
    }
    const named = [...(scope.current?.querySelectorAll<HTMLElement>(`[${FOCUS_ATTRIBUTE}]`) ?? [])];
    for (const key of request.keys) {
      const target = named.find(
        (element) =>
          element.getAttribute(FOCUS_ATTRIBUTE) === key &&
          element.getClientRects().length > 0 &&
          !element.closest('[inert], [aria-hidden="true"]'),
      );
      if (target) {
        wanted.current = null;
        stop();
        target.focus();
        return;
      }
    }
  }, [scope, stop]);

  // After every draw of the component that asked.
  useEffect(() => {
    attempt();
  });
  useEffect(() => stop, [stop]);

  return useCallback(
    (keys) => {
      wanted.current = { keys, until: Date.now() + REQUEST_MS };
      const root = scope.current;
      if (!watcher.current && root && typeof MutationObserver !== 'undefined') {
        watcher.current = new MutationObserver(attempt);
        watcher.current.observe(root, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['inert', 'hidden', 'aria-hidden', 'style', 'class'],
        });
      }
      redraw((old) => old + 1);
    },
    [attempt, scope],
  );
}

/** A sentence for a screen reader to say after a change, which the page itself does not show. */
export function useAnnouncer(): [string, (message: string) => void] {
  const [message, setMessage] = useState('');
  const say = useCallback((text: string) => {
    // The same sentence twice in a row is still said, because the text then differs by an unseen mark.
    setMessage((old) => (old === text ? `${text}\u200b` : text));
  }, []);
  return [message, say];
}
