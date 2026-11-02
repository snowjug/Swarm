import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../cx';
import { Tooltip } from './Tooltip';
import './IconButton.css';

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label'
> {
  /** What it does. It is the accessible name and the tooltip: an icon alone says nothing to a screen reader. */
  label: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'plain' | 'glass' | 'accent';
  /** A toggle: whether it is on. */
  pressed?: boolean;
  /** A key hint shown in the tooltip. */
  shortcut?: string;
  tooltip?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    label,
    children,
    size = 'md',
    tone = 'plain',
    pressed,
    shortcut,
    tooltip = true,
    className,
    type = 'button',
    ...rest
  },
  ref,
) {
  const button = (
    <button
      {...rest}
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      className={cx(
        'sw-icon-btn',
        `sw-icon-btn--${size}`,
        `sw-icon-btn--${tone}`,
        pressed && 'is-on',
        className,
      )}
    >
      {children}
    </button>
  );
  return tooltip ? (
    <Tooltip label={label} shortcut={shortcut}>
      {button}
    </Tooltip>
  ) : (
    button
  );
});
