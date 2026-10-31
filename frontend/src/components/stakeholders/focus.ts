import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

/** Marks an element of the panel that focus can be sent to by name, such as `toggle:customers`. */
export const FOCUS_ATTRIBUTE = 'data-stk-focus';

/** How long a request to move focus stays good: enough for a saved change to come back and be drawn. */
const REQUEST_MS = 4_000;

export type RequestFocus = (keys: readonly string[]) => void;

/** What the parts of the review need to tell the person and to look after focus when they change something. */
export interface ReviewHooks {
  focus: RequestFocus;
  say: (message: string) => void;
}

/**
 * Moves focus to a named element of the panel as soon as it is drawn. After a change the element that
 * had focus is often gone (an accepted row loses its Accept button, a removed one leaves the list), and
 * focus must not fall back to the top of the page. Several names may be given, in order of preference:
 * the first that is on the screen wins, so that a row that no longer exists falls back to its neighbour.
 */
export function useFocusRequest(scope: RefObject<HTMLElement | null>): RequestFocus {
  const wanted = useRef<{ keys: readonly string[]; until: number } | null>(null);
  const [, redraw] = useState(0);
  useEffect(() => {
    const request = wanted.current;
    if (!request) return;
    if (Date.now() > request.until) {
      wanted.current = null;
      return;
    }
    const named = [...(scope.current?.querySelectorAll<HTMLElement>(`[${FOCUS_ATTRIBUTE}]`) ?? [])];
    for (const key of request.keys) {
      const target = named.find(
        (element) =>
          element.getAttribute(FOCUS_ATTRIBUTE) === key && element.getClientRects().length > 0,
      );
      if (target) {
        wanted.current = null;
        target.focus();
        return;
      }
    }
  });
  return useCallback((keys) => {
    wanted.current = { keys, until: Date.now() + REQUEST_MS };
    redraw((old) => old + 1);
  }, []);
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
