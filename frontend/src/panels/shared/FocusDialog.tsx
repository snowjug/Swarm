import { useEffect, useRef } from 'react';

/**
 * Put inside a dialog to begin on the dialog itself. The primitive moves focus to the first control it
 * finds, which in a dialog that is still reading what it shows is whichever button happens to be there;
 * the dialog's own title and description are the better first thing for a screen reader to meet, and a
 * keyboard reaches the first control with one Tab.
 */
export function FocusDialog() {
  const mark = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const dialog = mark.current?.closest<HTMLElement>('[role="dialog"]');
    if (!dialog) return undefined;
    // After the primitive has had its turn.
    const timer = setTimeout(() => dialog.focus({ preventScroll: true }), 0);
    return () => clearTimeout(timer);
  }, []);
  return <span ref={mark} hidden />;
}
