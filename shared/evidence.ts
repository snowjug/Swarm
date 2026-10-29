import { z } from 'zod';
import { CLAIM_KINDS, SUPPORT_VERDICTS } from './grounding.js';

/**
 * The ten things a statement in a decision output can be. They are never merged: the label travels
 * with the statement so a reader always knows whether they are looking at a source, an input, a
 * model guess, a simulated event or a recommendation.
 */
export const STATEMENT_TYPES = [
  'source-fact',
  'extracted-claim',
  'user-assumption',
  'inferred-relationship',
  'ai-hypothesis',
  'simulated-event',
  'analytical-conclusion',
  'recommendation',
  'contradicting-evidence',
  'unresolved-uncertainty',
] as const;
export type StatementType = (typeof STATEMENT_TYPES)[number];

export const STATEMENT_TYPE_LABELS: Record<StatementType, string> = {
  'source-fact': 'Source fact',
  'extracted-claim': 'Extracted claim',
  'user-assumption': 'User assumption',
  'inferred-relationship': 'Inferred relationship',
  'ai-hypothesis': 'AI hypothesis',
  'simulated-event': 'Simulated event',
  'analytical-conclusion': 'Analytical conclusion',
  recommendation: 'Recommendation',
  'contradicting-evidence': 'Contradicting evidence',
  'unresolved-uncertainty': 'Unresolved uncertainty',
};

/** How well the project's own evidence backs a statement. This is not a claim that it is true. */
export const SUPPORT_CLASSES = [
  'directly-supported',
  'partially-supported',
  'contradicted',
  'unsupported',
  'not-applicable',
  'not-checkable',
  'simulation-derived',
  'assumption-dependent',
] as const;
export type SupportClass = (typeof SUPPORT_CLASSES)[number];

export const SUPPORT_CLASS_LABELS: Record<SupportClass, string> = {
  'directly-supported': 'Directly supported',
  'partially-supported': 'Partially supported',
  contradicted: 'Contradicted',
  unsupported: 'Unsupported',
  'not-applicable': 'Not applicable',
  'not-checkable': 'Not checkable',
  'simulation-derived': 'Simulation derived',
  'assumption-dependent': 'Assumption dependent',
};

export const SUPPORT_CLASS_MEANINGS: Record<SupportClass, string> = {
  'directly-supported': 'A cited source passage states this. May be presented as a finding.',
  'partially-supported': 'A cited passage backs only part of it. Presented with a qualification.',
  contradicted: 'A passage conflicts with it. Presented together with the contradiction.',
  unsupported: 'No cited passage backs it. Shown only as a hypothesis, never as a finding.',
  'not-applicable':
    'An input or note, such as an assumption you chose. It is not a claim to verify.',
  'not-checkable': 'The system cannot check it. Never shown as verified.',
  'simulation-derived': 'Produced by the simulation, not observed. Never shown as a source fact.',
  'assumption-dependent': 'Holds only if a named assumption holds. Presented with that assumption.',
};

/** What the product may do with a statement, decided by deterministic policy, never by a model. */
export const PUBLICATION_STATUSES = [
  'finding',
  'qualified',
  'contradiction-shown',
  'labelled-hypothesis',
  'labelled-simulation',
  'labelled-unverified',
  'input',
  'withheld',
] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

export const PUBLICATION_STATUS_LABELS: Record<PublicationStatus, string> = {
  finding: 'Finding',
  qualified: 'Qualified finding',
  'contradiction-shown': 'Shown with its contradiction',
  'labelled-hypothesis': 'Labelled hypothesis',
  'labelled-simulation': 'Labelled simulation result',
  'labelled-unverified': 'Labelled not verified',
  input: 'Input, not a finding',
  withheld: 'Withheld',
};

export const REVIEW_RESULTS = ['pending', 'accepted', 'rejected', 'needs-revision'] as const;
export type ReviewResult = (typeof REVIEW_RESULTS)[number];

export const REVIEW_RESULT_LABELS: Record<ReviewResult, string> = {
  pending: 'Awaiting review',
  accepted: 'Accepted by a reviewer',
  rejected: 'Rejected by a reviewer',
  'needs-revision': 'Needs revision',
};

