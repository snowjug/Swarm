import { Ban, Check, Pause, Square, X } from 'lucide-react';
import type { ResearchRun } from '../../../../../shared/research';
import { Orbit } from '../../../design/ui';
import { vars } from '../css';
import { STAGE_STATE_WORDS, stageItems, type StageState } from './model';

function Mark({ state }: { state: StageState }) {
  switch (state) {
    case 'done':
      return <Check size={14} strokeWidth={2.5} />;
    case 'active':
      return <Orbit size={26} label="Working" />;
    case 'paused':
      return <Pause size={13} strokeWidth={2.5} />;
    case 'blocked':
      return <Ban size={14} strokeWidth={2.25} />;
    case 'stopped':
      return <Square size={11} strokeWidth={2.5} />;
    case 'failed':
      return <X size={14} strokeWidth={2.5} />;
    default:
      return null;
  }
}

/**
 * The six stages of research, in the order they are done, and where the run is among them. A stage is drawn as reached
 * only when the run has reached it, and what is written under it is what the run holds for it. With no run they are all
 * waiting: this is what would happen, and none of it has.
 */
export function Stages({ run }: { run: ResearchRun | null }) {
  const items = stageItems(run);
  return (
    <ol className="sw-research-stages" aria-label="Research progress">
      {items.map((item, index) => (
        <li
          key={item.id}
          className="sw-research-stage"
          data-state={item.state}
          data-stage={item.id}
          style={vars({ '--i': index })}
          aria-current={item.state === 'active' ? 'step' : undefined}
        >
          <span className="sw-research-stage__mark" aria-hidden="true">
            <Mark state={item.state} />
          </span>
          <span className="sw-research-stage__line" aria-hidden="true" />
          <span className="sw-research-stage__text">
            <span className="sw-research-stage__label">
              {item.label}
              <span className="sr-only">, {STAGE_STATE_WORDS[item.state]}</span>
            </span>
            <span className="sw-research-stage__detail num">{item.detail ?? ' '}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
