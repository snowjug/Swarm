import * as RadixSlider from '@radix-ui/react-slider';
import { cx } from '../cx';
import './Slider.css';

/**
 * A value on a range, set by dragging or by arrow keys. The thumb grows under the finger. `tone` colours
 * the filled part; use `diverging` where the middle of the range is the neutral point (a stance).
 */
export function Slider({
  value,
  onValueChange,
  onValueCommit,
  min = 0,
  max = 1,
  step = 0.01,
  label,
  valueText,
  disabled,
  diverging,
  className,
}: {
  value: number;
  onValueChange: (value: number) => void;
  onValueCommit?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** The accessible name: what the slider sets. */
  label: string;
  /** The value in words, for screen readers ("0.42, somewhat against"). */
  valueText?: string;
  disabled?: boolean;
  diverging?: boolean;
  className?: string;
}) {
  return (
    <RadixSlider.Root
      className={cx('sw-slider', diverging && 'sw-slider--diverging', className)}
      value={[value]}
      onValueChange={([next]) => next !== undefined && onValueChange(next)}
      onValueCommit={([next]) => next !== undefined && onValueCommit?.(next)}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
    >
      <RadixSlider.Track className="sw-slider__track">
        <RadixSlider.Range className="sw-slider__range" />
        {diverging && <span className="sw-slider__mid" aria-hidden="true" />}
      </RadixSlider.Track>
      <RadixSlider.Thumb
        className="sw-slider__thumb"
        aria-label={label}
        aria-valuetext={valueText}
      />
    </RadixSlider.Root>
  );
}
