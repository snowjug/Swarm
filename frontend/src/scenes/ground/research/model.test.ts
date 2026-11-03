import { describe, expect, it } from 'vitest';
import {
  FETCH_ERROR_CLASSES,
  QUARANTINE_REASONS,
  RESEARCH_STAGES,
  SOURCE_OUTCOMES,
} from '../../../../../shared/research';
import { claimsAgainst } from '../../../../../e2e/support/claims';
import { completed, MAY, NOW, pages, run, runningAt, source, view } from './fixtures';
import {
  addressFromInput,
  agedBy,
  budgetLines,
  controlsOf,
  countersOf,
  datesOf,
  filterSources,
  formatBytes,
  formatDay,
  linkOf,
  presenceOf,
  reasonOf,
  recordWords,
  runNotice,
  shortAddress,
  sourceTitle,
  stageItems,
  statusWords,
  suggestionsOf,
  takesOver,
} from './model';
import * as words from './words';

const states = (items: ReturnType<typeof stageItems>) => items.map((item) => item.state);

describe('the stages of a run', () => {
  it('are all waiting where there is no run: what would happen, and none of it reached', () => {
    expect(states(stageItems(null))).toEqual(Array(6).fill('waiting'));
    expect(stageItems(null).every((item) => item.detail === null)).toBe(true);
  });

  it('show only the stages that were reached: done before, live at the stage the run is in, waiting after', () => {
    const items = stageItems(runningAt('reading'));
    expect(states(items)).toEqual(['done', 'done', 'active', 'waiting', 'waiting', 'waiting']);
    expect(items.map((item) => item.id)).toEqual([...RESEARCH_STAGES]);
    expect(items[0]!.detail).toBe('4 topics · 2 claims to check');
    expect(items[2]!.detail).toBe('4 read · up to 12');
    expect(items[3]!.detail).toBeNull();
  });

  it('hold at the stage where a run was paused, blocked, stopped or failed, and never move on from it', () => {
    const at = (status: 'paused' | 'blocked' | 'cancelled' | 'failed') =>
      states(stageItems(runningAt('finding-sources', { status })));
    expect(at('paused')).toEqual(['done', 'paused', 'waiting', 'waiting', 'waiting', 'waiting']);
    expect(at('blocked')).toEqual(['done', 'blocked', 'waiting', 'waiting', 'waiting', 'waiting']);
    expect(at('cancelled')).toEqual([
      'done',
      'stopped',
      'waiting',
      'waiting',
      'waiting',
      'waiting',
    ]);
    expect(at('failed')).toEqual(['done', 'failed', 'waiting', 'waiting', 'waiting', 'waiting']);
  });

  it('say where a run stopped, before what it held there, and say nothing of the sort for a run that goes on', () => {
    const stopped = (status: 'cancelled' | 'failed') =>
      stageItems(runningAt('extracting-evidence', { status })).map((item) => item.detail);
    expect(stopped('failed')[3]).toMatch(/^Stopped here · \d+ passages$/u);
    expect(stopped('cancelled')[3]).toMatch(/^Stopped here/u);
    expect(stageItems(runningAt('extracting-evidence'))[3]!.detail).not.toContain('Stopped here');
    expect(
      stageItems(runningAt('extracting-evidence', { status: 'paused' }))[3]!.detail,
    ).not.toContain('Stopped here');
  });

  it('say that a queued run has not started, and that a blocked search needs a provider', () => {
    const queued = stageItems(run({ status: 'queued', stage: 'planning', plan: null }));
    expect(states(queued)[0]).toBe('waiting');
    expect(queued[0]!.detail).toBe('Waiting to start');
    const blocked = stageItems(
      runningAt('finding-sources', { status: 'blocked', stoppedBecause: 'discovery-unconfigured' }),
    );
    expect(blocked[1]!.detail).toBe('Needs a search provider');
  });

  it('are all done for a run that completed, with what each produced', () => {
    const items = stageItems(completed());
    expect(states(items)).toEqual(Array(6).fill('done'));
    expect(items[4]!.detail).toBe('1 conflict');
    expect(items[5]!.detail).toBe('2 sources used');
    expect(items[3]!.detail).toBe('11 passages');
  });

  it('say a count of conflicts only once the run has compared what it read', () => {
    expect(countersOf(runningAt('reading')).conflicts).toBeNull();
    expect(countersOf(runningAt('checking-conflicts', { conflictCount: 0 })).conflicts).toBe(0);
    expect(stageItems(runningAt('checking-conflicts', { conflictCount: 0 }))[4]!.detail).toBe(
      'No conflicts found',
    );
    expect(countersOf(completed()).conflicts).toBe(1);
  });
});

