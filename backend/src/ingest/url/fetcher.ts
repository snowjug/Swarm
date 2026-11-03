import { lookup as dnsLookup } from 'node:dns/promises';
import http, { type IncomingHttpHeaders } from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import type { Readable, Transform } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { APP_VERSION } from '../../../../shared/types.js';
import { UrlFailure } from './failure.js';
import { classifyAddress, validateUrl, type UrlPolicy, type ValidatedUrl } from './policy.js';
import { parseRobots, ROBOTS_MAX_BYTES, type Robots } from './robots.js';

export const ROBOTS_PRODUCT_TOKEN = 'SwarmLab-EvidenceFetcher';
export const USER_AGENT = `${ROBOTS_PRODUCT_TOKEN}/${APP_VERSION} (user-initiated evidence retrieval)`;
export const ALLOWED_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'text/html',
  'application/xhtml+xml',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
]);

/** How a fetcher introduces itself, and the name robots.txt groups are matched against. */
export interface FetchIdentity {
  userAgent: string;
  robotsToken: string;
}
const EVIDENCE_IDENTITY: FetchIdentity = {
  userAgent: USER_AGENT,
  robotsToken: ROBOTS_PRODUCT_TOKEN,
};

const DEFAULTS = { maxBytes: 1_500_000, timeoutMs: 12_000, idleMs: 5_000, maxRedirects: 5 };
const MAX_ADDRESSES = 16;
// A real response head is a few kilobytes. This is node's default, stated so that it stays so.
const MAX_HEADER_BYTES = 16_384;
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
const ACCEPT =
  'text/html,application/xhtml+xml,text/plain;q=0.9,text/markdown;q=0.9,text/csv;q=0.8,application/json;q=0.8';
// The response headers a caller may read: what a page says about its language, age and indexing.
const KEPT_HEADERS = ['content-language', 'last-modified', 'x-robots-tag', 'link'] as const;
const MAX_KEPT_HEADER_CHARS = 2_000;
const MAX_RETRY_AFTER_CHARS = 80;
// Nothing here identifies the person, the project or a session: no cookies, no credentials, no referrer.
const requestHeaders = (userAgent: string, accept: string): Record<string, string> => ({
  'user-agent': userAgent,
  accept,
  'accept-encoding': 'identity',
});

export interface ResolvedAddress {
  address: string;
  family: number;
}
export type Resolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;

const systemResolver: Resolver = (hostname) => dnsLookup(hostname, { all: true });

export interface FetcherSeam {
  /** Replaces the system resolver. Its answers are checked exactly as the system's would be. */
  lookup?: Resolver;
  /**
   * Lets a test read from a server on this machine: loopback addresses only, so every other private
   * range stays refused. It exists only here, on the constructor: nothing in the configuration, the
   * environment or a request can set it.
   */
  allowPrivateForTests?: boolean;
}

/** What robots.txt said for an origin: its rules, that it is not there, or that it could not be read (which forbids). */
export type RobotsAnswer = Robots | 'absent' | 'unavailable';

/** The answers a caller keeps between fetches, so that robots.txt is read once for each origin. */
export type RobotsCache = Map<string, RobotsAnswer>;

/** The key of an origin in a `RobotsCache`. */
export const robotsOrigin = (
  target: Pick<ValidatedUrl, 'protocol' | 'hostname' | 'port'>,
): string => `${target.protocol}//${target.hostname}:${target.port}`;

export interface RobotsDecision {
  origin: string;
  /** The address the decision was for. */
  url: string;
  decision: 'allowed' | 'absent' | 'disallowed' | 'unavailable';
  /** Answered from what was read for an earlier fetch. */
  cached: boolean;
}

/** Ways for a caller to take part in a fetch without being able to change what is checked. */
export interface FetchHooks {
  /**
   * Called before each request that goes to a site (its robots.txt, then the page, then each page a
   * redirect leads to). It may wait, to space requests out, and returns a function that is called when
   * the request has ended. The wait does not count against the time of the fetch. The signal ends with
   * the fetch, and a wait that is still going then must end too.
   */
  beforeRequest?: (
    request: { host: string; purpose: 'robots' | 'page' },
    signal: AbortSignal,
  ) => Promise<(() => void) | void>;
  /**
   * Called for each redirect that passed the address policy, before it is followed: for a page, and for
   * the robots.txt that is read before it, which may be sent on as well. A string refuses the redirect, and
   * is kept as the reason; a robots.txt that is sent somewhere that is refused is a robots.txt that could
   * not be read, which forbids the origin.
   */
  onRedirect?: (hop: {
    from: string;
    to: string;
    status: number;
    purpose: 'robots' | 'page';
  }) => string | null | void;
  /** Called with what robots.txt decided, each time a page is judged by it. */
  onRobots?: (decision: RobotsDecision) => void;
}

