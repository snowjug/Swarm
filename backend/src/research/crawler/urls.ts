import { parse } from 'tldts';

/**
 * Addresses, as the crawler tells them apart: which site one belongs to, what it is called when two
 * spellings are the same page, and which look like places that lead nowhere new.
 */

const TRACKING: RegExp =
  /^(?:utm_.*|fbclid|gclid|gclsrc|dclid|msclkid|mc_cid|mc_eid|igshid|yclid|twclid|ttclid|li_fat_id|_hsenc|_hsmi|__hstc|__hssc|__hsfp|hsctatracking|mkt_tok|vero_id|ref_src|ref_url|spm|s_cid|cmpid|_ga|_gl|wickedid|oly_enc_id|oly_anon_id|epik|ocid|icid|_openstat)$/iu;
// A session in the address makes every link a new address for the same page.
const SESSION: RegExp =
  /^(?:phpsessid|jsessionid|sessionid|session_id|sessid|aspsessionid.*|cfid|cftoken|zenid|oscsid)$/iu;
const PATH_SESSION = /;(?:jsessionid|sessionid|phpsessid)=[^/?#;]*/giu;

export const isTracking = (name: string): boolean => TRACKING.test(name);

/** The registrable domain of a host, so that `docs.example.co.uk` and `www.example.co.uk` are one site and two tenants of a shared host are two. */
export function registrableDomain(host: string): string {
  const name = host
    .replace(/^\[|\]$/gu, '')
    .replace(/\.$/u, '')
    .toLowerCase();
  const found = parse(name, { allowPrivateDomains: true });
  return found.domain ?? name;
}

export const siteOf = (address: string): string | null => {
  try {
    return registrableDomain(new URL(address).hostname);
  } catch {
    return null;
  }
};

export const sameSite = (a: string, b: string): boolean => {
  const first = siteOf(a);
  return first !== null && first === siteOf(b);
};

function withoutNoise(url: URL): URLSearchParams {
  const kept = new URLSearchParams();
  for (const [name, value] of url.searchParams) {
    if (!TRACKING.test(name) && !SESSION.test(name)) kept.append(name, value);
  }
  return kept;
}

/**
 * The address to fetch for a link: no fragment, no tracking or session parameters, a lower-case host
 * and no default port. Everything else is as the page wrote it.
 */
export function cleanAddress(address: string): string | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  url.pathname = url.pathname.replace(PATH_SESSION, '');
  const kept = withoutNoise(url);
  // Keep the page's own order and spelling of what is left.
  const noisy = [...url.searchParams.keys()].some(
    (name) => TRACKING.test(name) || SESSION.test(name),
  );
  if (noisy) url.search = kept.toString();
  return url.href;
}

/** `%7E` is `~`, and the other escapes are in capitals, so that two spellings of one path are one. */
function unescaped(path: string): string {
  return path.replace(/%[0-9a-f]{2}/giu, (escape) => {
    const character = String.fromCharCode(Number.parseInt(escape.slice(1), 16));
    return /[A-Za-z0-9\-._~]/u.test(character) ? character : escape.toUpperCase();
  });
}

/**
 * What an address is called when two spellings are the same page: no scheme, no fragment, no tracking
 * or session parameters, the remaining parameters in order, no trailing slash, no `index.html`, one
 * slash at a time. http and https of one address are one page.
 */
export function dedupeKey(address: string): string {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return address.toLowerCase().slice(0, 2_048);
  }
  const defaultPort = url.protocol === 'https:' ? '443' : '80';
  const port = url.port && url.port !== defaultPort ? `:${url.port}` : '';
  let path = unescaped(url.pathname.replace(PATH_SESSION, '').replace(/\/{2,}/gu, '/'));
  path = path.replace(/\/(?:index|default)\.(?:html?|php|aspx?)$/iu, '/');
  if (path.length > 1) path = path.replace(/\/+$/u, '');
  const entries = [...withoutNoise(url)].sort(([a, x], [b, y]) =>
    a === b ? x.localeCompare(y) : a.localeCompare(b),
  );
  const query = new URLSearchParams(entries).toString();
  return `${url.hostname.replace(/\.$/u, '')}${port}${path}${query ? `?${query}` : ''}`;
}

export interface Trap {
  /** Not worth fetching at all. */
  skip: boolean;
  /** How much less it is worth when it is not skipped. */
  penalty: number;
  /** A fixed word for why, for counting. */
  reason: string | null;
}

const NOT_A_TRAP: Trap = { skip: false, penalty: 0, reason: null };

const SKIPPED_FILES =
  /\.(?:jpe?g|png|gif|webp|svg|ico|bmp|tiff?|avif|heic|mp3|mp4|m4a|m4v|mov|avi|wmv|flv|webm|mkv|ogg|wav|zip|tar|gz|tgz|bz2|7z|rar|xz|exe|msi|dmg|pkg|deb|rpm|apk|iso|bin|dll|docx?|xlsx?|pptx?|odt|ods|odp|woff2?|ttf|otf|eot|css|js|map|xml|swf|torrent|ics)$/iu;
