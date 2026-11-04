import { describe, expect, it } from 'vitest';
import {
  RESEARCH_BUDGET_CEILING,
  RESEARCH_STAGES,
  RESEARCH_STOP_LABELS,
  type ResearchRun,
  type ResearchSource,
  type ResearchView,
} from '../../shared/research.js';
import { MAX_DOCUMENTS } from '../../shared/types.js';
import { detectContradictions } from '../src/grounding/contradictions.js';
import { sha256 } from '../src/ingest/url/provenance.js';
import { DISCOVERY_UNCONFIGURED_MESSAGE, type SearchProvider } from '../src/research/discovery.js';
import { braveSearch, searchQueryOf, wikipediaSearch } from '../src/research/search.js';
import {
  HARBOUR,
  QUESTION,
  REVIEW,
  researchApp,
  type ResearchApp,
} from './support/research-app.js';
import { prose, sitePage } from './support/research-pages.js';
import type { Route } from './support/research-world.js';

const json = (response: { json(): unknown }) => response.json() as ResearchView;
const failure = (response: { json(): unknown }) =>
  (response.json() as { error: { code: string; message: string } }).error;
const sourceOf = (run: ResearchRun | null, url: string): ResearchSource | undefined =>
  run?.sources.find((source) => source.requestedUrl === url);

/** What a run and its project's log and audit trail say, as one string, for what none of them may hold. */
const everythingSaid = (app: ResearchApp, id: string): string =>
  JSON.stringify([
    app.run(id)?.events,
    app.repository.get(id).events.map((event) => event.message),
    app.repository.audit.list({ projectId: id, limit: 500 }),
  ]);

