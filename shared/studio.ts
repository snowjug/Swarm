import { z } from 'zod';
import {
  claimRecordSchema,
  type ClaimRecord,
  type ContradictionRecord,
  type LedgerAssumption,
} from './evidence.js';
import type { SimulationMemory } from './guided.js';
import type { EvidenceChunk } from './types.js';

/**
 * Report Studio: where a person works on a generated report. The generated report is never changed;
 * the studio holds a document made from it, with the people's edits, notes, locks, versions and the
 * approval. A section a person has edited is theirs: it is shown as written by a person, and the
 * statements the server checked are shown as describing the generated text, not the edited one.
 */

/**
 * `draft` and `changes-requested` can be edited. `in-review` is frozen so that a reviewer approves
 * what they read, and `approved` is frozen so that nothing changes an approved report without a
 * person reopening it first.
 */
export const STUDIO_STATES = ['draft', 'in-review', 'changes-requested', 'approved'] as const;
export type StudioState = (typeof STUDIO_STATES)[number];

export const STUDIO_STATE_LABELS: Record<StudioState, string> = {
  draft: 'Draft',
  'in-review': 'In review',
  'changes-requested': 'Changes requested',
  approved: 'Approved',
};

export function isEditableState(state: StudioState): boolean {
  return state === 'draft' || state === 'changes-requested';
}

export const SECTION_KINDS = ['summary', 'chapter', 'limitations'] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

/** Who wrote the text a section holds now. */
export const SECTION_ORIGINS = ['generated', 'human', 'regenerated'] as const;
export type SectionOrigin = (typeof SECTION_ORIGINS)[number];

export const SECTION_ORIGIN_LABELS: Record<SectionOrigin, string> = {
  generated: 'Generated',
  human: 'Written by a person',
  regenerated: 'Regenerated, then accepted',
};

export const MAX_SECTION_BODY = 12_000;
export const MAX_REASON = 300;
export const MAX_NOTE = 1_000;
export const MAX_NOTES_PER_SECTION = 50;
/** A section keeps every version it has had, so the number is bounded rather than the history pruned. */
export const MAX_VERSIONS_PER_SECTION = 100;
export const MAX_INSTRUCTION = 500;
export const MAX_DECISIONS = 500;
export const MAX_ARCHIVES = 3;

/** The section identifiers: the summary, the chapters in order, and the limitations. */
export const SECTION_ID = /^(?:summary|limitations|S\d{1,2})$/u;
export const sectionIdSchema = z.string().regex(SECTION_ID);

const text = z.string().max(MAX_SECTION_BODY);
const actor = z.string().min(1).max(200);
const when = z.string().min(10).max(40);

const versionSchema = z.object({
  version: z.int().positive(),
  body: text,
  origin: z.enum(SECTION_ORIGINS),
  actor,
  at: when,
  reason: z.string().max(MAX_REASON).nullable(),
  /** Set when this version is an earlier version brought back. */
  restoredFrom: z.int().positive().nullable(),
});
export type StudioVersion = z.infer<typeof versionSchema>;

const noteSchema = z.object({
  id: z.string().min(1).max(40),
  actor,
  at: when,
  text: z.string().min(1).max(MAX_NOTE),
});
export type StudioNote = z.infer<typeof noteSchema>;

const lockSchema = z.object({ actor, at: when });
export type StudioLock = z.infer<typeof lockSchema>;

/** What the server found when it checked a chapter's statements. Counts, and what could not be checked. */
const groundingSchema = z.object({
  method: z.enum(['deterministic', 'deterministic+model']),
  checkedAt: when,
  counts: z.object({
    supported: z.int().nonnegative(),
    partial: z.int().nonnegative(),
    unsupported: z.int().nonnegative(),
    contradicted: z.int().nonnegative(),
    unchecked: z.int().nonnegative(),
  }),
  /** Figures in the text that appear neither in the cited material nor in the recorded simulation. */
  unverifiedFigures: z.array(z.string().max(80)).max(40),
  notes: z.array(z.string().max(500)).max(20),
});
export type StudioGrounding = z.infer<typeof groundingSchema>;

