import type { Page, Route } from '@playwright/test';
import {
  DEFAULT_RESEARCH_BUDGET,
  researchRunSchema,
  type ResearchRun,
  type ResearchSource,
  type ResearchStage,
  type ResearchView,
} from '../../shared/research';

// The server's research, as far as a page can tell: five endpoints that answer from a run the test holds, and the
// parts of the project that a project with no sources of its own would show. It is what the specs of the research
// surface stand on where they are about the surface and not about the research: a run can be put at any stage, with any
// pages, and every request made of it is recorded. A spec that is about the research itself runs against the real
// server (research-journey.spec.ts) and does not use this.

export const NO_PROVIDER = {
  available: false,
  provider: null,
  message:
    'No search provider is configured. Set one up as described in the production notes, or name a site or a page.',
};

const hex = (seed: number): string =>
  Array.from({ length: 64 }, (_, index) => ((seed * 7 + index * 3) % 16).toString(16)).join('');

/** A page of an invented site: read and used unless the overrides say otherwise. Every address is on a reserved name. */
export function page(n: number, overrides: Partial<ResearchSource> = {}): ResearchSource {
  return {
    id: `rs-${n.toString(16).padStart(10, '0')}`,
    requestedUrl: `https://fares.example.org/page-${n}`,
    finalUrl: `https://fares.example.org/page-${n}`,
    canonicalUrl: null,
    fetchedAt: '2026-03-14T10:29:12.000Z',
    httpStatus: 200,
    contentType: 'text/html; charset=utf-8',
    contentHash: hex(n),
    title: `Fare review, part ${n}`,
    retrievalMethod: 'http-get',
    category: 'official-documentation',
    authority: 'high',
    relevance: 'It sets out how fares are decided.',
    publishedAt: '2026-02-10',
    updatedAt: null,
    author: null,
    depth: 0,
    parentUrl: null,
    discoveredBy: 'user-url',
    robots: 'allowed',
    outcome: 'used',
    quarantine: null,
    failure: null,
    warnings: [],
    bytes: 18_400,
    extractionMethod: 'html-main',
    documentId: null,
    passageCount: 4,
    injectionFlagged: false,
    ...overrides,
  };
}

/** The pages of a run that read widely: some used, and one of each kind of page that was set aside. */
export function pagesRead(): ResearchSource[] {
  return [
    page(1, {
      title: 'Council fares review: summary of the evidence',
      requestedUrl: 'https://council.example.org/fares/review',
      finalUrl: 'https://council.example.org/fares/review-2026',
      category: 'government-regulatory',
      updatedAt: '2026-03-02',
      discoveredBy: 'user-domain',
      passageCount: 6,
    }),
    page(2, {
      title: 'Ferry operator reports winter crossings',
      requestedUrl: 'https://news.example.org/ferry/winter-crossings',
      finalUrl: 'https://news.example.org/ferry/winter-crossings',
      category: 'credible-reporting',
      authority: 'medium',
      publishedAt: '2026-01-18',
      discoveredBy: 'link',
      depth: 1,
      parentUrl: 'https://council.example.org/fares/review-2026',
      passageCount: 3,
    }),
    page(3, {
      title: 'Riders talk about cheaper evening crossings',
      requestedUrl: 'https://forum.example.org/threads/evening-fares',
      finalUrl: 'https://forum.example.org/threads/evening-fares',
      category: 'community',
      authority: 'low',
      publishedAt: null,
      discoveredBy: 'link',
      depth: 1,
      outcome: 'read',
      warnings: ['Only the first page of the thread was read.'],
      passageCount: 2,
    }),
    page(4, {
      title: null,
      requestedUrl: 'https://members.example.org/reports/annual',
      finalUrl: 'https://members.example.org/login?next=/reports/annual',
      category: 'unclassified',
      authority: 'unknown',
      publishedAt: null,
      outcome: 'quarantined',
      quarantine: { reason: 'login-page', detail: 'The page asks for a member sign-in.' },
      extractionMethod: null,
      passageCount: 0,
      bytes: 2_100,
    }),
    page(5, {
      title: 'Fares explained',
      requestedUrl: 'https://tips.example.org/fares-explained',
      finalUrl: 'https://tips.example.org/fares-explained',
      category: 'community',
      authority: 'low',
      outcome: 'quarantined',
      quarantine: {
        reason: 'prompt-injection',
        detail: 'The text addresses an AI system and tells it what to answer.',
      },
      injectionFlagged: true,
      passageCount: 0,
    }),
    page(6, {
      title: null,
      requestedUrl: 'https://private.example.org/internal',
      finalUrl: null,
      fetchedAt: null,
      httpStatus: null,
      contentType: null,
      contentHash: null,
      category: 'unclassified',
      authority: 'unknown',
      publishedAt: null,
      robots: 'disallowed',
      outcome: 'blocked',
      failure: { class: 'robots-disallowed', message: 'robots.txt disallows /internal.' },
      extractionMethod: null,
      passageCount: 0,
      bytes: 0,
    }),
    page(7, {
      title: null,
      requestedUrl: 'https://slow.example.org/fares',
      finalUrl: null,
      fetchedAt: null,
      httpStatus: null,
      contentType: null,
      contentHash: null,
      category: 'unclassified',
      authority: 'unknown',
      publishedAt: null,
      outcome: 'failed',
      failure: { class: 'timeout', message: 'No answer within 10 s.' },
      extractionMethod: null,
      passageCount: 0,
      bytes: 0,
    }),
    page(8, {
      title: 'Council fares review: summary of the evidence (print version)',
      requestedUrl: 'https://council.example.org/fares/review-2026?print=1',
      finalUrl: 'https://council.example.org/fares/review-2026?print=1',
      outcome: 'duplicate',
      passageCount: 0,
    }),
  ];
}

