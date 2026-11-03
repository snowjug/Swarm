import type { EvidenceAssessment, ResearchPlan } from '../../../shared/research.js';
import type { EvidenceChunk } from '../../../shared/types.js';
import { detectContradictions } from '../grounding/contradictions.js';
import type { CrawledPage } from './crawler/types.js';
import { termsOf } from './text.js';

/** The share of a claim's meaningful words that one passage must hold for the passage to bear on the claim. */
export const BEARS_ON_SHARE = 0.6;
/** The fewest words that must be shared, whatever the share says. */
export const BEARS_ON_MIN_WORDS = 2;
/** Pages that must have been read before the evidence can be called enough. */
export const SUFFICIENT_MIN_PAGES = 3;
/** The pages that must bear on each claim, whichever way, before the evidence is enough. */
export const SUFFICIENT_PAGES_PER_CLAIM = 2;
/** Pages that must have been read before it is judged that new ones add nothing, and how many of the latest are looked at. */
export const SATURATED_MIN_PAGES = 4;
export const SATURATED_WINDOW = 3;
/** New words, as a share of the words already seen, below which a page adds almost nothing. */
export const SATURATED_GROWTH = 0.03;
/** The longest passage set against a claim: what is read of a long one. */
const MAX_PASSAGE_CHARS = 3_000;

interface Claim {
  id: string;
  statement: string;
  terms: Set<string>;
  needed: number;
  supporting: Set<string>;
  opposing: Set<string>;
}

const chunk = (id: string, documentId: string, text: string): EvidenceChunk => ({
  id,
  documentId,
  documentName: documentId,
  text,
  start: 0,
  end: text.length,
});

/**
 * Reads the pages of a run against the claims its plan set out to check, one page at a time, and says
 * whether that is enough, whether more reading is adding nothing, and which sources take the other side.
 * Everything is lexical and deterministic, and none of it is a verdict on whether a claim is true:
 *
 * - A passage **bears on** a claim when it holds most of the claim's meaningful words. That is wording
 *   overlap, not agreement.
 * - It **opposes** the claim when the project's contradiction check finds the claim and the passage to
 *   disagree (a different figure for the same measure, or a statement and its denial). Otherwise a passage
 *   that bears on a claim is counted as **supporting** it, in the weak sense that it says something close.
 * - Reading is **enough** when every claim has at least two pages that bear on it, either way, after at
 *   least three pages. A plan with no claims is never enough.
 * - Reading is **saturated** when the last three pages each added almost no words not seen before.
 */
export class Assessor {
  private readonly claims: Claim[];
  private readonly seen = new Set<string>();
  private readonly vocabulary = new Set<string>();
  private readonly growth: number[] = [];
  private taken = 0;

  constructor(
    plan: Pick<ResearchPlan, 'claimsToVerify'>,
    private readonly now: () => Date,
  ) {
    this.claims = plan.claimsToVerify.map((claim) => {
      const terms = termsOf(claim.statement);
      return {
        id: claim.id,
        statement: claim.statement,
        terms,
        needed: Math.max(BEARS_ON_MIN_WORDS, Math.ceil(terms.size * BEARS_ON_SHARE)),
        supporting: new Set(),
        opposing: new Set(),
      };
    });
  }

  /** How many pages have been taken in. */
  get pages(): number {
    return this.seen.size;
  }

  /** Takes in the pages of a crawl that have not been seen yet. `pages` only ever grows at its end. */
  take(pages: readonly CrawledPage[]): void {
    for (; this.taken < pages.length; this.taken += 1) {
      const page = pages[this.taken];
      if (page && !this.seen.has(page.source.id)) this.add(page);
    }
  }

  private add(page: CrawledPage): void {
    this.seen.add(page.source.id);
    const { text, passages } = page.document;
    const fresh = [...termsOf(text)].filter((term) => !this.vocabulary.has(term));
    this.growth.push(this.vocabulary.size === 0 ? 1 : fresh.length / this.vocabulary.size);
    for (const term of fresh) this.vocabulary.add(term);

    if (this.claims.length === 0) return;
    const parts =
      passages.length > 0 ? passages.map((part) => text.slice(part.start, part.end)) : [text];
    const terms = parts.map(termsOf);
    for (const claim of this.claims) {
      parts.forEach((part, at) => {
        const shared = [...claim.terms].filter((term) => terms[at]?.has(term)).length;
        if (shared < claim.needed) return;
        const opposes =
          detectContradictions(
            [
              chunk('C1', `claim-${claim.id}`, claim.statement),
              chunk('P1', page.source.id, part.slice(0, MAX_PASSAGE_CHARS)),
            ],
            this.now(),
          ).length > 0;
        (opposes ? claim.opposing : claim.supporting).add(page.source.id);
      });
    }
  }

  assessments(): EvidenceAssessment[] {
    return this.claims.map((claim) => {
      const supporting = claim.supporting.size;
      const opposing = claim.opposing.size;
      return {
        claimId: claim.id,
        supporting,
        opposing,
        sourceIds: [...new Set([...claim.opposing, ...claim.supporting])].slice(0, 20),
        status:
          supporting > 0 && opposing > 0
            ? 'contested'
            : opposing > 0
              ? 'opposed'
              : supporting > 0
                ? 'supported'
                : 'unassessed',
      };
    });
  }

  /** Every claim has pages bearing on it, from more than one page, and enough pages have been read. */
  sufficient(): boolean {
    if (this.claims.length === 0 || this.seen.size < SUFFICIENT_MIN_PAGES) return false;
    return this.claims.every(
      (claim) =>
        new Set([...claim.supporting, ...claim.opposing]).size >= SUFFICIENT_PAGES_PER_CLAIM,
    );
  }

  /** The latest pages added almost no word that was not already seen. */
  saturated(): boolean {
    if (this.growth.length < SATURATED_MIN_PAGES) return false;
    return this.growth.slice(-SATURATED_WINDOW).every((share) => share < SATURATED_GROWTH);
  }

  /** The pages that take the other side of at least one claim. */
  opposingSources(): Set<string> {
    return new Set(this.claims.flatMap((claim) => [...claim.opposing]));
  }
}
