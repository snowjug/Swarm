import type { ReactNode } from 'react';
import { POSITIONING_STATEMENT } from '../../lib/product';
import './Footer.css';

/**
 * The quiet end of the first screen: the way into a demonstration, the sentence the product is never to be read
 * without, and the responsible-use statement it was verified with.
 */
export function Footer({ demonstrations }: { demonstrations: ReactNode }) {
  return (
    <div className="sw-ask-foot">
      <div className="sw-ask-foot__row">
        {demonstrations}
        <span className="sw-ask-foot__dot" aria-hidden="true">
          ·
        </span>
        <p className="sw-ask-foot__tagline">Explore scenarios, not predictions.</p>
      </div>
      <p className="sw-ask-foot__fine">{POSITIONING_STATEMENT}</p>
    </div>
  );
}