export const QUESTION = 'What could happen if the ferry fares fall by a third next spring?';

const plan = {
  version: 1 as const,
  question: QUESTION,
  mode: 'discovery' as const,
  entities: [
    { name: 'Ferry operator', kind: 'organization' as const },
    { name: 'City council', kind: 'organization' as const },
  ],
  topics: ['Fare levels', 'Ridership', 'Evening services', 'Subsidy'],
  claimsToVerify: [
    {
      id: 'c1',
      statement: 'Lower fares raise the number of crossings.',
      why: 'The scenario depends on it.',
    },
    { id: 'c2', statement: 'The operator’s costs are fixed over the horizon.', why: '' },
  ],
  likelySources: [
    {
      category: 'government-regulatory' as const,
      description: 'The regulator’s published fare rules',
      suggestedDomain: 'regulator.example.org',
    },
    {
      category: 'official-statement' as const,
      description: 'The operator’s own timetable and fare notices',
      suggestedDomain: 'operator.example.org',
    },
    {
      category: 'research-publication' as const,
      description: 'Studies of fare changes on ferry routes',
    },
  ],
  timeSensitivity: { level: 'recent' as const, note: 'Fares are revised each spring.' },
  conflictsToLookFor: ['Different crossing counts for the same year'],
  missingEvidence: ['Cost per crossing'],
  stoppingConditions: ['The page limit is reached', 'The latest pages add nothing new'],
  origin: 'rules' as const,
};