describe('the counters', () => {
  it('are what the run holds: pages read, the pages that became sources, sites', () => {
    expect(countersOf(completed())).toEqual({
      pagesRead: 7,
      sourcesUsed: 2,
      sites: 5,
      conflicts: 1,
    });
    expect(countersOf(null)).toEqual({ pagesRead: 0, sourcesUsed: 0, sites: 0, conflicts: null });
  });
});

describe('what the first screen is about', () => {
  const ran = view(completed());
  const read = (documents: number, overrides = {}) =>
    presenceOf({ enabled: true, documents, view: ran, loading: false, error: null, ...overrides });

  it('says nothing of research for a project of the person’s own sources that has no run, or where it is off', () => {
    expect(
      presenceOf({ enabled: true, documents: 2, view: view(null), loading: false, error: null })
        .kind,
    ).toBe('off');
    expect(read(2, { enabled: false }).kind).toBe('off');
    expect(read(2, { view: null, loading: true }).kind).toBe('off');
    expect(read(2, { view: null, loading: false, error: 'No.' }).kind).toBe('off');
  });

  it('waits, fails and invites for a project that has no sources, since only research can give it any', () => {
    expect(read(0, { view: null, loading: true }).kind).toBe('loading');
    expect(read(0, { view: null, loading: false, error: 'It failed.' })).toEqual({
      kind: 'unavailable',
      error: 'It failed.',
    });
    expect(read(0, { view: view(null) }).kind).toBe('empty');
  });

  it('takes the head of the page for a run that is under way and for any run of a project with no sources', () => {
    expect(takesOver(read(0), 0)).toBe(true);
    expect(takesOver(read(3), 3)).toBe(false);
    expect(
      takesOver(
        presenceOf({ enabled: true, documents: 3, view: view(run()), loading: false, error: null }),
        3,
      ),
    ).toBe(true);
    expect(takesOver({ kind: 'off' }, 0)).toBe(false);
    expect(takesOver({ kind: 'empty', view: view(null) }, 0)).toBe(true);
  });

  it('words the status by the stage the run is in, and by what stopped it', () => {
    const word = (status: string, stage = 'reading') =>
      statusWords(
        presenceOf({
          enabled: true,
          documents: 0,
          view: view(runningAt(stage as 'reading', { status: status as 'running' })),
          loading: false,
          error: null,
        }),
      )?.label;
    expect(word('running')).toBe('Reading');
    expect(word('running', 'extracting-evidence')).toBe('Extracting evidence');
    expect(word('queued')).toBe('Queued');
    expect(word('paused')).toBe('Paused');
    expect(word('blocked')).toBe('Blocked');
    expect(word('cancelled')).toBe('Stopped');
    expect(word('failed')).toBe('Failed');
    expect(word('completed')).toBe('Researched');
    expect(statusWords({ kind: 'off' })).toBeNull();
  });

  it('says that a search with nowhere to look needs a source, in no colour of trouble, and a refusal is blocked', () => {
    const words = (stoppedBecause: 'discovery-unconfigured' | 'safety-block') =>
      statusWords(
        presenceOf({
          enabled: true,
          documents: 0,
          view: view(
            runningAt('finding-sources', { status: 'blocked', stoppedBecause, sources: [] }),
          ),
          loading: false,
          error: null,
        }),
      );
    expect(words('discovery-unconfigured')).toMatchObject({
      label: 'Needs a source',
      tone: 'neutral',
      icon: null,
    });
    expect(words('safety-block')).toMatchObject({ label: 'Blocked', tone: 'caution' });
    const held = stageItems(
      runningAt('finding-sources', {
        status: 'blocked',
        stoppedBecause: 'discovery-unconfigured',
      }),
    );
    expect(held[1]).toMatchObject({ state: 'blocked', calm: true });
    expect(
      stageItems(
        runningAt('finding-sources', { status: 'blocked', stoppedBecause: 'safety-block' }),
      )[1]!.calm,
    ).toBeUndefined();
  });
});

