import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../../design/motion';

export type Speed = 0.5 | 1 | 2;

/** How long a round is shown at normal speed: long enough to read a change, short enough to watch a run in a breath. */
const ROUND_MS = 900;

export interface Playback {
  round: number;
  playing: boolean;
  speed: Speed;
  atEnd: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (round: number) => void;
  step: (by: number) => void;
  /** Back to the first round, and playing. */
  replay: () => void;
  setSpeed: (speed: Speed) => void;
}

/**
 * Plays a run of rounds one at a time. It starts playing by itself when asked to and motion is allowed (a
 * person who has asked for less motion is never autoplayed to), stops at the last round, and is interruptible:
 * moving the scrubber or pressing a step pauses it where it is, and playing again continues from there.
 */
export function usePlayback(
  first: number,
  last: number,
  options: { autoplay?: boolean } = {},
): Playback {
  const reduced = useReducedMotion();
  const [round, setRound] = useState(options.autoplay && !reduced ? first : last);
  const [playing, setPlaying] = useState(Boolean(options.autoplay) && !reduced && last > first);
  const [speed, setSpeed] = useState<Speed>(1);
  const roundRef = useRef(round);
  useEffect(() => {
    roundRef.current = round;
  });

  const clamp = useCallback(
    (value: number) => Math.min(last, Math.max(first, Math.round(value))),
    [first, last],
  );

  // A different run starts again from where it begins, or at its end for someone who asked for less motion.
  useEffect(() => {
    const autoplay = Boolean(options.autoplay) && !reduced && last > first;
    setRound(autoplay ? first : last);
    setPlaying(autoplay);
    // Only a change of the run's span restarts it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first, last]);

  useEffect(() => {
    if (!playing) return undefined;
    const timer = window.setTimeout(() => {
      const next = roundRef.current + 1;
      if (next >= last) {
        setRound(last);
        setPlaying(false);
      } else setRound(next);
    }, ROUND_MS / speed);
    return () => window.clearTimeout(timer);
  }, [playing, round, speed, last]);

  const play = useCallback(() => {
    if (roundRef.current >= last) setRound(first);
    setPlaying(true);
  }, [first, last]);
  const pause = useCallback(() => setPlaying(false), []);
  const seek = useCallback(
    (value: number) => {
      setPlaying(false);
      setRound(clamp(value));
    },
    [clamp],
  );
  const step = useCallback(
    (by: number) => {
      setPlaying(false);
      setRound((old) => clamp(old + by));
    },
    [clamp],
  );
  const replay = useCallback(() => {
    setRound(first);
    setPlaying(last > first);
  }, [first, last]);

  return {
    round,
    playing,
    speed,
    atEnd: round >= last,
    play,
    pause,
    toggle: () => (playing ? pause() : play()),
    seek,
    step,
    replay,
    setSpeed,
  };
}
