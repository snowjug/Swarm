import type { EvidenceRef } from '../../../shared/evidence.js';
import type { EvidenceChunk } from '../../../shared/types.js';
import { hashText } from '../grounding/ledger.js';
import { verbatimStart } from '../grounding/quotes.js';
import { findQuote } from '../grounding/text.js';

const MAX_QUOTE_CHARS = 600;

export interface VerifiedEvidence {
  ref: EvidenceRef;
  /** True when the quote ran past the passage and was cut back to the part that is verbatim in it. */
  shortened: boolean;
}

/**
 * Turns a passage id and a quote into evidence, or null when it cannot be checked: the passage is not
 * one of this project's, or no start of the quote is verbatim in it. A quote that is only partly
 * verbatim is cut back to its verbatim start, never extended; the check is the one the report uses.
 */
export function verifiedEvidence(
  passages: ReadonlyMap<string, EvidenceChunk>,
  passageId: string,
  quote: string,
): VerifiedEvidence | null {
  const passage = passages.get(passageId);
  if (!passage) return null;
  const cited = new Map([[passage.id, passage.text]]);
  const wanted = quote.trim();
  let verbatim: string | null = wanted;
  let shortened = false;
  if (!findQuote(wanted, cited).found) {
    verbatim = verbatimStart(wanted, cited);
    shortened = true;
  }
  if (verbatim === null) return null;
  if (verbatim.length > MAX_QUOTE_CHARS) {
    verbatim = verbatim.slice(0, MAX_QUOTE_CHARS).replace(/\s+\S*$/u, '');
    shortened = true;
    if (!findQuote(verbatim, cited).found) return null;
  }
  return {
    shortened,
    ref: {
      passageId: passage.id,
      documentId: passage.documentId,
      documentName: passage.documentName,
      start: passage.start,
      end: passage.end,
      quote: verbatim,
      contentHash: passage.contentHash ?? hashText(passage.text),
      role: 'supports',
    },
  };
}

/** The same evidence twice (one passage, one quote) is one piece of evidence. */
export function uniqueEvidence(refs: readonly EvidenceRef[], max = 8): EvidenceRef[] {
  const seen = new Set<string>();
  const kept: EvidenceRef[] = [];
  for (const ref of refs) {
    const mark = `${ref.passageId}|${ref.quote ?? ''}`;
    if (seen.has(mark)) continue;
    seen.add(mark);
    kept.push(ref);
    if (kept.length === max) break;
  }
  return kept;
}
