import type { ReactNode } from 'react';
import { PopoverContent } from '../../../design/ui';
import { cx } from '../../../design/cx';
import './pop.css';

/**
 * A popover of detail. It is named for what it shows, not for the control that opened it, and it can take
 * keyboard focus, so that a reader who moves by keyboard can scroll it when what it holds is taller than the
 * room the page has left for it.
 */
export function DetailPopover({
  label,
  width,
  align = 'center',
  className,
  children,
}: {
  label: string;
  width: string;
  align?: 'start' | 'center' | 'end';
  className?: string;
  children: ReactNode;
}) {
  return (
    <PopoverContent
      tabIndex={0}
      aria-label={label}
      width={width}
      align={align}
      className={cx('sw-decide-pop', className)}
    >
      {children}
    </PopoverContent>
  );
}
