import type { FetchedPage } from '../../ingest/url/fetcher.js';
import {
  extractDocument,
  extractPdf,
  PdfUnavailable,
  type ExtractedDocument,
  type Extraction,
} from '../extract/index.js';
import { classifySource } from './classify.js';
import { circuitOpen, domainLimit, isAbort, judge, type Verdict } from './errors.js';
import type { Candidate } from './frontier.js';
import { followLinks } from './follow.js';
import { retryAfterMs } from './retry.js';
import { binaryAsText, quarantineOf, type Quarantine } from './quarantine.js';
import { whyRead, type CrawlRun } from './run.js';
import { bytesAreNotText, replacementShare } from './sniff.js';
import type { SourceDraft } from './source.js';
import type { PageFetchRequest } from './types.js';
import { dedupeKey, registrableDomain, sameSite } from './urls.js';

const BINARY_SHARE = 0.2;

/** What a request to a host says about the host: it is failing, it answered, or nothing either way. */
function health(verdict: Verdict): 'bad' | 'good' | 'neutral' {
  switch (verdict.errorClass) {
    case 'timeout':
    case 'connect':
    case 'tls':
    case 'dns':
      return verdict.safety ? 'neutral' : 'bad';
    case 'http-status':
      return verdict.transient ? 'bad' : 'good';
    case 'unsupported-type':
    case 'too-large':
    case 'decompression-limit':
      return 'good';
    default:
      return 'neutral';
  }
}

const askedNotToBeUsed = (): Verdict => ({
  errorClass: 'robots-disallowed',
  outcome: 'blocked',
  counts: false,
  safety: true,
  transient: false,
  reason: 'noai',
  resolved: false,
  robots: 'disallowed',
  quarantine: null,
  message: 'The page asks that AI systems do not use it, so it was set aside.',
  status: null,
  retryAfterMs: null,
});

const tooLargeForWhatIsLeft = (): Verdict => ({
  errorClass: 'too-large',
  outcome: 'skipped',
  counts: false,
  safety: false,
  transient: false,
  reason: 'size-left',
  resolved: false,
  robots: null,
  quarantine: null,
  message: 'The page was larger than what was left of the size limit for the research.',
  status: null,
  retryAfterMs: null,
});

function requestFor(
  run: CrawlRun,
  candidate: Candidate,
  maxBytes: number,
  turnedDown: { reason: string | null },
): PageFetchRequest {
  const { budget } = run.input;
  let hop = 0;
  const remaining = Math.max(1_000, budget.maxElapsedMs - run.elapsed());
  return {
    url: candidate.url,
    maxBytes,
    timeoutMs: Math.min(run.tuning.requestTimeoutMs, remaining),
    idleMs: run.tuning.idleMs,
    maxRedirects: budget.maxRedirects,
    signal: run.signal,
    allowHttp: run.input.allowHttp === true,
    allowPdf: run.readsPdf,
    robots: run.robots,
    hooks: {
      beforeRequest: (request, signal) => run.gate.acquire(request.host, signal),
      onRedirect: ({ from, to, status }) => {
        hop += 1;
        run.emit({ type: 'redirect', from, to, status, hop });
        const domain = registrableDomain(new URL(to).hostname);
        if (run.allowedSites && !run.allowedSites.has(domain)) {
          turnedDown.reason = 'other-site';
          run.emit({ type: 'skipped', url: to, reason: 'other-site' });
          return 'other-site';
        }
        if (!run.domains.has(domain)) {
          if (run.domains.size >= budget.maxDomains) {
            run.domainLimitMet = true;
            turnedDown.reason = 'domain-limit';
            run.emit({ type: 'skipped', url: to, reason: 'domain-limit' });
            return 'domain-limit';
          }
          run.domains.add(domain);
          run.used.domains = run.domains.size;
        }
        return null;
      },
      onRobots: ({ origin, url, decision, cached }) => {
        const host = new URL(origin).hostname;
        run.emit({
          type: 'robots-decision',
          origin,
          url,
          decision,
          cached,
          crawlDelayMs: run.crawlDelayMs(host),
        });
      },
    },
  };
}