describe('what a person may do', () => {
  const at = (status: 'queued' | 'running' | 'paused' | 'completed' | 'failed', may = MAY) =>
    controlsOf(view(run({ status }), { may }));

  it('follows the state of the run: pause and finish while it runs, resume while it is paused, start when it is not live', () => {
    expect(at('running')).toMatchObject({
      pause: true,
      resume: false,
      finish: true,
      cancel: true,
      start: false,
      add: false,
    });
    expect(at('paused')).toMatchObject({
      pause: false,
      resume: true,
      finish: true,
      cancel: true,
      start: false,
      add: false,
    });
    expect(at('queued')).toMatchObject({
      pause: false,
      resume: false,
      finish: false,
      cancel: true,
      start: false,
      add: false,
    });
    expect(at('completed')).toMatchObject({
      pause: false,
      finish: false,
      cancel: false,
      start: true,
      add: true,
    });
    expect(at('failed')).toMatchObject({ start: true, add: true });
  });

  it('names a site or a page where a run may start, because what is named is a run of its own', () => {
    const idle = { start: true, pause: false, cancel: false };
    expect(at('running', { ...MAY, start: true }).add).toBe(false);
    expect(at('completed', idle).add).toBe(true);
    expect(at('completed', { ...idle, start: false }).add).toBe(false);
  });

  it('offers nothing to a person the server says may do nothing, and never more than the server allows', () => {
    const none = { start: false, pause: false, cancel: false };
    expect(Object.values(at('running', none)).every((on) => !on)).toBe(true);
    expect(at('running', { start: false, pause: false, cancel: true })).toMatchObject({
      pause: false,
      // A run that is past reading cannot be cut short: it can only be stopped.
      finish: false,
      cancel: true,
    });
    // Whoever may cancel may let a paused run go on, or finish it, however the server counts pausing.
    expect(at('paused', { start: false, pause: false, cancel: true })).toMatchObject({
      resume: true,
      finish: true,
    });
    expect(controlsOf(null).add).toBe(false);
  });
});

describe('pages', () => {
  it('are told apart as used and not used, and filtered so', () => {
    const all = pages();
    expect(filterSources(all, 'all')).toHaveLength(all.length);
    expect(filterSources(all, 'used').map((page) => page.outcome)).toEqual(['used', 'used']);
    expect(filterSources(all, 'other')).toHaveLength(all.length - 2);
  });

  it('are called by their title, or else by where they are', () => {
    expect(sourceTitle(source(1, { title: ' A title ' }))).toBe('A title');
    expect(
      sourceTitle(source(2, { title: null, finalUrl: 'https://www.example.org/a/b?x=1' })),
    ).toBe('example.org/a/b?x=1');
    expect(sourceTitle(source(3, { title: '', finalUrl: null, requestedUrl: '' }))).toBe(
      'Untitled page',
    );
    expect(shortAddress('https://example.org/' + 'x'.repeat(100), 20)).toHaveLength(20);
    expect(shortAddress('not an address')).toBe('not an address');
  });

  it('only link to a web address, never to a script or to a file', () => {
    expect(linkOf(source(1, { finalUrl: 'https://example.org/a' }))).toBe('https://example.org/a');
    expect(linkOf(source(2, { finalUrl: 'javascript:alert(1)' }))).toBeNull();
    expect(
      linkOf(source(3, { finalUrl: 'data:text/html,hi', requestedUrl: 'data:text/html,hi' })),
    ).toBeNull();
    expect(linkOf(source(4, { finalUrl: null, requestedUrl: 'ftp://example.org/a' }))).toBeNull();
  });

  it('give a reason for every page that was not used, from the enumerations of the contract and the server’s own words', () => {
    for (const reason of QUARANTINE_REASONS) {
      const found = reasonOf(
        source(1, {
          outcome: 'quarantined',
          quarantine: { reason, detail: 'Said by the server.' },
        }),
      );
      expect(found?.sentence, reason).toBe(words.QUARANTINE_SENTENCE[reason]);
      expect(found?.detail).toBe('Said by the server.');
    }
    for (const kind of FETCH_ERROR_CLASSES) {
      expect(
        reasonOf(source(1, { outcome: 'failed', failure: { class: kind, message: '' } }))?.sentence,
        kind,
      ).toBe(words.FAILURE_SENTENCE[kind]);
    }
    expect(reasonOf(source(1))).toBeNull();
    expect(
      reasonOf(source(2, { outcome: 'blocked', failure: null, robots: 'disallowed' }))?.sentence,
    ).toBe(words.ROBOTS_SENTENCE.disallowed);
    for (const outcome of SOURCE_OUTCOMES) {
      expect(words.OUTCOME_LABEL[outcome]).toBeTruthy();
      expect(words.OUTCOME_SENTENCE[outcome]).toBeTruthy();
    }
  });

  it('state the dates the page states and no other, as dates that do not move with the reader’s zone', () => {
    expect(datesOf(source(1, { publishedAt: null, updatedAt: null }))).toEqual([]);
    expect(datesOf(source(1, { publishedAt: '2026-02-10', updatedAt: '2026-03-02' }))).toEqual([
      { label: 'Published', iso: '2026-02-10' },
      { label: 'Updated', iso: '2026-03-02' },
    ]);
    expect(formatDay('2026-02-10')).toBe('10 Feb 2026');
    expect(formatBytes(950)).toBe('950 B');
    expect(formatBytes(18_400)).toBe('18 KB');
    expect(formatBytes(3_200_000)).toBe('3.2 MB');
  });
});

