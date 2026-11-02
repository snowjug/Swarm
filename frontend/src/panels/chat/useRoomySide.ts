import { useState } from 'react';
import type { MouseEvent } from 'react';

/**
 * A passage is long, so it opens on the side of its chip that has the most room, chosen as the chip is
 * pressed: a chip near the composer opens upward rather than being squeezed between it and the screen's edge.
 */
export function useRoomySide(): {
  side: 'top' | 'bottom';
  measure: (event: MouseEvent<HTMLElement>) => void;
} {
  const [side, setSide] = useState<'top' | 'bottom'>('bottom');
  const measure = (event: MouseEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setSide(box.top > window.innerHeight - box.bottom ? 'top' : 'bottom');
  };
  return { side, measure };
}
