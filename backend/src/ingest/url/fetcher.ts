import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import type { Readable, Transform } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { APP_VERSION } from '../../../../shared/types.js';
import { UrlFailure } from './failure.js';
import { classifyAddress, validateUrl, type UrlPolicy, type ValidatedUrl } from './policy.js';
import { parseRobots, type Robots } from './robots.js';

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

const DEFAULTS = { maxBytes: 1_500_000, timeoutMs: 12_000, idleMs: 5_000, maxRedirects: 5 };
// RFC 9309 asks a crawler to read at least 500 KiB of robots.txt, and to ignore the rest.
const ROBOTS_MAX_BYTES = 512_000;
const MAX_ADDRESSES = 16;
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
// Nothing here identifies the person, the project or a session: no cookies, no credentials, no referrer.
const REQUEST_HEADERS = {
  'user-agent': USER_AGENT,
  accept:
    'text/html,application/xhtml+xml,text/plain;q=0.9,text/markdown;q=0.9,text/csv;q=0.8,application/json;q=0.8',
  'accept-encoding': 'identity',
};

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
}

export interface FetchedPage {
  /** The address asked for, and the one the text came from after any redirects. */
  url: string;
  finalUrl: string;
  status: number;
  /** The media type, lower case, without parameters. */
  contentType: string;
  text: string;
  bytes: number;
  redirects: number;
  robots: 'allowed' | 'absent' | 'skipped';
}

type Reply =
  | { kind: 'redirect'; location: string }
  | { kind: 'status'; status: number }
  | { kind: 'body'; status: number; mediaType: string; charset: string | null; body: Buffer };

interface ReadPlan {
  idleMs: number;
  maxBytes: number;
  /** Keep what fits instead of failing, as robots.txt allows. */
  truncate: boolean;
  /** Called with the media type before any of the body is read. */
  vet: ((mediaType: string) => void) | null;
}

type RobotsAnswer = Robots | 'absent';

