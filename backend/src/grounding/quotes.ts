import type { ChapterClaim } from '../../../shared/grounding.js';
import { findQuote } from './text.js';
import { SOURCE_KINDS } from './verify.js';

/** The passages among `passages` that `ids` name; an unknown id is simply absent. */
export function citedPassages(
  ids: readonly string[],
  passages: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  const cited = new Map<string, string>();
  for (const id of ids) {
    const text = passages.get(id);
    if (text !== undefined) cited.set(id, text);
  }
  return cited;
}

/**
 * The longest leading part of a quote, cut at a word boundary, that appears verbatim in one of the
 * passages, or null when no start of at least the minimum length does. A model that stitches two
 * sentences that are not next to each other produces a quote whose first sentence is exact and whose
 * rest is not; that first sentence is still a true excerpt.
 */
export function verbatimStart(quote: string, cited: ReadonlyMap<string, string>): string | null {
  const ends = [...quote.matchAll(/\S+/gu)].map((word) => (word.index ?? 0) + word[0].length);
  // Longest first, and never the whole quote (the caller has already seen that it does not match).
  for (let index = ends.length - 2; index >= 0; index -= 1) {
    const end = ends[index];
    if (end === undefined) continue;
    const candidate = quote
      .slice(0, end)
      .replace(/[\s\u2026]+$/u, '')
      .trim();
    if (findQuote(candidate, cited).found) return candidate;
  }
  return null;
}

export interface NormalizedQuotes {
  claims: ChapterClaim[];
  /** Quotes cut back to the part that is verbatim in a cited passage. */
  shortened: number;
  /** Quotes dropped because no start of them is in a cited passage. */
  removed: number;
  /** Source facts left without a verbatim quote, now shown as extracted claims. */
  relabelled: number;
}

/**
 * Makes every quote on a source-backed statement either a true excerpt of a passage that statement
 * cites, or absent, and makes the "source fact" label mean what it says:
 *
 * - a quote that runs past the cited text is cut to its verbatim start;
 * - a quote with no verbatim start is dropped, because a paraphrase does not need one and is still
 *   judged against the cited passages;
 * - a source fact that has no verbatim quote left was a paraphrase all along, so it is shown as an
 *   extracted claim. The label promises a quote; it is never kept without one.
 *
 * Every change only removes or shortens a quote or weakens a label. None can add support: a verdict
 * comes from the cited passages and an independent check, never from the label. The caller discloses
 * how many there were. It is pure and idempotent.
 */
export function normalizeClaimQuotes(
  claims: readonly ChapterClaim[],
  passages: ReadonlyMap<string, string>,
): NormalizedQuotes {
  let shortened = 0;
  let removed = 0;
  let relabelled = 0;
  const result = claims.map((claim): ChapterClaim => {
    if (!SOURCE_KINDS.has(claim.kind)) return claim;
    let quote = claim.quote;
    if (quote !== null) {
      const cited = citedPassages(claim.sourceIds, passages);
      if (!findQuote(quote, cited).found) {
        const start = verbatimStart(quote, cited);
        if (start === null) {
          removed += 1;
          quote = null;
        } else {
          shortened += 1;
          quote = start;
        }
      }
    }
    if (claim.kind === 'source-fact' && quote === null) {
      relabelled += 1;
      return { ...claim, kind: 'extracted-claim', quote };
    }
    return quote === claim.quote ? claim : { ...claim, quote };
  });
  return { claims: result, shortened, removed, relabelled };
}