export interface FetchOptions extends UrlPolicy {
  /** The most that is read, before and after decompression. */
  maxBytes?: number;
  /** For the whole fetch: the lookups, the redirects, robots.txt and the page. */
  timeoutMs?: number;
  /** How long a connection may be silent. */
  idleMs?: number;
  maxRedirects?: number;
  /** Always true outside tests. */
  respectRobots?: boolean;
  /** Who is asking, to the site and in robots.txt. The evidence fetcher by default. */
  identity?: FetchIdentity;
  /** Ends the fetch, wherever it is. */
  signal?: AbortSignal;
  /** The media types that are read. A page of any other type is refused before its body is read. */
  allowedContentTypes?: ReadonlySet<string>;
  /** Shared by the fetches of one crawl; a fetch that is not given one reads robots.txt for itself. */
  robotsCache?: RobotsCache;
  hooks?: FetchHooks;
}

export interface FetchedPage {
  /** The address asked for, and the one the text came from after any redirects. */
  url: string;
  finalUrl: string;
  status: number;
  /** The media type, lower case, without parameters. */
  contentType: string;
  text: string;
  /** The bytes the text was decoded from, after decompression. */
  body: Buffer;
  /** A few of the response's headers, lower case, each cut short: see `KEPT_HEADERS`. */
  headers: Readonly<Record<string, string>>;
  bytes: number;
  redirects: number;
  robots: 'allowed' | 'absent' | 'skipped';
}

type Reply =
  | { kind: 'redirect'; location: string; status: number }
  | { kind: 'status'; status: number; retryAfter: string | null }
  | {
      kind: 'body';
      status: number;
      mediaType: string;
      charset: string | null;
      body: Buffer;
      headers: Record<string, string>;
      /** There was more than the plan allowed, and only what fitted was kept (a plan that `truncate`s). */
      truncated: boolean;
    };

interface ReadPlan {
  idleMs: number;
  maxBytes: number;
  userAgent: string;
  accept: string;
  /** Keep what fits instead of failing, as robots.txt allows. */
  truncate: boolean;
  /** Called with the media type before any of the body is read. */
  vet: ((mediaType: string) => void) | null;
}

interface Limits {
  maxBytes: number;
  idleMs: number;
  maxRedirects: number;
  respectRobots: boolean;
  identity: FetchIdentity;
  allowedTypes: ReadonlySet<string>;
  accept: string;
  robots: RobotsCache;
  hooks: FetchHooks | undefined;
  deadline: Deadline;
}

/** The time a fetch may take, which stops running while the fetch waits to be allowed to ask. */
class Deadline {
  private timer: NodeJS.Timeout | undefined;
  private left: number;
  private since = 0;

  constructor(
    ms: number,
    private readonly expire: () => void,
  ) {
    this.left = ms;
    this.resume();
  }

  pause(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.left = Math.max(0, this.left - (performance.now() - this.since));
  }

  resume(): void {
    if (this.timer) return;
    this.since = performance.now();
    this.timer = setTimeout(this.expire, this.left);
  }

  stop(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * Answers the connection's own name lookup with the addresses that were already checked. It answers on
 * a later turn, as a real lookup does: a connection that fails at once (no route to the address, no
 * network) raises its error where the connection is made, and answered at once that is before the
 * request has a listener for it. An error nobody listens for ends the whole process.
 */
export function pinTo(addresses: readonly ResolvedAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    const wantsAll = typeof options === 'object' && options !== null && options.all === true;
    const first = addresses[0];
    setImmediate(() => {
      if (wantsAll)
        callback(
          null,
          addresses.map(({ address, family }) => ({ address, family })),
        );
      else if (first) callback(null, first.address, first.family);
      else callback(Object.assign(new Error('no address'), { code: 'ENOTFOUND' }), '', 4);
    });
  };
}

function parseContentType(header: string | undefined): {
  mediaType: string;
  charset: string | null;
} {
  const [type = '', ...parameters] = (header ?? '').split(';');
  const charset = parameters
    .map((parameter) => /^\s*charset\s*=\s*"?([^";\s]+)"?\s*$/iu.exec(parameter)?.[1])
    .find(Boolean);
  return { mediaType: type.trim().toLowerCase(), charset: charset ?? null };
}

