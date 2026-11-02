import { cx } from '../cx';
import type { Tone } from './Chip';
import './Meter.css';

/**
 * A single value against its range, as a bar that fills with a spring. It is `role="meter"`: the value
 * is read as a number, not guessed from a colour. Use `Ring` for progress of work that is under way.
 */
export function Meter({
  value,
  min = 0,
  max = 1,
  label,
  valueText,
  tone = 'accent',
  size = 'md',
  className,
}: {
  value: number;
  min?: number;
  max?: number;
  label: string;
  valueText?: string;
  tone?: Tone;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const span = max - min || 1;
  const share = Math.min(1, Math.max(0, (value - min) / span));
  return (
    <div
      className={cx('sw-meter', `sw-meter--${tone}`, `sw-meter--${size}`, className)}
      role="meter"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
    >
      <div className="sw-meter__fill" style={{ transform: `scaleX(${share})` }} />
    </div>
  );
}
