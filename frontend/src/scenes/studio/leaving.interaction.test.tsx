// @vitest-environment jsdom
import { useMemo, useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { StudioView } from '../../../../shared/studio';
import { UnsavedWorkProvider } from '../../app/UnsavedWorkProvider';
import { useAway } from '../../app/unsaved-context';
import type { StudioHandle } from '../../hooks/useStudio';
import { renderWithApp, screen, waitFor, within } from '../../test/dom';
import { studioView } from '../../test/studio';
import { LeaveGuardContext, type LeaveGuard } from '../decide/leaveGuard';
import type { StudioActions } from './actions';
import { Workbench } from './Workbench';

// Words that are written in the studio and not saved are not lost without the person being asked, whichever way they
// leave: a way out the shell controls (it asks, with the studio's words), the brief's bar, the studio's own back, and
// the detailed report (which only change the view, so the studio asks); the answer goes where they were heading, and
// never more than one question is asked for one exit.

const noop = () => undefined;

function handle(view: StudioView): StudioHandle {
  return {
    view,
    loadError: null,
    actionError: null,
    pending: null,
    loading: false,
    reload: noop,
    clearActionError: noop,
    act: async () => true,
  };
}

interface Exits {
  onBack: () => void;
  onReport: () => void;
  /** What the journey, the dock and the palette do: the shell asks before it goes. */
  exit: () => void;
}

/** What stands around the studio in the application: the shell's exits, and the bar of the brief with its guard. */
function Around({
  view,
  actions,
  exits,
}: {
  view: StudioView;
  actions: StudioActions;
  exits: Exits;
}) {
  const away = useAway();
  const asking = useRef<(() => void) | null>(null);
  const guard = useMemo<LeaveGuard>(
    () => ({
      allowed: () => {
        if (!asking.current) return true;
        asking.current();
        return false;
      },
      register: (ask) => {
        asking.current = ask;
      },
    }),
    [],
  );
  return (
    <LeaveGuardContext.Provider value={guard}>
      <button type="button" onClick={() => away(exits.exit)}>
        Journey: Ground
      </button>
      <button type="button" onClick={() => guard.allowed() && exits.onBack()}>
        Decision brief
      </button>
      <Workbench
        projectId="project-1"
        view={view}
        document={view.document!}
        studio={handle(view)}
        actions={actions}
        onBack={exits.onBack}
        onReport={exits.onReport}
        onAudit={noop}
      />
    </LeaveGuardContext.Provider>
  );
}

function setup() {
  const view = studioView();
  const edit = vi.fn(async () => true);
  const actions = {
    pending: null,
    exporting: false,
    edit,
    lock: async () => true,
    note: async () => true,
    restore: async () => true,
    regenerate: async () => true,
    decide: async () => true,
    step: async () => true,
    start: async () => true,
    exportAs: async () => undefined,
  } satisfies StudioActions;
  const exits: Exits = { onBack: vi.fn(), onReport: vi.fn(), exit: vi.fn() };
  const rendered = renderWithApp(
    <UnsavedWorkProvider>
      <Around view={view} actions={actions} exits={exits} />
    </UnsavedWorkProvider>,
  );
  return { ...rendered, ...exits, edit };
}

type Person = ReturnType<typeof setup>['user'];

/** Opens the section in view for writing and adds words to it. */
async function write(user: Person, words: string): Promise<HTMLTextAreaElement> {
  // A section that has just been chosen takes its place once the one before has left.
  await user.click(await screen.findByRole('button', { name: 'Edit' }));
  const box = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: /^Text of/u });
  await user.type(box, words);
  return box;
}

const question = () => screen.queryByRole('dialog', { name: 'Leave with unsaved changes?' });
const asked = () => screen.findByRole('dialog', { name: 'Leave with unsaved changes?' });
const OUTCOME = 'They are lost if you leave.';

