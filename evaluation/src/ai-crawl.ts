import { crawl } from '../../backend/src/research/crawler/crawl.js';
import type { CrawlEvent, CrawlResult } from '../../backend/src/research/crawler/types.js';
import { DEFAULT_RESEARCH_BUDGET } from '../../shared/research.js';
import type { CrawlGroup, SitePage, SiteSet } from './ai-datasets.js';
import { warpedClock, type SiteWorld } from './ai-fixtures.js';
import type { PageObservation } from './measure-sources.js';

export interface GroupRun {
  group: CrawlGroup;
  result: CrawlResult;
  events: CrawlEvent[];
  /** What the product made of each fixture page of the group. */
  observations: Map<string, PageObservation>;
  /** Pages of `neverFetched` that the server was asked for all the same. */
  fetchedAgainstExpectation: string[];
  /** The paths the server was asked for during the run, with the host. */
  requested: { host: string; path: string }[];
  elapsedMs: number;
}

const sameAddress = (a: string, b: string): boolean => {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.host === y.host && x.pathname === y.pathname && x.search === y.search;
  } catch {
    return false;
  }
};

/** Runs one crawl group through the product's crawler, over the real fetcher, against the fixture web. */
export async function runGroup(
  world: SiteWorld,
  sites: SiteSet,
  group: CrawlGroup,
): Promise<GroupRun> {
  const clock = warpedClock();
  const events: CrawlEvent[] = [];
  const before = world.requests.length;
  const started = Date.now();
  const result = await crawl(
    {
      seeds: group.seeds.map((id) => ({ url: world.urlOf(id), discoveredBy: 'user-url' as const })),
      budget: {
        ...DEFAULT_RESEARCH_BUDGET,
        perDomainDelayMs: 250,
        maxElapsedMs: 600_000,
        ...group.budget,
      },
      allowHttp: true,
      hints: { terms: group.hints.terms },
      sameSiteOnly: false,
      signal: new AbortController().signal,
    },
    {
      fetcher: world.fetcher,
      now: clock.now,
      sleep: clock.sleep,
      random: () => 0.5,
      onEvent: (event) => events.push(event),
      traceId: `eval-${group.id}`,
      ...(Object.keys(group.tuning).length > 0 ? { tuning: group.tuning } : {}),
    },
  );
  const requested = world.requests.slice(before).map((request) => ({ ...request }));
  const own = sites.pages.filter((page) => page.group === group.id);
  const observations = new Map<string, PageObservation>();
  for (const page of own) observations.set(page.id, observe(world, page, result));
  const fetchedAgainstExpectation = group.expect.neverFetched.filter((id) => {
    const page = sites.pages.find((item) => item.id === id);
    return page
      ? requested.some(
          (request) =>
            request.host === page.host && request.path.split('?')[0] === page.path.split('?')[0],
        )
      : false;
  });
  return {
    group,
    result,
    events,
    observations,
    fetchedAgainstExpectation,
    requested,
    elapsedMs: Date.now() - started,
  };
}

function observe(world: SiteWorld, page: SitePage, result: CrawlResult): PageObservation {
  const address = world.urlOf(page.id);
  const source = result.sources.find(
    (item) =>
      sameAddress(item.requestedUrl, address) ||
      (item.finalUrl && sameAddress(item.finalUrl, address) && item.requestedUrl === address),
  );
  if (!source) {
    return {
      id: page.id,
      outcome: 'not-fetched',
      quarantine: null,
      failure: null,
      category: null,
      authority: null,
      text: null,
    };
  }
  const crawled = result.pages.find((item) => item.source.id === source.id);
  return {
    id: page.id,
    outcome: source.outcome,
    quarantine: source.quarantine?.reason ?? null,
    failure: source.failure?.class ?? null,
    category: source.outcome === 'used' ? source.category : null,
    authority: source.outcome === 'used' ? source.authority : null,
    text: crawled?.document.text ?? null,
  };
}
