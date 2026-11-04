import { z } from 'zod';
import {
  DEFAULT_RESEARCH_BUDGET,
  RESEARCH_BUDGET_CEILING,
  researchBudgetSchema,
  type ResearchBudget,
} from '../../../shared/research.js';
import type { AppConfig } from '../../../shared/types.js';
import { SEARCH_PROVIDERS, searchProviderFor, type SearchProviderName } from './discovery.js';
import { DEFAULT_SEARCH_TIMEOUT_MS } from './search.js';

/** The least each limit may be: the lower bounds of `researchBudgetSchema`. */
export const BUDGET_FLOOR: ResearchBudget = {
  maxPages: 1,
  maxDomains: 1,
  maxDepth: 0,
  maxBytesPerPage: 10_000,
  maxTotalBytes: 10_000,
  maxElapsedMs: 5_000,
  maxEstimatedCostUsd: 0,
  maxDuplicateRatio: 0,
  maxFailedRequests: 0,
  maxRedirects: 0,
  perDomainDelayMs: 250,
};

/** What the operator of a server decides about research. The limits can only be lowered from the shared ceiling. */
export interface ResearchConfig {
  /** Whether this server does automatic research. Reading pages must also be on: see `researchEnabled`. */
  enabled: boolean;
  searchProvider: SearchProviderName;
  /** The key of a provider that needs one (`RESEARCH_SEARCH_API_KEY`). A secret: it is in no answer, log line or error. */
  searchApiKey: string | null;
  /** Where the provider is reached when it is not at its own address, for a test double (`RESEARCH_SEARCH_ENDPOINT`). */
  searchEndpoint: string | null;
  /** How long one search may take. */
  searchTimeoutMs: number;
  /** The most a run may use. A person's request is held to it. */
  ceiling: ResearchBudget;
  /** What a run uses when nothing more is asked, held to the ceiling. */
  defaults: ResearchBudget;
  /** The least wait between two requests to one site. A person may lengthen it, never shorten it. */
  minDelayMs: number;
  /** How long a run may stay paused before it ends with what it has read. */
  maxPauseMs: number;
}

/** The longest a pause may be set to: a job is held to fifteen minutes in all, and a run has work to do after it. */
const MAX_PAUSE_SECONDS = 420;
const DEFAULT_PAUSE_SECONDS = 300;

const flag = z.enum(['on', 'off', 'true', 'false', '1', '0']);

/** An empty setting is an unset one, as `.env.example` leaves them. */
const unset = (value: unknown): unknown => (value === '' ? undefined : value);

const whole = (min: number, max: number) =>
  z.preprocess(unset, z.coerce.number().int().min(min).max(max).optional());
const amount = (min: number, max: number) =>
  z.preprocess(unset, z.coerce.number().min(min).max(max).optional());

const environmentSchema = z.object({
  RESEARCH_ENABLED: z.preprocess(unset, flag.default('on')),
  RESEARCH_SEARCH_PROVIDER: z.preprocess(unset, z.enum(SEARCH_PROVIDERS).default('none')),
  RESEARCH_SEARCH_API_KEY: z.preprocess(unset, z.string().min(8).max(512).optional()),
  RESEARCH_SEARCH_ENDPOINT: z.preprocess(unset, z.url().max(300).optional()),
  RESEARCH_SEARCH_TIMEOUT_MS: whole(1_000, 30_000),
  RESEARCH_MAX_PAGES: whole(BUDGET_FLOOR.maxPages, RESEARCH_BUDGET_CEILING.maxPages),
  RESEARCH_MAX_DOMAINS: whole(BUDGET_FLOOR.maxDomains, RESEARCH_BUDGET_CEILING.maxDomains),
  RESEARCH_MAX_DEPTH: whole(BUDGET_FLOOR.maxDepth, RESEARCH_BUDGET_CEILING.maxDepth),
  RESEARCH_MAX_BYTES_PER_PAGE: whole(
    BUDGET_FLOOR.maxBytesPerPage,
    RESEARCH_BUDGET_CEILING.maxBytesPerPage,
  ),
  RESEARCH_MAX_TOTAL_BYTES: whole(
    BUDGET_FLOOR.maxTotalBytes,
    RESEARCH_BUDGET_CEILING.maxTotalBytes,
  ),
  RESEARCH_MAX_SECONDS: whole(
    BUDGET_FLOOR.maxElapsedMs / 1_000,
    RESEARCH_BUDGET_CEILING.maxElapsedMs / 1_000,
  ),
  RESEARCH_MAX_COST_USD: amount(
    BUDGET_FLOOR.maxEstimatedCostUsd,
    RESEARCH_BUDGET_CEILING.maxEstimatedCostUsd,
  ),
  RESEARCH_DOMAIN_DELAY_MS: whole(
    BUDGET_FLOOR.perDomainDelayMs,
    RESEARCH_BUDGET_CEILING.perDomainDelayMs,
  ),
  RESEARCH_MAX_PAUSE_SECONDS: whole(30, MAX_PAUSE_SECONDS),
});