/** A media type that is safe to put in a message: the shape of a type, and nothing a site can use to write text. */
const safeType = (type: string): string =>
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,60}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,60}$/u.test(type)
    ? type
    : 'unknown';

function headerText(value: string | string[] | undefined, limit: number): string | null {
  const text = (Array.isArray(value) ? value.join(', ') : (value ?? '')).trim();
  return text ? text.slice(0, limit) : null;
}

function keptHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const name of KEPT_HEADERS) {
    const text = headerText(headers[name], MAX_KEPT_HEADER_CHARS);
    if (text) kept[name] = text;
  }
  return kept;
}

const retryAfterOf = (headers: IncomingHttpHeaders): string | null =>
  headerText(headers['retry-after'], MAX_RETRY_AFTER_CHARS);

function decoderFor(encoding: string): Transform | null {
  switch (encoding) {
    case 'gzip':
    case 'x-gzip':
      return createGunzip();
    case 'deflate':
      return createInflate();
    case 'br':
      return createBrotliDecompress();
    default:
      return null;
  }
}

function networkFailure(error: NodeJS.ErrnoException): UrlFailure {
  const code = error.code ?? '';
  if (code === 'ECONNREFUSED') {
    return new UrlFailure('network', 'The connection was refused.', { reason: 'refused' });
  }
  if (
    /^(ERR_TLS|ERR_SSL|EPROTO|CERT_|DEPTH_ZERO|SELF_SIGNED|UNABLE_TO_|HOSTNAME_MISMATCH)/u.test(
      code,
    )
  ) {
    return new UrlFailure('network', 'The security certificate could not be verified.', {
      reason: 'tls',
    });
  }
  if (code === 'ECONNRESET' || code === 'EPIPE') {
    return new UrlFailure('network', 'The connection was closed.', { reason: 'closed' });
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new UrlFailure('network', 'The name could not be looked up.', { reason: 'dns' });
  }
  return new UrlFailure('network', 'The page could not be reached.', { reason: 'other' });
}

