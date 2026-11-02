import type { ReactNode } from 'react';
import { LazyMotion, MotionConfig, domMax } from 'motion/react';
import { SPRING } from './tokens';
import { useMotionPreference } from './preference';

/**
 * Applies the person's motion setting to every `m` component below it, and gives them the default spring.
 * `reducedMotion="user"` removes transforms and layout movement and keeps opacity, which is the right
 * reduction: a change is still seen, it just does not travel.
 */
export function MotionRoot({ children }: { children: ReactNode }) {
  const preference = useMotionPreference();
  return (
    <MotionConfig
      reducedMotion={preference === 'reduced' ? 'always' : preference === 'full' ? 'never' : 'user'}
      transition={SPRING.smooth}
    >
      <LazyMotion features={domMax} strict>
        {children}
      </LazyMotion>
    </MotionConfig>
  );
}