describe('a question and a page', () => {
  it('reads the page a person names and what it links to, keeps the best as sources, checks them against each other and grounds the project', async () => {
    const app = await researchApp();
    const id = await app.create();
    // What the Ask scene makes: a question, and not a source.
    expect(app.repository.get(id)).toMatchObject({ status: 'draft', documents: [] });
    expect(app.repository.chunks(id)).toEqual([]);

    const response = await app.post(id, '', { intake: { url: `${HARBOUR}/` } });
    expect(response.statusCode).toBe(202);
    expect(json(response).run).toMatchObject({ status: 'queued', stage: 'planning', mode: 'url' });
    expect(json(response).may).toEqual({ start: false, pause: false, cancel: true });
    await app.settle();

    const run = app.run(id);
    expect(run).toMatchObject({
      status: 'completed',
      stage: 'ready',
      mode: 'url',
      stoppedBecause: 'frontier-exhausted',
      conflictCount: 1,
    });
    expect(run?.used).toMatchObject({ pages: 5, domains: 2, quarantined: 1, failures: 0 });
    expect(run?.plan).toMatchObject({ origin: 'rules', question: QUESTION });

    // Every stage a run reports is one that it reached, in order.
    const stages = [...new Set(run?.events.map((event) => event.stage))];
    expect(stages).toEqual([...RESEARCH_STAGES]);

    const used = run?.sources.filter((source) => source.outcome === 'used') ?? [];
    expect(used.map((source) => source.requestedUrl).sort()).toEqual(
      [
        `${HARBOUR}/`,
        `${HARBOUR}/berthing-fees`,
        `${HARBOUR}/pilotage-notes`,
        `${REVIEW}/fees-survey`,
      ].sort(),
    );
    expect(sourceOf(run, `${HARBOUR}/`)).toMatchObject({ discoveredBy: 'user-url', depth: 0 });
    expect(run?.sources.filter((source) => source.outcome === 'quarantined')).toHaveLength(1);
    for (const source of used) {
      expect(source).toMatchObject({
        documentId: expect.stringMatching(/^D\d+$/u) as string,
        passageCount: 1,
      });
      expect(source.contentHash).toMatch(/^[0-9a-f]{64}$/u);
    }

    // The project holds the sources, with the page each came from, and Ground went on to build knowledge.
    const project = app.repository.get(id);
    expect(project.status).toBe('ready');
    expect(project.console?.steps.knowledge).toBe('ready');
    expect(project.documents.map((document) => document.id)).toEqual(['D1', 'D2', 'D3', 'D4']);
    for (const document of project.documents) {
      expect(document.provenance).toMatchObject({
        kind: 'url',
        fetchedByServer: true,
        sha256: sha256(document.content),
      });
    }
    const chunks = app.repository.chunks(id);
    expect(chunks.map((chunk) => chunk.id)).toEqual(['S1', 'S2', 'S3', 'S4']);
    expect(chunks.every((chunk) => chunk.reviewStatus === 'unreviewed')).toBe(true);
    expect(detectContradictions(chunks, new Date())).toHaveLength(1);

    // Where each passage sat in its page is recorded against the chunk that now holds it.
    expect(Object.keys(run?.passages ?? {}).sort()).toEqual(chunks.map((chunk) => chunk.id));
    for (const chunk of chunks) {
      const source = used.find((candidate) => candidate.documentId === chunk.documentId);
      expect(run?.passages[chunk.id]?.sourceId).toBe(source?.id);
    }

    // The audit trail says that research ran and what it came to, in counts and words only.
    expect(app.actions(id)).toEqual([
      'project.created',
      'research.started',
      'research.documents.added',
      'research.ended',
    ]);
    const said = everythingSaid(app, id);
    for (const text of [
      'harbour.example.org',
      'review.example.net',
      'erthing fee',
      '3.40',
      'What if the',
    ]) {
      expect(said, text).not.toContain(text);
    }
    expect(JSON.stringify(app.repository.audit.list({ projectId: id }))).not.toContain('example');

    // Nothing was asked for but the pages of the web, and robots.txt once for each site.
    expect(app.network.pagesAsked().sort()).toEqual(
      [
        `${HARBOUR}/`,
        `${HARBOUR}/berthing-fees`,
        `${HARBOUR}/pilotage-notes`,
        `${HARBOUR}/about`,
        `${REVIEW}/fees-survey`,
      ].sort(),
    );
    expect(app.network.calls.filter((call) => call.purpose === 'robots')).toHaveLength(2);
    expect((await app.view(id)).may).toEqual({ start: false, pause: false, cancel: false });
  });

  it('reads a site a person names and stays on it, and takes a page named without a scheme as https', async () => {
    const site = await researchApp();
    const siteId = await site.create();
    await site.post(siteId, '', { intake: { domain: 'harbour.example.org' } });
    await site.settle();
    expect(site.run(siteId)).toMatchObject({ status: 'completed', mode: 'domain' });
    expect(sourceOf(site.run(siteId), `${HARBOUR}/`)).toMatchObject({
      discoveredBy: 'user-domain',
    });
    expect(site.repository.get(siteId).documents).toHaveLength(3);
    expect(site.network.calls.some((call) => call.host === 'review.example.net')).toBe(false);

    const page = await researchApp();
    const pageId = await page.create();
    await page.post(pageId, '', {
      intake: { url: 'harbour.example.org/berthing-fees' },
      budget: { maxDepth: 0 },
    });
    await page.settle();
    expect(page.run(pageId)?.used).toMatchObject({ pages: 1, domains: 1 });
    expect(page.repository.get(pageId).documents).toHaveLength(1);
    expect(page.repository.get(pageId).documents[0]?.provenance?.url).toBe(
      `${HARBOUR}/berthing-fees`,
    );
  });

  it('grounds a question-only project that is simply run, with a run of its own made for it', async () => {
    const app = await researchApp();
    const id = await app.create();
    const response = await app.app.inject({
      method: 'POST',
      url: `/api/projects/${id}/steps/knowledge`,
    });
    expect(response.statusCode).toBe(202);
    await app.settle();
    expect(app.run(id)).toMatchObject({
      status: 'blocked',
      mode: 'discovery',
      stoppedBecause: 'discovery-unconfigured',
    });
    expect(app.repository.get(id)).toMatchObject({ status: 'draft', error: null });
  });
});

