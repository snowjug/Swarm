import { AnimatePresence, m } from 'motion/react';
import { Activity, Flag, Minus, Sunrise, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { SPRING } from '../../design/motion';
import type { Narration, NarrationKind } from './model';
import './parts.css';

const ICON: Record<NarrationKind, LucideIcon> = {
  start: Sunrise,
  change: Flag,
  event: Zap,
  move: Activity,
  quiet: Minus,
};

/** One line on what the round is about: an icon for its kind, the words, and a short mark. */
export function NarrationLine({ narration }: { narration: Narration }) {
  const Icon = ICON[narration.kind];
  return (
    <span className="sw-narr" data-kind={narration.kind}>
      <Icon className="sw-narr__icon" size={16} aria-hidden="true" />
      <span className="sw-narr__text">{narration.text}</span>
      {narration.tag && <span className="sw-narr__tag">{narration.tag}</span>}
    </span>
  );
}

/**
 * The line that says what is happening, which changes with every round. A new one arrives from below as the old one
 * leaves upward; a person who is dragging the scrubber gets each one at once, since a new line replaces the old one at
 * the moment it is needed.
 */
export function Say({ narration, round }: { narration: Narration; round: number }) {
  return (
    <div className="sw-say">
      <AnimatePresence mode="popLayout" initial={false}>
        <m.div
          key={`${round}:${narration.kind}`}
          className="sw-say__line"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={SPRING.snappy}
        >
          <NarrationLine narration={narration} />
        </m.div>
      </AnimatePresence>
    </div>
  );
}
