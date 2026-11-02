import type { ReactNode } from 'react';
import { History, MessageCircleQuestion } from 'lucide-react';
import { IconButton } from '../design/ui';
import { Mark } from '../design/ui';
import { JourneyRail } from './JourneyRail';
import { SCENE_LABELS, type SceneId, type SceneInfo } from './scenes';
import './TopBar.css';

/**
 * The bar that floats over the page: the mark (which starts a new question), the journey, and the few
 * things that are always at hand. On a phone the journey moves to the dock and the bar names the scene.
 */
export function TopBar({
  steps,
  scene,
  hasProject,
  onGo,
  onHome,
  homeDisabled,
  historyTotal,
  onHistory,
  onAsk,
  status,
  menu,
}: {
  steps: SceneInfo[];
  scene: SceneId;
  hasProject: boolean;
  onGo: (scene: SceneId) => void;
  onHome: () => void;
  homeDisabled: boolean;
  historyTotal: number | null;
  onHistory: () => void;
  onAsk: () => void;
  status: ReactNode;
  menu: ReactNode;
}) {
  return (
    <header className="sw-bar sw-glass" data-has-project={hasProject || undefined}>
      <div className="sw-bar__start">
        <button
          type="button"
          className="sw-bar__brand"
          onClick={onHome}
          disabled={homeDisabled}
          aria-label="Swarm: start a new question"
        >
          <Mark size={26} />
          <span className="sw-bar__word">Swarm</span>
        </button>
      </div>
      <div className="sw-bar__mid">
        {hasProject ? (
          <>
            <div className="sw-hide-sm">
              <JourneyRail steps={steps} onGo={onGo} />
            </div>
            <p className="sw-bar__scene sw-hide-lg" aria-hidden="true">
              {SCENE_LABELS[scene]}
            </p>
          </>
        ) : null}
      </div>
      <div className="sw-bar__end">
        {status}
        {hasProject && (
          <IconButton label="Ask about this" shortcut="/" onClick={onAsk}>
            <MessageCircleQuestion size={19} aria-hidden="true" />
          </IconButton>
        )}
        <span className="sw-bar__history">
          <IconButton label="History" onClick={onHistory}>
            <History size={19} aria-hidden="true" />
          </IconButton>
          {historyTotal ? (
            <span className="sw-bar__count num" aria-hidden="true">
              {historyTotal > 99 ? '99+' : historyTotal}
            </span>
          ) : null}
        </span>
        {menu}
      </div>
    </header>
  );
}
