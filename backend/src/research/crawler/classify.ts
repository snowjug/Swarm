import { parse } from 'tldts';
import type { AuthorityEstimate, SourceCategory } from '../../../../shared/research.js';
import {
  COMMUNITY_DOMAINS,
  DISCUSSION_TYPES,
  INTERGOVERNMENTAL_DOMAINS,
  onList,
  PREPRINT_DOMAINS,
  PUBLISHER_DOMAINS,
  REPORTING_DOMAINS,
  SCHOLARLY_TYPES,
} from './reputable-domains.js';

/** Why a source was put in its category, as a fixed word, for counting and for tests. */
export type ClassificationBasis =
  | 'discussion-markup'
  | 'community-site'
  | 'forum-address'
  | 'research-publisher'
  | 'preprint-server'
  | 'government-domain'
  | 'intergovernmental-body'
  | 'regulator-name'
  | 'university-domain'
  | 'documentation-host'
  | 'documentation-path'
  | 'official-statement'
  | 'named-site'
  | 'reporting-list'
  | 'scholarly-markup'
  | 'none';

export interface Classification {
  category: SourceCategory;
  /**
   * An estimate from the kind of site, never a verdict on whether a page is right: a government page
   * can be out of date, and a forum post can be correct. It is the least a reader should know about
   * where a page came from.
   */
  authority: AuthorityEstimate;
  basis: ClassificationBasis;
}

export interface ClassifyContext {
  /** The registrable domains of the sites a person named, or added. */
  namedDomains: ReadonlySet<string>;
}

/** What the page's own markup says about it, when the page has been read. It can lower a page, and only lower it. */
export interface PageMarkup {
  schemaTypes: readonly string[];
  citationMeta: boolean;
}

const GOVERNMENT_SUFFIX_LABELS: ReadonlySet<string> = new Set([
  'gov',
  'gouv',
  'gob',
  'go',
  'govt',
  'gc',
  'gv',
  'mil',
]);
const GOVERNMENT_SUFFIXES: ReadonlySet<string> = new Set(['gov', 'mil', 'int']);
const REGULATOR_WORDS: ReadonlySet<string> = new Set([
  'regulator',
  'regulatory',
  'authority',
  'commission',
  'ministry',
  'ombudsman',
  'parliament',
  'legislature',
]);
const FORUM_SUBDOMAINS: ReadonlySet<string> = new Set([
  'forum',
  'forums',
  'community',
  'discuss',
  'discourse',
  'answers',
  'ask',
  'questions',
  'groups',
  'chat',
  'board',
  'bbs',
]);
const FORUM_SEGMENTS: ReadonlySet<string> = new Set([
  'forum',
  'forums',
  'community',
  'discussion',
  'discussions',
  'thread',
  'threads',
  'question',
  'questions',
  'answers',
  'comments',
]);
const DOCUMENTATION_SUBDOMAINS: ReadonlySet<string> = new Set([
  'docs',
  'doc',
  'documentation',
  'developer',
  'developers',
  'learn',
  'support',
  'help',
  'kb',
  'manual',
  'manuals',
  'reference',
]);
const DOCUMENTATION_SEGMENTS: ReadonlySet<string> = new Set([
  'docs',
  'doc',
  'documentation',
  'developer',
  'developers',
  'help',
  'support',
  'manual',
  'manuals',
  'reference',
  'learn',
  'kb',
]);
const STATEMENT_SUBDOMAINS: ReadonlySet<string> = new Set([
  'newsroom',
  'press',
  'media',
  'ir',
  'investors',
  'investor',
  'blog',
  'news',
]);
const STATEMENT_SEGMENTS: ReadonlySet<string> = new Set([
  'newsroom',
  'news-room',
  'press',
  'press-releases',
  'press-release',
  'pressroom',
  'media',
  'announcements',
  'announcement',
  'statements',
  'statement',
  'blog',
  'blogs',
  'news',
  'updates',
  'releases',
]);
// Where a site speaks as itself, as opposed to where it writes about this and that.
const FIRM_STATEMENTS: ReadonlySet<string> = new Set([
  'newsroom',
  'news-room',
  'press',
  'press-releases',
  'press-release',
  'pressroom',
  'announcements',
  'announcement',
  'statements',
  'statement',
  'ir',
  'investors',
  'investor',
]);

