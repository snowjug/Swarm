import { forwardRef, useRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../cx';
import { useSpotlight } from '../motion';
import { Orbit } from './Orbit';
import './Button.css';

export type ButtonVariant = 'primary' | 'accent' | 'glass' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `primary` is the one action of a screen; `accent` is the single "go" (run, start); the rest are quieter. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shown before the label; replaced by the loader while `busy`. */
  icon?: ReactNode;
  iconEnd?: ReactNode;
  /** Work is under way: the button says so, and cannot be pressed again. */
  busy?: boolean;
  busyLabel?: string;
  block?: boolean;
}

/**
 * A tactile button: it lifts on hover, gives under the finger and follows the pointer with a little
 * light. It is a real `<button>`; `busy` sets `aria-busy` and disables it rather than hiding the label.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'glass',
    size = 'md',
    icon,
    iconEnd,
    busy = false,
    busyLabel,
    block = false,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  forwarded,
) {
  const local = useRef<HTMLButtonElement | null>(null);
  useSpotlight(local);
  return (
    <button
      {...rest}
      ref={(node) => {
        local.current = node;
        if (typeof forwarded === 'function') forwarded(node);
        else if (forwarded) forwarded.current = node;
      }}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        'sw-btn',
        `sw-btn--${variant}`,
        `sw-btn--${size}`,
        block && 'sw-btn--block',
        className,
      )}
    >
      {busy ? <Orbit size={size === 'lg' ? 20 : 16} label={busyLabel ?? 'Working'} /> : icon}
      {children !== undefined && children !== null && (
        <span className="sw-btn__label">{children}</span>
      )}
      {iconEnd}
    </button>
  );
});