interface Limits {
  maxBytes: number;
  timeoutMs: number;
  idleMs: number;
  maxRedirects: number;
  respectRobots: boolean;
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
    const limits: Limits = {
      maxBytes: options.maxBytes ?? DEFAULTS.maxBytes,
      timeoutMs: options.timeoutMs ?? DEFAULTS.timeoutMs,
      idleMs: options.idleMs ?? DEFAULTS.idleMs,
      maxRedirects: options.maxRedirects ?? DEFAULTS.maxRedirects,
      respectRobots: options.respectRobots ?? true,
    };
    const policy: UrlPolicy = {
      ...(options.allowedPorts ? { allowedPorts: options.allowedPorts } : {}),
      ...(options.allowedHosts ? { allowedHosts: options.allowedHosts } : {}),
    };
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new UrlFailure('timeout', 'Reading the page took too long.')),
      limits.timeoutMs,
    );
    try {
      return await this.follow(input, limits, policy, controller.signal);
    } catch (error) {
      if (error instanceof UrlFailure) throw error;
      throw new UrlFailure('network', 'The page could not be read.', { reason: 'other' }, error);
    } finally {
      clearTimeout(timer);
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
    const robotsByOrigin = new Map<string, RobotsAnswer>();
    for (let redirects = 0; ; redirects += 1) {
      try {
        // The host is judged before anything is asked of it, so a private address is reported as one
        // rather than as a robots.txt that could not be read.
        const addresses = await this.resolve(target, signal);
        let robots: FetchedPage['robots'] = 'skipped';
        if (limits.respectRobots) {
          robots = await this.checkRobots(target, limits, policy, signal, robotsByOrigin);
        }
        const reply = await this.get(
          target,
          addresses,
          {
            idleMs: limits.idleMs,
            maxBytes: limits.maxBytes,
            truncate: false,
            vet: (mediaType) => {
              if (!ALLOWED_CONTENT_TYPES.has(mediaType)) {
                throw new UrlFailure('type', 'The site sent a type of file that is not read.', {
                  contentType: safeType(mediaType),
                });
              }
            },
          },
          signal,
        );
        if (reply.kind === 'redirect') {
          if (redirects >= limits.maxRedirects) {
            throw new UrlFailure('redirects', `More than ${limits.maxRedirects} redirects.`);
          }
          target = redirectTarget(target, reply.location, policy);
          continue;
        }
        if (reply.kind === 'status') {
          throw new UrlFailure('status', `The site answered ${reply.status}.`, {
            status: reply.status,
          });
        }
        return {
          url: requested,
          finalUrl: target.href,
          status: reply.status,
          contentType: reply.mediaType,
          text: decodeBody(reply.body, reply.charset, reply.mediaType),
          bytes: reply.body.length,
          redirects,
          robots,
        };
      } catch (error) {
        if (error instanceof UrlFailure && redirects > 0 && !error.detail.redirected) {
          throw new UrlFailure(error.code, error.message, { ...error.detail, redirected: true });
        }
        throw error;
      }
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
      throw new UrlFailure('blocked', `${target.hostname} leads to a ${verdict.reason} address.`);
    }
    return usable;
  }

  /** RFC 9309: a robots.txt that answers is obeyed, a missing one (4xx) allows, and one that cannot be read forbids. */
  private async checkRobots(
    target: ValidatedUrl,
    limits: Limits,
    policy: UrlPolicy,
    signal: AbortSignal,
    known: Map<string, RobotsAnswer>,
  ): Promise<'allowed' | 'absent'> {
    const origin = `${target.protocol}//${target.hostname}:${target.port}`;
    let answer = known.get(origin);
    if (!answer) {
      answer = await this.readRobots(target, limits, policy, signal);
      known.set(origin, answer);
    }
    if (answer === 'absent') return 'absent';
    if (!answer.allows(target.path)) {
      throw new UrlFailure('robots', 'The site asks that this page is not fetched.');
    }
    return 'allowed';
  }

  private async readRobots(
    target: ValidatedUrl,
    limits: Limits,
    policy: UrlPolicy,
    signal: AbortSignal,
  ): Promise<RobotsAnswer> {
    const unreadable = (): UrlFailure =>
      new UrlFailure('robots-unavailable', 'The site\u2019s robots.txt could not be read.');
    let current: ValidatedUrl;
    try {
      current = validateUrl(new URL('/robots.txt', target.href).href, policy);
    } catch {
      throw unreadable();
    }
    for (let redirects = 0; redirects <= limits.maxRedirects; redirects += 1) {
      try {
        const addresses = await this.resolve(current, signal);
        const reply = await this.get(
          current,
          addresses,
          { idleMs: limits.idleMs, maxBytes: ROBOTS_MAX_BYTES, truncate: true, vet: null },
          signal,
        );
        if (reply.kind === 'redirect') {
          current = redirectTarget(current, reply.location, policy);
          continue;
        }
        if (reply.kind === 'status') {
          if (reply.status >= 400 && reply.status < 500) return 'absent';
          break;
        }
        return parseRobots(
          decodeBody(reply.body, reply.charset, reply.mediaType),
          ROBOTS_PRODUCT_TOKEN,
        );
      } catch (error) {
        // Running out of the whole fetch's time is a timeout, and a site that cannot be reached at all
        // is reported as that. What is left is a robots.txt that was found but cannot be used.
        if (signal.aborted) throw error;
        if (error instanceof UrlFailure && (error.code === 'network' || error.code === 'timeout')) {
          throw error;
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
        headers: REQUEST_HEADERS,
        // A new connection for each request: nothing is reused for another address.
        agent: false,
        lookup: pinTo(addresses),
        timeout: plan.idleMs,
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
            return succeed({ kind: 'redirect', location });
          }
          if (status < 200 || status > 299) return succeed({ kind: 'status', status });

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
          const finish = (): void =>
            succeed({ kind: 'body', status, mediaType, charset, body: Buffer.concat(chunks) });
          const tooLarge = (): void =>
            plan.truncate
              ? finish()
              : fail(new UrlFailure('size', 'The page is larger than the limit.'));
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
              if (compressedBytes > plan.maxBytes + 65_536) tooLarge();
            });
            response.pipe(decoder);
          }
          source.on('data', (chunk: Buffer) => {
            const room = plan.maxBytes - total;
            if (chunk.length > room) {
              if (plan.truncate) chunks.push(chunk.subarray(0, room));
              tooLarge();
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
