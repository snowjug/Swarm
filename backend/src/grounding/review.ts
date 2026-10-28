import {
  emptyVerdictCounts,
  type ChapterClaim,
  type ClaimKind,
  type GroundedClaim,
  type GroundingReview,
} from '../../../shared/grounding.js';
import { AppError, publicFailure } from '../errors.js';
import type { ModelGateway } from '../models/client.js';
import { judgeClaims, MAX_ENTAILMENT_CLAIMS, type EntailmentItem } from './entailment.js';
import { findQuote, numbersIn, wordOverlap } from './text.js';
import { checkClaim, decideVerdict, type VerificationContext } from './verify.js';

const SOURCE_KINDS: ReadonlySet<ClaimKind> = new Set(['source-fact', 'extracted-claim']);
const CANCELLATION_CODES = new Set(['RUN_CANCELLED', 'RUN_PAUSED', 'RUN_TIMEOUT']);
/** A listed claim must restate something the chapter actually says. */
export const BODY_COVERAGE = 0.5;
const MAX_FIGURES_PER_SECTION = 8;
/** One repair message names at most this many problems; the model fixes them together. */
const MAX_REPORTED_PROBLEMS = 8;
const MAX_LISTED_IDS = 24;

export interface ChapterForReview {
  title: string;
  body: string;
  sourceIds: string[];
  memoryIds: string[];
  claims: ChapterClaim[];
  /** Listed statements that did not restate the chapter and were left out; the review says so. */
  droppedClaims?: number;
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
 * Only integrity is enforced here (known identifiers, a citation where one is required, a verbatim
 * quote). Whether a claim restates its chapter is handled by `splitCoveredClaims`.
 */
export function validateChapterClaims(
  chapter: Pick<ChapterForReview, 'claims'>,
  context: Pick<VerificationContext, 'passages' | 'memories'>,
): void {
  const problems: string[] = [];
  let identifierProblem = false;
  chapter.claims.forEach((claim, index) => {
    const report = (message: string): void => {
      problems.push(`claims[${index}] (${claim.kind}) ${message}`);
    };
    if (claim.sourceIds.some((id) => !context.passages.has(id))) {
      identifierProblem = true;
      report('cites a passage that was not supplied.');
    }
    if (claim.memoryIds.some((id) => !context.memories.has(id))) {
      identifierProblem = true;
      report('cites a simulation memory that was not supplied.');
    }
    if (SOURCE_KINDS.has(claim.kind)) {
      if (claim.sourceIds.length === 0) {
        report('must cite at least one supplied passage in sourceIds.');
      }
      const cited = pick(claim.sourceIds, context.passages);
      if (claim.kind === 'source-fact' && claim.quote === null) {
        report(
          'needs a quote copied verbatim from a cited passage; use "extracted-claim" for a paraphrase.',
        );
      }
      if (claim.quote !== null && !findQuote(claim.quote, cited).found) {
        report(
          'has a quote that is not verbatim in the cited passages (at least 12 characters, copied exactly); fix the quote or set it to null.',
        );
      }
    }
    if (claim.kind === 'simulated-event' && claim.memoryIds.length === 0) {
      report('must cite the simulation memory it describes in memoryIds.');
    }
  });
  if (problems.length === 0) return;
  const more =
    problems.length > MAX_REPORTED_PROBLEMS
      ? ` (and ${problems.length - MAX_REPORTED_PROBLEMS} more problems)`
      : '';
  const identifiers = identifierProblem
    ? ` Copy identifiers exactly, never construct them: valid passage IDs: ${listIds(context.passages.keys())}; valid memory IDs: ${listIds(context.memories.keys())}. A claim's sourceIds hold only passage IDs and its memoryIds only simulation memory IDs; a claim cannot cite a fictional interview.`
    : '';
  invalid(`${problems.slice(0, MAX_REPORTED_PROBLEMS).join(' ')}${more}${identifiers}`);
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
      const labels = await judgeClaims(
        model,
        eligible.map((entry): EntailmentItem => entry.item),
        signal,
      );
      for (const { index, item } of eligible) {
        const check = checks[index];
        if (check) check.entailment = labels.get(item.claimId) ?? null;
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
