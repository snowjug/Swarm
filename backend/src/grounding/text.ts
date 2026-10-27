import { tokenize } from '../knowledge/retrieval.js';

const SINGLE_QUOTES = /[\u2018\u2019\u201a\u201b\u2032`]/gu;
const DOUBLE_QUOTES = /[\u201c\u201d\u201e\u201f\u2033]/gu;
const DASHES = /[\u2010-\u2015\u2212]/gu;
const ELLIPSES = /\u2026|\.{3,}/gu;
const EMPHASIS = /[*~]+/gu;

/** A quote must be long enough that a match is meaningful and not an accident of common words. */
export const MIN_QUOTE_CHARS = 12;
const MIN_FRAGMENT_CHARS = 8;

/**
 * Canonical form for comparing text that was copied or quoted: Unicode-normalised, typographic
 * quotes, dashes and ellipses made plain, markdown emphasis dropped, whitespace collapsed, lower
 * case. Both sides of every comparison go through this, so cosmetic differences never matter.
 */
export function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(DASHES, '-')
    .replace(ELLIPSES, ' … ')
    .replace(EMPHASIS, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

export interface QuoteMatch {
  found: boolean;
  /** The passage that contains every fragment of the quote, in order. */
  passageId: string | null;
}

/**
 * Whether `quote` appears verbatim in one passage. An ellipsis marks an omission, so the fragments
 * on either side must each appear, in order, in the same passage. Very short fragments never match.
 */
export function findQuote(quote: string, passages: ReadonlyMap<string, string>): QuoteMatch {
  const normalized = normalizeText(quote);
  const fragments = normalized
    .split('…')
    .map((fragment) => fragment.trim())
    .filter(Boolean);
  const longEnough =
    normalized.replaceAll('…', '').trim().length >= MIN_QUOTE_CHARS &&
    fragments.length > 0 &&
    fragments.every((fragment) => fragment.length >= MIN_FRAGMENT_CHARS);
  if (!longEnough) return { found: false, passageId: null };
  for (const [id, text] of passages) {
    const haystack = normalizeText(text);
    let from = 0;
    let all = true;
    for (const fragment of fragments) {
      const index = haystack.indexOf(fragment, from);
      if (index < 0) {
        all = false;
        break;
      }
      from = index + fragment.length;
    }
    if (all) return { found: true, passageId: id };
  }
  return { found: false, passageId: null };
}

/** Numbers as comparable strings: "1,200" -> "1200", "40%" -> "40", "$3.50" -> "3.5". */
export function numbersIn(text: string): string[] {
  const found = text.normalize('NFKC').match(/\d[\d,]*(?:\.\d+)?/gu) ?? [];
  const cleaned = found.map((token) => {
    const plain = token.replaceAll(',', '');
    return plain.includes('.') ? plain.replace(/0+$/u, '').replace(/\.$/u, '') : plain;
  });
  return [...new Set(cleaned.map((token) => token.replace(/^0+(?=\d)/u, '')))];
}

/** Share of the claim's content words that also occur in `material`, 0..1 (1 when it has none). */
export function wordOverlap(claim: string, material: string): number {
  const words = [...new Set(tokenize(claim))];
  if (!words.length) return 1;
  const available = new Set(tokenize(material));
  return words.filter((word) => available.has(word)).length / words.length;
}