/** A run at a stage, with the pages it would have read by then, validated by the contract's own schema. */
export function runAt(stage: ResearchStage, overrides: Partial<ResearchRun> = {}): ResearchRun {
  const all = pagesRead();
  const unsettled = (sources: ResearchSource[]) =>
    sources.map((source) =>
      source.outcome === 'used' ? { ...source, outcome: 'read' as const } : source,
    );
  const held: Record<ResearchStage, ResearchSource[]> = {
    planning: [],
    'finding-sources': unsettled(all.slice(0, 2)),
    reading: unsettled(all.slice(0, 4)),
    'extracting-evidence': unsettled(all.slice(0, 5)),
    'checking-conflicts': unsettled(all.slice(0, 7)),
    ready: all,
  };
  const reading = stage === 'planning' ? 0 : stage === 'finding-sources' ? 0 : held[stage].length;
  return researchRunSchema.parse({
    version: 1,
    id: 'run-1',
    status: stage === 'ready' ? 'completed' : 'running',
    stage,
    mode: 'discovery',
    intake: { auto: true },
    plan: stage === 'planning' ? null : plan,
    budget: DEFAULT_RESEARCH_BUDGET,
    used: {
      pages: reading,
      domains: Math.min(5, reading),
      bytes: reading * 18_400,
      elapsedMs:
        9_000 *
        (1 +
          [
            'planning',
            'finding-sources',
            'reading',
            'extracting-evidence',
            'checking-conflicts',
            'ready',
          ].indexOf(stage)),
      estimatedCostUsd: 0,
      duplicates: stage === 'ready' ? 1 : 0,
      failures: stage === 'ready' ? 2 : 0,
      quarantined: stage === 'ready' ? 2 : 0,
    },
    sources: held[stage],
    passages: {},
    assessments:
      stage === 'ready'
        ? [
            {
              claimId: 'c1',
              supporting: 2,
              opposing: 1,
              sourceIds: ['rs-0000000001', 'rs-0000000002'],
              status: 'contested',
            },
            { claimId: 'c2', supporting: 0, opposing: 0, sourceIds: [], status: 'unassessed' },
          ]
        : [],
    conflictCount: stage === 'ready' ? 1 : 0,
    discovery: NO_PROVIDER,
    stoppedBecause: stage === 'ready' ? 'evidence-sufficient' : null,
    events: [
      {
        at: '2026-03-14T10:29:20.000Z',
        stage: stage === 'ready' ? 'ready' : stage,
        level: 'info',
        message: 'Read a page of council.example.org',
      },
    ],
    traceId: 'trace-1',
    startedAt: '2026-03-14T10:28:40.000Z',
    updatedAt: '2026-03-14T10:29:20.000Z',
    finishedAt: stage === 'ready' ? '2026-03-14T10:29:51.000Z' : null,
    modelUsed: false,
    ...overrides,
  });
}

export const MAY = { start: true, pause: true, cancel: true };

export const viewOf = (run: ResearchRun | null, may = MAY): ResearchView => ({
  run,
  revision: 1,
  discovery: run?.discovery ?? NO_PROVIDER,
  may,
});

/** What the server does with a request: the answer, and what the run becomes. */
type Handler = (body: unknown) => { status: number; body: unknown } | null;

export interface FakeResearch {
  /** What the server holds: the next read answers with it. */
  held: ResearchView;
  /** Every request made of the research, as `GET`, `POST start`, `POST pause`, `POST sources`. */
  calls: string[];
  /** Puts the research in a state, as if the run had moved on. */
  put: (view: ResearchView) => void;
  /** Answers the next request of this kind with an error instead of doing it. */
  refuse: (what: string, status: number, code: string, message: string) => void;
  /** Answers every read with an error until `mend` is called. */
  breakReads: (message?: string) => void;
  mend: () => void;
}

export interface FakeOptions {
  /** The project has no sources of its own: its documents, graph and passages are as a question-only project's. */
  questionOnly?: boolean;
  discovery?: typeof NO_PROVIDER;
  /** Whether the server says it researches. Default: it does. */
  enabled?: boolean;
}

const KNOWLEDGE_OF: Record<string, string> = {
  queued: 'queued',
  running: 'running',
  paused: 'running',
  blocked: 'cancelled',
  cancelled: 'cancelled',
  failed: 'failed',
};

/**
 * Stands in for the server's research on one page. The rest of the application is the real one: the project is read
 * from the server, and for a question-only project its sources are taken away until the run completes.
 */
