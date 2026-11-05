// @vitest-environment jsdom
import type { UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scenarioFixture } from '../../../../shared/lab-fixtures';
import type { ScenarioFrame, ScenarioParseResult } from '../../../../shared/scenario';
import type { AppConfig, CreateProjectInput } from '../../../../shared/types';
import type { UrlEvidenceResult } from '../../api/evidence';
import { fireEvent, renderWithApp, screen, waitFor, within } from '../../test/dom';
import { projectFixture } from '../../test/project';
import { AskScene, type AskSceneProps } from './AskScene';
import { EXAMPLE_SCENARIOS, exampleLabel } from './examples';

// A person's actions drive the real components; only the network is replaced. Every call that could leave
// the page is a spy here, and `fetch` itself refuses, so a request that is not one of them fails the test.
const net = vi.hoisted(() => ({
  parse: vi.fn(),
  fetchUrl: vi.fn(),
  extractDataFile: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock('../../api/scenario', () => ({ scenarioApi: { parse: net.parse } }));
vi.mock('../../api/evidence', () => ({
  evidenceApi: { fetchUrl: net.fetchUrl, extractDataFile: net.extractDataFile },
}));

beforeEach(() => {
  for (const spy of Object.values(net)) spy.mockReset();
  net.fetch.mockRejectedValue(new Error('A request that no test expected'));
  vi.stubGlobal('fetch', net.fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  expect(net.fetch).not.toHaveBeenCalled();
});

const QUESTION = 'What if the harbour doubles its fee?';
const NOTES =
  'The harbour office sets the mooring fee for visiting boats each spring, once the council has agreed its budget.';

const CONFIG: AppConfig = {
  version: 'test',
  provider: {
    name: 'azure',
    model: 'fixture-model',
    configured: true,
    reason: 'Configured.',
    auth: 'entra',
  },
  limits: {
    maxDocuments: 10,
    maxDocumentChars: 40_000,
    maxTotalChars: 200_000,
    maxProjects: 100,
    maxQueuedRuns: 4,
    localMaxAgents: 24,
    localMaxRounds: 24,
    modelMaxAgents: 10,
    modelMaxRounds: 10,
    maxPdfBytes: 2_000_000,
    maxPdfPages: 40,
    maxSurveyTargets: 3,
  },
  sourceUrl: null,
  urlIngestion: true,
  capabilities: {
    local: true,
    modelAssisted: true,
    fileTypes: ['txt', 'md'],
    pdf: false,
    webRetrieval: false,
    guidedConsole: true,
    surveys: false,
    whatIf: false,
    authentication: 'local-single-user',
  },
};

/** What a reading by rules gives, with some structure to edit and no questions left open. */
const scenario = (patch: Partial<ScenarioFrame> = {}): ScenarioFrame =>
  scenarioFixture({
    origin: 'rules',
    ambiguities: [],
    changes: [
      { name: 'First change', from: 'now', to: 'later', note: '' },
      { name: 'Second change', from: null, to: null, note: '' },
    ],
    alternatives: [
      { id: 'option-1', label: 'First alternative', description: '', changes: [] },
      { id: 'option-2', label: 'Second alternative', description: '', changes: [] },
    ],
    ...patch,
  });

const reading = (frame: ScenarioFrame, mode: 'rules' | 'model' = 'rules'): ScenarioParseResult => ({
  frame,
  mode,
  model: mode === 'model' ? 'fixture-model' : null,
  notes: ['Read by a fixture.'],
});

const page = (patch: Partial<UrlEvidenceResult['document']> = {}): UrlEvidenceResult => ({
  document: {
    name: 'harbour.example.org - Mooring fees.txt',
    content: `Title: Mooring fees\n\nThe fee for a visiting boat is set each spring. ${'It is paid on arrival. '.repeat(20)}`,
    provenance: {
      kind: 'url',
      url: 'https://harbour.example.org/fees',
      finalUrl: 'https://harbour.example.org/fees',
      retrievedAt: '2026-10-31T09:41:00.000Z',
      contentType: 'text/html',
      title: 'Mooring fees',
      fetchedByServer: true,
    },
    ...patch,
  },
  notes: ['Retrieved public evidence. Swarm has not checked that it is true.'],
});

function renderAsk(props: Partial<AskSceneProps> = {}) {
  const onSubmit = vi.fn(async (_input: CreateProjectInput) => undefined);
  const view = renderWithApp(
    <AskScene
      config={CONFIG}
      busy={false}
      onSubmit={onSubmit}
      history={{ projects: [], loading: false, error: null }}
      onOpenProject={vi.fn()}
      onRetryHistory={vi.fn()}
      onHistory={vi.fn()}
      mode="guided"
      {...props}
    />,
  );
  return { ...view, onSubmit };
}

const questionBox = () =>
  screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Your what-if question' });
const explore = () => screen.getByRole('button', { name: 'Explore' });
const evidenceMenu = () => screen.findByRole('dialog', { name: 'Add evidence' });
const menuClosed = () =>
  waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add evidence' })).toBeNull());

/** Opens the evidence menu on the way in: the button that says how many sources are attached. */
async function openEvidence(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: /^Evidence(?: \d+ attached)?$/u }));
  return evidenceMenu();
}

async function pasteSource(user: UserEvent, text = NOTES) {
  const menu = await openEvidence(user);
  await user.click(within(menu).getByRole('radio', { name: 'Paste' }));
  await user.click(within(menu).getByRole('textbox', { name: 'Source text, not your question' }));
  await user.paste(text);
  await user.click(within(menu).getByRole('button', { name: 'Attach' }));
  await user.click(within(menu).getByRole('button', { name: 'Done' }));
  await menuClosed();
}

async function chooseEngine(user: UserEvent, engine: 'Local rules' | 'Model assisted') {
  await user.click(screen.getByRole('button', { name: 'Options' }));
  const options = await screen.findByRole('dialog', { name: 'Options' });
  await user.click(within(options).getByRole('radio', { name: engine }));
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Options' })).toBeNull());
}

/** What a person does before asking for a reading: the question, and a source behind it. */
async function compose(user: UserEvent, question = QUESTION) {
  // Pasted: typing is slow, and is not the point of most of these.
  await user.click(questionBox());
  await user.paste(question);
  await pasteSource(user);
}

const groundIt = () => screen.findByRole('button', { name: 'Ground it' });

async function inReview(frame = scenario(), mode: 'rules' | 'model' = 'rules') {
  net.parse.mockResolvedValue(reading(frame, mode));
  const view = renderAsk();
  await compose(view.user);
  await view.user.click(explore());
  await groundIt();
  return view;
}

/** The names of the buttons that open the text of the rows of a list, in order. */
const rowNames = (inside: HTMLElement, pattern: RegExp) =>
  within(inside)
    .queryAllByRole('button', { name: pattern })
    .map((button) => button.getAttribute('aria-label') ?? '');

const section = (title: string): HTMLElement =>
  screen.getByRole('heading', { level: 3, name: title }).closest('section')!;

describe('asking for a reading', () => {
  it.each([
    ['Local rules', false, 'the button', 'Explore'],
    ['Local rules', false, 'Ctrl+Enter', '{Control>}{Enter}{/Control}'],
    ['Model assisted', true, 'the button', 'Explore'],
    ['Model assisted', true, 'Cmd+Enter', '{Meta>}{Enter}{/Meta}'],
  ] as const)(
    'in %s mode the question is read with useModel %s, asked with %s',
    async (engine, useModel, _how, press) => {
      net.parse.mockResolvedValue(reading(scenario(), useModel ? 'model' : 'rules'));
      const { user } = renderAsk();
      await user.type(questionBox(), QUESTION);
      await pasteSource(user);
      await chooseEngine(user, engine);
      expect(net.parse).not.toHaveBeenCalled();

      if (press === 'Explore') await user.click(explore());
      else {
        await user.click(questionBox());
        await user.keyboard(press);
      }
      await groundIt();

      expect(net.parse).toHaveBeenCalledTimes(1);
      const [question, documents, , sentToModel] = net.parse.mock.calls[0]!;
      expect(question).toBe(QUESTION);
      // Only the name, the size and the start of each text go: never the whole source.
      expect(documents).toEqual([{ name: 'notes.txt', characters: NOTES.length, excerpt: NOTES }]);
      expect(sentToModel).toBe(useModel);
      expect(
        screen.getByText(
          useModel ? /Read by a model · fixture-model/u : /Read by rules, not a model/u,
        ),
      ).toBeTruthy();
    },
  );

  it('reads with rules, and sends the question to no model, when the person chose nothing though a model is there to be chosen', async () => {
    net.parse.mockResolvedValue(reading(scenario()));
    const { user } = renderAsk();
    await compose(user);
    await user.click(explore());
    await groundIt();
    expect(net.parse).toHaveBeenCalledTimes(1);
    expect(net.parse.mock.calls[0]![3]).toBe(false);
  });

  it('stops sending the question to a model when the person goes back to rules', async () => {
    net.parse.mockResolvedValue(reading(scenario()));
    const { user } = renderAsk();
    await compose(user);
    await chooseEngine(user, 'Model assisted');
    await chooseEngine(user, 'Local rules');
    await user.click(explore());
    await groundIt();
    expect(net.parse.mock.calls[0]![3]).toBe(false);
  });

  it('says where the question goes before it goes: nowhere with rules, to the provider with a model', async () => {
    const { user } = renderAsk();
    await user.click(screen.getByRole('button', { name: 'Options' }));
    const options = await screen.findByRole('dialog', { name: 'Options' });
    expect(within(options).getByText(/Nothing is sent anywhere/u)).toBeTruthy();
    await user.click(within(options).getByRole('radio', { name: 'Model assisted' }));
    expect(
      within(options).getByText(/question and evidence context are sent to this provider/u),
    ).toBeTruthy();
    expect(net.parse).not.toHaveBeenCalled();
  });

  it('cannot be switched to a model that the server is not set up to use', async () => {
    const { user } = renderAsk({
      config: {
        ...CONFIG,
        capabilities: { ...CONFIG.capabilities, modelAssisted: false },
        provider: { ...CONFIG.provider, configured: false },
      },
    });
    await user.click(screen.getByRole('button', { name: 'Options' }));
    const options = await screen.findByRole('dialog', { name: 'Options' });
    const model = within(options).getByRole<HTMLButtonElement>('radio', { name: 'Model assisted' });
    expect(model.disabled).toBe(true);
    expect(
      within(options)
        .getByRole<HTMLButtonElement>('radio', { name: 'Local rules' })
        .getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('asks nothing until it is asked, however much has been written', async () => {
    const { user } = renderAsk();
    await compose(user);
    expect(net.parse).not.toHaveBeenCalled();
  });

  describe('who reads the question, said where the question is written', () => {
    const engine = () => screen.getByRole('radiogroup', { name: 'How it is read' });
    const choice = (name: 'Rules only' | 'Model-assisted') =>
      // The name of an option begins with its label and goes on to say where the question goes.
      within(engine()).getByRole<HTMLButtonElement>('radio', { name: new RegExp(`^${name}`, 'u') });
    const modelByDefault: AppConfig = {
      ...CONFIG,
      capabilities: { ...CONFIG.capabilities, defaultEngine: 'llm' },
    };

    it('is beside the evidence and Options, not behind them, and starts on rules, which send nothing anywhere', () => {
      renderAsk();
      expect(choice('Rules only').getAttribute('aria-checked')).toBe('true');
      expect(choice('Model-assisted').getAttribute('aria-checked')).toBe('false');
      expect(choice('Model-assisted').disabled).toBe(false);
      expect(screen.getByText('Stays on this server')).toBeTruthy();
    });

    it('sends the question to the model once the person chooses it, and says where it goes', async () => {
      net.parse.mockResolvedValue(reading(scenario(), 'model'));
      const { user } = renderAsk();
      await compose(user);
      await user.click(choice('Model-assisted'));
      expect(choice('Model-assisted').getAttribute('aria-checked')).toBe('true');
      expect(screen.getByText('Sent to Azure AI')).toBeTruthy();
      await user.click(explore());
      await groundIt();
      expect(net.parse.mock.calls[0]![3]).toBe(true);
    });

    it('is one choice with the Engine in Options: changing either changes both', async () => {
      const { user } = renderAsk();
      await chooseEngine(user, 'Model assisted');
      expect(choice('Model-assisted').getAttribute('aria-checked')).toBe('true');
      await user.click(choice('Rules only'));
      await user.click(screen.getByRole('button', { name: 'Options' }));
      const options = await screen.findByRole('dialog', { name: 'Options' });
      expect(
        within(options).getByRole('radio', { name: 'Local rules' }).getAttribute('aria-checked'),
      ).toBe('true');
    });

    it('starts on the model where the operator asked for it, with the choice still there to change', async () => {
      net.parse.mockResolvedValue(reading(scenario()));
      const { user } = renderAsk({ config: modelByDefault });
      expect(choice('Model-assisted').getAttribute('aria-checked')).toBe('true');
      await compose(user);
      await user.click(choice('Rules only'));
      await user.click(explore());
      await groundIt();
      expect(net.parse.mock.calls[0]![3]).toBe(false);
    });

    it('follows the server’s own answer when it arrives late, until the person has chosen', async () => {
      const first = renderAsk({ config: null });
      expect(choice('Rules only').getAttribute('aria-checked')).toBe('true');
      first.rerender(
        <AskScene
          config={modelByDefault}
          busy={false}
          onSubmit={first.onSubmit}
          history={{ projects: [], loading: false, error: null }}
          onOpenProject={vi.fn()}
          onRetryHistory={vi.fn()}
          onHistory={vi.fn()}
          mode="guided"
        />,
      );
      expect(choice('Model-assisted').getAttribute('aria-checked')).toBe('true');
      await first.user.click(choice('Rules only'));
      first.rerender(
        <AskScene
          config={{ ...modelByDefault }}
          busy={false}
          onSubmit={first.onSubmit}
          history={{ projects: [], loading: false, error: null }}
          onOpenProject={vi.fn()}
          onRetryHistory={vi.fn()}
          onHistory={vi.fn()}
          mode="guided"
        />,
      );
      // What the person chose is not undone by the server answering again.
      expect(choice('Rules only').getAttribute('aria-checked')).toBe('true');
    });

    it('never preselects a model the server is not set up to use, and says why it cannot be chosen', () => {
      renderAsk({
        config: {
          ...modelByDefault,
          capabilities: { ...modelByDefault.capabilities, modelAssisted: false },
          provider: { ...CONFIG.provider, configured: false, reason: 'No provider is set up.' },
        },
      });
      expect(choice('Rules only').getAttribute('aria-checked')).toBe('true');
      expect(choice('Model-assisted').disabled).toBe(true);
      expect(choice('Model-assisted').getAttribute('aria-label') ?? '').toContain(
        'No provider is set up.',
      );
    });
  });

  it('refuses a question that is too short, says so, and sends nothing', async () => {
    const { user } = renderAsk();
    await user.type(questionBox(), 'Too short');
    await pasteSource(user);

    await user.click(explore());
    expect((await screen.findByRole('status')).textContent).toContain(
      'Say a little more: a sentence is enough.',
    );
    expect(questionBox().getAttribute('aria-invalid')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(questionBox()));

    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(net.parse).not.toHaveBeenCalled();

    // Writing more takes the complaint away, and the question can then be read.
    net.parse.mockResolvedValue(reading(scenario()));
    await user.type(questionBox(), ' is not enough for a scenario');
    expect(screen.queryByText(/Say a little more/u)).toBeNull();
    await user.click(explore());
    await groundIt();
    expect(net.parse).toHaveBeenCalledTimes(1);
  });

  it('refuses to read a question that has no source behind it, and opens the way to add one', async () => {
    const { user } = renderAsk();
    await user.type(questionBox(), QUESTION);
    await user.click(explore());
    expect((await screen.findByRole('status')).textContent).toContain('Add a source to ground it');
    await evidenceMenu();
    expect(net.parse).not.toHaveBeenCalled();
  });

  it('fills the box from a sample case, with its evidence, and says what was loaded', async () => {
    const example = EXAMPLE_SCENARIOS[0]!;
    net.parse.mockResolvedValue(reading(scenario()));
    const { user } = renderAsk();
    expect(questionBox().value).toBe('');

    // Where a recorded demonstration is not held, the one way in is named for what it holds.
    expect(screen.queryByRole('button', { name: 'Try a recorded demonstration' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try a sample case' }));
    const cases = await screen.findByRole('dialog', { name: 'Try a sample case' });
    expect(
      within(cases)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toContain(exampleLabel(example));
    await user.click(within(cases).getByRole('button', { name: exampleLabel(example) }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Try a sample case' })).toBeNull(),
    );

    expect(questionBox().value).toBe(example.question);
    expect(
      within(screen.getByRole('list', { name: 'Attached evidence' })).getAllByRole('listitem'),
    ).toHaveLength(example.documents.length);
    expect(
      screen.getByRole('button', { name: `Evidence ${example.documents.length} attached` }),
    ).toBeTruthy();
    // The keyboard goes where the person writes, not back to the link that opened the list of cases.
    await waitFor(() => expect(document.activeElement).toBe(questionBox()));

    // The name begins with the words on the chip, as a name must (WCAG 2.5.3), and then says what pressing does.
    const note = screen.getByRole('button', {
      name: (name) => name.startsWith(`${example.title} · `) && name.endsWith('Dismiss this note'),
    });
    expect(note.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('list', { name: 'Start from a template' })).toBeNull();
    await user.click(note);
    expect(screen.getByRole('list', { name: 'Start from a template' })).toBeTruthy();
    expect(questionBox().value).toBe(example.question);

    // A person who then presses Explore is read what the sample case says, with its evidence.
    await user.click(explore());
    await groundIt();
    const [question, documents] = net.parse.mock.calls[0]!;
    expect(question).toBe(example.question);
    expect(documents).toHaveLength(example.documents.length);
  });

  it('asks nothing while something else is going on', () => {
    // A copied project fills the box, so that only the busy guard stands between it and a request.
    renderAsk({ busy: true, initialProject: projectFixture() });
    expect(questionBox().value).toBe(projectFixture().question);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Explore' }).disabled).toBe(true);
    expect(questionBox().disabled).toBe(true);
    fireEvent.submit(questionBox().closest('form')!);
    expect(net.parse).not.toHaveBeenCalled();
  });

  it('shows a reading that takes long, says whether a model is reading, and stops it on request', async () => {
    let signal: AbortSignal | undefined;
    net.parse.mockImplementation(
      (_question: string, _documents: unknown, given: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal = given;
          given.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')));
        }),
    );
    const { user } = renderAsk();
    await compose(user);
    await chooseEngine(user, 'Model assisted');
    await user.click(explore());

    expect(await screen.findByText('A model is reading your question')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Stop' }));

    expect(signal?.aborted).toBe(true);
    expect(await screen.findByRole('textbox', { name: 'Your what-if question' })).toBeTruthy();
    expect(questionBox().value).toBe(QUESTION);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says when a question could not be read, and offers to try again or to go on without a reading', async () => {
    net.parse.mockRejectedValueOnce(new Error('The reader is not available.'));
    const { user, onSubmit } = renderAsk();
    await compose(user);
    await user.click(explore());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The question could not be read');
    expect(alert.textContent).toContain('The reader is not available.');

    net.parse.mockResolvedValue(reading(scenario()));
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    await groundIt();
    expect(net.parse).toHaveBeenCalledTimes(2);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('goes on without a reading only when told to, and then sends no scenario', async () => {
    net.parse.mockRejectedValueOnce(new Error('The reader is not available.'));
    const { user, onSubmit } = renderAsk();
    await compose(user);
    await user.click(explore());
    await user.click(await screen.findByRole('button', { name: 'Continue without reading' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [input] = onSubmit.mock.calls[0]!;
    expect(input.question).toBe(QUESTION);
    expect(input.workflow).toBe('guided');
    expect(input.scenario).toBeUndefined();
  });
});

describe('the scenario that was read', () => {
  it('says how it was read, and that nothing runs until the person goes on', async () => {
    const { onSubmit } = await inReview();
    expect(screen.getByRole('heading', { level: 1, name: 'Your scenario' })).toBeTruthy();
    expect(screen.getByText('Read by rules, not a model')).toBeTruthy();
    expect(screen.getByText('Nothing runs until you continue.')).toBeTruthy();
    expect(screen.getByText(QUESTION)).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('adds an alternative: one more, the earlier ones as they were, and the new one ready to be named', async () => {
    const { user } = await inReview();
    const alternatives = () => rowNames(document.body, /^Alternative \d+ name:/u);
    const before = alternatives();
    expect(before).toEqual([
      'Alternative 1 name: First alternative. Edit',
      'Alternative 2 name: Second alternative. Edit',
    ]);

    await user.click(screen.getByRole('button', { name: 'Add a way' }));

    // The new one opens as a field that has focus, empty, and the others are untouched.
    const field = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Alternative 3 name' });
    expect(field.value).toBe('');
    expect(document.activeElement).toBe(field);
    expect(alternatives()).toEqual(before);

    await user.keyboard('A notice period{Enter}');
    expect(alternatives()).toEqual([...before, 'Alternative 3 name: A notice period. Edit']);
    expect(screen.getByRole('button', { name: 'Remove alternative 3' })).toBeTruthy();
    // From the first edit the scenario is the person's own, and it says so.
    expect(screen.getByText('Edited by you')).toBeTruthy();
    expect(screen.queryByText('Read by rules, not a model')).toBeNull();
  });

  it('removes a change: that row goes and the other stays', async () => {
    const { user } = await inReview();
    const changes = section('What changes');
    const names = () => rowNames(changes, /^Change \d+ name:/u);
    expect(names()).toEqual([
      'Change 1 name: First change. Edit',
      'Change 2 name: Second change. Edit',
    ]);

    await user.click(within(changes).getByRole('button', { name: 'Remove change 1' }));

    await waitFor(() =>
      expect(within(changes).queryAllByRole('button', { name: /^Remove change \d/u })).toHaveLength(
        1,
      ),
    );
    expect(names()).toEqual(['Change 1 name: Second change. Edit']);
    expect(changes.textContent).not.toContain('First change');
  });

  it('removes a change with the keyboard and leaves focus on the control that adds one, not on nothing', async () => {
    const { user } = await inReview();
    const changes = section('What changes');
    within(changes).getByRole('button', { name: 'Remove change 1' }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(within(changes).queryAllByRole('button', { name: /^Remove change \d/u })).toHaveLength(
        1,
      ),
    );
    expect(document.activeElement).toBe(
      within(changes).getByRole('button', { name: 'Add change' }),
    );
  });

  it('adds a change, and takes focus to its name', async () => {
    const { user } = await inReview();
    const changes = section('What changes');
    await user.click(within(changes).getByRole('button', { name: 'Add change' }));
    const field = within(changes).getByRole('textbox', { name: 'Change 3 name' });
    expect(document.activeElement).toBe(field);
    await user.keyboard('A notice period{Enter}');
    expect(rowNames(changes, /^Change \d name:/u)).toContain(
      'Change 3 name: A notice period. Edit',
    );
  });

  it('adds a group that is affected, and takes one away', async () => {
    const { user, onSubmit } = await inReview();
    const groups = section('Who is affected');
    const names = () => rowNames(groups, /^Group \d+:/u);
    expect(names()).toEqual([
      'Group 1: subscribers. Edit',
      'Group 2: rival provider. Edit',
      'Group 3: regulator. Edit',
    ]);

    await user.type(
      within(groups).getByRole('textbox', { name: 'Add to group' }),
      'harbour office{Enter}',
    );
    expect(names()).toEqual([
      'Group 1: subscribers. Edit',
      'Group 2: rival provider. Edit',
      'Group 3: regulator. Edit',
      'Group 4: harbour office. Edit',
    ]);
    expect(
      within(groups).getByRole<HTMLInputElement>('textbox', { name: 'Add to group' }).value,
    ).toBe('');

    await user.click(within(groups).getByRole('button', { name: 'Remove rival provider' }));
    await waitFor(() => expect(groups.textContent).not.toContain('rival provider'));
    expect(names()).toEqual([
      'Group 1: subscribers. Edit',
      'Group 2: regulator. Edit',
      'Group 3: harbour office. Edit',
    ]);
    // Adding a group is not going on: nothing was started.
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('adds an assumption of the person’s own, and what the person changes becomes theirs', async () => {
    const { user } = await inReview(
      scenario({
        assumptions: [{ id: 'assumption-1', text: 'Demand stays flat.', origin: 'system' }],
      }),
    );
    const assumed = section('Assumed');
    const origins = () =>
      within(assumed)
        .getAllByRole('img')
        .map((dot) => dot.getAttribute('aria-label'));
    expect(origins()).toEqual(['System assumption']);

    await user.click(within(assumed).getByRole('button', { name: 'Add an assumption' }));
    expect(document.activeElement).toBe(
      within(assumed).getByRole('textbox', { name: 'Assumption 2' }),
    );
    await user.keyboard('Visitors still come{Control>}{Enter}{/Control}');
    expect(
      within(assumed).getByRole('button', { name: 'Assumption 2: Visitors still come. Edit' }),
    ).toBeTruthy();
    expect(origins()).toEqual(['System assumption', 'Yours']);

    await user.click(within(assumed).getByRole('button', { name: /^Assumption 1: / }));
    await user.keyboard(' Mostly.{Control>}{Enter}{/Control}');
    expect(origins()).toEqual(['Yours', 'Yours']);

    await user.click(within(assumed).getByRole('button', { name: 'Remove assumption 1' }));
    await waitFor(() => expect(assumed.textContent).not.toContain('Demand stays flat'));
    expect(origins()).toEqual(['Yours']);
  });

  it('keeps an edit of the decision: shown, there again when read, and in the scenario that is created', async () => {
    const wanted = 'Double the mooring fee from the first of June';
    const { user, onSubmit } = await inReview();
    await user.click(screen.getByRole('button', { name: /^The decision or event: .* Edit$/u }));
    const field = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'The decision or event',
    });
    expect(document.activeElement).toBe(field);
    await user.clear(field);
    await user.type(field, wanted);
    // A decision may run to several lines, so Enter adds a line and Ctrl+Enter keeps the change.
    await user.keyboard('{Control>}{Enter}{/Control}');

    const kept = screen.getByRole('button', { name: `The decision or event: ${wanted}. Edit` });
    expect(document.activeElement).toBe(kept);
    expect(screen.getByText('Edited by you')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Ground it' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [input] = onSubmit.mock.calls[0]!;
    expect(input.scenario?.decision).toBe(wanted);
    expect(input.scenario?.origin).toBe('user');
    // What else was read comes along as it was.
    expect(input.scenario?.changes?.map((change) => change.name)).toEqual([
      'First change',
      'Second change',
    ]);
    expect(input.scenario?.alternatives?.map((alternative) => alternative.label)).toEqual([
      'First alternative',
      'Second alternative',
    ]);
    expect(input.question).toBe(QUESTION);
    expect(input.workflow).toBe('guided');
    expect(input.documents.map((document) => document.name)).toEqual(['notes.txt']);
  });

  it('drops an edit that is abandoned with Escape, and keeps one that is left with a click elsewhere', async () => {
    const { user } = await inReview();
    const original = 'The fee stays as it is.';
    await user.click(
      screen.getByRole('button', { name: /^What is expected without the change:/u }),
    );
    await user.keyboard('Something else{Escape}');
    expect(
      screen.getByRole('button', {
        name: `What is expected without the change: ${original}. Edit`,
      }),
    ).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /^Where: /u }));
    await user.clear(screen.getByRole('textbox', { name: 'Where' }));
    await user.keyboard('The harbour only');
    await user.click(document.body);
    expect(screen.getByRole('button', { name: 'Where: The harbour only. Edit' })).toBeTruthy();
  });

  it('will not go on with a scenario that has no decision, and says what is missing', async () => {
    const { user, onSubmit } = await inReview();
    await user.click(screen.getByRole('button', { name: /^The decision or event: .* Edit$/u }));
    await user.clear(screen.getByRole('textbox', { name: 'The decision or event' }));
    await user.keyboard('{Control>}{Enter}{/Control}');

    expect(screen.getByText('Say what decision or event you want to explore.')).toBeTruthy();
    const go = screen.getByRole<HTMLButtonElement>('button', { name: 'Ground it' });
    expect(go.disabled).toBe(true);
    await user.click(go);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('answers a question that Swarm asked back, which goes where it belongs and goes away', async () => {
    const asked = scenario({
      geography: null,
      ambiguities: [
        {
          field: 'geography',
          message: 'Where does the fee apply?',
          question: 'Where does the fee apply?',
        },
      ],
    });
    const { user } = await inReview(asked);
    const answer = screen.getByRole('textbox', { name: 'Your answer to question 1' });
    const send = screen.getByRole<HTMLButtonElement>('button', { name: 'Answer' });
    expect(send.disabled).toBe(true);
    await user.type(answer, 'The inner harbour');
    await user.click(send);

    await waitFor(() => expect(screen.queryByText('Where does the fee apply?')).toBeNull());
    expect(screen.getByRole('button', { name: 'Where: The inner harbour. Edit' })).toBeTruthy();
  });

  it('goes back to the question, and a question left as it was is not read a second time', async () => {
    const { user } = await inReview();
    await user.click(screen.getByRole('button', { name: 'Question' }));
    await screen.findByRole('textbox', { name: 'Your what-if question' });
    expect(questionBox().value).toBe(QUESTION);

    await user.click(explore());
    await groundIt();
    expect(net.parse).toHaveBeenCalledTimes(1);
  });

  it('puts focus in the question when going back to it', async () => {
    const { user } = await inReview();
    await user.click(screen.getByRole('button', { name: 'Question' }));
    await screen.findByRole('textbox', { name: 'Your what-if question' });
    await waitFor(() => expect(document.activeElement).toBe(questionBox()), { timeout: 800 });
  });

  it('reads a question that was changed again, and shows that reading instead of the old one', async () => {
    const { user } = await inReview();
    await user.click(screen.getByRole('button', { name: 'Question' }));
    await screen.findByRole('textbox', { name: 'Your what-if question' });
    await user.type(questionBox(), ' Over two seasons.');

    net.parse.mockResolvedValue(
      reading(scenario({ decision: 'Whether to double the fee for two seasons' })),
    );
    await user.click(explore());
    await screen.findByRole('button', {
      name: 'The decision or event: Whether to double the fee for two seasons. Edit',
    });
    expect(net.parse).toHaveBeenCalledTimes(2);
    expect(net.parse.mock.calls[1]![0]).toBe(`${QUESTION} Over two seasons.`);
  });

  it('puts the person where the scenario is when it appears, so that a keyboard is never left on nothing', async () => {
    const { container } = await inReview();
    expect(container.contains(document.activeElement)).toBe(true);
  });

  describe('the sources behind a reading', () => {
    const OTHER = `${NOTES} The council meets on the first Tuesday of each month.`;
    const MORE = ' It is paid on arrival.';
    const corrected = 'Double the mooring fee from the first of June';

    /** What the person writes over the decision that was read: theirs, and not to be lost to a reading that is the same. */
    async function correctTheDecision(user: UserEvent) {
      await user.click(screen.getByRole('button', { name: /^The decision or event: .* Edit$/u }));
      const field = screen.getByRole<HTMLTextAreaElement>('textbox', {
        name: 'The decision or event',
      });
      await user.clear(field);
      await user.type(field, corrected);
      await user.keyboard('{Control>}{Enter}{/Control}');
      await screen.findByRole('button', { name: `The decision or event: ${corrected}. Edit` });
    }
    async function backToTheQuestion(user: UserEvent) {
      await user.click(screen.getByRole('button', { name: 'Question' }));
      await screen.findByRole('textbox', { name: 'Your what-if question' });
    }
    async function takeAway(user: UserEvent, name: string) {
      const tray = screen.getByRole('list', { name: 'Attached evidence' });
      await user.click(within(tray).getByRole('button', { name: `Remove ${name}` }));
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: `Remove ${name}` })).toBeNull(),
      );
    }
    async function correctSource(user: UserEvent) {
      await user.click(screen.getByRole('button', { name: /^Read notes\.txt/u }));
      const sheet = await screen.findByRole('dialog', { name: 'notes.txt' });
      await user.type(
        within(sheet).getByRole('textbox', { name: 'The text Swarm will work from' }),
        MORE,
      );
      await user.click(within(sheet).getByRole('button', { name: 'Done' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'notes.txt' })).toBeNull());
    }

    it('keeps the reading, with what the person corrected in it, while its sources are as they were', async () => {
      const { user } = await inReview();
      await correctTheDecision(user);
      await backToTheQuestion(user);

      // A source taken away and attached again as it was changes nothing that a reading is made from.
      await takeAway(user, 'notes.txt');
      await pasteSource(user);
      await user.click(explore());
      await groundIt();

      expect(net.parse).toHaveBeenCalledTimes(1);
      expect(
        screen.getByRole('button', { name: `The decision or event: ${corrected}. Edit` }),
      ).toBeTruthy();
    });

    it.each([
      [
        'another source is attached',
        (user: UserEvent) => pasteSource(user, OTHER),
        [
          { name: 'notes.txt', characters: NOTES.length, excerpt: NOTES },
          { name: 'notes-2.txt', characters: OTHER.length, excerpt: OTHER },
        ],
      ],
      [
        'a source is corrected',
        correctSource,
        [{ name: 'notes.txt', characters: NOTES.length + MORE.length, excerpt: NOTES + MORE }],
      ],
      [
        'a source is taken away and another attached',
        async (user: UserEvent) => {
          await takeAway(user, 'notes.txt');
          await pasteSource(user, OTHER);
        },
        [{ name: 'notes.txt', characters: OTHER.length, excerpt: OTHER }],
      ],
    ])(
      'reads again when %s, from the sources as they are now, and shows that reading instead of the old one',
      async (_what, change, sources) => {
        const { user } = await inReview(scenario({ decision: 'The first reading' }));
        await correctTheDecision(user);
        await backToTheQuestion(user);
        await change(user);

        net.parse.mockResolvedValue(reading(scenario({ decision: 'The second reading' })));
        await user.click(explore());
        await screen.findByRole('button', {
          name: 'The decision or event: The second reading. Edit',
        });

        expect(net.parse).toHaveBeenCalledTimes(2);
        expect(net.parse.mock.calls[1]![1]).toEqual(sources);
        expect(screen.queryByText(corrected)).toBeNull();
      },
    );
  });

  it('shows why the scenario could not be started, and can be started again', async () => {
    const { user, onSubmit } = await inReview();
    onSubmit.mockRejectedValueOnce(new Error('The server is full. Try again later.'));
    await user.click(screen.getByRole('button', { name: 'Ground it' }));
    expect(await screen.findByText('The server is full. Try again later.')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Ground it' }).disabled).toBe(
      false,
    );

    await user.click(screen.getByRole('button', { name: 'Ground it' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
  });
});

describe('the evidence menu', () => {
  it('attaches pasted text as a source, and takes it away again', async () => {
    const { user } = renderAsk();
    expect(screen.getByRole('button', { name: 'Evidence' })).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Attached evidence' })).toBeNull();

    await pasteSource(user);

    const tray = screen.getByRole('list', { name: 'Attached evidence' });
    expect(
      within(tray).getByRole('button', { name: `Read notes.txt, ${NOTES.length} characters` }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Evidence 1 attached' })).toBeTruthy();

    // The next pasted source does not take the name of the first.
    await pasteSource(user, `${NOTES} It is paid on arrival.`);
    expect(within(tray).getByRole('button', { name: /^Read notes-2\.txt/u })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Evidence 2 attached' })).toBeTruthy();

    await user.click(within(tray).getByRole('button', { name: 'Remove notes.txt' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Evidence 1 attached' })).toBeTruthy(),
    );
    await waitFor(() =>
      expect(within(tray).queryByRole('button', { name: /^Read notes\.txt/u })).toBeNull(),
    );
    expect(within(tray).getByRole('button', { name: /^Read notes-2\.txt/u })).toBeTruthy();

    await user.click(within(tray).getByRole('button', { name: 'Remove notes-2.txt' }));
    await waitFor(() =>
      expect(screen.queryByRole('list', { name: 'Attached evidence' })).toBeNull(),
    );
    expect(screen.getByRole('button', { name: 'Evidence' })).toBeTruthy();
  });

  it('does not attach text that is too short to be a source, and says why', async () => {
    const { user } = renderAsk();
    const menu = await openEvidence(user);
    await user.click(within(menu).getByRole('radio', { name: 'Paste' }));
    const attach = within(menu).getByRole<HTMLButtonElement>('button', { name: 'Attach' });
    expect(attach.disabled).toBe(true);

    await user.click(within(menu).getByRole('textbox', { name: 'Source text, not your question' }));
    await user.paste('Too short to be a source.');
    expect(attach.disabled).toBe(false);
    await user.click(attach);

    expect(within(menu).getByRole('alert').textContent).toContain('at least 80 characters');
    expect(screen.getByRole('button', { name: 'Evidence' })).toBeTruthy();
  });

  it('reads a chosen text file into a source, and names a file it cannot read without losing the others', async () => {
    const { user } = renderAsk();
    const menu = await openEvidence(user);
    const picker = within(menu).getByLabelText('Choose evidence files');
    fireEvent.change(picker, {
      target: {
        files: [
          new File([NOTES], 'harbour-notes.md', { type: 'text/markdown' }),
          new File(['not text'], 'harbour.png', { type: 'image/png' }),
        ],
      },
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Evidence 1 attached' })).toBeTruthy(),
    );
    expect(
      screen.getByRole('button', { name: `Read harbour-notes.md, ${NOTES.length} characters` }),
    ).toBeTruthy();
    // This server does not read PDFs (its capabilities say so), so a person is not told to bring one.
    expect((await within(menu).findByRole('alert')).textContent).toContain(
      'harbour.png: Use UTF-8 TXT, Markdown, CSV or JSON.',
    );
    expect(within(menu).queryByText(/PDF/u)).toBeNull();
    expect(picker.getAttribute('accept')).not.toContain('.pdf');
    expect(net.extractDataFile).not.toHaveBeenCalled();
  });

  it('opens a source to be read and corrected, and the corrected text is the one that is kept', async () => {
    const { user } = renderAsk();
    await pasteSource(user);
    await user.click(screen.getByRole('button', { name: /^Read notes\.txt/u }));

    const sheet = await screen.findByRole('dialog', { name: 'notes.txt' });
    const text = within(sheet).getByRole<HTMLTextAreaElement>('textbox', {
      name: 'The text Swarm will work from',
    });
    expect(text.value).toBe(NOTES);
    await user.type(text, ' It is paid on arrival.');
    await user.click(within(sheet).getByRole('button', { name: 'Done' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'notes.txt' })).toBeNull());
    expect(
      screen.getByRole('button', { name: `Read notes.txt, ${NOTES.length + 23} characters` }),
    ).toBeTruthy();
  });

  it('takes a source away from the sheet that shows it', async () => {
    const { user } = renderAsk();
    await pasteSource(user);
    await user.click(screen.getByRole('button', { name: /^Read notes\.txt/u }));
    const sheet = await screen.findByRole('dialog', { name: 'notes.txt' });
    await user.click(within(sheet).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'notes.txt' })).toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Evidence' })).toBeTruthy());
  });

  it('puts focus back on the source that was opened when its sheet is closed', async () => {
    const { user } = renderAsk();
    await pasteSource(user);
    const opener = screen.getByRole('button', { name: /^Read notes\.txt/u });
    await user.click(opener);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'notes.txt' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener), { timeout: 800 });
  });

  describe('a public web page', () => {
    async function openPage(user: UserEvent) {
      const menu = await openEvidence(user);
      await user.click(within(menu).getByRole('radio', { name: 'Web page' }));
      return {
        menu,
        address: within(menu).getByRole<HTMLInputElement>('textbox', { name: 'Web address' }),
      };
    }

    /** Anything that submits a form, wherever the form is: the question must never be read by it. */
    function watchSubmits() {
      const seen = { submits: 0, enters: [] as boolean[] };
      const onSubmit = () => void (seen.submits += 1);
      const onKey = (event: KeyboardEvent) => {
        if (event.key === 'Enter') seen.enters.push(event.defaultPrevented);
      };
      document.addEventListener('submit', onSubmit, true);
      document.addEventListener('keydown', onKey);
      return {
        seen,
        stop: () => {
          document.removeEventListener('submit', onSubmit, true);
          document.removeEventListener('keydown', onKey);
        },
      };
    }

    it('is offered only when the server reads pages', async () => {
      const { user } = renderAsk({ config: { ...CONFIG, urlIngestion: false } });
      const menu = await openEvidence(user);
      expect(
        within(menu)
          .getAllByRole('radio')
          .map((radio) => radio.textContent),
      ).toEqual(['Files', 'Paste']);
    });

    it('fetches on Enter, once, and never lets Enter submit a form or read the question', async () => {
      net.fetchUrl.mockResolvedValue(page());
      const { user } = renderAsk();
      await user.type(questionBox(), QUESTION);
      const { menu, address } = await openPage(user);
      const watch = watchSubmits();
      try {
        const fetchPage = within(menu).getByRole<HTMLButtonElement>('button', { name: 'Fetch' });
        expect(fetchPage.disabled).toBe(true);
        await user.type(address, 'https://harbour.example.org/fees');
        expect(fetchPage.disabled).toBe(false);
        await user.keyboard('{Enter}');

        const found = await within(menu).findByRole('article', { name: 'The fetched page' });
        expect(net.fetchUrl).toHaveBeenCalledTimes(1);
        expect(net.fetchUrl.mock.calls[0]![0]).toBe('https://harbour.example.org/fees');
        expect(within(found).getByText('Mooring fees')).toBeTruthy();
        expect(found.textContent).toContain('harbour.example.org');
        expect(found.textContent).toContain('Swarm has not checked that it is true');
        expect(watch.seen).toEqual({ submits: 0, enters: [true] });
        expect(net.parse).not.toHaveBeenCalled();
      } finally {
        watch.stop();
      }
    });

    it('leaves Enter alone only when it merely confirms what an input method is composing', async () => {
      const { user } = renderAsk();
      const { address } = await openPage(user);
      await user.type(address, 'https://harbour.example.org/fees');
      const composed = fireEvent.keyDown(address, { key: 'Enter', isComposing: true });
      expect(composed).toBe(true);
      expect(net.fetchUrl).not.toHaveBeenCalled();
    });

    it('does not fetch an empty address, and still keeps Enter from submitting anything', async () => {
      const { user } = renderAsk();
      const { address } = await openPage(user);
      const watch = watchSubmits();
      try {
        await user.click(address);
        await user.keyboard('{Enter}');
        await user.type(address, '   {Enter}');
        expect(net.fetchUrl).not.toHaveBeenCalled();
        expect(watch.seen).toEqual({ submits: 0, enters: [true, true] });
      } finally {
        watch.stop();
      }
    });

    it('adds the page as evidence with where it came from, or discards it', async () => {
      net.fetchUrl.mockResolvedValue(page());
      const { user } = renderAsk();
      const { menu, address } = await openPage(user);
      await user.type(address, 'https://harbour.example.org/fees{Enter}');
      await within(menu).findByRole('article', { name: 'The fetched page' });

      await user.click(within(menu).getByRole('button', { name: 'Discard' }));
      expect(within(menu).queryByRole('article', { name: 'The fetched page' })).toBeNull();
      expect(address.value).toBe('');
      expect(screen.getByRole('button', { name: 'Evidence' })).toBeTruthy();

      await user.type(address, 'https://harbour.example.org/fees{Enter}');
      await user.click(await within(menu).findByRole('button', { name: 'Add as evidence' }));
      expect(screen.getByRole('button', { name: 'Evidence 1 attached' })).toBeTruthy();
      expect(
        screen.getByRole('button', { name: /^Read harbour\.example\.org - Mooring fees\.txt/u }),
      ).toBeTruthy();
      expect(within(menu).queryByRole('article', { name: 'The fetched page' })).toBeNull();
      expect(address.value).toBe('');
    });

    it('shows that it is working, cannot be asked again meanwhile, and can be stopped', async () => {
      let signal: AbortSignal | undefined;
      net.fetchUrl.mockImplementation(
        (_url: string, given: AbortSignal) =>
          new Promise(() => {
            signal = given;
          }),
      );
      const { user } = renderAsk();
      const { menu, address } = await openPage(user);
      await user.type(address, 'https://harbour.example.org/fees{Enter}');

      await waitFor(() => expect(address.readOnly).toBe(true));
      expect(address.disabled).toBe(false);
      expect(
        within(menu).getByRole<HTMLButtonElement>('button', { name: /Fetching the page/u })
          .disabled,
      ).toBe(true);
      await user.keyboard('{Enter}');
      expect(net.fetchUrl).toHaveBeenCalledTimes(1);

      await user.click(within(menu).getByRole('button', { name: 'Cancel' }));
      expect(signal?.aborted).toBe(true);
      expect(address.readOnly).toBe(false);
      expect(within(menu).getByRole<HTMLButtonElement>('button', { name: 'Fetch' }).disabled).toBe(
        false,
      );
    });

    it('says in words why a page could not be read, keeps the address to correct, and offers pasting', async () => {
      net.fetchUrl.mockRejectedValue(new Error('harbour.example.org refused access (HTTP 403).'));
      const { user } = renderAsk();
      const { menu, address } = await openPage(user);
      await user.type(address, 'https://harbour.example.org/private{Enter}');

      const alert = await within(menu).findByRole('alert');
      expect(alert.textContent).toContain('The page could not be read');
      expect(alert.textContent).toContain('refused access (HTTP 403)');
      expect(alert.textContent).toContain('You can paste its text instead.');
      expect(address.value).toBe('https://harbour.example.org/private');

      // Changing the address takes the complaint away.
      await user.type(address, 'x');
      expect(within(menu).queryByRole('alert')).toBeNull();
    });

    it('shows what the page said as text: markup in it is never turned into elements', async () => {
      net.fetchUrl.mockResolvedValue(
        page({
          content: `A short page that says <script>alert(1)</script> and <img src=x onerror=alert(2)> in it. ${'More words. '.repeat(10)}`,
          provenance: { ...page().document.provenance, title: '<b>Bold</b> title' },
        }),
      );
      const { user } = renderAsk();
      const { menu, address } = await openPage(user);
      await user.type(address, 'https://harbour.example.org/fees{Enter}');
      const found = await within(menu).findByRole('article', { name: 'The fetched page' });

      expect(found.textContent).toContain('<script>alert(1)</script>');
      expect(found.textContent).toContain('<b>Bold</b> title');
      expect(found.querySelector('script, img, b')).toBeNull();
    });
  });
});
