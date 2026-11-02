import type { ReactNode, Ref } from 'react';
import { Aurora } from '../design/ambient';
import type { SceneId } from './scenes';
import './shell.css';

/**
 * The frame every screen sits in: the ambient light behind, the floating bar above, the page between,
 * and on a phone the dock below. The scene's name is on the frame (`data-scene`), which tints the light.
 */
export function AppShell({
  scene,
  bar,
  dock,
  children,
  mainRef,
  footer,
}: {
  scene: SceneId;
  bar: ReactNode;
  dock: ReactNode;
  children: ReactNode;
  mainRef: Ref<HTMLElement>;
  footer?: ReactNode;
}) {
  return (
    <div className="sw-app" data-scene={scene}>
      <a className="sw-skip" href="#main-content">
        Skip to content
      </a>
      <Aurora />
      {bar}
      <main id="main-content" className="sw-main" tabIndex={-1} ref={mainRef}>
        {children}
      </main>
      {footer}
      {dock}
    </div>
  );
}