describe('suggestions', () => {
  it('offer an address only for a site that could be one, and say when a page of it was already read', () => {
    const suggestions = suggestionsOf(
      run({
        sources: [
          source(1, {
            finalUrl: 'https://docs.regulator.example.org/rules',
            requestedUrl: 'https://docs.regulator.example.org/rules',
          }),
        ],
      }),
    );
    expect(suggestions.map((entry) => entry.address)).toEqual([
      'https://regulator.example.org',
      'https://operator.example.org',
      null,
    ]);
    expect(suggestions.map((entry) => entry.read)).toEqual([true, false, false]);
    expect(suggestionsOf(run({ plan: null }))).toEqual([]);
  });

  it('never offer something that is not an address, whatever the plan says', () => {
    const plan = runningAt('reading').plan!;
    const odd = run({
      plan: {
        ...plan,
        likelySources: [
          { category: 'community', description: 'A', suggestedDomain: 'javascript:alert(1)' },
          { category: 'community', description: 'B', suggestedDomain: 'localhost' },
          { category: 'community', description: 'C', suggestedDomain: 'has space.org' },
        ],
      },
    });
    expect(suggestionsOf(odd).map((entry) => entry.address)).toEqual([null, null, null]);
  });

  it('read what a person typed as a site or a page, and say what is wrong with what is not', () => {
    expect(addressFromInput('example.org')).toEqual({ address: 'https://example.org' });
    expect(addressFromInput('https://example.org/a/b')).toEqual({
      address: 'https://example.org/a/b',
    });
    expect(addressFromInput('   ')).toEqual({ problem: 'Type a site or a page to add.' });
    expect(addressFromInput('not a site')).toMatchObject({
      problem: expect.stringContaining('web address'),
    });
    expect(addressFromInput('javascript:alert(1)')).toHaveProperty('problem');
  });
});

describe('a run that found nothing, in a project that has sources', () => {
  it('is a record that says the sources are the person’s own, in words that claim nothing', () => {
    const blocked = recordWords(
      runningAt('finding-sources', { status: 'blocked', stoppedBecause: 'discovery-unconfigured' }),
    );
    expect(blocked).toMatch(/could not look for sources from the question alone/u);
    expect(blocked).toMatch(/supplied by you/u);
    expect(
      recordWords(
        runningAt('reading', {
          status: 'blocked',
          stoppedBecause: 'safety-block',
          sources: pages().filter((page) => page.outcome === 'blocked'),
        }),
      ),
    ).toMatch(/the reason for each is listed below/u);
    expect(
      recordWords(completed({ sources: pages().filter((page) => page.outcome !== 'used') })),
    ).toBe('No page was used as a source. The sources above were supplied by you.');
    // A run that found sources, or that is not over, or that was stopped or failed, is not made a record of this kind.
    expect(recordWords(completed())).toBeNull();
    expect(recordWords(runningAt('reading'))).toBeNull();
    expect(recordWords(runningAt('reading', { status: 'cancelled' }))).toBeNull();
    for (const text of [blocked ?? '']) expect(claimsAgainst(text)).toEqual([]);
  });
});

