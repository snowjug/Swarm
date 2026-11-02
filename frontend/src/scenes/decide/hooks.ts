import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { animate } from 'motion/react';
import { analysisApi } from '../../api/analysis';
import { useReducedMotion } from '../../design/motion';
import { factsOf, type AnalysisFacts } from './model/analysis-model';

export interface BriefAnalysis {
  facts: AnalysisFacts | null;
  /** The analysis is being read; the page draws without it and adds what it holds when it arrives. */
  loading: boolean;
}

/**
 * What the brief's own analysis adds to the page: the paired runs and each group's own movement. It is
 * the analysis the brief was made from, by its id, not the newest one. A comparison that cannot be read
 * is not an error to show: the brief's own numbers stand without it.
 */
export function useBriefAnalysis(projectId: string, analysisId: string | null): BriefAnalysis {
  const [state, setState] = useState<{ key: string; facts: AnalysisFacts | null; done: boolean }>({
    key: '',
    facts: null,
    done: false,
  });
  const key = analysisId ? `${projectId}:${analysisId}` : '';

  useEffect(() => {
    if (!analysisId) return undefined;
    const controller = new AbortController();
    void analysisApi.get(projectId, analysisId, controller.signal).then(
      (analysis) => {
        if (controller.signal.aborted) return;
        setState({ key: `${projectId}:${analysisId}`, facts: factsOf(analysis), done: true });
      },
      () => {
        if (controller.signal.aborted) return;
        setState({ key: `${projectId}:${analysisId}`, facts: null, done: true });
      },
    );
    return () => controller.abort();
  }, [projectId, analysisId]);

  const current = state.key === key;
  return {
    facts: current ? state.facts : null,
    loading: key !== '' && !(current && state.done),
  };
}

/** The width of an element, kept current, so that a chart is drawn in pixels and its text stays the size it is set in. */
export function useWidth<T extends HTMLElement>(
  initial = 640,
): { ref: RefObject<T | null>; width: number } {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(initial);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const measure = () => {
      const next = Math.round(node.getBoundingClientRect().width);
      if (next > 0) setWidth((old) => (old === next ? old : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/**
 * A number that counts up to its figure when it first appears, so that the answer is seen arriving. It is
 * the figure itself on the server and with reduced motion, and a change after that eases from where it is.
 */
export function useCountUp(target: number, duration = 0.9): number {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(target);
  const from = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (reduced || !Number.isFinite(target)) {
      from.current = target;
      setShown(target);
      return undefined;
    }
    const start = from.current ?? 0;
    setShown(start);
    const controls = animate(start, target, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (value) => {
        from.current = value;
        setShown(value);
      },
      onComplete: () => {
        from.current = target;
      },
    });
    return () => controls.stop();
  }, [target, duration, reduced]);
  return shown;
}

/**
 * The chapter in reading position: the last one whose top has passed the line a little below the top bar.
 * Read on scroll, once a frame, since it is a handful of elements.
 */
export function useScrollSpy(ids: readonly string[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  const key = ids.join('|');
  useEffect(() => {
    const list = key === '' ? [] : key.split('|');
    if (list.length === 0) return undefined;
    let frame = 0;
    const read = () => {
      frame = 0;
      const line = window.innerHeight * 0.32;
      let current: string | null = null;
      for (const id of list) {
        const node = document.getElementById(id);
        if (!node) continue;
        if (node.getBoundingClientRect().top <= line) current = id;
        else break;
      }
      const bottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (bottom && list.length > 0) current = list[list.length - 1] ?? current;
      setActive((old) => (old === current ? old : current));
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
  return active;
}

const READER_INPUT = ['wheel', 'touchmove', 'keydown', 'pointerdown'] as const;

/**
 * Keeps an element at the top of the page where the reader was taken to it. What lies above it may still be
 * arriving (a chart that is drawn when its figures are read), and the element itself may still be opening, so
 * that the page could not be scrolled far enough at first; the page is moved again, until the reader scrolls for
 * themselves or a few seconds have gone by.
 */
export function keepInPlace(target: HTMLElement, around: HTMLElement): () => void {
  const observer = new ResizeObserver(() => {
    const line = Number.parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
    if (Math.abs(target.getBoundingClientRect().top - line) > 2) {
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  });
  observer.observe(around);
  let timer = 0;
  const stop = () => {
    observer.disconnect();
    window.clearTimeout(timer);
    for (const type of READER_INPUT) window.removeEventListener(type, stop);
  };
  timer = window.setTimeout(stop, 4000);
  for (const type of READER_INPUT) window.addEventListener(type, stop, { passive: true });
  return stop;
}

/**
 * The chapter the reader was taken to, until they move on for themselves. Where a chapter is too short to
 * reach the top of the page, the one after it is in reading position, and the contents must still say where
 * the reader was taken.
 */
export function usePinned<T extends string>(): [T | null, (place: T | null) => void] {
  const [pinned, setPinned] = useState<T | null>(null);
  useEffect(() => {
    if (pinned === null) return undefined;
    const release = () => setPinned(null);
    // A frame later, so that the scroll that took the reader there is not taken for the reader's own.
    let armed = false;
    const frame = requestAnimationFrame(() => {
      armed = true;
    });
    const maybe = () => {
      if (armed) release();
    };
    for (const type of READER_INPUT) window.addEventListener(type, maybe, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      for (const type of READER_INPUT) window.removeEventListener(type, maybe);
    };
  }, [pinned]);
  return [pinned, setPinned];
}

/** Whether an element has scrolled up past the top of the page, so that what it held can be kept in reach. */
export function usePassed(ref: RefObject<HTMLElement | null>): boolean {
  const [passed, setPassed] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry) setPassed(!entry.isIntersecting && entry.boundingClientRect.bottom < 80);
      },
      { threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return passed;
}

/**
 * How far down the page the reader is, from 0 to 1, written to a custom property on an element so that a
 * stylesheet can draw it. It is written once a frame and costs no render.
 */
export function useScrollProgress(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    let frame = 0;
    const write = () => {
      frame = 0;
      const room = document.documentElement.scrollHeight - window.innerHeight;
      const progress = room > 0 ? Math.min(1, Math.max(0, window.scrollY / room)) : 0;
      ref.current?.style.setProperty('--p', progress.toFixed(4));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(write);
    };
    write();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref]);
}