describe('a question and nothing else', () => {
  it('plans, says that finding sources from a question alone is not possible here, and leaves the project as it was', async () => {
    const app = await researchApp();
    const id = await app.create();
    expect(json(await app.app.inject({ url: `/api/projects/${id}/research` }))).toMatchObject({
      run: null,
      revision: 0,
      may: { start: true, pause: false, cancel: false },
    });
    await app.post(id, '', {});
    await app.settle();

    const run = app.run(id);
    expect(run).toMatchObject({
      status: 'blocked',
      stage: 'finding-sources',
      mode: 'discovery',
      stoppedBecause: 'discovery-unconfigured',
      sources: [],
    });
    expect(run?.used.pages).toBe(0);
    expect(run?.plan?.claimsToVerify.length).toBeGreaterThan(0);
    expect(run?.plan?.likelySources.length).toBeGreaterThan(0);
    expect(run?.plan?.likelySources.every((source) => source.suggestedDomain === undefined)).toBe(
      true,
    );
    expect(run?.events.map((event) => [event.stage, event.level, event.message])).toEqual([
      ['planning', 'info', 'Planned what to look for by rules on this server.'],
      ['finding-sources', 'block', RESEARCH_STOP_LABELS['discovery-unconfigured']],
      ['finding-sources', 'warn', 'Nothing could be used as a source.'],
    ]);
    // It did not pretend: nothing was fetched, and no search page was read.
    expect(app.network.calls).toEqual([]);

    // The stage is back to waiting, not failed: a person can add a source or try again.
    const project = app.repository.get(id);
    expect(project).toMatchObject({ status: 'draft', stage: 'intake', progress: 0, error: null });
    expect(project.console?.steps.knowledge).toBe('pending');
    expect(project.documents).toEqual([]);
    expect(project.events.at(-1)?.message).toBe(
      'There is nothing to build knowledge from yet. Add a source, or start research again.',
    );
    const view = await app.view(id);
    expect(view.may.start).toBe(true);
    expect(view.discovery).toEqual({
      available: false,
      provider: null,
      message: DISCOVERY_UNCONFIGURED_MESSAGE,
    });
    expect(view.discovery.message).toContain('RESEARCH_SEARCH_PROVIDER');
    expect(app.actions(id)).toEqual(['project.created', 'research.started', 'research.ended']);
  });

  it('goes on, once a person names a site, from the plan it already made, and the sources it adds ground the project', async () => {
    const app = await researchApp();
    const id = await app.create();
    await app.post(id, '', {});
    await app.settle();

    const added = await app.post(id, '/sources', { url: 'harbour.example.org' });
    expect(added.statusCode).toBe(202);
    expect(json(added).run).toMatchObject({ mode: 'domain', status: 'queued' });
    await app.settle();
    const run = app.run(id);
    expect(run?.id).toMatch(/^rr-0002-/u);
    expect(run).toMatchObject({ status: 'completed', stage: 'ready' });
    expect(sourceOf(run, `${HARBOUR}/`)).toMatchObject({ discoveredBy: 'user-added', depth: 0 });
    expect(run?.events[0]?.message).toBe('Reused the plan made for this question earlier.');
    expect(app.repository.get(id)).toMatchObject({ status: 'ready' });
    expect(app.repository.get(id).documents).toHaveLength(3);
    expect(app.run(id)?.plan?.claimsToVerify.length).toBeGreaterThan(0);
    expect(app.actions(id)).toContain('research.source.added');
    const entry = app.repository.audit
      .list({ projectId: id })
      .find((item) => item.action === 'research.source.added');
    expect(entry?.detail).toMatchObject({ mode: 'domain', target: 'site', model: false });
    expect(JSON.stringify(entry)).not.toContain('harbour');

    // Grounding is done, so nothing more can be added: the refusal leaves no run waiting for a job.
    const again = await app.post(id, '/sources', { url: `${HARBOUR}/about` });
    expect(again.statusCode).toBe(409);
    expect(failure(again).code).toBe('STEP_ALREADY_STARTED');
    expect(app.research.store.count(id)).toBe(2);
  });

  it('names a page a person adds as a page, and a site as a site, in the log', async () => {
    const app = await researchApp();
    const id = await app.create();
    await app.post(id, '/sources', { url: `${HARBOUR}/berthing-fees` });
    await app.settle();
    const entry = app.repository.audit
      .list({ projectId: id })
      .find((item) => item.action === 'research.source.added');
    expect(entry?.detail).toMatchObject({ mode: 'url', target: 'page' });
    expect(app.run(id)).toMatchObject({ mode: 'url', status: 'completed' });
  });
});

