/** How the page moves to what a person asked for: it glides, unless they have asked for less motion. */
export const smooth = (reduced: boolean): ScrollBehavior => (reduced ? 'auto' : 'smooth');
