/**
 * A sheet opens with its own surface focused, not its first control: the close button's tooltip would
 * otherwise open at once and take the first Escape, and a person who opened a sheet to read it should not
 * have to find their place first. Tab moves in from there.
 */
export function focusSheet(event: Event): void {
  event.preventDefault();
  const surface = event.target;
  if (surface instanceof HTMLElement) surface.focus({ preventScroll: true });
}