describe('a search provider, when a deployment has one', () => {
  const found = [
    `${HARBOUR}/berthing-fees`,
    'http://169.254.169.254/latest/meta-data/',
    'file:///etc/passwd',
    'https://user:secret@harbour.example.org/private',
    `${REVIEW}/fees-survey`,
  ];
  const provider = (answer: () => string[] | Error): SearchProvider & { questions: string[] } => {
    const questions: string[] = [];
    return {
      questions,
      status: () => ({
        available: true,
        provider: 'fixture',
        message: 'A scripted search, for this test only.',
      }),
      search: async (question) => {
        questions.push(question);
        const result = answer();
        if (result instanceof Error) throw result;
        return result.map((url) => ({ url }));
      },
    };
  };

  it('reads what it offers by the same rules as any address, and fetches none that the rules refuse', async () => {
    const search = provider(() => found);
    const app = await researchApp({ search });
    const id = await app.create();
    const started = await app.post(id, '', {});
    expect(json(started).discovery).toMatchObject({ available: true, provider: 'fixture' });
    await app.settle();

    const run = app.run(id);
    expect(run).toMatchObject({ status: 'completed', mode: 'discovery', conflictCount: 1 });
    // It is asked for the names and topics of the plan, and not for the question as it was typed.
    expect(search.questions).toEqual(['harbour authority raises berthing fees coastal vessels']);
    expect(search.questions).toEqual([searchQueryOf(run!.plan!)]);
    expect(search.questions[0]).not.toBe(run?.plan?.question);
    expect(app.repository.get(id).documents).toHaveLength(2);
    const offered = run?.sources.filter((source) => source.discoveredBy === 'search') ?? [];
    expect(offered).toHaveLength(found.length);
    expect(offered.filter((source) => source.outcome === 'blocked')).toHaveLength(3);
    expect(sourceOf(run, 'http://169.254.169.254/latest/meta-data/')).toMatchObject({
      outcome: 'blocked',
    });
    // Nothing the rules refused was asked for, not even to look it up.
    expect(app.network.pagesAsked().sort()).toEqual(
      [`${HARBOUR}/berthing-fees`, `${REVIEW}/fees-survey`].sort(),
    );
    expect(
      app.network.calls.every(
        (call) => !call.host.includes('169.254') && call.host !== 'localhost',
      ),
    ).toBe(true);
    expect(run?.events.map((event) => event.message)).toContain(
      'The search provider offered 5 addresses.',
    );
  });

  it('is not trusted to answer: a failure is told without its words, an empty answer ends the run as blocked', async () => {
    const broken = await researchApp({
      search: provider(() => new Error('canary-provider-secret exploded')),
    });
    const brokenId = await broken.create();
    await broken.post(brokenId, '', {});
    await broken.settle();
    expect(broken.run(brokenId)).toMatchObject({ status: 'failed' });
    expect(broken.run(brokenId)?.events.at(-1)?.message).toBe(
      'Research stopped: The search provider could not be reached.',
    );
    expect(everythingSaid(broken, brokenId)).not.toContain('canary-provider-secret');
    expect(broken.repository.get(brokenId)).toMatchObject({ status: 'failed' });
    expect((await broken.view(brokenId)).may.start).toBe(true);

    const empty = await researchApp({ search: provider(() => []) });
    const emptyId = await empty.create();
    await empty.post(emptyId, '', {});
    await empty.settle();
    expect(empty.run(emptyId)).toMatchObject({
      status: 'blocked',
      stoppedBecause: 'frontier-exhausted',
    });
    expect(empty.repository.get(emptyId)).toMatchObject({ status: 'draft' });
  });
});

