import { Check, X } from 'lucide-react';
import { Orbit } from '../../design/ui';
import type { UiMode } from '../../lib/mode';
import { vars } from './css';
import {
  elapsedSeconds,
  elapsedText,
  traceDuration,
  type GroundStage,
  type Phase,
  type PhaseState,
} from './model';

interface Item {
  id: string;
  label: string;
  state: PhaseState;
  detail: string | null;
}

/**
 * What the engine is doing, in the two things it does and then the result. Each mark is what the engine
 * recorded: nothing is shown as under way that the engine has not started, and the time beside a finished
 * one is the time it took.
 */
export function Phases({
  phases,
  stage,
  mode,
  now,
  startedAt,
}: {
  phases: readonly Phase[];
  stage: GroundStage;
  mode: UiMode;
  now: number;
  startedAt: string | null;
}) {
  const items: Item[] = [
    ...phases.map((phase) => {
      let detail: string | null = null;
      if (phase.state === 'done') detail = traceDuration(phase.trace);
      else if (phase.state === 'active') {
        const seconds = elapsedSeconds(phase.trace?.startedAt ?? startedAt, now);
        detail =
          stage === 'queued' ? 'Waiting' : seconds === null ? 'Working' : elapsedText(seconds);
      } else if (phase.state === 'failed') detail = 'Stopped';
      return {
        id: phase.id,
        label: mode === 'advanced' ? phase.engineName : phase.label,
        state: phase.state,
        detail,
      };
    }),
    { id: 'ready', label: 'Ready', state: stage === 'ready' ? 'done' : 'waiting', detail: null },
  ];
  return (
    <ol className="sw-ground-phases" aria-label="Progress">
      {items.map((item, index) => (
        <li
          key={item.id}
          className="sw-ground-phase"
          data-state={item.state}
          style={vars({ '--i': index })}
          aria-current={item.state === 'active' ? 'step' : undefined}
        >
          <span className="sw-ground-phase__mark" aria-hidden="true">
            {item.state === 'active' && <Orbit size={26} label="Working" />}
            {item.state === 'done' && <Check size={14} strokeWidth={2.5} />}
            {item.state === 'failed' && <X size={14} strokeWidth={2.5} />}
          </span>
          <span className="sw-ground-phase__line" aria-hidden="true" />
          <span className="sw-ground-phase__text">
            <span className="sw-ground-phase__label">{item.label}</span>
            <span className="sw-ground-phase__detail num">
              {item.detail ?? ' '}
              <span className="sr-only">
                {item.state === 'done'
                  ? ', done'
                  : item.state === 'active'
                    ? ', in progress'
                    : item.state === 'failed'
                      ? ', failed'
                      : ', waiting'}
              </span>
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
