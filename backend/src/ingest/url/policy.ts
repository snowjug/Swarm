import { isIPv4, isIPv6 } from 'node:net';
import { UrlFailure } from './failure.js';

export const MAX_URL_LENGTH = 2_048;
export const DEFAULT_ALLOWED_PORTS: readonly number[] = [80, 443];

export type AddressVerdict = { allowed: true } | { allowed: false; reason: string };

const blocked = (reason: string): AddressVerdict => ({ allowed: false, reason });
const ALLOWED: AddressVerdict = { allowed: true };

/** Address ranges that are never fetched: [first address, prefix length, why]. The first match wins. */
const BLOCKED_V4: readonly (readonly [string, number, string])[] = [
  ['0.0.0.0', 8, 'unspecified'],
  ['10.0.0.0', 8, 'private-network'],
  ['100.64.0.0', 10, 'shared-address-space'],
  ['127.0.0.0', 8, 'loopback'],
  // Includes the cloud metadata address 169.254.169.254.
  ['169.254.0.0', 16, 'link-local'],
  ['172.16.0.0', 12, 'private-network'],
  ['192.0.0.0', 24, 'protocol-assignment'],
  ['192.0.2.0', 24, 'documentation'],
  ['192.88.99.0', 24, 'deprecated-relay'],
  ['192.168.0.0', 16, 'private-network'],
  ['198.18.0.0', 15, 'benchmarking'],
  ['198.51.100.0', 24, 'documentation'],
  ['203.0.113.0', 24, 'documentation'],
  ['224.0.0.0', 4, 'multicast'],
  ['255.255.255.255', 32, 'broadcast'],
  ['240.0.0.0', 4, 'reserved'],
];

/** Strict dotted quad: four decimal numbers, none with a leading zero (which some parsers read as octal). */
function parseV4(text: string): number | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(text);
  if (!match) return null;
  let value = 0;
  for (const part of match.slice(1)) {
    if (part.length > 1 && part.startsWith('0')) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

const BLOCKED_V4_PARSED = BLOCKED_V4.map(([start, bits, reason]) => {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { network: ((parseV4(start) ?? 0) & mask) >>> 0, mask, reason };
});

function classifyV4(value: number): AddressVerdict {
  for (const { network, mask, reason } of BLOCKED_V4_PARSED) {
    if ((value & mask) >>> 0 === network) return blocked(reason);
  }
  return ALLOWED;
}

/** Eight 16-bit groups, or null. Accepts `::` compression and an IPv4 tail; refuses zone identifiers. */
function parseV6(text: string): number[] | null {
  if (!text.includes(':') || !/^[0-9a-f:.]+$/iu.test(text)) return null;
  let body = text;
  const tail = /(?<=:)(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(body);
  if (tail) {
    const value = parseV4(tail[1] ?? '');
    if (value === null) return null;
    body = `${body.slice(0, tail.index)}${Math.floor(value / 0x10000).toString(16)}:${(value % 0x10000).toString(16)}`;
  }
  const halves = body.split('::');
  if (halves.length > 2) return null;
  const groups = (part: string): string[] => (part === '' ? [] : part.split(':'));
  const head = groups(halves[0] ?? '');
  const rest = halves.length === 2 ? groups(halves[1] ?? '') : [];
  const present = [...head, ...rest];
  if (present.some((group) => !/^[0-9a-f]{1,4}$/iu.test(group))) return null;
  const missing = 8 - present.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const numbers = (list: string[]): number[] => list.map((group) => Number.parseInt(group, 16));
  return [
    ...numbers(head),
    ...Array<number>(halves.length === 2 ? missing : 0).fill(0),
    ...numbers(rest),
  ];
}

function classifyV6(groups: number[]): AddressVerdict {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;
  const embedded = (high: number, low: number): AddressVerdict => classifyV4(high * 0x10000 + low);
  const zero = (count: number): boolean => groups.slice(0, count).every((group) => group === 0);
  if (zero(6)) {
    if (g6 === 0 && g7 === 0) return blocked('unspecified');
    if (g6 === 0 && g7 === 1) return blocked('loopback');
    return blocked('ipv4-compatible');
  }
  // Addresses that carry an IPv4 address are judged by it, so ::ffff:127.0.0.1 is as blocked as 127.0.0.1.
  if (zero(5) && g5 === 0xffff) return embedded(g6, g7);
  if (zero(4) && g4 === 0xffff && g5 === 0) return embedded(g6, g7);
  // NAT64 (RFC 6052): a DNS64 network gives public sites an address here, so a public IPv4 must pass.
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return embedded(g6, g7);
  }
  // Only 2000::/3 is global unicast; everything else is local, multicast, reserved or unallocated.
  if ((g0 & 0xe000) !== 0x2000) {
    if ((g0 & 0xfe00) === 0xfc00) return blocked('unique-local');
    if ((g0 & 0xffc0) === 0xfe80) return blocked('link-local');
    if ((g0 & 0xffc0) === 0xfec0) return blocked('site-local');
    if ((g0 & 0xff00) === 0xff00) return blocked('multicast');
    return blocked('reserved');
  }
  if (g0 === 0x2002) return embedded(g1, g2);
  if (g0 === 0x2001 && g1 === 0) return blocked('teredo');
  if (g0 === 0x2001 && g1 < 0x200) return blocked('protocol-assignment');
  if (g0 === 0x2001 && g1 === 0x0db8) return blocked('documentation');
  if (g0 === 0x3fff && g1 < 0x1000) return blocked('documentation');
  return ALLOWED;
}

/**
 * Whether Swarm may connect to this address. Anything that is not a plain IPv4 or IPv6 address is
 * refused, so an unparsable answer can never be treated as public.
 */
export function classifyAddress(address: string): AddressVerdict {
  const text = address.trim().replace(/^\[(.*)\]$/u, '$1');
  const v4 = parseV4(text);
  if (v4 !== null) return classifyV4(v4);
  const v6 = parseV6(text);
  return v6 ? classifyV6(v6) : blocked('invalid-address');
}

export interface UrlPolicy {
  /** Ports a page may be read from. Defaults to 80 and 443. */
  allowedPorts?: ReadonlySet<number> | readonly number[];
  /** When not empty, only these hosts: `example.com` exactly, or `*.example.com` for its subdomains. */
  allowedHosts?: readonly string[];
}

export interface ValidatedUrl {
  /** The address in its canonical form, without a fragment. */
  href: string;
  protocol: 'http:' | 'https:';
  /** Lower case, without a trailing dot; an IPv6 literal is without brackets. */
  hostname: string;
  port: number;
  /** The path and query, as sent on the request line. */
  path: string;
  /** The host is an IP address written out, not a name to look up. */
  ipLiteral: boolean;
}

/** Names that exist only inside a network, or that no public name server answers for. */
const INTERNAL_SUFFIXES = [
  'localhost',
  'local',
  'internal',
  'lan',
  'localdomain',
  'intranet',
  'corp',
  'home',
  'private',
  'home.arpa',
];

const internalName = (host: string): boolean =>
  INTERNAL_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));

