const MAX_LINES = 10_000;
const MAX_RULES = 2_000;
const MAX_PATTERN_LENGTH = 1_000;

const MAX_CRAWL_DELAY_SECONDS = 86_400;

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
  let rules = 0;
  for (const raw of text.split(/\r\n|\n|\r/u).slice(0, MAX_LINES)) {
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
      if (current && value && value.length <= MAX_PATTERN_LENGTH && rules < MAX_RULES) {
        current.rules.push({ allow: key === 'allow', pattern: normalize(value) });
        rules += 1;
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

/**
 * Reads a robots.txt as RFC 9309 describes it, for the crawler named by `productToken`: the groups
 * that name it are used, otherwise the `*` groups, otherwise anything is allowed. Of the rules that
 * match, the longest pattern decides, and Allow wins a tie. A `Crawl-delay`, which the RFC leaves out
 * but many sites send, is read from the first of those groups that has one.
 */
export function parseRobots(text: string, productToken: string): Robots {
  const groups = parseGroups(text);
  const token = productToken.toLowerCase();
  const named = groups.filter((group) => group.agents.includes(token));
  const chosen = named.length ? named : groups.filter((group) => group.agents.includes('*'));
  const rules = chosen.flatMap((group) => group.rules);
  const delays = chosen.flatMap((group) =>
    group.crawlDelay === undefined ? [] : [group.crawlDelay],
  );
  return {
    crawlDelaySeconds: delays[0] ?? null,
    allows(pathAndQuery: string): boolean {
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
    },
  };
}
