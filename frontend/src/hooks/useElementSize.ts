import { useLayoutEffect, useMemo, useRef, useState, type RefCallback } from 'react';

/** What the hook hands out as `ref`: a callback ref that can also be read as `ref.current`. */
export type SizedRef<T> = RefCallback<T> & { readonly current: T | null };

/**
 * The size of an element, kept up to date as it changes. The element is attached with a callback ref, so that
 * one that appears later (a section that is only there in some states) is measured when it does. `ready` is
 * true once an element has been measured, so that nothing is laid out on the guess the hook starts with.
 */
export function useElementSize<T extends HTMLElement>() {
  const holder = useRef<T | null>(null);
  const [element, setElement] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 320, height: 420 });
  const [ready, setReady] = useState(false);
  const ref = useMemo(() => {
    const attach = ((node: T | null) => {
      holder.current = node;
      setElement(node);
    }) as SizedRef<T>;
    Object.defineProperty(attach, 'current', { get: () => holder.current });
    return attach;
  }, []);
  useLayoutEffect(() => {
    if (!element) {
      setReady(false);
      return undefined;
    }
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      if (bounds.width > 0 && bounds.height > 0) {
        setReady(true);
        setSize((old) =>
          old.width === bounds.width && old.height === bounds.height
            ? old
            : { width: bounds.width, height: bounds.height },
        );
      }
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [element]);
  return { ref, ...size, ready };
}
