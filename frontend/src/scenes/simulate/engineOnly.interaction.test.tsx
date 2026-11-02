// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { LabProgress } from '../../../../shared/lab';
import type { ProjectDetail } from '../../../../shared/types';
import { renderWithApp, screen, within } from '../../test/dom';
import { deepFixture } from './deep/fixture';
import { SimulateScene } from './SimulateScene';

// A run the engine made on its own (the recorded demonstration is one) has no stakeholders, actors or comparison, so
// there is nothing for the lab's states to say about it: its simulation is its deep dive. A project the lab holds
// something for is read as it always was.

vi.mock('../../api/analysis', () => ({
  analysisApi: {
    list: vi.fn(async () => ({
      analyses: [],
      readiness: {
        actors: null,
        suggestedVariants: [],
        perturbations: 0,
        rounds: 0,
        warnings: [],
        may: { run: false },
      },
    })),
    get: vi.fn(),
    start: vi.fn(),
    cancel: vi.fn(),
  },
}));

const LAB: LabProgress = {
  scenario: true,
  stakeholders: 'approved',
  actors: 0,
  analysis: 'none',
  critiques: false,
  brief: false,
};

const recorded = (): ProjectDetail => deepFixture({ saved: 6, simulation: 'ready' });
const inTheLab = (): ProjectDetail => ({ ...recorded(), lab: LAB });

const NO_ACTORS = 'No actors to simulate yet';

describe('the simulation of a run the engine made on its own', () => {
  it('opens in the deep dive when no view is asked for, and never says that there are no actors', async () => {
    renderWithApp(<SimulateScene />, {
      workspace: { project: recorded(), scene: 'simulate', view: null },
    });
    expect(
      await screen.findByRole('heading', { level: 1, name: /A slower, closer look/u }),
    ).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Where the run stands' })).toBeTruthy();
    expect(screen.queryByText(NO_ACTORS)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open the map' })).toBeNull();
  });

  it('is the deep dive for every view of a comparison that is asked for by its address', async () => {
    for (const view of ['story', 'live', 'network', 'timeline', 'setup']) {
      const { unmount } = renderWithApp(<SimulateScene />, {
        workspace: { project: recorded(), scene: 'simulate', view },
      });
      expect(
        await screen.findByRole('heading', { level: 1, name: /A slower, closer look/u }),
        view,
      ).toBeTruthy();
      expect(screen.queryByRole('radiogroup', { name: 'View' }), view).toBeNull();
      expect(screen.queryByText(NO_ACTORS), view).toBeNull();
      unmount();
    }
  });

  it('has no way back to a comparison it does not have, and does not say that one waits for it', async () => {
    renderWithApp(<SimulateScene />, {
      workspace: { project: recorded(), scene: 'simulate', view: null },
    });
    const title = await screen.findByRole('heading', { level: 1, name: /A slower, closer look/u });
    const header = title.closest('header')!;
    expect(within(header).queryByRole('button', { name: 'Simulation' })).toBeNull();
    expect(header.textContent).toContain('Fictional proxies act on two simulated platforms');
    expect(header.textContent).not.toContain('The comparison and the decision brief');
  });
});

describe('the simulation of a project the lab holds something for', () => {
  it('still says that there are no actors yet, and where to make them, when it has none', async () => {
    renderWithApp(<SimulateScene />, {
      workspace: { project: inTheLab(), scene: 'simulate', view: null },
    });
    expect(await screen.findByText(NO_ACTORS)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open the map' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1, name: /A slower, closer look/u })).toBeNull();
  });

  it('opens its deep dive when it is asked for, with the way back to the simulation', async () => {
    renderWithApp(<SimulateScene />, {
      workspace: { project: inTheLab(), scene: 'simulate', view: 'deep' },
    });
    const title = await screen.findByRole('heading', { level: 1, name: /A slower, closer look/u });
    const header = title.closest('header')!;
    expect(within(header).getByRole('button', { name: 'Simulation' })).toBeTruthy();
    expect(header.textContent).toContain(
      'The comparison and the decision brief do not wait for it.',
    );
  });
});
