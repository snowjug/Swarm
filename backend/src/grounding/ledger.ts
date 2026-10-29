import { createHash } from 'node:crypto';
import {
  emptySupportCounts,
  statementTypeOfKind,
  type ClaimHistoryEntry,
  type ClaimPublication,
  type ClaimRecord,
  type ClaimReview,
  type EvidenceRef,
  type EvidenceSufficiency,
  type ReviewInput,
  type SimulationRef,
  type StatementType,
  type SupportClass,
} from '../../../shared/evidence.js';
import type { SimulationMemory } from '../../../shared/guided.js';
import type {
  ClaimChecks,
  GroundedClaim,
  GroundingReview,
  SupportVerdict,
} from '../../../shared/grounding.js';
import type { EvidenceChunk } from '../../../shared/types.js';
import { findQuote, numbersIn, wordOverlap } from './text.js';
import { tokenize } from '../knowledge/retrieval.js';

/** A recommendation needs at least this many directly supported findings behind the analysis. */
export const MIN_FINDINGS_FOR_RECOMMENDATION = 3;
/** ...and at least this share of the source-backed statements must be directly supported. */
export const MIN_DIRECT_SHARE_FOR_RECOMMENDATION = 0.5;
/** Below this share the evidence is only "limited", even if a recommendation is allowed. */
export const STRONG_DIRECT_SHARE = 0.75;

export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Statement types whose truth rests on source passages. */
const SOURCE_BACKED: ReadonlySet<StatementType> = new Set([
  'source-fact',
  'extracted-claim',
  'inferred-relationship',
]);

export interface SupportInput {
  statementType: StatementType;
  verdict: SupportVerdict;
  /** Evidence from another passage that conflicts with the statement. */
  contradicting: number;
  /** Assumptions the statement explicitly rests on. */
  assumptions: number;
}

/**
 * Maps a statement and the outcome of its checks to one support class. A pure function: the same
 * inputs always give the same class, so every outcome can be explained, tested and audited.
 * Mixed evidence never counts as directly supported: a statement a source backs but another
 * source contradicts is only partially supported.
 */
export function classifySupport(input: SupportInput): SupportClass {
  const { statementType, verdict, contradicting, assumptions } = input;
  switch (statementType) {
    case 'user-assumption':
    case 'unresolved-uncertainty':
      return 'not-applicable';
    case 'ai-hypothesis':
      return 'not-checkable';
    case 'recommendation':
      return assumptions > 0 ? 'assumption-dependent' : 'not-checkable';
    case 'contradicting-evidence':
      return verdict === 'supported' ? 'directly-supported' : 'unsupported';
    case 'simulated-event':
    case 'analytical-conclusion':
      if (verdict === 'supported' || verdict === 'partial') return 'simulation-derived';
      return verdict === 'unchecked' ? 'not-checkable' : 'unsupported';
    case 'inferred-relationship':
      if (verdict === 'supported' || verdict === 'partial') return 'partially-supported';
      if (verdict === 'contradicted') return 'contradicted';
      return verdict === 'unchecked' ? 'not-checkable' : 'unsupported';
    case 'source-fact':
    case 'extracted-claim':
      switch (verdict) {
        case 'supported':
          return contradicting > 0 ? 'partially-supported' : 'directly-supported';
        case 'partial':
          return 'partially-supported';
        case 'contradicted':
          return 'contradicted';
        case 'unsupported':
          return 'unsupported';
        default:
          return 'not-checkable';
      }
  }
}

export interface PublicationInput {
  statementType: StatementType;
  supportClass: SupportClass;
  supporting: readonly EvidenceRef[];
  contradicting: readonly EvidenceRef[];
  assumptionIds: readonly string[];
  review: ClaimReview;
  /** Why the support class is what it is, in words a reader can follow. */
  reason: string;
}

/**
 * What the product may do with a statement. These rules are the product's promise to the reader:
 * a statement is only ever shown as a finding when a source passage directly supports it, and a
 * reviewer can withhold a statement but can never upgrade one.
 */
