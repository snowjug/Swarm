import type { ChapterClaim } from '../../../shared/grounding.js';
import { normalizeClaimQuotes } from './quotes.js';

/** A chapter puts at most this many statements through the grounding review. */
export const MAX_REVIEWED_CLAIMS = 6;

/** What the model was actually given to cite. Anything else it names was not supplied. */
export interface SuppliedIdentifiers {
  passages: ReadonlyMap<string, string>;
  memories: ReadonlyMap<string, string>;
}

export interface NormalizedClaims {
  claims: ChapterClaim[];
  /** Statements past the limit, left out of the review. */
  overflow: number;
  /** Passage or memory identifiers the model named that were not supplied, removed from its statements. */
  removedCitations: number;
  shortenedQuotes: number;
  removedQuotes: number;
  /** Source facts left without a verbatim quote, now shown as extracted claims. */
  relabelled: number;
}

/**
 * Brings the statements a model listed for a chapter to a form the review can verify, by only ever
 * removing or shortening what the model claimed, or weakening a label it could not back:
 *
 * - statements past the limit are left out (the model lists the ones that matter most first);
 * - an identifier that was not supplied is removed: it cannot be verified, and a verdict never rests
 *   on it. A statement that needs a citation and has none left is still rejected by the validator;
 * - a quote that runs past the cited text is shortened, a quote with no verbatim start is dropped,
 *   and a source fact left without a verbatim quote is shown as an extracted claim (see
 *   `normalizeClaimQuotes`).
 *
 * It never adds a citation, a quote or a statement, and it never changes what a statement says. It is
 * pure and idempotent, and reports what it changed so that the review can say so.
 */
export function normalizeClaims(
  claims: readonly ChapterClaim[],
  supplied: SuppliedIdentifiers,
): NormalizedClaims {
  const listed = claims.slice(0, MAX_REVIEWED_CLAIMS);
  let removedCitations = 0;
  const cleaned = listed.map((claim): ChapterClaim => {
    const sourceIds = claim.sourceIds.filter((id) => supplied.passages.has(id));
    const memoryIds = claim.memoryIds.filter((id) => supplied.memories.has(id));
    removedCitations +=
      claim.sourceIds.length - sourceIds.length + (claim.memoryIds.length - memoryIds.length);
    return { ...claim, sourceIds, memoryIds };
  });
  const quotes = normalizeClaimQuotes(cleaned, supplied.passages);
  return {
    claims: quotes.claims,
    overflow: claims.length - listed.length,
    removedCitations,
    shortenedQuotes: quotes.shortened,
    removedQuotes: quotes.removed,
    relabelled: quotes.relabelled,
  };
}

export interface ChapterIdentifiers extends SuppliedIdentifiers {
  interviews: ReadonlySet<string>;
}

export interface ChapterDraft {
  sourceIds: string[];
  memoryIds: string[];
  interviewIds: string[];
  claims: ChapterClaim[];
}

export type NormalizedChapter<T extends ChapterDraft> = Omit<NormalizedClaims, 'claims'> & {
  chapter: T;
};

/**
 * `normalizeClaims` for a whole chapter reply, plus the same removal of identifiers that were not
 * supplied from the chapter's own citation lists, so that no citation chip is shown for a passage,
 * memory or interview that does not exist.
 */
export function normalizeChapter<T extends ChapterDraft>(
  draft: T,
  supplied: ChapterIdentifiers,
): NormalizedChapter<T> {
  const { claims, ...changes } = normalizeClaims(draft.claims, supplied);
  const sourceIds = draft.sourceIds.filter((id) => supplied.passages.has(id));
  const memoryIds = draft.memoryIds.filter((id) => supplied.memories.has(id));
  const interviewIds = draft.interviewIds.filter((id) => supplied.interviews.has(id));
  const removedFromChapter =
    draft.sourceIds.length -
    sourceIds.length +
    (draft.memoryIds.length - memoryIds.length) +
    (draft.interviewIds.length - interviewIds.length);
  return {
    chapter: { ...draft, sourceIds, memoryIds, interviewIds, claims },
    ...changes,
    removedCitations: changes.removedCitations + removedFromChapter,
  };
}