/**
 * Reads one address: asks for it (again, within bounds, when the failure may pass), reads what came
 * back, and settles what became of it. It does not throw: whatever happens is a record.
 */
export async function readAddress(
  run: CrawlRun,
  candidate: Candidate,
  maxBytes: number,
): Promise<void> {
  try {
    await attempts(run, candidate, maxBytes);
  } catch (error) {
    // Nothing that a site does should end the crawl: what could not be foreseen is a failure of this address.
    run.recordVerdict(
      candidate,
      candidate.key,
      judge(error, { cancelled: run.signal.aborted, now: run.deps.now() }),
    );
  } finally {
    run.gate.settle(candidate.host);
    run.breakers.neutral(candidate.host);
  }
}

async function attempts(run: CrawlRun, candidate: Candidate, maxBytes: number): Promise<void> {
  const { host } = candidate;
  for (let attempt = 0; ; attempt += 1) {
    if (run.signal.aborted) {
      run.recordVerdict(candidate, candidate.key, judge(null, { cancelled: true, now: 0 }));
      return;
    }
    const allowed = run.breakers.check(host);
    if (!allowed.allowed) {
      run.recordVerdict(candidate, candidate.key, circuitOpen());
      run.emit({
        type: 'circuit-open',
        host,
        failures: run.tuning.breakerThreshold,
        reopensInMs: allowed.reopensInMs,
        url: candidate.url,
      });
      return;
    }
    run.emit({ type: 'fetch-start', url: candidate.url, host, depth: candidate.depth, attempt });
    const turnedDown = { reason: null as string | null };
    let page: FetchedPage;
    try {
      page = await run.deps.fetcher.fetch(requestFor(run, candidate, maxBytes, turnedDown));
    } catch (error) {
      let verdict = judge(error, {
        cancelled: run.signal.aborted || isAbort(error),
        now: run.deps.now(),
      });
      if (turnedDown.reason === 'domain-limit') verdict = domainLimit();
      if (
        maxBytes < run.input.budget.maxBytesPerPage &&
        verdict.quarantine?.reason === 'oversized'
      ) {
        // The page is not oversized for a page: there is not room left in the whole crawl for it.
        run.byteLimitMet = true;
        verdict = tooLargeForWhatIsLeft();
      }
      if (await failed(run, candidate, verdict, attempt)) continue;
      return;
    }
    run.breakers.success(host);
    if (run.signal.aborted) {
      run.recordVerdict(candidate, candidate.key, judge(null, { cancelled: true, now: 0 }));
      return;
    }
    await settle(run, candidate, page);
    return;
  }
}

/** Accounts for a failed request. True when it is to be tried again, after the wait it asked for. */
async function failed(
  run: CrawlRun,
  candidate: Candidate,
  verdict: Verdict,
  attempt: number,
): Promise<boolean> {
  const { host } = candidate;
  if (verdict.outcome === 'blocked' || verdict.safety) {
    run.emit({
      type: 'fetch-blocked',
      url: candidate.url,
      errorClass: verdict.errorClass,
      reason: verdict.reason,
      resolved: verdict.resolved,
    });
  } else if (verdict.errorClass !== 'cancelled') {
    run.emit({
      type: 'fetch-failed',
      url: candidate.url,
      errorClass: verdict.errorClass,
      status: verdict.status,
      attempt,
    });
  }
  if (verdict.counts) run.used.failures += 1;
  const state = health(verdict);
  if (state === 'bad') {
    const result = run.breakers.failure(host);
    if (result.opened) {
      run.emit({
        type: 'circuit-open',
        host,
        failures: result.failures,
        reopensInMs: result.reopensInMs,
      });
    }
  } else if (state === 'good') run.breakers.success(host);
  else run.breakers.neutral(host);

  const wait = retryAfterMs(verdict, attempt, run.tuning, run.deps.random);
  const { budget } = run.input;
  const worthIt =
    wait !== null &&
    !run.signal.aborted &&
    run.used.failures <= budget.maxFailedRequests &&
    run.elapsed() + wait < budget.maxElapsedMs;
  if (worthIt) {
    run.emit({
      type: 'retry',
      url: candidate.url,
      attempt: attempt + 1,
      delayMs: wait,
      errorClass: verdict.errorClass,
    });
    try {
      await run.deps.sleep(wait, run.signal);
      return true;
    } catch {
      run.recordVerdict(candidate, candidate.key, judge(null, { cancelled: true, now: 0 }));
      return false;
    }
  }
  run.recordVerdict(candidate, candidate.key, verdict);
  return false;
}

