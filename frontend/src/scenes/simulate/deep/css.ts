import type { CSSProperties } from 'react';

/** Custom properties on an element's style, typed: `style={vars({ '--i': 3 })}`. */
export function vars(values: Record<`--${string}`, string | number>): CSSProperties {
  return values as CSSProperties;
}
