import { useEffect, useState } from 'react';
import { useElementSize } from '../../hooks/useElementSize';
import { useMediaQuery } from '../../hooks/useMediaQuery';

/** What the stage's overlays take from the picture: measured, so that nothing is laid out under a heading or a dock. */
export interface StageBoxes {
  /** The heading has been measured. */
  topReady: boolean;
  /** The dock has been measured (it is not there on every screen). */
  dockReady: boolean;
  /** The height of the heading and the controls over the top of the picture. */
  top: number;
  /** The height of the dock as it is now. */
  dock: number;
  topRef: (element: HTMLDivElement | null) => void;
  dockRef: (element: HTMLDivElement | null) => void;
}

export function useStageBoxes(): StageBoxes {
  const top = useElementSize<HTMLDivElement>();
  const dock = useElementSize<HTMLDivElement>();
  return {
    topReady: top.ready,
    dockReady: dock.ready,
    top: top.ready ? Math.round(top.height) : 0,
    dock: dock.ready ? Math.round(dock.height) : 0,
    topRef: top.ref,
    dockRef: dock.ref,
  };
}

/**
 * The height of the dock when its fold is closed, which is the room the picture always leaves at the bottom. A fold that
 * is open covers the picture for as long as it is open, which the picture answers by moving, not by being laid out again.
 */
export function useClosedHeight(dock: number, open: boolean): number {
  const [closed, setClosed] = useState(0);
  useEffect(() => {
    if (!open && dock > 0) setClosed(dock);
  }, [open, dock]);
  return closed || dock;
}

/**
 * The room the picture keeps clear at its edges: under the heading, over the dock, and a little beside. The names of the
 * groups stand a little lower than the actors do, so the room over the dock is more than the dock itself.
 */
export function useStageInset(
  boxes: StageBoxes,
  closedDock: number,
  wide: boolean,
): { top: number; bottom: number; left: number; right: number } {
  return {
    top: boxes.top + 28,
    bottom: closedDock > 0 ? closedDock + 36 : 56,
    left: wide ? 40 : 24,
    right: 24,
  };
}

/** A phone: the screen where the picture is smallest, the battery matters most, and the zoom stands at the edge. */
export function usePhone(): boolean {
  return useMediaQuery('(max-width: 40rem)');
}

/**
 * What floats over the right of the picture, which the picture keeps clear of: the card beside it where there is one, and
 * on a phone the column of the zoom at the edge.
 */
export function useCoveredRight(wide: boolean, side: number): number {
  const phone = usePhone();
  return wide ? side : phone ? 56 : 0;
}