export function decidePublication(input: PublicationInput): ClaimPublication {
  const { supportClass, supporting, contradicting, assumptionIds, review, reason } = input;
  const reasons: string[] = [];

  if (review.result === 'rejected') {
    return {
      status: 'withheld',
      qualification: null,
      reasons: ['A reviewer rejected this statement, so it is not presented.'],
    };
  }

  let publication: ClaimPublication;
  switch (supportClass) {
    case 'directly-supported':
      publication =
        supporting.length > 0
          ? { status: 'finding', qualification: null, reasons }
          : {
              status: 'labelled-unverified',
              qualification: 'No source passage could be resolved for this statement.',
              reasons: ['A finding needs at least one resolvable source passage.'],
            };
      break;
    case 'partially-supported':
      publication = {
        status: contradicting.length > 0 ? 'contradiction-shown' : 'qualified',
        qualification:
          contradicting.length > 0
            ? 'Only partly supported, and another source conflicts with it. Read both passages before relying on it.'
            : `Only partly supported by the cited source. ${reason}`.trim(),
        reasons: ['The evidence backs part of the statement, not all of it.'],
      };
      break;
    case 'contradicted':
      publication =
        contradicting.length > 0
          ? {
              status: 'contradiction-shown',
              qualification:
                'A source passage conflicts with this statement. It is shown with that passage.',
              reasons: [
                'A contradicted statement is never shown without the passage that contradicts it.',
              ],
            }
          : {
              status: 'withheld',
              qualification: null,
              reasons: ['A contradiction cannot be shown without the contradicting passage.'],
            };
      break;
    case 'unsupported':
      publication = {
        status: 'labelled-hypothesis',
        qualification:
          'No cited source supports this statement. Treat it as a hypothesis, not a finding.',
        reasons: ['An unsupported statement is shown only as a hypothesis.'],
      };
      break;
    case 'simulation-derived':
      publication = {
        status: 'labelled-simulation',
        qualification:
          'A simulated result under this scenario’s inputs. It was not observed and is not a source fact.' +
          (assumptionIds.length > 0 ? ` Depends on: ${assumptionIds.join(', ')}.` : ''),
        reasons: ['A simulation result is never presented as an observed fact.'],
      };
      break;
    case 'assumption-dependent':
      publication =
        assumptionIds.length > 0
          ? {
              status: 'qualified',
              qualification: `Holds only if these assumptions hold: ${assumptionIds.join(', ')}.`,
              reasons: ['An assumption-dependent statement names the assumption it rests on.'],
            }
          : {
              status: 'labelled-unverified',
              qualification: 'It rests on an assumption that was not named, so it is not verified.',
              reasons: ['An assumption-dependent statement must name its assumption.'],
            };
      break;
    case 'not-applicable':
      publication = {
        status: 'input',
        qualification: null,
        reasons: ['An input or note, not a finding.'],
      };
      break;
    default:
      publication = {
        status: 'labelled-unverified',
        qualification: 'The system could not check this statement. It is not a verified finding.',
        reasons: ['A statement that cannot be checked is never shown as verified.'],
      };
  }

  if (review.result === 'needs-revision' && publication.status === 'finding') {
    return {
      status: 'labelled-unverified',
      qualification: 'A reviewer asked for this statement to be revised before it is relied on.',
      reasons: ['A reviewer flagged this statement for revision.'],
    };
  }
  return publication;
}

export interface LedgerAssumption {
  id: string;
  statement: string;
  /** Scenario inputs shape every simulated result, so they are listed on those statements. */
  scope: 'scenario' | 'general';
}

export interface LedgerInput {
  projectId: string;
  parentId: string | null;
  branchFromRound: number | null;
  review: GroundingReview;
  passages: ReadonlyMap<string, EvidenceChunk>;
  memories: ReadonlyMap<string, SimulationMemory>;
  assumptions: readonly LedgerAssumption[];
  /** Conflicts between sources that involve a passage, already detected and not dismissed. */
  conflicts: readonly SourceConflict[];
  now: Date;
}

