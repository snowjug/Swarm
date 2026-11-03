import { z } from 'zod';

/**
 * Automatic research: what a person asks for, what a run is allowed to spend, what it plans, what it
 * read, and what it set aside. A run is one artifact of kind `research` (see `artifacts.ts`), so it is
 * stored, revised and removed with its project like every other result.
 *
 * Nothing here is a claim about the world. A source record says what was fetched and how it was
 * judged; whether a page is right is the evidence ledger's question, and a person's.
 */
export const RESEARCH_SCHEMA_VERSION = 1;

/** Passages a run indexes: the project's own chunk limit is lower, so this only keeps the artifact bounded. */
export const MAX_RESEARCH_PASSAGES = 600;

const line = (max: number) => z.string().trim().max(max);

// ---------------------------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------------------------

/**
 * `url`: the person named one page. `domain`: they named a site. `discovery`: they gave only a
 * question. `manual`: automatic research is off and only the sources they attach are used.
 */
export const RESEARCH_MODES = ['url', 'domain', 'discovery', 'manual'] as const;
export type ResearchMode = (typeof RESEARCH_MODES)[number];

/** What a person asked for when they started. The server clamps it to its own ceilings. */
export const researchIntakeSchema = z
  .object({
    /** Automatic research is the default. `false` is manual mode. */
    auto: z.boolean().default(true),
    /** One page the person named, as typed. It is validated and fetched by the server alone. */
    url: line(2_048).optional(),
    /** One site the person named, without a path. */
    domain: line(253).optional(),
    /** Free text such as "EU rules only"; it guides ranking and is never an instruction to a fetcher. */
    guidance: line(600).optional(),
    horizon: line(200).optional(),
    geography: line(200).optional(),
  })
  .strict();
export type ResearchIntake = z.infer<typeof researchIntakeSchema>;
export type ResearchIntakeInput = z.input<typeof researchIntakeSchema>;

export function researchModeOf(
  intake: Pick<ResearchIntake, 'auto' | 'url' | 'domain'>,
): ResearchMode {
  if (!intake.auto) return 'manual';
  if (intake.url?.trim()) return 'url';
  if (intake.domain?.trim()) return 'domain';
  return 'discovery';
}

// ---------------------------------------------------------------------------------------------
// Budget: every limit is deterministic and every one is enforced outside the model
// ---------------------------------------------------------------------------------------------

export const researchBudgetSchema = z
  .object({
    maxPages: z.int().min(1).max(40),
    maxDomains: z.int().min(1).max(10),
    /** Links followed from the starting page: 0 reads only the page (or pages) named. */
    maxDepth: z.int().min(0).max(3),
    maxBytesPerPage: z.int().min(10_000).max(5_000_000),
    maxTotalBytes: z.int().min(10_000).max(50_000_000),
    maxElapsedMs: z.int().min(5_000).max(600_000),
    /** Estimated model spend for the run, in US dollars. It is an estimate, never a bill. */
    maxEstimatedCostUsd: z.number().min(0).max(5),
    /** The share of fetched pages that may repeat what was already read before the run stops. */
    maxDuplicateRatio: z.number().min(0).max(1),
    maxFailedRequests: z.int().min(0).max(50),
    maxRedirects: z.int().min(0).max(5),
    /** The least time between two requests to one site. */
    perDomainDelayMs: z.int().min(250).max(10_000),
  })
  .strict();
export type ResearchBudget = z.infer<typeof researchBudgetSchema>;

export const DEFAULT_RESEARCH_BUDGET: ResearchBudget = {
  maxPages: 12,
  maxDomains: 4,
  maxDepth: 1,
  maxBytesPerPage: 1_500_000,
  maxTotalBytes: 8_000_000,
  maxElapsedMs: 120_000,
  maxEstimatedCostUsd: 0.25,
  maxDuplicateRatio: 0.5,
  maxFailedRequests: 8,
  maxRedirects: 5,
  perDomainDelayMs: 1_000,
};

/** The most a person or a deployment may raise each limit to. The schema bounds are the same numbers. */
export const RESEARCH_BUDGET_CEILING: ResearchBudget = {
  maxPages: 30,
  maxDomains: 8,
  maxDepth: 2,
  maxBytesPerPage: 2_000_000,
  maxTotalBytes: 20_000_000,
  maxElapsedMs: 300_000,
  maxEstimatedCostUsd: 2,
  maxDuplicateRatio: 0.8,
  maxFailedRequests: 20,
  maxRedirects: 5,
  perDomainDelayMs: 10_000,
};

