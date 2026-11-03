/**
 * Why a public page could not be read. The route turns each code into a plain sentence for the
 * person; the messages here are for logs and tests, and may name the technical reason.
 */
export type UrlFailureCode =
  /** Not an address that can be read at all. */
  | 'invalid'
  /** Not a public web address: private or local network, an internal name, an odd form, or not allowed. */
  | 'blocked'
  | 'port'
  | 'type'
  | 'size'
  | 'timeout'
  | 'redirects'
  | 'robots'
  /** The site's robots.txt could not be read, which RFC 9309 treats as "complete disallow". */
  | 'robots-unavailable'
  | 'no-text'
  /** The site answered with an HTTP error. */
  | 'status'
  /** The name did not resolve, the connection failed, or the data was not what it claimed to be. */
  | 'network';

/** Which rule of the address policy refused an address, so that refusals can be counted by kind. */
export type UrlRefusal =
  | 'empty'
  | 'too-long'
  | 'control-characters'
  | 'scheme'
  | 'credentials'
  | 'unparsable'
  | 'no-host'
  | 'ip-form'
  | 'single-label'
  | 'internal-name'
  | 'allow-list'
  /** The caller reads https only, and the address is http. */
  | 'http-not-allowed'
  /** The caller that follows redirects turned this one down. */
  | 'caller';

export interface UrlFailureDetail {
  status?: number;
  /** The media type the site sent, when it is not one that is read. Already restricted to a safe shape. */
  contentType?: string;
  /** The failure happened on an address a redirect led to, not on the one that was asked for. */
  redirected?: boolean;
  /**
   * A `blocked` refusal that came from the addresses a name resolved to, not from the address as it was
   * written, on any path: the page, a redirect, or robots.txt. A person cannot judge that from the text,
   * and saying it would tell them which names exist inside a network, so a caller reports it exactly as it
   * reports a name that was not found (`network`, `reason: 'dns'`): the same sentence, the same count.
   * The refusal itself is for the server's own log.
   */
  resolved?: boolean;
  /** The name that was refused, when `resolved` is set. For the server's own log, never for a person. */
  host?: string;
  /** Narrows `network`. */
  reason?: 'dns' | 'refused' | 'tls' | 'closed' | 'encoding' | 'other';
  /** Narrows `invalid` and `blocked` when the address policy is what refused. */
  refusal?: UrlRefusal;
  /** Why an address a name resolved to was refused (`classifyAddress`), such as `private-network`. */
  address?: string;
  /** What a decompressor produced, not what was sent, passed the size limit. */
  decompressed?: boolean;
  /** The caller stopped the read; it did not run out of time. */
  cancelled?: boolean;
  /** The failure came from reading robots.txt, not from the page. */
  stage?: 'robots';
  /** The site's `Retry-After` header as it was sent (cut short), on an HTTP error. It is for a caller to parse, never to show. */
  retryAfter?: string;
}

export class UrlFailure extends Error {
  constructor(
    readonly code: UrlFailureCode,
    message: string,
    readonly detail: UrlFailureDetail = {},
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'UrlFailure';
  }
}
