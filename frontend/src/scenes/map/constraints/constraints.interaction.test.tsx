// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  constraintCoverageSchema,
  constraintSchema,
  constraintSetSchema,
  counterfactualSetSchema,
  type Clarification,
  type Constraint,
  type ConstraintCoverage,
  type ConstraintSet,
  type ConstraintsView,
  type CounterfactualsView,
} from '../../../../../shared/constraints';
import { renderWithApp, screen, setMedia, waitFor, within } from '../../../test/dom';
import { ConstraintsPage } from './index';
import type { ConstraintsState } from './useConstraints';

const NOW = '2026-03-01T09:00:00.000Z';

const base = {
  id: 'c-0001',
  category: 'budget',
  statement: 'Spending on the change is capped by the finance office.',
  source: 'user',
  hardness: 'soft',
  confidenceBasis: { kind: 'user-entry', note: 'You wrote it.' },
  uncertainty: { level: 'low', reason: 'You stated it.' },
  validation: 'confirmed',
  review: 'accepted',
};
const constraint = (change: Record<string, unknown> = {}): Constraint =>
  constraintSchema.parse({ ...base, ...change });

const quote = (text: string) => ({
  passageId: 'S1',
  documentId: 'doc-1',
  documentName: 'limits.md',
  start: 0,
  end: text.length,
  quote: text,
  contentHash: 'h1',
  role: 'supports' as const,
});

const REGULATOR_QUOTE = 'The fee rise needs the regulator’s approval before it can take effect.';

const hardLegal = constraint({
  id: 'c-reg',
  category: 'regulatory',
  statement: REGULATOR_QUOTE,
  source: 'extracted',
  hardness: 'hard',
  hardnessBasis: 'Hard because the source says “needs … approval”.',
  validation: 'unvalidated',
  review: 'proposed',
  evidenceRefs: [quote(REGULATOR_QUOTE)],
  confidenceBasis: { kind: 'evidence-quote', note: 'Found in limits.md.' },
  uncertainty: { level: 'medium', reason: 'A source says so; nobody has validated it.' },
  effects: [{ kind: 'require-approval', approverActorId: 'regulator', threshold: 0.1 }],
  enforcement: 'enforced',
  affectedActorIds: ['subscribers'],
});
const guess = constraint({
  id: 'c-guess',
  category: 'dependency',
  statement: 'The change may depend on parties it does not control (Resellers).',
  source: 'inferred',
  hardness: 'soft',
  validation: 'unvalidated',
  review: 'proposed',
  confidenceBasis: { kind: 'category-prompt', note: '' },
  uncertainty: { level: 'high', reason: 'Suggested by who is involved.' },
  affectedActorIds: ['resellers'],
});
const confirmed = constraint({
  id: 'c-budget',
  hardness: 'hard',
  consideredIn: ['gate', 'analysis-record'],
  enforcement: 'interpretive',
});
const applied = constraint({
  id: 'c-cost',
  category: 'capacity',
  statement: 'Resellers cannot absorb more than ten extra cases a week.',
  effects: [{ kind: 'add-cost', target: 'adoption', amount: 0.2 }],
  enforcement: 'enforced',
  affectedActorIds: ['resellers'],
});
const removed = constraint({
  id: 'c-gone',
  category: 'cultural',
  statement: 'A custom nobody can name.',
  review: 'removed',
  validation: 'rejected',
});

const question = (
  id: string,
  category: Clarification['category'],
  text: string,
): Clarification => ({
  id,
  category,
  question: text,
  why: 'It could change which alternative comes out ahead.',
  status: 'open',
  answer: null,
  constraintId: null,
});

const gate = (change: Record<string, unknown> = {}): ConstraintCoverage =>
  constraintCoverageSchema.parse({
    status: 'provisional',
    reviewed: false,
    evaluatedAt: NOW,
    summary: 'Provisional: a simulation may run, and says so.',
    label:
      'Provisional: the simulation ran with 2 constraints not yet validated. Treat what it shows as conditional on them.',
    ...change,
  });

