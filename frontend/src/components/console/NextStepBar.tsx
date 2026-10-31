import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { ConsoleStep } from '../../../../shared/guided';
import type { NextStep } from '../../lib/console';

/**
 * The one move to offer once a comparison has finished, above whatever the stage shows: on to the
 * decision brief, and back to the comparison from it. It is the workspace's own, so that no panel has
 * to know about the stages around it.
 */
export function NextStepBar({
  move,
  onNavigate,
}: {
  move: NextStep;
  onNavigate: (step: ConsoleStep) => void;
}) {
  const back = move.to === 'simulation';
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
