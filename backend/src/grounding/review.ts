import {
  CLAIM_KIND_LABELS,
  emptyVerdictCounts,
  type ChapterClaim,
  type GroundedClaim,
  type GroundingReview,
} from '../../../shared/grounding.js';
import { AppError, publicFailure } from '../errors.js';
import type { ModelGateway } from '../models/client.js';
import {
  judgeClaimsWithEvidence,
  MAX_ENTAILMENT_CLAIMS,
  type EntailmentItem,
} from './entailment.js';
import { MAX_REVIEWED_CLAIMS, normalizeClaims } from './normalize.js';
import { numbersIn, wordOverlap } from './text.js';
import { checkClaim, decideVerdict, SOURCE_KINDS, type VerificationContext } from './verify.js';

const CANCELLATION_CODES = new Set(['RUN_CANCELLED', 'RUN_PAUSED', 'RUN_TIMEOUT']);
/** A listed claim must restate something the chapter actually says. */
export const BODY_COVERAGE = 0.5;
const MAX_FIGURES_PER_SECTION = 8;
const MAX_LISTED_IDS = 24;

export interface ChapterForReview {
  title: string;
  body: string;
  sourceIds: string[];
  memoryIds: string[];
  claims: ChapterClaim[];
  /** Listed statements that did not restate the chapter and were left out; the review says so. */
  droppedClaims?: number;
  /** Statements past the per-chapter limit, left out; the review says so. */
  overflowClaims?: number;
  /** Identifiers the model named that were not supplied, removed; the review says so. */
  removedCitations?: number;
  /** Quotes cut back to the part that is verbatim in a cited passage; the review says so. */
  shortenedQuotes?: number;
  /** Quotes dropped because none of the text was in a cited passage; the review says so. */
  removedQuotes?: number;
  /** Source facts left without a verbatim quote, shown as extracted claims; the review says so. */
  relabelledClaims?: number;
}

function invalid(message: string): never {
  throw new AppError(502, 'MODEL_OUTPUT_INVALID', message);
}

function pick(ids: readonly string[], from: ReadonlyMap<string, string>): Map<string, string> {
  const picked = new Map<string, string>();
  for (const id of ids) {
    const text = from.get(id);
    if (text !== undefined) picked.set(id, text);
  }
  return picked;
}

function listIds(ids: Iterable<string>): string {
  const all = [...ids];
  const shown = all.slice(0, MAX_LISTED_IDS).join(', ') || 'none';
  return all.length > MAX_LISTED_IDS ? `${shown} (and ${all.length - MAX_LISTED_IDS} more)` : shown;
}

/**
 * Server-side checks on the claims a model lists for a chapter. A failure is sent back to the
 * model for a bounded repair, so the message says what to fix and never echoes the model's own
 * text. It reports every problem in one pass: a real model that is told about one claim at a time
 * fixes that claim, trips over the next one, and runs out of repairs before it converges.
 *
 * Only what cannot be repaired by removing or weakening is enforced here: a statement that rests on
 * a passage must still cite one that was supplied, and a simulated event must still cite a memory
 * that was supplied. Slips that only remove, shorten or weaken what a statement claims (an identifier
 * that was not supplied, a quote that is reworded or runs past the text, a source fact without a
 * verbatim quote, too many statements) are repaired by `normalizeClaims` first and never fail a
 * chapter; the review discloses them. Whether a claim restates its chapter is handled by
 * `splitCoveredClaims`.
 */
