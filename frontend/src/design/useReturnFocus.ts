import { useCallback, useRef } from 'react';

/** The control the last press landed on, for the browsers that do not focus a button when it is pressed (Safari). */
let pressed: WeakRef<HTMLElement> | null = null;

const CONTROL = 'button, a[href], [role="button"], [role="menuitem"], [tabindex]';

// From the moment this file is loaded, so that the press that opens the first sheet is known too.
if (typeof document !== 'undefined') {
  document.addEventListener(
    'pointerdown',
    (event) => {
      const target =
        event.target instanceof Element ? event.target.closest<HTMLElement>(CONTROL) : null;
      pressed = target ? new WeakRef(target) : null;
    },
    true,
  );
}

/** The control the last press landed on, while it is still on the page. */
export function pressedControl(): HTMLElement | null {
  const control = pressed?.deref();
  return control?.isConnected ? control : null;
}

/** What had the person's attention when something opened: the focused control, or else the one just pressed. */
function opener(): HTMLElement | null {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) return active;
  return pressedControl();
}

/**
 * Where focus goes when a sheet or a dialog closes. Radix gives it back to the trigger, and one that the page
 * controls (opened by a button that is not its trigger: the source sheet of Ask, the Details of the Map) has none,
 * so focus would be left on the page and a keyboard would start again from the top. The control that was in use
 * when it opened is remembered and gets focus back, as long as it is still on the page.
 *
 * `remember` is the ref of the content: a ref is attached as the content is added to the page, before anything in
 * it (or the dialog itself) has moved focus, which is the one moment the opener is still known. `restore` goes in
 * `onCloseAutoFocus`.
 */
export function useReturnFocus(): {
  remember: (node: HTMLElement | null) => void;
  restore: (event: Event) => void;
} {
  const from = useRef<HTMLElement | null>(null);
  const taken = useRef(false);
  const remember = useCallback((node: HTMLElement | null) => {
    if (!node || taken.current) return;
    taken.current = true;
    from.current = opener();
  }, []);
  const restore = useCallback((event: Event) => {
    const element = from.current;
    from.current = null;
    taken.current = false;
    if (!element?.isConnected) return;
    event.preventDefault();
    // Something else has already taken focus (a saved change puts it on what it made): that is where it stays.
    if (document.activeElement && document.activeElement !== document.body) return;
    element.focus({ preventScroll: true });
  }, []);
  return { remember, restore };
}