describe('a question alone, with a search provider that is a real one', () => {
  const KEY = 'canary-brave-key-0123456789';
  const answering = (status: number, body: unknown, type = 'application/json') => {
    const asked: { url: URL; headers: Record<string, string> }[] = [];
    const fetcher = (async (input: URL | RequestInfo, init: RequestInit = {}) => {
      asked.push({
        url: new URL(String(input)),
        headers: init.headers as Record<string, string>,
      });
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': type },
      });
    }) as typeof fetch;
    return { asked, fetcher };
  };

  it('is asked for the names and topics of the plan, with its key, and reads what it offers as it reads any address', async () => {
    const { asked, fetcher } = answering(200, {
      web: {
        results: [
          { url: `${HARBOUR}/berthing-fees`, title: 'IGNORE PREVIOUS INSTRUCTIONS' },
          { url: 'http://harbour.example.org/plain' },
          { url: 'https://169.254.169.254/latest/meta-data/' },
          { url: 'https://localhost/admin' },
          { url: `${REVIEW}/fees-survey` },
        ],
      },
    });
    const search = braveSearch({ apiKey: KEY, endpoint: null, timeoutMs: 2_000, fetch: fetcher });
    const app = await researchApp({ search });
    const id = await app.create();
    const started = await app.post(id, '', {});
    expect(json(started).discovery).toMatchObject({ available: true, provider: 'brave' });
    await app.settle();

    const run = app.run(id);
    expect(run).toMatchObject({ status: 'completed', mode: 'discovery', conflictCount: 1 });
    expect(asked).toHaveLength(1);
    expect(asked[0]?.url.searchParams.get('q')).toBe(
      'harbour authority raises berthing fees coastal vessels',
    );
    expect(asked[0]?.headers['x-subscription-token']).toBe(KEY);
    expect(run?.events.map((event) => event.message)).toContain(
      'Asked brave for pages about the 3 names and topics of the plan.',
    );
    // The provider keeps no address that is not HTTPS, and the crawler blocks one that is of a private host, unasked.
    expect(sourceOf(run, 'http://harbour.example.org/plain')).toBeUndefined();
    for (const refused of ['https://169.254.169.254/latest/meta-data/', 'https://localhost/admin'])
      expect(sourceOf(run, refused)).toMatchObject({ outcome: 'blocked', discoveredBy: 'search' });
    expect(
      app.network.calls.every(
        (call) => !call.host.includes('169.254') && call.host !== 'localhost',
      ),
    ).toBe(true);
    expect(app.network.pagesAsked().sort()).toEqual(
      [`${HARBOUR}/berthing-fees`, `${REVIEW}/fees-survey`].sort(),
    );
    expect(app.repository.get(id).documents).toHaveLength(2);

    // The key is in the one header, and in nothing that a person, a log or an audit trail holds.
    expect(everythingSaid(app, id)).not.toContain('canary');
    expect(JSON.stringify(app.run(id))).not.toContain('canary');
    expect(JSON.stringify(await app.view(id))).not.toContain('canary');
    expect(JSON.stringify(app.repository.get(id))).not.toContain('canary');
  });

  it('is told, in a sentence of ours, why a search failed, and what the provider wrote is in no sentence', async () => {
    const cases: [string, number, unknown, string, string][] = [
      [
        'a key that is not accepted',
        401,
        { error: 'canary-body-401' },
        'application/json',
        'refused the search',
      ],
      ['a limit that is used up', 429, 'canary-body-429', 'text/plain', 'refused the search'],
      [
        'a server that fails',
        500,
        { error: 'canary-body-500' },
        'application/json',
        'did not answer in a form',
      ],
      [
        'an answer that is not JSON',
        200,
        '<html>canary-body-html</html>',
        'text/html',
        'did not answer in a form',
      ],
      [
        'an answer that is not what was asked',
        200,
        { web: { results: 'canary-body-shape' } },
        'application/json',
        'did not answer in a form',
      ],
    ];
    for (const [, status, body, type, sentence] of cases) {
      const { fetcher } = answering(status, body, type);
      const app = await researchApp({
        search: braveSearch({ apiKey: KEY, endpoint: null, timeoutMs: 2_000, fetch: fetcher }),
      });
      const id = await app.create();
      await app.post(id, '', {});
      await app.settle();
      expect(app.run(id)).toMatchObject({ status: 'failed' });
      expect(app.run(id)?.events.at(-1)?.message).toContain(
        `Research stopped: The search provider ${sentence}`,
      );
      expect(everythingSaid(app, id)).not.toMatch(/canary/u);
      expect(app.repository.get(id)).toMatchObject({ status: 'failed' });
      expect((await app.view(id)).may.start).toBe(true);
    }
  });

  it('is never sent a reference, a key or a figure that the question carries, only its names and topics', async () => {
    const { asked, fetcher } = answering(200, { web: { results: [] } });
    const app = await researchApp({
      search: braveSearch({ apiKey: KEY, endpoint: null, timeoutMs: 2_000, fetch: fetcher }),
    });
    // Shaped like a key that a provider issues, and made of parts so that no literal of the shape is in the source.
    const issued = ['sk', 'live', '4eC39HqLyjWDarjtT1zdp7dc'].join('-');
    const question = `Should we rotate the billing key ${issued} next month after the Acme outage? Our case reference is HR-2026-04417 and the ticket is INC0048213, budget 4200000.`;
    const id = await app.create(question);
    await app.post(id, '', {});
    await app.settle();

    const query = asked[0]?.url.searchParams.get('q') ?? '';
    expect(asked).toHaveLength(1);
    expect(query).toContain('billing key');
    expect(query).toContain('Acme');
    expect(query).not.toMatch(/sk-live|4eC39|HR-2026|04417|INC0048213|4200000|\?/u);
    expect(query).not.toBe(question);
    expect(asked[0]?.url.toString()).not.toContain('canary');
    expect(app.repository.get(id).question).toBe(question);
  });

  it('asks nothing, and says so, when nothing of the plan can be sent: the question is not the fallback', async () => {
    const { asked, fetcher } = answering(200, { web: { results: [] } });
    const app = await researchApp({
      search: braveSearch({ apiKey: KEY, endpoint: null, timeoutMs: 2_000, fetch: fetcher }),
    });
    const id = await app.create('What about INC0048213 and HR-2026-04417 and 4111 1111 1111 1111?');
    await app.post(id, '', {});
    await app.settle();

    expect(asked).toEqual([]);
    const run = app.run(id);
    expect(run).toMatchObject({ status: 'blocked', stoppedBecause: 'frontier-exhausted' });
    expect(run?.events.map((event) => event.message)).toContain(
      'The plan has no name or topic that can be searched for, so no search was made.',
    );
    expect(app.network.calls).toEqual([]);
    expect(everythingSaid(app, id)).not.toContain('canary');
  });

  it('says that it cannot search, rather than failing, when its key is missing, and the question is not sent anywhere', async () => {
    const { asked, fetcher } = answering(200, { web: { results: [] } });
    const app = await researchApp({
      search: braveSearch({ apiKey: null, endpoint: null, timeoutMs: 2_000, fetch: fetcher }),
    });
    const id = await app.create();
    await app.post(id, '', {});
    await app.settle();
    expect(app.run(id)).toMatchObject({
      status: 'blocked',
      stoppedBecause: 'discovery-unconfigured',
    });
    expect(asked).toEqual([]);
  });

  it('can be the encyclopedia, which needs no key and finds background pages of one site', async () => {
    const { asked, fetcher } = answering(200, {
      query: { search: [{ title: 'Port of Harbour' }] },
    });
    const app = await researchApp({
      search: wikipediaSearch({ apiKey: null, endpoint: null, timeoutMs: 2_000, fetch: fetcher }),
    });
    const id = await app.create();
    await app.post(id, '', {});
    await app.settle();
    const run = app.run(id);
    expect(asked[0]?.url.searchParams.get('srsearch')).toBe(
      'harbour authority raises berthing fees coastal vessels',
    );
    expect(sourceOf(run, 'https://en.wikipedia.org/wiki/Port_of_Harbour')).toMatchObject({
      discoveredBy: 'search',
    });
    expect(run?.events.map((event) => event.message)).toContain(
      'Asked wikipedia for pages about the 3 names and topics of the plan.',
    );
  });
});

