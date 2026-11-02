/**
 * The motion vocabulary, in numbers, for the places that animate from script. The same values are in
 * tokens.css as custom properties for the places that animate from a stylesheet; keep them alike.
 *
 * Principles every animation in the product follows:
 *  - It explains a cause: something changed here, so something moves here.
 *  - It is physical: springs for things that are moved, short ease-outs for things that appear.
 *  - It is interruptible: a new target redirects it from where it is; nothing queues.
 *  - It is brief: the user is never made to wait for it. Entrances are at most ~0.5 s; the few longer
 *    ones (a scene change, a run being revealed) are started by the user and can be skipped by acting.
 *  - It touches transform and opacity only, so it costs no layout.
 *  - With reduced motion, distance goes to nothing and a short fade stays: change is still shown.
 */

export const DURATION = {
  instant: 0.09,
  fast: 0.16,
  base: 0.26,
  slow: 0.48,
  cinema: 0.84,
} as const;

export const EASE = {
  out: [0.16, 1, 0.3, 1],
  in: [0.5, 0, 0.75, 0],
  inOut: [0.65, 0, 0.35, 1],
} as const;

/** Springs for things that are moved. `snappy` for controls, `smooth` for panels, `gentle` for scenes. */
export const SPRING = {
  snappy: { type: 'spring', stiffness: 520, damping: 36, mass: 1 },
  smooth: { type: 'spring', stiffness: 260, damping: 28, mass: 1 },
  gentle: { type: 'spring', stiffness: 140, damping: 22, mass: 1 },
  lively: { type: 'spring', stiffness: 380, damping: 24, mass: 1 },
} as const;

/** The delay of the nth item of a group that arrives together: short steps, never a long wait. */
export function stagger(index: number, step = 0.04, max = 0.36): number {
  return Math.min(Math.max(index, 0) * step, max);
}

/** The reduced-motion version of an entrance: the fade stays, the travel goes. */
export const REDUCED = { duration: DURATION.fast, ease: EASE.out } as const;