describe('leaving the studio with words that are not saved', () => {
  it('asks before the detailed report, names what would be lost, and goes there only when told to', async () => {
    const { user, onReport, onBack } = setup();
    const box = await write(user, ' Unsaved words.');

    await user.click(screen.getByRole('button', { name: 'Detailed report' }));
    const dialog = await asked();
    expect(dialog.textContent).toContain(
      `1 section holds words that have not been saved. ${OUTCOME}`,
    );
    // One question for one exit: the shell's own is not asked as well.
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(onReport).not.toHaveBeenCalled();

    // Keeping the words keeps them, and nothing has moved.
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(question()).toBeNull());
    expect(box.value).toContain('Unsaved words.');
    expect(onReport).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Detailed report' }));
    await user.click(await screen.findByRole('button', { name: 'Leave anyway' }));
    expect(onReport).toHaveBeenCalledOnce();
    expect(onBack).not.toHaveBeenCalled();
    await waitFor(() => expect(question()).toBeNull());
  });

  it('asks before the detailed report of the menu that a phone has, the same way', async () => {
    const { user, onReport, onBack } = setup();
    const box = await write(user, ' Unsaved words.');

    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Detailed report' }));
    const dialog = await asked();
    expect(dialog.textContent).toContain('1 section holds words that have not been saved.');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(onReport).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(question()).toBeNull());
    expect(box.value).toContain('Unsaved words.');

    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Detailed report' }));
    await user.click(await screen.findByRole('button', { name: 'Leave anyway' }));
    expect(onReport).toHaveBeenCalledOnce();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('takes the bar of the brief and the studio’s own way back to the brief, and not to the report', async () => {
    const { user, onReport, onBack } = setup();
    await write(user, ' Unsaved words.');

    await user.click(screen.getByRole('button', { name: 'Decision brief' }));
    await user.click(await screen.findByRole('button', { name: 'Leave anyway' }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(onReport).not.toHaveBeenCalled();
    await waitFor(() => expect(question()).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Back to the brief' }));
    const dialog = await asked();
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(question()).toBeNull());
    expect(onBack).toHaveBeenCalledOnce();
    // What was asked last is not remembered: a later question goes where it is asked to.
    await user.click(screen.getByRole('button', { name: 'Detailed report' }));
    await user.click(await screen.findByRole('button', { name: 'Leave anyway' }));
    expect(onReport).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('lets the shell ask for the ways out that are its own, with the studio’s words, once', async () => {
    const { user, exit } = setup();
    const box = await write(user, ' Unsaved words.');

    await user.click(screen.getByRole('button', { name: 'Journey: Ground' }));
    const dialog = await asked();
    expect(dialog.textContent).toContain(
      `1 section holds words that have not been saved. ${OUTCOME}`,
    );
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(question()).toBeNull());
    expect(exit).not.toHaveBeenCalled();
    expect(box.value).toContain('Unsaved words.');

    await user.click(screen.getByRole('button', { name: 'Journey: Ground' }));
    await user.click(await screen.findByRole('button', { name: 'Leave anyway' }));
    expect(exit).toHaveBeenCalledOnce();
  });

  it('counts the sections that hold words, and the question follows the count', async () => {
    const { user, exit } = setup();
    await write(user, ' One.');
    await user.click(
      within(screen.getByRole('navigation', { name: 'Report sections' })).getByRole('button', {
        name: /^What the sources show/u,
      }),
    );
    await write(user, ' Two.');

    await user.click(screen.getByRole('button', { name: 'Journey: Ground' }));
    const dialog = await asked();
    expect(dialog.textContent).toContain(
      `2 sections hold words that have not been saved. ${OUTCOME}`,
    );
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    expect(exit).not.toHaveBeenCalled();
  });

  it('asks nothing when nothing is unsaved: no words written, words that were saved, or words that were put back', async () => {
    const { user, exit, onReport, edit } = setup();

    // Nothing was written: the way out is open.
    await user.click(screen.getByRole('button', { name: 'Detailed report' }));
    expect(onReport).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Journey: Ground' }));
    expect(exit).toHaveBeenCalledOnce();
    expect(question()).toBeNull();

    // Words that were saved are in the report, and are not asked about.
    await write(user, ' Saved words.');
    await user.click(
      within(screen.getByRole('region', { name: 'Save your changes' })).getByRole('button', {
        name: /^Save/u,
      }),
    );
    await waitFor(() => expect(edit).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Save your changes' })).toBeNull(),
    );
    await user.click(screen.getByRole('button', { name: 'Journey: Ground' }));
    await user.click(screen.getByRole('button', { name: 'Detailed report' }));
    expect(exit).toHaveBeenCalledTimes(2);
    expect(onReport).toHaveBeenCalledTimes(2);
    expect(question()).toBeNull();
  });

  it('warns the browser that closes the tab while words are not saved, and no longer once they are', async () => {
    const { user } = setup();
    const closing = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(closing()).toBe(false);
    await write(user, ' Unsaved words.');
    expect(closing()).toBe(true);
    await user.click(
      within(screen.getByRole('region', { name: 'Save your changes' })).getByRole('button', {
        name: /^Save/u,
      }),
    );
    await waitFor(() => expect(closing()).toBe(false));
  });
});
