import { createHash } from 'node:crypto';
import {
  MAX_ARCHIVES,
  MAX_CHECKED_TEXTS,
  MAX_DECISIONS,
  MAX_NOTES_PER_SECTION,
  MAX_VERSIONS_PER_SECTION,
  STUDIO_STATE_LABELS,
  isEditableState,
  type DecisionAction,
  type EditSectionInput,
  type SectionKind,
  type StudioArchive,
  type StudioChecked,
  type StudioDocument,
  type StudioProposal,
  type StudioSection,
  type StudioState,
  type TransitionInput,
} from '../../../shared/studio.js';
import type { SimulationReport } from '../../../shared/types.js';
import { AppError } from '../errors.js';

/**
 * The rules of Report Studio, as functions of the document alone: no database, no clock, no model.
 * Each takes a document and returns the next one, or refuses with an `AppError` that says why. The
 * service reads and saves; these decide. Nothing here changes the generated report.
 */

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** What makes a document stale: the generated report it was made from is no longer the project's report. */
export const reportHash = (report: SimulationReport): string => sha256(JSON.stringify(report));

/** Line endings and surrounding blank space are not edits. */
export const normaliseBody = (body: string): string => body.replace(/\r\n?/gu, '\n').trim();

/**
 * One hash over every section's identifier and text. An approval records it, so a printed memo can be
 * matched to exactly what was approved, and an approval that no longer matches is visibly not current.
 */
export function contentHash(sections: readonly Pick<StudioSection, 'id' | 'body'>[]): string {
  return sha256(sections.map((section) => `${section.id}\u0000${section.body}`).join('\u0001'));
}

// ---- Making a document from a generated report

function newSection(
  id: string,
  kind: SectionKind,
  title: string,
  body: string,
  citations: StudioSection['citations'],
  checkedByLedger: boolean,
  now: string,
): StudioSection {
  return {
    id,
    kind,
    title,
    body,
    version: 1,
    origin: 'generated',
    locked: null,
    citations,
    // The statements of generated text are the project's ledger's: they are read from it when shown.
    checked: checkedByLedger
      ? [{ hash: sha256(body), from: 'ledger', statements: [], grounding: null }]
      : [],
    notes: [],
    versions: [
      {
        version: 1,
        body,
        origin: 'generated',
        actor: 'system',
        at: now,
        reason: null,
        restoredFrom: null,
      },
    ],
  };
}

const noCitations = (): StudioSection['citations'] => ({
  sourceIds: [],
  memoryIds: [],
  interviewIds: [],
});

function sectionsOf(report: SimulationReport, now: string): StudioSection[] {
  const checked = report.grounding !== undefined;
  return [
    newSection(
      'summary',
      'summary',
      'Executive summary',
      report.executiveSummary,
      noCitations(),
      false,
      now,
    ),
    ...report.sections.slice(0, 38).map((section, index) =>
      newSection(
        `S${index + 1}`,
        'chapter',
        section.title,
        section.body,
        {
          sourceIds: section.sourceIds,
          memoryIds: section.memoryIds ?? [],
          interviewIds: section.interviewIds ?? [],
        },
        checked,
        now,
      ),
    ),
    newSection(
      'limitations',
      'limitations',
      'Limitations',
      report.limitations.join('\n'),
      noCitations(),
      false,
      now,
    ),
  ];
}

export function startDocument(
  report: SimulationReport,
  actor: string,
  now: string,
): StudioDocument {
  return {
    schemaVersion: 1,
    revision: 1,
    state: 'draft',
    baseHash: reportHash(report),
    createdAt: now,
    createdBy: actor,
    updatedAt: now,
    sections: sectionsOf(report, now),
    proposals: [],
    approval: null,
    decisions: [{ action: 'started', actor, at: now, note: null, revision: 1 }],
    archive: [],
  };
}

/** Whether anything in the document is a person's work or decision, which a restart would set aside. */
export function hasPeopleContent(doc: StudioDocument): boolean {
  return (
    doc.state !== 'draft' ||
    doc.sections.some(
      (section) => section.version > 1 || section.notes.length > 0 || section.locked !== null,
    )
  );
}

/**
 * Makes a new document from the project's newer generated report. The document it replaces is not
 * lost: its text is kept in the archive and the decision log carries over, and a person who has
 * worked on it must say they know (`confirm`).
 */
