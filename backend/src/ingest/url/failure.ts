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

export interface UrlFailureDetail {
  status?: number;
  /** The media type the site sent, when it is not one that is read. Already restricted to a safe shape. */
  contentType?: string;
  /** The failure happened on an address a redirect led to, not on the one that was asked for. */
  redirected?: boolean;
  /** Narrows `network`. */
  reason?: 'dns' | 'refused' | 'tls' | 'closed' | 'encoding' | 'other';
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
