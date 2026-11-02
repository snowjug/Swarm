/**
 * Getting somewhere on the page from a sheet. A sheet that is closing still holds the page behind it inert, so
 * focus put on the page in that moment is not heard; the page waits until the sheet is gone.
 */

const SHEET = '.sw-ground-sheet[role="dialog"]';
const CONTROL = 'button, a[href], [role="button"], [tabindex]';

/** The control the last press landed on, for browsers that do not focus a button when it is pressed. */
let pressed: WeakRef<HTMLElement> | null = null;
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

/** What had the person's attention when something opened: the focused control, or else the one just pressed. */
export function opener(): HTMLElement | null {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) return active;
  const control = pressed?.deref();
  return control?.isConnected ? control : null;
}

/** Whether focus is on nothing: the page has not given it to anything since what held it went away. */
export function nothingFocused(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || active === document.documentElement;
}

/** Whether a sheet is on the page. One that is closing still is, until its exit has finished. */
export function sheetOnPage(): boolean {
  return document.querySelector(SHEET) !== null;
}

/**
 * Calls `then` with the element once it is on the page and no sheet is over it, a tick later so that whatever
 * closed the sheet has handed focus back by then and this comes after it. Gives up after `within` ms, and
 * says so to `missed`. The function it returns stops the waiting.
 */
export function whenReachable(
  find: () => HTMLElement | null,
  then: (element: HTMLElement) => void,
  within: number,
  missed?: () => void,
): () => void {
  let waiting = true;
  let timer = 0;
  let tick = 0;
  const observer = new MutationObserver(() => check());
  const stop = () => {
    waiting = false;
    observer.disconnect();
    window.clearTimeout(timer);
    window.clearTimeout(tick);
  };
  function check() {
    if (!waiting) return;
    const element = find();
    if (!element || sheetOnPage()) return;
    waiting = false;
    observer.disconnect();
    window.clearTimeout(timer);
    tick = window.setTimeout(() => {
      if (element.isConnected) then(element);
    }, 0);
  }
  observer.observe(document.body, { childList: true, subtree: true });
  timer = window.setTimeout(() => {
    if (!waiting) return;
    stop();
    missed?.();
  }, within);
  check();
  return stop;
}
