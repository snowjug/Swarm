import type {
  ResearchSource,
  ResearchStopReason,
  ResearchUsed,
} from '../../../../shared/research.js';
import type { RobotsCache } from '../../ingest/url/fetcher.js';
import type { UrlPolicy } from '../../ingest/url/policy.js';
import { inline } from '../../ingest/url/text.js';
import { Breakers } from './breaker.js';
import { classifySource, type ClassifyContext } from './classify.js';
import { ContentIndex } from './dedupe.js';
import type { Verdict } from './errors.js';
import { Reporter } from './events.js';
import { Frontier, type Candidate } from './frontier.js';
import { HostGate } from './limiter.js';
import { makeScorer, type Scorer } from './score.js';
import { buildSource, type SourceDraft } from './source.js';
import {
  DEFAULT_TUNING,
  type CrawlDeps,
  type CrawlEventBody,
  type CrawlInput,
  type CrawlState,
  type CrawledPage,
  type CrawlTuning,
} from './types.js';
import { registrableDomain } from './urls.js';

/** What an address is, for the record of it: where it came from, before anything is known of the page. */
export interface Origin {
  url: string;
  depth: number;
  parentUrl: string | null;
  discoveredBy: Candidate['discoveredBy'];
  matched?: readonly string[];
}

/** The sentence that says why a page was read. It is made of fixed words and the words of the question, and never of what a site wrote. */
export function whyRead(origin: Origin): string {
  switch (origin.discoveredBy) {
    case 'user-url':
      return 'The page you named.';
    case 'user-domain':
      return 'A page on the site you named.';
    case 'user-added':
      return 'A page you added.';
    case 'search':
      return 'A page that a search provider returned for the question.';
    case 'sitemap':
      return 'A page the site lists in its sitemap.';
    default: {
      let from = 'another page';
      try {
        if (origin.parentUrl) from = `a page on ${new URL(origin.parentUrl).hostname}`;
      } catch {
        // The parent is not an address: the sentence says less.
      }
      const terms = (origin.matched ?? [])
        .slice(0, 3)
        .map((term) => inline(term).slice(0, 40))
        .filter(Boolean);
      return terms.length > 0
        ? `Linked from ${from}; its address or link text carries ${terms.map((term) => `\u201c${term}\u201d`).join(', ')}.`
        : `Linked from ${from}.`;
    }
  }
}

/** Everything one crawl knows, in one place; the loop, the reading of a page and the following of links share it. */
export class CrawlRun {
  readonly tuning: CrawlTuning;
  readonly reporter: Reporter;
  readonly started: number;
  pausedMs = 0;
  readonly used: ResearchUsed = {
    pages: 0,
    domains: 0,
    bytes: 0,
    elapsedMs: 0,
    estimatedCostUsd: 0,
    duplicates: 0,
    failures: 0,
    quarantined: 0,
  };
  readonly pages: CrawledPage[] = [];
  readonly sources: ResearchSource[] = [];
  lastPage: CrawledPage | null = null;
  readonly frontier: Frontier;
  readonly content = new ContentIndex();
  /** The address of each page that was read, under the name two spellings of one address share. */
  readonly read = new Map<string, string>();
  /** The registrable domains that have been asked for something. */
  readonly domains = new Set<string>();
  readonly classify: ClassifyContext;
  /** When the crawl keeps to the sites it began on: their registrable domains. */
  readonly allowedSites: Set<string> | null;
  readonly robots: RobotsCache = new Map();
  readonly gate: HostGate;
  readonly breakers: Breakers;
  readonly scorer: Scorer;
  readonly policy: UrlPolicy;
  /** Ports other than the standard ones that the fetcher's policy allows. */
  readonly extraPorts: ReadonlySet<number>;
  readonly abort = new AbortController();
  readonly signal: AbortSignal;
  readonly readsPdf: boolean;
  /** Addresses attempted or refused, and how many of those a safety rule refused. */
  attempted = 0;
  refusedBySafety = 0;
  domainLimitMet = false;
  /** A page was larger than what was left of the size limit of the whole crawl. */
  byteLimitMet = false;
  reservedPages = 0;
  reservedBytes = 0;
  /** Hosts that have a page being read: one at a time to a host. */
  readonly activeHosts = new Set<string>();
  /** The sites a person named, or added: pages on them are the primary source. */
  readonly named: Set<string>;
  stop: ResearchStopReason | null = null;
  private readonly ids = new Set<string>();
  private pdfChain: Promise<unknown> = Promise.resolve();

