import type {
  FetchErrorClass,
  QuarantineReason,
  RobotsDecision,
} from '../../../../shared/research.js';
import { UrlFailure } from '../../ingest/url/failure.js';

/**
 * What became of a request that did not give a page, in the terms the crawl keeps: how it is
 * classified, what the record says became of the address, whether it is held against the budget,
 * and whether it may pass. The sentences are fixed: nothing a site wrote is in any of them.
 */
export interface Verdict {
  errorClass: FetchErrorClass;
  outcome: 'failed' | 'blocked' | 'quarantined' | 'skipped';
  /** A request that failed, counted against the budget. */
  counts: boolean;
  /** A rule refused it before any page was asked for, so it is not a failure of the site. */
  safety: boolean;
  /** The failure may pass, so another try is worth making. */
  transient: boolean;
  /** Which rule refused it, as a fixed word, for the log. */
  reason: string;
  /** Set when robots.txt is what decided. */
  robots: RobotsDecision | null;
  quarantine: { reason: QuarantineReason; detail: string } | null;
  message: string;
  status: number | null;
  /** What the site asked to be waited, when it said. */
  retryAfterMs: number | null;
}

const BASE: Verdict = {
  errorClass: 'unknown',
  outcome: 'failed',
  counts: true,
  safety: false,
  transient: false,
  reason: 'unknown',
  robots: null,
  quarantine: null,
  message: 'The page could not be read.',
  status: null,
  retryAfterMs: null,
};

const verdict = (changes: Partial<Verdict>): Verdict => ({ ...BASE, ...changes });

const REFUSED_ADDRESS = 'This address is not a public web address, so it was not read.';

/** Statuses of a server that may be better in a moment. */
const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([408, 425, 429, 500, 502, 503, 504]);

