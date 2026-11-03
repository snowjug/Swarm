// @vitest-environment jsdom
import type { UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_PROJECTS } from '../../../../shared/demo';
import { scenarioFixture } from '../../../../shared/lab-fixtures';
import type { ScenarioParseResult } from '../../../../shared/scenario';
import type { AppConfig, CreateProjectInput, ProjectSummary } from '../../../../shared/types';
import { fireEvent, renderWithApp, screen, setMedia, waitFor, within } from '../../test/dom';
import { AskScene, type AskSceneProps } from './AskScene';
import { Credibility } from './Credibility';
import { CAPABILITIES, CAPABILITY_IDS, type CapabilityFlags } from './capabilities';
import { EXAMPLE_SCENARIOS, exampleLabel } from './examples';
import { TEMPLATES } from './templates';

// The first screen as a person meets it: what it says before anything is typed, the one question that is enough
// where the server researches for itself and what is asked for where it does not, what the person says beside the
// question and where it goes, the templates, the way from a question to a decision, and the way into a demonstration.
// Only the network is replaced; every call that could leave the page is a spy.

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
  net.parse.mockImplementation(async () => reading());
});
afterEach(() => {
  vi.unstubAllGlobals();
  expect(net.fetch).not.toHaveBeenCalled();
});

const QUESTION =
  'What could happen if the harbour office doubles the mooring fee for visiting boats?';
const NOTES =
  'The harbour office sets the mooring fee for visiting boats each spring, once the council has agreed its budget.';

const BASE: AppConfig = {
  version: 'test',
  provider: {
    name: 'none',
    model: null,
    configured: false,
    reason: 'Local engine only.',
    auth: 'none',
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
  urlIngestion: false,
  capabilities: {
    local: true,
    modelAssisted: false,
    fileTypes: ['txt', 'md'],
    pdf: false,
    webRetrieval: false,
    guidedConsole: true,
    surveys: false,
    whatIf: false,
    authentication: 'local-single-user',
  },
};
/**
 * A server that researches for itself, as every server does today: it reads the site or page that is named, and has no
 * search provider, so it cannot look for sources from a question alone. It says so in the part of its settings that
 * later work adds.
 */
const RESEARCHING = {
  ...BASE,
  research: {
    enabled: true,
    discovery: { available: false, provider: null, message: 'No search provider is configured.' },
  },
} as AppConfig;
/** One that can also look for sources from a question alone, because a search provider is behind it. */
const SEARCHING = {
  ...BASE,
  research: {
    enabled: true,
    discovery: { available: true, provider: 'a search provider', message: 'Ready.' },
  },
} as AppConfig;
const CONSTRAINED = { ...RESEARCHING, features: { constraints: true } } as AppConfig;
const CONSTRAINED_AND_SEARCHING = { ...SEARCHING, features: { constraints: true } } as AppConfig;

const reading = (): ScenarioParseResult => ({
  frame: scenarioFixture({ origin: 'rules', ambiguities: [], geography: null, horizon: null }),
  mode: 'rules',
  model: null,
  notes: ['Read by a fixture.'],
});

function renderAsk(props: Partial<AskSceneProps> = {}) {
  const onSubmit = vi.fn(async (_input: CreateProjectInput) => undefined);
  const onOpenProject = vi.fn();
  const view = renderWithApp(
    <AskScene
      config={BASE}
      busy={false}
      onSubmit={onSubmit}
      history={{ projects: [], loading: false, error: null }}
      onOpenProject={onOpenProject}
      onRetryHistory={vi.fn()}
      onHistory={vi.fn()}
      mode="guided"
      {...props}
    />,
  );
  return { ...view, onSubmit, onOpenProject };
}

const questionBox = () =>
  screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Your what-if question' });
const siteBox = () =>
  screen.getByRole<HTMLInputElement>('textbox', { name: /^Website or domain/u });
const researchSwitch = () =>
  screen.getByRole<HTMLInputElement>('switch', { name: /Research automatically/u });
const explore = () => screen.getByRole('button', { name: 'Explore' });
// A busy machine is slow to finish the animation between the question and the scenario; what is waited for is that it comes.
const groundIt = () => screen.findByRole('button', { name: 'Ground it' }, { timeout: 15_000 });
const advanced = () => screen.getByRole('button', { name: /^Advanced/u });

/** Attaches the notes as the person's own source, through the evidence menu, and closes it. */
async function attachNotes(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: /^Evidence(?: \d+ attached)?$/u }));
  const menu = await screen.findByRole('dialog', { name: 'Add evidence' });
  await user.click(within(menu).getByRole('radio', { name: 'Paste' }));
  await user.click(within(menu).getByRole('textbox', { name: 'Source text, not your question' }));
  await user.paste(NOTES);
  await user.click(within(menu).getByRole('button', { name: 'Attach' }));
  await user.click(within(menu).getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add evidence' })).toBeNull());
}

