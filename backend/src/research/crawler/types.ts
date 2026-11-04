import type {
  DISCOVERED_BY,
  FetchErrorClass,
  QuarantineReason,
  ResearchBudget,
  ResearchSource,
  ResearchStopReason,
  ResearchUsed,
  SourceCategory,
} from '../../../../shared/research.js';
import type { FetchedPage, FetchHooks, RobotsCache } from '../../ingest/url/fetcher.js';
import type { UrlPolicy } from '../../ingest/url/policy.js';
import type { ExtractedDocument, ExtractLimits, PdfReader } from '../extract/index.js';
import type { DuplicateBy } from './dedupe.js';

export type DiscoveredBy = (typeof DISCOVERED_BY)[number];

export interface CrawlSeed {
  /** As the person or the caller wrote it. It is validated like every other address. */
  url: string;
  /** Links already followed to get here: 0 for a page that was named. */
  depth?: number;
  discoveredBy: DiscoveredBy;
  parentUrl?: string | null;
}

export interface CrawlHints {
  /** What the question is about: words that make a link, or a page, worth reading. */
  terms: string[];
  /** Kinds of source worth reading first. */
  categories?: SourceCategory[];
  /**
   * Sites worth reading first, by name (`example.org`). They are not fetched because they are named. Each
   * is treated as a site the person named: its pages are the primary source, and a `docs.` or `support.`
   * address on it is its documentation. Put only sites the person supplied here, never a name taken from
   * a page, a search result or a model's guess: a name that is here is rated high without any other check.
   */
  domains?: string[];
}

/** What a `shouldStop` callback may look at. Everything in it is already settled, and none of it can be changed. */
export interface CrawlState {
  readonly used: Readonly<ResearchUsed>;
  readonly pages: readonly CrawledPage[];
  readonly sources: readonly ResearchSource[];
  /** Addresses waiting to be read. */
  readonly queued: number;
  /** The page that was settled last, if it was read. */
  readonly lastPage: CrawledPage | null;
}

export interface PauseGate {
  /** Resolves at once when the crawl is not paused, and when it is no longer. It is awaited between fetches. */
  waitIfPaused(signal: AbortSignal): Promise<void>;
}

export interface CrawlInput {
  seeds: CrawlSeed[];
  budget: ResearchBudget;
  /** Reads http as well as https. Off unless the deployment says so. */
  allowHttp?: boolean;
  hints: CrawlHints;
  /** Read only the sites the seeds are on. */
  sameSiteOnly: boolean;
  signal: AbortSignal;
  pause?: PauseGate;
  /**
   * Asked before every fetch and after every page. A reason ends the crawl: this is how the caller
   * stops it for cost, for enough evidence, or for nothing new, which the crawler cannot judge.
   */
  shouldStop?: (state: CrawlState) => ResearchStopReason | null;
}

/** A page that was read, and was not set aside. */
export interface CrawledPage {
  source: ResearchSource;
  document: ExtractedDocument;
}

export interface CrawlResult {
  pages: CrawledPage[];
  /** Every address that was attempted or turned away, with what became of it. */
  sources: ResearchSource[];
  stoppedBecause: ResearchStopReason | null;
  used: ResearchUsed;
}

// -- events --------------------------------------------------------------------------------------

export type CrawlEventBody =
  | { type: 'fetch-start'; url: string; host: string; depth: number; attempt: number }
  | {
      type: 'fetch-ok';
      url: string;
      finalUrl: string;
      status: number;
      contentType: string;
      bytes: number;
      redirects: number;
    }
  | {
      type: 'fetch-blocked';
      url: string;
      errorClass: FetchErrorClass;
      /** Which rule refused it, as a fixed word: `credentials`, `robots`, `private-network` for an address written as one... */
      reason: string;
    }
  | {
      type: 'fetch-failed';
      url: string;
      errorClass: FetchErrorClass;
      status: number | null;
      attempt: number;
    }
  | { type: 'retry'; url: string; attempt: number; delayMs: number; errorClass: FetchErrorClass }
  | {
      type: 'robots-decision';
      origin: string;
      url: string;
      decision: 'allowed' | 'absent' | 'disallowed' | 'unavailable';
      cached: boolean;
      /** The delay between requests the site asked for, as it is applied (capped), or null. */
      crawlDelayMs: number | null;
    }
  | { type: 'redirect'; from: string; to: string; status: number; hop: number }
  | { type: 'quarantine'; url: string; reason: QuarantineReason }
  | { type: 'duplicate'; url: string; of: string; by: DuplicateBy }
  | {
      type: 'circuit-open';
      host: string;
      failures: number;
      /** When it opened, how long until it lets one request through; when it turned a request away, how long that has left. */
      reopensInMs: number;
      url?: string;
    }
  | {
      type: 'skipped';
      url: string;
      reason: 'domain-limit' | 'other-site' | 'redirect-refused' | 'already-read';
    }
  | { type: 'budget-stop'; reason: ResearchStopReason }
  /**
   * The crawl found itself in a state that its own rules rule out, and put it right. It is not about any site:
   * it says that the crawler has a fault, which is for whoever keeps it, and it is never shown to a person.
   * `place-not-given-back`: addresses were queued, nothing was being read, and every site they were queued
   * on was held by a request that had not given its place back; `hosts` such sites were let go of.
   */
  | {
      type: 'scheduler-recovered';
      reason: 'place-not-given-back';
      hosts: number;
      queued: number;
    };

