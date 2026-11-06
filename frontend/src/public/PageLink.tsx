import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { goTo, pageOfPath } from './pages';

/**
 * A link to another page of this site. A plain click moves within the page, without loading it again; anything else (a
 * new tab, a modified click, a path that is not one of ours) is left to the browser.
 */
export function PageLink({
  to,
  onClick,
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const ours = to === '/' || pageOfPath(to.split('?')[0] ?? to) !== null;
  return (
    <a
      {...rest}
      href={to}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (
          !ours ||
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          rest.target === '_blank'
        )
          return;
        event.preventDefault();
        goTo(to);
      }}
    >
      {children}
    </a>
  );
}
