import { createContext, useContext, useEffect } from 'react';

/**
 * Work a scene holds that is not saved: words in a draft, edits to actors. The scene says so while it holds it, and the
 * shell, which owns every way out of a scene (the journey, the dock, the palette, another exploration, a new question),
 * asks the person first. A scene never has to know where the person is going.
 */
export type HoldUnsaved = (what: string | null) => void;
export type Away = (proceed: () => void) => void;

export const HoldContext = createContext<HoldUnsaved>(() => undefined);
export const AwayContext = createContext<Away>((proceed) => proceed());

/** `what` says, in a sentence, what would be lost; while it is not null the way out of the scene asks first. */
export function useUnsavedWork(what: string | null): void {
  const hold = useContext(HoldContext);
  useEffect(() => {
    if (what === null) return undefined;
    hold(what);
    return () => hold(null);
  }, [hold, what]);
}

/** The shell wraps each exit it controls in this: it runs now, or once the person has said they mean to leave. */
export function useAway(): Away {
  return useContext(AwayContext);
}