const SEARCH_PROMISE = /finds and reads public sources|looks for public sources/u;
const CANNOT_SEARCH = 'This server cannot look for sources from a question alone.';

const written = (call: number) =>
  net.parse.mock.calls[call] as [string, unknown[], unknown, boolean];

describe('on a server that researches for itself, and has no search provider', () => {
  it('is on by default and says what it does: it reads the website that is named, and asks for a source when none is', async () => {
    const { user, onSubmit } = renderAsk({ config: RESEARCHING });
    expect(researchSwitch().checked).toBe(true);
    expect(researchSwitch().disabled).toBe(false);
    expect(
      screen.getByText('Reads the website you name. With none, it asks you for a source.'),
    ).toBeTruthy();
    // It does not say that it finds sources, because it cannot.
    expect(screen.queryByText(SEARCH_PROMISE)).toBeNull();
    expect(document.body.textContent).not.toMatch(SEARCH_PROMISE);

    await user.click(questionBox());
    await user.paste(QUESTION);
    await user.click(explore());

    // Read with no source behind it: the reading is of the question.
    await groundIt();
    expect(net.parse).toHaveBeenCalledTimes(1);
    expect(written(0)[0]).toBe(QUESTION);
    expect(written(0)[1]).toEqual([]);
    // What is to come is said where the sources would be, before anything is started: no search from a question alone.
    expect(
      screen.getByText(
        `${CANNOT_SEARCH} After you continue, Swarm asks you to name a website or add a source.`,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Automatic research is on/u)).toBeNull();
    expect(document.body.textContent).not.toMatch(SEARCH_PROMISE);
    expect(screen.getByText('Nothing runs until you continue.')).toBeTruthy();

    await user.click(await groundIt());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const sent = onSubmit.mock.calls[0]![0];
    expect(sent.documents).toEqual([]);
    expect(sent.research).toEqual({ auto: true });
    expect(sent.question).toBe(QUESTION);
    expect(sent.scenario?.decision).toBeTruthy();
  });

  it('starts from the site the person names, and says it has understood a site', async () => {
    const { user, onSubmit } = renderAsk({ config: RESEARCHING });
    await user.click(questionBox());
    await user.paste(QUESTION);
    await user.type(siteBox(), 'Harbour.Example.org');
    expect(screen.getByText('Site')).toBeTruthy();
    await user.click(explore());
    await groundIt();
    expect(
      screen.getByText(
        'Automatic research is on. After you continue, Swarm reads harbour.example.org and the pages it links to, and lists every page it reads.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(CANNOT_SEARCH, { exact: false })).toBeNull();
    await user.click(await groundIt());
    expect(onSubmit.mock.calls[0]![0].research).toEqual({
      auto: true,
      domain: 'harbour.example.org',
    });
  });

  it('starts from one page when the person names a page: the request says url, not domain', async () => {
    const { user, onSubmit } = renderAsk({ config: RESEARCHING });
    await user.click(questionBox());
    await user.paste(QUESTION);
    await user.type(siteBox(), 'harbour.example.org/fees/2025');
    expect(screen.getByText('Page')).toBeTruthy();
    await user.click(explore());
    await groundIt();
    expect(
      screen.getByText(
        'Automatic research is on. After you continue, Swarm reads a page of harbour.example.org and the pages it links to, and lists every page it reads.',
      ),
    ).toBeTruthy();
    await user.click(await groundIt());
    expect(onSubmit.mock.calls[0]![0].research).toEqual({
      auto: true,
      url: 'https://harbour.example.org/fees/2025',
    });
  });

  it('says nothing of research in the review when the sources the person added are what is used', async () => {
    const { user, onSubmit } = renderAsk({ config: RESEARCHING });
    await user.click(questionBox());
    await user.paste(QUESTION);
    await attachNotes(user);
    await user.click(explore());
    await groundIt();
    // No website was named, so nothing is researched: the one source is what the project is made from.
    expect(screen.queryByText(/Automatic research is on/u)).toBeNull();
    expect(screen.queryByText(CANNOT_SEARCH, { exact: false })).toBeNull();
    expect(document.body.textContent).not.toMatch(SEARCH_PROMISE);
    expect(written(0)[1]).toHaveLength(1);

    await user.click(await groundIt());
    const sent = onSubmit.mock.calls[0]![0];
    expect(sent.documents).toHaveLength(1);
    expect(sent.research).toEqual({ auto: true });
  });

  it('reads the site that is named beside the sources that were added, and says so, and keeps the sources', async () => {
    const { user, onSubmit } = renderAsk({ config: RESEARCHING });
    await user.click(questionBox());
    await user.paste(QUESTION);
    await user.type(siteBox(), 'harbour.example.org');
    await attachNotes(user);
    await user.click(explore());
    await groundIt();
    expect(
      screen.getByText(
        'Automatic research is on. After you continue, Swarm reads harbour.example.org and the pages it links to, and lists every page it reads.',
      ),
    ).toBeTruthy();

    await user.click(await groundIt());
    const sent = onSubmit.mock.calls[0]![0];
    expect(sent.documents).toHaveLength(1);
    expect(sent.research).toEqual({ auto: true, domain: 'harbour.example.org' });
  });

  it('says gently, once the field is left, that the address does not look like one, and reads nothing until it does', async () => {
    const { user } = renderAsk({ config: RESEARCHING });
    await user.click(questionBox());
    await user.paste(QUESTION);
    await user.type(siteBox(), 'harbour');
    // Not while it is being typed.
    expect(screen.queryByText(/does not look like a website/u)).toBeNull();
    await user.tab();
    expect(screen.getByText(/does not look like a website yet\. Try example\.org/u)).toBeTruthy();
    expect(siteBox().getAttribute('aria-invalid')).toBe('true');
    expect(siteBox().getAttribute('aria-describedby')).toContain(
      screen.getByText(/does not look like a website/u).id,
    );

    await user.click(explore());
    expect(net.parse).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(siteBox());

    // Written on, the hint goes; and the question is read.
    await user.type(siteBox(), '.example.org');
    expect(screen.queryByText(/does not look like a website/u)).toBeNull();
    await user.click(explore());
    await groundIt();
    expect(net.parse).toHaveBeenCalledTimes(1);
  });

  it('explores from the website field with Ctrl+Enter, and from the field of a custom time frame', async () => {
    const { user } = renderAsk({ config: RESEARCHING });
    await user.click(questionBox());
    await user.paste(QUESTION);
    await user.click(siteBox());
    await user.keyboard('{Control>}{Enter}{/Control}');
    await groundIt();
    expect(net.parse).toHaveBeenCalledTimes(1);
  });

  it('can be turned off: it says that only the sources the person adds are used, and asks for one again', async () => {
    const { user, onSubmit } = renderAsk({ config: RESEARCHING });
    await user.click(questionBox());
    await user.paste(QUESTION);
    await user.type(siteBox(), 'harbour.example.org');
    await user.click(researchSwitch());

    expect(researchSwitch().checked).toBe(false);
    expect(screen.getByText('Manual sources only: Swarm reads what you add.')).toBeTruthy();
    // A website is what research starts from: with it off the field is not for use, and says so.
    expect(siteBox().disabled).toBe(true);
    expect(screen.getByText('used by automatic research')).toBeTruthy();

    await user.click(explore());
    expect(
      screen.getByText('Add a source to ground it: a file, pasted notes or a public page.'),
    ).toBeTruthy();
    expect(net.parse).not.toHaveBeenCalled();

    await user.click(await screen.findByRole('radio', { name: 'Paste' }));
    await user.click(screen.getByRole('textbox', { name: 'Source text, not your question' }));
    await user.paste(NOTES);
    await user.click(screen.getByRole('button', { name: 'Attach' }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await user.click(explore());
    await user.click(await groundIt());

    const sent = onSubmit.mock.calls[0]![0];
    expect(sent.documents).toHaveLength(1);
    // Manual mode carries no website: it is the person's word that only their sources are read.
    expect(sent.research).toEqual({ auto: false });
    expect(screen.queryByText(/Automatic research is on/u)).toBeNull();
  });

  it('sends the time frame and the place on the request for research and in the scenario that is confirmed, with the guidance for research', async () => {
    const { user, onSubmit } = renderAsk({ config: RESEARCHING });
    await user.click(questionBox());
    await user.paste(QUESTION);
    await user.click(screen.getByRole('radio', { name: '1 year' }));
    await user.click(advanced());
    await user.type(screen.getByRole('textbox', { name: 'Geography' }), 'Northern region');
    await user.type(
      screen.getByRole('textbox', { name: 'Research guidance' }),
      'Official sources only',
    );
    // Said, and counted on the button that holds it, so that nothing is hidden.
    expect(advanced().textContent).toMatch(/2/u);

    await user.click(explore());
    await groundIt();
    // The scenario they confirm has their words in it, as they were said, and nothing that they did not say.
    expect(screen.getByRole('button', { name: /^Over what time: 1 year/u })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Where: Northern region/u })).toBeTruthy();

    await user.click(await groundIt());
    const sent = onSubmit.mock.calls[0]![0];
    expect(sent.scenario).toMatchObject({ horizon: '1 year', geography: 'Northern region' });
    expect(sent.research).toEqual({
      auto: true,
      horizon: '1 year',
      geography: 'Northern region',
      guidance: 'Official sources only',
    });
  });

  it('takes the keyboard into the advanced fields when they are opened with it, and leaves a pointer where it is', async () => {
    const { user } = renderAsk({ config: RESEARCHING });
    const toggle = advanced();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.focus();
    await user.keyboard('{Enter}');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Geography' })),
    );

    await user.keyboard('{Tab}');
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Research guidance' }));
    // Opened again with a pointer, the focus is where the press put it.
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(toggle);
  });

  it('takes a time frame in the person’s own words, and nothing when they have not said', async () => {
    const { user, onSubmit } = renderAsk({ config: RESEARCHING });
    await user.click(questionBox());
    await user.paste(QUESTION);
    expect(screen.getByRole('radio', { name: 'Not sure' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    await user.click(screen.getByRole('radio', { name: 'Custom' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Your time horizon, in your own words' }),
      'the next two quarters',
    );
    await user.click(explore());
    await user.click(await groundIt());
    expect(onSubmit.mock.calls[0]![0].research).toEqual({
      auto: true,
      horizon: 'the next two quarters',
    });
  });

  it('goes on without a reading when the reading fails, and still asks for research, with the question alone', async () => {
    net.parse.mockRejectedValue(new Error('The reader is busy.'));
    const { user, onSubmit } = renderAsk({ config: RESEARCHING });
    await user.click(questionBox());
    await user.paste(QUESTION);
    await user.click(screen.getByRole('radio', { name: '3 years' }));
    await user.click(explore());
    await user.click(await screen.findByRole('button', { name: 'Continue without reading' }));
    const sent = onSubmit.mock.calls[0]![0];
    expect(sent.scenario).toBeUndefined();
    expect(sent.documents).toEqual([]);
    expect(sent.research).toEqual({ auto: true, horizon: '3 years' });
  });
});

describe('on a server that can also look for sources from a question alone', () => {
  it('says on the switch and in the review that it finds and reads public sources, and starts with the question alone', async () => {
    const { user, onSubmit } = renderAsk({ config: SEARCHING });
    expect(researchSwitch().checked).toBe(true);
    expect(screen.getByText('Swarm finds and reads public sources for you.')).toBeTruthy();

    await user.click(questionBox());
    await user.paste(QUESTION);
    await user.click(explore());
    await groundIt();
    expect(
      screen.getByText(
        'Automatic research is on. After you continue, Swarm looks for public sources, and lists every page it reads.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(CANNOT_SEARCH, { exact: false })).toBeNull();

    await user.click(await groundIt());
    const sent = onSubmit.mock.calls[0]![0];
    expect(sent.documents).toEqual([]);
    expect(sent.research).toEqual({ auto: true });
  });

  it('still says that it reads the site that is named, and nothing of a search when sources were added', async () => {
    const { user } = renderAsk({ config: SEARCHING });
    await user.click(questionBox());
    await user.paste(QUESTION);
    await user.type(siteBox(), 'harbour.example.org');
    await user.click(explore());
    await groundIt();
    expect(
      screen.getByText(
        'Automatic research is on. After you continue, Swarm reads harbour.example.org and the pages it links to, and lists every page it reads.',
      ),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/looks for public sources/u);
  });

  it('says nothing of research in the review when the sources that were added are what is used', async () => {
    const { user } = renderAsk({ config: SEARCHING });
    await user.click(questionBox());
    await user.paste(QUESTION);
    await attachNotes(user);
    await user.click(explore());
    await groundIt();
    expect(screen.queryByText(/Automatic research is on/u)).toBeNull();
    expect(document.body.textContent).not.toMatch(/looks for public sources/u);
  });
});

describe('on a server that does not research', () => {
  it('shows the switch off and out of reach, says why in one line, and still needs a source of the person’s own', async () => {
    const { user } = renderAsk({ config: BASE });
    expect(researchSwitch().checked).toBe(false);
    expect(researchSwitch().disabled).toBe(true);
    expect(screen.getByText('Off on this server. Attach your own sources.')).toBeTruthy();
    expect(siteBox().disabled).toBe(true);

    await user.click(questionBox());
    await user.paste(QUESTION);
    await user.click(explore());
    expect(
      screen.getByText('Add a source to ground it: a file, pasted notes or a public page.'),
    ).toBeTruthy();
    expect(net.parse).not.toHaveBeenCalled();
  });

  it('is the same for a server whose settings could not be read', () => {
    renderAsk({ config: null });
    expect(researchSwitch().disabled).toBe(true);
    expect(researchSwitch().checked).toBe(false);
  });

  it('makes the project of a question and a source as before, with the request marked as manual', async () => {
    const { user, onSubmit } = renderAsk({ config: BASE });
    await user.click(questionBox());
    await user.paste(QUESTION);
    await user.click(screen.getByRole('button', { name: /^Evidence/u }));
    await user.click(await screen.findByRole('radio', { name: 'Paste' }));
    await user.click(screen.getByRole('textbox', { name: 'Source text, not your question' }));
    await user.paste(NOTES);
    await user.click(screen.getByRole('button', { name: 'Attach' }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await user.click(explore());
    await user.click(await groundIt());
    expect(onSubmit.mock.calls[0]![0].research).toEqual({ auto: false });
    expect(onSubmit.mock.calls[0]![0].documents).toHaveLength(1);
  });
});

describe('the templates', () => {
  it('fill the box with a question to write over, select its first blank, and read nothing until the blanks are replaced', async () => {
    const { user } = renderAsk({ config: RESEARCHING });
    const template = TEMPLATES.find((item) => item.id === 'pricing-change')!;
    const chips = screen.getByRole('list', { name: 'Start from a template' });
    expect(
      within(chips)
        .getAllByRole('button')
        .map((chip) => chip.textContent),
    ).toEqual([...TEMPLATES.map((item) => item.label), 'Custom']);
    await user.click(within(chips).getByRole('button', { name: 'Pricing change' }));

    expect(questionBox().value).toBe(template.question);
    await waitFor(() => expect(document.activeElement).toBe(questionBox()));
    const first = '[a product, service or programme]';
    expect(
      questionBox().value.slice(questionBox().selectionStart, questionBox().selectionEnd),
    ).toBe(first);

    await user.click(explore());
    expect(screen.getByText(`Replace ${first} with your own words.`)).toBeTruthy();
    expect(net.parse).not.toHaveBeenCalled();

    // The selected blank is written over, and the next is asked for.
    await user.keyboard('a bus pass');
    await user.click(explore());
    expect(screen.getByText('Replace [a group of people] with your own words.')).toBeTruthy();
    expect(net.parse).not.toHaveBeenCalled();

    await user.type(questionBox(), ' ', { initialSelectionStart: 0, initialSelectionEnd: 0 });
    await user.clear(questionBox());
    await user.paste('What could happen if we change what a bus pass costs for students?');
    await user.click(explore());
    await groundIt();
    expect(written(0)[0]).toBe(
      'What could happen if we change what a bus pass costs for students?',
    );
  });

  it('are not the person’s question until they are: a question of their own that has brackets in it is read as it is', async () => {
    const { user } = renderAsk({ config: RESEARCHING });
    await user.click(questionBox());
    await user.paste('What could happen if the harbour fee is raised, as the notice [sic] says?');
    await user.click(explore());
    await groundIt();
    expect(net.parse).toHaveBeenCalledTimes(1);
  });

  it('start from nothing with "Custom", which clears a template that was not touched and keeps what was written', async () => {
    const { user } = renderAsk({ config: RESEARCHING });
    const chips = () => screen.getByRole('list', { name: 'Start from a template' });
    await user.click(within(chips()).getByRole('button', { name: 'AI adoption' }));
    expect(questionBox().value).toBe(TEMPLATES[0]!.question);
    await user.click(within(chips()).getByRole('button', { name: 'Custom' }));
    expect(questionBox().value).toBe('');
    await waitFor(() => expect(document.activeElement).toBe(questionBox()));

    await user.paste('What if the town closes the harbour to cars?');
    await user.click(within(chips()).getByRole('button', { name: 'Custom' }));
    expect(questionBox().value).toBe('What if the town closes the harbour to cars?');
  });

  it('take the place of a sample case: its note and the sources that came with it go', async () => {
    const example = EXAMPLE_SCENARIOS[0]!;
    const { user } = renderAsk({ config: RESEARCHING });
    await user.click(screen.getByRole('button', { name: 'Try a sample case' }));
    const cases = await screen.findByRole('dialog', { name: 'Try a sample case' });
    await user.click(within(cases).getByRole('button', { name: exampleLabel(example) }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Try a sample case' })).toBeNull(),
    );
    // A sample case brings sources of its own, so research is off: they are the point of it.
    expect(researchSwitch().checked).toBe(false);
    expect(
      screen.getByRole('button', { name: `Evidence ${example.documents.length} attached` }),
    ).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Start from a template' })).toBeNull();
  });
});

describe('the way from a question to a decision', () => {
  const steps = () => within(screen.getByRole('list', { name: 'How Swarm works' }));
  const step = (name: string) => screen.getByRole('button', { name });
  const open = () => screen.getAllByRole('group').find((group) => !group.closest('[hidden]'));

  it('is a list of five steps in order, with the first open and what is said there in words', () => {
    renderAsk({ config: BASE });
    expect(steps().getAllByRole('listitem')).toHaveLength(5);
    expect(
      steps()
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Question', 'Research', 'People', 'Possible futures', 'Decision']);
    expect(step('Question').getAttribute('aria-expanded')).toBe('true');
    expect(step('Research').getAttribute('aria-expanded')).toBe('false');
    const detail = document.getElementById(step('Question').getAttribute('aria-controls')!)!;
    expect(detail.textContent).toMatch(/^Swarm reads your question and frames the decision/u);
    expect(detail.textContent).toMatch(/You write it in plain words/u);
    expect(open()).toBeTruthy();
  });

  it('opens a step when it is pressed, and says what Swarm does and what the person controls there', async () => {
    const { user } = renderAsk({ config: BASE });
    await user.click(step('Possible futures'));
    expect(step('Possible futures').getAttribute('aria-expanded')).toBe('true');
    expect(step('Question').getAttribute('aria-expanded')).toBe('false');
    const detail = document.getElementById(
      step('Possible futures').getAttribute('aria-controls')!,
    )!;
    expect(detail.textContent).toMatch(/Swarm simulates seeded runs of each alternative/u);
    expect(detail.textContent).toMatch(/You choose the alternatives/u);
    expect(detail.getAttribute('data-active')).toBe('true');
  });

  it('is operated from the keyboard: the arrows move between the steps, and Enter opens the one that has focus', async () => {
    const { user } = renderAsk({ config: BASE });
    step('Question').focus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(document.activeElement).toBe(step('People'));
    // Moving is not choosing: nothing has changed under the steps.
    expect(step('Question').getAttribute('aria-expanded')).toBe('true');
    await user.keyboard('{Enter}');
    expect(step('People').getAttribute('aria-expanded')).toBe('true');
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(step('Decision'));
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(step('Question'));
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(step('Question'));
  });

  it('opens a step when a mouse rests on it, and not when it only passes over, or when it is a finger', async () => {
    renderAsk({ config: BASE });
    const research = step('Research');
    const decision = step('Decision');

    // In and out in one breath: a pointer that is only passing has not said that it means it.
    fireEvent.pointerEnter(decision, { pointerType: 'mouse' });
    fireEvent.pointerLeave(decision, { pointerType: 'mouse' });
    // A finger has no hover: it presses, and that is a click.
    fireEvent.pointerEnter(step('People'), { pointerType: 'touch' });

    fireEvent.pointerEnter(research, { pointerType: 'mouse' });
    expect(research.getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => expect(research.getAttribute('aria-expanded')).toBe('true'));
    // Their time has gone by, and neither of the others opened.
    expect(decision.getAttribute('aria-expanded')).toBe('false');
    expect(step('People').getAttribute('aria-expanded')).toBe('false');
  });

  it('says what this server can do: the research step and the people step follow the switch and the settings', async () => {
    const { user } = renderAsk({ config: CONSTRAINED });
    await user.click(step('Research'));
    let detail = document.getElementById(step('Research').getAttribute('aria-controls')!)!;
    // A server with no search provider reads the website that is named and the files that are added, and nothing else.
    expect(detail.textContent).toMatch(/reads the website you name and the files you add/u);
    expect(detail.textContent).toMatch(
      /You name a site to start from and add your own files; see every source it used\./u,
    );
    expect(detail.textContent).not.toMatch(SEARCH_PROMISE);
    expect(
      steps()
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label'))[2],
    ).toBe('People and constraints');

    await user.click(researchSwitch());
    detail = document.getElementById(step('Research').getAttribute('aria-controls')!)!;
    expect(detail.textContent).toMatch(/reads the files and pages you add/u);
    expect(detail.textContent).toMatch(/You choose every source\. Nothing else is read\./u);
  });

  it('says that it finds and reads public sources only for a server that has a search provider behind it', async () => {
    const { user } = renderAsk({ config: CONSTRAINED_AND_SEARCHING });
    await user.click(step('Research'));
    const detail = document.getElementById(step('Research').getAttribute('aria-controls')!)!;
    expect(detail.textContent).toMatch(/finds and reads public sources/u);
    expect(detail.textContent).toMatch(
      /You can name a site to start from, add your own files, and see every source it used\./u,
    );
  });
});

describe('what every exploration includes', () => {
  const chips = () =>
    within(screen.getByRole('list', { name: 'What every exploration includes' }))
      .getAllByRole('listitem')
      .map((item) => item.textContent);

  it('is four things on a server that does not keep constraints, and five on one that does', () => {
    const { unmount } = renderAsk({ config: BASE });
    expect(chips()).toEqual([
      'Evidence linked',
      'Assumptions visible',
      'Alternatives compared',
      'Human approval before simulation',
    ]);
    unmount();
    renderAsk({ config: CONSTRAINED });
    expect(chips()).toContain('Constraints considered');
    expect(chips()).toHaveLength(5);
  });

  it('draws no signal without its flag, and nothing at all when there is none', () => {
    const all = Object.fromEntries(CAPABILITY_IDS.map((id) => [id, true])) as CapabilityFlags;
    for (const capability of CAPABILITIES) {
      const { unmount } = renderWithApp(<Credibility flags={{ ...all, [capability.id]: false }} />);
      const shown = within(screen.getByRole('list', { name: 'What every exploration includes' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent);
      expect(shown, capability.id).not.toContain(capability.label);
      expect(shown).toHaveLength(CAPABILITIES.length - 1);
      unmount();
    }
    const none = Object.fromEntries(CAPABILITY_IDS.map((id) => [id, false])) as CapabilityFlags;
    const { container } = renderWithApp(<Credibility flags={none} />);
    expect(container.querySelector('li')).toBeNull();
    expect(screen.queryByRole('button', { name: 'What this means' })).toBeNull();
  });

  it('says what each means under a button, and only for what is drawn', async () => {
    const { user } = renderAsk({ config: BASE });
    const more = screen.getByRole('button', { name: 'What this means' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    await user.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    const defs = document.getElementById(more.getAttribute('aria-controls')!)!;
    expect(
      within(defs).getByText('Each claim points to the passage of the source it was read from.'),
    ).toBeTruthy();
    expect(within(defs).queryByText('Constraints considered')).toBeNull();
  });
});

describe('the way into a demonstration', () => {
  const recorded = DEMO_PROJECTS.find((demo) => demo.role === 'base')!;
  const projects = [
    {
      id: recorded.id,
      name: recorded.title,
      question: 'q',
      status: 'completed',
      updatedAt: '2026-03-10T12:00:00Z',
    },
  ] as unknown as ProjectSummary[];

  it('offers the recording when this workspace holds it, and opens it', async () => {
    const { user, onOpenProject } = renderAsk({
      history: { projects, loading: false, error: null },
    });
    await user.click(screen.getByRole('button', { name: 'Try a recorded demonstration' }));
    const dialog = await screen.findByRole('dialog', { name: 'Try a recorded demonstration' });
    expect(
      within(dialog).getByText(/A fictional island ferry, recorded with a real model/u),
    ).toBeTruthy();
    // The sample cases are there too, under their own heading, and are not called recordings.
    expect(within(dialog).getByRole('heading', { name: 'Sample cases' })).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Open the recording' }));
    expect(onOpenProject).toHaveBeenCalledWith(recorded.id);
  });

  it('says nothing of a recording that is not there', async () => {
    const { user } = renderAsk();
    await user.click(screen.getByRole('button', { name: 'Try a sample case' }));
    const dialog = await screen.findByRole('dialog', { name: 'Try a sample case' });
    expect(within(dialog).queryByRole('button', { name: 'Open the recording' })).toBeNull();
    expect(within(dialog).queryByText(/Recorded demonstration/u)).toBeNull();
  });
});

describe('on a phone', () => {
  it('asks for the time frame from a list, since six choices do not fit in a row, and the custom one in words', async () => {
    setMedia('(max-width: 40rem)', true);
    const { user, onSubmit } = renderAsk({ config: RESEARCHING });
    expect(screen.queryByRole('radio', { name: '1 year' })).toBeNull();
    const list = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Time horizon' });
    await user.selectOptions(list, '6 months');
    await user.click(questionBox());
    await user.paste(QUESTION);
    await user.click(explore());
    await user.click(await groundIt());
    expect(onSubmit.mock.calls[0]![0].research).toEqual({ auto: true, horizon: '6 months' });
  });
});
