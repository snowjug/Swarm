// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_RESEARCH_BUDGET, type ResearchView } from '../../../../../shared/research';
import type { AppConfig, ProjectDetail } from '../../../../../shared/types';
import { claimsAgainst } from '../../../../../e2e/support/claims';
import { ApiError, api } from '../../../api';
import { researchApi } from '../../../api/research';
import { renderWithApp, reduceMotion, screen, waitFor, within, act } from '../../../test/dom';
import { projectFixture } from '../../../test/project';
import { passagesOf, project as groundProject, twoConflicts } from '../fixtures';
import GroundScene from '../index';
import {
  NO_PROVIDER,
  QUESTION,
  completed,
  pages,
  run,
  runningAt,
  source,
  view as viewOf,
} from './fixtures';

// The research surface as a person meets it on the Ground page: what the head of the page says while a run is under
// way, what each of the six stages shows, every page and why it was set aside, and what can be done at each point.
// Only the network is replaced; every request a person's press makes is a spy.

const CONFIG = {
  research: { enabled: true, discovery: NO_PROVIDER, budget: DEFAULT_RESEARCH_BUDGET },
  capabilities: { pdf: false },
} as unknown as AppConfig;

/** A project that was made from a question alone: no sources, no graph, and the engine's step at `step`. */
function questionOnly(step: 'pending' | 'queued' | 'running' | 'failed' | 'cancelled' = 'running') {
  const base: ProjectDetail = projectFixture();
  base.question = QUESTION;
  base.documents = [];
  base.graph = null;
  base.console!.steps.knowledge = step;
  return base;
}

/** The server as the page reads it: `held` is what it answers with, and what a request changes. */
function serve(initial: ResearchView | null) {
  const server = { held: initial };
  const answer = (next: ResearchView) => {
    server.held = next;
    return next;
  };
  vi.spyOn(researchApi, 'get').mockImplementation(async () => {
    if (!server.held) throw new Error('No view');
    return server.held;
  });
  const calls = {
    start: vi
      .spyOn(researchApi, 'start')
      .mockImplementation(async () =>
        answer(viewOf(run({ status: 'queued', stage: 'planning', plan: null }))),
      ),
    pause: vi
      .spyOn(researchApi, 'pause')
      .mockImplementation(async () => answer(viewOf({ ...server.held!.run!, status: 'paused' }))),
    resume: vi
      .spyOn(researchApi, 'resume')
      .mockImplementation(async () => answer(viewOf({ ...server.held!.run!, status: 'running' }))),
    cancel: vi
      .spyOn(researchApi, 'cancel')
      .mockImplementation(async () =>
        answer(viewOf({ ...server.held!.run!, status: 'cancelled', stoppedBecause: 'cancelled' })),
      ),
    finish: vi
      .spyOn(researchApi, 'finish')
      .mockImplementation(async () => answer(viewOf(completed()))),
    // A site that is named is a run of its own: the server starts one, and the page follows it.
    addSource: vi
      .spyOn(researchApi, 'addSource')
      .mockImplementation(async () =>
        answer(viewOf(run({ status: 'queued', stage: 'planning', plan: null }))),
      ),
  };
  return { server, calls };
}

function open(
  held: ResearchView | null,
  options: { project?: ProjectDetail; config?: AppConfig | null } = {},
) {
  const served = serve(held);
  const view = renderWithApp(<GroundScene />, {
    workspace: {
      project: options.project ?? questionOnly(),
      config: options.config === undefined ? CONFIG : options.config,
    },
  });
  return { ...view, ...served };
}

const chip = () => document.querySelector('[data-moment]');
const tracker = () => screen.getByRole('list', { name: 'Research progress' });
const stageNamed = (name: string) =>
  within(tracker())
    .getAllByRole('listitem')
    .find((item) => item.textContent?.startsWith(name))!;
const pageList = () => screen.getByRole('list', { name: 'Pages' });
const figureOf = (label: string) =>
  screen
    .getAllByRole('listitem')
    .find((item) => item.textContent?.includes(label) && item.closest('.sw-ground__figures'))!;

