// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stakeholderFixture, stakeholderSetFixture } from '../../../../shared/lab-fixtures';
import type {
  Stakeholder,
  StakeholderRelation,
  StakeholdersView,
} from '../../../../shared/stakeholders';
import { renderWithApp, screen, setMedia, waitFor, within } from '../../test/dom';
import { MapScene } from './MapScene';

// The server is a fake that keeps the list in memory: what the scene saves is recorded, and what it saves
// is what it then shows, as it is with the real one. Everything else is the real scene.
const fake = vi.hoisted(() => ({
  initial: null as StakeholdersView | null,
  saves: [] as { stakeholders: Stakeholder[]; relations: StakeholderRelation[] }[],
  refusal: null as string | null,
}));
vi.mock('../../hooks/useStakeholders', async () => {
  const { useState } = await import('react');
  return {
    useStakeholders: () => {
      const [view, setView] = useState(fake.initial);
      const [problem, setProblem] = useState<string | null>(null);
      return {
        view,
        actors: null,
        loading: false,
        error: null,
        working: null,
        problem,
        reload: () => undefined,
        dismissProblem: () => setProblem(null),
        discover: async () => true,
        approve: async () => true,
        makeActors: async () => true,
        saveActors: async () => true,
        save: async (stakeholders: Stakeholder[], relations: StakeholderRelation[]) => {
          fake.saves.push({ stakeholders, relations });
          if (fake.refusal) {
            setProblem(fake.refusal);
            return false;
          }
          setView((old) =>
            old?.stakeholders
              ? { ...old, stakeholders: { ...old.stakeholders, stakeholders, relations } }
              : old,
          );
          return true;
        },
      };
    },
  };
});

const stakeholdersOf = (patch: Record<string, Partial<Stakeholder>> = {}): Stakeholder[] =>
  [
    ...stakeholderSetFixture().stakeholders,
    stakeholderFixture('press', 'influencer', { priority: 'background' }),
  ].map((stakeholder) => ({ ...stakeholder, ...patch[stakeholder.id] }));

function serve({
  patch = {},
  may = { edit: true, run: true },
}: { patch?: Record<string, Partial<Stakeholder>>; may?: StakeholdersView['may'] } = {}) {
  const set = stakeholderSetFixture();
  fake.initial = {
    stakeholders: { ...set, stakeholders: stakeholdersOf(patch), approvedAt: null },
    revision: 1,
    model: { available: false, reason: null },
    may,
  };
}

beforeEach(() => {
  fake.saves = [];
  fake.refusal = null;
  serve();
});

function renderList() {
  setMedia('(min-width: 64rem)', true);
  return renderWithApp(<MapScene />, { workspace: { view: 'list', scene: 'map' } });
}

const roster = () => screen.getByRole('region', { name: 'Stakeholders, key actors first' });
const row = (name: string) =>
  within(roster()).getByRole('button', { name: new RegExp(`^${name}`, 'u') });
/** The rows in the groups: not the ones kept under Removed, which stay in the page but out of reach. */
const listed = (name: RegExp) =>
  within(roster())
    .queryAllByRole('button', { name })
    .filter((button) => !button.closest('[inert]'));
const inspector = (name: string) => screen.findByRole('complementary', { name });
const statusOf = (id: string, call = 0) =>
  fake.saves[call]!.stakeholders.find((stakeholder) => stakeholder.id === id)?.status;

