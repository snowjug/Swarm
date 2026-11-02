import { SCENE_ICONS } from '../../app/icons';
import { SCENE_IDS, SCENE_LABELS, SCENE_PURPOSE } from '../../app/scenes';
import './JourneyPreview.css';

/**
 * The whole path on one line, so that a first visit shows where it goes: ask, ground it in evidence, map who
 * is affected, simulate, compare the futures, decide. It is a promise of the order, not a control.
 */
export function JourneyPreview() {
  return (
    <ol className="sw-path" aria-label="How Swarm works">
      {SCENE_IDS.map((id, index) => {
        const Icon = SCENE_ICONS[id];
        return (
          <li
            key={id}
            className="sw-path__step sw-rise"
            style={{ '--i': index + 6 } as React.CSSProperties}
          >
            <span className="sw-path__icon" aria-hidden="true">
              <Icon size={16} />
            </span>
            <span className="sw-path__text">
              <strong>{SCENE_LABELS[id]}</strong>
              <span>{SCENE_PURPOSE[id]}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
