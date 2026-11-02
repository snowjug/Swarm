import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LabProgress } from '../../../../shared/lab';
import type { ProjectDetail } from '../../../../shared/types';
import { WorkspaceContext, type Workspace } from '../../app/context';
import { sceneInfos } from '../../app/scenes';
import { ToastProvider, TooltipProvider } from '../../design/ui';
import { projectFixture } from '../../test/project';
import { deepFixture } from '../simulate/deep/fixture';
import { CompareScene } from './CompareScene';

// A run the engine made on its own (the recorded demonstration is one) has no scenarios to set side by side: what can be
// compared is its recorded runs, and that is what its comparison opens on.

const noop = () => undefined;

function workspaceOf(project: ProjectDetail, view: string | null): Workspace {
  return {
    project,
    config: null,
    mode: 'guided',
    busy: false,
    refreshing: false,
    refresh: noop,
    run: async () => undefined,
    cancel: async () => undefined,
    pause: async () => undefined,
    resume: async () => undefined,
    setIntervention: async () => undefined,
    branch: async () => undefined,
    saveEnvironment: async () => undefined,
    recordSurvey: noop,
    duplicate: noop,
    openProject: noop,
    projects: [],
    scene: 'compare',
    view,
    go: noop,
    setView: noop,
    journey: sceneInfos(project, 'compare'),
    sharing: false,
    panels: {
      history: noop,
      ask: noop,
      audit: noop,
      budget: noop,
      access: noop,
      provider: noop,
      snapshot: noop,
    },
  };
}

const page = (project: ProjectDetail, view: string | null = null): string =>
  renderToStaticMarkup(
    <WorkspaceContext.Provider value={workspaceOf(project, view)}>
      <TooltipProvider>
        <ToastProvider>
          <CompareScene />
        </ToastProvider>
      </TooltipProvider>
    </WorkspaceContext.Provider>,
  );

const LAB: LabProgress = {
  scenario: true,
  stakeholders: 'approved',
  actors: 6,
  analysis: 'completed',
  critiques: false,
  brief: false,
};

describe('the comparison of a run the engine made on its own', () => {
  const recorded = deepFixture({ saved: 6, simulation: 'ready' });

  it('opens on its recorded runs, with the way back to the run, and not on scenarios it does not have', () => {
    const html = page(recorded);
    expect(html).toContain('Compare two recorded runs');
    expect(html).toContain('There are not two recorded runs yet');
    expect(html).toContain('The deep dive');
    expect(html).not.toContain('The comparison of scenarios');
  });

  it('is the same for every other view asked for by its address', () => {
    expect(page(recorded, 'runs')).toContain('There are not two recorded runs yet');
  });

  it('is left alone for a project the lab holds a comparison for', () => {
    const html = page({ ...recorded, lab: LAB });
    expect(html).not.toContain('There are not two recorded runs yet');
    expect(html).not.toContain('Compare two recorded runs');
  });

  it('is left alone for a project that has no rounds to read', () => {
    const html = page(projectFixture());
    expect(html).not.toContain('There are not two recorded runs yet');
  });
});
