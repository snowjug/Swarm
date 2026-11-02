import { useCallback, useEffect, useState } from 'react';
import { useReducedMotion } from '../../design/motion';
import { activeSection } from './model';

/**
 * Which section of the page is being read. It follows the scroll: the section whose top has passed a line
 * a little below the top bar is the one in view; at the very end of the page it is the last.
 */
export function useScrollSpy(ids: readonly string[]): string | null {
  const [current, setCurrent] = useState<string | null>(ids[0] ?? null);
  const key = ids.join('|');
  useEffect(() => {
    const list = key ? key.split('|') : [];
    let frame = 0;
    const read = () => {
      frame = 0;
      const tops = list.flatMap((id) => {
        const node = document.getElementById(id);
        return node ? [{ id, top: node.getBoundingClientRect().top }] : [];
      });
      const atEnd =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      const next =
        atEnd && tops.length > 0
          ? tops[tops.length - 1]!.id
          : activeSection(tops, window.innerHeight * 0.32);
      setCurrent((old) => (old === next ? old : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [key]);
  return current;
}

/** Scrolls to a section and puts focus on it, so that a keyboard or a screen reader arrives where the eye does. */
export function useJump(): (id: string) => void {
  const reduced = useReducedMotion();
  return useCallback(
    (id: string) => {
      const node = document.getElementById(id);
      if (!node) return;
      node.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
      node.focus({ preventScroll: true });
    },
    [reduced],
  );
}