export async function fakeResearch(
  page_: Page,
  start: ResearchView,
  options: FakeOptions = {},
): Promise<FakeResearch> {
  const enabled = options.enabled ?? true;
  const refusals = new Map<string, { status: number; code: string; message: string }>();
  let broken: string | null = null;
  const fake: FakeResearch = {
    held: start,
    calls: [],
    put: (view) => {
      fake.held = view;
    },
    refuse: (what, status, code, message) => void refusals.set(what, { status, code, message }),
    breakReads: (message = 'The server took too long to respond. Try again.') => {
      broken = message;
    },
    mend: () => {
      broken = null;
    },
  };

  const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const error = (route: Route, status: number, code: string, message: string) =>
    json(route, status, { error: { code, message } });

  // The server says that it researches, and what it would do with a question alone.
  await page_.route(/\/api\/config$/u, async (route) => {
    const response = await route.fetch();
    const config = (await response.json()) as Record<string, unknown>;
    await json(route, 200, {
      ...config,
      research: {
        enabled,
        discovery: options.discovery ?? NO_PROVIDER,
        budget: DEFAULT_RESEARCH_BUDGET,
      },
    });
  });

  // A project with no sources of its own, for as long as research has not given it any.
  if (options.questionOnly) {
    await page_.route(/\/api\/projects\/[^/]+$/u, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      const project = (await response.json()) as {
        documents: unknown[];
        graph: unknown;
        console?: { steps: Record<string, string> };
      };
      const status = fake.held.run?.status ?? 'none';
      if (status !== 'completed') {
        project.documents = [];
        project.graph = null;
        if (project.console) project.console.steps.knowledge = KNOWLEDGE_OF[status] ?? 'pending';
      }
      await json(route, 200, project);
    });
  }

  await page_.route(/\/api\/projects\/[^/]+\/research(?:\/[a-z]+)?$/u, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const action = path.replace(/^.*\/research\/?/u, '');
    const label = request.method() === 'GET' ? 'GET' : `POST ${action || 'start'}`;
    fake.calls.push(label);
    if (request.method() === 'GET' && broken) return error(route, 503, 'UNAVAILABLE', broken);
    const refused = refusals.get(label);
    if (refused) {
      refusals.delete(label);
      return error(route, refused.status, refused.code, refused.message);
    }
    const run = fake.held.run;
    const next = (status: ResearchRun['status'], extra: Partial<ResearchRun> = {}) => {
      if (!run) return;
      fake.held = {
        ...fake.held,
        run: { ...run, status, ...extra },
        revision: fake.held.revision + 1,
      };
    };
    if (request.method() === 'POST') {
      if (action === 'pause') next('paused');
      else if (action === 'resume') next('running');
      else if (action === 'cancel') next('cancelled', { stoppedBecause: 'cancelled' });
      else if (action === 'finish') {
        fake.held = viewOf(
          runAt('ready', {
            sources: pagesRead().map((source, index) =>
              source.outcome === 'used' ? { ...source, documentId: `D${index + 1}` } : source,
            ),
          }),
        );
      } else if (action === 'sources') {
        const body = JSON.parse(request.postData() ?? '{}') as { url?: string };
        const url = new URL(body.url ?? 'https://invalid.example.org');
        if (/^(?:10\.|127\.|192\.168\.|localhost)/u.test(url.hostname)) {
          return error(
            route,
            422,
            'URL_BLOCKED',
            'That address is on a private or local network, which Swarm never reads.',
          );
        }
        if (run) {
          const added = page(run.sources.length + 20, {
            title: `Page of ${url.hostname}`,
            requestedUrl: url.href,
            finalUrl: url.href,
            outcome: 'read',
            discoveredBy: 'user-added',
          });
          next(run.status, { sources: [...run.sources, added] });
        }
      } else {
        // Starting: a run that is waiting for its turn.
        fake.held = viewOf(runAt('planning', { status: 'queued' }));
      }
      return json(route, 202, fake.held);
    }
    return json(route, 200, fake.held);
  });

  return fake;
}

/** What `viewOf` makes of a run that has reached a stage, for the specs that put a run at each in turn. */
export const STAGES: readonly ResearchStage[] = [
  'planning',
  'finding-sources',
  'reading',
  'extracting-evidence',
  'checking-conflicts',
  'ready',
];

export type Handlers = Record<string, Handler>;
