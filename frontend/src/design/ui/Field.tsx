import { cloneElement, forwardRef, useEffect, useId, useLayoutEffect, useRef } from 'react';
import type {
  InputHTMLAttributes,
  ReactElement,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { cx } from '../cx';
import './Field.css';

/**
 * A label, a control and the words around it. It wires the label and the hint and the error to the
 * control, so that a screen reader reads them with it; the control itself is whatever is passed in.
 */
export function Field({
  label,
  hint,
  error,
  children,
  className,
  labelHidden,
}: {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>;
  className?: string;
  labelHidden?: boolean;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const described = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div className={cx('sw-field', className)}>
      <label htmlFor={id} className={cx('sw-field__label', labelHidden && 'sr-only')}>
        {label}
      </label>
      {cloneElement(children, {
        id,
        'aria-describedby': described || undefined,
        'aria-invalid': error ? true : undefined,
      })}
      {hint && (
        <p id={hintId} className="sw-field__hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="sw-field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input {...rest} ref={ref} className={cx('sw-input', className)} />;
  },
);

/** A text area that grows with what is written, to a limit, so that a long question is never scrolled inside a box. */
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { maxRows?: number; bare?: boolean }
>(function Textarea({ className, maxRows = 12, bare, value, onChange, ...rest }, forwarded) {
  const local = useRef<HTMLTextAreaElement | null>(null);
  const fit = () => {
    const node = local.current;
    if (!node) return;
    node.style.height = 'auto';
    const line = Number.parseFloat(getComputedStyle(node).lineHeight) || 24;
    const max = line * maxRows + 2;
    node.style.height = `${Math.min(node.scrollHeight, max)}px`;
    node.style.overflowY = node.scrollHeight > max ? 'auto' : 'hidden';
  };
  useLayoutEffect(fit);
  useEffect(() => {
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  });
  return (
    <textarea
      {...rest}
      value={value}
      onChange={onChange}
      ref={(node) => {
        local.current = node;
        if (typeof forwarded === 'function') forwarded(node);
        else if (forwarded) forwarded.current = node;
      }}
      className={cx(bare ? 'sw-textarea-bare' : 'sw-input sw-textarea', className)}
    />
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <span className={cx('sw-select', className)}>
        <select {...rest} ref={ref} className="sw-input sw-select__control">
          {children}
        </select>
        <svg className="sw-select__caret" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M4 6l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  },
);

/** An on-off choice. A native checkbox with the switch role, so it works with every assistive technology. */
export const Switch = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role'> & {
    label: ReactNode;
    description?: ReactNode;
  }
>(function Switch({ label, description, className, ...rest }, ref) {
  const id = useId();
  return (
    <label className={cx('sw-switch', className)} htmlFor={id}>
      <input
        {...rest}
        ref={ref}
        id={id}
        type="checkbox"
        role="switch"
        className="sw-switch__input"
      />
      <span className="sw-switch__track" aria-hidden="true">
        <span className="sw-switch__thumb" />
      </span>
      <span className="sw-switch__text">
        <span className="sw-switch__label">{label}</span>
        {description && <span className="sw-switch__desc">{description}</span>}
      </span>
    </label>
  );
});