const setOf = (constraints: Constraint[], more: Record<string, unknown> = {}): ConstraintSet =>
  constraintSetSchema.parse({
    version: 1,
    constraints,
    generatedAt: NOW,
    mode: 'rules',
    note: 'Read by rules from your words and your sources; no model was used.',
    scenarioRevision: 1,
    actorsRevision: 1,
    ...more,
  });

const viewOf = (
  set: ConstraintSet | null,
  coverage: ConstraintCoverage | null,
  change: Partial<ConstraintsView> = {},
): ConstraintsView => ({
  constraints: set,
  revision: set ? 3 : null,
  gate: coverage,
  open: [],
  stale: { scenario: false, actors: false },
  alternatives: [{ id: 'proposed-change', label: 'Proposed change' }],
  actors: [
    { id: 'regulator', name: 'Regulator', category: 'regulator' },
    { id: 'resellers', name: 'Resellers', category: 'partner' },
    { id: 'subscribers', name: 'Subscribers', category: 'cost-bearer' },
  ],
  assumptions: [],
  model: { available: false, reason: 'This project runs without a model.' },
  may: { edit: true, run: true },
  ...change,
});

const stateOf = (view: ConstraintsView | null, change: Partial<ConstraintsState> = {}) => {
  const calls = {
    review: vi.fn(async () => true),
    propose: vi.fn(async () => true),
    measure: vi.fn(async () => true),
    runViews: vi.fn(async () => true),
    reload: vi.fn(),
    dismissProblem: vi.fn(),
  };
  const state: ConstraintsState = {
    view,
    counterfactuals: null,
    sensitivity: null,
    loading: false,
    error: null,
    working: null,
    problem: null,
    ...calls,
    ...change,
  };
  return { state, calls };
};

const mount = (
  view: ConstraintsView | null,
  change: Partial<ConstraintsState> = {},
  handlers: { onView?: () => void; onSimulate?: () => void } = {},
) => {
  const { state, calls } = stateOf(view, change);
  const rendered = renderWithApp(
    <ConstraintsPage
      state={state}
      onView={handlers.onView ?? (() => undefined)}
      onSimulate={handlers.onSimulate ?? (() => undefined)}
    />,
  );
  return { ...rendered, calls };
};

const row = (statement: string | RegExp) =>
  screen.getByRole('listitem', {
    name: (name) =>
      typeof statement === 'string' ? name.includes(statement) : statement.test(name),
  });

describe('what the page shows while it reads, and when it cannot', () => {
  it('says it is reading, and then, if reading failed, says so with a way to try again', async () => {
    const reading = mount(null, { loading: true });
    expect(screen.getByRole('status', { name: 'Reading the constraints' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Read my sources/u })).toBeNull();
    reading.unmount();

    const { calls, user } = mount(null, { error: 'The server did not answer.' });
    expect(screen.getByRole('alert').textContent).toContain('The constraints could not be read');
    expect(screen.getByRole('alert').textContent).toContain('The server did not answer.');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(calls.reload).toHaveBeenCalledOnce();
  });
});

describe('a project with no constraints yet', () => {
  it('invites the person to read their sources, and says that until then a simulation runs without any', async () => {
    const { calls, user } = mount(viewOf(null, null));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('What limits the decision');
    expect(
      screen.getByRole('heading', { level: 2, name: 'No constraints have been read yet' }),
    ).toBeTruthy();
    expect(screen.getByText(/Until you do, simulations run without any\./u)).toBeTruthy();
    // No model: the reason is said, and no button asks one.
    expect(screen.getByText('This project runs without a model.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Ask the model/u })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Read my sources for constraints' }));
    expect(calls.propose).toHaveBeenCalledWith('rules');
  });

  it('offers the model only when the project has one, and lets a person add a constraint of their own', async () => {
    const { calls, user } = mount(viewOf(null, null, { model: { available: true, reason: null } }));
    // A model-assisted project leads with the model, and keeps reading the sources as the other way.
    const rules = screen.getByRole('button', { name: 'Read my sources for constraints' });
    const asking = screen.getByRole('button', { name: 'Ask the model to read them' });
    expect(asking.compareDocumentPosition(rules) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(asking);
    expect(calls.propose).toHaveBeenCalledWith('model');
    await user.click(screen.getByRole('button', { name: 'Add one yourself' }));
    const form = await screen.findByRole('form', { name: 'Add a constraint' });
    await user.type(within(form).getByLabelText('What is the limit?'), 'The board meets in March.');
    await user.click(within(form).getByRole('button', { name: 'Add the constraint' }));
    await waitFor(() => expect(calls.review).toHaveBeenCalledOnce());
    const [action] = calls.review.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(action).toMatchObject({
      action: 'add',
      constraint: { statement: 'The board meets in March.', validation: 'confirmed', effects: [] },
    });
    // Where it came from is not the page's to say.
    expect(JSON.stringify(action)).not.toMatch(/source|evidence/iu);
  });

  it('shows a reader who may not run or edit what they have, and offers nothing they cannot do', () => {
    mount(viewOf(null, null, { may: { edit: false, run: false } }));
    expect(screen.getByText(/needs more access to this project/u)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Read my sources/u })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add one yourself' })).toBeNull();
  });
});

