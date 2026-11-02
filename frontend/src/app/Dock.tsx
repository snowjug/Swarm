import { m } from 'motion/react';
import { Lock } from 'lucide-react';
import { cx } from '../design/cx';
import { SPRING } from '../design/motion';
import { SCENE_ICONS } from './icons';
import { sceneName, type SceneId, type SceneInfo } from './scenes';
import './Dock.css';

/** The journey on a phone: five places along the bottom edge, under the thumb. */
export function Dock({ steps, onGo }: { steps: SceneInfo[]; onGo: (scene: SceneId) => void }) {
  return (
    <nav className="sw-dock sw-glass sw-hide-lg" aria-label="Journey">
      <ul className="sw-dock__list">
        {steps
          .filter((step) => step.id !== 'ask')
          .map((step) => {
            const Icon = SCENE_ICONS[step.id];
            const locked = step.state === 'locked';
            return (
              <li key={step.id}>
                <button
                  type="button"
                  className={cx('sw-dock__item', step.current && 'is-current')}
                  data-state={step.state}
                  aria-current={step.current ? 'step' : undefined}
                  aria-disabled={locked || undefined}
                  aria-label={sceneName(step)}
                  onClick={() => onGo(step.id)}
                >
                  {step.current && (
                    <m.span
                      layoutId="dock-current"
                      className="sw-dock__pill"
                      transition={SPRING.snappy}
                      aria-hidden="true"
                    />
                  )}
                  <span className="sw-dock__icon" aria-hidden="true">
                    {locked ? <Lock size={18} /> : <Icon size={20} />}
                    {step.state === 'working' && <span className="sw-dock__spin" />}
                    {step.state === 'attention' && <span className="sw-dock__alert" />}
                  </span>
                  <span className="sw-dock__label">{step.label}</span>
                </button>
              </li>
            );
          })}
      </ul>
    </nav>
  );
}
