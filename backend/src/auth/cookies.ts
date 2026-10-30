/**
 * Just enough cookie handling for one session cookie and one short-lived login cookie, written out
 * so that exactly what is accepted and what is sent can be read and tested. Values are opaque
 * base64url strings that this server generated; anything else is ignored rather than interpreted.
 */

const NAME = /^[A-Za-z0-9_-]{1,64}$/u;
const VALUE = /^[A-Za-z0-9_-]{16,128}$/u;

/** The value of one cookie by name, or null. A malformed header, name or value yields null. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header || header.length > 4_096 || !NAME.test(name)) return null;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    if (part.slice(0, at).trim() !== name) continue;
    const value = part.slice(at + 1).trim();
    return VALUE.test(value) ? value : null;
  }
  return null;
}

export interface CookieOptions {
  /** Seconds until it expires. Zero (with an empty value) removes it. */
  maxAge: number;
  secure: boolean;
}

/** HttpOnly, SameSite=Lax and scoped to the whole site. Secure unless development is on plain http. */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  if (!NAME.test(name)) throw new Error('Invalid cookie name.');
  if (value !== '' && !VALUE.test(value)) throw new Error('Invalid cookie value.');
  const attributes = [
    `${name}=${value}`,
    'Path=/',
    `Max-Age=${Math.max(0, Math.trunc(options.maxAge))}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (options.secure) attributes.push('Secure');
  return attributes.join('; ');
}

/** The `__Host-` prefix makes a browser refuse the cookie unless it is Secure, host-only and at `/`. */
export function cookieName(base: string, secure: boolean): string {
  return secure ? `__Host-${base}` : base;
}
