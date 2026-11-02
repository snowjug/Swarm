import type { ReactNode } from 'react';
import { cx } from '../cx';
import { useTween } from '../motion';
import './Stat.css';

/**
 * A number that matters, set large in the serif with its label small above or below. A numeric value
 * eases to its figure when it changes, so a count that the engine reports is seen arriving.
 */
export function Stat({
  value,
  label,
  format = (n) => Math.round(n).toLocaleString('en-GB'),
  suffix,
  tone,
  size = 'md',
  caption,
  className,
}: {
  value: number | string;
  label: ReactNode;
  format?: (value: number) => string;
  suffix?: ReactNode;
  tone?: 'against' | 'favor' | 'caution' | 'accent';
  size?: 'sm' | 'md' | 'lg';
  caption?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('sw-stat', `sw-stat--${size}`, tone && `sw-stat--${tone}`, className)}>
      <div className="sw-stat__figure sw-numeral">
        {typeof value === 'number' ? <Animated value={value} format={format} /> : value}
        {suffix && <span className="sw-stat__suffix">{suffix}</span>}
      </div>
      <div className="sw-stat__label">{label}</div>
      {caption && <div className="sw-stat__caption">{caption}</div>}
    </div>
  );
}

function Animated({ value, format }: { value: number; format: (value: number) => string }) {
  const shown = useTween(value);
  return <>{format(shown)}</>;
}