/** A conflict between two source passages, reduced to what a claim needs to display it. */
export interface SourceConflict {
  id: string;
  /** The words the two conflicting statements share: what the conflict is about. */
  topic: string;
  leftValue: string | null;
  rightValue: string | null;
  left: EvidenceRef;
  right: EvidenceRef;
}

/**
 * Whether a conflict is about what a statement says. Citing a conflicted passage is not enough: a
 * statement about something else in the same passage is not weakened by a disagreement elsewhere.
 * It is, when it repeats one of the conflicting figures or shares enough of the conflict's topic.
 */
export function conflictTouchesStatement(conflict: SourceConflict, text: string): boolean {
  const figures = new Set(numbersIn(text));
  const mentionsValue = [conflict.leftValue, conflict.rightValue].some((value) => {
    const token = value === null ? undefined : numbersIn(value)[0];
    return token !== undefined && figures.has(token);
  });
  if (mentionsValue) return true;
  const topic = conflict.topic.split(' ').filter(Boolean);
  const words = new Set(tokenize(text));
  const shared = topic.filter((word) => words.has(word)).length;
  return shared >= Math.min(3, Math.max(2, Math.ceil(topic.length / 2)));
}

/** The other side of every conflict that touches a passage the statement cites and is about it. */
export function conflictEvidence(
  cited: Iterable<string>,
  conflicts: readonly SourceConflict[],
  text: string,
): EvidenceRef[] {
  const passages = new Set(cited);
  const refs: EvidenceRef[] = [];
  for (const conflict of conflicts) {
    if (!conflictTouchesStatement(conflict, text)) continue;
    if (passages.has(conflict.left.passageId)) {
      refs.push({ ...conflict.right, role: 'contradicts', conflictId: conflict.id });
    } else if (passages.has(conflict.right.passageId)) {
      refs.push({ ...conflict.left, role: 'contradicts', conflictId: conflict.id });
    }
  }
  return refs;
}

function refFor(
  passage: EvidenceChunk,
  role: EvidenceRef['role'],
  quote: string | null,
): EvidenceRef {
  return {
    passageId: passage.id,
    documentId: passage.documentId,
    documentName: passage.documentName,
    start: passage.start,
    end: passage.end,
    quote,
    contentHash: passage.contentHash ?? hashText(passage.text),
    role,
  };
}

function supportingRefs(
  claim: GroundedClaim,
  passages: ReadonlyMap<string, EvidenceChunk>,
): EvidenceRef[] {
  const refs: EvidenceRef[] = [];
  for (const id of claim.sourceIds) {
    const passage = passages.get(id);
    if (!passage) continue;
    const quote =
      claim.quote !== null && findQuote(claim.quote, new Map([[id, passage.text]])).found
        ? claim.quote
        : null;
    refs.push(refFor(passage, 'supports', quote));
  }
  return refs;
}