describe('constraints that wait for a decision', () => {
  const set = setOf([hardLegal, guess, confirmed, applied, removed], {
    clarifications: [],
  });
  const blocked = gate({
    status: 'blocked',
    summary: 'Blocked: a hard legal, regulatory or safety constraint is not settled.',
    label: null,
    blockedBy: [
      {
        reason: 'unresolved-high-stakes',
        constraintId: 'c-reg',
        text: 'A hard regulatory constraint is not settled: confirm it, set it aside, mark it unknown or choose to assume it.',
      },
    ],
    known: [{ id: 'c-budget', category: 'budget', hardness: 'hard', statement: 'x' }],
    reasons: ['2 constraints wait for a first look.'],
  });

  it('is blocked in words that say what to do, and cannot confirm a review while something waits', () => {
    mount(viewOf(set, blocked));
    const section = screen.getByRole('region', { name: 'Constraint coverage' });
    expect(within(section).getByText('Blocked')).toBeTruthy();
    expect(within(section).getByRole('alert').textContent).toContain('This stops the simulation');
    expect(within(section).getByRole('alert').textContent).toContain(
      'confirm it, set it aside, mark it unknown or choose to assume it',
    );
    expect(
      screen.getByRole('button', { name: 'Confirm the review' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(screen.queryByRole('button', { name: 'Go to the simulation' })).toBeNull();
    expect(screen.getByText(/2 constraints are still waiting for your decision/u)).toBeTruthy();
  });

  it('lists hard before soft, labels where each came from, and never shows a guess as a fact', () => {
    mount(viewOf(set, blocked));
    const hard = screen.getByRole('region', { name: /Hard limits/u });
    const soft = screen.getByRole('region', { name: /Soft limits/u });
    // Each constraint is a named item; the lines of what the simulation does with one are not.
    const named = (within_: HTMLElement) =>
      within(within_)
        .getAllByRole('listitem')
        .filter((item) => item.getAttribute('aria-label'));
    expect(named(hard)).toHaveLength(2);
    expect(named(soft)).toHaveLength(2);

    const quoted = row(/^Regulatory/u);
    expect(within(quoted).getByText('From evidence')).toBeTruthy();
    expect(within(quoted).getByText('Not yet validated')).toBeTruthy();
    expect(within(quoted).getByText('Needs your look')).toBeTruthy();
    expect(within(quoted).getByText('Applied once you accept it')).toBeTruthy();
    expect(within(quoted).getByText('Hard')).toBeTruthy();

    const inferred = row(/^Dependency/u);
    expect(within(inferred).getByText('Inferred')).toBeTruthy();
    expect(within(inferred).getByText('Not yet validated')).toBeTruthy();
    expect(within(inferred).queryByText('Confirmed')).toBeNull();
    expect(within(inferred).getByText('Read, not modelled')).toBeTruthy();

    const yours = row(/^Budget/u);
    expect(within(yours).getByText('You')).toBeTruthy();
    expect(within(yours).getByText('Confirmed')).toBeTruthy();
    // It is only read, and says so, and never claims to have changed a run.
    expect(
      within(yours).getByText(/does not apply it, and does not change because of it/u).textContent,
    ).toContain('the gate and the comparison’s record');

    const running = row(/^Capacity/u);
    expect(within(running).getByText('Applied in the simulation')).toBeTruthy();
    expect(within(running).getByText(/Adds friction on taking it up by 0.2/u)).toBeTruthy();
    expect(within(running).getByText(/Affects Resellers/u)).toBeTruthy();
  });

  it('shows the quote of a source word for word, and says of an inference that no source says it', async () => {
    const { user } = mount(viewOf(set, blocked));
    await user.click(
      within(row(/^Regulatory/u)).getByRole('button', { name: /^Evidence \(1\): / }),
    );
    const popover = await screen.findByRole('dialog', {
      name: /Where this came from: From evidence/u,
    });
    expect(within(popover).getByText(`“${REGULATOR_QUOTE}”`)).toBeTruthy();
    expect(within(popover).getByText('limits.md')).toBeTruthy();
    expect(within(popover).getByText(/Swarm found the quote in it/u)).toBeTruthy();
    // Hardness is a proposal, and the words it rests on are shown.
    expect(
      within(popover).getByText('Hard because the source says “needs … approval”.'),
    ).toBeTruthy();
    expect(
      within(popover).getByText(
        /Needs an approver|The change reaches the actors in scope only from the round after/u,
      ),
    ).toBeTruthy();
    await user.keyboard('{Escape}');

    await user.click(within(row(/^Dependency/u)).getByRole('button', { name: /^Where from: / }));
    const inferred = await screen.findByRole('dialog', { name: /Where this came from: Inferred/u });
    expect(
      within(inferred).getByText(
        /No source or person has said this holds\. It is a suggestion until you confirm it\./u,
      ),
    ).toBeTruthy();
    expect(within(inferred).queryByRole('blockquote')).toBeNull();
  });

  it('sends what the person chooses, one constraint at a time', async () => {
    const { calls, user } = mount(viewOf(set, blocked));
    const quoted = row(/^Regulatory/u);
    await user.click(within(quoted).getByRole('button', { name: /^Confirm: / }));
    expect(calls.review).toHaveBeenLastCalledWith({ action: 'confirm', id: 'c-reg' });
    await user.click(within(quoted).getByRole('button', { name: /^Accept: / }));
    expect(calls.review).toHaveBeenLastCalledWith({ action: 'accept', ids: ['c-reg'] });
    await user.click(within(quoted).getByRole('button', { name: /^More for: / }));
    await user.click(await screen.findByRole('menuitem', { name: 'Mark unknown' }));
    expect(calls.review).toHaveBeenLastCalledWith({ action: 'mark-unknown', id: 'c-reg' });
    await user.click(within(quoted).getByRole('button', { name: /^More for: / }));
    await user.click(await screen.findByRole('menuitem', { name: 'Use as an assumption' }));
    expect(calls.review).toHaveBeenLastCalledWith({ action: 'use-assumption', id: 'c-reg' });
    await user.click(within(row(/^Dependency/u)).getByRole('button', { name: /^More for: / }));
    await user.click(await screen.findByRole('menuitem', { name: 'Leave out of the model' }));
    expect(calls.review).toHaveBeenLastCalledWith({ action: 'exclude', id: 'c-guess' });
    await user.click(screen.getByRole('button', { name: 'Accept the 2 that wait' }));
    expect(calls.review).toHaveBeenLastCalledWith({ action: 'accept', ids: ['c-reg', 'c-guess'] });
  });

  it('keeps what was set aside apart, and puts it back on request', async () => {
    const { calls, user } = mount(viewOf(set, blocked));
    const aside = screen.getByRole('button', { name: /Set aside \(1\)/u });
    await user.click(aside);
    const gone = screen.getByRole('listitem', { name: /A custom nobody can name/u });
    expect(within(gone).getByText('Set aside')).toBeTruthy();
    await user.click(within(gone).getByRole('button', { name: /^Restore: / }));
    expect(calls.review).toHaveBeenLastCalledWith({ action: 'restore', id: 'c-gone' });
  });

  it('changes a constraint with a patch that says only what changed', async () => {
    const { calls, user } = mount(viewOf(set, blocked));
    await user.click(within(row(/^Capacity/u)).getByRole('button', { name: /^More for: / }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    const form = await screen.findByRole('form', { name: 'Change the constraint' });
    const statement = within(form).getByLabelText('What is the limit?');
    expect((statement as HTMLTextAreaElement).value).toBe(
      'Resellers cannot absorb more than ten extra cases a week.',
    );
    await user.clear(statement);
    await user.type(statement, 'Resellers cannot absorb more than twelve extra cases a week.');
    await user.click(within(form).getByRole('button', { name: 'Save the change' }));
    await waitFor(() => expect(calls.review).toHaveBeenCalledOnce());
    expect(calls.review).toHaveBeenCalledWith({
      action: 'edit',
      id: 'c-cost',
      patch: { statement: 'Resellers cannot absorb more than twelve extra cases a week.' },
    });
  });

  it('says why a constraint cannot be saved, and keeps the form open', async () => {
    const { calls, user } = mount(
      viewOf(
        setOf([]),
        gate({
          status: 'clear',
          label: null,
          reviewed: true,
          summary:
            'Clear: no constraints were identified, which is what was found and not proof that none exist.',
        }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Add a constraint' }));
    const form = await screen.findByRole('form', { name: 'Add a constraint' });
    await user.click(within(form).getByRole('button', { name: 'Add the constraint' }));
    expect(within(form).getByRole('alert').textContent).toBe(
      'Say what the limit is, in a sentence.',
    );
    expect(calls.review).not.toHaveBeenCalled();
  });
});

describe('the provisional and the clear treatment', () => {
  it('carries the provisional label in words, and lets the person confirm the review once nothing waits', async () => {
    const reviewed = setOf([applied, confirmed], { reviewedAt: null });
    const { calls, user } = mount(viewOf(reviewed, gate()));
    const section = screen.getByRole('region', { name: 'Constraint coverage' });
    expect(within(section).getByText('Provisional', { selector: '.sw-chip' })).toBeTruthy();
    expect(within(section).getByRole('status').textContent).toContain(
      'Treat what it shows as conditional on them.',
    );
    const confirm = screen.getByRole('button', { name: 'Confirm the review' });
    expect(confirm.hasAttribute('disabled')).toBe(false);
    await user.click(confirm);
    expect(calls.review).toHaveBeenCalledWith({ action: 'confirm-set' });
  });

  it('is clear only in words that do not claim there are no limits, and offers the way on', async () => {
    const onSimulate = vi.fn();
    const clear = gate({
      status: 'clear',
      reviewed: true,
      label: null,
      summary: 'Clear: every constraint is confirmed.',
      known: [{ id: 'c-budget', category: 'budget', hardness: 'hard', statement: 'x' }],
    });
    const { user } = mount(
      viewOf(setOf([applied, confirmed], { reviewedAt: NOW }), clear),
      {},
      { onSimulate },
    );
    expect(screen.getByText('Clear: every constraint is confirmed.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Review confirmed' }).hasAttribute('disabled')).toBe(
      true,
    );
    await user.click(screen.getByRole('button', { name: 'Go to the simulation' }));
    expect(onSimulate).toHaveBeenCalledOnce();
  });

  it('says the review is out of date when the scenario or the actors changed, and lets it be confirmed again', async () => {
    const clear = gate({
      status: 'provisional',
      reviewed: true,
      label: null,
      summary: 'Provisional: a simulation may run, and says so.',
    });
    const { calls, user } = mount(
      viewOf(setOf([confirmed], { reviewedAt: NOW }), clear, {
        stale: { scenario: true, actors: false },
      }),
    );
    expect(screen.getByText(/read against an earlier version of the scenario/u)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Confirm the review again' }));
    expect(calls.review).toHaveBeenCalledWith({ action: 'confirm-set' });
  });

  it('measures which applied constraint moves the simulated result most, and says it is the simulation’s', async () => {
    const withActors = setOf([applied, confirmed], { reviewedAt: NOW });
    const { calls, user, rerender } = mount(viewOf(withActors, gate({ reviewed: true })));
    await user.click(screen.getByRole('button', { name: 'Find the constraint that matters most' }));
    expect(calls.measure).toHaveBeenCalledOnce();
    const { state } = stateOf(viewOf(withActors, gate({ reviewed: true })), {
      sensitivity: {
        impact: {
          constraintId: 'c-cost',
          variantId: 'proposed-change',
          metric: 'Simulated share',
          seeds: 8,
          withMean: 0.4,
          withoutShift: 0.13,
          standardError: 0.01,
          classification: 'material',
        },
      },
    });
    rerender(
      <ConstraintsPage state={state} onView={() => undefined} onSimulate={() => undefined} />,
    );
    expect(
      screen.getByText(/Taking away “Resellers cannot absorb more than ten extra cases a week\.”/u)
        .textContent,
    ).toContain(
      'by +13 points (moves the result), on 8 paired seeds. It is a result of the simulation, not of the world.',
    );
  });
});

describe('what Swarm still has to ask', () => {
  const asked = [
    question('q-a', 'contractual', 'Do any contracts or commitments bind the change?'),
    question('q-b', 'reversibility', 'Could the change be undone if it goes badly?'),
    question('q-c', 'privacy', 'Does the change touch personal data?'),
    question('q-d', 'time', 'Is there a deadline?'),
  ];
  const set = setOf([confirmed], { clarifications: asked });

  it('puts three questions at a time, says that more wait, and shows what each could change', () => {
    const open = viewOf(set, gate(), { open: asked.slice(0, 3) });
    mount(open);
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'We found three missing constraints that could materially change the outcome.',
      }),
    ).toBeTruthy();
    const list = screen
      .getAllByRole('listitem')
      .filter((item) => item.className.includes('sw-cask__item'));
    expect(list).toHaveLength(3);
    expect(screen.getByText(/1 more is waiting\./u)).toBeTruthy();
    expect(
      within(list[0]!).getByText(
        /Why it is asked: It could change which alternative comes out ahead\./u,
      ),
    ).toBeTruthy();
  });

  it('offers exactly four things to do with a question, and sends each as the person’s own act', async () => {
    const { calls, user } = mount(viewOf(set, gate(), { open: asked.slice(0, 3) }));
    const first = screen.getByRole('group', {
      name: 'Respond: Do any contracts or commitments bind the change?',
    });
    expect(
      within(first)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Answer', 'Mark unknown', 'Use an assumption', 'Exclude']);
    await user.click(within(first).getByRole('button', { name: 'Mark unknown' }));
    expect(calls.review).toHaveBeenLastCalledWith({
      action: 'mark-unknown',
      clarificationId: 'q-a',
    });
    await user.click(within(first).getByRole('button', { name: 'Use an assumption' }));
    expect(calls.review).toHaveBeenLastCalledWith({
      action: 'use-assumption',
      clarificationId: 'q-a',
    });
    await user.click(within(first).getByRole('button', { name: 'Exclude' }));
    expect(calls.review).toHaveBeenLastCalledWith({ action: 'exclude', clarificationId: 'q-a' });
  });

  it('turns an answer into a constraint of the person’s own', async () => {
    const { calls, user } = mount(viewOf(set, gate(), { open: asked.slice(0, 3) }));
    const first = screen.getByRole('group', { name: /Respond: Do any contracts/u });
    await user.click(within(first).getByRole('button', { name: 'Answer' }));
    const form = await screen.findByRole('form', { name: /Answer: Do any contracts/u });
    await user.type(
      within(form).getByLabelText('What is the limit?'),
      'The vendor contract needs ninety days of notice.',
    );
    await user.click(within(form).getByRole('radio', { name: /Hard/u }));
    await user.click(within(form).getByRole('button', { name: 'Save as a constraint' }));
    expect(calls.review).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'answer',
        clarificationId: 'q-a',
        constraint: expect.objectContaining({
          category: 'contractual',
          statement: 'The vendor contract needs ninety days of notice.',
          hardness: 'hard',
        }),
      }),
    );
  });

  it('shows nothing to ask when nothing is open, and no buttons to a reader', () => {
    mount(viewOf(set, gate(), { open: [] }));
    expect(screen.queryByRole('heading', { name: /missing constraints/u })).toBeNull();
    mount(viewOf(set, gate(), { open: asked.slice(0, 1), may: { edit: false, run: false } }));
    expect(screen.queryByRole('button', { name: 'Mark unknown' })).toBeNull();
  });
});

describe('the views of the proposed change', () => {
  const views: CounterfactualsView = {
    current: true,
    may: { run: true },
    counterfactuals: counterfactualSetSchema.parse({
      version: 1,
      generatedAt: NOW,
      variantId: 'proposed-change',
      variantLabel: 'Proposed change',
      metric:
        'Simulated share of members ending in switch or resist (each actor counts equally), 12 paired seeds',
      seeds: 12,
      baseMean: 0.4,
      inputs: { constraints: 3, actors: 2, scenario: 1 },
      views: [
        {
          id: 'without-budget',
          label: 'Without the budget constraint',
          change: 'The budget constraints the simulation applies are taken away.',
          applicable: true,
          deltaVsBase: -0.08,
          standardError: 0.01,
          classification: 'material',
          driver: 'Budget constraint: Spending is capped.',
          driverConstraintIds: ['c-a'],
        },
        {
          id: 'dependency-fails',
          label: 'A critical dependency fails',
          change: 'What the change depends on fails.',
          applicable: false,
          reason: 'No dependency is among the constraints, so there is nothing that can fail.',
          driver: '',
        },
      ],
    }),
  };

  it('runs them on request, shows each difference with its sign, and says why one was not run', async () => {
    const set = setOf([applied], { reviewedAt: NOW });
    const { calls, user } = mount(viewOf(set, gate({ reviewed: true })), {
      counterfactuals: views,
    });
    await user.click(screen.getByRole('button', { name: /What if one thing were different/u }));
    const table = screen.getByRole('table');
    expect(within(table).getByText('−8 points')).toBeTruthy();
    expect(within(table).getByText('Moves the result')).toBeTruthy();
    expect(
      within(table).getByText(/Not run: No dependency is among the constraints/u),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Run the views again' }));
    expect(calls.runViews).toHaveBeenCalledOnce();
  });

  it('says when what they were made from has changed, and when a reader cannot run them', async () => {
    const set = setOf([applied], { reviewedAt: NOW });
    const old = { ...views, current: false };
    const { user } = mount(
      viewOf(set, gate({ reviewed: true }), { may: { edit: false, run: false } }),
      { counterfactuals: old },
    );
    await user.click(screen.getByRole('button', { name: /What if one thing were different/u }));
    expect(screen.getByText('Made from earlier constraints')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Run the views/u })).toBeNull();
  });
});

describe('on a phone and for the keyboard', () => {
  it('has one heading to start from, a switch that says where it is, and no control without a name', async () => {
    setMedia('(max-width: 40rem)', true);
    const onView = vi.fn();
    const { user, container } = mount(
      viewOf(
        setOf([hardLegal, guess, confirmed]),
        gate({ status: 'blocked', label: null, summary: 'Blocked: x.' }),
      ),
      {},
      { onView },
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
    const switcher = screen.getByRole('radiogroup', { name: 'Show as' });
    expect(
      within(switcher).getByRole('radio', { name: 'Constraints' }).getAttribute('aria-checked'),
    ).toBe('true');
    await user.click(within(switcher).getByRole('radio', { name: 'Map' }));
    expect(onView).toHaveBeenCalledWith('map');
    for (const button of container.querySelectorAll('button')) {
      expect(
        (button.textContent ?? '').trim() || button.getAttribute('aria-label'),
        button.outerHTML,
      ).toBeTruthy();
    }
  });

  it('keeps the honest line at the foot, whatever the state', () => {
    mount(viewOf(setOf([guess]), gate()));
    expect(
      screen.getByText(/An inferred constraint is a suggestion until you confirm it\./u),
    ).toBeTruthy();
    expect(screen.getByText(/Simulated results are not forecasts\./u)).toBeTruthy();
  });

  it('says what was refused, where the person is looking, and can be dismissed', async () => {
    const { calls, user } = mount(viewOf(setOf([guess]), gate()), {
      problem: 'The constraints changed while you were looking at them.',
    });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('That was not saved');
    await user.click(within(alert).getByRole('button', { name: 'Dismiss' }));
    expect(calls.dismissProblem).toHaveBeenCalledOnce();
  });
});
