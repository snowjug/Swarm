import {
  ALLOWED_CONTENT_TYPES,
  PublicFetcher,
  type FetchedPage,
  type FetcherSeam,
} from '../../ingest/url/fetcher.js';
import type { UrlPolicy } from '../../ingest/url/policy.js';
import { RESEARCH_ROBOTS_TOKEN, RESEARCH_USER_AGENT } from './identity.js';
import type { PageFetcher, PageFetchRequest } from './types.js';

const WITH_PDF: ReadonlySet<string> = new Set([...ALLOWED_CONTENT_TYPES, 'application/pdf']);

export interface PublicPageFetcherOptions {
  /** Only for a test: a name server of its own, and loopback addresses. Nothing in a deployment sets it. */
  seam?: FetcherSeam;
  /** Ports other than 80 and 443 that may be read. */
  allowedPorts?: readonly number[];
  /** When not empty, only these hosts: `example.com`, or `*.example.com` for its subdomains. */
  allowedHosts?: readonly string[];
}

/**
 * The crawler's fetcher: the evidence fetcher, with every one of its guarantees, under the crawler's
 * own name. It always obeys robots.txt (the crawler cannot turn that off), reads https only unless the
 * crawl says otherwise, and never keeps a cookie, a credential or a referrer.
 */
export class PublicPageFetcher implements PageFetcher {
  readonly policy: UrlPolicy;
  private readonly inner: PublicFetcher;

  constructor(options: PublicPageFetcherOptions = {}) {
    this.inner = new PublicFetcher(options.seam);
    this.policy = {
      ...(options.allowedPorts ? { allowedPorts: options.allowedPorts } : {}),
      ...(options.allowedHosts ? { allowedHosts: options.allowedHosts } : {}),
    };
  }

  fetch(request: PageFetchRequest): Promise<FetchedPage> {
    return this.inner.fetchPublicPage(request.url, {
      ...this.policy,
      httpsOnly: !request.allowHttp,
      maxBytes: request.maxBytes,
      timeoutMs: request.timeoutMs,
      idleMs: request.idleMs,
      maxRedirects: request.maxRedirects,
      respectRobots: true,
      identity: { userAgent: RESEARCH_USER_AGENT, robotsToken: RESEARCH_ROBOTS_TOKEN },
      signal: request.signal,
      allowedContentTypes: request.allowPdf ? WITH_PDF : ALLOWED_CONTENT_TYPES,
      robotsCache: request.robots,
      hooks: request.hooks,
    });
  }
}
