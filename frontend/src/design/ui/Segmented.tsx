import { useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { m } from 'motion/react';
import { cx } from '../cx';
import { SPRING } from '../motion';
import './Segmented.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  /** Why it is not available, or what it does: read as part of the option's name. */
  hint?: string;
  /**
   * The option's whole name for assistive technology, when its label is a picture or says less than it means (an
   * icon alone, "Map"). It begins with the words the label shows, so that voice control can say what it sees.
   */
  name?: string;
}

/**
 * One choice of a few, as a row of options with a pill that slides to the chosen one. It is a radio
 * group underneath: arrows move the choice, Home and End jump to the ends, Tab leaves the group.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = 'md',
  className,
  block,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  label: string;
  size?: 'sm' | 'md';
  className?: string;
  block?: boolean;
}) {
  const id = useId();
  const refs = useRef(new Map<T, HTMLButtonElement>());
  const enabled = options.filter((option) => !option.disabled);

  const move = (event: KeyboardEvent, from: T) => {
    const index = enabled.findIndex((option) => option.value === from);
    let next: number;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
      next = (index + 1) % enabled.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
      next = (index - 1 + enabled.length) % enabled.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = enabled.length - 1;
    else return;
    event.preventDefault();
    const target = enabled[next];
    if (!target) return;
    onChange(target.value);
    refs.current.get(target.value)?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx('sw-seg', `sw-seg--${size}`, block && 'sw-seg--block', className)}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              if (node) refs.current.set(option.value, node);
              else refs.current.delete(option.value);
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={
              option.name
                ? option.hint
                  ? `${option.name}, ${option.hint}`
                  : option.name
                : option.hint
                  ? `${typeof option.label === 'string' ? option.label : option.value}, ${option.hint}`
                  : undefined
            }
            disabled={option.disabled}
            tabIndex={selected ? 0 : -1}
            className={cx('sw-seg__option', selected && 'is-on')}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => move(event, option.value)}
          >
            {selected && (
              <m.span
                layoutId={`${id}-pill`}
                className="sw-seg__pill"
                transition={SPRING.snappy}
                aria-hidden="true"
              />
            )}
            <span className="sw-seg__content">
              {option.icon}
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
