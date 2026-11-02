import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cx } from '../../../design/cx';
import { IconButton, Input, Slider } from '../../../design/ui';
import './fields.css';

const show = (value: number): string =>
  Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : '';

/**
 * A number that can be typed. It keeps what is typed as text while it is being typed, so that a minus sign
 * or half a decimal is not undone, and tells its owner the number as soon as there is one (or NaN when
 * the box is empty or is not a number).
 */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 0.01,
  label,
  invalid,
  disabled,
  placeholder,
  id,
  describedBy,
  className,
}: {
  value: number | undefined;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
  invalid?: boolean;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  describedBy?: string;
  className?: string;
}) {
  const [text, setText] = useState(value === undefined ? '' : show(value));
  const [synced, setSynced] = useState(value);
  // The owner changed the number from somewhere else (a slider, a reset): the box follows it.
  if (!Object.is(synced, value)) {
    setSynced(value);
    const typed = text.trim() === '' ? Number.NaN : Number(text);
    if (!Object.is(typed, value)) setText(value === undefined ? '' : show(value));
  }
  return (
    <Input
      id={id}
      className={cx('sw-deep-number', className)}
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={id ? undefined : label}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      onChange={(event) => {
        const next = event.target.value;
        const parsed = next.trim() === '' ? Number.NaN : Number(next);
        setText(next);
        setSynced(parsed);
        onChange(parsed);
      }}
    />
  );
}

/**
 * A number set by sliding or by typing, with what it means beside it. The slider is the quick way; the box
 * is the exact one. Both say the same number, and a mistake is said under them.
 */
export function SliderField({
  label,
  value,
  onChange,
  min,
  max,
  step = 0.01,
  diverging,
  words,
  hint,
  error,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  diverging?: boolean;
  /** The value in words, for the slider's reading by a screen reader and for the eye. */
  words?: (value: number) => string;
  hint?: ReactNode;
  error?: string | undefined;
  disabled?: boolean;
}) {
  const id = useId();
  const finite = Number.isFinite(value);
  const shown = finite ? Math.min(max, Math.max(min, value)) : (min + max) / 2;
  const describedBy =
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') ||
    undefined;
  return (
    <div className="sw-deep-sf" data-invalid={Boolean(error) || undefined}>
      <div className="sw-deep-sf__top">
        <label htmlFor={`${id}-box`} className="sw-deep-sf__label">
          {label}
        </label>
        {words && finite && <span className="sw-deep-sf__words">{words(value)}</span>}
        <NumberInput
          id={`${id}-box`}
          label={label}
          value={value}
          onChange={onChange}
          min={min}
          max={max}
          step={step}
          invalid={Boolean(error)}
          disabled={disabled}
          describedBy={describedBy}
          className="sw-deep-sf__box"
        />
      </div>
      <Slider
        value={shown}
        onValueChange={onChange}
        min={min}
        max={max}
        step={step}
        label={label}
        valueText={words ? words(shown) : String(shown)}
        diverging={diverging}
        disabled={disabled}
      />
      {hint && (
        <p className="sw-deep-sf__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="sw-deep-sf__error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * A whole number to step with, set large in the serif: minus, the number, plus. The number can also be
 * typed. It never leaves its range by the buttons; a number typed out of range is said to be, under it.
 */
export function Stepper({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  hint,
  error,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  hint?: ReactNode;
  error?: string | undefined;
  disabled?: boolean;
}) {
  const id = useId();
  const describedBy =
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') ||
    undefined;
  const nudge = (by: number) => {
    const base = Number.isFinite(value) ? value : min;
    onChange(Math.min(max, Math.max(min, base + by)));
  };
  return (
    <div className="sw-deep-stepper" data-invalid={Boolean(error) || undefined}>
      <label className="sw-deep-stepper__label" htmlFor={`${id}-box`}>
        {label}
      </label>
      <div className="sw-deep-stepper__row">
        <IconButton
          label={`One fewer: ${label.toLowerCase()}`}
          tooltip={false}
          size="md"
          disabled={disabled || (Number.isFinite(value) && value <= min)}
          onClick={() => nudge(-step)}
        >
          <Minus size={17} aria-hidden="true" />
        </IconButton>
        <NumberInput
          id={`${id}-box`}
          label={label}
          value={value}
          onChange={onChange}
          min={min}
          max={max}
          step={step}
          invalid={Boolean(error)}
          disabled={disabled}
          describedBy={describedBy}
          className="sw-deep-stepper__box"
        />
        <IconButton
          label={`One more: ${label.toLowerCase()}`}
          tooltip={false}
          size="md"
          disabled={disabled || (Number.isFinite(value) && value >= max)}
          onClick={() => nudge(step)}
        >
          <Plus size={17} aria-hidden="true" />
        </IconButton>
        {suffix && <span className="sw-deep-stepper__suffix">{suffix}</span>}
      </div>
      {hint && (
        <p className="sw-deep-sf__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="sw-deep-sf__error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