/**
 * Statements the server checked, and the text they were checked against (by hash). A section may be
 * checked against several texts over its life; the statements it shows are those of the text it holds.
 * `ledger` means the project's ledger holds them, and is read when they are shown.
 */
const checkedSchema = z.object({
  hash: z.string().length(64),
  from: z.enum(['ledger', 'section']),
  statements: z.array(claimRecordSchema).max(40),
  grounding: groundingSchema.nullable(),
});
export type StudioChecked = z.infer<typeof checkedSchema>;
export const MAX_CHECKED_TEXTS = 10;

const sectionSchema = z.object({
  id: sectionIdSchema,
  kind: z.enum(SECTION_KINDS),
  title: z.string().min(1).max(200),
  body: text,
  /** The current version number: the version of the last entry in `versions`. */
  version: z.int().positive(),
  origin: z.enum(SECTION_ORIGINS),
  locked: lockSchema.nullable(),
  citations: z.object({
    sourceIds: z.array(z.string().max(40)).max(40),
    memoryIds: z.array(z.string().max(40)).max(40),
    interviewIds: z.array(z.string().max(40)).max(40),
  }),
  checked: z.array(checkedSchema).max(MAX_CHECKED_TEXTS),
  notes: z.array(noteSchema).max(MAX_NOTES_PER_SECTION),
  versions: z.array(versionSchema).min(1).max(MAX_VERSIONS_PER_SECTION),
});
export type StudioSection = z.infer<typeof sectionSchema>;

const proposalSchema = z.object({
  id: z.string().min(1).max(60),
  sectionId: sectionIdSchema,
  /** The version of the section this was written to replace. Another version makes it stale. */
  baseVersion: z.int().positive(),
  body: text,
  statements: z.array(claimRecordSchema).max(40),
  grounding: groundingSchema,
  instruction: z.string().max(MAX_INSTRUCTION).nullable(),
  actor,
  at: when,
  usage: z.object({
    modelCalls: z.int().nonnegative(),
    inputTokens: z.int().nonnegative(),
    outputTokens: z.int().nonnegative(),
  }),
});
export type StudioProposal = z.infer<typeof proposalSchema>;

export const DECISION_ACTIONS = [
  'started',
  'submitted',
  'approved',
  'changes-requested',
  'reopened',
  'restarted',
] as const;
export type DecisionAction = (typeof DECISION_ACTIONS)[number];

export const DECISION_LABELS: Record<DecisionAction, string> = {
  started: 'Opened in the studio',
  submitted: 'Submitted for review',
  approved: 'Approved',
  'changes-requested': 'Changes requested',
  reopened: 'Reopened',
  restarted: 'Restarted from a newer generated report',
};

const decisionSchema = z.object({
  action: z.enum(DECISION_ACTIONS),
  actor,
  at: when,
  note: z.string().max(MAX_NOTE).nullable(),
  /** The document revision this produced. */
  revision: z.int().positive(),
});
export type StudioDecision = z.infer<typeof decisionSchema>;

const approvalSchema = z.object({
  actor,
  at: when,
  revision: z.int().positive(),
  /** SHA-256 over every section's identifier and text, so a printed memo can be matched to what was approved. */
  contentHash: z.string().length(64),
  /** Whether the approver also wrote part of the text they approved. The record says so; it does not forbid it. */
  alsoEdited: z.boolean(),
});
export type StudioApproval = z.infer<typeof approvalSchema>;

/** What a restart keeps of the document it replaces: the text, not the whole history. */
const archiveSchema = z.object({
  archivedAt: when,
  actor,
  state: z.enum(STUDIO_STATES),
  approval: approvalSchema.nullable(),
  sections: z
    .array(
      z.object({
        id: sectionIdSchema,
        title: z.string().max(200),
        body: text,
        origin: z.enum(SECTION_ORIGINS),
        version: z.int().positive(),
      }),
    )
    .max(40),
});
export type StudioArchive = z.infer<typeof archiveSchema>;