/** How long a site asked to be waited: seconds, or a date. Anything else is no request at all. */
export function parseRetryAfter(header: string | undefined, now: number): number | null {
  const text = (header ?? '').trim();
  if (/^\d{1,6}$/u.test(text)) return Number(text) * 1_000;
  if (!/^[A-Za-z]{3},? [\w :+-]{8,40}$/u.test(text)) return null;
  const at = Date.parse(text);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

function refused(failure: UrlFailure): Verdict {
  const { refusal, address, redirected } = failure.detail;
  const reason = refusal ?? address ?? failure.code;
  if (redirected) {
    if (refusal === 'caller') {
      return verdict({
        errorClass: 'redirect-refused',
        outcome: 'skipped',
        counts: false,
        reason,
        message: 'A redirect led outside the sites this research reads, so it was not followed.',
      });
    }
    return verdict({
      errorClass: 'redirect-refused',
      outcome: 'blocked',
      counts: false,
      safety: true,
      reason,
      message: 'A redirect led to an address that is not read, so it was not followed.',
    });
  }
  if (failure.code === 'port') {
    return verdict({
      errorClass: 'blocked-port',
      outcome: 'blocked',
      counts: false,
      safety: true,
      reason: 'port',
      message: 'Only the standard web ports are read.',
    });
  }
  if (refusal === 'scheme' || refusal === 'http-not-allowed') {
    return verdict({
      errorClass: 'blocked-scheme',
      outcome: 'blocked',
      counts: false,
      safety: true,
      reason,
      message:
        refusal === 'http-not-allowed'
          ? 'This address uses http, and only https addresses are read.'
          : 'Only web addresses are read.',
    });
  }
  if (failure.code === 'blocked') {
    return verdict({
      errorClass: 'blocked-address',
      outcome: 'blocked',
      counts: false,
      safety: true,
      reason,
      message: REFUSED_ADDRESS,
    });
  }
  return verdict({
    errorClass: 'invalid-url',
    outcome: 'blocked',
    counts: false,
    safety: true,
    reason,
    message:
      refusal === 'credentials'
        ? 'An address with a user name or password is not read.'
        : 'This is not an address Swarm can read.',
  });
}

/**
 * A refusal that came from where a name leads (a private or internal address) is the failure of a name
 * that was not found: the same class, the same sentence, the same count, the same stop, whichever way the
 * name was met (the address itself, a redirect, robots.txt). A person who could tell the two apart could
 * learn which names exist inside the network the server runs in. What it was is kept, for the server's own
 * log only (`lookupRefusalOf`), as the cause of the failure that is judged.
 */
function toldAsMissing(failure: UrlFailure): UrlFailure {
  if (failure.code !== 'blocked' || failure.detail.resolved !== true) return failure;
  const { stage, redirected } = failure.detail;
  return new UrlFailure(
    'network',
    'The name could not be looked up.',
    { reason: 'dns', ...(stage ? { stage } : {}), ...(redirected ? { redirected } : {}) },
    failure,
  );
}

/** What a person is not told about a failure, for the server's own log: a name was refused for where it leads. */
export interface RefusedLookup {
  /** The name that was refused: the page's own, the one a redirect led to, or the one robots.txt led to. */
  host: string | null;
  via: 'page' | 'redirect' | 'robots';
  /** The kind of address the name leads to, as a fixed word: `private-network`, `link-local`... */
  reason: string;
}

/** Whether a failure is a name that was refused for the addresses it leads to, and what the server's log should say of it. */
export function lookupRefusalOf(error: unknown): RefusedLookup | null {
  if (!(error instanceof UrlFailure)) return null;
  let behind: unknown = error;
  // The refusal can sit one or two failures down: robots.txt and a redirect each wrap what they met.
  for (let depth = 0; depth < 4 && behind instanceof UrlFailure; depth += 1) {
    const { code, detail } = behind;
    if (code === 'blocked' && detail.resolved === true) {
      const via =
        error.detail.stage === 'robots' ? 'robots' : error.detail.redirected ? 'redirect' : 'page';
      return { host: detail.host ?? null, via, reason: detail.address ?? 'unknown' };
    }
    behind = behind.cause;
  }
  return null;
}

/** Judges a failure of one request. `cancelled` says the person, or the crawl's own deadline, stopped it. */
export function judge(error: unknown, context: { cancelled: boolean; now: number }): Verdict {
  if (context.cancelled) {
    return verdict({
      errorClass: 'cancelled',
      outcome: 'skipped',
      counts: false,
      reason: 'cancelled',
      message: 'The research was stopped before this page was read.',
    });
  }
  if (!(error instanceof UrlFailure)) return verdict({});
  const failure = toldAsMissing(error);
  const { detail } = failure;
  switch (failure.code) {
    case 'invalid':
    case 'blocked':
    case 'port':
      return refused(failure);
    case 'robots':
      return verdict({
        errorClass: 'robots-disallowed',
        outcome: 'blocked',
        counts: false,
        safety: true,
        reason: 'robots',
        robots: 'disallowed',
        message: 'The site\u2019s robots.txt asks that this page is not fetched.',
      });
    case 'robots-unavailable':
      return verdict({
        errorClass: 'robots-disallowed',
        outcome: 'blocked',
        counts: false,
        safety: true,
        reason: 'robots-unavailable',
        robots: 'disallowed',
        message: 'The site\u2019s robots.txt could not be read, so the page was not fetched.',
      });
    case 'type':
      return verdict({
        errorClass: 'unsupported-type',
        outcome: 'quarantined',
        reason: 'type',
        quarantine: {
          reason: 'unsupported-type',
          detail: 'The site sent a type of file that Swarm does not read.',
        },
        message: 'The site sent a type of file that Swarm does not read.',
      });
    case 'size':
      return verdict({
        errorClass: detail.decompressed ? 'decompression-limit' : 'too-large',
        outcome: 'quarantined',
        reason: detail.decompressed ? 'decompression-limit' : 'size',
        quarantine: {
          reason: 'oversized',
          detail: detail.decompressed
            ? 'The response grew past the size limit when it was unpacked, so it was set aside.'
            : 'The response was larger than Swarm reads.',
        },
        message: detail.decompressed
          ? 'The response grew past the size limit when it was unpacked.'
          : 'The response was larger than the size limit.',
      });
    case 'redirects':
      return verdict({
        errorClass: 'redirect-refused',
        reason: 'redirects',
        message: 'The address sent the reader on more times than Swarm follows.',
      });
    case 'timeout':
      // A robots.txt that does not answer forbids the origin, and is not tried again.
      if (detail.stage === 'robots') {
        return verdict({
          errorClass: 'robots-disallowed',
          outcome: 'blocked',
          counts: false,
          safety: true,
          reason: 'robots-unavailable',
          robots: 'disallowed',
          message: 'The site\u2019s robots.txt did not answer, so the page was not fetched.',
        });
      }
      return verdict({
        errorClass: 'timeout',
        transient: true,
        reason: 'timeout',
        message: 'The site took too long to answer.',
      });
    case 'status': {
      const status = detail.status ?? 0;
      return verdict({
        errorClass: 'http-status',
        transient: TRANSIENT_STATUSES.has(status),
        reason: 'status',
        status,
        retryAfterMs: parseRetryAfter(detail.retryAfter, context.now),
        message:
          status === 401 || status === 403
            ? `The site refused access (HTTP ${status}). Swarm reads only pages that are public.`
            : `The site answered with an error (HTTP ${status}).`,
      });
    }
    case 'network':
      return network(failure);
    default:
      return verdict({});
  }
}

function network(failure: UrlFailure): Verdict {
  const robots = failure.detail.stage === 'robots';
  if (robots) {
    return verdict({
      errorClass: 'robots-disallowed',
      outcome: 'blocked',
      counts: false,
      safety: true,
      reason: 'robots-unavailable',
      robots: 'disallowed',
      message: 'The site\u2019s robots.txt could not be reached, so the page was not fetched.',
    });
  }
  switch (failure.detail.reason) {
    case 'dns':
      return verdict({ errorClass: 'dns', reason: 'dns', message: 'The name could not be found.' });
    case 'refused':
      return verdict({
        errorClass: 'connect',
        reason: 'refused',
        message: 'The site refused the connection.',
      });
    case 'closed':
      return verdict({
        errorClass: 'connect',
        transient: true,
        reason: 'closed',
        message: 'The connection closed before the page arrived.',
      });
    case 'tls':
      return verdict({
        errorClass: 'tls',
        reason: 'tls',
        message: 'The site\u2019s security certificate could not be verified.',
      });
    case 'encoding':
      return verdict({
        errorClass: 'unknown',
        outcome: 'quarantined',
        reason: 'encoding',
        quarantine: {
          reason: 'malformed',
          detail: 'The response was compressed in a way that could not be undone.',
        },
        message: 'The response could not be decoded.',
      });
    default:
      return verdict({ reason: 'network', message: 'The page could not be reached.' });
  }
}

/** A host that is being left alone after too many failures in a row. */
export const circuitOpen = (): Verdict =>
  verdict({
    errorClass: 'circuit-open',
    outcome: 'skipped',
    counts: false,
    reason: 'circuit-open',
    message: 'The site failed several times in a row, so it is being left alone for a while.',
  });

/** A site that is not read because the research has already read as many sites as it may. */
export const domainLimit = (): Verdict =>
  verdict({
    errorClass: 'unknown',
    outcome: 'skipped',
    counts: false,
    reason: 'domain-limit',
    message: 'The research has read as many sites as it may, so this one was not read.',
  });

/** An address that a page which was read gave as its own, so reading it again would add nothing. */
export const alreadyRead = (): Verdict =>
  verdict({
    errorClass: 'unknown',
    outcome: 'skipped',
    counts: false,
    reason: 'already-read',
    message: 'A page that was read gives this address as its own, so it was not read again.',
  });

/** Whether a failure is the kind that the person, or the crawl, would stop: nothing to do with the site. */
export const isAbort = (error: unknown): boolean =>
  error instanceof UrlFailure
    ? error.detail.cancelled === true
    : error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