export function restartDocument(
  previous: StudioDocument,
  report: SimulationReport,
  actor: string,
  now: string,
  confirm: boolean,
): StudioDocument {
  if (previous.baseHash === reportHash(report)) {
    throw new AppError(
      409,
      'STUDIO_CURRENT',
      'This document is already made from the current generated report.',
    );
  }
  if (hasPeopleContent(previous) && !confirm) {
    throw new AppError(
      409,
      'CONFIRM_REQUIRED',
      'Starting again replaces this document, with its edits, notes and decisions, by one made from the newer generated report. The old text is kept in its archive. Confirm to continue.',
    );
  }
  const archived: StudioArchive = {
    archivedAt: now,
    actor,
    state: previous.state,
    approval: previous.approval,
    sections: previous.sections.map((section) => ({
      id: section.id,
      title: section.title,
      body: section.body,
      origin: section.origin,
      version: section.version,
    })),
  };
  const dropped = previous.archive.length >= MAX_ARCHIVES;
  const revision = previous.revision + 1;
  const fresh = startDocument(report, actor, now);
  return {
    ...fresh,
    revision,
    createdAt: previous.createdAt,
    createdBy: previous.createdBy,
    archive: [...previous.archive, archived].slice(-MAX_ARCHIVES),
    decisions: appendDecision(previous.decisions, {
      action: 'restarted',
      actor,
      at: now,
      note: dropped ? 'The oldest archived document was dropped to make room.' : null,
      revision,
    }),
  };
}

// ---- Reading

export function findSection(doc: StudioDocument, sectionId: string): StudioSection {
  const section = doc.sections.find((candidate) => candidate.id === sectionId);
  if (!section) throw new AppError(404, 'SECTION_NOT_FOUND', 'This section does not exist.');
  return section;
}

/** The statements checked against exactly the text this section holds, if any were. */
export function checkedFor(section: StudioSection): StudioChecked | undefined {
  const hash = sha256(section.body);
  return section.checked.find((entry) => entry.hash === hash);
}

// ---- Rules shared by the changes

function appendDecision(
  decisions: StudioDocument['decisions'],
  decision: StudioDocument['decisions'][number],
): StudioDocument['decisions'] {
  return [...decisions, decision].slice(-MAX_DECISIONS);
}

export function assertEditable(doc: StudioDocument): void {
  if (isEditableState(doc.state)) return;
  throw new AppError(
    409,
    'STUDIO_NOT_EDITABLE',
    doc.state === 'approved'
      ? 'This report is approved. Reopen it before changing it.'
      : 'This report is in review. Withdraw it, or wait for the reviewer, before changing it.',
  );
}

function assertUnlocked(section: StudioSection): void {
  if (section.locked) {
    throw new AppError(409, 'SECTION_LOCKED', 'This section is locked. Unlock it to change it.');
  }
}

function assertNoProposal(doc: StudioDocument, sectionId: string): void {
  if (doc.proposals.some((proposal) => proposal.sectionId === sectionId)) {
    throw new AppError(
      409,
      'PROPOSAL_PENDING',
      'Accept or reject the regenerated text for this section first.',
    );
  }
}

function assertVersion(section: StudioSection, expected: number): void {
  if (section.version !== expected) {
    throw new AppError(
      409,
      'SECTION_CONFLICT',
      'Someone else changed this section. Reload it, then make your change again.',
    );
  }
}

function replaceSection(
  doc: StudioDocument,
  section: StudioSection,
  now: string,
  patch: Partial<StudioDocument> = {},
): StudioDocument {
  return {
    ...doc,
    ...patch,
    sections: doc.sections.map((candidate) => (candidate.id === section.id ? section : candidate)),
    revision: doc.revision + 1,
    updatedAt: now,
  };
}

function withVersion(
  section: StudioSection,
  entry: {
    body: string;
    origin: StudioSection['origin'];
    actor: string;
    now: string;
    reason: string | null;
    restoredFrom?: number;
  },
): StudioSection {
  if (section.versions.length >= MAX_VERSIONS_PER_SECTION) {
    throw new AppError(
      409,
      'VERSION_LIMIT',
      `This section has reached its limit of ${MAX_VERSIONS_PER_SECTION} versions. Export the report and start from a clean one.`,
    );
  }
  const version = section.version + 1;
  return {
    ...section,
    body: entry.body,
    version,
    origin: entry.origin,
    versions: [
      ...section.versions,
      {
        version,
        body: entry.body,
        origin: entry.origin,
        actor: entry.actor,
        at: entry.now,
        reason: entry.reason,
        restoredFrom: entry.restoredFrom ?? null,
      },
    ],
  };
}

