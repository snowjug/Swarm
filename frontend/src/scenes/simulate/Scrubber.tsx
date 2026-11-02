import { useRef } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { m } from 'motion/react';
import { ChevronLeft, ChevronRight, Flag, Pause, Play, RotateCcw } from 'lucide-react';
import { cx } from '../../design/cx';
import { SPRING } from '../../design/motion';
import { Button, IconButton, Tooltip } from '../../design/ui';
import type { Playback } from './usePlayback';
import './scrubber.css';

export interface ScrubberProps {
  playback: Playback;
  first: number;
  last: number;
  changeRound: number;
  /** How many events happened in each round of this run. */
  events: ReadonlyMap<number, number>;
  /** Sits inside a surface of its own, instead of floating as one. */
  embedded?: boolean;
  className?: string;
}

/**
 * Plays and scrubs the rounds of a run. The track has one tick for each round, a flag where the change lands and a
 * point for each round in which something was set off, so that the whole run is seen at a glance and any round can be
 * reached by a press or a drag. It is a real slider: arrow keys step, Home and End jump, Space plays and pauses.
 */
export function Scrubber({
  playback,
  first,
  last,
  changeRound,
  events,
  embedded = false,
  className,
}: ScrubberProps) {
  const track = useRef<HTMLDivElement>(null);
  const rounds = Array.from({ length: last - first + 1 }, (_, index) => first + index);
  const span = Math.max(last - first, 1);
  const share = (round: number): number => (round - first) / span;

  const roundAt = (event: PointerEvent<HTMLDivElement>): number => {
    const box = track.current?.getBoundingClientRect();
    if (!box) return playback.round;
    return Math.round(
      first + Math.min(1, Math.max(0, (event.clientX - box.left) / Math.max(box.width, 1))) * span,
    );
  };
  const down = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    playback.seek(roundAt(event));
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) playback.seek(roundAt(event));
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const by: Record<string, number> = {
      ArrowLeft: -1,
      ArrowDown: -1,
      ArrowRight: 1,
      ArrowUp: 1,
      PageDown: -3,
      PageUp: 3,
    };
    if (event.key in by) {
      event.preventDefault();
      playback.step(by[event.key]!);
    } else if (event.key === 'Home') {
      event.preventDefault();
      playback.seek(first);
    } else if (event.key === 'End') {
      event.preventDefault();
      playback.seek(last);
    } else if (event.key === ' ') {
      event.preventDefault();
      playback.toggle();
    }
  };

  return (
    <m.div
      className={cx(
        'sw-scrub',
        embedded ? 'sw-scrub--embedded' : 'sw-glass sw-glass--raised',
        className,
      )}
      role="group"
      aria-label="Playback"
      {...(embedded
        ? {}
        : {
            initial: { opacity: 0, y: 20 },
            animate: { opacity: 1, y: 0 },
            transition: SPRING.smooth,
          })}
    >
      <div className="sw-scrub__buttons">
        {playback.atEnd && !playback.playing ? (
          <IconButton label="Play again" tone="accent" size="md" onClick={playback.replay}>
            <RotateCcw size={18} aria-hidden="true" />
          </IconButton>
        ) : (
          <IconButton
            label={playback.playing ? 'Pause' : 'Play'}
            shortcut="Space"
            tone="accent"
            size="md"
            onClick={playback.toggle}
            pressed={playback.playing}
          >
            {playback.playing ? (
              <Pause size={18} aria-hidden="true" />
            ) : (
              <Play size={18} aria-hidden="true" />
            )}
          </IconButton>
        )}
        <IconButton
          label="Previous round"
          size="sm"
          onClick={() => playback.step(-1)}
          disabled={playback.round <= first}
        >
          <ChevronLeft size={17} aria-hidden="true" />
        </IconButton>
        <IconButton
          label="Next round"
          size="sm"
          onClick={() => playback.step(1)}
          disabled={playback.round >= last}
        >
          <ChevronRight size={17} aria-hidden="true" />
        </IconButton>
      </div>

      <div
        ref={track}
        className="sw-scrub__track"
        role="slider"
        tabIndex={0}
        aria-label="Round"
        aria-valuemin={first}
        aria-valuemax={last}
        aria-valuenow={playback.round}
        aria-valuetext={`Round ${playback.round} of ${last}`}
        onPointerDown={down}
        onPointerMove={move}
        onKeyDown={key}
      >
        <div className="sw-scrub__rail">
          <div className="sw-scrub__fill" style={{ width: `${share(playback.round) * 100}%` }} />
        </div>
        {rounds.map((round) => (
          <span
            key={round}
            className={cx('sw-scrub__tick', round <= playback.round && 'is-past')}
            style={{ left: `${share(round) * 100}%` }}
            aria-hidden="true"
          />
        ))}
        {rounds.map((round) =>
          events.get(round) ? (
            <Tooltip key={`e${round}`} label={`${events.get(round)} set off in round ${round}`}>
              <span
                className="sw-scrub__event"
                style={{ left: `${share(round) * 100}%` }}
                aria-hidden="true"
              />
            </Tooltip>
          ) : null,
        )}
        {changeRound >= first && changeRound <= last && (
          <Tooltip label={`The change lands in round ${changeRound}`}>
            <span
              className="sw-scrub__flag"
              style={{ left: `${share(changeRound) * 100}%` }}
              aria-hidden="true"
            >
              <Flag size={13} />
            </span>
          </Tooltip>
        )}
        <span
          className="sw-scrub__thumb"
          style={{ left: `${share(playback.round) * 100}%` }}
          aria-hidden="true"
        />
      </div>

      <div className="sw-scrub__read" aria-hidden="true">
        <span className="sw-scrub__round sw-numeral">{playback.round}</span>
        <span className="sw-scrub__of">of {last}</span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="sw-scrub__speed"
        onClick={() => playback.setSpeed(playback.speed === 1 ? 2 : playback.speed === 2 ? 0.5 : 1)}
        aria-label={`${playback.speed}× speed. Change`}
      >
        {playback.speed}×
      </Button>
    </m.div>
  );
}
