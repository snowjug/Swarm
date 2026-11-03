import type { DiscoveryStatus } from '../../../shared/research.js';

/** An address a search provider offered for a question. Nothing else of the answer is kept. */
export interface SearchHit {
  url: string;
}

/**
 * What finds pages for a question that names none. Swarm ships no provider: choosing one is a decision
 * about cost, terms of use and what a question may be sent to. A provider returns addresses and nothing
 * more (the title and snippet of a result are what a site chose to say about itself), and every address
 * is vetted by the crawler like any other before anything is fetched. Reading the result pages of a
 * search engine is never a way to discover: only a provider that offers an interface for it.
 */
export interface SearchProvider {
  /** Whether it can search, who it is, and what to tell a person when it cannot. */
  status(): DiscoveryStatus;
  search(question: string, options: { limit: number; signal: AbortSignal }): Promise<SearchHit[]>;
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

/** The providers a configuration may name. Only `none` exists: a provider is a decision, then work. */
export const SEARCH_PROVIDERS = ['none'] as const;
export type SearchProviderName = (typeof SEARCH_PROVIDERS)[number];

export function searchProviderFor(name: SearchProviderName): SearchProvider {
  switch (name) {
    case 'none':
      return unconfiguredSearch;
  }
}
