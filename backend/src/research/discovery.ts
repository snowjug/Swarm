import type { DiscoveryStatus } from '../../../shared/research.js';
import {
  DEFAULT_SEARCH_TIMEOUT_MS,
  braveSearch,
  wikipediaSearch,
  type SearchSettings,
} from './search.js';

/** An address a search provider offered for a question. Nothing else of the answer is kept. */
export interface SearchHit {
  url: string;
}

/**
 * What finds pages for a question that names none. Swarm ships with none switched on: choosing one is a decision
 * about cost, terms of use and what a question may be sent to, and it is the operator's (`RESEARCH_SEARCH_PROVIDER`).
 * A provider returns addresses and nothing more (the title and snippet of a result are what a site chose to say about
 * itself), and every address is vetted by the crawler like any other before anything is fetched. Reading the result
 * pages of a search engine is never a way to discover: only a provider that offers an interface for it.
 *
 * It is given a query made from the names and topics of the plan, never the question as typed (`searchQueryOf`).
 */
export interface SearchProvider {
  /** Whether it can search, who it is, and what to tell a person when it cannot. */
  status(): DiscoveryStatus;
  search(query: string, options: { limit: number; signal: AbortSignal }): Promise<SearchHit[]>;
}

export const DISCOVERY_UNCONFIGURED_MESSAGE =
  'This server has no search provider, so it cannot look for sources from a question alone. ' +
  'Name a page or a site, add sources of your own, or ask whoever runs this server about ' +
  'RESEARCH_SEARCH_PROVIDER (docs/production/LIMITATIONS.md, item A6).';

const UNCONFIGURED: DiscoveryStatus = {
  available: false,
  provider: null,
  message: DISCOVERY_UNCONFIGURED_MESSAGE,
};

/** The default: nothing to search with, said plainly. It never invents a provider and never reads a search page. */
export const unconfiguredSearch: SearchProvider = {
  status: () => UNCONFIGURED,
  search: () =>
    Promise.reject(new Error('No search provider is configured; discovery is not available.')),
};

/**
 * The providers a configuration may name. `none` is the default. `wikipedia` needs no key and finds background. `brave`
 * is a documented search API that needs a key of its own. Each is the interface that its operator offers for this, and
 * none of them reads a page of results.
 */
export const SEARCH_PROVIDERS = ['none', 'wikipedia', 'brave'] as const;
export type SearchProviderName = (typeof SEARCH_PROVIDERS)[number];

/** What an operator decides about the provider: which one, and, for one that needs it, the key. */
export interface SearchChoice {
  searchProvider: SearchProviderName;
  searchApiKey?: string | null;
  searchEndpoint?: string | null;
  searchTimeoutMs?: number;
  /** For a test: what asks. */
  searchFetch?: typeof fetch;
}

export function searchProviderFor(choice: SearchChoice | SearchProviderName): SearchProvider {
  const given: SearchChoice = typeof choice === 'string' ? { searchProvider: choice } : choice;
  const settings: SearchSettings = {
    apiKey: given.searchApiKey ?? null,
    endpoint: given.searchEndpoint ?? null,
    timeoutMs: given.searchTimeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS,
    ...(given.searchFetch ? { fetch: given.searchFetch } : {}),
  };
  switch (given.searchProvider) {
    case 'none':
      return unconfiguredSearch;
    case 'wikipedia':
      return wikipediaSearch(settings);
    case 'brave':
      return braveSearch(settings);
  }
}
