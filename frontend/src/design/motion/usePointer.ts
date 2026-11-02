import { useEffect } from 'react';
import type { RefObject } from 'react';
import { useReducedMotion } from './preference';

/**
 * Lets a surface follow the pointer with light: it sets `--mx` and `--my` (the pointer's place in the
 * element, as percentages) so that a stylesheet can put a soft highlight there. It does nothing for touch,
 * for reduced motion, or when the pointer is away, and it writes at most once a frame.
 */
export function useSpotlight<T extends HTMLElement>(ref: RefObject<T | null>): void {
  const reduced = useReducedMotion();
  useEffect(() => {
    const element = ref.current;
    if (!element || reduced) return undefined;
    let frame = 0;
    let x = 50;
    let y = 50;
    const write = () => {
      frame = 0;
      element.style.setProperty('--mx', `${x}%`);
      element.style.setProperty('--my', `${y}%`);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const box = element.getBoundingClientRect();
      x = ((event.clientX - box.left) / Math.max(box.width, 1)) * 100;
      y = ((event.clientY - box.top) / Math.max(box.height, 1)) * 100;
      if (!frame) frame = requestAnimationFrame(write);
    };
    element.addEventListener('pointermove', move);
    return () => {
      element.removeEventListener('pointermove', move);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref, reduced]);
}

/**
 * A gentle pull toward the pointer for one control that deserves it (the primary action of a screen).
 * `strength` is the fraction of the pointer's offset the element follows; it returns to rest on leave.
 */
export function useMagnetic<T extends HTMLElement>(
  ref: RefObject<T | null>,
  strength = 0.18,
): void {
  const reduced = useReducedMotion();
  useEffect(() => {
    const element = ref.current;
    if (!element || reduced) return undefined;
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const box = element.getBoundingClientRect();
      const dx = event.clientX - (box.left + box.width / 2);
      const dy = event.clientY - (box.top + box.height / 2);
      element.style.setProperty('--tx', `${(dx * strength).toFixed(2)}px`);
      element.style.setProperty('--ty', `${(dy * strength).toFixed(2)}px`);
    };
    const leave = () => {
      element.style.setProperty('--tx', '0px');
      element.style.setProperty('--ty', '0px');
    };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerleave', leave);
    return () => {
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerleave', leave);
    };
  }, [ref, reduced, strength]);
}