const answer = (
  category: SourceCategory,
  authority: AuthorityEstimate,
  basis: ClassificationBasis,
): Classification => ({ category, authority, basis });

const NONE = answer('unclassified', 'unknown', 'none');

/**
 * What kind of source a page is, judged from the address (its site, its subdomain, its first path
 * segments) and, once the page has been read, from what its markup says about itself. It is
 * deterministic and an ESTIMATE: it is for ranking what to read and for telling a reader what kind of
 * source they are looking at, and says nothing about whether the page is right.
 */
export function classifySource(
  address: string,
  context: ClassifyContext,
  markup?: PageMarkup,
): Classification {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return NONE;
  }
  const host = url.hostname.replace(/\.$/u, '').toLowerCase();
  const found = parse(host, { allowPrivateDomains: true });
  const domain = found.domain ?? host;
  const subdomain = (found.subdomain ?? '').split('.')[0] ?? '';
  const suffix = found.publicSuffix ?? '';
  const segments = url.pathname.toLowerCase().split('/').filter(Boolean).slice(0, 2);
  const named = context.namedDomains.has(domain);
  const labels = host.split(/[.-]/u);

  // Where the words are anyone's comes first, whatever the site: a forum on a university's server is still a forum.
  if (markup?.schemaTypes.some((type) => DISCUSSION_TYPES.includes(type))) {
    return answer('community', 'low', 'discussion-markup');
  }
  if (onList(host, COMMUNITY_DOMAINS)) return answer('community', 'low', 'community-site');
  if (FORUM_SUBDOMAINS.has(subdomain) || segments.some((segment) => FORUM_SEGMENTS.has(segment))) {
    return answer('community', 'low', 'forum-address');
  }

  if (onList(host, PUBLISHER_DOMAINS))
    return answer('research-publication', 'high', 'research-publisher');
  if (onList(host, PREPRINT_DOMAINS))
    return answer('research-publication', 'medium', 'preprint-server');
  const lead = suffix.split('.');
  if (
    GOVERNMENT_SUFFIXES.has(suffix) ||
    (lead.length > 1 && GOVERNMENT_SUFFIX_LABELS.has(lead[0] ?? ''))
  ) {
    return answer('government-regulatory', 'high', 'government-domain');
  }
  if (onList(host, INTERGOVERNMENTAL_DOMAINS)) {
    return answer('government-regulatory', 'high', 'intergovernmental-body');
  }
  if (labels.some((label) => REGULATOR_WORDS.has(label))) {
    // A name anyone can register is not a verdict: it is a hint, so the estimate is lower than for a domain only a government can hold.
    return answer('government-regulatory', 'medium', 'regulator-name');
  }
  if (suffix === 'edu' || (lead.length > 1 && (lead[0] === 'ac' || lead[0] === 'edu'))) {
    return answer('research-publication', 'medium', 'university-domain');
  }

  if (DOCUMENTATION_SUBDOMAINS.has(subdomain)) {
    return answer('official-documentation', named ? 'high' : 'medium', 'documentation-host');
  }
  if (segments.some((segment) => DOCUMENTATION_SEGMENTS.has(segment))) {
    return answer('official-documentation', named ? 'high' : 'medium', 'documentation-path');
  }
  if (named) {
    const statement =
      STATEMENT_SUBDOMAINS.has(subdomain) ||
      segments.some((segment) => STATEMENT_SEGMENTS.has(segment));
    if (statement) {
      const firm =
        FIRM_STATEMENTS.has(subdomain) || segments.some((segment) => FIRM_STATEMENTS.has(segment));
      return answer('official-statement', firm ? 'high' : 'medium', 'official-statement');
    }
    return answer('primary', 'high', 'named-site');
  }
  if (onList(host, REPORTING_DOMAINS))
    return answer('credible-reporting', 'medium', 'reporting-list');
  // A page can say it is scholarly, and so can anyone: it is the kind of page, and not a reason to trust it.
  if (
    markup &&
    (markup.citationMeta || markup.schemaTypes.some((type) => SCHOLARLY_TYPES.includes(type)))
  ) {
    return answer('research-publication', 'low', 'scholarly-markup');
  }
  return NONE;
}
