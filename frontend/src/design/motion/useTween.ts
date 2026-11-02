import { useEffect, useRef, useState } from 'react';
import { animate } from 'motion/react';
import { useReducedMotion } from './preference';

/**
 * A number that eases to its target instead of jumping to it, redirected from where it is whenever the
 * target changes. It is for counts and shares that the engine reports, so the number a person reads is
 * always the real one: it only takes a moment to get there. With reduced motion it is the target at once.
 */
export function useTween(target: number, options: { duration?: number } = {}): number {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  const duration = options.duration ?? 0.7;

  useEffect(() => {
    if (reduced || !Number.isFinite(target)) {
      from.current = target;
      setShown(target);
      return undefined;
    }
    const controls = animate(from.current, target, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (value) => {
        from.current = value;
        setShown(value);
      },
    });
    return () => controls.stop();
  }, [target, duration, reduced]);

  return shown;
}
