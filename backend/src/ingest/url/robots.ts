/**
 * RFC 9309 asks a crawler to read at least 500 KiB of a robots.txt. This is what is read, and it is the
 * only limit there is: how many lines, how many rules and how long a pattern are whatever fit in it. A
 * rule that is left out for being the 2,001st, or for being long, is a rule that is not obeyed and that
 * nobody is told of, so none is. What is past the limit cannot be read, and so cannot be obeyed either:
 * a robots.txt that is longer forbids everything (see `parseRobots` and the fetcher).
 */
export const ROBOTS_MAX_BYTES = 512_000;

const MAX_CRAWL_DELAY_SECONDS = 86_400;
// How many answers a parsed robots.txt keeps, so that a crawl that asks about many addresses does not grow it without bound.
const MAX_REMEMBERED = 256;

export interface Robots {
  /** Whether the path and query (`/a/b?c=1`) may be fetched. */
  allows(pathAndQuery: string): boolean;
  /** Seconds the site asks to be left between requests (`Crawl-delay`, which RFC 9309 does not define), when it says. */
  readonly crawlDelaySeconds?: number | null;
}

interface Rule {
  allow: boolean;
  pattern: string;
}

interface Group {
  agents: string[];
  rules: Rule[];
  crawlDelay?: number;
}

/** So that %7e and ~ are the same, and a pattern written in UTF-8 matches the escaped path. */
function normalize(text: string): string {
  return text
    .replace(/[^\x20-\x7e]/gu, (character) => {
      try {
        return encodeURIComponent(character);
      } catch {
        return '%EF%BF%BD';
      }
    })
    .replace(/%[0-9a-f]{2}/giu, (escape) => {
      const character = String.fromCharCode(Number.parseInt(escape.slice(1), 16));
      return /[A-Za-z0-9\-._~]/u.test(character) ? character : escape.toUpperCase();
    });
}

/**
 * Whether a robots.txt path pattern (`*` matches any run, a final `$` anchors the end) matches the
 * start of a path. It scans left to right without backtracking into a regular expression, so a
 * hostile pattern such as `/*a*a*a*a*a*b` costs no more than its length times the path's.
 */
function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const parts = (anchored ? pattern.slice(0, -1) : pattern).split('*');
  const first = parts[0] ?? '';
  if (!path.startsWith(first)) return false;
  let position = first.length;
  for (let index = 1; index < parts.length; index += 1) {
    const part = parts[index] ?? '';
    if (anchored && index === parts.length - 1) {
      return path.length - part.length >= position && path.endsWith(part);
    }
    const found = path.indexOf(part, position);
    if (found < 0) return false;
    position = found + part.length;
  }
  return anchored ? position === path.length : true;
}

function parseGroups(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let collectingAgents = false;
  for (const raw of text.split(/\r\n|\n|\r/u)) {
    // A comment runs from the first `#` to the end of the line. Not `replace(/#.*$/u, '')`: that is
    // tried again from every `#` of a line that holds a Unicode line separator, which grows with the
    // square of the line.
    const unmarked = raw.replace(/^\uFEFF/u, '');
    const hash = unmarked.indexOf('#');
    const line = (hash < 0 ? unmarked : unmarked.slice(0, hash)).trim();
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'user-agent') {
      if (!current || !collectingAgents) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      collectingAgents = true;
    } else if (key === 'allow' || key === 'disallow') {
      collectingAgents = false;
      // A rule before any user-agent line belongs to no group, and an empty pattern matches nothing.
      if (current && value) {
        current.rules.push({ allow: key === 'allow', pattern: normalize(value) });
      }
    } else if (key === 'crawl-delay') {
      collectingAgents = false;
      const seconds = /^\d{1,6}(?:\.\d{1,3})?$/u.test(value) ? Number(value) : Number.NaN;
      if (current && current.crawlDelay === undefined && seconds <= MAX_CRAWL_DELAY_SECONDS) {
        current.crawlDelay = seconds;
      }
    }
  }
  return groups;
}

/** What a robots.txt that is longer than is read says: nothing may be fetched. It cannot be read in full, so it cannot be obeyed in full. */
const FORBIDS_EVERYTHING: Robots = { allows: () => false, crawlDelaySeconds: null };

/**
 * Reads a robots.txt as RFC 9309 describes it, for the crawler named by `productToken`: the groups
 * that name it are used, otherwise the `*` groups, otherwise anything is allowed. Of the rules that
 * match, the longest pattern decides, and Allow wins a tie. A `Crawl-delay`, which the RFC leaves out
 * but many sites send, is read from the first of those groups that has one. A text longer than
 * `ROBOTS_MAX_BYTES` is not read at all and forbids everything, rather than being read as far as it goes
 * and allowing what its end might have forbidden.
 */
export function parseRobots(text: string, productToken: string): Robots {
  if (text.length > ROBOTS_MAX_BYTES) return FORBIDS_EVERYTHING;
  const groups = parseGroups(text);
  const token = productToken.toLowerCase();
  const named = groups.filter((group) => group.agents.includes(token));
  const chosen = named.length ? named : groups.filter((group) => group.agents.includes('*'));
  const rules = chosen.flatMap((group) => group.rules);
  const delays = chosen.flatMap((group) =>
    group.crawlDelay === undefined ? [] : [group.crawlDelay],
  );
  // The same address is asked about more than once (before it is read, and when it is recorded), and the
  // largest robots.txt takes tens of milliseconds to go through.
  const asked = new Map<string, boolean>();
  const decide = (pathAndQuery: string): boolean => {
    const path = normalize(pathAndQuery);
    let best: Rule | null = null;
    for (const rule of rules) {
      if (!matches(rule.pattern, path)) continue;
      if (
        !best ||
        rule.pattern.length > best.pattern.length ||
        (rule.pattern.length === best.pattern.length && rule.allow && !best.allow)
      ) {
        best = rule;
      }
    }
    return best ? best.allow : true;
  };
  return {
    crawlDelaySeconds: delays[0] ?? null,
    allows(pathAndQuery: string): boolean {
      const known = asked.get(pathAndQuery);
      if (known !== undefined) return known;
      const answer = decide(pathAndQuery);
      if (asked.size < MAX_REMEMBERED) asked.set(pathAndQuery, answer);
      return answer;
    },
  };
}