export const MAX_REVIEW_NOTE_LENGTH = 1_000;

/** A pointer to the exact source text behind a statement, with enough to check it independently. */
export interface EvidenceRef {
  passageId: string;
  documentId: string;
  documentName: string;
  /** Character offsets of the whole passage inside its document. */
  start: number;
  end: number;
  /** An excerpt that was found verbatim in the passage. Null when none was supplied or matched. */
  quote: string | null;
  /** SHA-256 of the passage text, so a later edit to a source cannot silently change what was cited. */
  contentHash: string;
  role: 'supports' | 'contradicts';
  /** Set when this evidence comes from a conflict between sources, so it can be recalculated. */
  conflictId?: string;
}

export interface SimulationRef {
  memoryId: string;
  platform: string;
  round: number;
}

export interface ClaimHistoryEntry {
  version: number;
  at: string;
  actor: 'system' | 'reviewer';
  change: string;
}

export interface ClaimReview {
  result: ReviewResult;
  note: string | null;
  reviewedAt: string | null;
}

export interface ClaimVerification {
  method: 'deterministic' | 'deterministic+model';
  verdict: (typeof SUPPORT_VERDICTS)[number];
  reason: string;
  quote: 'found' | 'not-found' | null;
  overlap: number | null;
  numbers: 'match' | 'mismatch' | null;
  entailment: 'supports' | 'partial' | 'contradicts' | 'not-supported' | null;
}

export interface ClaimPublication {
  status: PublicationStatus;
  /** Words that must accompany the statement wherever it is shown. Null when none are needed. */
  qualification: string | null;
  reasons: string[];
}

/** Every material analytical statement, with the lineage needed to audit it. */
export interface ClaimRecord {
  id: string;
  version: number;
  statementType: StatementType;
  text: string;
  section: string;
  generationStage: 'report' | 'analysis' | 'chat';
  supportClass: SupportClass;
  supporting: EvidenceRef[];
  contradicting: EvidenceRef[];
  assumptionIds: string[];
  simulationEvents: SimulationRef[];
  lineage: { projectId: string; parentId: string | null; branchFromRound: number | null };
  verification: ClaimVerification;
  review: ClaimReview;
  publication: ClaimPublication;
  history: ClaimHistoryEntry[];
}

export const reviewInputSchema = z.object({
  result: z.enum(
    REVIEW_RESULTS.filter((result) => result !== 'pending') as [ReviewResult, ...ReviewResult[]],
  ),
  note: z.string().trim().max(MAX_REVIEW_NOTE_LENGTH).nullable().default(null),
});
export type ReviewInput = z.output<typeof reviewInputSchema>;

const evidenceRefSchema: z.ZodType<EvidenceRef> = z.object({
  passageId: z.string(),
  documentId: z.string(),
  documentName: z.string(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  quote: z.string().nullable(),
  contentHash: z.string(),
  role: z.enum(['supports', 'contradicts']),
  conflictId: z.string().optional(),
});

/** Validates a stored record when it is loaded, so a corrupted row fails loudly instead of rendering. */
export const claimRecordSchema: z.ZodType<ClaimRecord> = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  statementType: z.enum(STATEMENT_TYPES),
  text: z.string(),
  section: z.string(),
  generationStage: z.enum(['report', 'analysis', 'chat']),
  supportClass: z.enum(SUPPORT_CLASSES),
  supporting: z.array(evidenceRefSchema),
  contradicting: z.array(evidenceRefSchema),
  assumptionIds: z.array(z.string()),
  simulationEvents: z.array(
    z.object({ memoryId: z.string(), platform: z.string(), round: z.number().int() }),
  ),
  lineage: z.object({
    projectId: z.string(),
    parentId: z.string().nullable(),
    branchFromRound: z.number().int().nullable(),
  }),
  verification: z.object({
    method: z.enum(['deterministic', 'deterministic+model']),
    verdict: z.enum(SUPPORT_VERDICTS),
    reason: z.string(),
    quote: z.enum(['found', 'not-found']).nullable(),
    overlap: z.number().nullable(),
    numbers: z.enum(['match', 'mismatch']).nullable(),
    entailment: z.enum(['supports', 'partial', 'contradicts', 'not-supported']).nullable(),
  }),
  review: z.object({
    result: z.enum(REVIEW_RESULTS),
    note: z.string().nullable(),
    reviewedAt: z.string().nullable(),
  }),
  publication: z.object({
    status: z.enum(PUBLICATION_STATUSES),
    qualification: z.string().nullable(),
    reasons: z.array(z.string()),
  }),
  history: z.array(
    z.object({
      version: z.number().int().positive(),
      at: z.string(),
      actor: z.enum(['system', 'reviewer']),
      change: z.string(),
    }),
  ),
});

