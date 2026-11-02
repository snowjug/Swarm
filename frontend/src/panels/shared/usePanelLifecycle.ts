import { useCallback, useEffect, useRef, useState } from 'react';
import { rememberedPlace } from './place';

/**
 * How long a surface takes to leave, read from the token its stylesheet animates with, so that the
 * person's motion setting shortens it as well.
 */
function leaveMilliseconds(token: '--dur-base' | '--dur-fast'): number {
  if (typeof document === 'undefined') return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return 0;
  return raw.endsWith('ms') ? value : value * 1000;
}

/**
 * What to give focus back to. A panel chosen from a menu was opened by a button the menu hides, so the
 * menu's own button is the place the person was; when focus has already left both, it is the place that
 * was remembered as the focus moved.
 */
function focusOrigin(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) {
    if (!active.closest('[role="menu"]')) return active;
    return (
      document.querySelector<HTMLElement>('[aria-haspopup="menu"][aria-expanded="true"]') ??
      rememberedPlace()
    );
  }
  return rememberedPlace();
}

/**
 * Where focus goes when a panel opens: the panel itself, so that its title is read and nothing is lit or
 * announced before the person chooses; the first Tab then reaches the first control.
 */
export function focusPanel(event: Event): void {
  event.preventDefault();
  if (event.target instanceof HTMLElement) event.target.focus({ preventScroll: true });
}

/**
 * The shell mounts a panel only while it is open and unmounts it the moment `onOpenChange(false)` is
 * called, which would cut its exit short. This lets the panel leave by itself: it closes first, plays the
 * exit its stylesheet has, then tells the shell, and gives focus back to where the person was.
 */
export function usePanelLifecycle(
  open: boolean,
  onOpenChange: (open: boolean) => void,
  kind: 'sheet' | 'dialog' = 'sheet',
): { open: boolean; onOpenChange: (open: boolean) => void } {
  const [shown, setShown] = useState(open);
  const origin = useRef<HTMLElement | null | undefined>(undefined);
  if (origin.current === undefined) origin.current = focusOrigin();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const report = useRef(onOpenChange);
  useEffect(() => {
    report.current = onOpenChange;
  });
  useEffect(() => setShown(open), [open]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const change = useCallback(
    (next: boolean) => {
      if (next) {
        setShown(true);
        report.current(true);
        return;
      }
      if (timer.current) return;
      setShown(false);
      const wait = leaveMilliseconds(kind === 'sheet' ? '--dur-base' : '--dur-fast') + 40;
      timer.current = setTimeout(() => {
        timer.current = null;
        const back = origin.current;
        if (back?.isConnected) back.focus({ preventScroll: true });
        report.current(false);
      }, wait);
    },
    [kind],
  );

  return { open: shown, onOpenChange: change };
}