// ---------------------------------------------------------------------------------------------
// Stages, status and why a run stopped
// ---------------------------------------------------------------------------------------------

/** The stages a person sees, in order. A stage is shown as reached only when the run has reached it. */
export const RESEARCH_STAGES = [
  'planning',
  'finding-sources',
  'reading',
  'extracting-evidence',
  'checking-conflicts',
  'ready',
] as const;
export type ResearchStage = (typeof RESEARCH_STAGES)[number];

export const RESEARCH_STAGE_LABELS: Record<ResearchStage, string> = {
  planning: 'Planning',
  'finding-sources': 'Finding sources',
  reading: 'Reading',
  'extracting-evidence': 'Extracting evidence',
  'checking-conflicts': 'Checking conflicts',
  ready: 'Ready',
};

export const RESEARCH_STATUSES = [
  'queued',
  'running',
  'paused',
  'completed',
  'cancelled',
  'failed',
  /** Nothing could be read and a rule, not an error, is why: discovery has no provider, or every address was refused. */
  'blocked',
] as const;
export type ResearchStatus = (typeof RESEARCH_STATUSES)[number];

export const RESEARCH_STOP_REASONS = [
  'evidence-sufficient',
  'no-new-signal',
  'page-limit',
  'domain-limit',
  'byte-limit',
  'time-limit',
  'cost-limit',
  'duplicate-limit',
  'failure-limit',
  'frontier-exhausted',
  'cancelled',
  'safety-block',
  'discovery-unconfigured',
] as const;
export type ResearchStopReason = (typeof RESEARCH_STOP_REASONS)[number];

export const RESEARCH_STOP_LABELS: Record<ResearchStopReason, string> = {
  'evidence-sufficient': 'The key claims have supporting or opposing evidence.',
  'no-new-signal': 'The latest pages added nothing materially new.',
  'page-limit': 'The page limit was reached.',
  'domain-limit': 'The site limit was reached.',
  'byte-limit': 'The size limit was reached.',
  'time-limit': 'The time limit was reached.',
  'cost-limit': 'The model cost limit was reached.',
  'duplicate-limit': 'Too many pages repeated what was already read.',
  'failure-limit': 'Too many requests failed.',
  'frontier-exhausted': 'There were no more relevant pages to read.',
  cancelled: 'A person stopped the research.',
  'safety-block': 'A safety rule blocked further reading.',
  'discovery-unconfigured':
    'Finding sources from a question alone needs a search provider that is not set up.',
};

// ---------------------------------------------------------------------------------------------
// Plan: what to look for. A plan names things to find; it never names an address to fetch.
// ---------------------------------------------------------------------------------------------

export const SOURCE_CATEGORIES = [
  'primary',
  'official-documentation',
  'official-statement',
  'government-regulatory',
  'research-publication',
  'credible-reporting',
  'user-supplied',
  'community',
  'unclassified',
] as const;
export type SourceCategory = (typeof SOURCE_CATEGORIES)[number];

export const SOURCE_CATEGORY_LABELS: Record<SourceCategory, string> = {
  primary: 'Primary source',
  'official-documentation': 'Official documentation',
  'official-statement': 'Official statement',
  'government-regulatory': 'Government or regulator',
  'research-publication': 'Research publication',
  'credible-reporting': 'Credible reporting',
  'user-supplied': 'Supplied by you',
  community: 'Community or user-generated',
  unclassified: 'Unclassified',
};

/** An estimate from the kind of site, never a verdict on whether a page is right. */
export const AUTHORITY_ESTIMATES = ['high', 'medium', 'low', 'unknown'] as const;
export type AuthorityEstimate = (typeof AUTHORITY_ESTIMATES)[number];

export const researchEntitySchema = z.object({
  name: line(120).min(1),
  kind: z.enum([
    'organization',
    'product',
    'role',
    'place',
    'regulation',
    'technology',
    'concept',
    'other',
  ]),
});
export type ResearchEntity = z.infer<typeof researchEntitySchema>;

