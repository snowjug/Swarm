import { useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

/**
 * The vertical middle of each marked element in a list (those with `data-key`), and the list's height,
 * measured from the page itself, so that lines drawn beside the rows meet them wherever the rows wrap. It
 * follows every change of size.
 */
export function useCentres(
  list: RefObject<HTMLElement | null>,
  signature: string,
): { centres: ReadonlyMap<string, number>; height: number } {
  const [measured, setMeasured] = useState<{
    centres: ReadonlyMap<string, number>;
    height: number;
  }>({
    centres: new Map(),
    height: 0,
  });
  const last = useRef('');
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return undefined;
    const measure = () => {
      const box = element.getBoundingClientRect();
      const centres = new Map<string, number>();
      for (const node of element.querySelectorAll<HTMLElement>('[data-key]')) {
        const rect = node.getBoundingClientRect();
        centres.set(
          node.dataset.key ?? '',
          Math.round((rect.top - box.top + rect.height / 2) * 10) / 10,
        );
      }
      const height = Math.round(box.height);
      const key = `${[...centres].map(([name, y]) => `${name}:${y}`).join(',')}|${height}|${Math.round(box.width)}`;
      if (key === last.current) return;
      last.current = key;
      setMeasured({ centres, height });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [list, signature]);
  return measured;
}
