import type { ReactNode } from 'react';
import { cx } from '../../design/cx';
import './Reveal.css';

/**
 * Something that is there for the person who opens it and takes no room for the one who does not. The control that
 * opens it is placed by the caller (it has to sit where its row needs it), and says `aria-expanded` and
 * `aria-controls` with the `id` given here. Closed, the content stays in the page but cannot be reached (`inert`).
 */
export function Reveal({
  id,
  open,
  className,
  children,
}: {
  id: string;
  open: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div id={id} className={cx('sw-ask-reveal', className)} data-open={open} inert={!open}>
      <div className="sw-ask-reveal__inner">{children}</div>
    </div>
  );
}