describe('notices', () => {
  const discovery = view(null).discovery;

  it('say plainly why a search from a question alone cannot go on, with the server’s own words under ours', () => {
    const notice = runNotice(
      runningAt('finding-sources', { status: 'blocked', stoppedBecause: 'discovery-unconfigured' }),
      discovery,
    );
    expect(notice?.id).toBe('discovery-unconfigured');
    // Something a person can put right, said calmly: it is information, not a warning.
    expect(notice?.tone).toBe('info');
    expect(notice?.offers).toEqual(['add', 'manual']);
    expect(notice?.quoted).toBe(discovery.message);
    expect(notice?.body.join(' ')).toMatch(/does not search the web on its own/u);
  });

  it('say nothing of a run that is under way or complete, and something for each that stopped', () => {
    expect(runNotice(runningAt('reading'), discovery)).toBeNull();
    expect(runNotice(completed(), discovery)).toBeNull();
    expect(runNotice(runningAt('reading', { status: 'cancelled' }), discovery)?.id).toBe(
      'cancelled',
    );
    expect(runNotice(runningAt('reading', { status: 'paused' }), discovery)?.id).toBe('paused');
    const failed = runNotice(
      runningAt('reading', {
        status: 'failed',
        events: [{ at: NOW, stage: 'reading', level: 'block', message: 'The reader stopped.' }],
      }),
      discovery,
    );
    expect(failed).toMatchObject({
      id: 'failed',
      tone: 'error',
      quoted: 'The reader stopped.',
      offers: ['again'],
    });
    expect(
      runNotice(
        runningAt('reading', { status: 'blocked', stoppedBecause: 'safety-block', sources: [] }),
        discovery,
      )?.body,
    ).toContain('No page was reached.');
    expect(
      runNotice(
        completed({ sources: pages().filter((page) => page.outcome !== 'used') }),
        discovery,
      )?.id,
    ).toBe('unused');
  });

  it('call finished research out of date only where the question was marked as one that moves, and it is older than that allows', () => {
    const done = completed({ finishedAt: '2026-02-20T10:00:00.000Z' });
    const days = (count: number) => Date.parse(NOW) + count * 86_400_000;
    expect(agedBy(done, Date.parse(NOW))).toEqual({ days: 22, sensitivity: 'recent' });
    expect(agedBy(done, Date.parse('2026-03-05T00:00:00.000Z'))).toBeNull();
    expect(
      agedBy(
        completed({ plan: { ...done.plan!, timeSensitivity: { level: 'none', note: '' } } }),
        days(400),
      ),
    ).toBeNull();
    expect(agedBy(completed({ plan: null }), days(400))).toBeNull();
    expect(agedBy(runningAt('reading'), days(400))).toBeNull();
    const fast = completed({
      finishedAt: '2026-03-10T10:00:00.000Z',
      plan: { ...done.plan!, timeSensitivity: { level: 'fast-moving', note: '' } },
    });
    expect(agedBy(fast, Date.parse(NOW))).toEqual({ days: 4, sensitivity: 'fast-moving' });
  });
});

describe('the limits', () => {
  it('say what was used of each and what each is, and that a cost is an estimate', () => {
    const lines = budgetLines(completed());
    const byId = Object.fromEntries(lines.map((line) => [line.id, line]));
    expect(byId.pages!.value).toBe('7 of 12');
    expect(byId.sites!.value).toBe('5 of 4');
    expect(byId.cost!.value).toBe('$0.00 of $0.25');
    expect(byId.cost!.label).toMatch(/estimated/u);
    expect(byId.cost!.hint).toBe('An estimate, never a bill.');
    expect(byId.time!.value).toBe('1 min 11 s of 2 min 00 s');
    expect(byId.depth!.value).toBe('Up to 1 from the start');
    expect(byId.repeats!.value).toBe('Stops above 5 in 10 pages');
  });
});

describe('the words', () => {
  it('make no prediction, and no claim about the world, in any sentence the surface can say', () => {
    const texts: string[] = [];
    const take = (value: unknown): void => {
      if (typeof value === 'string') texts.push(value);
      else if (value && typeof value === 'object') Object.values(value).forEach(take);
    };
    take(words);
    const discovery = view(null).discovery;
    for (const kind of ['paused', 'blocked', 'cancelled', 'failed'] as const) {
      take(runNotice(runningAt('reading', { status: kind }), discovery));
    }
    take(
      runNotice(
        runningAt('finding-sources', {
          status: 'blocked',
          stoppedBecause: 'discovery-unconfigured',
        }),
        discovery,
      ),
    );
    for (const item of stageItems(completed())) take(item.detail);
    for (const line of budgetLines(completed())) take(line);
    expect(texts.length).toBeGreaterThan(60);
    expect(texts.flatMap((text) => claimsAgainst(text))).toEqual([]);
  });
});