function contradictingRefs(
  claim: GroundedClaim,
  passages: ReadonlyMap<string, EvidenceChunk>,
  conflicts: readonly SourceConflict[],
): EvidenceRef[] {
  const refs: EvidenceRef[] = [];
  const seen = new Set<string>();
  const add = (ref: EvidenceRef): void => {
    const key = `${ref.passageId}:${ref.quote ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  };
  if (claim.checks.entailment === 'contradicts' && claim.checks.entailmentQuote) {
    const quote = claim.checks.entailmentQuote;
    for (const id of claim.sourceIds) {
      const passage = passages.get(id);
      if (passage && findQuote(quote, new Map([[id, passage.text]])).found) {
        add(refFor(passage, 'contradicts', quote));
        break;
      }
    }
  }
  for (const ref of conflictEvidence(claim.sourceIds, conflicts, claim.text)) add(ref);
  return refs;
}

function simulationRefs(
  claim: GroundedClaim,
  memories: ReadonlyMap<string, SimulationMemory>,
): SimulationRef[] {
  return claim.memoryIds.flatMap((id) => {
    const memory = memories.get(id);
    return memory ? [{ memoryId: id, platform: memory.platform, round: memory.round }] : [];
  });
}

/** The assumptions a statement visibly rests on: explicit IDs, close wording, or scenario inputs. */
function assumptionsFor(
  claim: GroundedClaim,
  statementType: StatementType,
  assumptions: readonly LedgerAssumption[],
): string[] {
  const ids = new Set<string>();
  for (const assumption of assumptions) {
    const named = new RegExp(`\\b${assumption.id}\\b`, 'u').test(claim.text);
    if (named) ids.add(assumption.id);
    else if (
      statementType === 'user-assumption' &&
      wordOverlap(assumption.statement, claim.text) >= 0.7
    ) {
      ids.add(assumption.id);
    }
  }
  if (statementType === 'simulated-event' || statementType === 'analytical-conclusion') {
    for (const assumption of assumptions)
      if (assumption.scope === 'scenario') ids.add(assumption.id);
  }
  return [...ids].sort();
}

function verificationOf(claim: GroundedClaim, method: GroundingReview['method']) {
  const checks: ClaimChecks = claim.checks;
  return {
    method,
    verdict: claim.verdict,
    reason: claim.reason,
    quote: checks.quote,
    overlap: checks.overlap,
    numbers: checks.numbers,
    entailment: checks.entailment,
  };
}

const PENDING: ClaimReview = { result: 'pending', note: null, reviewedAt: null };

/** Turns a grounding review into the ledger: one record per material statement, with its lineage. */
export function buildClaimRecords(input: LedgerInput): ClaimRecord[] {
  const { review, passages, memories, assumptions, conflicts, now } = input;
  return review.claims.map((claim): ClaimRecord => {
    const statementType = statementTypeOfKind(claim.kind);
    const supporting = supportingRefs(claim, passages);
    const contradicting = contradictingRefs(claim, passages, conflicts);
    const assumptionIds = assumptionsFor(claim, statementType, assumptions);
    const supportClass = classifySupport({
      statementType,
      verdict: claim.verdict,
      contradicting: contradicting.length,
      assumptions: assumptionIds.length,
    });
    const publication = decidePublication({
      statementType,
      supportClass,
      supporting,
      contradicting,
      assumptionIds,
      review: PENDING,
      reason: claim.reason,
    });
    return {
      id: claim.id,
      version: 1,
      statementType,
      text: claim.text,
      section: claim.section,
      generationStage: 'report',
      supportClass,
      supporting,
      contradicting,
      assumptionIds,
      simulationEvents: simulationRefs(claim, memories),
      lineage: {
        projectId: input.projectId,
        parentId: input.parentId,
        branchFromRound: input.branchFromRound,
      },
      verification: verificationOf(claim, review.method),
      review: PENDING,
      publication,
      history: [
        {
          version: 1,
          at: now.toISOString(),
          actor: 'system',
          change: `Created by the ${review.method === 'deterministic' ? 'deterministic' : 'deterministic and independent model'} grounding review.`,
        },
      ],
    };
  });
}

/**
 * Applies a human review. A reviewer can accept, reject or ask for revision and can leave a note;
 * the support class and the evidence never change, and publication can only get stricter.
 */
export function applyReview(record: ClaimRecord, input: ReviewInput, now: Date): ClaimRecord {
  const review: ClaimReview = {
    result: input.result,
    note: input.note,
    reviewedAt: now.toISOString(),
  };
  const publication = decidePublication({
    statementType: record.statementType,
    supportClass: record.supportClass,
    supporting: record.supporting,
    contradicting: record.contradicting,
    assumptionIds: record.assumptionIds,
    review,
    reason: record.verification.reason,
  });
  const version = record.version + 1;
  const entry: ClaimHistoryEntry = {
    version,
    at: now.toISOString(),
    actor: 'reviewer',
    change: `Review: ${input.result}${input.note ? ` (${input.note.slice(0, 120)})` : ''}.`,
  };
  return { ...record, version, review, publication, history: [...record.history, entry] };
}

/**
 * Recalculates a statement after the open conflicts between sources changed. Evidence from the
 * independent check is kept, evidence from a conflict is replaced by what the open conflicts say
 * now, history is kept, and the version moves only when something actually changed.
 */
export function reconcileClaim(
  record: ClaimRecord,
  conflicts: readonly SourceConflict[],
  now: Date,
): ClaimRecord {
  const own = record.contradicting.filter((ref) => ref.conflictId === undefined);
  const contradicting = [
    ...own,
    ...conflictEvidence(
      record.supporting.map((ref) => ref.passageId),
      conflicts,
      record.text,
    ),
  ];
  const supportClass = classifySupport({
    statementType: record.statementType,
    verdict: record.verification.verdict,
    contradicting: contradicting.length,
    assumptions: record.assumptionIds.length,
  });
  const publication = decidePublication({
    statementType: record.statementType,
    supportClass,
    supporting: record.supporting,
    contradicting,
    assumptionIds: record.assumptionIds,
    review: record.review,
    reason: record.verification.reason,
  });
  const unchanged =
    supportClass === record.supportClass &&
    publication.status === record.publication.status &&
    publication.qualification === record.publication.qualification &&
    JSON.stringify(contradicting) === JSON.stringify(record.contradicting);
  if (unchanged) return record;
  const version = record.version + 1;
  return {
    ...record,
    version,
    supportClass,
    contradicting,
    publication,
    history: [
      ...record.history,
      {
        version,
        at: now.toISOString(),
        actor: 'system',
        change: `Recalculated after a change to the conflicts between sources: now ${supportClass}.`,
      },
    ],
  };
}

/** Whether the evidence is strong enough for a recommendation. Deterministic, never model-decided. */
export function assessSufficiency(
  records: readonly ClaimRecord[],
  openConflicts: number,
): EvidenceSufficiency {
  const counts = emptySupportCounts();
  for (const record of records) counts[record.supportClass] += 1;
  const sourceBacked = records.filter((record) => SOURCE_BACKED.has(record.statementType));
  const direct = sourceBacked.filter(
    (record) => record.supportClass === 'directly-supported',
  ).length;
  const share = sourceBacked.length === 0 ? null : direct / sourceBacked.length;
  const reasons: string[] = [];

  if (sourceBacked.length === 0) reasons.push('No statement rests on a source passage.');
  if (direct < MIN_FINDINGS_FOR_RECOMMENDATION) {
    reasons.push(
      `Only ${direct} directly supported ${direct === 1 ? 'finding' : 'findings'}; at least ${MIN_FINDINGS_FOR_RECOMMENDATION} are needed.`,
    );
  }
  if (share !== null && share < MIN_DIRECT_SHARE_FOR_RECOMMENDATION) {
    reasons.push(
      `Only ${Math.round(share * 100)}% of source-backed statements are directly supported; at least ${Math.round(MIN_DIRECT_SHARE_FOR_RECOMMENDATION * 100)}% are needed.`,
    );
  }
  if (reasons.length > 0)
    return { level: 'insufficient', reasons, counts, directlySupportedShare: share };

  const limits: string[] = [];
  if (counts.contradicted > 0)
    limits.push(`${counts.contradicted} statements are contradicted by a source.`);
  if (openConflicts > 0) {
    limits.push(
      `${openConflicts} ${openConflicts === 1 ? 'conflict between sources is' : 'conflicts between sources are'} unresolved.`,
    );
  }
  if (share !== null && share < STRONG_DIRECT_SHARE) {
    limits.push(
      `Only ${Math.round(share * 100)}% of source-backed statements are directly supported.`,
    );
  }
  return {
    level: limits.length > 0 ? 'limited' : 'sufficient',
    reasons: limits,
    counts,
    directlySupportedShare: share,
  };
}
