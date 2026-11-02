// @vitest-environment jsdom
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig, ProjectDetail } from '../../../../../shared/types';
import { UnsavedWorkProvider } from '../../../app/UnsavedWorkProvider';
import { WorkspaceContext } from '../../../app/context';
import { useAway } from '../../../app/unsaved-context';
import { renderWithApp, screen, waitFor, workspaceStub } from '../../../test/dom';
import { deepFixture } from './fixture';
import DeepDive from './index';

// The setup of the deep dive is a draft that is lost when the person leaves. While it holds edits that are not saved, the
// shell asks before the journey, the dock, the palette, another exploration or a new question, and the scene asks for its
// own way back; once the edits are saved or discarded nothing is asked.

const CHANGED = '1 change to the environment has not been saved.';
const question = () => screen.queryByRole('dialog', { name: 'Leave with unsaved changes?' });

/** The scene in a shell that keeps the project: saving the setup changes what the project says, as the server's answer does. */
function Shell({ exit, setView }: { exit: () => void; setView: (view: string | null) => void }) {
  const [project, setProject] = useState<ProjectDetail>(() =>
    deepFixture({ simulation: 'pending', saved: 0 }),
  );
  const away = useAway();
  const workspace = workspaceStub({
    project,
    config: { capabilities: { whatIf: true } } as unknown as AppConfig,
    scene: 'simulate',
    view: 'deep',
    setView,
    saveEnvironment: async (update) =>
      setProject((old) => ({
        ...old,
        settings: { ...old.settings, rounds: update.rounds },
        roundCount: update.rounds,
      })),
  });
  return (
    <WorkspaceContext.Provider value={workspace}>
      <DeepDive />
      <button type="button" onClick={() => away(exit)}>
        Go to Compare
      </button>
    </WorkspaceContext.Provider>
  );
}

function open() {
  const exit = vi.fn();
  const setView = vi.fn();
  const view = renderWithApp(
    <UnsavedWorkProvider>
      <Shell exit={exit} setView={setView} />
    </UnsavedWorkProvider>,
  );
  return { ...view, exit, setView };
}

const oneMoreRound = () => screen.getByRole('button', { name: 'One more: rounds' });

describe('leaving the setup of the deep dive', () => {
  it('asks nothing while nothing in the setup has changed', async () => {
    const { user, exit } = open();
    await user.click(screen.getByRole('button', { name: 'Go to Compare' }));
    expect(exit).toHaveBeenCalledOnce();
    expect(question()).toBeNull();
  });

  it('asks first once a value has changed, names how many changes, and keeps them on Keep editing', async () => {
    const { user, exit } = open();
    await user.click(oneMoreRound());
    expect(screen.getByRole('region', { name: 'Unsaved changes to the setup' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Go to Compare' }));
    const dialog = await screen.findByRole('dialog', { name: 'Leave with unsaved changes?' });
    expect(dialog.textContent).toContain(`${CHANGED} They are lost if you leave.`);
    expect(exit).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(question()).toBeNull());
    expect(exit).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'Unsaved changes to the setup' })).toBeTruthy();
    expect((screen.getByRole('spinbutton', { name: 'Rounds' }) as HTMLInputElement).value).toBe(
      '7',
    );
  });

  it('counts every change, and lets go when the person leaves anyway', async () => {
    const { user, exit } = open();
    // The rounds and the minutes of a round are one change, the timing; the platforms are another.
    await user.click(oneMoreRound());
    await user.click(screen.getByRole('button', { name: 'One more: minutes per round' }));
    await user.click(screen.getByRole('switch', { name: /Topic Community/u }));
    await user.click(screen.getByRole('button', { name: 'Go to Compare' }));
    expect((await screen.findByRole('dialog')).textContent).toContain(
      '2 changes to the environment have not been saved.',
    );
    await user.click(screen.getByRole('button', { name: 'Leave anyway' }));
    expect(exit).toHaveBeenCalledOnce();
  });

  it('asks nothing once the setup is saved, or once the changes are discarded', async () => {
    const { user, exit } = open();
    await user.click(oneMoreRound());
    await user.click(screen.getByRole('button', { name: 'Save the setup' }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Unsaved changes to the setup' })).toBeNull(),
    );
    await user.click(screen.getByRole('button', { name: 'Go to Compare' }));
    expect(exit).toHaveBeenCalledOnce();
    expect(question()).toBeNull();

    await user.click(oneMoreRound());
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    await user.click(screen.getByRole('button', { name: 'Go to Compare' }));
    expect(exit).toHaveBeenCalledTimes(2);
    expect(question()).toBeNull();
  });

  it('asks before the way back to the simulation too, which is a change of view and not an exit of the shell', async () => {
    const { user, setView } = open();
    await user.click(screen.getByRole('button', { name: 'Simulation' }));
    expect(setView).toHaveBeenCalledWith(null);
    expect(question()).toBeNull();

    setView.mockClear();
    await user.click(oneMoreRound());
    await user.click(screen.getByRole('button', { name: 'Simulation' }));
    expect(await screen.findByRole('dialog', { name: 'Leave with unsaved changes?' })).toBeTruthy();
    expect(setView).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Leave anyway' }));
    expect(setView).toHaveBeenCalledExactlyOnceWith(null);
  });
});
