/**
 * Where the person was before a panel took the focus. A panel is made after the thing that opened it has
 * already let go of the focus (a menu closes as it is chosen from), so the place has to be remembered
 * as the focus moves, not looked for afterwards: the last control focused outside any panel or popup,
 * and for a choice made in a menu, the button that opened the menu.
 */
let place: HTMLElement | null = null;

function remember(event: FocusEvent): void {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.closest('[role="menu"]')) {
    place =
      document.querySelector<HTMLElement>('[aria-haspopup="menu"][aria-expanded="true"]') ?? place;
    return;
  }
  if (target.closest('[role="dialog"], [data-radix-popper-content-wrapper]')) return;
  if (target !== document.body) place = target;
}

if (typeof document !== 'undefined') document.addEventListener('focusin', remember, true);

/** The remembered place, if it is still on the page. */
export function rememberedPlace(): HTMLElement | null {
  return place?.isConnected ? place : null;
}
