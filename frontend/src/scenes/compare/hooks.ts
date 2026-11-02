import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useReducedMotion, useTween } from '../../design/motion';

/** The width of an element as it is laid out, kept current as it is resized. Until it is measured it is `initial`. */
export function useWidth<T extends Element>(initial = 720): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(initial);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = () => {
      const next = Math.round(element.getBoundingClientRect().width);
      if (next > 0) setWidth((old) => (Math.abs(old - next) < 1 ? old : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/**
 * Whether an element has come into view yet. By default it only ever turns on: a part of the page that has been seen
 * stays as it is. With `live` it follows the element in and out of view. Where nothing can tell (no observer, or the
 * page is being drawn for a test) it is on by default, so that content is never withheld because a script could not
 * run, and off when live, so that nothing is hidden for the same reason.
 */
export function useInView<T extends Element>(
  margin = '0px 0px -12% 0px',
  live = false,
): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(() => !live && typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const element = ref.current;
    if (!element || (seen && !live) || typeof IntersectionObserver === 'undefined')
      return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((entry) => entry.isIntersecting);
        if (live) setSeen(visible);
        else if (visible) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin: margin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [seen, margin, live]);
  return [ref, seen];
}

/**
 * A number that arrives: it counts up from nothing to its value when it first comes into view, and after
 * that follows the value as it changes. With reduced motion it is the value at once.
 */
export function useArrival(target: number, seen: boolean, duration = 0.9): number {
  const reduced = useReducedMotion();
  return useTween(seen || reduced ? target : 0, { duration });
}

/** Scrolls to a part of the page and puts focus there, without motion when motion is reduced. */
export function jumpTo(id: string, reduced: boolean): void {
  const target = document.getElementById(id);
  if (!target) return;
  target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  target.focus({ preventScroll: true });
}
