// @vitest-environment jsdom
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, renderWithApp, screen, waitFor } from '../test/dom';
import { UnsavedWorkProvider } from './UnsavedWorkProvider';
import { useAway, useUnsavedWork } from './unsaved-context';

// Work that is not saved is not lost by a way out the shell controls without the person being asked, and the question
// names what would be lost, has the safe answer under the keyboard, and goes away when the scene lets go.

const WORDS = '2 sections hold words that have not been saved.';

function Scene({ exit }: { exit: () => void }) {
  const [holding, setHolding] = useState(true);
  const away = useAway();
  useUnsavedWork(holding ? WORDS : null);
  return (
    <>
      <button type="button" onClick={() => away(exit)}>
        Go to Compare
      </button>
      <button type="button" onClick={() => setHolding(false)}>
        Save
      </button>
    </>
  );
}

const question = () => screen.queryByRole('dialog', { name: 'Leave with unsaved changes?' });

describe('the question asked before work that is not saved is left', () => {
  it('lets a way out go at once when nothing is held', async () => {
    const exit = vi.fn();
    function Quiet() {
      const away = useAway();
      return (
        <button type="button" onClick={() => away(exit)}>
          Go
        </button>
      );
    }
    const { user } = renderWithApp(
      <UnsavedWorkProvider>
        <Quiet />
      </UnsavedWorkProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(exit).toHaveBeenCalledOnce();
    expect(question()).toBeNull();
  });

  it('asks first, says what would be lost, and stays where it is on Keep editing', async () => {
    const exit = vi.fn();
    const { user } = renderWithApp(
      <UnsavedWorkProvider>
        <Scene exit={exit} />
      </UnsavedWorkProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Go to Compare' }));
    expect(await screen.findByRole('dialog', { name: 'Leave with unsaved changes?' })).toBeTruthy();
    expect(screen.getByRole('dialog').textContent).toContain(
      `${WORDS} They are lost if you leave.`,
    );
    expect(exit).not.toHaveBeenCalled();
    // The safe answer is the one under the keyboard.
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Keep editing'));
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(question()).toBeNull());
    expect(exit).not.toHaveBeenCalled();
    // Escape is the same answer.
    await user.click(screen.getByRole('button', { name: 'Go to Compare' }));
    await screen.findByRole('dialog', { name: 'Leave with unsaved changes?' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(question()).toBeNull());
    expect(exit).not.toHaveBeenCalled();
  });

  it('goes on when the person says they mean to leave', async () => {
    const exit = vi.fn();
    const { user } = renderWithApp(
      <UnsavedWorkProvider>
        <Scene exit={exit} />
      </UnsavedWorkProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Go to Compare' }));
    await user.click(await screen.findByRole('button', { name: 'Leave anyway' }));
    expect(exit).toHaveBeenCalledOnce();
    await waitFor(() => expect(question()).toBeNull());
  });

  it('stops asking once the scene lets go of what it held', async () => {
    const exit = vi.fn();
    const { user } = renderWithApp(
      <UnsavedWorkProvider>
        <Scene exit={exit} />
      </UnsavedWorkProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(screen.getByRole('button', { name: 'Go to Compare' }));
    expect(exit).toHaveBeenCalledOnce();
    expect(question()).toBeNull();
  });

  it('asks the browser to confirm closing the tab only while work is held', async () => {
    const { user } = renderWithApp(
      <UnsavedWorkProvider>
        <Scene exit={() => undefined} />
      </UnsavedWorkProvider>,
    );
    const closing = () => {
      const event = new Event('beforeunload', { cancelable: true });
      fireEvent(window, event);
      return event.defaultPrevented;
    };
    expect(closing()).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(closing()).toBe(false);
  });
});