const PDF = /\.pdf$/iu;
const ACCOUNT =
  /(?:^|\/)(?:log-?in|log-?out|sign-?in|sign-?out|sign-?up|register|registration|account|my-account|checkout|cart|basket|bag|wishlist|orders?|subscribe|unsubscribe|wp-admin|wp-login\.php|wp-json|xmlrpc\.php|cdn-cgi)(?:\/|$|\.)/iu;
const FEED = /(?:^|\/)(?:feed|feeds|rss|atom)(?:\/|\.|$)|\.(?:rss|atom)$/iu;
const SEARCH = /(?:^|\/)search(?:\/|$)/iu;
const SEARCH_QUERY = /(?:^|[?&])(?:s|q|query|search|keyword|keywords|term|terms)=/iu;
const SHARE =
  /(?:^|\/)(?:share|sharer|print|email|mailto)(?:\/|\?|$|\.)|[?&](?:share|print|replytocom|feed)(?:=|&|$)|[?&]format=rss/iu;
// A listing by date that ends at the date, not a post whose address begins with one.
const CALENDAR =
  /(?:^|\/)calendar(?:\/|$)|(?:^|\/)\d{4}\/\d{1,2}(?:\/\d{1,2})?\/?$|[?&](?:month|year|date|day|ical|eventdate|tribe-bar-date)=/iu;
const PAGING = /(?:[?&](?:page|paged|pg|pagenum)=(\d+))|(?:\/page\/(\d+)(?:\/|$))/iu;
const FILTERING =
  /[?&](?:sort|order|orderby|filter|filters|view|layout|display|limit|per_page|perpage|size|dir)=/iu;
const ARCHIVES =
  /(?:^|\/)(?:tag|tags|category|categories|archive|archives|author|authors|user|users|profile|profiles|members?)(?:\/|$)/iu;

function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Whether an address looks like a place a crawler gets lost in: a login or a basket, a feed, a search
 * result, a calendar that goes on for ever, page after page of a listing, a path that repeats itself,
 * or a file that is not a page. This is judged from the address alone, and it is a guess.
 */
export function trapOf(address: string, readsPdf = false): Trap {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return { skip: true, penalty: 0, reason: 'invalid' };
  }
  const path = decoded(url.pathname).toLowerCase();
  const query = url.search.toLowerCase();
  const whole = `${path}${query}`;
  if (SKIPPED_FILES.test(path)) return { skip: true, penalty: 0, reason: 'file-type' };
  if (PDF.test(path) && !readsPdf) return { skip: true, penalty: 0, reason: 'file-type' };
  if (ACCOUNT.test(path)) return { skip: true, penalty: 0, reason: 'account-or-basket' };
  if (FEED.test(path) || SHARE.test(whole))
    return { skip: true, penalty: 0, reason: 'feed-or-share' };
  if (SEARCH.test(path) || SEARCH_QUERY.test(query))
    return { skip: true, penalty: 0, reason: 'search' };
  if (CALENDAR.test(whole)) return { skip: true, penalty: 0, reason: 'calendar' };

  const segments = path.split('/').filter(Boolean);
  const counts = new Map<string, number>();
  for (const segment of segments) counts.set(segment, (counts.get(segment) ?? 0) + 1);
  const repeated = [...counts.values()].some((count) => count >= 3);
  const half = segments.length / 2;
  const doubled =
    segments.length >= 4 &&
    Number.isInteger(half) &&
    segments.slice(0, half).join('/') === segments.slice(half).join('/');
  if (repeated || doubled) return { skip: true, penalty: 0, reason: 'repeating-path' };
  if (segments.length > 12 || url.href.length > 400)
    return { skip: true, penalty: 0, reason: 'long-path' };

  let penalty = 0;
  let reason: string | null = null;
  const note = (amount: number, why: string): void => {
    penalty += amount;
    reason ??= why;
  };
  const paging = PAGING.exec(whole);
  if (paging) {
    const page = Number(paging[1] ?? paging[2] ?? '1');
    // The first page of a listing is a page; the tenth is a trap.
    if (page > 5) return { skip: true, penalty: 0, reason: 'paging' };
    if (page > 1) note(0.25, 'paging');
  }
  if (FILTERING.test(query)) note(0.2, 'filtering');
  if (ARCHIVES.test(path)) note(0.15, 'archive');
  if ([...url.searchParams.keys()].length > 4) note(0.2, 'many-parameters');
  if (segments.length > 7) note(0.1, 'deep-path');
  return penalty === 0 ? NOT_A_TRAP : { skip: false, penalty, reason };
}