const onAllowedList = (host: string, list: readonly string[]): boolean =>
  list.some((entry) => (entry.startsWith('*.') ? host.endsWith(entry.slice(1)) : host === entry));

function hasSpaceOrControl(text: string): boolean {
  return [...text].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
  });
}

/**
 * Checks an address before anything is looked up or connected to. It decides on the address as it
 * is written, so that an odd way of writing an IP address (decimal, octal, hexadecimal, short) is
 * refused rather than quietly read as the address it stands for.
 */
export function validateUrl(input: string, policy: UrlPolicy = {}): ValidatedUrl {
  const text = typeof input === 'string' ? input.trim() : '';
  if (!text) throw new UrlFailure('invalid', 'The address is empty.');
  if (text.length > MAX_URL_LENGTH) {
    throw new UrlFailure('invalid', `The address is longer than ${MAX_URL_LENGTH} characters.`);
  }
  if (hasSpaceOrControl(text)) {
    throw new UrlFailure('invalid', 'The address contains a space or a control character.');
  }
  const authority = /^https?:\/\/([^/?#\\]*)/iu.exec(text)?.[1];
  if (authority === undefined) {
    throw new UrlFailure('invalid', 'Only http and https addresses are read.');
  }
  if (authority.includes('@')) {
    throw new UrlFailure('invalid', 'An address with a user name or password is not read.');
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new UrlFailure('invalid', 'The address is not valid.');
  }
  if (url.username || url.password || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    throw new UrlFailure('invalid', 'The address is not valid.');
  }
  const protocol = url.protocol;

  const written = (
    authority.startsWith('[') ? authority.replace(/\]:\d*$/u, ']') : authority.replace(/:\d*$/u, '')
  ).toLowerCase();
  const bracketed = url.hostname.startsWith('[');
  const host = bracketed ? url.hostname.slice(1, -1) : url.hostname.replace(/\.$/u, '');
  const ipLiteral = bracketed || isIPv4(url.hostname);
  if (!host) throw new UrlFailure('invalid', 'The address has no host.');

  if (ipLiteral) {
    // The URL parser turns 2130706433, 0x7f.1 and 0177.0.0.1 into 127.0.0.1; only that spelling is accepted.
    if (!bracketed && written !== url.hostname) {
      throw new UrlFailure('blocked', 'An IP address written in an unusual form is not read.');
    }
    if (bracketed && !isIPv6(host)) throw new UrlFailure('invalid', 'The address is not valid.');
  } else {
    if (host.length > 253 || host.split('.').some((label) => label.length > 63)) {
      throw new UrlFailure('invalid', 'The host name is too long.');
    }
    if (!host.includes('.')) {
      throw new UrlFailure('blocked', 'A name with a single label is a local name.');
    }
    if (internalName(host)) {
      throw new UrlFailure('blocked', 'A local or internal name is not read.');
    }
  }
  if (policy.allowedHosts?.length && !onAllowedList(host, policy.allowedHosts)) {
    throw new UrlFailure('blocked', 'This host is not on the list of hosts that may be read.');
  }

  const port = url.port ? Number(url.port) : protocol === 'https:' ? 443 : 80;
  const ports = new Set(policy.allowedPorts ?? DEFAULT_ALLOWED_PORTS);
  if (!ports.has(port)) throw new UrlFailure('port', `Port ${port} is not one that may be read.`);

  url.hash = '';
  if (url.href.length > MAX_URL_LENGTH) {
    throw new UrlFailure('invalid', `The address is longer than ${MAX_URL_LENGTH} characters.`);
  }
  return {
    href: url.href,
    protocol,
    hostname: host,
    port,
    path: `${url.pathname}${url.search}`,
    ipLiteral,
  };
}
