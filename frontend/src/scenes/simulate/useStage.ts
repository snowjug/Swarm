import { useEffect, useState } from 'react';
import { useElementSize } from '../../hooks/useElementSize';

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