export const researchPlanSchema = z.object({
  version: z.literal(RESEARCH_SCHEMA_VERSION),
  question: line(2_000).min(1),
  mode: z.enum(RESEARCH_MODES),
  entities: z.array(researchEntitySchema).max(12).default([]),
  topics: z.array(line(160).min(1)).max(10).default([]),
  /** What research should try to settle. Ids are stable within the plan: `c1`, `c2`... */
  claimsToVerify: z
    .array(
      z.object({
        id: z.string().regex(/^c[0-9]{1,2}$/u),
        statement: line(300).min(1),
        why: line(300).default(''),
      }),
    )
    .max(10)
    .default([]),
  /**
   * Kinds of source worth reading, with an optional site to suggest. A suggestion is shown to a
   * person, who may add it; it is never fetched on its own.
   */
  likelySources: z
    .array(
      z.object({
        category: z.enum(SOURCE_CATEGORIES),
        description: line(240).min(1),
        suggestedDomain: line(253).optional(),
      }),
    )
    .max(8)
    .default([]),
  timeSensitivity: z.object({
    level: z.enum(['none', 'recent', 'fast-moving']),
    note: line(240).default(''),
  }),
  conflictsToLookFor: z.array(line(240).min(1)).max(6).default([]),
  missingEvidence: z.array(line(240).min(1)).max(8).default([]),
  /** The stopping rules in words, for a person. The budget is what enforces them. */
  stoppingConditions: z.array(line(240).min(1)).max(8).default([]),
  origin: z.enum(['rules', 'model']),
});
export type ResearchPlan = z.infer<typeof researchPlanSchema>;

// ---------------------------------------------------------------------------------------------
// What was read
// ---------------------------------------------------------------------------------------------

export const ROBOTS_DECISIONS = ['allowed', 'absent', 'disallowed', 'skipped'] as const;
export type RobotsDecision = (typeof ROBOTS_DECISIONS)[number];

/** What became of a page. `used` became a document of the project; `read` was read and set aside. */
export const SOURCE_OUTCOMES = [
  'used',
  'read',
  'quarantined',
  'blocked',
  'failed',
  'duplicate',
  'skipped',
] as const;
export type SourceOutcome = (typeof SOURCE_OUTCOMES)[number];

/** Why a page was kept out of the evidence. Quarantined pages are listed, never read as evidence. */
export const QUARANTINE_REASONS = [
  'empty',
  'login-page',
  'consent-wall',
  'paywall',
  'error-page',
  'malformed',
  'oversized',
  'unsupported-type',
  'binary-as-text',
  'prompt-injection',
] as const;
export type QuarantineReason = (typeof QUARANTINE_REASONS)[number];

/** How a request failed, as a class that can be counted and alerted on. */
export const FETCH_ERROR_CLASSES = [
  'invalid-url',
  'blocked-address',
  'blocked-scheme',
  'blocked-port',
  'robots-disallowed',
  'dns',
  'connect',
  'timeout',
  'tls',
  'http-status',
  'redirect-refused',
  'too-large',
  'unsupported-type',
  'decompression-limit',
  'circuit-open',
  'cancelled',
  'unknown',
] as const;
export type FetchErrorClass = (typeof FETCH_ERROR_CLASSES)[number];

export const DISCOVERED_BY = [
  'user-url',
  'user-domain',
  'link',
  'sitemap',
  'search',
  'user-added',
] as const;

export const researchSourceSchema = z.object({
  /** Stable for a page and its content: `rs-` and ten hex digits. */
  id: z.string().regex(/^rs-[0-9a-f]{10}$/u),
  /** Addresses are stored with secret-looking query values removed, as `provenance.ts` does. */
  requestedUrl: line(2_048),
  finalUrl: line(2_048).nullable().default(null),
  canonicalUrl: line(2_048).nullable().default(null),
  fetchedAt: z.iso.datetime().nullable().default(null),
  httpStatus: z.int().min(100).max(599).nullable().default(null),
  contentType: line(120).nullable().default(null),
  /** SHA-256 of the text that was read, as `SourceProvenance.sha256`. */
  contentHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/u)
    .nullable()
    .default(null),
  title: line(300).nullable().default(null),
  retrievalMethod: z.enum(['http-get', 'user-supplied']),
  category: z.enum(SOURCE_CATEGORIES),
  authority: z.enum(AUTHORITY_ESTIMATES),
  /** One sentence on why this page was read, from rules or from a model's ranking. */
  relevance: line(300).default(''),
  publishedAt: z.iso.date().nullable().default(null),
  updatedAt: z.iso.date().nullable().default(null),
  /** Only when the page names its author. */
  author: line(160).nullable().default(null),
  depth: z.int().min(0).max(3),
  parentUrl: line(2_048).nullable().default(null),
  discoveredBy: z.enum(DISCOVERED_BY),
  robots: z.enum(ROBOTS_DECISIONS),
  outcome: z.enum(SOURCE_OUTCOMES),
  /** Why a page was quarantined, with a short human reason. */
  quarantine: z
    .object({ reason: z.enum(QUARANTINE_REASONS), detail: line(240) })
    .nullable()
    .default(null),
  failure: z
    .object({ class: z.enum(FETCH_ERROR_CLASSES), message: line(240) })
    .nullable()
    .default(null),
  /** Things a reader should know before relying on the page: cut short, scripted, tables skipped... */
  warnings: z.array(line(240)).max(8).default([]),
  bytes: z.int().min(0).default(0),
  extractionMethod: z
    .enum(['html-main', 'html-page', 'html-all', 'plain-text', 'json', 'csv', 'pdf'])
    .nullable()
    .default(null),
  /** The project's document made from this page, when it was used. */
  documentId: z.string().max(80).nullable().default(null),
  passageCount: z.int().min(0).default(0),
  /** Set when the page's text matched an AI-directed instruction pattern: it is labelled, not obeyed. */
  injectionFlagged: z.boolean().default(false),
});
export type ResearchSource = z.infer<typeof researchSourceSchema>;

