import { Check } from 'lucide-react';
import type { ConsoleStep } from '../../../../shared/guided';
import type { ProjectDetail } from '../../../../shared/types';
import { journeyItems, stepLabels } from '../../lib/console';

/**
 * Where the person is on the way from a question to a result that can be shared. It follows the
 * stage in view and marks a step done only when the project's record shows it; it is not navigation.
 */
export function JourneyStrip({ project, step }: { project: ProjectDetail; step: ConsoleStep }) {
  const items = journeyItems(project, step);
  const position = items.findIndex((item) => item.current);
  if (position < 0) return null;
  return (
    <div className="journey" role="group" aria-label="Your path through the scenario">
      <p className="journey-summary">
        <span className="mono">
          STEP {position + 1} OF {items.length}
        </span>{' '}
        <strong>{items[position]!.label}</strong>{' '}
        <span className="muted">· in the {stepLabels[step]} stage</span>
      </p>
      <ol className="journey-steps">
        {items.map((item, index) => (
          <li
            key={item.id}
            className={`journey-step${item.done ? ' done' : ''}${item.current ? ' current' : ''}`}
            aria-current={item.current ? 'step' : undefined}
          >
            <span className="journey-dot" aria-hidden="true">
              {item.done ? <Check size={11} /> : index + 1}
            </span>
            <span className="journey-label">{item.label}</span>
            <span className="sr-only">
              ,{' '}
              {[item.current && 'in view', item.done && 'done'].filter(Boolean).join(', ') ||
                'not done yet'}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
