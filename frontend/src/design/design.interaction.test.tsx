// @vitest-environment jsdom
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithApp, screen, waitFor, within } from '../test/dom';
import { handBackFocus } from './useReturnFocus';
import {
  Button,
  ChipButton,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  Disclosure,
  IconButton,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Segmented,
  Sheet,
  SheetContent,
  SheetTrigger,
  Slider,
  Tooltip,
  useToast,
} from './ui';

// What every screen is built from has to work from a keyboard, not only read well: here the controls are
// used the way a person uses them (Tab, the arrows, Enter, Space, Escape) and what is asserted is where
// focus is and what a screen reader would be told, not how anything looks.

const focused = () => document.activeElement;

describe('Segmented', () => {
  type Way = 'files' | 'paste' | 'page';

  function Ways({
    onChange,
    pasteDisabled = false,
  }: {
    onChange?: (way: Way) => void;
    pasteDisabled?: boolean;
  }) {
    const [value, setValue] = useState<Way>('files');
    return (
      <>
        <button type="button">Before</button>
        <Segmented
          label="How to add evidence"
          value={value}
          onChange={(next) => {
            setValue(next);
            onChange?.(next);
          }}
          options={[
            { value: 'files', label: 'Files' },
            { value: 'paste', label: 'Paste', disabled: pasteDisabled },
            { value: 'page', label: 'Web page' },
          ]}
        />
        <button type="button">After</button>
      </>
    );
  }

  const radio = (name: string) => screen.getByRole('radio', { name });
  const checked = () =>
    screen
      .getAllByRole('radio')
      .filter((option) => option.getAttribute('aria-checked') === 'true')
      .map((option) => option.textContent);

  it('is a named group with one option checked, and one stop in the tab order', async () => {
    const { user } = renderWithApp(<Ways />);
    expect(screen.getByRole('radiogroup', { name: 'How to add evidence' })).toBeTruthy();
    expect(checked()).toEqual(['Files']);
    expect(screen.getAllByRole('radio').map((option) => option.tabIndex)).toEqual([0, -1, -1]);

    await user.tab();
    expect(focused()).toBe(screen.getByRole('button', { name: 'Before' }));
    await user.tab();
    expect(focused()).toBe(radio('Files'));
    await user.tab();
    expect(focused()).toBe(screen.getByRole('button', { name: 'After' }));
    await user.tab({ shift: true });
    expect(focused()).toBe(radio('Files'));
  });

  it('moves the choice and the focus together with the arrows, and goes round at the ends', async () => {
    const onChange = vi.fn();
    const { user } = renderWithApp(<Ways onChange={onChange} />);
    radio('Files').focus();

    await user.keyboard('{ArrowRight}');
    expect(checked()).toEqual(['Paste']);
    expect(focused()).toBe(radio('Paste'));
    await user.keyboard('{ArrowDown}');
    expect(focused()).toBe(radio('Web page'));
    await user.keyboard('{ArrowRight}');
    expect(focused()).toBe(radio('Files'));
    await user.keyboard('{ArrowLeft}');
    expect(focused()).toBe(radio('Web page'));
    await user.keyboard('{ArrowUp}');
    expect(focused()).toBe(radio('Paste'));

    expect(onChange.mock.calls.map(([way]) => way)).toEqual([
      'paste',
      'page',
      'files',
      'page',
      'paste',
    ]);
    // The tab stop follows the choice.
    expect(screen.getAllByRole('radio').map((option) => option.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('jumps to the first and the last with Home and End', async () => {
    const { user } = renderWithApp(<Ways />);
    radio('Files').focus();
    await user.keyboard('{End}');
    expect(checked()).toEqual(['Web page']);
    expect(focused()).toBe(radio('Web page'));
    await user.keyboard('{Home}');
    expect(checked()).toEqual(['Files']);
    expect(focused()).toBe(radio('Files'));
  });

  it('passes over an option that is not available, and a press chooses', async () => {
    const onChange = vi.fn();
    const { user } = renderWithApp(<Ways pasteDisabled onChange={onChange} />);
    radio('Files').focus();
    await user.keyboard('{ArrowRight}');
    expect(focused()).toBe(radio('Web page'));
    await user.keyboard('{ArrowRight}');
    expect(focused()).toBe(radio('Files'));
    expect((radio('Paste') as HTMLButtonElement).disabled).toBe(true);

    await user.click(radio('Web page'));
    expect(checked()).toEqual(['Web page']);
    expect(onChange).toHaveBeenLastCalledWith('page');
  });
});

describe('Disclosure', () => {
  const panelOf = (head: HTMLElement) =>
    document.getElementById(head.getAttribute('aria-controls')!)!;

  it('says whether it is open, and keeps what is closed in the page but out of reach', async () => {
    const { user } = renderWithApp(
      <Disclosure summary="How it was read">
        <p>It was read by rules.</p>
      </Disclosure>,
    );
    const head = screen.getByRole('button', { name: 'How it was read' });
    const panel = panelOf(head);
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(panel.hasAttribute('inert')).toBe(true);
    // Printing and find-in-page still reach it.
    expect(within(panel).getByText('It was read by rules.')).toBeTruthy();

    await user.click(head);
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect(panel.hasAttribute('inert')).toBe(false);

    await user.click(head);
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(panel.hasAttribute('inert')).toBe(true);
  });

  it('opens and closes from the keyboard with Enter and Space', async () => {
    const { user } = renderWithApp(<Disclosure summary="Sources">Where it came from.</Disclosure>);
    await user.tab();
    const head = screen.getByRole('button', { name: 'Sources' });
    expect(focused()).toBe(head);
    await user.keyboard('{Enter}');
    expect(head.getAttribute('aria-expanded')).toBe('true');
    await user.keyboard(' ');
    expect(head.getAttribute('aria-expanded')).toBe('false');
  });

  it('starts open when it is asked to, and can be held open or shut by the page that owns it', async () => {
    const { user, rerender } = renderWithApp(
      <Disclosure summary="Method" defaultOpen>
        Steps.
      </Disclosure>,
    );
    expect(screen.getByRole('button', { name: 'Method' }).getAttribute('aria-expanded')).toBe(
      'true',
    );

    const onOpenChange = vi.fn();
    rerender(
      <Disclosure summary="Held" open={false} onOpenChange={onOpenChange}>
        Steps.
      </Disclosure>,
    );
    const held = screen.getByRole('button', { name: 'Held' });
    await user.click(held);
    // It asks to open; whether it does is up to the page.
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(held.getAttribute('aria-expanded')).toBe('false');
    rerender(
      <Disclosure summary="Held" open onOpenChange={onOpenChange}>
        Steps.
      </Disclosure>,
    );
    expect(held.getAttribute('aria-expanded')).toBe('true');
  });

  it('can be the name of a section: its button is inside a heading', () => {
    renderWithApp(
      <Disclosure summary="Limits" heading={3}>
        What it cannot say.
      </Disclosure>,
    );
    const heading = screen.getByRole('heading', { level: 3, name: 'Limits' });
    expect(within(heading).getByRole('button', { name: 'Limits' })).toBeTruthy();
  });
});

describe('Popover', () => {
  function Options({ named = true }: { named?: boolean }) {
    return (
      <>
        <button type="button">Elsewhere</button>
        <Popover>
          <PopoverTrigger asChild>
            <Button>Options</Button>
          </PopoverTrigger>
          <PopoverContent {...(named ? { 'aria-label': 'Engine options' } : null)}>
            <input aria-label="Name" />
            <Button>Apply</Button>
          </PopoverContent>
        </Popover>
      </>
    );
  }

  it('opens beside what opened it, takes focus in, and Escape closes it and gives focus back', async () => {
    const { user } = renderWithApp(<Options />);
    const trigger = screen.getByRole('button', { name: 'Options' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Engine options' });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    await waitFor(() => expect(dialog.contains(focused())).toBe(true));

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => expect(focused()).toBe(trigger));
  });

  it('is closed by a press outside it', async () => {
    const { user } = renderWithApp(<Options />);
    await user.click(screen.getByRole('button', { name: 'Options' }));
    await screen.findByRole('dialog', { name: 'Engine options' });
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('is named after the control that opened it when it was given no name of its own', async () => {
    const { user } = renderWithApp(<Options named={false} />);
    await user.click(screen.getByRole('button', { name: 'Options' }));
    expect(await screen.findByRole('dialog', { name: 'Options' })).toBeTruthy();
  });
});

describe('Dialog', () => {
  function Question({ onConfirm }: { onConfirm?: () => void }) {
    return (
      <Dialog>
        <DialogTrigger asChild>
          <Button>Delete…</Button>
        </DialogTrigger>
        <DialogContent
          title="Delete this exploration?"
          description="It cannot be brought back."
          footer={
            <>
              <DialogClose asChild>
                <Button>Keep it</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button variant="danger" onClick={onConfirm}>
                  Delete for good
                </Button>
              </DialogClose>
            </>
          }
        />
      </Dialog>
    );
  }

  it('asks its question with focus on the first answer, hides the page behind it, and Escape gives focus back', async () => {
    const { user } = renderWithApp(<Question />);
    const trigger = screen.getByRole('button', { name: 'Delete…' });
    await user.click(trigger);

    const dialog = await screen.findByRole('dialog', { name: 'Delete this exploration?' });
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    expect(within(dialog).getByText('It cannot be brought back.')).toBeTruthy();
    // The first control is the safe answer, and that is where focus starts.
    await waitFor(() =>
      expect(focused()).toBe(within(dialog).getByRole('button', { name: 'Keep it' })),
    );
    // What is behind is left out of what assistive technology reads.
    expect(screen.queryByRole('button', { name: 'Delete…' })).toBeNull();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(focused()).toBe(screen.getByRole('button', { name: 'Delete…' })));
  });

  it('keeps Tab inside while it is open, and an answer closes it', async () => {
    const onConfirm = vi.fn();
    const { user } = renderWithApp(<Question onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: 'Delete…' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.contains(focused())).toBe(true));

    for (let presses = 0; presses < 5; presses += 1) {
      await user.tab();
      expect(dialog.contains(focused())).toBe(true);
    }

    await user.click(within(dialog).getByRole('button', { name: 'Delete for good' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('Sheet', () => {
  function History() {
    return (
      <Sheet>
        <SheetTrigger asChild>
          <Button>History</Button>
        </SheetTrigger>
        <SheetContent title="Your explorations" description="The most recent first">
          <button type="button">Open the first</button>
        </SheetContent>
      </Sheet>
    );
  }

  it('opens with focus on the sheet itself, closes on the first Escape, and gives focus back', async () => {
    const { user } = renderWithApp(<History />);
    const trigger = screen.getByRole('button', { name: 'History' });
    await user.click(trigger);

    const sheet = await screen.findByRole('dialog', { name: 'Your explorations' });
    // Not on the close button: a tooltip would open there and take the first Escape.
    await waitFor(() => expect(focused()).toBe(sheet));
    expect(screen.queryByRole('tooltip')).toBeNull();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(focused()).toBe(trigger));
  });

  it('is reached by Tab from the sheet, held there, and closed by its own button', async () => {
    const { user } = renderWithApp(<History />);
    await user.click(screen.getByRole('button', { name: 'History' }));
    const sheet = await screen.findByRole('dialog', { name: 'Your explorations' });
    await waitFor(() => expect(focused()).toBe(sheet));

    for (let presses = 0; presses < 4; presses += 1) {
      await user.tab();
      expect(sheet.contains(focused())).toBe(true);
    }
    await user.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(focused()).toBe(screen.getByRole('button', { name: 'History' })));
  });

  it('gives focus back to the control that opened it when that is not its trigger', async () => {
    function Controlled() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button onClick={() => setOpen(true)}>Details</Button>
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetContent title="The party">
              <p>Who it is.</p>
            </SheetContent>
          </Sheet>
        </>
      );
    }
    const { user } = renderWithApp(<Controlled />);
    const opener = screen.getByRole('button', { name: 'Details' });
    await user.click(opener);
    await screen.findByRole('dialog', { name: 'The party' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(focused()).toBe(opener), { timeout: 800 });
  });
});

describe('Menu', () => {
  function Settings({ onRefresh }: { onRefresh?: () => void }) {
    const [theme, setTheme] = useState('system');
    const [compact, setCompact] = useState(false);
    return (
      <Menu>
        <MenuTrigger asChild>
          <Button>Settings</Button>
        </MenuTrigger>
        <MenuContent aria-label="Settings">
          <MenuLabel>Appearance</MenuLabel>
          <MenuRadioGroup value={theme} onValueChange={setTheme}>
            <MenuRadioItem value="system">System</MenuRadioItem>
            <MenuRadioItem value="light">Light</MenuRadioItem>
            <MenuRadioItem value="dark">Dark</MenuRadioItem>
          </MenuRadioGroup>
          <MenuSeparator />
          <MenuCheckboxItem checked={compact} onCheckedChange={setCompact}>
            Compact
          </MenuCheckboxItem>
          <MenuItem onSelect={onRefresh}>Refresh</MenuItem>
        </MenuContent>
      </Menu>
    );
  }

  it('opens from the keyboard onto its first item, moves with the arrows, and Escape gives focus back', async () => {
    const { user } = renderWithApp(<Settings />);
    await user.tab();
    const trigger = screen.getByRole('button', { name: 'Settings' });
    expect(focused()).toBe(trigger);
    await user.keyboard('{ArrowDown}');

    const menu = await screen.findByRole('menu', { name: 'Settings' });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    await waitFor(() =>
      expect(focused()).toBe(within(menu).getByRole('menuitemradio', { name: 'System' })),
    );
    await user.keyboard('{ArrowDown}');
    expect(focused()).toBe(within(menu).getByRole('menuitemradio', { name: 'Light' }));
    await user.keyboard('{End}');
    expect(focused()).toBe(within(menu).getByRole('menuitem', { name: 'Refresh' }));
    await user.keyboard('{Home}');
    expect(focused()).toBe(within(menu).getByRole('menuitemradio', { name: 'System' }));

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() => expect(focused()).toBe(trigger));
  });

  it('chooses one of a group, switches an item on and off, and closes after an action', async () => {
    const onRefresh = vi.fn();
    const { user } = renderWithApp(<Settings onRefresh={onRefresh} />);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    let menu = await screen.findByRole('menu', { name: 'Settings' });
    const checked = (name: string, role: 'menuitemradio' | 'menuitemcheckbox') =>
      within(menu).getByRole(role, { name }).getAttribute('aria-checked');
    expect(checked('System', 'menuitemradio')).toBe('true');
    expect(checked('Compact', 'menuitemcheckbox')).toBe('false');

    await user.click(within(menu).getByRole('menuitemradio', { name: 'Dark' }));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    menu = await screen.findByRole('menu', { name: 'Settings' });
    expect(checked('Dark', 'menuitemradio')).toBe('true');
    expect(checked('System', 'menuitemradio')).toBe('false');
    await user.click(within(menu).getByRole('menuitemcheckbox', { name: 'Compact' }));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    menu = await screen.findByRole('menu', { name: 'Settings' });
    expect(checked('Compact', 'menuitemcheckbox')).toBe('true');
    await user.click(within(menu).getByRole('menuitem', { name: 'Refresh' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() => expect(focused()).toBe(screen.getByRole('button', { name: 'Settings' })));
  });

  it('runs the item that has focus when Enter is pressed', async () => {
    const onRefresh = vi.fn();
    const { user } = renderWithApp(<Settings onRefresh={onRefresh} />);
    await user.tab();
    await user.keyboard('{ArrowDown}');
    const menu = await screen.findByRole('menu');
    await waitFor(() => expect(menu.contains(focused())).toBe(true));
    await user.keyboard('{End}{Enter}');
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});

describe('Tooltip', () => {
  it('shows on keyboard focus with its words and key, is linked to the control, and goes with Escape or with focus', async () => {
    const { user } = renderWithApp(
      <>
        <Tooltip label="Pause the run" shortcut="Space">
          <button type="button">Pause</button>
        </Tooltip>
        <button type="button">Other</button>
      </>,
    );
    expect(screen.queryByRole('tooltip')).toBeNull();
    await user.tab();
    const button = screen.getByRole('button', { name: 'Pause' });
    expect(focused()).toBe(button);

    const tip = await screen.findByRole('tooltip');
    expect(tip.textContent).toContain('Pause the run');
    expect(tip.textContent).toContain('Space');
    expect(button.getAttribute('aria-describedby')).toBe(tip.id);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());

    await user.tab({ shift: true });
    await user.tab();
    expect(await screen.findByRole('tooltip')).toBeTruthy();
    await user.tab();
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  });

  it('shows on a hover that stays a moment, and a press puts it away', async () => {
    const { user } = renderWithApp(
      <Tooltip label="Zoom in">
        <button type="button">Plus</button>
      </Tooltip>,
    );
    const button = screen.getByRole('button', { name: 'Plus' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    await user.hover(button);
    expect(await screen.findByRole('tooltip')).toBeTruthy();

    await user.click(button);
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  });

  it('is what an icon button says its name is: the label is the name and the tooltip', async () => {
    const { user } = renderWithApp(
      <IconButton label="Close the panel" shortcut="Esc">
        <svg aria-hidden="true" />
      </IconButton>,
    );
    await user.tab();
    expect(focused()).toBe(screen.getByRole('button', { name: 'Close the panel' }));
    expect((await screen.findByRole('tooltip')).textContent).toContain('Close the panel');
  });

  it('stays shut on a control that is given focus back, so that the next Escape reaches what is still open', async () => {
    const { user } = renderWithApp(
      <Tooltip label="Delete it">
        <button type="button">Delete</button>
      </Tooltip>,
    );
    const button = screen.getByRole('button', { name: 'Delete' });
    handBackFocus(button);
    expect(focused()).toBe(button);
    // Given time to appear, if it were going to.
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(screen.queryByRole('tooltip')).toBeNull();

    // A person who moves away and comes back is another matter.
    await user.tab();
    await user.tab({ shift: true });
    expect(await screen.findByRole('tooltip')).toBeTruthy();
  });
});

describe('Slider', () => {
  function Stance({
    onCommit,
    disabled,
  }: {
    onCommit?: (value: number) => void;
    disabled?: boolean;
  }) {
    const [value, setValue] = useState(0);
    return (
      <Slider
        label="Stance"
        min={-1}
        max={1}
        step={0.25}
        value={value}
        onValueChange={setValue}
        onValueCommit={onCommit}
        valueText={`${value} of the way`}
        disabled={disabled}
      />
    );
  }

  const thumb = () => screen.getByRole('slider', { name: 'Stance' });
  const now = () => Number(thumb().getAttribute('aria-valuenow'));

  it('is a named slider with its range and a value in words', () => {
    renderWithApp(<Stance />);
    expect(thumb().getAttribute('aria-valuemin')).toBe('-1');
    expect(thumb().getAttribute('aria-valuemax')).toBe('1');
    expect(now()).toBe(0);
    expect(thumb().getAttribute('aria-valuetext')).toBe('0 of the way');
  });

  it('is set by the arrows, Home and End, one step at a time, and stops at its ends', async () => {
    const onCommit = vi.fn();
    const { user } = renderWithApp(<Stance onCommit={onCommit} />);
    await user.tab();
    expect(focused()).toBe(thumb());

    await user.keyboard('{ArrowRight}');
    expect(now()).toBe(0.25);
    await user.keyboard('{ArrowUp}');
    expect(now()).toBe(0.5);
    await user.keyboard('{ArrowLeft}{ArrowDown}{ArrowDown}');
    expect(now()).toBe(-0.25);
    expect(thumb().getAttribute('aria-valuetext')).toBe('-0.25 of the way');

    await user.keyboard('{End}');
    expect(now()).toBe(1);
    await user.keyboard('{ArrowRight}');
    expect(now()).toBe(1);
    await user.keyboard('{Home}');
    expect(now()).toBe(-1);
    await user.keyboard('{ArrowLeft}');
    expect(now()).toBe(-1);

    // Each key that moved it was a decision, and was reported as one.
    expect(onCommit).toHaveBeenCalledWith(0.25);
    expect(onCommit).toHaveBeenLastCalledWith(-1);
  });

  it('cannot be reached or moved while it is disabled', async () => {
    const { user } = renderWithApp(<Stance disabled />);
    await user.tab();
    expect(focused()).not.toBe(thumb());
    await user.keyboard('{ArrowRight}');
    expect(now()).toBe(0);
  });
});

describe('Buttons and chips', () => {
  it('toggles show whether they are on: a chip and an icon button say aria-pressed, and keep saying it', async () => {
    function Toggles() {
      const [against, setAgainst] = useState(false);
      const [playing, setPlaying] = useState(false);
      return (
        <>
          <ChipButton pressed={against} onClick={() => setAgainst(!against)}>
            Against
          </ChipButton>
          <IconButton label="Play" pressed={playing} onClick={() => setPlaying(!playing)}>
            <svg aria-hidden="true" />
          </IconButton>
        </>
      );
    }
    const { user } = renderWithApp(<Toggles />);
    const chip = screen.getByRole('button', { name: 'Against' });
    const play = screen.getByRole('button', { name: 'Play' });
    expect([chip, play].map((button) => button.getAttribute('aria-pressed'))).toEqual([
      'false',
      'false',
    ]);

    await user.click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(play.getAttribute('aria-pressed')).toBe('false');

    play.focus();
    await user.keyboard(' ');
    expect(play.getAttribute('aria-pressed')).toBe('true');
    await user.keyboard('{Enter}');
    expect(play.getAttribute('aria-pressed')).toBe('false');
    await user.click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('false');
  });

  it('never submit the form around them by accident, and a submit button does', async () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const { user } = renderWithApp(
      <form onSubmit={onSubmit}>
        <Button>Plain</Button>
        <ChipButton>Chip</ChipButton>
        <IconButton label="Icon">
          <svg aria-hidden="true" />
        </IconButton>
        <Button type="submit">Send</Button>
      </form>,
    );
    for (const name of ['Plain', 'Chip', 'Icon']) {
      await user.click(screen.getByRole('button', { name }));
    }
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('say that they are working and cannot be pressed again', async () => {
    const onClick = vi.fn();
    const { user } = renderWithApp(
      <Button busy busyLabel="Starting" onClick={onClick}>
        Run
      </Button>,
    );
    const button = screen.getByRole('button', { name: /Run/u });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.textContent).toContain('Starting');
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('Toast', () => {
  function Failing({ onRetry }: { onRetry: () => void }) {
    const toast = useToast();
    return (
      <>
        <Button
          onClick={() =>
            toast({
              title: 'That was not confirmed',
              description: 'What is saved has been read again.',
              tone: 'error',
              action: { label: 'Retry', onPress: onRetry },
            })
          }
        >
          Fail
        </Button>
        <Button onClick={() => toast({ title: 'Saved', tone: 'success', duration: 250 })}>
          Save
        </Button>
      </>
    );
  }

  const region = () => screen.getByRole('region', { name: 'Notifications' });

  it('announces a failure at once, keeps it until it is dealt with, and an action both runs and dismisses it', async () => {
    const onRetry = vi.fn();
    const { user } = renderWithApp(<Failing onRetry={onRetry} />);
    await user.click(screen.getByRole('button', { name: 'Fail' }));

    const alert = await within(region()).findByRole('alert');
    expect(alert.textContent).toContain('That was not confirmed');
    expect(alert.textContent).toContain('What is saved has been read again.');
    // An error does not leave by itself.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(within(region()).getByRole('alert')).toBe(alert);

    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(within(region()).queryByRole('alert')).toBeNull());
  });

  it('can be dismissed without taking its action', async () => {
    const onRetry = vi.fn();
    const { user } = renderWithApp(<Failing onRetry={onRetry} />);
    await user.click(screen.getByRole('button', { name: 'Fail' }));
    const alert = await within(region()).findByRole('alert');
    await user.click(within(alert).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(within(region()).queryByRole('alert')).toBeNull());
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('says a success politely and takes it away by itself', async () => {
    const { user } = renderWithApp(<Failing onRetry={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const status = await within(region()).findByRole('status');
    expect(status.textContent).toContain('Saved');
    expect(region().getAttribute('aria-live')).toBe('polite');
    await waitFor(() => expect(within(region()).queryByRole('status')).toBeNull());
  });
});
