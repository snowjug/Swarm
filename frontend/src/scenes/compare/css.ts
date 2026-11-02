import type { CSSProperties } from 'react';

/** A style made of custom properties, which React's own type does not know the names of. */
export const vars = (values: Record<string, string | number>): CSSProperties =>
  values as CSSProperties;