export function emptySupportCounts(): Record<SupportClass, number> {
  return Object.fromEntries(SUPPORT_CLASSES.map((support) => [support, 0])) as Record<
    SupportClass,
    number
  >;
}

/** The ways the existing report writer may label a claim map straight onto statement types. */
export function statementTypeOfKind(kind: (typeof CLAIM_KINDS)[number]): StatementType {
  return kind;
}

/**
 * Whether the evidence is strong enough to put a recommendation in front of a decision maker.
 * The rule is deliberately simple, documented and tested, because a model must never decide it.
 */
export interface EvidenceSufficiency {
  level: 'sufficient' | 'limited' | 'insufficient';
  reasons: string[];
  counts: Record<SupportClass, number>;
  /** Directly supported share of the statements that rest on a source, 0..1. Null when none do. */
  directlySupportedShare: number | null;
}

export const CONTRADICTION_KINDS = ['numeric', 'polarity'] as const;
export type ContradictionKind = (typeof CONTRADICTION_KINDS)[number];

/** `detected` is a candidate. Only a person (or an independent check) confirms or dismisses it. */
export const CONTRADICTION_STATUSES = ['detected', 'confirmed', 'dismissed', 'resolved'] as const;
export type ContradictionStatus = (typeof CONTRADICTION_STATUSES)[number];

export const CONTRADICTION_STATUS_LABELS: Record<ContradictionStatus, string> = {
  detected: 'Possible conflict',
  confirmed: 'Confirmed conflict',
  dismissed: 'Dismissed',
  resolved: 'Resolved',
};

/** Open conflicts weigh on the claims they touch. A dismissed or resolved one does not. */
export function isOpenConflict(status: ContradictionStatus): boolean {
  return status === 'detected' || status === 'confirmed';
}

/** Two statements in the project's sources that seem to be about the same thing yet disagree. */
export interface ContradictionRecord {
  id: string;
  kind: ContradictionKind;
  /** The words the two statements share: what they are both about. */
  topic: string;
  left: EvidenceRef;
  right: EvidenceRef;
  /** The figures that differ, as written. Null for a conflict of meaning rather than of number. */
  leftValue: string | null;
  rightValue: string | null;
  /** 0..1. How alike the two statements are, which is how likely they describe the same thing. */
  confidence: number;
  status: ContradictionStatus;
  note: string | null;
  detectedBy: 'deterministic-v1';
  createdAt: string;
  updatedAt: string;
}

export const contradictionReviewSchema = z.object({
  status: z.enum(['confirmed', 'dismissed', 'resolved']),
  note: z.string().trim().max(MAX_REVIEW_NOTE_LENGTH).nullable().default(null),
});
export type ContradictionReviewInput = z.output<typeof contradictionReviewSchema>;

export const contradictionRecordSchema: z.ZodType<ContradictionRecord> = z.object({
  id: z.string(),
  kind: z.enum(CONTRADICTION_KINDS),
  topic: z.string(),
  left: evidenceRefSchema,
  right: evidenceRefSchema,
  leftValue: z.string().nullable(),
  rightValue: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  status: z.enum(CONTRADICTION_STATUSES),
  note: z.string().nullable(),
  detectedBy: z.literal('deterministic-v1'),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** Everything the ledger holds for one project. */
export interface Ledger {
  claims: ClaimRecord[];
  contradictions: ContradictionRecord[];
  sufficiency: EvidenceSufficiency;
  /** When the grounding review that the statements came from was run. Null: no review exists. */
  reviewedAt: string | null;
}