function sniffCharset(body: Buffer): string | null {
  const head = body.subarray(0, 2_048).toString('latin1');
  return /<meta[^>]{0,200}?charset\s*=\s*["']?\s*([a-z0-9_:.-]{1,40})/iu.exec(head)?.[1] ?? null;
}

/** Text from bytes: the declared charset, a byte-order mark, or a `<meta charset>`; otherwise UTF-8. */
function decodeBody(body: Buffer, charset: string | null, mediaType: string): string {
  let label = charset;
  if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) label = 'utf-8';
  else if (body[0] === 0xff && body[1] === 0xfe) label = 'utf-16le';
  else if (body[0] === 0xfe && body[1] === 0xff) label = 'utf-16be';
  else if (!label && (mediaType === 'text/html' || mediaType === 'application/xhtml+xml')) {
    label = sniffCharset(body);
  }
  try {
    return new TextDecoder(label ?? 'utf-8').decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

/**
 * Where a redirect leads, checked as strictly as the address that was typed: its scheme, host,
 * port and allow list are judged again, and a page read over https is never followed to http.
 */
export function redirectTarget(
  from: ValidatedUrl,
  location: string,
  policy: UrlPolicy = {},
): ValidatedUrl {
  const written = location.trim();
  let candidate: string;
  try {
    // An address written out in full is judged as written, so that an odd spelling of an IP address
    // is refused rather than read as the address it stands for. Anything else is relative to this page.
    candidate = /^[a-z][a-z0-9+.-]*:\/\//iu.test(written)
      ? written
      : written.startsWith('//')
        ? `${from.protocol}${written}`
        : new URL(written, from.href).href;
  } catch {
    throw new UrlFailure('network', 'A redirect pointed at an address that is not valid.', {
      reason: 'other',
      redirected: true,
    });
  }
  let next: ValidatedUrl;
  try {
    next = validateUrl(candidate, policy);
  } catch (error) {
    if (error instanceof UrlFailure) {
      throw new UrlFailure(error.code, error.message, { ...error.detail, redirected: true });
    }
    throw error;
  }
  if (from.protocol === 'https:' && next.protocol === 'http:') {
    throw new UrlFailure('blocked', 'A redirect from https to http is not followed.', {
      redirected: true,
    });
  }
  return next;
}

/**
 * Reads one public web page, and only that. The address is checked as written; its name is looked
 * up once per request, every answer is checked, and the connection is made to an address that was
 * checked (a later lookup by the connection cannot send it elsewhere); each redirect is followed by
 * hand and checked the same way. The body is read up to a size, in a time, and is never run: it is
 * bytes decoded to text. Nothing is sent that identifies the person: no cookies, no credentials.
 */
export class PublicFetcher {
  private readonly resolver: Resolver;
  private readonly allowLoopback: boolean;

  constructor(seam: FetcherSeam = {}) {
    this.resolver = seam.lookup ?? systemResolver;
    this.allowLoopback = seam.allowPrivateForTests === true;
  }

  async fetchPublicPage(input: string, options: FetchOptions = {}): Promise<FetchedPage> {
    const allowedTypes = options.allowedContentTypes ?? ALLOWED_CONTENT_TYPES;
    const controller = new AbortController();
    const deadline = new Deadline(options.timeoutMs ?? DEFAULTS.timeoutMs, () =>
      controller.abort(new UrlFailure('timeout', 'Reading the page took too long.')),
    );
    const limits: Limits = {
      maxBytes: options.maxBytes ?? DEFAULTS.maxBytes,
      idleMs: options.idleMs ?? DEFAULTS.idleMs,
      maxRedirects: options.maxRedirects ?? DEFAULTS.maxRedirects,
      respectRobots: options.respectRobots ?? true,
      identity: options.identity ?? EVIDENCE_IDENTITY,
      allowedTypes,
      accept: allowedTypes.has('application/pdf') ? `${ACCEPT},application/pdf;q=0.7` : ACCEPT,
      robots: options.robotsCache ?? new Map(),
      hooks: options.hooks,
      deadline,
    };
    const policy: UrlPolicy = {
      ...(options.allowedPorts ? { allowedPorts: options.allowedPorts } : {}),
      ...(options.allowedHosts ? { allowedHosts: options.allowedHosts } : {}),
      ...(options.httpsOnly ? { httpsOnly: true } : {}),
    };
    const stop = (): void =>
      controller.abort(
        new UrlFailure('timeout', 'Reading the page was stopped.', { cancelled: true }),
      );
    options.signal?.addEventListener('abort', stop, { once: true });
    if (options.signal?.aborted) stop();
    try {
      return await this.follow(input, limits, policy, controller.signal);
    } catch (error) {
      if (error instanceof UrlFailure) throw error;
      throw new UrlFailure('network', 'The page could not be read.', { reason: 'other' }, error);
    } finally {
      deadline.stop();
      options.signal?.removeEventListener('abort', stop);
    }
  }

  private async follow(
    input: string,
    limits: Limits,
    policy: UrlPolicy,
    signal: AbortSignal,
  ): Promise<FetchedPage> {
    let target = validateUrl(input, policy);
    const requested = target.href;
    for (let redirects = 0; ; redirects += 1) {
      try {
        // The host is judged before anything is asked of it, so a private address is reported as one
        // rather than as a robots.txt that could not be read.
        const addresses = await this.resolve(target, signal);
        let robots: FetchedPage['robots'] = 'skipped';
        if (limits.respectRobots) {
          robots = await this.checkRobots(target, limits, policy, signal);
        }
        const reply = await this.gated(limits, 'page', target, signal, () =>
          this.get(
            target,
            addresses,
            {
              idleMs: limits.idleMs,
              maxBytes: limits.maxBytes,
              userAgent: limits.identity.userAgent,
              accept: limits.accept,
              truncate: false,
              vet: (mediaType) => {
                if (!limits.allowedTypes.has(mediaType)) {
                  throw new UrlFailure('type', 'The site sent a type of file that is not read.', {
                    contentType: safeType(mediaType),
                  });
                }
              },
            },
            signal,
          ),
        );
        if (reply.kind === 'redirect') {
          if (redirects >= limits.maxRedirects) {
            throw new UrlFailure('redirects', `More than ${limits.maxRedirects} redirects.`);
          }
          const next = redirectTarget(target, reply.location, policy);
          const turnedDown = limits.hooks?.onRedirect?.({
            from: target.href,
            to: next.href,
            status: reply.status,
            purpose: 'page',
          });
          if (typeof turnedDown === 'string') {
            throw new UrlFailure('blocked', 'A redirect was turned down.', {
              refusal: 'caller',
              redirected: true,
            });
          }
          target = next;
          continue;
        }
        if (reply.kind === 'status') {
          throw new UrlFailure('status', `The site answered ${reply.status}.`, {
            status: reply.status,
            ...(reply.retryAfter ? { retryAfter: reply.retryAfter } : {}),
          });
        }
        return {
          url: requested,
          finalUrl: target.href,
          status: reply.status,
          contentType: reply.mediaType,
          text: decodeBody(reply.body, reply.charset, reply.mediaType),
          body: reply.body,
          headers: reply.headers,
          bytes: reply.body.length,
          redirects,
          robots,
        };
      } catch (error) {
        if (error instanceof UrlFailure && redirects > 0 && !error.detail.redirected) {
          throw new UrlFailure(
            error.code,
            error.message,
            { ...error.detail, redirected: true },
            error,
          );
        }
        throw error;
      }
    }
  }

  /**
   * Runs one request after the caller's `beforeRequest` has let it go. The wait is not part of the
   * fetch's time, and a request that is let go of after the fetch has ended is given back at once.
   */
  private async gated<T>(
    limits: Limits,
    purpose: 'robots' | 'page',
    target: ValidatedUrl,
    signal: AbortSignal,
    run: () => Promise<T>,
  ): Promise<T> {
    const gate = limits.hooks?.beforeRequest;
    if (!gate) return run();
    let release: (() => void) | void;
    limits.deadline.pause();
    const pending = gate({ host: target.hostname, purpose }, signal);
    try {
      release = await raceAbort(pending, signal);
    } catch (error) {
      void pending.then(
        (late) => late?.(),
        () => undefined,
      );
      throw error;
    } finally {
      limits.deadline.resume();
    }
    try {
      return await run();
    } finally {
      release?.();
    }
  }

  /** Looks the name up, and refuses the whole host if any answer is not a public address. */
  private async resolve(
    target: ValidatedUrl,
    signal: AbortSignal,
  ): Promise<readonly ResolvedAddress[]> {
    let found: readonly ResolvedAddress[];
    if (target.ipLiteral) {
      found = [{ address: target.hostname, family: isIP(target.hostname) }];
    } else {
      try {
        found = await raceAbort(this.resolver(target.hostname), signal);
      } catch (error) {
        if (signal.aborted) throw error;
        throw new UrlFailure('network', 'The name could not be looked up.', { reason: 'dns' });
      }
    }
    if (found.length === 0) {
      throw new UrlFailure('network', 'The name has no address.', { reason: 'dns' });
    }
    const usable = found.slice(0, MAX_ADDRESSES);
    for (const { address } of usable) {
      const verdict = classifyAddress(address);
      if (verdict.allowed || (this.allowLoopback && verdict.reason === 'loopback')) continue;
      throw new UrlFailure('blocked', `${target.hostname} leads to a ${verdict.reason} address.`, {
        resolved: !target.ipLiteral,
        address: verdict.reason,
        ...(target.ipLiteral ? {} : { host: target.hostname }),
      });
    }
    return usable;
  }

  /**
   * RFC 9309: a robots.txt that answers is obeyed, a missing one (4xx) allows, and one that cannot be
   * read forbids. What was found is kept for the origin, so that a crawl asks once, and a site whose
   * robots.txt could not be read is not asked again.
   */
  private async checkRobots(
    target: ValidatedUrl,
    limits: Limits,
    policy: UrlPolicy,
    signal: AbortSignal,
  ): Promise<'allowed' | 'absent'> {
    const origin = robotsOrigin(target);
    const report = (decision: RobotsDecision['decision'], cached: boolean): void =>
      limits.hooks?.onRobots?.({ origin, url: target.href, decision, cached });
    let answer = limits.robots.get(origin);
    const cached = answer !== undefined;
    if (answer === undefined) {
      try {
        answer = await this.readRobots(target, limits, policy, signal);
      } catch (error) {
        // A robots.txt that cannot be read forbids the origin, for as long as the cache is kept. A fetch
        // that ran out of time, or was stopped, says nothing about the site.
        if (!signal.aborted && error instanceof UrlFailure && error.detail.stage === 'robots') {
          limits.robots.set(origin, 'unavailable');
          report('unavailable', false);
        }
        throw error;
      }
      limits.robots.set(origin, answer);
    }
    if (answer === 'unavailable') {
      report('unavailable', cached);
      throw new UrlFailure('robots-unavailable', 'The site\u2019s robots.txt could not be read.', {
        stage: 'robots',
      });
    }
    if (answer === 'absent') {
      report('absent', cached);
      return 'absent';
    }
    if (!answer.allows(target.path)) {
      report('disallowed', cached);
      throw new UrlFailure('robots', 'The site asks that this page is not fetched.');
    }
    report('allowed', cached);
    return 'allowed';
  }

  private async readRobots(
    target: ValidatedUrl,
    limits: Limits,
    policy: UrlPolicy,
    signal: AbortSignal,
  ): Promise<Exclude<RobotsAnswer, 'unavailable'>> {
    const unreadable = (): UrlFailure =>
      new UrlFailure('robots-unavailable', 'The site\u2019s robots.txt could not be read.', {
        stage: 'robots',
      });
    let current: ValidatedUrl;
    try {
      current = validateUrl(new URL('/robots.txt', target.href).href, policy);
    } catch {
      throw unreadable();
    }
    for (let redirects = 0; redirects <= limits.maxRedirects; redirects += 1) {
      try {
        const addresses = await this.resolve(current, signal);
        const reply = await this.gated(limits, 'robots', current, signal, () =>
          this.get(
            current,
            addresses,
            {
              idleMs: limits.idleMs,
              maxBytes: ROBOTS_MAX_BYTES,
              userAgent: limits.identity.userAgent,
              accept: limits.accept,
              truncate: true,
              vet: null,
            },
            signal,
          ),
        );
        if (reply.kind === 'redirect') {
          const next = redirectTarget(current, reply.location, policy);
          // Where robots.txt is sent is judged by the caller as where a page is sent: a robots.txt that
          // is sent somewhere that is refused is one that cannot be read, and that forbids the origin.
          const turnedDown = limits.hooks?.onRedirect?.({
            from: current.href,
            to: next.href,
            status: reply.status,
            purpose: 'robots',
          });
          if (typeof turnedDown === 'string') break;
          current = next;
          continue;
        }
        if (reply.kind === 'status') {
          if (reply.status >= 400 && reply.status < 500) return 'absent';
          break;
        }
        // What is past the limit cannot be read, so it cannot be obeyed: a robots.txt that is longer
        // than what is read is one that cannot be read, which forbids the origin.
        if (reply.truncated) break;
        return parseRobots(
          decodeBody(reply.body, reply.charset, reply.mediaType),
          limits.identity.robotsToken,
        );
      } catch (error) {
        // Running out of the whole fetch's time is a timeout, and a site that cannot be reached at all
        // is reported as that. So is a name that leads inside a network, which is passed on as the
        // refusal it was (not as a robots.txt that could not be read, which would tell it from a name
        // that was not found). What is left is a robots.txt that was found but cannot be used.
        if (signal.aborted) throw error;
        if (
          error instanceof UrlFailure &&
          (error.code === 'network' ||
            error.code === 'timeout' ||
            (error.code === 'blocked' && error.detail.resolved === true))
        ) {
          throw new UrlFailure(
            error.code,
            error.message,
            { ...error.detail, stage: 'robots' },
            error,
          );
        }
        break;
      }
    }
    throw unreadable();
  }

  /** One request to an address that has been checked. */
  private get(
    target: ValidatedUrl,
    addresses: readonly ResolvedAddress[],
    plan: ReadPlan,
    signal: AbortSignal,
  ): Promise<Reply> {
    return new Promise<Reply>((resolve, reject) => {
      let settled = false;
      let decoder: Transform | null = null;
      const request = (target.protocol === 'https:' ? https : http).request({
        host: target.hostname,
        port: target.port,
        path: target.path,
        method: 'GET',
        headers: requestHeaders(plan.userAgent, plan.accept),
        // A new connection for each request: nothing is reused for another address.
        agent: false,
        lookup: pinTo(addresses),
        timeout: plan.idleMs,
        maxHeaderSize: MAX_HEADER_BYTES,
      });
      const onAbort = (): void =>
        fail(
          signal.reason instanceof UrlFailure
            ? signal.reason
            : new UrlFailure('timeout', 'Reading the page was stopped.'),
        );
      const settle = (outcome: () => void): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        decoder?.destroy();
        request.destroy();
        outcome();
      };
      const fail = (failure: UrlFailure): void => settle(() => reject(failure));
      const succeed = (reply: Reply): void => settle(() => resolve(reply));
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();

      request.on('timeout', () => fail(new UrlFailure('timeout', 'The site stopped answering.')));
      request.on('error', (error: NodeJS.ErrnoException) => fail(networkFailure(error)));
      request.on('response', (response) => {
        try {
          const status = response.statusCode ?? 0;
          if (REDIRECT_STATUSES.has(status)) {
            const location = response.headers.location;
            if (!location) {
              return fail(
                new UrlFailure('network', 'A redirect did not say where to.', { reason: 'other' }),
              );
            }
            return succeed({ kind: 'redirect', location, status });
          }
          if (status < 200 || status > 299) {
            return succeed({ kind: 'status', status, retryAfter: retryAfterOf(response.headers) });
          }

          const { mediaType, charset } = parseContentType(response.headers['content-type']);
          plan.vet?.(mediaType);
          const encoding = String(response.headers['content-encoding'] ?? '')
            .trim()
            .toLowerCase();
          const compressed = encoding !== '' && encoding !== 'identity';
          if (compressed) {
            decoder = decoderFor(encoding);
            if (!decoder) {
              throw new UrlFailure('network', 'The page is compressed in a way that is not read.', {
                reason: 'encoding',
              });
            }
          }
          const declared = Number(response.headers['content-length']);
          if (
            !compressed &&
            !plan.truncate &&
            Number.isFinite(declared) &&
            declared > plan.maxBytes
          ) {
            throw new UrlFailure('size', 'The page is larger than the limit.');
          }

          const chunks: Buffer[] = [];
          let total = 0;
          let truncated = false;
          const finish = (): void =>
            succeed({
              kind: 'body',
              status,
              mediaType,
              charset,
              body: Buffer.concat(chunks),
              headers: keptHeaders(response.headers),
              truncated,
            });
          const tooLarge = (decompressed: boolean): void => {
            if (plan.truncate) {
              truncated = true;
              finish();
              return;
            }
            fail(
              new UrlFailure(
                'size',
                'The page is larger than the limit.',
                decompressed ? { decompressed: true } : {},
              ),
            );
          };
          const source: Readable = decoder ?? response;
          if (decoder) {
            let compressedBytes = 0;
            decoder.on('error', () =>
              fail(
                new UrlFailure('network', 'The compressed data was damaged.', {
                  reason: 'encoding',
                }),
              ),
            );
            response.on('data', (chunk: Buffer) => {
              compressedBytes += chunk.length;
              if (compressedBytes > plan.maxBytes + 65_536) tooLarge(false);
            });
            response.pipe(decoder);
          }
          source.on('data', (chunk: Buffer) => {
            const room = plan.maxBytes - total;
            if (chunk.length > room) {
              if (plan.truncate) chunks.push(chunk.subarray(0, room));
              tooLarge(decoder !== null);
              return;
            }
            chunks.push(chunk);
            total += chunk.length;
          });
          source.on('end', finish);
          response.on('error', () =>
            fail(new UrlFailure('network', 'The connection was closed.', { reason: 'closed' })),
          );
          response.on('close', () => {
            if (!response.complete) {
              fail(new UrlFailure('network', 'The connection was closed.', { reason: 'closed' }));
            }
          });
        } catch (error) {
          fail(
            error instanceof UrlFailure
              ? error
              : new UrlFailure('network', 'The answer could not be read.', { reason: 'other' }),
          );
        }
      });
      request.end();
    });
  }
}

let shared: PublicFetcher | undefined;

/** Reads a public page with the system resolver. */
export function fetchPublicPage(input: string, options: FetchOptions = {}): Promise<FetchedPage> {
  shared ??= new PublicFetcher();
  return shared.fetchPublicPage(input, options);
}
