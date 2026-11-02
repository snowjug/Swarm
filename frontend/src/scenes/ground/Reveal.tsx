import type { ReactNode } from 'react';
import { cx } from '../../design/cx';

/** Content that grows open and closed in place, so that the page does not jump. It stays in the document, inert, when shut. */
export function Reveal({
  open,
  children,
  className,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('sw-ground-reveal', className)} data-open={open} inert={!open}>
      <div className="sw-ground-reveal__inner">{children}</div>
    </div>
  );
}