/** Where a passage sits in its page: the part of a page the project's evidence chunks do not keep. */
export const passageLocationSchema = z.object({
  sourceId: z.string().max(40),
  headingPath: z.array(line(160)).max(6).default([]),
  kind: z.enum(['paragraph', 'list', 'table', 'quote', 'structured', 'metadata']),
});
export type PassageLocation = z.infer<typeof passageLocationSchema>;

/** For each planned claim: how much of what was read bears on it, either way. */
export const evidenceAssessmentSchema = z.object({
  claimId: z.string().regex(/^c[0-9]{1,2}$/u),
  supporting: z.int().min(0),
  opposing: z.int().min(0),
  sourceIds: z.array(z.string().max(40)).max(20).default([]),
  status: z.enum(['supported', 'contested', 'opposed', 'unassessed']),
});
export type EvidenceAssessment = z.infer<typeof evidenceAssessmentSchema>;

export const researchEventSchema = z.object({
  at: z.iso.datetime(),
  stage: z.enum(RESEARCH_STAGES),
  level: z.enum(['info', 'warn', 'block']),
  /** Never contains page text or an address with a secret in it. */
  message: line(240),
});
export type ResearchEvent = z.infer<typeof researchEventSchema>;

export const researchUsedSchema = z.object({
  pages: z.int().min(0),
  domains: z.int().min(0),
  bytes: z.int().min(0),
  elapsedMs: z.int().min(0),
  estimatedCostUsd: z.number().min(0),
  duplicates: z.int().min(0),
  failures: z.int().min(0),
  quarantined: z.int().min(0),
});
export type ResearchUsed = z.infer<typeof researchUsedSchema>;

/** Whether broader discovery can run, and when it cannot, the way to make it so. */
export const discoveryStatusSchema = z.object({
  available: z.boolean(),
  provider: line(80).nullable().default(null),
  message: line(400),
});
export type DiscoveryStatus = z.infer<typeof discoveryStatusSchema>;

export const researchRunSchema = z.object({
  version: z.literal(RESEARCH_SCHEMA_VERSION),
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u),
  status: z.enum(RESEARCH_STATUSES),
  stage: z.enum(RESEARCH_STAGES),
  mode: z.enum(RESEARCH_MODES),
  intake: researchIntakeSchema,
  plan: researchPlanSchema.nullable().default(null),
  budget: researchBudgetSchema,
  used: researchUsedSchema,
  sources: z.array(researchSourceSchema).max(80).default([]),
  /** Keyed by the project's evidence chunk id, so Ground can show where a passage sat in its page. */
  passages: z
    .record(z.string().max(40), passageLocationSchema)
    .refine((found) => Object.keys(found).length <= MAX_RESEARCH_PASSAGES, 'Too many passages.')
    .default({}),
  assessments: z.array(evidenceAssessmentSchema).max(10).default([]),
  /** How many contradictions the evidence ledger's check found among what was read. */
  conflictCount: z.int().min(0).default(0),
  discovery: discoveryStatusSchema,
  stoppedBecause: z.enum(RESEARCH_STOP_REASONS).nullable().default(null),
  events: z.array(researchEventSchema).max(80).default([]),
  /** Correlates this run with its log lines and spans. Not secret. */
  traceId: z.string().max(64),
  startedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable().default(null),
  /** The question was read by a model under the person's choice; research never sends a source's text to one without it. */
  modelUsed: z.boolean().default(false),
});
export type ResearchRun = z.infer<typeof researchRunSchema>;

/** `GET /api/projects/:id/research`. `run` is null until research has started. */
export interface ResearchView {
  run: ResearchRun | null;
  revision: number;
  discovery: DiscoveryStatus;
  may: { start: boolean; pause: boolean; cancel: boolean };
}