/**
 * Reads the settings of research from the environment, and names the setting that is wrong without
 * repeating its value. A limit can be set below what a run may use, never above it. Nothing here
 * switches the address policy off: a setting that would read plain HTTP or a private address does not
 * exist, and research reads https only.
 */
export function loadResearchConfig(
  environment: Record<string, string | undefined> = process.env,
): ResearchConfig {
  const result = environmentSchema.safeParse(environment);
  if (!result.success) {
    throw new Error(
      `Invalid research configuration: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}.`,
    );
  }
  const input = result.data;
  const ceiling: ResearchBudget = {
    ...RESEARCH_BUDGET_CEILING,
    maxPages: input.RESEARCH_MAX_PAGES ?? RESEARCH_BUDGET_CEILING.maxPages,
    maxDomains: input.RESEARCH_MAX_DOMAINS ?? RESEARCH_BUDGET_CEILING.maxDomains,
    maxDepth: input.RESEARCH_MAX_DEPTH ?? RESEARCH_BUDGET_CEILING.maxDepth,
    maxBytesPerPage: input.RESEARCH_MAX_BYTES_PER_PAGE ?? RESEARCH_BUDGET_CEILING.maxBytesPerPage,
    maxTotalBytes: input.RESEARCH_MAX_TOTAL_BYTES ?? RESEARCH_BUDGET_CEILING.maxTotalBytes,
    maxElapsedMs:
      input.RESEARCH_MAX_SECONDS === undefined
        ? RESEARCH_BUDGET_CEILING.maxElapsedMs
        : input.RESEARCH_MAX_SECONDS * 1_000,
    maxEstimatedCostUsd: input.RESEARCH_MAX_COST_USD ?? RESEARCH_BUDGET_CEILING.maxEstimatedCostUsd,
  };
  const minDelayMs = input.RESEARCH_DOMAIN_DELAY_MS ?? DEFAULT_RESEARCH_BUDGET.perDomainDelayMs;
  const defaults: ResearchBudget = { ...DEFAULT_RESEARCH_BUDGET };
  for (const key of Object.keys(defaults) as (keyof ResearchBudget)[]) {
    defaults[key] = Math.min(defaults[key], ceiling[key]);
  }
  defaults.perDomainDelayMs = Math.max(defaults.perDomainDelayMs, minDelayMs);
  return {
    enabled: !['off', 'false', '0'].includes(input.RESEARCH_ENABLED),
    searchProvider: input.RESEARCH_SEARCH_PROVIDER,
    searchApiKey: input.RESEARCH_SEARCH_API_KEY ?? null,
    searchEndpoint: input.RESEARCH_SEARCH_ENDPOINT ?? null,
    searchTimeoutMs: input.RESEARCH_SEARCH_TIMEOUT_MS ?? DEFAULT_SEARCH_TIMEOUT_MS,
    ceiling: researchBudgetSchema.parse(ceiling),
    defaults: researchBudgetSchema.parse(defaults),
    minDelayMs,
    maxPauseMs: (input.RESEARCH_MAX_PAUSE_SECONDS ?? DEFAULT_PAUSE_SECONDS) * 1_000,
  };
}

const FRACTIONAL: ReadonlySet<keyof ResearchBudget> = new Set([
  'maxEstimatedCostUsd',
  'maxDuplicateRatio',
]);

/**
 * The budget of a run: what a person asked for on top of the defaults, held to what the server
 * allows. It is held, not refused: a person cannot raise a limit above the ceiling, and cannot lower
 * the wait between two requests to one site below the server's own.
 */
export function clampBudget(
  config: Pick<ResearchConfig, 'ceiling' | 'defaults' | 'minDelayMs'>,
  requested: Partial<Record<keyof ResearchBudget, number>> = {},
): ResearchBudget {
  const budget: ResearchBudget = { ...config.defaults };
  for (const key of Object.keys(budget) as (keyof ResearchBudget)[]) {
    const wanted = requested[key];
    if (wanted === undefined || !Number.isFinite(wanted)) continue;
    const low = key === 'perDomainDelayMs' ? config.minDelayMs : BUDGET_FLOOR[key];
    const value = FRACTIONAL.has(key) ? wanted : Math.floor(wanted);
    budget[key] = Math.min(config.ceiling[key], Math.max(low, value));
  }
  budget.maxBytesPerPage = Math.min(budget.maxBytesPerPage, budget.maxTotalBytes);
  return researchBudgetSchema.parse(budget);
}

/** Whether this server does automatic research: it is on, and the server reads public pages at all. */
export function researchEnabled(config: {
  research: Pick<ResearchConfig, 'enabled'>;
  urlIngestion: { enabled: boolean };
}): boolean {
  return config.research.enabled && config.urlIngestion.enabled;
}

/** What `GET /api/config` says about research. */
export function publicResearch(config: {
  research: ResearchConfig;
  urlIngestion: { enabled: boolean };
}): NonNullable<AppConfig['research']> {
  return {
    enabled: researchEnabled(config),
    discovery: searchProviderFor(config.research).status(),
    budget: config.research.defaults,
  };
}