describe('the list of parties', () => {
  it('lists every party in its group, each a button that says whether it is the one shown', () => {
    renderList();
    for (const name of [
      'Provider',
      'Subscribers',
      'Rival provider',
      'Regulator',
      'Resellers',
      'Press',
    ]) {
      expect(row(name).getAttribute('aria-pressed')).toBe('false');
    }
    expect(
      within(roster())
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual([
      'Decide1',
      'Bear cost & risk1',
      'Influence & reach1',
      'Rivals1',
      'Partners & operations1',
      'Regulators1',
    ]);
    // Nothing is selected, so there is nothing beside the list.
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('shows the party that a press selects, in a panel that is named after it', async () => {
    const { user } = renderList();
    await user.click(row('Subscribers'));

    const panel = await inspector('Subscribers');
    expect(row('Subscribers').getAttribute('aria-pressed')).toBe('true');
    expect(row('Provider').getAttribute('aria-pressed')).toBe('false');
    expect(within(panel).getByRole('heading', { level: 2, name: 'Subscribers' })).toBeTruthy();
    expect(within(panel).getByText('Bears cost · Cohort')).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Accept' })).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Remove Subscribers' })).toBeTruthy();
    // It is the person's to review and nothing has been changed by looking.
    expect(fake.saves).toHaveLength(0);
  });

  it('selects from the keyboard with Enter and with Space, and moves focus to what it opened', async () => {
    const { user } = renderList();
    row('Regulator').focus();
    await user.keyboard('{Enter}');
    const panel = await inspector('Regulator');
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(panel).getByRole('heading', { name: 'Regulator' }),
      ),
    );

    row('Press').focus();
    await user.keyboard(' ');
    await inspector('Press');
    expect(row('Press').getAttribute('aria-pressed')).toBe('true');
  });

  it('swaps the panel for the next party when another is selected, and not a second panel beside it', async () => {
    const { user } = renderList();
    await user.click(row('Provider'));
    await inspector('Provider');
    await user.click(row('Regulator'));
    await inspector('Regulator');
    await waitFor(() =>
      expect(screen.queryByRole('complementary', { name: 'Provider' })).toBeNull(),
    );
    expect(screen.getAllByRole('complementary')).toHaveLength(1);
    expect(
      within(roster())
        .getAllByRole('button', { pressed: true })
        .map((button) => button.getAttribute('data-stk-focus')),
    ).toEqual(['node:regulator']);
  });

  it('puts focus on the name of the next party when another is selected', async () => {
    const { user } = renderList();
    await user.click(row('Provider'));
    await inspector('Provider');
    row('Regulator').focus();
    await user.keyboard('{Enter}');
    const panel = await inspector('Regulator');
    await waitFor(
      () =>
        expect(document.activeElement).toBe(
          within(panel).getByRole('heading', { level: 2, name: 'Regulator' }),
        ),
      { timeout: 1000 },
    );
  });

  it('closes the panel with its own button and puts focus back on the party that was open', async () => {
    const { user } = renderList();
    await user.click(row('Rival provider'));
    const panel = await inspector('Rival provider');
    await user.click(within(panel).getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
    expect(row('Rival provider').getAttribute('aria-pressed')).toBe('false');
    await waitFor(() => expect(document.activeElement).toBe(row('Rival provider')));
  });

  it('puts the party away when its row is pressed a second time, as the map does, and keeps focus on the row', async () => {
    const { user } = renderList();
    await user.click(row('Regulator'));
    await inspector('Regulator');
    expect(row('Regulator').getAttribute('aria-pressed')).toBe('true');

    row('Regulator').focus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
    expect(row('Regulator').getAttribute('aria-pressed')).toBe('false');
    await waitFor(() => expect(document.activeElement).toBe(row('Regulator')));
  });

  it('leaves out a group that has been put away, and brings it back', async () => {
    const { user } = renderList();
    await user.click(screen.getByRole('button', { name: 'Groups' }));
    const groups = await screen.findByRole('dialog');
    await user.click(within(groups).getByRole('switch', { name: /^Rivals/u }));
    await waitFor(() => expect(listed(/^Rival provider/u)).toHaveLength(0));
    expect(listed(/^Provider/u)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Groups, 1 hidden' })).toBeTruthy();

    await user.click(within(groups).getByRole('button', { name: 'Show all' }));
    await waitFor(() => expect(listed(/^Rival provider/u)).toHaveLength(1));
  });

  it('is shown as a list because the address says so, and goes back to the map when asked', async () => {
    const { user, workspace } = renderList();
    const views = screen.getByRole('radiogroup', { name: 'Show as' });
    expect(within(views).getByRole('radio', { name: 'List' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    await user.click(within(views).getByRole('radio', { name: 'Map' }));
    expect(workspace.setView).toHaveBeenCalledWith(null);
  });
});

describe('what a person does to a party', () => {
  it('accepts a party, and what is saved is the whole list with only that one changed', async () => {
    const { user } = renderList();
    await user.click(row('Resellers'));
    const panel = await inspector('Resellers');
    await user.click(within(panel).getByRole('button', { name: 'Accept' }));

    await waitFor(() => expect(fake.saves).toHaveLength(1));
    const saved = fake.saves[0]!;
    expect(saved.stakeholders.map((stakeholder) => [stakeholder.id, stakeholder.status])).toEqual([
      ['provider', 'proposed'],
      ['subscribers', 'proposed'],
      ['rival-provider', 'proposed'],
      ['regulator', 'proposed'],
      ['resellers', 'accepted'],
      ['press', 'proposed'],
    ]);
    expect(saved.relations).toEqual(stakeholderSetFixture().relations);
    // It says so to a screen reader, and has no Accept left to press.
    await waitFor(() =>
      expect(screen.getAllByRole('status').map((status) => status.textContent)).toContain(
        'Accepted Resellers.',
      ),
    );
    expect(within(panel).queryByRole('button', { name: 'Accept' })).toBeNull();
  });

  it('removes a party: it leaves the list, stays in the record, and can be taken back from the message', async () => {
    const { user } = renderList();
    await user.click(row('Regulator'));
    const panel = await inspector('Regulator');
    await user.click(within(panel).getByRole('button', { name: 'Remove Regulator' }));

    await waitFor(() => expect(fake.saves).toHaveLength(1));
    expect(statusOf('regulator')).toBe('removed');
    expect(
      fake.saves[0]!.stakeholders.filter((stakeholder) => stakeholder.status === 'removed'),
    ).toHaveLength(1);
    expect(fake.saves[0]!.relations).toEqual(stakeholderSetFixture().relations);

    await waitFor(() => expect(listed(/^Regulator/u)).toHaveLength(0));
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
    expect(within(roster()).queryByRole('heading', { name: /^Regulators/u })).toBeNull();
    // It is not gone: it is kept under Removed.
    expect(within(roster()).getByRole('button', { name: /^Removed/u })).toBeTruthy();
    const toast = within(screen.getByRole('region', { name: 'Notifications' }));
    expect(await toast.findByText('Removed Regulator')).toBeTruthy();

    await user.click(toast.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(fake.saves).toHaveLength(2));
    // It was a rules reading, so it comes back as one to review.
    expect(statusOf('regulator', 1)).toBe('proposed');
    expect(await inspector('Regulator')).toBeTruthy();
    await waitFor(() => expect(listed(/^Regulator/u)).toHaveLength(1));
    expect(row('Regulator').getAttribute('aria-pressed')).toBe('true');
  });

  it('puts focus on the next party in the list after one is removed, and not on nothing', async () => {
    const { user } = renderList();
    await user.click(row('Rival provider'));
    const panel = await inspector('Rival provider');
    await user.click(within(panel).getByRole('button', { name: 'Remove Rival provider' }));
    await waitFor(() => expect(fake.saves).toHaveLength(1));
    await waitFor(() => expect(listed(/^Rival provider/u)).toHaveLength(0));
    await waitFor(() => expect(roster().contains(document.activeElement)).toBe(true));
    expect(document.activeElement?.getAttribute('data-stk-focus')).toMatch(/^node:/u);
  });

  it('lists what was removed, and restores it from there', async () => {
    serve({ patch: { regulator: { status: 'removed' } } });
    const { user } = renderList();
    expect(listed(/^Regulator/u)).toHaveLength(0);

    const head = within(roster()).getByRole('button', { name: /^Removed/u });
    expect(head.getAttribute('aria-expanded')).toBe('false');
    await user.click(head);
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect(listed(/^Regulator/u)).toHaveLength(1);

    await user.click(within(roster()).getByRole('button', { name: /^Regulator/u }));
    const panel = await inspector('Regulator');
    expect(within(panel).queryByRole('button', { name: 'Remove Regulator' })).toBeNull();
    await user.click(within(panel).getByRole('button', { name: 'Restore' }));

    await waitFor(() => expect(fake.saves).toHaveLength(1));
    expect(statusOf('regulator')).toBe('proposed');
    await waitFor(() =>
      expect(within(roster()).queryByRole('button', { name: /^Removed/u })).toBeNull(),
    );
    expect(listed(/^Regulator/u)).toHaveLength(1);
  });

  it('leaves the list as it was, and says why, when the server refuses a change', async () => {
    fake.refusal = 'The list changed on the server. Read it again.';
    const { user } = renderList();
    await user.click(row('Press'));
    const panel = await inspector('Press');
    await user.click(within(panel).getByRole('button', { name: 'Remove Press' }));

    const notice = await screen.findByRole('alert');
    expect(notice.textContent).toContain('That did not work');
    expect(notice.textContent).toContain('The list changed on the server. Read it again.');
    expect(within(roster()).getByRole('button', { name: /^Press/u })).toBeTruthy();
    expect(screen.queryByText('Removed Press')).toBeNull();

    await user.click(within(notice).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('shows a person who may not edit the party and nothing to change it with', async () => {
    serve({ may: { edit: false, run: false } });
    const { user } = renderList();
    await user.click(row('Provider'));
    const panel = await inspector('Provider');
    for (const name of [/^Accept$/u, /^Remove /u, /^Edit /u, /^Merge /u]) {
      expect(within(panel).queryByRole('button', { name })).toBeNull();
    }
    expect(within(panel).queryByRole('radiogroup', { name: 'Priority' })).toBeNull();
  });

  it('changes how a party is modelled with the control that says so, and saves that and nothing else', async () => {
    const { user } = renderList();
    await user.click(row('Subscribers'));
    const panel = await inspector('Subscribers');
    const priority = within(panel).getByRole('radiogroup', { name: 'Priority' });
    await user.click(within(priority).getByRole('radio', { name: /^Key/u }));

    await waitFor(() => expect(fake.saves).toHaveLength(1));
    const saved = fake.saves[0]!.stakeholders;
    expect(saved.find((stakeholder) => stakeholder.id === 'subscribers')?.priority).toBe('key');
    expect(
      saved
        .filter((stakeholder) => stakeholder.priority === 'key')
        .map((stakeholder) => stakeholder.id),
    ).toEqual(['provider', 'subscribers', 'rival-provider', 'regulator']);
  });

  it('merges a party into another from its menu, and says that it can be undone', async () => {
    const { user } = renderList();
    await user.click(row('Press'));
    const panel = await inspector('Press');
    await user.click(within(panel).getByRole('button', { name: 'Merge Press into another' }));
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: 'Provider' }));

    await waitFor(() => expect(fake.saves).toHaveLength(1));
    const merged = fake.saves[0]!.stakeholders;
    expect(merged.find((stakeholder) => stakeholder.id === 'press')?.status).toBe('removed');
    expect(merged.find((stakeholder) => stakeholder.id === 'provider')?.mergedFrom).toContain(
      'press',
    );
    const toast = within(screen.getByRole('region', { name: 'Notifications' }));
    expect(await toast.findByText('Merged Press into Provider')).toBeTruthy();
    expect(toast.getByRole('button', { name: 'Undo' })).toBeTruthy();
  });
});

describe('on a narrow screen', () => {
  it('shows the party as a strip under the list, and the rest in a sheet that Escape closes', async () => {
    setMedia('(min-width: 64rem)', false);
    const { user } = renderWithApp(<MapScene />, { workspace: { view: 'list', scene: 'map' } });
    await user.click(row('Subscribers'));

    const strip = await screen.findByRole('region', { name: 'Subscribers' });
    expect(within(strip).getByRole('heading', { level: 2, name: 'Subscribers' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(within(strip).getByRole('button', { name: 'Details' }));
    const sheet = await screen.findByRole('dialog', { name: 'Subscribers' });
    expect(within(sheet).getByRole('button', { name: 'Remove Subscribers' })).toBeTruthy();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('puts focus back on Details when the sheet is closed', async () => {
    setMedia('(min-width: 64rem)', false);
    const { user } = renderWithApp(<MapScene />, { workspace: { view: 'list', scene: 'map' } });
    await user.click(row('Subscribers'));
    const strip = await screen.findByRole('region', { name: 'Subscribers' });
    const details = within(strip).getByRole('button', { name: 'Details' });
    await user.click(details);
    await screen.findByRole('dialog', { name: 'Subscribers' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(details), { timeout: 800 });
  });
});