export function validateChapterClaims(
  chapter: Pick<ChapterForReview, 'claims'>,
  context: Pick<VerificationContext, 'passages' | 'memories'>,
): void {
  const problems: string[] = [];
  let identifierProblem = false;
  const { claims } = normalizeClaims(chapter.claims, context);
  claims.forEach((claim, index) => {
    const written = chapter.claims[index];
    const report = (message: string): void => {
      // Name the label the model chose, not the one a repair may have weakened it to.
      problems.push(`claims[${index}] (${written?.kind ?? claim.kind}) ${message}`);
    };
    if (SOURCE_KINDS.has(claim.kind) && claim.sourceIds.length === 0) {
      if (written && written.sourceIds.length > 0) {
        identifierProblem = true;
        report('cites a passage that was not supplied.');
      } else {
        report('must cite at least one supplied passage in sourceIds.');
      }
    }
    if (claim.kind === 'simulated-event' && claim.memoryIds.length === 0) {
      if (written && written.memoryIds.length > 0) {
        identifierProblem = true;
        report('cites a simulation memory that was not supplied.');
      } else {
        report('must cite the simulation memory it describes in memoryIds.');
      }
    }
  });
  if (problems.length === 0) return;
  const identifiers = identifierProblem
    ? ` Copy identifiers exactly, never construct them: valid passage IDs: ${listIds(context.passages.keys())}; valid memory IDs: ${listIds(context.memories.keys())}. A claim's sourceIds hold only passage IDs and its memoryIds only simulation memory IDs; a claim cannot cite a fictional interview.`
    : '';
  invalid(`${problems.join(' ')}${identifiers}`);
}

/**
 * A listed statement should restate something its chapter says. One that does not (a loose
 * paraphrase, or text the chapter never wrote) is left out of the review instead of failing an
 * otherwise sound chapter, and the review states how many were left out.
 */
export function splitCoveredClaims(chapter: Pick<ChapterForReview, 'body' | 'claims'>): {
  kept: ChapterClaim[];
  dropped: number;
} {
  const kept = chapter.claims.filter(
    (claim) => wordOverlap(claim.text, chapter.body) >= BODY_COVERAGE,
  );
  return { kept, dropped: chapter.claims.length - kept.length };
}

function unverifiedFigures(chapter: ChapterForReview, context: VerificationContext): string[] {
  const material = [
    ...pick(chapter.sourceIds, context.passages).values(),
    ...pick(chapter.memoryIds, context.memories).values(),
    ...chapter.claims.flatMap((claim) => [...pick(claim.sourceIds, context.passages).values()]),
  ].join('\n');
  const backed = new Set(numbersIn(material));
  return numbersIn(chapter.body)
    .filter((figure) => !context.recorded.has(figure) && !backed.has(figure))
    .slice(0, MAX_FIGURES_PER_SECTION);
}

function isCancellation(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof AppError && CANCELLATION_CODES.has(error.code));
}

export interface ReviewInput {
  /** The model for the independent check, or null when none is available. */
  model: ModelGateway | null;
  signal: AbortSignal;
  chapters: ChapterForReview[];
  context: VerificationContext;
  now: Date;
}

/**
 * Verifies every listed claim and reports plainly what was and was not checked. The independent
 * model check is best effort: if it fails the review still completes with deterministic verdicts
 * and says so. A cancellation is never swallowed.
 */
