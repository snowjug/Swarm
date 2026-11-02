import type { ReactNode } from 'react';
import { cx } from '../cx';
import './EmptyState.css';

/** What a place says when there is nothing in it yet: one glyph, one line, and the one thing to do. */
export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
  level = 3,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  level?: 1 | 2 | 3 | 4;
}) {
  const Heading = `h${level}` as const;
  return (
    <div className={cx('sw-empty', className)}>
      {icon && <div className="sw-empty__orb">{icon}</div>}
      <Heading className="sw-empty__title">{title}</Heading>
      {children && <p className="sw-empty__text">{children}</p>}
      {action}
    </div>
  );
}