export const studioDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  /** Increases by one with every change to the document. */
  revision: z.int().positive(),
  state: z.enum(STUDIO_STATES),
  /** SHA-256 of the generated report the document was made from. Another report makes the document stale. */
  baseHash: z.string().length(64),
  createdAt: when,
  createdBy: actor,
  updatedAt: when,
  sections: z.array(sectionSchema).min(1).max(40),
  /** At most one per section. */
  proposals: z.array(proposalSchema).max(40),
  approval: approvalSchema.nullable(),
  decisions: z.array(decisionSchema).max(MAX_DECISIONS),
  archive: z.array(archiveSchema).max(MAX_ARCHIVES),
});
export type StudioDocument = z.infer<typeof studioDocumentSchema>;

// ---- What a caller may send. Every body is strict: an unknown field is refused, not ignored.

const reasonField = z.string().trim().max(MAX_REASON).nullable().default(null);
const noteField = z.string().trim().max(MAX_NOTE).nullable().default(null);

export const editSectionSchema = z
  .object({
    body: z.string().max(MAX_SECTION_BODY),
    /** The version the person was looking at. Another current version is a conflict, never an overwrite. */
    expectedVersion: z.int().positive(),
    reason: reasonField,
  })
  .strict();
export type EditSectionInput = z.output<typeof editSectionSchema>;

export const lockSectionSchema = z.object({ locked: z.boolean() }).strict();

export const addNoteSchema = z.object({ text: z.string().trim().min(1).max(MAX_NOTE) }).strict();

export const restoreVersionSchema = z
  .object({
    version: z.int().positive(),
    expectedVersion: z.int().positive(),
    reason: reasonField,
  })
  .strict();

export const regenerateSchema = z
  .object({
    expectedVersion: z.int().positive(),
    /** What the person wants emphasised. Data for the model, never an instruction that outranks the rules. */
    instruction: z.string().trim().max(MAX_INSTRUCTION).nullable().default(null),
  })
  .strict();

export const proposalDecisionSchema = z
  .object({
    decision: z.enum(['accept', 'reject']),
    proposalId: z.string().min(1).max(60),
    expectedVersion: z.int().positive(),
  })
  .strict();

/** The document revision the person was looking at, and a note where the transition needs one. */
export const transitionSchema = z
  .object({ expectedRevision: z.int().positive(), note: noteField })
  .strict();
export type TransitionInput = z.output<typeof transitionSchema>;

export const startStudioSchema = z.object({ confirm: z.boolean().default(false) }).strict();
export type StartStudioInput = z.output<typeof startStudioSchema>;

export const EXPORT_FORMATS = ['markdown', 'json', 'memo'] as const;
export type StudioExportFormat = (typeof EXPORT_FORMATS)[number];

// ---- What the server answers with. Plain data the console draws.

export interface StudioCapabilities {
  edit: boolean;
  review: boolean;
  export: boolean;
}

export interface StudioSectionView extends Omit<StudioSection, 'checked'> {
  /**
   * The statements to show. Those of the text the section holds now when it has been checked, else
   * those of the last text it was checked against, with `statementsCurrent` false.
   */
  statements: ClaimRecord[];
  /** Whether the statements were checked against the text as it is now. */
  statementsCurrent: boolean;
  /** What the server found when it checked the text, when the section was regenerated. */
  grounding: StudioGrounding | null;
  proposal: StudioProposal | null;
}

export interface StudioView {
  /** Null until someone opens the report in the studio. */
  document:
    | (Omit<StudioDocument, 'sections' | 'proposals'> & {
        sections: StudioSectionView[];
      })
    | null;
  /** The generated report has been replaced since the document was made, so it cannot be changed. */
  stale: boolean;
  /** There is a generated report to open. Without one there is nothing to work on. */
  reportReady: boolean;
  capabilities: StudioCapabilities;
  regeneration: { available: boolean; reason: string | null };
  /** Whole passages cited by any statement shown, so that evidence can be read without another request. */
  passages: EvidenceChunk[];
  memories: SimulationMemory[];
  assumptions: LedgerAssumption[];
  /** Conflicts between sources that are still open. */
  conflicts: ContradictionRecord[];
  report: { title: string; question: string; engine: 'local' | 'llm' } | null;
  limits: {
    maxBody: number;
    maxNote: number;
    maxVersions: number;
    maxInstruction: number;
  };
}
