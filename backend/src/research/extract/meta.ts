import { inline } from '../../ingest/url/text.js';
import { inspectText } from '../../models/injection.js';
import type { HeadFacts } from './read.js';
import type { Structured } from './structured.js';
import type { RobotsMeta } from './types.js';

/** The product token a page may address in a robots meta tag, as the crawler's robots.txt token. */
const OWN_TOKEN = 'swarmlab-researchcrawler';

const PUBLISHED_NAMES: ReadonlySet<string> = new Set([
  'article:published_time',
  'og:published_time',
  'datepublished',
  'date',
  'dc.date',
  'dc.date.issued',
  'dc.date.created',
  'dcterms.date',
  'dcterms.issued',
  'dcterms.created',
  'citation_publication_date',
  'citation_date',
  'citation_online_date',
  'publish_date',
  'publication_date',
  'pubdate',
  'parsely-pub-date',
  'sailthru.date',
]);
const MODIFIED_NAMES: ReadonlySet<string> = new Set([
  'article:modified_time',
  'og:updated_time',
  'datemodified',
  'last-modified',
  'dcterms.modified',
  'dc.date.modified',
  'revised',
  'modified',
]);
const PUBLISHED_CLASSES = [
  'published',
  'publish-date',
  'entry-date',
  'post-date',
  'posted-on',
  'dateline',
  'pubdate',
];
const MODIFIED_CLASSES = ['updated', 'modified', 'last-updated', 'last-modified'];
const OPEN_GRAPH_KEYS: readonly string[] = [
  'og:title',
  'og:description',
  'og:type',
  'og:site_name',
  'og:locale',
  'og:url',
  'article:published_time',
  'article:modified_time',
  'article:author',
  'article:section',
];

export interface Facts {
  title: string | null;
  description: string | null;
  language: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
  author: string | null;
  openGraph: Record<string, string>;
  canonicalUrl: string | null;
  robotsMeta: RobotsMeta;
  citationMeta: boolean;
  /** What the page said about itself that was left out because it reads like an instruction to an AI. */
  flaggedFacts: string[];
  warnings: string[];
}

export interface FactsInput {
  head: HeadFacts;
  structured: Structured;
  headline: string | null;
  headers: Readonly<Record<string, string>>;
  url: string;
  fetchedAt: number | undefined;
  sameSite: ((address: string) => boolean) | undefined;
}

/** A short piece of text a page gives about itself, or null when it is empty or reads like an instruction to an AI. */
function clean(raw: string | null | undefined, max: number, flagged: Set<string>): string | null {
  const text = inline(raw ?? '').slice(0, max);
  if (!text) return null;
  if (inspectText(text).suspicious) {
    flagged.add(text);
    return null;
  }
  return text;
}

/** `YYYY-MM-DD` from the date a page gives, when it is a real date that is not in the future of the fetch. */
export function normalizeDate(raw: string | null | undefined, fetchedAt?: number): string | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  let year: number;
  let month: number;
  let day: number;
  const iso =
    /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/u.exec(text) ??
    /^(\d{4})(\d{2})(\d{2})(?:$|T)/u.exec(text);
  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else {
    const parsed = Date.parse(text);
    if (!Number.isFinite(parsed)) return null;
    const date = new Date(parsed);
    [year, month, day] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
  }
  const built = new Date(Date.UTC(year, month - 1, day));
  if (
    built.getUTCFullYear() !== year ||
    built.getUTCMonth() !== month - 1 ||
    built.getUTCDate() !== day
  ) {
    return null;
  }
  if (year < 1990) return null;
  if (fetchedAt !== undefined && built.getTime() > fetchedAt + 2 * 86_400_000) return null;
  return built.toISOString().slice(0, 10);
}

function language(raw: string | null | undefined): string | null {
  const first = (raw ?? '').split(',')[0]?.trim().replace(/_/gu, '-') ?? '';
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/u.test(first) ? first : null;
}

const DIRECTIVES: ReadonlySet<string> = new Set([
  'all',
  'none',
  'noindex',
  'nofollow',
  'noarchive',
  'nosnippet',
  'notranslate',
  'noimageindex',
  'noai',
  'noml',
  'unavailable_after',
  'indexifembedded',
  'max-snippet',
  'max-image-preview',
  'max-video-preview',
]);