async function read(
  run: CrawlRun,
  page: FetchedPage,
  now: number,
): Promise<Extraction | Quarantine> {
  const pdf = page.contentType === 'application/pdf';
  if (!pdf) {
    const kind =
      bytesAreNotText(page.body) ??
      (replacementShare(page.text) > BINARY_SHARE ? 'binary data' : null);
    if (kind) return binaryAsText(kind);
  }
  if (pdf && run.deps.pdf) {
    // The project's PDF reader takes one file at a time.
    return run.pdf(() =>
      extractPdf(page.body, run.deps.pdf!, { headers: page.headers }, undefined, run.signal),
    );
  }
  return extractDocument(
    {
      text: page.text,
      contentType: page.contentType,
      url: page.finalUrl,
      headers: page.headers,
      fetchedAt: now,
    },
    {
      signal: run.signal,
      sameSite: (address) => sameSite(address, page.finalUrl),
      ...(run.deps.extractLimits ? { limits: run.deps.extractLimits } : {}),
    },
  );
}

const isQuarantine = (value: Extraction | Quarantine): value is Quarantine => 'reason' in value;

/** What a page that was fetched becomes: evidence, a duplicate, or something set aside. */
async function settle(run: CrawlRun, candidate: Candidate, page: FetchedPage): Promise<void> {
  const now = run.deps.now();
  run.used.pages += 1;
  run.used.bytes += page.bytes;
  run.emit({
    type: 'fetch-ok',
    url: candidate.url,
    finalUrl: page.finalUrl,
    status: page.status,
    contentType: page.contentType,
    bytes: page.bytes,
    redirects: page.redirects,
  });
  const finalKey = dedupeKey(page.finalUrl);
  run.frontier.mark(finalKey);
  const finalDomain = registrableDomain(new URL(page.finalUrl).hostname);
  run.domains.add(finalDomain);
  run.used.domains = run.domains.size;

  const draft = (more: Partial<SourceDraft>): SourceDraft => {
    const found = classifySource(page.finalUrl, run.classify);
    return {
      requestedUrl: candidate.url,
      finalUrl: page.finalUrl,
      fetchedAt: now,
      httpStatus: page.status,
      contentType: page.contentType,
      category: found.category,
      authority: found.authority,
      relevance: whyRead(candidate),
      depth: candidate.depth,
      parentUrl: candidate.parentUrl,
      discoveredBy: candidate.discoveredBy,
      robots: page.robots,
      outcome: 'read',
      bytes: page.bytes,
      ...more,
    };
  };
  const setAside = (reason: Quarantine, document?: ExtractedDocument): void => {
    run.used.quarantined += 1;
    run.record(
      draft({
        outcome: 'quarantined',
        quarantine: reason,
        ...(document
          ? {
              title: document.title,
              contentHash: document.contentHash,
              extractionMethod: document.method,
              injectionFlagged: document.injection.flaggedBlocks > 0,
              warnings: document.warnings,
            }
          : {}),
      }),
      finalKey,
    );
    run.emit({ type: 'quarantine', url: candidate.url, reason: reason.reason });
  };
  const duplicateOf = (
    of: string,
    by: 'canonical-url' | 'content-hash' | 'near-duplicate',
    document?: ExtractedDocument,
  ): void => {
    run.used.duplicates += 1;
    run.record(
      draft({
        outcome: 'duplicate',
        ...(document ? { title: document.title, contentHash: document.contentHash } : {}),
      }),
      finalKey,
    );
    run.emit({ type: 'duplicate', url: candidate.url, of, by });
  };

  // The page this address leads to is one that was read already, under another spelling.
  const alias = run.read.get(finalKey);
  if (alias !== undefined && finalKey !== candidate.key) {
    duplicateOf(alias, 'canonical-url');
    return;
  }

  let extraction: Extraction | Quarantine;
  try {
    extraction = await read(run, page, now);
  } catch (error) {
    if (run.signal.aborted) {
      run.recordVerdict(candidate, candidate.key, judge(null, { cancelled: true, now: 0 }));
      return;
    }
    if (error instanceof PdfUnavailable) {
      run.recordVerdict(candidate, candidate.key, {
        ...judge(null, { cancelled: false, now: now }),
        message: 'The PDF reader was busy, so the file was not read.',
      });
      return;
    }
    setAside({ reason: 'malformed', detail: 'The content could not be read.' });
    return;
  }
  if (isQuarantine(extraction)) {
    setAside(extraction);
    return;
  }
  const { document, signals } = extraction;
  if (document.robotsMeta.noai) {
    run.recordVerdict(candidate, candidate.key, askedNotToBeUsed());
    run.emit({
      type: 'fetch-blocked',
      url: candidate.url,
      errorClass: 'robots-disallowed',
      reason: 'noai',
      resolved: false,
    });
    return;
  }
  const markup = { schemaTypes: signals.schemaTypes, citationMeta: signals.citationMeta };
  const found = classifySource(page.finalUrl, run.classify, markup);
  const base: Partial<SourceDraft> = {
    title: document.title,
    canonicalUrl: document.canonicalUrl,
    contentHash: document.contentHash,
    category: found.category,
    authority: found.authority,
    publishedAt: document.publishedAt,
    updatedAt: document.updatedAt,
    author: document.author,
    extractionMethod: document.method,
    injectionFlagged: document.injection.flaggedBlocks > 0,
    warnings: document.robotsMeta.noindex
      ? [...document.warnings, 'The page asks not to be indexed by search engines.']
      : document.warnings,
  };

  const set = quarantineOf(extraction);
  if (set) {
    setAside(set, document);
    // A page with almost no text of its own can still be a list of places worth reading.
    if (set.reason === 'empty') followLinks(run, candidate, document);
    return;
  }
  const canonicalKey = document.canonicalUrl ? dedupeKey(document.canonicalUrl) : null;
  const canonicalRead =
    canonicalKey && canonicalKey !== finalKey ? run.read.get(canonicalKey) : undefined;
  if (canonicalRead !== undefined) {
    duplicateOf(canonicalRead, 'canonical-url', document);
    return;
  }
  const repeated = run.content.find(document.text, document.contentHash);
  if (repeated) {
    duplicateOf(repeated.url, repeated.by, document);
    return;
  }

  const source = run.record(
    draft({ ...base, outcome: 'used', passageCount: document.passages.length }),
    finalKey,
  );
  const crawled = { source, document };
  run.pages.push(crawled);
  run.lastPage = crawled;
  run.content.add(page.finalUrl, document.text, document.contentHash);
  run.read.set(finalKey, page.finalUrl);
  if (canonicalKey) {
    run.read.set(canonicalKey, page.finalUrl);
    run.frontier.mark(canonicalKey);
  }
  followLinks(run, candidate, document);
}
