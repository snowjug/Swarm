import type { SourceCategory } from '../../../../shared/research.js';
import { classifySource, type ClassifyContext } from './classify.js';
import { registrableDomain, trapOf } from './urls.js';
import type { CrawlHints } from './types.js';

/** How much a kind of source is worth reading, before anything is known about the page: an estimate from the kind of site. */
export const PRIOR: Readonly<Record<SourceCategory, number>> = {
  primary: 0.2,
  'official-documentation': 0.26,
  'official-statement': 0.24,
  'government-regulatory': 0.28,
  'research-publication': 0.24,
  'credible-reporting': 0.14,
  'user-supplied': 0.3,
  community: -0.12,
  unclassified: 0,
};

const WEIGHT = {
  phraseInAnchor: 0.18,
  partInAnchor: 0.1,
  phraseInAddress: 0.14,
  partInAddress: 0.07,
  relevanceCap: 0.5,
  hintedCategory: 0.08,
  hintedSite: 0.12,
  /** With nothing to look for, every link is as relevant as another. */
  noTerms: 0.12,
  inMain: 0.04,
  shallow: 0.12,
} as const;

/** A named seed is read before anything found from it. */
export const SEED_BASE = 10;

export interface LinkInput {
  url: string;
  text: string;
  rel: readonly string[];
  inMain: boolean;
  depth: number;
}

export interface Scored {
  score: number;
  /** The words of the question that the link's address or text carries. */
  matched: string[];
}

/** A word as the scorer compares it: lower case, and without a plural `s`. */
const stem = (word: string): string =>
  word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;

const wordsOf = (text: string): string[] =>
  (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((word) => word.length >= 2).map(stem);

interface Term {
  label: string;
  words: string[];
  phrase: string;
}

const share = (words: readonly string[], among: ReadonlySet<string>): number =>
  words.length === 0 ? 0 : words.filter((word) => among.has(word)).length / words.length;

export interface Scorer {
  /** Null for a link that is not worth reading at all (a trap, or too little for it). */
  link(input: LinkInput): Scored | null;
  /** The score of an address that was named, which is always read. */
  seed(url: string, depth: number): Scored;
}

/**
 * Ranks what to read next, from the address and the words of a link alone: how much the kind of site
 * is worth, how much of the question the address and the words carry, how near the start it is, and how
 * much it looks like a place a crawler gets lost in. Every number here is a decision made once, in this
 * file, and none of it is made by a model.
 */
export function makeScorer(
  hints: CrawlHints,
  context: ClassifyContext,
  options: { minScore: number; readsPdf: boolean },
): Scorer {
  const terms: Term[] = hints.terms
    .map((label) => ({ label, words: wordsOf(label) }))
    .filter((term) => term.words.length > 0)
    .slice(0, 24)
    .map((term) => ({ ...term, phrase: term.words.join(' ') }));
  const categories = new Set(hints.categories ?? []);
  const sites = new Set((hints.domains ?? []).map((name) => registrableDomain(name)));

  const relevance = (url: URL, text: string): { value: number; matched: string[] } => {
    const anchor = wordsOf(text);
    const anchorSet = new Set(anchor);
    const addressWords = wordsOf(decodeURIComponentSafe(`${url.pathname} ${url.search}`));
    const addressSet = new Set(addressWords);
    const anchorPhrase = anchor.join(' ');
    const addressPhrase = addressWords.join(' ');
    let value = 0;
    const matched: string[] = [];
    for (const term of terms) {
      let found = 0;
      if (anchorPhrase.includes(term.phrase)) found += WEIGHT.phraseInAnchor;
      else found += share(term.words, anchorSet) * WEIGHT.partInAnchor;
      if (addressPhrase.includes(term.phrase)) found += WEIGHT.phraseInAddress;
      else found += share(term.words, addressSet) * WEIGHT.partInAddress;
      if (found > 0) matched.push(term.label);
      value += found;
    }
    return { value: Math.min(WEIGHT.relevanceCap, value), matched };
  };

  const prior = (address: string): number => {
    const found = classifySource(address, context);
    let value = PRIOR[found.category];
    if (categories.has(found.category)) value += WEIGHT.hintedCategory;
    if (sites.has(registrableDomain(new URL(address).hostname))) value += WEIGHT.hintedSite;
    return value;
  };

  return {
    link(input) {
      if (input.rel.some((word) => word === 'nofollow' || word === 'ugc' || word === 'sponsored')) {
        return null;
      }
      let url: URL;
      try {
        url = new URL(input.url);
      } catch {
        return null;
      }
      const trap = trapOf(input.url, options.readsPdf);
      if (trap.skip) return null;
      const found = relevance(url, input.text);
      // A link that carries nothing of the question is not read, however much the site it is on is worth.
      if (terms.length > 0 && found.matched.length === 0) return null;
      const score =
        prior(input.url) +
        (terms.length === 0 ? WEIGHT.noTerms : found.value) +
        WEIGHT.shallow / (1 + input.depth) +
        (input.inMain ? WEIGHT.inMain : 0) -
        trap.penalty;
      return score < options.minScore ? null : { score, matched: found.matched };
    },
    seed(url, depth) {
      let value = SEED_BASE;
      try {
        value += prior(url);
      } catch {
        // A seed that is not an address is refused later, with the others.
      }
      return { score: value - depth * 0.001, matched: [] };
    },
  };
}

function decodeURIComponentSafe(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
