import { AnimatePresence, m } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useWorkspace } from '../../app/context';
import { SPRING, useReducedMotion } from '../../design/motion';
import { Button } from '../../design/ui';
import { useGroundData } from './context';
import { nextStep } from './model';

/**
 * Once the first screen's action has scrolled out of view, the same action waits at the bottom edge, so that
 * a person who has read down the page is one press from the next part of the journey.
 */
export function StickyNext() {
  const { journey, go } = useWorkspace();
  const { stage } = useGroundData();
  const reduced = useReducedMotion();
  const next = nextStep(journey);
  const [away, setAway] = useState(false);
  const ready = stage === 'ready' || stage === 'record';

  useEffect(() => {
    const target = document.querySelector('[data-hero-action]');
    if (!target || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      setAway(Boolean(entry && !entry.isIntersecting && entry.boundingClientRect.top < 0));
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [stage]);

  return (
    <AnimatePresence>
      {away && ready && next && (
        <m.div
          key="next"
          className="sw-ground-next sw-glass sw-glass--overlay"
          initial={reduced ? false : { opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, transition: { duration: 0.14 } }}
          transition={SPRING.snappy}
        >
          <Button
            variant="primary"
            iconEnd={<ArrowRight size={17} aria-hidden="true" />}
            onClick={() => go(next.scene)}
          >
            {next.label}
          </Button>
        </m.div>
      )}
    </AnimatePresence>
  );
}
