// @vitest-environment jsdom
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithApp, screen, waitFor, within } from '../test/dom';
import { CommandPalette } from './CommandPalette';
import type { Command } from './commands';

// The palette is held to what a person does with it: open it from a button, type, move with the arrows, press
// Enter, press Escape; and to where focus is afterwards and what a screen reader is told along the way.

function command(
  id: string,
  label: string,
  over: Partial<Command> = {},
  run: () => void = () => undefined,
): Command {
  return {
    id,
    group: 'go',
    label,
    icon: (() => null) as unknown as Command['icon'],
    run,
    ...over,
  };
}

function Harness({ commands, start = false }: { commands: Command[]; start?: boolean }) {
  const [open, setOpen] = useState(start);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open palette
      </button>
      <CommandPalette open={open} onOpenChange={setOpen} commands={commands} />
    </>
  );
}

const list = () => screen.getByRole('listbox', { name: 'Commands' });
const field = () => screen.getByRole<HTMLInputElement>('combobox', { name: 'Search commands' });
const options = () => screen.queryAllByRole('option');
const dialog = () => screen.findByRole('dialog', { name: 'Commands' });
const closed = () => waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

describe('CommandPalette', () => {
  it('opens as a dialog with the field focused, lists every command by group, and closes on Escape with focus back', async () => {
    const { user } = renderWithApp(
      <Harness
        commands={[
          command('go:ground', 'Ground'),
          command('open:history', 'History', { group: 'open' }),
          command('look:theme:dark', 'Dark theme', { group: 'look', current: true }),
        ]}
      />,
    );
    const opener = screen.getByRole('button', { name: 'Open palette' });
    await user.click(opener);

    expect(await dialog()).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(field()));
    expect(options()).toHaveLength(3);
    expect(within(list()).getByRole('group', { name: 'Go to' })).toBeTruthy();
    expect(within(list()).getByRole('group', { name: 'Look and feel' })).toBeTruthy();
    // The setting that is on says so in words, not only by a tick.
    expect(within(list()).getByRole('option', { name: /Dark theme, on/u })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('3 commands');

    await user.keyboard('{Escape}');
    await closed();
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('filters as it is typed, marks the best match, and runs the marked row on Enter', async () => {
    const run = vi.fn();
    const other = vi.fn();
    const { user } = renderWithApp(
      <Harness
        start
        commands={[
          command('go:map', 'Map', {}, other),
          command('look:theme:dark', 'Dark theme', { group: 'look' }, run),
          command('look:theme:light', 'Light theme', { group: 'look' }, other),
        ]}
      />,
    );
    await dialog();
    await user.keyboard('dark');

    const rows = options();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.getAttribute('aria-selected')).toBe('true');
    expect(field().getAttribute('aria-activedescendant')).toBe(rows[0]!.id);
    expect(screen.getByRole('status').textContent).toBe('1 command');

    await user.keyboard('{Enter}');
    expect(run).toHaveBeenCalledOnce();
    expect(other).not.toHaveBeenCalled();
    await closed();
  });

  it('moves the mark with the arrows, wraps at both ends, and follows the pointer', async () => {
    const second = vi.fn();
    const { user } = renderWithApp(
      <Harness
        start
        commands={[
          command('go:ground', 'Ground'),
          command('go:map', 'Map', {}, second),
          command('go:simulate', 'Simulate'),
        ]}
      />,
    );
    await dialog();
    const marked = () =>
      options().findIndex((option) => option.getAttribute('aria-selected') === 'true');

    expect(marked()).toBe(0);
    await user.keyboard('{ArrowDown}');
    expect(marked()).toBe(1);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(marked()).toBe(0);
    await user.keyboard('{ArrowUp}');
    expect(marked()).toBe(2);
    await user.hover(within(list()).getByRole('option', { name: 'Map' }));
    expect(marked()).toBe(1);
    await user.click(within(list()).getByRole('option', { name: 'Map' }));
    expect(second).toHaveBeenCalledOnce();
  });

  it('keeps a step that is shut in the list, says why, and still runs so that the shell can explain', async () => {
    const run = vi.fn();
    const { user } = renderWithApp(
      <Harness
        start
        commands={[command('go:simulate', 'Simulate', { locked: true, hint: 'Needs actors' }, run)]}
      />,
    );
    await dialog();
    const option = within(list()).getByRole('option', { name: /Simulate/u });
    expect(option.getAttribute('aria-disabled')).toBe('true');
    expect(option.textContent).toContain('Needs actors');
    await user.keyboard('{Enter}');
    expect(run).toHaveBeenCalledOnce();
  });

  it('says so, to eyes and to a screen reader, when nothing matches, and Enter then does nothing', async () => {
    const run = vi.fn();
    const { user } = renderWithApp(
      <Harness start commands={[command('go:ground', 'Ground', {}, run)]} />,
    );
    await dialog();
    await user.keyboard('xyzzy{Enter}');
    expect(screen.getByText(/Nothing matches/u).textContent).toContain('xyzzy');
    expect(screen.getByRole('status').textContent).toBe('No commands match.');
    expect(options()).toHaveLength(0);
    // With nothing to choose from, the field does not claim a list.
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(field().getAttribute('aria-expanded')).toBe('false');
    expect(field().hasAttribute('aria-controls')).toBe(false);
    expect(field().hasAttribute('aria-activedescendant')).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(await dialog()).toBeTruthy();
  });

  it('can be entered by Tab, because its rows scroll, and answers the same keys there', async () => {
    const run = vi.fn();
    const { user } = renderWithApp(
      <Harness
        start
        commands={[command('go:ground', 'Ground'), command('go:map', 'Map', {}, run)]}
      />,
    );
    await dialog();
    await user.tab();
    expect(document.activeElement).toBe(list());
    expect(list().getAttribute('aria-activedescendant')).toBe(options()[0]!.id);
    await user.keyboard('{ArrowDown}');
    expect(list().getAttribute('aria-activedescendant')).toBe(options()[1]!.id);
    await user.keyboard('{Enter}');
    expect(run).toHaveBeenCalledOnce();
  });

  it('starts empty every time it opens', async () => {
    const { user } = renderWithApp(<Harness commands={[command('go:ground', 'Ground')]} />);
    await user.click(screen.getByRole('button', { name: 'Open palette' }));
    await dialog();
    await user.keyboard('gro');
    expect(field().value).toBe('gro');
    await user.keyboard('{Escape}');
    await closed();
    await user.click(screen.getByRole('button', { name: 'Open palette' }));
    await dialog();
    expect(field().value).toBe('');
  });
});