export function robotsOf(head: Pick<HeadFacts, 'metas'>, header: string | undefined): RobotsMeta {
  const words: string[] = [];
  for (const meta of head.metas) {
    if (meta.key === 'robots' || meta.key === OWN_TOKEN) words.push(...meta.content.split(','));
  }
  // "googlebot: noindex, nofollow" speaks to one crawler for as long as no other is named; what has no
  // crawler before it, or this one's name, speaks to this one.
  let agent = '';
  for (const entry of (header ?? '').split(',')) {
    let word = entry.trim().toLowerCase();
    const colon = word.indexOf(':');
    const before = colon > 0 ? word.slice(0, colon).trim() : '';
    if (before && !DIRECTIVES.has(before) && /^[a-z0-9_-]+$/u.test(before)) {
      agent = before;
      word = word.slice(colon + 1).trim();
    }
    if (word && (agent === '' || agent === OWN_TOKEN)) words.push(word);
  }
  const directives = [
    ...new Set(
      words
        .map((word) => word.trim().toLowerCase())
        .filter((word) => /^[a-z_-]{2,30}$/u.test(word)),
    ),
  ].sort();
  const has = (word: string): boolean => directives.includes(word);
  return {
    noindex: has('noindex') || has('none'),
    nofollow: has('nofollow') || has('none'),
    noarchive: has('noarchive'),
    noai: has('noai') || has('noml'),
    directives,
  };
}

function resolveCanonical(
  raw: string | null,
  url: string,
  sameSite: FactsInput['sameSite'],
): string | null {
  if (!raw) return null;
  try {
    const target = new URL(raw.trim(), url);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return null;
    if (target.username || target.password || target.href.length > 2_048) return null;
    target.hash = '';
    const same = sameSite ? sameSite(target.href) : target.hostname === new URL(url).hostname;
    return same ? target.href : null;
  } catch {
    return null;
  }
}

/**
 * What a page says about itself: its title, language, dates, author, canonical address and what it
 * asks of robots. Each is read from the page's own markup, and none is guessed: an author is named
 * only where the page names one, in structured data, a meta tag or `rel=author`, and never from a byline.
 * Text that reads like an instruction to an AI is not kept as a fact about the page.
 */
export function readFacts(input: FactsInput): Facts {
  const { head, structured, headers } = input;
  // Each text once, however many of the page's tags said it.
  const flagged = new Set<string>();
  const meta = (key: string): string | null =>
    head.metas.find((entry) => entry.key === key)?.content ?? null;
  const metaIn = (keys: ReadonlySet<string>): string | null =>
    head.metas.find((entry) => keys.has(entry.key))?.content ?? null;

  const title = clean(head.title ?? meta('og:title') ?? input.headline, 300, flagged);
  const description = clean(meta('description') ?? meta('og:description'), 600, flagged);

  const openGraph: Record<string, string> = {};
  for (const key of OPEN_GRAPH_KEYS) {
    const value = clean(head.metas.find((entry) => entry.key === key)?.content, 300, flagged);
    if (value) openGraph[key] = value;
  }

  // A `time` the page marks as its date of publication, or the only `time` in its text.
  const marked = (words: readonly string[], property: string): string | null =>
    head.times.find(
      (time) => time.itemprop === property || time.classes.some((name) => words.includes(name)),
    )?.datetime ?? null;
  const unmarked = head.times.length === 1 ? (head.times[0]?.datetime ?? null) : null;
  const date = (...candidates: (string | null)[]): string | null => {
    for (const candidate of candidates) {
      const day = normalizeDate(candidate, input.fetchedAt);
      if (day) return day;
    }
    return null;
  };
  const publishedAt = date(
    structured.datePublished,
    metaIn(PUBLISHED_NAMES),
    marked(PUBLISHED_CLASSES, 'datepublished'),
    unmarked,
  );
  const updatedAt = date(
    structured.dateModified,
    metaIn(MODIFIED_NAMES),
    marked(MODIFIED_CLASSES, 'datemodified'),
  );

  const named = structured.authors.join(', ');
  const profile = (value: string | null): string | null =>
    value && !/^https?:/iu.test(value.trim()) ? value : null;
  const author = clean(
    named || meta('author') || head.authorLinks.find(Boolean) || profile(meta('article:author')),
    160,
    flagged,
  );

  const warnings: string[] = [];
  if (flagged.size > 0) {
    warnings.push(
      'A title, description or author that read like an instruction to an AI was not kept.',
    );
  }
  const canonicalUrl = resolveCanonical(head.canonical, input.url, input.sameSite);
  if (head.canonical && !canonicalUrl) {
    warnings.push(
      'The page names a canonical address that is not valid or is on another site; it is ignored.',
    );
  }
  return {
    title,
    description,
    language:
      language(head.lang) ??
      language(meta('og:locale')) ??
      language(structured.language) ??
      language(headers['content-language']),
    publishedAt,
    updatedAt,
    author,
    openGraph,
    canonicalUrl,
    robotsMeta: robotsOf(head, headers['x-robots-tag']),
    citationMeta: head.metas.some((entry) => entry.key.startsWith('citation_')),
    flaggedFacts: [...flagged],
    warnings,
  };
}
