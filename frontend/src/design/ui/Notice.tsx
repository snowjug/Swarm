import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from 'lucide-react';
import { cx } from '../cx';
import './Notice.css';

export type NoticeTone = 'info' | 'success' | 'caution' | 'error';

const ICONS = {
  info: Info,
  success: CheckCircle2,
  caution: AlertTriangle,
  error: OctagonAlert,
} as const;

/**
 * A line of status that belongs to what it sits in: something to know, something that went wrong and
 * how to mend it. It is a rule and a few words, not a box; the colour is in the icon and the edge.
 */
export function Notice({
  tone = 'info',
  title,
  children,
  action,
  className,
}: {
  tone?: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const Icon = ICONS[tone];
  return (
    <div
      className={cx('sw-notice', `sw-notice--${tone}`, className)}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <Icon className="sw-notice__icon" size={18} aria-hidden="true" />
      <div className="sw-notice__text">
        {title && <strong>{title}</strong>}
        {children && <div>{children}</div>}
      </div>
      {action && <div className="sw-notice__action">{action}</div>}
    </div>
  );
}
