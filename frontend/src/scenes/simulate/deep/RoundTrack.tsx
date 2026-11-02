import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { Flag } from 'lucide-react';
import { cx } from '../../../design/cx';
import { useElementSize } from '../../../hooks/useElementSize';
import { axisRounds } from './chart';
import { vars } from './css';
import './track.css';

export interface RoundTrackProps {
  /** What the slider sets, for a screen reader. */
  label: string;
  /** Rounds planned. */
  total: number;
  /** Rounds the server has saved. */
  saved: number;
  value: number;
  onChange: (value: number) => void;
  /** The lowest and highest position that may be chosen. They default to the start and the last saved round. */
  min?: number;
  max?: number;
  /** A round is being worked out right now: the next point breathes. */
  inFlight?: boolean;
  /** The one assumed event, and whether its round has been saved. */
  event?: { round: number; applied: boolean } | null;
  /** Rounds 1 to this one were copied from a parent run. */
  copied?: number;
  valueText: (value: number) => string;
  disabled?: boolean;
  size?: 'md' | 'lg';
  className?: string;
}

/**
 * The rounds of a run laid out in a line: the saved ones filled, the ones still to come hollow, the next one
 * breathing while it is worked out, and a flag where the assumed event lands. It is also a slider, and a real
 * one: drag it or press on it, arrow keys step, Home and End jump, Page keys take several steps.
 */
export function RoundTrack({
  label,
  total,
  saved,
  value,
  onChange,
  min = 0,
  max,
  inFlight = false,
  event = null,
  copied = 0,
  valueText,
  disabled = false,
  size = 'md',
  className,
}: RoundTrackProps) {
  const high = Math.min(total, max ?? saved);
  const low = Math.min(min, high);
  const { ref, width } = useElementSize<HTMLDivElement>();
  const thumb = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const clamp = (round: number): number => Math.min(high, Math.max(low, Math.round(round)));
  const selectable = !disabled && high >= low && total > 0;

  const roundAt = (event_: PointerEvent<HTMLDivElement>): number => {
    const box = event_.currentTarget.getBoundingClientRect();
    const share = Math.min(1, Math.max(0, (event_.clientX - box.left) / Math.max(box.width, 1)));
    return clamp(share * total);
  };
  const down = (event_: PointerEvent<HTMLDivElement>) => {
    if (!selectable) return;
    event_.currentTarget.setPointerCapture(event_.pointerId);
    setDragging(true);
    onChange(roundAt(event_));
    thumb.current?.focus({ preventScroll: true });
  };
  const move = (event_: PointerEvent<HTMLDivElement>) => {
    if (selectable && event_.currentTarget.hasPointerCapture(event_.pointerId))
      onChange(roundAt(event_));
  };
  const up = (event_: PointerEvent<HTMLDivElement>) => {
    if (event_.currentTarget.hasPointerCapture(event_.pointerId))
      event_.currentTarget.releasePointerCapture(event_.pointerId);
    setDragging(false);
  };
  const key = (event_: KeyboardEvent<HTMLDivElement>) => {
    if (!selectable) return;
    const page = Math.max(2, Math.round(total / 4));
    const by: Record<string, number> = {
      ArrowLeft: -1,
      ArrowDown: -1,
      ArrowRight: 1,
      ArrowUp: 1,
      PageDown: -page,
      PageUp: page,
    };
    let next: number | null = null;
    if (event_.key in by) next = clamp(value + by[event_.key]!);
    else if (event_.key === 'Home') next = low;
    else if (event_.key === 'End') next = high;
    if (next === null) return;
    event_.preventDefault();
    if (next !== value) onChange(next);
  };

  const positions = Array.from({ length: total + 1 }, (_, round) => round);
  const named = new Set(axisRounds(total, Math.max(0, width - 24), size === 'lg' ? 36 : 30));
  const at = (round: number) => (total > 0 ? round / total : 0);

  return (
    <div
      className={cx('sw-deep-track', className)}
      data-size={size}
      data-disabled={!selectable || undefined}
      data-dragging={dragging || undefined}
      style={vars({ '--saved': at(saved), '--x': at(clamp(value)) })}
    >
      <div
        ref={ref}
        className="sw-deep-track__rail"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <span className="sw-deep-track__line" aria-hidden="true" />
        <span className="sw-deep-track__fill" aria-hidden="true" />
        {positions.map((round) => (
          <span
            key={round}
            className="sw-deep-track__pip"
            aria-hidden="true"
            data-state={
              round <= saved ? 'saved' : inFlight && round === saved + 1 ? 'flight' : 'ahead'
            }
            data-copied={round > 0 && round <= copied ? 'true' : undefined}
            data-out={round < low || round > high ? 'true' : undefined}
            style={vars({ '--at': at(round) })}
          />
        ))}
        {event && event.round >= 0 && event.round <= total && (
          <span
            className="sw-deep-track__flag"
            data-applied={event.applied}
            aria-hidden="true"
            style={vars({ '--at': at(event.round) })}
          >
            <Flag size={size === 'lg' ? 17 : 15} />
          </span>
        )}
        <div
          ref={thumb}
          className="sw-deep-track__thumb"
          role="slider"
          tabIndex={selectable ? 0 : -1}
          aria-label={label}
          aria-valuemin={low}
          aria-valuemax={high}
          aria-valuenow={clamp(value)}
          aria-valuetext={valueText(clamp(value))}
          aria-disabled={!selectable || undefined}
          aria-orientation="horizontal"
          onKeyDown={key}
        >
          <span className="sw-deep-track__bubble" aria-hidden="true">
            {clamp(value) === 0 ? 'Start' : clamp(value)}
          </span>
        </div>
      </div>
      <div className="sw-deep-track__scale" aria-hidden="true">
        {positions
          .filter((round) => named.has(round))
          .map((round) => (
            <span
              key={round}
              className="sw-deep-track__tick num"
              data-now={round === clamp(value) || undefined}
              style={vars({ '--at': at(round) })}
            >
              {round === 0 ? 'Start' : round}
            </span>
          ))}
      </div>
    </div>
  );
}
