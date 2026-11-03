import type { FetchedPage } from '../../ingest/url/fetcher.js';
import { circuitOpen, domainLimit, isAbort, judge, type Verdict } from './errors.js';
import type { Candidate } from './frontier.js';
import { retryAfterMs } from './retry.js';
import type { CrawlRun } from './run.js';
import { settle } from './settle.js';
import type { PageFetchRequest } from './types.js';
import { registrableDomain } from './urls.js';

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
    run.stop === null &&
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
