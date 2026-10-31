import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { ConsoleStep } from '../../../../shared/guided';
import type { NextStep } from '../../lib/console';

/**
 * The one move to offer from what the scenario lab has recorded, above whatever the stage shows: on to
 * the stage where the next piece of work is done, and from the decision brief back to the comparison.
 * It is the workspace's own, so that no panel has to know about the stages around it.
 */
export function NextStepBar({
  move,
  onNavigate,
}: {
  move: NextStep;
  onNavigate: (step: ConsoleStep) => void;
}) {
  const back = move.back === true;
  return (
    <div className="next-step" role="group" aria-label="Next step">
      <p>
        <span className="eyebrow">NEXT STEP</span>
        <span>{move.text}</span>
      </p>
      <button
        className={`button ${back ? 'button-secondary' : 'button-primary'}`}
        type="button"
        onClick={() => onNavigate(move.to)}
      >
        {back && <ArrowLeft size={14} aria-hidden="true" />} {move.label}{' '}
        {!back && <ArrowRight size={14} aria-hidden="true" />}
      </button>
    </div>
  );
}
