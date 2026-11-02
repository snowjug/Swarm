import { Fragment } from 'react';
import { m } from 'motion/react';
import { Check, Lock } from 'lucide-react';
import { cx } from '../design/cx';
import { SPRING } from '../design/motion';
import { Tooltip } from '../design/ui';
import { SCENE_ICONS } from './icons';
import { SCENE_PURPOSE, sceneName, type SceneId, type SceneInfo } from './scenes';
import './JourneyRail.css';

/**
 * The journey as a row of six points joined by a line that fills as the work does. The point in view
 * carries its name; the others show theirs when there is room. Locked points say what opens them.
 */
export function JourneyRail({
  steps,
  onGo,
  compact = false,
}: {
  steps: SceneInfo[];
  onGo: (scene: SceneId) => void;
  /** Icons only (the narrow top bar): the current step keeps its name. */
  compact?: boolean;
}) {
  return (
    <nav className={cx('sw-rail', compact && 'sw-rail--compact')} aria-label="Journey">
      <ol className="sw-rail__list">
        {steps.map((step, index) => {
          const Icon = SCENE_ICONS[step.id];
          const locked = step.state === 'locked';
          const previous = steps[index - 1];
          const filled = previous
            ? previous.state === 'done' || previous.state === 'working'
            : false;
          return (
            <Fragment key={step.id}>
              {index > 0 && (
                <li className="sw-rail__link" aria-hidden="true" data-filled={filled || undefined}>
                  <span />
                </li>
              )}
              <li className="sw-rail__item">
                <Tooltip
                  label={
                    locked && step.reason
                      ? `${step.label} · ${step.reason}`
                      : `${step.label} · ${SCENE_PURPOSE[step.id]}`
                  }
                  side="bottom"
                >
                  <button
                    type="button"
                    className={cx('sw-rail__step', step.current && 'is-current')}
                    data-state={step.state}
                    aria-current={step.current ? 'step' : undefined}
                    aria-disabled={locked || undefined}
                    aria-label={sceneName(step)}
                    onClick={() => onGo(step.id)}
                  >
                    {step.current && (
                      <m.span
                        layoutId="rail-current"
                        className="sw-rail__pill"
                        transition={SPRING.snappy}
                        aria-hidden="true"
                      />
                    )}
                    <span className="sw-rail__node" aria-hidden="true">
                      {locked ? <Lock size={12} /> : <Icon size={14} />}
                      {/* Done is said by the fill and a tick beside the glyph: when the names give way, a finished
                          journey would otherwise be six identical ticks and nobody could tell which is which. */}
                      {step.state === 'done' && !step.current && (
                        <span className="sw-rail__tick">
                          <Check size={8} strokeWidth={3.5} />
                        </span>
                      )}
                      {step.state === 'working' && <span className="sw-rail__spin" />}
                      {step.state === 'attention' && <span className="sw-rail__alert" />}
                    </span>
                    <span className="sw-rail__label">{step.label}</span>
                  </button>
                </Tooltip>
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