/**
 * What the crawler reports as it goes, for an audit log. It carries the trace id, a time from the
 * clock it was given, and addresses with anything that looks like a secret taken out of them. It never
 * carries the text of a page, a title, or anything else a site wrote.
 */
export type CrawlEvent = CrawlEventBody & { traceId: string; at: number };

/**
 * A name that was refused because of the address it leads to (a private, internal or otherwise
 * non-public address). It is for the server's own security log and for nothing else: **never show it to a
 * person, send it to a client, or put it in telemetry.** The crawl itself treats such a name exactly as a
 * name that was not found (the same record, the same events, the same counts, the same stop), because a
 * person who could tell the two apart could learn which names exist inside the network the server runs in.
 */
export interface LookupRefusal {
  traceId: string;
  at: number;
  /** The address that was being read, cleaned like the addresses in events. */
  url: string;
  /** The name that was refused: the address's own, the one a redirect led to, or the one robots.txt led to. */
  host: string | null;
  via: 'page' | 'redirect' | 'robots';
  /** The kind of address the name leads to, as a fixed word: `private-network`, `link-local`... */
  reason: string;
}

// -- the fetcher ---------------------------------------------------------------------------------

export interface PageFetchRequest {
  url: string;
  maxBytes: number;
  timeoutMs: number;
  idleMs: number;
  maxRedirects: number;
  /** Ends the request wherever it is. */
  signal: AbortSignal;
  /** False: https only, and a redirect to http is refused. */
  allowHttp: boolean;
  /** Whether a PDF may be fetched, because there is somewhere safe to read it. */
  allowPdf: boolean;
  /** Shared by every request of the crawl, so that robots.txt is read once for each origin. */
  robots: RobotsCache;
  /** Called by the fetcher around each request it makes; see `FetchHooks`. */
  hooks: FetchHooks;
}

/**
 * The part of the crawler that touches a network. It is told what to fetch and within what limits,
 * and it throws a `UrlFailure` when it cannot. The default wraps the evidence fetcher, with every one
 * of its guarantees: addresses vetted before anything is looked up, every answer of the name lookup
 * checked, the connection pinned to an address that was checked, every redirect vetted again, robots.txt
 * obeyed, sizes limited before and after decompression, and a total time.
 */
export interface PageFetcher {
  /** The address policy the fetcher applies (ports, hosts), so that the crawler can turn an address away before it is queued. */
  readonly policy?: UrlPolicy;
  fetch(request: PageFetchRequest): Promise<FetchedPage>;
}

// -- the engine ----------------------------------------------------------------------------------

export interface CrawlTuning {
  /** Pages read at the same moment, never on one host at the same moment. */
  maxConcurrent: number;
  /** Links taken from one page. */
  linksPerPage: number;
  /** Addresses waiting at one time; the lowest ranked are let go. */
  maxQueued: number;
  /** Addresses of which a record is kept. */
  maxSources: number;
  requestTimeoutMs: number;
  idleMs: number;
  /** Tries after the first, for a failure that may pass. */
  maxRetries: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  /** The longest a site's `Retry-After` is waited for; a longer one is not waited for at all. */
  retryAfterCapMs: number;
  /** The most of a site's `Crawl-delay` that is applied. */
  crawlDelayCapMs: number;
  /** Failures in a row after which a host is left alone for a while. */
  breakerThreshold: number;
  breakerCooldownMs: number;
  /** Pages read before the share of repeats is judged. */
  minPagesForRepeats: number;
  /** The least a link must score to be queued. */
  minLinkScore: number;
}

export const DEFAULT_TUNING: CrawlTuning = {
  maxConcurrent: 3,
  linksPerPage: 25,
  maxQueued: 500,
  maxSources: 200,
  requestTimeoutMs: 15_000,
  idleMs: 5_000,
  maxRetries: 2,
  backoffBaseMs: 500,
  backoffMaxMs: 8_000,
  retryAfterCapMs: 10_000,
  crawlDelayCapMs: 10_000,
  breakerThreshold: 3,
  breakerCooldownMs: 30_000,
  minPagesForRepeats: 4,
  minLinkScore: 0.35,
};

export interface CrawlDeps {
  fetcher: PageFetcher;
  /** Epoch milliseconds. The crawler reads no clock of its own. */
  now(): number;
  /** Resolves after `ms`, or rejects when the signal is aborted. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  /** A number in [0, 1), for the jitter of a retry. */
  random(): number;
  onEvent(event: CrawlEvent): void;
  /**
   * For the server's own security log only: see `LookupRefusal`. What it is given must never reach a
   * person, a client or telemetry. Without it, nothing of this is kept.
   */
  onLookupRefused?: (refusal: LookupRefusal) => void;
  traceId: string;
  /** The project's isolated PDF reader. Without one, a PDF is not fetched. */
  pdf?: PdfReader;
  tuning?: Partial<CrawlTuning>;
  extractLimits?: Partial<ExtractLimits>;
}
