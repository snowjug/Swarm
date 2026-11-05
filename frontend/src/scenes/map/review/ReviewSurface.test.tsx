// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { stakeholderFixture, stakeholderSetFixture } from '../../../../../shared/lab-fixtures';
import type {
  ParticipantIssue,
  ParticipantReview,
  ParticipantWhy,
  Stakeholder,
  StakeholderSet,
} from '../../../../../shared/stakeholders';
import type { ParticipantActions } from '../../../hooks/useParticipants';
import { renderWithApp, screen, waitFor, within } from '../../../test/dom';
import { ReviewSurface, type ReviewSurfaceProps } from './ReviewSurface';

const ref = {
  passageId: 'S1',
  documentId: 'D1',
  documentName: 'notes.md',
  start: 0,
  end: 30,
  quote: 'The panel signs off every change.',
  contentHash: 'hash',
  role: 'supports' as const,
};

const PANEL = stakeholderFixture('licence-panel', 'governance', {
  name: 'Licence approval panel',
  participantRole: 'approvers',
  priority: 'key',
  status: 'proposed',
  relevance: 'Signs off before the change goes ahead.',
  objective: 'Check that the change fits the rules.',
  plausibleActions: ['Ask for changes before approving'],
  evidence: [ref],
  confidenceBasis: 'source-quote',
});
const CREW = stakeholderFixture('night-crew', 'operations', {
  name: 'Night operations crew',
  participantRole: 'implementers',
  status: 'proposed',
  assumptions: ['Assumed from the role.'],
  confidenceBasis: 'category-pattern',
});
const USERS = stakeholderFixture('depot-users', 'end-user', {
  name: 'Depot users',
  status: 'accepted',
});

const setOf = (
  stakeholders: Stakeholder[],
  patch: Partial<StakeholderSet> = {},
): StakeholderSet => ({
  ...stakeholderSetFixture(),
  stakeholders,
  relations: [],
  approvedAt: null,
  ...patch,
});

const issue = (
  patch: Partial<ParticipantIssue> & Pick<ParticipantIssue, 'code'>,
): ParticipantIssue => ({
  id: `${patch.code}:${patch.participantId ?? 'all'}`,
  severity: 'blocking',
  participantId: null,
  relatedIds: [],
  role: null,
  message: 'Something stands in the way.',
  fix: 'Mend it.',
  fixAction: null,
  ...patch,
});

const reviewOf = (patch: Partial<ParticipantReview> = {}): ParticipantReview => ({
  valid: true,
  profile: 'strict',
  summary:
    'Swarm proposes these 3 participants because “Change the depot rota. Move shifts.” involves one that approves, one that implements and one that is affected. 1 is tied to quoted passages, and the other 2 rest on assumptions and are labelled so. They are synthetic roles, not real people.',
  counts: {
    participants: 3,
    key: 1,
    sourced: 1,
    assumed: 2,
    proposed: 2,
    removed: 0,
    blocking: 0,
    advisory: 0,
  },
  coverage: [
    { role: 'approvers', count: 1, status: 'covered', reason: null },
    { role: 'implementers', count: 1, status: 'covered', reason: null },
    { role: 'customers-users', count: 1, status: 'covered', reason: null },
    {
      role: 'regulators-governance',
      count: 0,
      status: 'missing',
      reason: 'Your sources mention an audit, but nobody holds the role.',
    },
    { role: 'competitors-alternatives', count: 0, status: 'optional', reason: null },
  ],
  issues: [],
  ...patch,
});

const WHY: ParticipantWhy = {
  id: 'licence-panel',
  name: 'Licence approval panel',
  roleLabel: 'Approvers',
  headline: 'Licence approval panel is on the list as approvers.',
  because: ['Role in the decision: Approvers. Has to sign off before the change can go ahead.'],
  evidence: [
    { passageId: 'S1', documentName: 'notes.md', quote: 'The panel signs off every change.' },
  ],
  basis: {
    kind: 'source-quote',
    label: 'Quoted from a source',
    explanation: 'A passage names it.',
  },
  assumptions: [],
  uncertainty: { level: 'medium', reason: 'Few passages mention it.' },
  limits: ['This is a synthetic role, not a person.'],
};

