import { Suspense, lazy, useMemo } from 'react';
import type { ComponentType } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { Orbit } from '../design/ui';
import { SPRING } from '../design/motion';
import { loaders } from './loaders';
import type { ProjectScene } from './scenes';

const components: Record<ProjectScene, ComponentType> = {
  ground: lazy(loaders.ground),
  map: lazy(loaders.map),
  simulate: lazy(loaders.simulate),
  compare: lazy(loaders.compare),
  decide: lazy(loaders.decide),
};

/**
 * Shows one scene and changes between scenes: the one leaving fades quickly, the one arriving rises into
 * place on a spring. A scene is a whole screen, so only one is ever mounted.
 */
export function SceneHost({ scene }: { scene: ProjectScene }) {
  const Scene = components[scene];
  const fallback = useMemo(
    () => (
      <div className="sw-scene-loading">
        <Orbit size={28} label="Opening" />
      </div>
    ),
    [],
  );
  return (
    <AnimatePresence mode="wait" initial={false}>
      <m.div
        key={scene}
        className="sw-scene"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0, transition: SPRING.gentle }}
        exit={{ opacity: 0, y: -6, transition: { duration: 0.14, ease: [0.5, 0, 0.75, 0] } }}
      >
        <Suspense fallback={fallback}>
          <Scene />
        </Suspense>
      </m.div>
    </AnimatePresence>
  );
}
