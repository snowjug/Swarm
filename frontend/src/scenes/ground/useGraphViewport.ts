import { animate } from 'motion/react';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { fitViewport, zoomAbout, type GraphNode, type Inset, type Viewport } from './graphModel';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The graph's view of its space: where it is fitted, panned and zoomed. A move the person makes by hand
 * follows the hand at once; a move the page makes (fit, zoom by a button, reveal a node) glides there and can
 * be taken over at any moment. With reduced motion every glide is a jump. A view the person has set by hand
 * is kept when the space or what is shown changes, until they ask for Fit.
 */
export function useGraphViewport({
  nodes,
  width,
  height,
  inset,
  reduced,
}: {
  nodes: readonly GraphNode[];
  width: number;
  height: number;
  inset: Inset;
  reduced: boolean;
}) {
  const fitted = useCallback(
    () => fitViewport(nodes, width, height, inset),
    [nodes, width, height, inset],
  );
  const [viewport, setViewport] = useState<Viewport>(() => fitted());
  const current = useRef(viewport);
  const playing = useRef<{ stop: () => void } | null>(null);
  const placedFor = useRef('');
  const manual = useRef(false);

  const set = useCallback((to: Viewport, byHand = true) => {
    playing.current?.stop();
    playing.current = null;
    if (byHand) manual.current = true;
    current.current = to;
    setViewport(to);
  }, []);

  const glide = useCallback(
    (to: Viewport, byHand = false) => {
      playing.current?.stop();
      if (byHand) manual.current = true;
      if (reduced) {
        current.current = to;
        setViewport(to);
        return;
      }
      const from = current.current;
      playing.current = animate(0, 1, {
        duration: 0.6,
        ease: [0.16, 1, 0.3, 1],
        onUpdate: (t) => {
          const next = {
            k: lerp(from.k, to.k, t),
            x: lerp(from.x, to.x, t),
            y: lerp(from.y, to.y, t),
            stretch: lerp(from.stretch, to.stretch, t),
          };
          current.current = next;
          setViewport(next);
        },
        onComplete: () => {
          current.current = to;
          setViewport(to);
        },
      });
    },
    [reduced],
  );

  // The first fit is a placement, not a move. A later change of what is shown, of the space or of the room a
  // card takes glides to the new fit, unless the person has set the view themselves.
  useLayoutEffect(() => {
    const signature = [
      nodes.map((node) => node.id).join(','),
      Math.round(width),
      Math.round(height),
      inset.x,
      inset.top,
      inset.bottom,
      inset.right ?? 0,
    ].join('|');
    if (placedFor.current === signature) return;
    const first = placedFor.current === '';
    placedFor.current = signature;
    if (first) set(fitted(), false);
    else if (!manual.current) glide(fitted());
  }, [nodes, width, height, inset, set, glide, fitted]);

  const fit = useCallback(() => {
    manual.current = false;
    glide(fitted());
  }, [glide, fitted]);
  const zoomBy = useCallback(
    (factor: number, px = width / 2, py = height / 2) =>
      glide(zoomAbout(current.current, factor, px, py), true),
    [width, height, glide],
  );
  const zoomNow = useCallback(
    (factor: number, px: number, py: number) => set(zoomAbout(current.current, factor, px, py)),
    [set],
  );
  const panBy = useCallback(
    (dx: number, dy: number) =>
      set({ ...current.current, x: current.current.x + dx, y: current.current.y + dy }),
    [set],
  );
  /** Brings a chosen node into the clear: a move the page makes, not the person's own view. */
  const nudge = useCallback(
    (dx: number, dy: number) => {
      const from = current.current;
      glide({ ...from, x: from.x + dx, y: from.y + dy });
    },
    [glide],
  );

  const zoomed = Math.abs(viewport.k / fitted().k - 1) > 0.08;
  return { viewport, current, set, glide, fit, zoomBy, zoomNow, panBy, nudge, zoomed };
}