beforeEach(() => {
  // Counts are the ones the run holds, not the ones a figure has counted up to.
  reduceMotion();
  vi.spyOn(api, 'evidence').mockResolvedValue({ query: '', matches: [] });
  vi.spyOn(api, 'ledger').mockResolvedValue(twoConflicts());
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the head of the page while a run is under way', () => {
  it('says the stage the run is in, counts what it has read, and offers pause, finishing early and cancelling', async () => {
    open(viewOf(runningAt('reading')));
    await screen.findByRole('list', { name: 'Research progress' });

    expect(chip()?.textContent).toBe('Reading');
    expect(chip()?.getAttribute('data-moment')).toBe('research-reading');
    // Where the evidence's own figures would be, the run's: what it has read, used, and how widely.
    expect(figureOf('Pages read').textContent).toMatch(/^4\s*Pages read/u);
    expect(figureOf('Sources used').textContent).toMatch(/^0\s*Sources used/u);
    expect(figureOf('Sites').textContent).toMatch(/^3\s*Sites/u);
    // A count that the run has not reached is a dash, not a guess.
    expect(within(figureOf('Conflicts')).getByRole('img', { name: 'Not known yet' })).toBeTruthy();

    for (const name of ['Pause', 'Finish early', 'Cancel']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    // The evidence's own actions wait: there is nothing yet to ground, and no second way to stop.
    for (const name of ['Ground it', 'Stop', 'Try again']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.queryByRole('list', { name: 'Progress' })).toBeNull();
    expect(screen.queryByText('No source text')).toBeNull();
  });

  it('shows each stage as reached only when the run has reached it, and the current one as live', async () => {
    open(viewOf(runningAt('reading')));
    await screen.findByRole('list', { name: 'Research progress' });
    const items = within(tracker()).getAllByRole('listitem');
    expect(items.map((item) => item.getAttribute('data-state'))).toEqual([
      'done',
      'done',
      'active',
      'waiting',
      'waiting',
      'waiting',
    ]);
    expect(items[2]!.getAttribute('aria-current')).toBe('step');
    expect(items[2]!.textContent).toContain('Reading, in progress');
    expect(items[2]!.textContent).toContain('4 read · up to 12');
    expect(items[0]!.textContent).toContain('4 topics · 2 claims to check');
    // Nothing is said of a stage the run has not reached.
    expect(items[4]!.querySelector('.sw-research-stage__detail')?.textContent?.trim()).toBe('');
  });

  it('lists every page that was read with its kind, an estimate of its authority, its dates and its state, and judges none', async () => {
    open(viewOf(runningAt('reading')));
    const list = await screen.findByRole('list', { name: 'Pages' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(rows[0]!.textContent).toContain('Council fares review: summary of the evidence');
    expect(rows[0]!.textContent).toContain('council.example.org');
    expect(rows[0]!.textContent).toContain('Government or regulator');
    expect(rows[0]!.textContent).toContain('Authority estimate: High');
    expect(rows[0]!.textContent).toContain('Published 10 Feb 2026');
    expect(rows[0]!.textContent).toContain('Updated 2 Mar 2026');
    // Read, and not judged: while it reads, a page has not been used or set aside yet.
    expect(within(rows[0]!).getByText('Read')).toBeTruthy();
    expect(rows[0]!.textContent).not.toContain('not used');
    // A page that states no date has none.
    expect(rows[2]!.textContent).not.toMatch(/Published|Updated/u);
    expect(rows[2]!.textContent).toContain('1 warning');
  });
});

describe('pausing, finishing early and cancelling', () => {
  it('pauses and resumes, the page following what the server says each time', async () => {
    const { user, calls } = open(viewOf(runningAt('reading')));
    await user.click(await screen.findByRole('button', { name: 'Pause' }));
    expect(calls.pause).toHaveBeenCalledWith(expect.any(String), expect.any(AbortSignal));
    await screen.findByRole('button', { name: 'Resume' });
    expect(chip()?.textContent).toBe('Paused');
    expect(stageNamed('Reading').getAttribute('data-state')).toBe('paused');
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Resume' }));
    await screen.findByRole('button', { name: 'Pause' });
    expect(calls.resume).toHaveBeenCalledTimes(1);
    expect(chip()?.textContent).toBe('Reading');
  });

  it('finishes early with what was found', async () => {
    const { user, calls, workspace } = open(viewOf(runningAt('reading')));
    await user.click(await screen.findByRole('button', { name: 'Finish early' }));
    expect(calls.finish).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(stageNamed('Ready').getAttribute('data-state')).toBe('done'));
    // The run has ended: the project is read again, since its sources are what the run made.
    expect(workspace.refresh).toHaveBeenCalled();
  });

  it('asks before it cancels, and cancels only when it is told to', async () => {
    const { user, calls } = open(viewOf(runningAt('reading')));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    const asking = await screen.findByRole('dialog', { name: 'Cancel the research' });
    expect(asking.textContent).toContain(
      'Finish early stops reading and goes on with what was found',
    );

    await user.click(within(asking).getByRole('button', { name: 'Keep going' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.cancel).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Cancel the research' })).getByRole(
        'button',
        {
          name: 'Cancel research',
        },
      ),
    );
    expect(calls.cancel).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(chip()?.textContent).toBe('Stopped'));
    expect(screen.getByRole('button', { name: 'Research again' })).toBeTruthy();
  });

  it('offers only what the server says a person may do', async () => {
    open(viewOf(runningAt('reading'), { may: { start: false, pause: false, cancel: false } }));
    await screen.findByRole('list', { name: 'Research progress' });
    for (const name of ['Pause', 'Resume', 'Finish early', 'Cancel', 'Start research']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.queryByRole('textbox', { name: 'Site or page to add' })).toBeNull();
  });

  it('says why a request was refused, once, and lets it go', async () => {
    const { user, calls } = open(viewOf(runningAt('reading')));
    calls.pause.mockRejectedValue(
      new ApiError('Another operation is still awaiting a response.', 'BUSY'),
    );
    await user.click(await screen.findByRole('button', { name: 'Pause' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Another operation is still awaiting a response.');
    await user.click(within(alert).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('a project that has not been researched', () => {
  it('shows what would happen, none of it reached, and starts the research on one press', async () => {
    const { user, calls } = open(viewOf(null), { project: questionOnly('pending') });
    await screen.findByRole('list', { name: 'Research progress' });
    expect(chip()?.textContent).toBe('Not started');
    expect(
      within(tracker())
        .getAllByRole('listitem')
        .every((item) => item.getAttribute('data-state') === 'waiting'),
    ).toBe(true);
    expect(screen.queryByText('No source text')).toBeNull();
    // Finding sources from a question alone needs a provider that is not there, and the page says so before it starts.
    expect(screen.getByText(/not set up here/u)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Start research' }));
    expect(calls.start).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(chip()?.textContent).toBe('Queued'));
  });

  it('starts from a site or a page that is named, as the intake of the run', async () => {
    const { user, calls } = open(viewOf(null), { project: questionOnly('pending') });
    await user.type(
      await screen.findByRole('textbox', { name: 'Site or page to add' }),
      'regulator.example.org',
    );
    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(calls.start).toHaveBeenCalledWith(
      expect.any(String),
      { intake: { auto: true, domain: 'regulator.example.org' } },
      expect.any(AbortSignal),
    );
  });

  it('reads while it waits, and says when it could not read, with a way to try again', async () => {
    const get = vi
      .spyOn(researchApi, 'get')
      .mockRejectedValueOnce(new Error('Cannot reach the local server.'));
    const view = renderWithApp(<GroundScene />, {
      workspace: { project: questionOnly('pending'), config: CONFIG },
    });
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Cannot reach the local server.',
    );
    expect(screen.queryByText('No source text')).toBeNull();

    get.mockResolvedValue(viewOf(null));
    await view.user.click(screen.getAllByRole('button', { name: 'Try again' })[0]!);
    expect(await screen.findByRole('button', { name: 'Start research' })).toBeTruthy();
  });
});

describe('a search from a question alone that cannot go on', () => {
  const blocked = () =>
    viewOf(
      runningAt('finding-sources', {
        status: 'blocked',
        stoppedBecause: 'discovery-unconfigured',
        sources: [],
      }),
    );

  it('says so plainly and calmly, with the server’s own words, and gives the manual ways on', async () => {
    const { user } = open(blocked(), { project: questionOnly('cancelled') });
    await screen.findByRole('list', { name: 'Research progress' });
    // Waiting for a source that a person can give is not a refusal, and is not drawn as one.
    expect(chip()?.textContent).toBe('Needs a source');
    expect(document.querySelector('.sw-notice--info')?.textContent).toContain(
      'Swarm cannot find sources from a question alone',
    );
    const text = document.body.textContent ?? '';
    expect(text).toContain('Swarm cannot find sources from a question alone');
    expect(text).toContain('does not search the web on its own');
    expect(text).toContain(NO_PROVIDER.message);
    expect(stageNamed('Finding sources').getAttribute('data-state')).toBe('blocked');
    expect(stageNamed('Finding sources').getAttribute('data-calm')).toBe('true');
    expect(stageNamed('Finding sources').textContent).toContain('Needs a search provider');
    // Nothing was read, and the page does not pretend a list of pages.
    expect(screen.queryByRole('list', { name: 'Pages' })).toBeNull();

    // The plan's suggestions are there to add, never read on their own.
    expect(
      screen.getByRole('button', { name: 'Add this site: regulator.example.org' }),
    ).toBeTruthy();
    // The way on that the head of the page offers takes the person to the field that names a site.
    await user.click(screen.getByRole('button', { name: 'Add a site or page' }));
    expect(document.activeElement).toBe(
      screen.getByRole('textbox', { name: 'Site or page to add' }),
    );
    // Sources of one's own are pasted or attached here.
    expect(screen.getByRole('button', { name: 'Paste or attach' })).toBeTruthy();
  });

  const TEXT =
    'Illustrative note written for a test. The ferry operator says that evening crossings are the least used, and that a cut in fares might fill them.';

  async function paste(user: ReturnType<typeof open>['user'], name = 'operator-note.txt') {
    await user.click(screen.getByRole('button', { name: 'Paste or attach' }));
    await user.click(await screen.findByRole('radio', { name: 'Paste' }));
    const filename = await screen.findByRole('textbox', { name: 'Source filename' });
    await user.clear(filename);
    await user.type(filename, name);
    await user.click(screen.getByRole('textbox', { name: 'Source text, not your question' }));
    await user.paste(TEXT);
    await user.click(screen.getByRole('button', { name: 'Attach' }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
  }

  it('adds text a person pastes as a source of the project, as it was written, and reads the project again', async () => {
    const add = vi.spyOn(researchApi, 'addDocuments').mockResolvedValue(undefined);
    const { user, workspace } = open(blocked(), { project: questionOnly('cancelled') });
    await screen.findByRole('list', { name: 'Research progress' });
    await paste(user);
    const listed = screen.getByRole('list', { name: 'Sources to add' });
    expect(listed.textContent).toContain('operator-note.txt');
    expect(add).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Use this source' }));
    // The text goes as it is, with a name: no address, no time, nothing that says it was read from the web.
    expect(add).toHaveBeenCalledWith(
      expect.any(String),
      [expect.objectContaining({ name: 'operator-note.txt', content: TEXT })],
      expect.any(AbortSignal),
    );
    expect(Object.keys(add.mock.calls[0]![1][0]!).sort()).toEqual(['content', 'name']);
    await waitFor(() => expect(workspace.refresh).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Sources to add' })).toBeNull());
  });

  it('keeps what was pasted, and says why, when the server will not take it', async () => {
    vi.spyOn(researchApi, 'addDocuments').mockRejectedValue(
      new ApiError(
        'This project already holds 10 sources, the most it can. Remove one first.',
        'DOCUMENT_LIMIT',
      ),
    );
    const { user } = open(blocked(), { project: questionOnly('cancelled') });
    await screen.findByRole('list', { name: 'Research progress' });
    await paste(user);
    await user.click(screen.getByRole('button', { name: 'Use this source' }));
    expect((await screen.findByRole('alert')).textContent).toContain('already holds 10 sources');
    expect(screen.getByRole('list', { name: 'Sources to add' }).textContent).toContain(
      'operator-note.txt',
    );
  });

  it('sends a person who cannot add here to the question again, with room for sources', async () => {
    const { user, workspace } = open(
      { ...blocked(), may: { start: false, pause: false, cancel: false } },
      { project: questionOnly('running') },
    );
    await screen.findByRole('list', { name: 'Research progress' });
    expect(screen.queryByRole('button', { name: 'Paste or attach' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open the question to add sources' }));
    expect(workspace.duplicate).toHaveBeenCalledTimes(1);
  });

  it('adds a suggested site only when asked to, says it was added, and says when a page of it was already read', async () => {
    const held = runningAt('finding-sources', {
      status: 'blocked',
      stoppedBecause: 'discovery-unconfigured',
      sources: [
        source(1, {
          requestedUrl: 'https://docs.operator.example.org/fares',
          finalUrl: 'https://docs.operator.example.org/fares',
          outcome: 'read',
        }),
      ],
    });
    const { user, calls } = open(viewOf(held), { project: questionOnly('cancelled') });
    await screen.findByRole('list', { name: 'Research progress' });
    expect(calls.addSource).not.toHaveBeenCalled();
    // A site that a page was read from is not offered again.
    expect(screen.getByText('Already read')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Add this site: operator.example.org' }),
    ).toBeNull();
    // The plan names a kind of source and no site: there is nothing to add.
    expect(screen.getByText('Studies of fare changes on ferry routes')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Add this site: regulator.example.org' }));
    expect(calls.addSource).toHaveBeenCalledWith(
      expect.any(String),
      'https://regulator.example.org',
      expect.any(AbortSignal),
    );
    // What was named is a run of its own, and the page follows it.
    await waitFor(() => expect(chip()?.textContent).toBe('Queued'));
    expect(
      screen.queryByRole('button', { name: 'Add this site: regulator.example.org' }),
    ).toBeNull();
  });

  it('names no site while a run is under way, because what is named is a run of its own, and says when it can be', async () => {
    open(viewOf(runningAt('reading')));
    await screen.findByRole('list', { name: 'Research progress' });
    expect(screen.queryByRole('textbox', { name: 'Site or page to add' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Add this site/u })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a site or page' })).toBeNull();
    expect(document.body.textContent).toContain('once the research has stopped');
    // The plan's suggestions are still there to read.
    expect(screen.getByText('The regulator’s published fare rules')).toBeTruthy();
  });
});

describe('naming a site or a page', () => {
  const stopped = () =>
    viewOf(runningAt('reading', { status: 'cancelled', stoppedBecause: 'cancelled' }));

  it('sends an address the person typed, as an address, and the page follows the run that it starts', async () => {
    const { user, calls } = open(stopped());
    const field = await screen.findByRole<HTMLInputElement>('textbox', {
      name: 'Site or page to add',
    });
    await user.type(field, 'example.org');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(calls.addSource).toHaveBeenCalledWith(
      expect.any(String),
      'https://example.org',
      expect.any(AbortSignal),
    );
    await waitFor(() => expect(chip()?.textContent).toBe('Queued'));
    expect(screen.queryByRole('textbox', { name: 'Site or page to add' })).toBeNull();
  });

  it('says what is wrong with what is not an address, and sends nothing', async () => {
    const { user, calls } = open(stopped());
    const field = await screen.findByRole('textbox', { name: 'Site or page to add' });
    await user.type(field, 'javascript:alert(1)');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'does not look like a web address',
    );
    expect(calls.addSource).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(field);
  });

  it('shows the server’s refusal beside the field, and keeps what was typed', async () => {
    const { user, calls } = open(stopped());
    calls.addSource.mockRejectedValue(
      new ApiError('That address is on a private network, which Swarm never reads.', 'URL_BLOCKED'),
    );
    const field = await screen.findByRole<HTMLInputElement>('textbox', {
      name: 'Site or page to add',
    });
    await user.type(field, 'https://10.0.0.5/status');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect((await screen.findByRole('alert')).textContent).toContain('private network');
    expect(field.value).toBe('https://10.0.0.5/status');
  });
});

describe('what became of each page', () => {
  async function finished() {
    const held = viewOf(completed({ sources: pages() }));
    const view = open(held, { project: questionOnly('running') });
    await screen.findByRole('list', { name: 'Pages' });
    return view;
  }
  const row = (text: string) =>
    within(pageList())
      .getAllByRole('listitem')
      .find((item) => item.textContent?.includes(text))!;

  it('gives each a state and, for each that was set aside, its reason in plain words and the server’s own', async () => {
    await finished();
    expect(
      within(row('Council fares review: summary of the evidence (print')).getByText('Duplicate'),
    ).toBeTruthy();
    expect(row('(print version)').textContent).toContain(
      'It repeats a page that was already read.',
    );

    const login = row('members.example.org/login');
    expect(within(login).getByText('Quarantined')).toBeTruthy();
    expect(login.textContent).toContain('It asks for a sign-in, so there was nothing to read.');
    expect(login.textContent).toContain('“The page asks for a member sign-in.”');

    const injected = row('Fares explained');
    expect(within(injected).getByText('Instruction-like text')).toBeTruthy();
    expect(injected.textContent).toContain('Its text tries to give instructions to an AI system');

    expect(within(row('private.example.org')).getByText('Blocked')).toBeTruthy();
    expect(row('private.example.org').textContent).toContain('robots.txt asks not to be read');
    expect(within(row('slow.example.org')).getByText('Failed')).toBeTruthy();
    expect(row('slow.example.org').textContent).toContain('The site took too long to answer.');
    expect(row('Riders talk').textContent).toContain('Read, and not used as a source.');
  });

  it('shows only the pages that were used, or only those that were not, when asked', async () => {
    const { user } = await finished();
    expect(within(pageList()).getAllByRole('listitem')).toHaveLength(8);
    await user.click(screen.getByRole('radio', { name: /^Used 2/u }));
    expect(within(pageList()).getAllByRole('listitem')).toHaveLength(2);
    await user.click(screen.getByRole('radio', { name: /^Not used 6/u }));
    expect(within(pageList()).getAllByRole('listitem')).toHaveLength(6);
    await user.click(screen.getByRole('radio', { name: /^All 8/u }));
    expect(within(pageList()).getAllByRole('listitem')).toHaveLength(8);
  });

  it('says where a page came from, how it was read and what to know before relying on it, in a popover', async () => {
    const { user } = await finished();
    await user.click(
      screen.getByRole('button', {
        name: 'Provenance: Riders talk about cheaper evening crossings',
      }),
    );
    const card = await screen.findByRole('dialog', {
      name: 'Provenance of Riders talk about cheaper evening crossings',
    });
    const text = card.textContent ?? '';
    expect(text).toContain('https://forum.example.org/threads/evening-fares');
    expect(text).toContain('Content hash');
    expect(text).toMatch(/SHA-256 [0-9a-f]{64}/u);
    expect(text).toContain('The site’s robots.txt allows it.');
    expect(text).toContain('The main text of the page.');
    expect(text).toContain('A link on a page it had read.');
    expect(text).toContain('Only the first page of the thread was read.');
    // What the authority is, is said where the pages are, and once.
    expect(pageList().parentElement?.textContent).toContain(
      'says nothing about whether a page is right',
    );
    const link = within(card).getByRole('link', { name: /Open the page/u });
    expect(link.getAttribute('href')).toBe('https://forum.example.org/threads/evening-fares');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('target')).toBe('_blank');
  });
});

describe('what a page says of itself', () => {
  it('is text and nothing else: markup in a title is shown as it was written, and no address but a web address is a link', async () => {
    const hostile = viewOf(
      runningAt('reading', {
        sources: [
          source(1, {
            title: '<img src=x onerror="window.__pwned = 1"> <script>window.__pwned = 2</script>',
            finalUrl: 'javascript:window.__pwned=3',
            requestedUrl: 'javascript:window.__pwned=3',
            outcome: 'read',
            warnings: ['<b>bold</b> is not bold'],
          }),
        ],
      }),
    );
    const { user } = open(hostile);
    const list = await screen.findByRole('list', { name: 'Pages' });
    expect(list.textContent).toContain('<img src=x onerror="window.__pwned = 1">');
    expect(list.querySelector('img, script, b')).toBeNull();

    await user.click(screen.getByRole('button', { name: /^Provenance: / }));
    const card = await screen.findByRole('dialog');
    expect(card.querySelector('img, script, b')).toBeNull();
    expect(within(card).queryByRole('link')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });
});

describe('a run that failed, and one that was stopped', () => {
  it('says that research could not finish, with the last thing it said as text, and starts again on one press', async () => {
    const failed = viewOf(
      runningAt('extracting-evidence', {
        status: 'failed',
        events: [
          {
            at: '2026-03-14T10:29:20.000Z',
            stage: 'extracting-evidence',
            level: 'block',
            message: 'The reader stopped on a page it could not take apart.',
          },
        ],
      }),
    );
    const { user, calls } = open(failed, { project: questionOnly('failed') });
    await screen.findByRole('list', { name: 'Research progress' });
    expect(chip()?.textContent).toBe('Failed');
    expect(stageNamed('Extracting evidence').getAttribute('data-state')).toBe('failed');
    expect(document.body.textContent).toContain('Research could not finish');
    expect(document.body.textContent).toContain(
      '“The reader stopped on a page it could not take apart.”',
    );
    // The head of the page is the run's: the evidence's own failure is not said a second time.
    expect(screen.queryByText('Reading the sources failed')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(calls.start).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(chip()?.textContent).toBe('Queued'));
  });

  it('keeps the pages that were read, and says that a person stopped it', async () => {
    open(viewOf(runningAt('reading', { status: 'cancelled', stoppedBecause: 'cancelled' })), {
      project: questionOnly('cancelled'),
    });
    await screen.findByRole('list', { name: 'Pages' });
    expect(chip()?.textContent).toBe('Stopped');
    expect(document.body.textContent).toContain('Research was stopped');
    expect(document.body.textContent).toContain('A person stopped the research.');
    expect(within(pageList()).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Research again' })).toBeTruthy();
  });
});

describe('a run that is being followed', () => {
  it('says that updates have paused when a read fails, keeps what was read, and reads again when asked', async () => {
    vi.useFakeTimers();
    const get = vi.spyOn(researchApi, 'get').mockResolvedValue(viewOf(runningAt('reading')));
    renderWithApp(<GroundScene />, { workspace: { project: questionOnly(), config: CONFIG } });
    const later = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
    await later(50);
    expect(screen.getByRole('list', { name: 'Research progress' })).toBeTruthy();

    get.mockRejectedValue(
      new ApiError('The server took too long to respond. Try again.', 'TIMEOUT'),
    );
    await later(1_600);
    const notice = screen.getByText('Updates have paused').closest('.sw-notice')!;
    expect(notice.textContent).toContain('Showing what was last read.');
    expect(within(pageList()).getAllByRole('listitem')).toHaveLength(4);

    get.mockResolvedValue(viewOf(runningAt('extracting-evidence')));
    await later(2_100);
    expect(screen.queryByText('Updates have paused')).toBeNull();
    expect(chip()?.textContent).toBe('Extracting evidence');
  });
});

describe('research that has finished, in a project that has its sources', () => {
  const finishedAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  const finishedView = (days = 0) =>
    viewOf(
      completed({
        finishedAt: finishedAgo(days),
        updatedAt: finishedAgo(days),
        sources: pages().map((page, index) =>
          page.outcome === 'used' ? { ...page, documentId: `D${index + 1}` } : page,
        ),
      }),
    );

  it('leaves the head of the page as it was, and keeps the research after the sources, as the record of how they were found', async () => {
    const { workspace } = open(finishedView(), { project: groundProject('ready') });
    const record = await screen.findByRole('region', { name: /^Research/u });
    await screen.findByRole('region', { name: /^Sources/u });
    expect(chip()?.getAttribute('data-moment')).toBe('ready');
    expect(screen.getByRole('button', { name: 'Map the stakeholders' })).toBeTruthy();
    const sources = screen.getByRole('region', { name: /^Sources/u });
    expect(sources.compareDocumentPosition(record) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(record.textContent).toContain(
      'Why it stopped: The key claims have supporting or opposing evidence.',
    );
    // Settled research is not a thing to start again from the top of the page.
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(workspace.refresh).not.toHaveBeenCalled();
  });

  it('links a page that was used to the document it became, and the conflicts that were found to the conflicts', async () => {
    const { user, workspace } = open(finishedView(), { project: groundProject('ready') });
    const record = await screen.findByRole('region', { name: /^Research/u });
    await user.click(
      within(record).getByRole('button', {
        name: /^Council fares review: summary of the evidence, open the source/u,
      }),
    );
    expect(await screen.findByRole('dialog')).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    expect(record.textContent).toContain('1 possible conflict was found among what was read.');
    await user.click(within(record).getByRole('button', { name: 'Review it' }));
    expect(workspace.setView).toHaveBeenCalledWith('conflicts');
  });

  it('says that it may be out of date when the question moves and the research is old, and offers to do it again', async () => {
    const { user, calls } = open(finishedView(30), { project: groundProject('ready') });
    const record = await screen.findByRole('region', { name: /^Research/u });
    expect(record.textContent).toContain('This research may be out of date');
    expect(record.textContent).toContain('It finished 30 days ago');
    await user.click(within(record).getByRole('button', { name: 'Research again' }));
    expect(calls.start).toHaveBeenCalledTimes(1);
  });

  it('opens the question again when the research is old and the server will not start another run', async () => {
    const held = finishedView(30);
    const { user, calls, workspace } = open(
      { ...held, may: { start: false, pause: false, cancel: false } },
      { project: groundProject('ready') },
    );
    const record = await screen.findByRole('region', { name: /^Research/u });
    expect(record.textContent).toContain('This research may be out of date');
    expect(within(record).queryByRole('button', { name: 'Research again' })).toBeNull();
    await user.click(within(record).getByRole('button', { name: 'Open the question again' }));
    expect(workspace.duplicate).toHaveBeenCalledTimes(1);
    expect(calls.start).not.toHaveBeenCalled();
  });

  it('says nothing of being out of date for research that is recent', async () => {
    open(finishedView(1), { project: groundProject('ready') });
    const record = await screen.findByRole('region', { name: /^Research/u });
    expect(record.textContent).not.toContain('out of date');
  });
});

describe('where there is nothing to say', () => {
  it('draws the page as it always was where the server does not research', async () => {
    const get = vi.spyOn(researchApi, 'get');
    renderWithApp(<GroundScene />, {
      workspace: { project: groundProject('ready'), config: null },
    });
    await screen.findByRole('region', { name: /^Sources/u });
    expect(get).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: /^Research/u })).toBeNull();
    expect(chip()?.getAttribute('data-moment')).toBe('ready');
  });

  it('draws nothing of research for sources a person attached, that have no run', async () => {
    open(viewOf(null), { project: groundProject('ready') });
    await screen.findByRole('region', { name: /^Sources/u });
    await waitFor(() => expect(researchApi.get).toHaveBeenCalled());
    expect(screen.queryByRole('region', { name: /^Research/u })).toBeNull();
    expect(screen.getByRole('button', { name: 'Map the stakeholders' })).toBeTruthy();
    expect(passagesOf(groundProject('ready'))).toHaveLength(2);
  });

  it('draws nothing of research for sources a person attached when research cannot be read, and does not say so', async () => {
    vi.spyOn(researchApi, 'get').mockRejectedValue(new Error('Not found.'));
    renderWithApp(<GroundScene />, {
      workspace: { project: groundProject('ready'), config: CONFIG },
    });
    await screen.findByRole('region', { name: /^Sources/u });
    await waitFor(() => expect(researchApi.get).toHaveBeenCalled());
    expect(screen.queryByRole('region', { name: /^Research/u })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the words of the page', () => {
  it('make no prediction and no claim about the world in any state', async () => {
    const states: [string, ResearchView, ProjectDetail][] = [
      ['empty', viewOf(null), questionOnly('pending')],
      ['planning', viewOf(runningAt('planning')), questionOnly()],
      ['reading', viewOf(runningAt('reading')), questionOnly()],
      ['paused', viewOf(runningAt('reading', { status: 'paused' })), questionOnly()],
      [
        'blocked',
        viewOf(
          runningAt('finding-sources', {
            status: 'blocked',
            stoppedBecause: 'discovery-unconfigured',
            sources: [],
          }),
        ),
        questionOnly('cancelled'),
      ],
      ['failed', viewOf(runningAt('reading', { status: 'failed' })), questionOnly('failed')],
      ['completed', viewOf(completed()), groundProject('ready')],
    ];
    for (const [name, held, project] of states) {
      const view = open(held, { project });
      await screen.findByRole('region', { name: /^Research/u });
      const text = (screen.getByRole('region', { name: /^Research/u }).textContent ?? '').replace(
        /([a-z.])([A-Z])/gu,
        '$1. $2',
      );
      expect(claimsAgainst(text), name).toEqual([]);
      view.unmount();
    }
  });
});

describe('keyboard and screen reader', () => {
  it('names the progress, marks the stage in progress, and says the state of the run once, politely', async () => {
    open(viewOf(runningAt('reading')));
    await screen.findByRole('list', { name: 'Research progress' });
    const live = screen
      .getAllByRole('status')
      .filter((node) => node.textContent?.startsWith('Research:'));
    expect(live).toHaveLength(1);
    expect(live[0]!.textContent).toBe('Research: Reading.');
    expect(screen.getByRole('region', { name: /^Research/u })).toBeTruthy();
  });

  it('reaches every control by the keyboard, in the order of the page', async () => {
    const { user } = open(viewOf(runningAt('reading')));
    await screen.findByRole('button', { name: 'Pause' });
    const order: string[] = [];
    // The top bar comes first; what is asked is that the three controls follow one another.
    for (let step = 0; step < 40 && order.length < 3; step += 1) {
      await user.tab();
      const name = document.activeElement?.textContent?.trim() ?? '';
      if (['Pause', 'Finish early', 'Cancel'].includes(name)) order.push(name);
    }
    expect(order).toEqual(['Pause', 'Finish early', 'Cancel']);
  });
});
