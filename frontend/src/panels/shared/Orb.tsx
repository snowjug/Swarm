import type { CSSProperties } from 'react';
import { cx } from '../../design/cx';
import { orbParts } from './identity';
import './shared.css';

/**
 * A small sphere of two category colours, derived from an identifier, so that the same person or actor
 * looks the same everywhere it appears. It is decoration that helps the eye tell one from another; the
 * name is always written beside it.
 */
export function Orb({
  seed,
  size = 28,
  className,
}: {
  seed: string;
  size?: number;
  className?: string;
}) {
  const parts = orbParts(seed);
  const style = {
    '--orb': `${size}px`,
    '--orb-a': `var(--cat-${parts.a})`,
    '--orb-b': `var(--cat-${parts.b})`,
    '--orb-turn': `${parts.turn}deg`,
  } as CSSProperties;
  return <span className={cx('sw-porb', className)} style={style} aria-hidden="true" />;
}