describe('research that is turned off, and a project that has sources of its own', () => {
  it('refuses a request for manual sources, and a deployment that has turned research off refuses every start', async () => {
    const app = await researchApp();
    const id = await app.create();
    const manual = await app.post(id, '', { intake: { auto: false } });
    expect(manual.statusCode).toBe(400);
    expect(failure(manual).code).toBe('RESEARCH_OFF');
    expect(app.research.store.count(id)).toBe(0);
    expect(app.repository.jobs.live(id)).toBeNull();

    const off = await researchApp({ environment: { RESEARCH_ENABLED: 'false' } });
    const offId = await off.create();
    const refused = await off.post(offId, '', { intake: { url: `${HARBOUR}/` } });
    expect(refused.statusCode).toBe(403);
    expect(failure(refused).code).toBe('RESEARCH_DISABLED');
    expect((await off.view(offId)).may.start).toBe(false);
    const config = (await off.app.inject({ url: '/api/config' })).json() as {
      research: { enabled: boolean };
    };
    expect(config.research.enabled).toBe(false);

    const noReading = await researchApp({ environment: { URL_INGESTION: 'off' } });
    const noReadingId = await noReading.create();
    expect((await noReading.post(noReadingId, '', {})).statusCode).toBe(403);
  });

  it('says what a server does, in /api/config', async () => {
    const app = await researchApp();
    const config = (await app.app.inject({ url: '/api/config' })).json() as {
      research: {
        enabled: boolean;
        discovery: { available: boolean };
        budget: { maxPages: number };
      };
    };
    expect(config.research).toMatchObject({
      enabled: true,
      discovery: { available: false, provider: null },
      budget: { maxPages: 12, maxDomains: 4 },
    });
  });

  it('grounds a project that has sources of its own exactly as it always did: no run, no row of research in its audit trail', async () => {
    const app = await researchApp();
    const id = await app.create(QUESTION, {
      documents: [
        {
          name: 'own-notes.txt',
          content:
            'The harbour authority publishes its berthing fees once a year, in a schedule that the board votes on in public.',
        },
      ],
      research: undefined,
    });
    expect(app.repository.chunks(id)).toHaveLength(1);
    const response = await app.app.inject({
      method: 'POST',
      url: `/api/projects/${id}/steps/knowledge`,
    });
    expect(response.statusCode).toBe(202);
    await app.settle();
    expect(app.repository.get(id)).toMatchObject({ status: 'ready' });
    expect(app.research.store.count(id)).toBe(0);
    expect(app.actions(id).filter((action) => action.startsWith('research.'))).toEqual([]);
    expect(app.network.calls).toEqual([]);
  });
});