// ---- Changes a person makes to a section

export function editSection(
  doc: StudioDocument,
  sectionId: string,
  input: EditSectionInput,
  actor: string,
  now: string,
): StudioDocument {
  assertEditable(doc);
  const section = findSection(doc, sectionId);
  assertUnlocked(section);
  assertNoProposal(doc, sectionId);
  assertVersion(section, input.expectedVersion);
  const body = normaliseBody(input.body);
  if (!body) throw new AppError(400, 'SECTION_EMPTY', 'A section cannot be empty.');
  if (body === normaliseBody(section.body)) {
    throw new AppError(400, 'NO_CHANGE', 'Nothing changed.');
  }
  return replaceSection(
    doc,
    withVersion(section, { body, origin: 'human', actor, now, reason: input.reason }),
    now,
  );
}

export function setLock(
  doc: StudioDocument,
  sectionId: string,
  locked: boolean,
  actor: string,
  now: string,
): StudioDocument {
  assertEditable(doc);
  const section = findSection(doc, sectionId);
  assertNoProposal(doc, sectionId);
  if (locked === (section.locked !== null)) {
    throw new AppError(
      409,
      'NO_CHANGE',
      locked ? 'This section is already locked.' : 'This section is not locked.',
    );
  }
  return replaceSection(doc, { ...section, locked: locked ? { actor, at: now } : null }, now);
}

/** A reviewer's note. Allowed in any state: it changes no text, so it does not disturb an approval. */
export function addNote(
  doc: StudioDocument,
  sectionId: string,
  text: string,
  actor: string,
  now: string,
  noteId: string,
): StudioDocument {
  const section = findSection(doc, sectionId);
  if (section.notes.length >= MAX_NOTES_PER_SECTION) {
    throw new AppError(
      409,
      'NOTE_LIMIT',
      `This section already has ${MAX_NOTES_PER_SECTION} notes.`,
    );
  }
  return replaceSection(
    doc,
    { ...section, notes: [...section.notes, { id: noteId, actor, at: now, text }] },
    now,
  );
}

/** Brings an earlier version's text back as a new version. History is added to, never rewritten. */
export function restoreVersion(
  doc: StudioDocument,
  sectionId: string,
  input: { version: number; expectedVersion: number; reason: string | null },
  actor: string,
  now: string,
): StudioDocument {
  assertEditable(doc);
  const section = findSection(doc, sectionId);
  assertUnlocked(section);
  assertNoProposal(doc, sectionId);
  assertVersion(section, input.expectedVersion);
  const target = section.versions.find((entry) => entry.version === input.version);
  if (!target) throw new AppError(404, 'VERSION_NOT_FOUND', 'This version does not exist.');
  if (target.body === section.body) {
    throw new AppError(400, 'NO_CHANGE', 'That is the text the section already holds.');
  }
  return replaceSection(
    doc,
    withVersion(section, {
      body: target.body,
      origin: target.origin,
      actor,
      now,
      reason: input.reason,
      restoredFrom: target.version,
    }),
    now,
  );
}

// ---- Regenerated text: proposed by the model, decided by a person

/** Puts a regenerated section in front of a person. It changes nothing until they accept it. */
export function addProposal(
  doc: StudioDocument,
  proposal: StudioProposal,
  now: string,
): StudioDocument {
  assertEditable(doc);
  const section = findSection(doc, proposal.sectionId);
  assertUnlocked(section);
  assertNoProposal(doc, proposal.sectionId);
  if (section.version !== proposal.baseVersion) {
    throw new AppError(
      409,
      'SECTION_CONFLICT',
      'The section changed while the text was being written. Reload it and ask again.',
    );
  }
  return {
    ...doc,
    proposals: [...doc.proposals, proposal],
    revision: doc.revision + 1,
    updatedAt: now,
  };
}

