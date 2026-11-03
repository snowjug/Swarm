/**
 * What the tests of the research surface are given to read: runs at each point of their life, built through the
 * contract's own schema so that a fixture can never say what the server could not. Every address is on a reserved
 * name (`.test`, `example.org`) and every page is invented: nothing here is, or names, a real source.
 */

import {
  DEFAULT_RESEARCH_BUDGET,
  researchPlanSchema,
  researchRunSchema,
  researchSourceSchema,
  type DiscoveryStatus,
  type ResearchPlan,
  type ResearchRun,
  type ResearchSource,
  type ResearchStage,
  type ResearchView,
} from '../../../../../shared/research';

export const QUESTION = 'What could happen if the ferry fares fall by a third next spring?';

export const NOW = '2026-03-14T10:30:00.000Z';

const hex = (seed: number, length: number): string =>
  Array.from({ length }, (_, index) => ((seed * 7 + index * 3) % 16).toString(16)).join('');

/** A page that was read and used, unless the overrides say otherwise. */
export function source(n: number, overrides: Partial<ResearchSource> = {}): ResearchSource {
  return researchSourceSchema.parse({
    id: `rs-${n.toString(16).padStart(10, '0')}`,
    requestedUrl: `https://fares.example.org/page-${n}`,
    finalUrl: `https://fares.example.org/page-${n}`,
    canonicalUrl: null,
    fetchedAt: '2026-03-14T10:29:12.000Z',
    httpStatus: 200,
    contentType: 'text/html; charset=utf-8',
    contentHash: hex(n, 64),
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
    documentId: `D${n}`,
    passageCount: 4,
    injectionFlagged: false,
    ...overrides,
  });
}

