import {
  SUPPORT_VERDICTS,
  SUPPORT_VERDICT_LABELS,
  emptyVerdictCounts,
  type ClaimChecks,
  type GroundedClaim,
  type GroundingReview,
  type SupportVerdict,
} from '../../../shared/grounding';
import type { EngineMode } from '../../../shared/types';

/** What a verdict says about a statement and its cited passage. None of them says the passage is true. */
export const VERDICT_MEANINGS: Record<SupportVerdict, string> = {
  supported: 'Backed by the cited passage.',
  partial: 'Only part of it is backed by the cited passage.',
  unsupported: 'Nothing in the cited passage backs it.',
  contradicted: 'The cited passage says something that conflicts with it.',
  unchecked: 'A hypothesis, assumption or interpretation that is not claimed to be evidence.',
};

export interface VerdictTally {
  verdict: SupportVerdict;
  label: string;
  count: number;
}

/** One entry per verdict in the fixed reading order, whatever order the counts object was built in. */
export function orderedTallies(counts: Record<SupportVerdict, number>): VerdictTally[] {
  return SUPPORT_VERDICTS.map((verdict) => ({
    verdict,
    label: SUPPORT_VERDICT_LABELS[verdict],
    count: counts[verdict] ?? 0,
  }));
}

export function totalStatements(counts: Record<SupportVerdict, number>): number {
  return orderedTallies(counts).reduce((sum, tally) => sum + tally.count, 0);
}

export function statementsText(total: number): string {
  return `${total} ${total === 1 ? 'statement' : 'statements'}`;
}

/** The one-line summary: `12 statements checked · 7 Supported · 2 Partly supported · …`. */
export function summaryText(counts: Record<SupportVerdict, number>): string {
  return [
    `${statementsText(totalStatements(counts))} checked`,
    ...orderedTallies(counts).map((tally) => `${tally.count} ${tally.label}`),
  ].join(' · ');
}

/** Verdicts that mean the cited material gives a reader no reason to rely on the statement. */
export function needsAttention(verdict: SupportVerdict): boolean {
  return verdict === 'unsupported' || verdict === 'contradicted';
}

export function tallyVerdicts(
  claims: readonly Pick<GroundedClaim, 'verdict'>[],
): Record<SupportVerdict, number> {
  const counts = emptyVerdictCounts();
  for (const claim of claims) counts[claim.verdict] += 1;
  return counts;
}

export interface ClaimGroup {
  section: string;
  claims: GroundedClaim[];
  counts: Record<SupportVerdict, number>;
}

/**
 * Groups statements by the chapter they appear in. Groups follow the report's chapter order when
 * it is given and otherwise the order in which a chapter is first seen; a statement keeps its
 * place inside its chapter.
 */
export function groupBySection(
  claims: readonly GroundedClaim[],
  chapterOrder: readonly string[] = [],
): ClaimGroup[] {
  const groups = new Map<string, ClaimGroup>();
  for (const claim of claims) {
    const group = groups.get(claim.section) ?? {
      section: claim.section,
      claims: [],
      counts: emptyVerdictCounts(),
    };
    group.claims.push(claim);
    group.counts[claim.verdict] += 1;
    groups.set(claim.section, group);
  }
  const rank = new Map<string, number>();
  chapterOrder.forEach((title, index) => {
    if (!rank.has(title)) rank.set(title, index);
  });
  const unknown = Number.MAX_SAFE_INTEGER;
  return [...groups.values()].sort(
    (a, b) => (rank.get(a.section) ?? unknown) - (rank.get(b.section) ?? unknown),
  );
}

export function contradictedClaims(claims: readonly GroundedClaim[]): GroundedClaim[] {
  return claims.filter((claim) => claim.verdict === 'contradicted');
}

/** Chapters in which no statement was listed, so nothing there was checked statement by statement. */
export function chaptersWithoutStatements(
  chapterTitles: readonly string[],
  claims: readonly GroundedClaim[],
): string[] {
  const covered = new Set(claims.map((claim) => claim.section));
  return [...new Set(chapterTitles)].filter((title) => !covered.has(title));
}

export function methodLine(method: GroundingReview['method']): string {
  return method === 'deterministic+model'
    ? 'Quote, word-overlap and figure checks, plus an independent model check that had to quote real text'
    : 'Deterministic checks only — the independent model check did not run';
}

/** Why there is nothing to show when a report carries no review. `complete` is false while it is partial. */
export function noReviewMessage(generatedBy: EngineMode, complete: boolean): string {
  if (generatedBy === 'local') {
    return 'The rules-based report is assembled from recorded metrics and verbatim excerpts, so it has no model-written statements to check.';
  }
  return complete
    ? 'This model-written report has no grounding review, so none of its statements were checked.'
    : 'This partial model-written report has no grounding review, so none of its statements have been checked.';
}

/**
 * Names where a statement's quote came from without claiming more than the server checked: with
 * several cited passages the quote may be in any one of them.
 */
export function quoteLabel(claim: {
  sourceIds: readonly string[];
  checks: Pick<ClaimChecks, 'quote'>;
}): string {
  const ids = [...new Set(claim.sourceIds)];
  if (!ids.length) return 'Quote with no cited passage recorded';
  const list = ids.join(', ');
  switch (claim.checks.quote) {
    case 'found':
      return ids.length === 1 ? `Quoted from ${list}` : `Quoted from one of ${list}`;
    case 'not-found':
      return `Quote not found verbatim in ${ids.length === 1 ? list : `any of ${list}`}`;
    default:
      return `Quote not checked against ${list}`;
  }
}