  constructor(
    readonly input: CrawlInput,
    readonly deps: CrawlDeps,
  ) {
    this.tuning = { ...DEFAULT_TUNING, ...deps.tuning };
    this.reporter = new Reporter(deps.onEvent, deps.traceId, deps.now);
    this.started = deps.now();
    this.frontier = new Frontier(this.tuning.maxQueued);
    this.policy = deps.fetcher.policy ?? {};
    this.extraPorts = new Set(
      [...(this.policy.allowedPorts ?? [])].filter((port) => port !== 80 && port !== 443),
    );
    this.readsPdf = deps.pdf !== undefined;
    this.signal = AbortSignal.any([input.signal, this.abort.signal]);
    this.named = new Set((input.hints.domains ?? []).map((name) => registrableDomain(name)));
    this.classify = { namedDomains: this.named };
    this.scorer = makeScorer(input.hints, this.classify, {
      minScore: this.tuning.minLinkScore,
      readsPdf: this.readsPdf,
    });
    this.allowedSites = input.sameSiteOnly ? new Set() : null;
    this.gate = new HostGate(deps, (host) => this.delayFor(host));
    this.breakers = new Breakers(
      deps.now,
      this.tuning.breakerThreshold,
      this.tuning.breakerCooldownMs,
    );
  }

  /** Time spent working, not paused. */
  elapsed(): number {
    return Math.max(0, this.deps.now() - this.started - this.pausedMs);
  }

  emit(body: CrawlEventBody): void {
    this.reporter.emit(body);
  }

  /** What a site asks to be left between requests, as it is applied: the larger of the budget's delay and its own, within a cap. */
  crawlDelayMs(host: string): number | null {
    for (const [origin, answer] of this.robots) {
      if (typeof answer === 'string' || !origin.includes(`//${host}:`)) continue;
      const seconds = answer.crawlDelaySeconds;
      if (seconds !== null && seconds !== undefined) {
        return Math.min(Math.round(seconds * 1_000), this.tuning.crawlDelayCapMs);
      }
    }
    return null;
  }

  private delayFor(host: string): number {
    return Math.max(this.input.budget.perDomainDelayMs, this.crawlDelayMs(host) ?? 0);
  }

  /** Keeps a record of an address, with an id that no other record of the crawl has. */
  record(draft: SourceDraft, key: string): ResearchSource {
    this.attempted += 1;
    let source = buildSource(draft, key);
    for (let salt = 1; this.ids.has(source.id) && salt < 8; salt += 1) {
      source = buildSource({ ...draft, salt }, key);
    }
    this.ids.add(source.id);
    if (this.sources.length < this.tuning.maxSources) this.sources.push(source);
    return source;
  }

  /** The record of an address that was refused, failed, set aside or not tried. */
  recordVerdict(origin: Origin, key: string, verdict: Verdict): ResearchSource {
    if (verdict.safety) this.refusedBySafety += 1;
    if (verdict.outcome === 'quarantined') this.used.quarantined += 1;
    const found = classifySource(origin.url, this.classify);
    return this.record(
      {
        requestedUrl: origin.url,
        parentUrl: origin.parentUrl,
        httpStatus: verdict.status,
        category: found.category,
        authority: found.authority,
        relevance: whyRead(origin),
        depth: origin.depth,
        discoveredBy: origin.discoveredBy,
        robots: verdict.robots ?? 'skipped',
        outcome: verdict.outcome,
        quarantine: verdict.quarantine,
        failure: { class: verdict.errorClass, message: verdict.message },
      },
      key,
    );
  }

  /** Runs `task` after every PDF read before it: the project's PDF reader takes one file at a time. */
  pdf<T>(task: () => Promise<T>): Promise<T> {
    const next = this.pdfChain.then(task, task);
    this.pdfChain = next.catch(() => undefined);
    return next;
  }

  state(): CrawlState {
    return {
      used: { ...this.used, elapsedMs: this.elapsed() },
      pages: [...this.pages],
      sources: [...this.sources],
      queued: this.frontier.size,
      lastPage: this.lastPage,
    };
  }

  /** The first limit that has been reached, if any. It is checked before every fetch and after every page. */
  checkStops(): ResearchStopReason | null {
    const { budget, shouldStop } = this.input;
    if (this.input.signal.aborted) return 'cancelled';
    if (this.elapsed() >= budget.maxElapsedMs) return 'time-limit';
    if (this.used.pages >= budget.maxPages) return 'page-limit';
    if (this.used.bytes >= budget.maxTotalBytes || this.byteLimitMet) return 'byte-limit';
    if (this.used.failures > budget.maxFailedRequests) return 'failure-limit';
    if (
      this.used.pages >= this.tuning.minPagesForRepeats &&
      this.used.duplicates / this.used.pages > budget.maxDuplicateRatio
    ) {
      return 'duplicate-limit';
    }
    return shouldStop?.(this.state()) ?? null;
  }
}
