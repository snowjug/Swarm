import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { cx } from '../cx';
import './Chip.css';

export type Tone = 'neutral' | 'accent' | 'against' | 'favor' | 'caution' | 'critical';

interface ChipBase {
  tone?: Tone;
  /** A small filled point before the label, in the tone's colour. Never the only cue: the label says it too. */
  dot?: boolean;
  icon?: ReactNode;
  size?: 'sm' | 'md';
  /** Its words may wrap onto more lines, for a label that can be long. */
  wrap?: boolean;
}

/** A short label: a status, an origin, a count. It is text first; the colour only helps the eye find it. */
export function Chip({
  tone = 'neutral',
  dot,
  icon,
  size = 'md',
  wrap,
  className,
  children,
  ...rest
}: ChipBase & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...rest}
      className={cx(
        'sw-chip',
        `sw-chip--${tone}`,
        `sw-chip--${size}`,
        wrap && 'sw-chip--wrap',
        className,
      )}
    >
      {dot && <span className="sw-chip__dot" aria-hidden="true" />}
      {icon}
      {children}
    </span>
  );
}

/** A chip that is a toggle: a filter, a choice. `pressed` is its state. */
export function ChipButton({
  tone = 'neutral',
  dot,
  icon,
  size = 'md',
  wrap,
  pressed,
  className,
  children,
  type = 'button',
  ...rest
}: ChipBase & { pressed?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      type={type}
      aria-pressed={pressed}
      className={cx(
        'sw-chip',
        'sw-chip--button',
        `sw-chip--${tone}`,
        `sw-chip--${size}`,
        wrap && 'sw-chip--wrap',
        pressed && 'is-on',
        className,
      )}
    >
      {dot && <span className="sw-chip__dot" aria-hidden="true" />}
      {icon}
      {children}
    </button>
  );
}