export async function reviewClaims(input: ReviewInput): Promise<GroundingReview> {
  const { chapters, context, model, signal } = input;
  const notes: string[] = [];
  const listed = chapters.flatMap((chapter) =>
    chapter.claims.map((claim) => ({ section: chapter.title, claim })),
  );
  const claims = listed.slice(0, MAX_ENTAILMENT_CLAIMS);
  if (listed.length > claims.length) {
    notes.push(
      `${listed.length - claims.length} further listed statements were not checked (the limit is ${MAX_ENTAILMENT_CLAIMS}).`,
    );
  }
  const checks = claims.map(({ claim }) => checkClaim(claim, context));
  for (const chapter of chapters) {
    const left = chapter.droppedClaims ?? 0;
    if (left > 0) {
      notes.push(
        `${left} listed ${left === 1 ? 'statement' : 'statements'} in “${chapter.title}” did not restate that chapter’s text and ${left === 1 ? 'was' : 'were'} left out of the review.`,
      );
    }
    const overflow = chapter.overflowClaims ?? 0;
    if (overflow > 0) {
      notes.push(
        `${overflow} further listed ${overflow === 1 ? 'statement' : 'statements'} in “${chapter.title}” went past the limit of ${MAX_REVIEWED_CLAIMS} per chapter and ${overflow === 1 ? 'was' : 'were'} left out of the review.`,
      );
    }
    const unsupplied = chapter.removedCitations ?? 0;
    if (unsupplied > 0) {
      notes.push(
        `${unsupplied} ${unsupplied === 1 ? 'citation' : 'citations'} in “${chapter.title}” named a passage, simulation memory or interview that was not supplied and ${unsupplied === 1 ? 'was' : 'were'} removed.`,
      );
    }
    const shortened = chapter.shortenedQuotes ?? 0;
    if (shortened > 0) {
      notes.push(
        `${shortened} ${shortened === 1 ? 'quote' : 'quotes'} in “${chapter.title}” ran past the cited text and ${shortened === 1 ? 'was' : 'were'} shortened to the part that appears verbatim in the passage.`,
      );
    }
    const removed = chapter.removedQuotes ?? 0;
    if (removed > 0) {
      notes.push(
        `${removed} ${removed === 1 ? 'quote' : 'quotes'} in “${chapter.title}” could not be found in the cited passages and ${removed === 1 ? 'was' : 'were'} removed; ${removed === 1 ? 'that statement is' : 'those statements are'} judged on ${removed === 1 ? 'its' : 'their'} wording alone.`,
      );
    }
    const relabelled = chapter.relabelledClaims ?? 0;
    if (relabelled > 0) {
      notes.push(
        `${relabelled} ${relabelled === 1 ? 'statement' : 'statements'} in “${chapter.title}” labelled “${CLAIM_KIND_LABELS['source-fact']}” had no quote that appears verbatim in a cited passage and ${relabelled === 1 ? 'is' : 'are'} shown as “${CLAIM_KIND_LABELS['extracted-claim']}” instead.`,
      );
    }
  }

  let method: GroundingReview['method'] = 'deterministic';
  const eligible = claims.flatMap(({ claim }, index) => {
    const cited = pick(claim.sourceIds, context.passages);
    return SOURCE_KINDS.has(claim.kind) && cited.size > 0
      ? [{ index, item: { claimId: `C${index + 1}`, claim: claim.text, passages: cited } }]
      : [];
  });
  if (!model) {
    notes.push('No model was available, so only the deterministic checks ran.');
  } else if (eligible.length === 0) {
    notes.push('No source-backed statement needed the independent model check.');
  } else {
    try {
      const judgements = await judgeClaimsWithEvidence(
        model,
        eligible.map((entry): EntailmentItem => entry.item),
        signal,
      );
      for (const { index, item } of eligible) {
        const check = checks[index];
        const judgement = judgements.get(item.claimId);
        if (check) {
          check.entailment = judgement?.label ?? null;
          // Only a contradiction needs the passage text shown next to the statement.
          if (judgement?.label === 'contradicts' && judgement.quote) {
            check.entailmentQuote = judgement.quote;
          }
        }
      }
      method = 'deterministic+model';
    } catch (error) {
      if (isCancellation(error, signal)) throw error;
      notes.push(
        `The independent model check did not complete (${publicFailure(error).code}); every verdict uses the deterministic checks only.`,
      );
    }
  }

  const grounded = claims.map(({ section, claim }, index): GroundedClaim => {
    const claimChecks = checks[index];
    if (!claimChecks) throw new Error('A checked claim is missing its checks.');
    const { verdict, reason } = decideVerdict(claim, claimChecks);
    return {
      id: `C${index + 1}`,
      section,
      text: claim.text,
      kind: claim.kind,
      sourceIds: claim.sourceIds,
      memoryIds: claim.memoryIds,
      quote: SOURCE_KINDS.has(claim.kind) ? claim.quote : null,
      verdict,
      checks: claimChecks,
      reason,
    };
  });
  const counts = emptyVerdictCounts();
  for (const claim of grounded) counts[claim.verdict] += 1;

  notes.push(
    'Only the statements the writer listed as claims were checked. Chapter prose that is not listed is not verified, except that figures in it are compared with the recorded data and cited passages.',
    'A citation proves where a statement says it came from, not that the source is true.',
  );
  return {
    checkedAt: input.now.toISOString(),
    method,
    claims: grounded,
    counts,
    unverifiedFigures: chapters
      .map((chapter) => ({ section: chapter.title, figures: unverifiedFigures(chapter, context) }))
      .filter((entry) => entry.figures.length > 0),
    notes,
  };
}