/** The pages of a finished run: some used, and every kind of page that was set aside, each with its reason. */
export function pages(): ResearchSource[] {
  return [
    source(1, {
      title: 'Council fares review: summary of the evidence',
      requestedUrl: 'https://council.example.org/fares/review',
      finalUrl: 'https://council.example.org/fares/review-2026',
      category: 'government-regulatory',
      publishedAt: '2026-02-10',
      updatedAt: '2026-03-02',
      discoveredBy: 'user-domain',
      passageCount: 6,
    }),
    source(2, {
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
    source(3, {
      title: 'Riders talk about cheaper evening crossings',
      requestedUrl: 'https://forum.example.org/threads/evening-fares',
      finalUrl: 'https://forum.example.org/threads/evening-fares',
      category: 'community',
      authority: 'low',
      publishedAt: null,
      discoveredBy: 'link',
      depth: 1,
      outcome: 'read',
      documentId: null,
      warnings: ['Only the first page of the thread was read.'],
      passageCount: 2,
    }),
    source(4, {
      title: null,
      requestedUrl: 'https://members.example.org/reports/annual',
      finalUrl: 'https://members.example.org/login?next=/reports/annual',
      category: 'unclassified',
      authority: 'unknown',
      publishedAt: null,
      outcome: 'quarantined',
      quarantine: { reason: 'login-page', detail: 'The page asks for a member sign-in.' },
      documentId: null,
      extractionMethod: null,
      passageCount: 0,
      bytes: 2_100,
    }),
    source(5, {
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
      documentId: null,
      passageCount: 0,
    }),
    source(6, {
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
      documentId: null,
      extractionMethod: null,
      passageCount: 0,
      bytes: 0,
    }),
    source(7, {
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
      documentId: null,
      extractionMethod: null,
      passageCount: 0,
      bytes: 0,
    }),
    source(8, {
      title: 'Council fares review: summary of the evidence (print version)',
      requestedUrl: 'https://council.example.org/fares/review-2026?print=1',
      finalUrl: 'https://council.example.org/fares/review-2026?print=1',
      outcome: 'duplicate',
      documentId: null,
      passageCount: 0,
    }),
  ];
}

export function plan(overrides: Partial<ResearchPlan> = {}): ResearchPlan {
  return researchPlanSchema.parse({
    version: 1,
    question: QUESTION,
    mode: 'discovery',
    entities: [
      { name: 'Ferry operator', kind: 'organization' },
      { name: 'City council', kind: 'organization' },
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
        category: 'government-regulatory',
        description: 'The regulator’s published fare rules',
        suggestedDomain: 'regulator.example.org',
      },
      {
        category: 'official-statement',
        description: 'The operator’s own timetable and fare notices',
        suggestedDomain: 'operator.example.org',
      },
      { category: 'research-publication', description: 'Studies of fare changes on ferry routes' },
    ],
    timeSensitivity: { level: 'recent', note: 'Fares are revised each spring.' },
    conflictsToLookFor: ['Different crossing counts for the same year'],
    missingEvidence: ['Cost per crossing'],
    stoppingConditions: ['The page limit is reached', 'The latest pages add nothing new'],
    origin: 'rules',
    ...overrides,
  });
}

export const NO_PROVIDER: DiscoveryStatus = {
  available: false,
  provider: null,
  message:
    'No search provider is configured. Set one up as described in the production notes, or name a site or a page.',
};

export function run(overrides: Partial<ResearchRun> = {}): ResearchRun {
  return researchRunSchema.parse({
    version: 1,
    id: 'run-1',
    status: 'running',
    stage: 'reading',
    mode: 'discovery',
    intake: { auto: true },
    plan: plan(),
    budget: DEFAULT_RESEARCH_BUDGET,
    used: {
      pages: 4,
      domains: 3,
      bytes: 74_000,
      elapsedMs: 38_000,
      estimatedCostUsd: 0,
      duplicates: 0,
      failures: 0,
      quarantined: 0,
    },
    sources: [],
    passages: {},
    assessments: [],
    conflictCount: 0,
    discovery: NO_PROVIDER,
    stoppedBecause: null,
    events: [
      {
        at: '2026-03-14T10:29:20.000Z',
        stage: 'reading',
        level: 'info',
        message: 'Read a page of council.example.org',
      },
    ],
    traceId: 'trace-1',
    startedAt: '2026-03-14T10:28:40.000Z',
    updatedAt: '2026-03-14T10:29:20.000Z',
    finishedAt: null,
    modelUsed: false,
    ...overrides,
  });
}

export const MAY = { start: true, pause: true, cancel: true };

export function view(
  runOrNull: ResearchRun | null,
  overrides: Partial<ResearchView> = {},
): ResearchView {
  return {
    run: runOrNull,
    revision: 3,
    discovery: runOrNull?.discovery ?? NO_PROVIDER,
    may: MAY,
    ...overrides,
  };
}

/** A run at a stage, with the pages it would hold by then. */
export function runningAt(stage: ResearchStage, overrides: Partial<ResearchRun> = {}): ResearchRun {
  const held = pages();
  const byStage: Record<ResearchStage, ResearchSource[]> = {
    planning: [],
    'finding-sources': held.slice(0, 2).map((page) => ({ ...page, outcome: 'read' as const })),
    reading: held.slice(0, 4).map((page) => ({
      ...page,
      outcome: page.outcome === 'used' ? ('read' as const) : page.outcome,
    })),
    'extracting-evidence': held.slice(0, 5).map((page) => ({
      ...page,
      outcome: page.outcome === 'used' ? ('read' as const) : page.outcome,
    })),
    'checking-conflicts': held.slice(0, 7).map((page) => ({
      ...page,
      outcome: page.outcome === 'used' ? ('read' as const) : page.outcome,
    })),
    ready: held,
  };
  return run({
    stage,
    sources: byStage[stage],
    plan: stage === 'planning' ? null : plan(),
    ...overrides,
  });
}

export function completed(overrides: Partial<ResearchRun> = {}): ResearchRun {
  return run({
    status: 'completed',
    stage: 'ready',
    sources: pages(),
    conflictCount: 1,
    used: {
      pages: 7,
      domains: 5,
      bytes: 212_000,
      elapsedMs: 71_000,
      estimatedCostUsd: 0,
      duplicates: 1,
      failures: 2,
      quarantined: 2,
    },
    assessments: [
      {
        claimId: 'c1',
        supporting: 2,
        opposing: 1,
        sourceIds: ['rs-0000000001', 'rs-0000000002'],
        status: 'contested',
      },
      { claimId: 'c2', supporting: 0, opposing: 0, sourceIds: [], status: 'unassessed' },
    ],
    stoppedBecause: 'evidence-sufficient',
    finishedAt: '2026-03-14T10:29:51.000Z',
    updatedAt: '2026-03-14T10:29:51.000Z',
    ...overrides,
  });
}