export function decideProposal(
  doc: StudioDocument,
  sectionId: string,
  input: { decision: 'accept' | 'reject'; proposalId: string; expectedVersion: number },
  actor: string,
  now: string,
): StudioDocument {
  assertEditable(doc);
  const section = findSection(doc, sectionId);
  assertUnlocked(section);
  const proposal = doc.proposals.find(
    (candidate) => candidate.sectionId === sectionId && candidate.id === input.proposalId,
  );
  if (!proposal) {
    throw new AppError(
      404,
      'PROPOSAL_NOT_FOUND',
      'There is no such regenerated text to decide on.',
    );
  }
  assertVersion(section, input.expectedVersion);
  const remaining = doc.proposals.filter((candidate) => candidate !== proposal);
  if (input.decision === 'reject') {
    return { ...doc, proposals: remaining, revision: doc.revision + 1, updatedAt: now };
  }
  if (proposal.baseVersion !== section.version) {
    throw new AppError(
      409,
      'PROPOSAL_STALE',
      'The section changed after this text was written. Reject it and regenerate.',
    );
  }
  if (section.checked.length >= MAX_CHECKED_TEXTS) {
    throw new AppError(
      409,
      'CHECKED_LIMIT',
      'This section has used up the regenerated texts it can keep checked statements for.',
    );
  }
  const next = withVersion(section, {
    body: proposal.body,
    origin: 'regenerated',
    actor,
    now,
    reason: proposal.instruction
      ? `Regenerated: ${proposal.instruction}`.slice(0, 300)
      : 'Regenerated',
  });
  const checked: StudioChecked = {
    hash: sha256(proposal.body),
    from: 'section',
    statements: proposal.statements,
    grounding: proposal.grounding,
  };
  return replaceSection(
    doc,
    { ...next, checked: [...next.checked.filter((entry) => entry.hash !== checked.hash), checked] },
    now,
    { proposals: remaining },
  );
}

// ---- The review workflow

export type Transition = 'submit' | 'approve' | 'request-changes' | 'reopen';

const FROM: Record<Transition, readonly StudioState[]> = {
  submit: ['draft', 'changes-requested'],
  approve: ['in-review'],
  'request-changes': ['in-review'],
  reopen: ['in-review', 'approved'],
};

const TO: Record<Transition, StudioState> = {
  submit: 'in-review',
  approve: 'approved',
  'request-changes': 'changes-requested',
  reopen: 'draft',
};

const ACTION: Record<Transition, DecisionAction> = {
  submit: 'submitted',
  approve: 'approved',
  'request-changes': 'changes-requested',
  reopen: 'reopened',
};

const NEEDS_NOTE: ReadonlySet<Transition> = new Set(['request-changes', 'reopen']);

export function transition(
  doc: StudioDocument,
  kind: Transition,
  input: TransitionInput,
  actor: string,
  now: string,
): StudioDocument {
  if (doc.revision !== input.expectedRevision) {
    throw new AppError(
      409,
      'STUDIO_CHANGED',
      'The report changed after you opened it. Reload it and look again before deciding.',
    );
  }
  if (!FROM[kind].includes(doc.state)) {
    throw new AppError(
      409,
      'STUDIO_STATE',
      `This report is ${STUDIO_STATE_LABELS[doc.state].toLowerCase()}; that needs it to be ${FROM[
        kind
      ]
        .map((state) => STUDIO_STATE_LABELS[state].toLowerCase())
        .join(' or ')}.`,
    );
  }
  if (NEEDS_NOTE.has(kind) && (input.note?.trim().length ?? 0) < 3) {
    throw new AppError(400, 'NOTE_REQUIRED', 'Say why: a note is required.');
  }
  if (kind === 'submit' && doc.proposals.length > 0) {
    throw new AppError(
      409,
      'PROPOSAL_PENDING',
      'Accept or reject the regenerated text before submitting the report for review.',
    );
  }
  const revision = doc.revision + 1;
  return {
    ...doc,
    state: TO[kind],
    revision,
    updatedAt: now,
    approval:
      kind === 'approve'
        ? {
            actor,
            at: now,
            revision,
            contentHash: contentHash(doc.sections),
            alsoEdited: doc.sections.some((section) =>
              section.versions.some((version) => version.actor === actor),
            ),
          }
        : null,
    decisions: appendDecision(doc.decisions, {
      action: ACTION[kind],
      actor,
      at: now,
      note: input.note,
      revision,
    }),
  };
}

/** Whether an approval is still of the text that is there: it is not if anything changed behind it. */
export function approvalCurrent(doc: StudioDocument): boolean {
  return doc.approval !== null && doc.approval.contentHash === contentHash(doc.sections);
}
