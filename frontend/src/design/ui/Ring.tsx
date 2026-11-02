import type { ReactNode } from 'react';
import { cx } from '../cx';
import './Ring.css';

/**
 * Progress of work that is under way, as a ring that fills. Its fill moves with a spring, so that a
 * jump in what the server reports is a glide. Put the number or the glyph in the middle as children.
 */
export function Ring({
  value,
  size = 56,
  stroke = 4,
  label,
  valueText,
  tone = 'accent',
  children,
  className,
}: {
  value: number;
  size?: number;
  stroke?: number;
  label: string;
  valueText?: string;
  tone?: 'accent' | 'favor' | 'against' | 'caution';
  children?: ReactNode;
  className?: string;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const share = Math.min(1, Math.max(0, value));
  return (
    <div
      className={cx('sw-ring', `sw-ring--${tone}`, className)}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(share * 100)}
      aria-valuetext={valueText}
    >
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
        <circle
          className="sw-ring__track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
        />
        <circle
          className="sw-ring__fill"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - share)}
        />
      </svg>
      {children && <div className="sw-ring__center">{children}</div>}
    </div>
  );
}