function actionsDouble(patch: Partial<ParticipantActions> = {}) {
  const done = () => Promise.resolve(true);
  const actions = {
    accept: vi.fn(done),
    edit: vi.fn(done),
    remove: vi.fn(done),
    restore: vi.fn(done),
    regenerate: vi.fn(done),
    mergeDuplicates: vi.fn(done),
    addMissing: vi.fn(done),
    why: vi.fn(() => Promise.resolve(WHY)),
    ...patch,
  } satisfies ParticipantActions;
  return actions;
}

function show(patch: Partial<ReviewSurfaceProps> = {}) {
  const actions = actionsDouble();
  const focus = vi.fn();
  const onProposeAgain = vi.fn();
  const props: ReviewSurfaceProps = {
    set: setOf([PANEL, CREW, USERS]),
    review: reviewOf(),
    may: { edit: true, run: true },
    modelAvailable: false,
    busy: false,
    problem: null,
    actions,
    focus,
    onProposeAgain,
    ...patch,
  };
  const view = renderWithApp(<ReviewSurface {...props} />);
  return {
    ...view,
    actions: props.actions as ReturnType<typeof actionsDouble>,
    focus,
    onProposeAgain,
  };
}

const button = (name: string | RegExp) => screen.getByRole('button', { name });

describe('the review of the proposed participants', () => {
  it('says why this list in a heading and a lede, with the quotation of the decision kept whole', () => {
    show();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Review the proposed participants' }),
    ).toBeTruthy();
    const lede = document.querySelector('.sw-prv__lede');
    expect(lede?.textContent).toContain('Swarm proposes these 3 participants because');
    // The decision quotes two sentences; the lede is not cut inside the quotation.
    expect(lede?.textContent).toContain('“Change the depot rota. Move shifts.” involves');
    expect(screen.getByText('Synthetic roles, not real people')).toBeTruthy();
  });

  it('groups the participants under the role they play, each labelled a synthetic role with what its place rests on', () => {
    show();
    const groups = screen
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);
    expect(groups).toEqual(
      expect.arrayContaining(['Approvers 1', 'Implementers 1', 'Customers and users 1']),
    );
    const panel = screen
      .getByRole('heading', { level: 4, name: 'Licence approval panel' })
      .closest('li')!;
    expect(within(panel).getByText('Synthetic role, not a person')).toBeTruthy();
    expect(within(panel).getByText('Quoted from a source')).toBeTruthy();
    const crew = screen
      .getByRole('heading', { level: 4, name: 'Night operations crew' })
      .closest('li')!;
    expect(within(crew).getByText('Assumed: role pattern')).toBeTruthy();
    expect(within(crew).getByText('Proposed')).toBeTruthy();
  });

  it('shows the quotation a participant cites, and says plainly that one without a passage is an assumption', () => {
    show();
    const panel = screen
      .getByRole('heading', { level: 4, name: 'Licence approval panel' })
      .closest('li')!;
    expect(within(panel).getByText('“The panel signs off every change.”')).toBeTruthy();
    const crew = screen
      .getByRole('heading', { level: 4, name: 'Night operations crew' })
      .closest('li')!;
    expect(within(crew).getByText('Assumption, not evidence.')).toBeTruthy();
  });

  it('names a role nobody holds and offers to add one, and offers the optional roles apart', async () => {
    const { user, actions } = show();
    expect(screen.getByText(/Your sources mention an audit/u)).toBeTruthy();
    await user.click(button('Add one: regulators and governance'));
    const dialog = screen.getByRole('dialog', { name: 'Add a missing participant' });
    expect(
      within(dialog).getByText('Sets, applies or audits the rules the change has to meet.'),
    ).toBeTruthy();
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Name' }),
      'Licence audit officers',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Add participant' }));
    await waitFor(() =>
      expect(actions.addMissing).toHaveBeenCalledWith({
        role: 'regulators-governance',
        name: 'Licence audit officers',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps the way on open when nothing blocks, and says so', () => {
    show();
    expect(
      screen.getByRole('heading', { level: 3, name: 'Nothing blocks these participants' }),
    ).toBeTruthy();
    expect(screen.queryByText('Fix first')).toBeNull();
    expect(screen.getByText(/press Use these actors/u)).toBeTruthy();
  });
});

describe('when a check stands in the way', () => {
  const blocked = () =>
    reviewOf({
      valid: false,
      counts: { ...reviewOf().counts, blocking: 2, advisory: 1 },
      issues: [
        issue({
          code: 'generic-name',
          participantId: 'night-crew',
          message: 'Night operations crew is too generic to simulate.',
          fix: 'Name the role by what it does here.',
          fixAction: 'rename',
        }),
        issue({
          code: 'incomplete',
          participantId: 'licence-panel',
          message: 'Licence approval panel has no plausible actions.',
          fix: 'Say what it could do.',
          fixAction: 'edit',
        }),
        issue({
          code: 'broad-name',
          severity: 'advisory',
          participantId: 'depot-users',
          message: 'Depot users is a broad name.',
          fix: 'Say which users.',
          fixAction: 'rename',
        }),
      ],
    });

  it('says how many things to fix, lists each beside the button that mends it, and marks the card', () => {
    show({ review: blocked() });
    expect(
      screen.getByRole('heading', { level: 3, name: 'Fix 2 things before these can be used' }),
    ).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Things to fix first' });
    expect(within(list).getAllByText('Fix first')).toHaveLength(2);
    expect(
      within(list).getByRole('button', { name: 'Rename: Night operations crew' }),
    ).toBeTruthy();
    expect(within(list).getByRole('button', { name: 'Edit: Licence approval panel' })).toBeTruthy();
    // The suggestion is on its own card and not among the things to fix first.
    expect(within(list).queryByText('Depot users is a broad name.')).toBeNull();
    const users = screen.getByRole('heading', { level: 4, name: 'Depot users' }).closest('li')!;
    expect(within(users).getByText('Suggestion')).toBeTruthy();
    const crew = screen
      .getByRole('heading', { level: 4, name: 'Night operations crew' })
      .closest('li')!;
    expect(crew.className).toContain('is-flagged');
  });

  it('opens the editor from the rename button, and sends only the name that was changed', async () => {
    const { user, actions } = show({ review: blocked() });
    await user.click(button('Rename: Night operations crew'));
    const dialog = screen.getByRole('dialog', { name: 'Edit participant' });
    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    await waitFor(() => expect(document.activeElement).toBe(name));
    await user.clear(name);
    await user.type(name, 'Night depot rota coordinators');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(actions.edit).toHaveBeenCalledWith('night-crew', {
        name: 'Night depot rota coordinators',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('says why the server refused a change inside the dialog, and keeps the dialog open', async () => {
    const actions = actionsDouble({ edit: vi.fn(() => Promise.resolve(false)) });
    const { user, rerender } = show({ review: blocked(), actions });
    await user.click(button('Rename: Night operations crew'));
    const dialog = screen.getByRole('dialog', { name: 'Edit participant' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), ' two');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(actions.edit).toHaveBeenCalled());
    rerender(
      <ReviewSurface
        set={setOf([PANEL, CREW, USERS])}
        review={blocked()}
        may={{ edit: true, run: true }}
        modelAvailable={false}
        busy={false}
        problem="That name is too generic to simulate."
        actions={actions}
        focus={vi.fn()}
        onProposeAgain={vi.fn()}
      />,
    );
    expect(await within(dialog).findByText('That name is too generic to simulate.')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Edit participant' })).toBeTruthy();
  });

  it('does not offer an empty edit: a dialog left as it was closes without asking the server for anything', async () => {
    const { user, actions } = show({ review: blocked() });
    await user.click(button('Edit: Licence approval panel'));
    const dialog = screen.getByRole('dialog', { name: 'Edit participant' });
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(actions.edit).not.toHaveBeenCalled();
  });

  it('takes the person to the card an issue is about', async () => {
    const { user, focus } = show({ review: blocked() });
    await user.click(button('Show Night operations crew'));
    expect(focus).toHaveBeenCalledWith(['rv:night-crew']);
  });

  it('merges what looks like one participant with the one that has most behind it', async () => {
    const twin = stakeholderFixture('night-crews', 'operations', {
      name: 'Night operations crews',
      participantRole: 'implementers',
    });
    const review = reviewOf({
      valid: false,
      counts: { ...reviewOf().counts, blocking: 1 },
      issues: [
        issue({
          code: 'duplicate-participant',
          participantId: 'night-crews',
          relatedIds: ['night-crew'],
          message: 'Night operations crews is the same as Night operations crew.',
          fix: 'Merge them.',
          fixAction: 'merge',
        }),
      ],
    });
    const { user, actions } = show({ review, set: setOf([PANEL, CREW, twin, USERS]) });
    await user.click(button('Merge duplicates'));
    expect(actions.mergeDuplicates).toHaveBeenCalledWith();
    await user.click(button('Merge: Night operations crews'));
    expect(actions.mergeDuplicates).toHaveBeenLastCalledWith([
      { keep: 'night-crews', merge: ['night-crew'] },
    ]);
  });
});

describe('what a person can do to a participant', () => {
  it('accepts every participant still proposed, or only the ones chosen', async () => {
    const { user, actions } = show();
    expect(button('Accept all (2)')).toBeTruthy();
    expect((button('Accept selected (0)') as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('checkbox', { name: 'Select Night operations crew' }));
    // An accepted participant cannot be chosen: there is nothing to accept.
    expect(screen.queryByRole('checkbox', { name: 'Select Depot users' })).toBeNull();
    await user.click(button('Accept selected (1)'));
    await waitFor(() => expect(actions.accept).toHaveBeenCalledWith(['night-crew']));
    await user.click(button('Accept all (2)'));
    expect(actions.accept).toHaveBeenLastCalledWith();
    await user.click(button('Accept Licence approval panel'));
    expect(actions.accept).toHaveBeenLastCalledWith(['licence-panel']);
  });

  it('removes a participant, and can bring a removed one back', async () => {
    const gone = stakeholderFixture('old-group', 'other', { name: 'Old group', status: 'removed' });
    const { user, actions } = show({ set: setOf([PANEL, CREW, USERS, gone]) });
    await user.click(button('Remove Night operations crew'));
    expect(actions.remove).toHaveBeenCalledWith('night-crew');
    await user.click(screen.getByRole('button', { name: 'Removed (1)' }));
    await user.click(button('Restore Old group'));
    expect(actions.restore).toHaveBeenCalledWith('old-group');
  });

  it('asks before it replaces what the person changed when it proposes a participant again', async () => {
    const edited = { ...CREW, status: 'edited' as const };
    const { user, actions } = show({ set: setOf([PANEL, edited, USERS]) });
    await user.click(button('Propose Night operations crew again'));
    expect(actions.regenerate).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Replace your changes?' });
    await user.click(within(dialog).getByRole('button', { name: 'Keep my changes' }));
    expect(actions.regenerate).not.toHaveBeenCalled();
    await user.click(button('Propose Night operations crew again'));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Replace your changes?' })).getByRole('button', {
        name: 'Replace my changes',
      }),
    );
    await waitFor(() =>
      expect(actions.regenerate).toHaveBeenCalledWith('night-crew', {
        mode: 'rules',
        confirm: true,
      }),
    );
  });

  it('proposes one that was not changed again at once, from the text', async () => {
    const { user, actions } = show();
    await user.click(button('Propose Night operations crew again'));
    expect(actions.regenerate).toHaveBeenCalledWith('night-crew', {
      mode: 'rules',
      confirm: false,
    });
  });

  it('offers the model, as a choice, when one is available', async () => {
    const { user, actions } = show({ modelAvailable: true });
    await user.click(button('Propose Night operations crew again'));
    await user.click(await screen.findByRole('menuitem', { name: 'With the model' }));
    expect(actions.regenerate).toHaveBeenCalledWith('night-crew', {
      mode: 'model',
      confirm: false,
    });
  });

  it('proposes nothing again for a participant the person added: it has no sources to be proposed from', () => {
    const mine = stakeholderFixture('my-group', 'other', {
      name: 'My own group',
      origin: 'user',
      status: 'added',
    });
    show({ set: setOf([PANEL, CREW, mine]) });
    expect(screen.queryByRole('button', { name: 'Propose My own group again' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit My own group' })).toBeTruthy();
  });

  it('merges a participant into another the person names', async () => {
    const { user, actions } = show();
    await user.click(button('Merge Night operations crew into another'));
    await user.click(await screen.findByRole('menuitem', { name: 'Licence approval panel' }));
    expect(actions.mergeDuplicates).toHaveBeenCalledWith([
      { keep: 'licence-panel', merge: ['night-crew'] },
    ]);
  });
});

describe('asking why', () => {
  it('reads the reasons when it is opened, with the passage it cites and what it does not say', async () => {
    const { user, actions } = show();
    await user.click(button('Ask why: Licence approval panel'));
    const popover = await screen.findByRole('dialog', {
      name: 'Why Licence approval panel is on the list',
    });
    expect(await within(popover).findByText(WHY.headline)).toBeTruthy();
    expect(within(popover).getByText('“The panel signs off every change.”')).toBeTruthy();
    expect(within(popover).getByText('This is a synthetic role, not a person.')).toBeTruthy();
    expect(actions.why).toHaveBeenCalledWith('licence-panel', expect.any(AbortSignal));
  });

  it('says so when the reasons cannot be read, and does not leave the person waiting', async () => {
    const actions = actionsDouble({
      why: vi.fn(() => Promise.reject(new Error('The server is away.'))),
    });
    const { user } = show({ actions });
    await user.click(button('Ask why: Licence approval panel'));
    const popover = await screen.findByRole('dialog', {
      name: 'Why Licence approval panel is on the list',
    });
    expect(await within(popover).findByText('The server is away.')).toBeTruthy();
  });
});

describe('what the proposal says of how it was made', () => {
  const proposal = (patch: Record<string, unknown> = {}) => ({
    version: 1 as const,
    generatedAt: '2026-01-15T10:00:00.000Z',
    source: 'rules' as const,
    model: null,
    failure: null,
    evidence: { shown: 4, of: 9 },
    flaggedPassages: [],
    usedResearch: false,
    usedConstraints: false,
    merged: 0,
    dropped: [],
    missingVoices: [],
    notes: [],
    ...patch,
  });

  it('flags a source that carries text addressed to an AI system, by its passage, and says it was ignored', () => {
    show({ set: setOf([PANEL, CREW, USERS], { proposal: proposal({ flaggedPassages: ['S7'] }) }) });
    expect(
      screen.getByText('Some of your sources carry text addressed to an AI system'),
    ).toBeTruthy();
    expect(screen.getByText(/did not follow it as an instruction/u).textContent).toContain('S7');
  });

  it('keeps what was left out, and why, so that nothing disappears without a trace', async () => {
    const { user } = show({
      set: setOf([PANEL, CREW, USERS], {
        proposal: proposal({
          dropped: [{ name: 'Everyone', reason: 'Too broad to simulate.' }],
          notes: ['Participants were proposed by reading the text for roles.'],
        }),
      }),
    });
    await user.click(screen.getByRole('button', { name: 'Left out (1)' }));
    expect(screen.getByText('Everyone')).toBeTruthy();
    expect(screen.getByText(/Too broad to simulate\./u)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'How this list was checked' }));
    expect(
      screen.getByText(/Read from your text for roles and checked by Swarm\. No model was used\./u),
    ).toBeTruthy();
    expect(screen.getByText('It read 4 of 9 passages.')).toBeTruthy();
  });

  it('calls a list the rules made after the model failed the rules fallback, says what failed and that no model proposed it, and does not say that no model was asked', async () => {
    const { user } = show({
      set: setOf([PANEL, CREW, USERS], {
        proposal: proposal({
          failure: {
            code: 'MODEL_TRUNCATED',
            detail: 'The model’s answer was cut short, so rules were used.',
          },
        }),
      }),
    });
    const notice = screen.getByRole('status', { name: '' });
    expect(notice.textContent).toContain('Participants from the rules fallback');
    expect(notice.textContent).toContain('The model’s answer was cut short.');
    expect(notice.textContent).toContain('no model proposed these participants');
    expect(notice.textContent).not.toContain('so rules were used');
    await user.click(screen.getByRole('button', { name: 'How this list was checked' }));
    expect(
      screen.getByText(
        /^Participants from the rules fallback: The model’s answer was cut short\./u,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/No model was used\./u)).toBeNull();
  });

  it('says nothing of a fallback for a list the rules made when rules were the choice, or a model made', () => {
    show({ set: setOf([PANEL, CREW, USERS], { proposal: proposal() }) });
    expect(screen.queryByText('Participants from the rules fallback')).toBeNull();
  });
});

describe('when the list cannot be changed or is empty', () => {
  it('can be read but not changed without the right to edit: no action, only the reasons', () => {
    show({ may: { edit: false, run: false } });
    expect(screen.getByText('You can read this list but not change it')).toBeTruthy();
    for (const name of [/^Accept all/u, /^Edit /u, /^Remove /u, 'Merge duplicates']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.queryByRole('checkbox')).toBeNull();
    // There is no button to press, so the page does not say to press one.
    expect(screen.queryByText(/press Use these actors/u)).toBeNull();
    expect(screen.getByRole('button', { name: 'Ask why: Licence approval panel' })).toBeTruthy();
  });

  it('holds every action while work is under way', () => {
    show({ busy: true });
    for (const name of [
      /^Accept all/u,
      /^Accept selected/u,
      'Merge duplicates',
      'Add a missing participant',
    ]) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull();
  });

  it('says that nobody is on the list, and lets a person add one', async () => {
    const review = reviewOf({
      valid: false,
      summary: 'There are no participants yet.',
      counts: {
        ...reviewOf().counts,
        participants: 0,
        key: 0,
        sourced: 0,
        assumed: 0,
        proposed: 0,
        blocking: 1,
      },
      coverage: [
        {
          role: 'decision-owner',
          count: 0,
          status: 'missing',
          reason: 'Every decision has an owner.',
        },
      ],
      issues: [
        issue({
          code: 'too-few',
          message: 'Two or more participants are needed.',
          fix: 'Add one.',
          fixAction: 'add-missing',
          role: 'decision-owner',
        }),
      ],
    });
    const { user } = show({ set: setOf([]), review });
    expect(screen.getByText('Nobody is on the list. Add a participant to begin.')).toBeTruthy();
    expect(screen.getByText('There are no participants yet.')).toBeTruthy();
    await user.click(
      within(screen.getByRole('list', { name: 'Things to fix first' })).getByRole('button', {
        name: 'Add one: decision owner',
      }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Add a missing participant' });
    expect(
      (within(dialog).getByRole('combobox', { name: 'Role in the decision' }) as HTMLSelectElement)
        .value,
    ).toBe('decision-owner');
  });

  it('asks again for the whole list through the one place that asks before it replaces the review', async () => {
    const { user, onProposeAgain } = show();
    await user.click(button('Propose the list again…'));
    expect(onProposeAgain).toHaveBeenCalledOnce();
  });
});