describe('the limits of a run', () => {
  it('holds a request to what the server allows: a limit above the ceiling is brought down, one below the floor is brought up', async () => {
    const app = await researchApp({ environment: { RESEARCH_DOMAIN_DELAY_MS: '2000' } });
    const id = await app.create();
    const started = await app.post(id, '', {
      budget: {
        maxPages: 1000,
        maxDomains: 99,
        maxDepth: 9,
        maxBytesPerPage: 9e9,
        maxTotalBytes: 9e9,
        maxElapsedMs: 9e9,
        maxEstimatedCostUsd: 100,
        maxFailedRequests: 1000,
        perDomainDelayMs: 1,
      },
    });
    expect(started.statusCode).toBe(202);
    expect(json(started).run?.budget).toMatchObject({
      maxPages: RESEARCH_BUDGET_CEILING.maxPages,
      maxDomains: RESEARCH_BUDGET_CEILING.maxDomains,
      maxDepth: RESEARCH_BUDGET_CEILING.maxDepth,
      maxBytesPerPage: RESEARCH_BUDGET_CEILING.maxBytesPerPage,
      maxTotalBytes: RESEARCH_BUDGET_CEILING.maxTotalBytes,
      maxElapsedMs: RESEARCH_BUDGET_CEILING.maxElapsedMs,
      maxEstimatedCostUsd: RESEARCH_BUDGET_CEILING.maxEstimatedCostUsd,
      maxFailedRequests: RESEARCH_BUDGET_CEILING.maxFailedRequests,
      perDomainDelayMs: 2_000,
    });
    // What the plan says the run will stop at is what the budget it was given says.
    await app.settle();
    expect(app.run(id)?.plan?.stoppingConditions[0]).toBe(
      'Reads at most 30 pages from at most 8 sites, following links up to 2 steps from a starting page.',
    );
    const bad = await app.post(id, '', { budget: { maxPages: 'many' } });
    expect(bad.statusCode).toBe(400);
    expect((await app.post(id, '', { budget: { reach: 3 } })).statusCode).toBe(400);
  });

  it('stops at the page limit an operator lowered, and at a depth of nothing reads only the page named', async () => {
    const app = await researchApp({ environment: { RESEARCH_MAX_PAGES: '2' } });
    const id = await app.create();
    const started = await app.post(id, '', {
      intake: { url: `${HARBOUR}/` },
      budget: { maxPages: 12 },
    });
    expect(json(started).run?.budget.maxPages).toBe(2);
    await app.settle();
    expect(app.run(id)).toMatchObject({ status: 'completed', stoppedBecause: 'page-limit' });
    expect(app.run(id)?.used.pages).toBe(2);
    expect(app.repository.get(id).documents.length).toBeLessThanOrEqual(2);

    const flat = await researchApp();
    const flatId = await flat.create();
    await flat.post(flatId, '', { intake: { url: `${HARBOUR}/` }, budget: { maxDepth: 0 } });
    await flat.settle();
    expect(flat.run(flatId)?.used.pages).toBe(1);
    expect(flat.network.pagesAsked()).toEqual([`${HARBOUR}/`]);
  });

  const held = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      name: `held-${index + 1}.txt`,
      content:
        `Held source number ${index + 1}. A paragraph of the project's own, which research must never alter. `.repeat(
          3,
        ),
    }));

  it('adds only as many sources as the project has room for, leaves what it held as it was, and says why the rest were not used', async () => {
    const app = await researchApp();
    const id = await app.create(QUESTION, {
      documents: held(MAX_DOCUMENTS - 1),
      research: undefined,
    });
    const before = {
      documents: app.repository.get(id).documents,
      chunks: app.repository.chunks(id),
    };
    await app.post(id, '', { intake: { url: `${HARBOUR}/` } });
    await app.settle();

    const project = app.repository.get(id);
    expect(project.documents).toHaveLength(MAX_DOCUMENTS);
    expect(project.documents.slice(0, MAX_DOCUMENTS - 1)).toEqual(before.documents);
    expect(app.repository.chunks(id).slice(0, before.chunks.length)).toEqual(before.chunks);
    expect(project.documents[MAX_DOCUMENTS - 1]?.id).toBe(`D${MAX_DOCUMENTS}`);
    const run = app.run(id);
    const kept = run?.sources.filter((source) => source.outcome === 'used') ?? [];
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ requestedUrl: `${HARBOUR}/`, documentId: `D${MAX_DOCUMENTS}` });
    const unused = run?.sources.filter((source) => source.outcome === 'read') ?? [];
    expect(unused.length).toBeGreaterThan(0);
    for (const source of unused) {
      expect(source.warnings.at(-1)).toBe(
        `The project holds at most ${MAX_DOCUMENTS} sources, and pages that ranked higher were used.`,
      );
    }
  });

  it('refuses to start for a project that already holds the most it can, and says so before it makes a run', async () => {
    const app = await researchApp();
    const id = await app.create(QUESTION, { documents: held(MAX_DOCUMENTS), research: undefined });
    expect((await app.view(id)).may.start).toBe(false);
    const refused = await app.post(id, '', { intake: { url: `${HARBOUR}/` } });
    expect(refused.statusCode).toBe(409);
    expect(failure(refused).code).toBe('DOCUMENT_LIMIT');
    expect(app.research.store.count(id)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// The stops that this server decides, and the crawler does not
// ---------------------------------------------------------------------------------------------

/** A site whose notes each say the thing the question asks about, so that the claim has evidence quickly. */
function notesWeb(count: number, say: (number: number) => string[]): Record<string, Route> {
  const page = (body: string): Route => ({ type: 'text/html', body });
  const web: Record<string, Route> = {
    [`${HARBOUR}/`]: page(
      sitePage({
        title: 'Notes',
        paragraphs: [
          'A list of notes kept by the authority of the port, in the order they were written.',
        ],
        links: Array.from({ length: count }, (_, index): [string, string] => [
          `/note-${index + 1}`,
          `Berthing fees for coastal vessels, note ${index + 1}`,
        ]),
      }),
    ),
  };
  for (let index = 1; index <= count; index += 1) {
    web[`${HARBOUR}/note-${index}`] = page(
      sitePage({ title: `Note ${index}`, paragraphs: say(index) }),
    );
  }
  return web;
}

describe('stopping because there is enough, or because reading adds nothing', () => {
  it('stops when each claim has evidence from two pages, and says which pages and how many', async () => {
    const web = notesWeb(6, (n) => [
      'The harbour authority raises berthing fees for coastal vessels from the start of the season.',
      ...prose(400 + n, 2),
    ]);
    const app = await researchApp({ web });
    const id = await app.create();
    await app.post(id, '', { intake: { url: `${HARBOUR}/` } });
    await app.settle();
    const run = app.run(id);
    expect(run).toMatchObject({ status: 'completed', stoppedBecause: 'evidence-sufficient' });
    expect(run?.used.pages).toBe(3);
    expect(run?.assessments).toMatchObject([
      { claimId: 'c1', supporting: 2, opposing: 0, status: 'supported' },
    ]);
    expect(run?.events.map((event) => event.message)).toContain(
      RESEARCH_STOP_LABELS['evidence-sufficient'],
    );
    expect(app.network.pagesAsked()).toHaveLength(3);
    expect(app.repository.get(id).documents).toHaveLength(3);
  });

  it('stops when the latest pages add next to no word that was not already read', async () => {
    const words = Array.from(
      { length: 48 },
      (_, index) => `lexeme${String.fromCharCode(97 + (index % 26))}${index}x`,
    );
    // The same words in an order of their own for each seed: the pages differ, and say nothing new.
    const shuffled = (seed: number): string[] => {
      const list = [...words];
      let state = (seed + 1) * 2_654_435_761;
      for (let at = list.length - 1; at > 0; at -= 1) {
        state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
        const to = state % (at + 1);
        [list[at], list[to]] = [list[to] as string, list[at] as string];
      }
      return list;
    };
    const web = notesWeb(8, (n) => [0, 1, 2].map((part) => `${shuffled(n * 3 + part).join(' ')}.`));
    const app = await researchApp({ web });
    const id = await app.create();
    await app.post(id, '', { intake: { url: `${HARBOUR}/` } });
    await app.settle();
    const run = app.run(id);
    expect(run).toMatchObject({ status: 'completed', stoppedBecause: 'no-new-signal' });
    expect(run?.used.pages).toBeGreaterThanOrEqual(5);
    expect(run?.used.pages).toBeLessThan(9);
    expect(run?.events.map((event) => event.message)).toContain(
      RESEARCH_STOP_LABELS['no-new-signal'],
    );
  });
});

describe('the same question over the same web', () => {
  it('gives the same plan, the same choice, the same passages and the same record, whenever and wherever it is run', async () => {
    const results: unknown[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const app = await researchApp();
      const id = await app.create();
      await app.post(id, '', { intake: { url: `${HARBOUR}/` } });
      await app.settle();
      const { id: runId, traceId, ...record } = app.run(id) as ResearchRun;
      void runId;
      void traceId;
      results.push({
        record,
        documents: app.repository.get(id).documents,
        // The one thing that is the clock's and not the web's: when a passage was cut.
        chunks: app.repository.chunks(id).map(({ extractedAt, ...chunk }) => {
          void extractedAt;
          return chunk;
        }),
      });
    }
    expect(results[1]).toEqual(results[0]);
    expect((results[0] as { documents: unknown[] }).documents).toHaveLength(4);
  });
});
