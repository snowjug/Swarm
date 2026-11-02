import type { ClaimRecord, SupportClass } from '../../../../shared/evidence';
import { SUPPORT_CLASSES } from '../../../../shared/evidence';
import {
  SECTION_ORIGIN_LABELS,
  STUDIO_STATE_LABELS,
  isEditableState,
  type StudioSectionView,
  type StudioState,
  type StudioView,
} from '../../../../shared/studio';
import { writtenByPerson } from '../../lib/studio';

export type StudioDocument = NonNullable<StudioView['document']>;

/** What the studio is headed with once it is read: the title of the report it works on. */
export const studioTitle = (report: { title: string } | null | undefined): string =>
  report?.title ?? 'Report';

// ---- Sections ------------------------------------------------------------------------------------

/** The number of a chapter (`S3` is chapter 3); the summary and the limitations have none. */
export function chapterNumber(section: Pick<StudioSectionView, 'id' | 'kind'>): number | null {
  if (section.kind !== 'chapter') return null;
  const digits = /^S(\d+)$/u.exec(section.id)?.[1];
  return digits ? Number(digits) : null;
}

/** The small line above a section's title: which chapter it is. The summary and the limitations are named by their titles. */
export function sectionKicker(section: Pick<StudioSectionView, 'id' | 'kind'>): string | null {
  const number = chapterNumber(section);
  return number === null ? null : `Chapter ${number}`;
}

export type MarkKind = 'unsaved' | 'rewrite' | 'locked' | 'earlier' | 'notes' | 'person';

export interface SectionMark {
  kind: MarkKind;
  /** In words, for a screen reader and a tooltip: a glyph alone never carries the meaning. */
  label: string;
  count?: number;
}

/** What a reader should know about a section before opening it, most pressing first. */
export function sectionMarks(
  section: StudioSectionView,
  options: { unsaved?: boolean } = {},
): SectionMark[] {
  const marks: SectionMark[] = [];
  if (options.unsaved) marks.push({ kind: 'unsaved', label: 'Unsaved changes' });
  if (section.proposal) marks.push({ kind: 'rewrite', label: 'Rewrite waiting for a decision' });
  if (section.locked) marks.push({ kind: 'locked', label: 'Locked' });
  if (section.statements.length > 0 && !section.statementsCurrent) {
    marks.push({ kind: 'earlier', label: 'Statements describe an earlier text' });
  }
  if (section.notes.length > 0) {
    marks.push({
      kind: 'notes',
      count: section.notes.length,
      label: `${section.notes.length} ${section.notes.length === 1 ? 'note' : 'notes'}`,
    });
  }
  if (writtenByPerson(section))
    marks.push({ kind: 'person', label: SECTION_ORIGIN_LABELS[section.origin] });
  return marks;
}

export const describeMarks = (marks: readonly SectionMark[]): string =>
  marks.map((mark) => mark.label).join('. ');

export type ToolId = 'statements' | 'notes' | 'history' | 'rewrite';

/** The tools a section has: a chapter has all four; the summary and the limitations have notes and history. */
export function toolsOf(section: Pick<StudioSectionView, 'kind'>): ToolId[] {
  return section.kind === 'chapter'
    ? ['statements', 'notes', 'history', 'rewrite']
    : ['notes', 'history'];
}

export interface Authorship {
  generated: number;
  human: number;
  regenerated: number;
  total: number;
}

/** Who wrote the text the document holds now, section by section. */
export function authorship(sections: readonly Pick<StudioSectionView, 'origin'>[]): Authorship {
  const result: Authorship = { generated: 0, human: 0, regenerated: 0, total: sections.length };
  for (const section of sections) result[section.origin] += 1;
  return result;
}

export function neighbour(
  sections: readonly Pick<StudioSectionView, 'id'>[],
  id: string,
  delta: -1 | 1,
): string | null {
  const index = sections.findIndex((section) => section.id === id);
  if (index < 0) return null;
  return sections[index + delta]?.id ?? null;
}

// ---- The review workflow -----------------------------------------------------------------------

export type WorkflowId = 'draft' | 'review' | 'approved';
export type WorkflowTone = 'neutral' | 'accent' | 'caution' | 'favor';

export interface WorkflowStep {
  id: WorkflowId;
  label: string;
  status: 'done' | 'current' | 'upcoming';
  tone: WorkflowTone;
}

/**
 * The three places a report passes through, and where it is. A report sent back for changes is
 * back at the first place, and says why in its name.
 */
export function workflowSteps(state: StudioState): WorkflowStep[] {
  const at: Record<StudioState, number> = {
    draft: 0,
    'changes-requested': 0,
    'in-review': 1,
    approved: 2,
  };
  const index = at[state];
  const labels: [string, string, string] = [
    state === 'changes-requested'
      ? STUDIO_STATE_LABELS['changes-requested']
      : STUDIO_STATE_LABELS.draft,
    STUDIO_STATE_LABELS['in-review'],
    STUDIO_STATE_LABELS.approved,
  ];
  const ids: WorkflowId[] = ['draft', 'review', 'approved'];
  return ids.map((id, position) => {
    const current = position === index;
    const tone: WorkflowTone = !current
      ? 'neutral'
      : state === 'changes-requested'
        ? 'caution'
        : state === 'approved'
          ? 'favor'
          : 'accent';
    return {
      id,
      label: labels[position]!,
      status: position < index ? 'done' : current ? 'current' : 'upcoming',
      tone,
    };
  });
}

export type FrozenAction = 'reopen' | 'withdraw' | 'restart';

export interface Frozen {
  kind: 'stale' | 'read-only' | 'in-review' | 'approved';
  text: string;
  action: FrozenAction | null;
}

/** The few words that stand where Edit would be, when the text cannot be changed. */
export const FROZEN_LABEL: Record<Frozen['kind'], string> = {
  stale: 'Out of date',
  'read-only': 'Read only',
  'in-review': 'Frozen while in review',
  approved: 'Approved: reopen to change',
};

/** Why the text cannot be changed right now, and the one thing that would change that. */
export function frozenReason(view: StudioView, document: StudioDocument): Frozen | null {
  if (view.stale) {
    return {
      kind: 'stale',
      text: 'The generated report was replaced, so this working copy can be read and exported but not changed.',
      action: view.capabilities.edit && view.reportReady ? 'restart' : null,
    };
  }
  if (!view.capabilities.edit) {
    return {
      kind: 'read-only',
      text: 'You can read this report. Changing it needs the analyst or lead role.',
      action: null,
    };
  }
  if (document.state === 'approved') {
    return { kind: 'approved', text: 'Approved. Reopen it to change the text.', action: 'reopen' };
  }
  if (document.state === 'in-review') {
    return {
      kind: 'in-review',
      text: 'In review, so the text is frozen: a reviewer approves what they read.',
      action: 'withdraw',
    };
  }
  return null;
}

export interface SectionAccess {
  /** The document can be changed by this person right now. */
  editable: boolean;
  /** This section's text can be changed: it is editable, unlocked and has no rewrite waiting. */
  canWrite: boolean;
  /** Why the text cannot be changed, when it is the section and not the document that says no. */
  blocked: string | null;
}

export function sectionAccess(
  view: StudioView,
  document: StudioDocument,
  section: Pick<StudioSectionView, 'locked' | 'proposal'>,
): SectionAccess {
  const editable = view.capabilities.edit && isEditableState(document.state) && !view.stale;
  const canWrite = editable && !section.locked && !section.proposal;
  const blocked = !editable
    ? null
    : section.proposal
      ? 'A rewrite is waiting. Accept or reject it first.'
      : section.locked
        ? 'This section is locked. Unlock it to change it.'
        : null;
  return { editable, canWrite, blocked };
}

export const waitingProposals = (document: Pick<StudioDocument, 'sections'>): StudioSectionView[] =>
  document.sections.filter((section) => section.proposal !== null);

/** Why the report cannot be submitted yet, or null when it can. */
export function submitBlocker(view: StudioView, document: StudioDocument): string | null {
  if (view.stale) return 'The generated report was replaced.';
  const waiting = waitingProposals(document);
  const first = waiting[0];
  if (!first) return null;
  return waiting.length === 1
    ? `Accept or reject the rewrite of “${first.title}” before submitting.`
    : `Accept or reject the ${waiting.length} waiting rewrites before submitting.`;
}

// ---- Drafts and concurrency ---------------------------------------------------------------------

/** Text a person is writing in a section: kept while they look at another, until they save or drop it. */
export interface Draft {
  text: string;
  reason: string;
  /** The version of the section the person began from, and its text then. */
  baseVersion: number;
  baseBody: string;
}

export type DraftState = 'none' | 'clean' | 'dirty' | 'behind';

export const startDraft = (section: Pick<StudioSectionView, 'body' | 'version'>): Draft => ({
  text: section.body,
  reason: '',
  baseVersion: section.version,
  baseBody: section.body,
});

/** Line endings and the white space around a text are not a change; the server counts them the same way. */
export const normalise = (text: string): string => text.replace(/\r\n?/gu, '\n').trim();

export const isDirty = (draft: Draft | undefined): boolean =>
  draft !== undefined && normalise(draft.text) !== normalise(draft.baseBody);

/**
 * `behind`: the person has written something and the section has since moved on (someone else saved a
 * version); their words are kept and nothing is overwritten unless they say so.
 */
export function draftState(
  draft: Draft | undefined,
  section: Pick<StudioSectionView, 'version'>,
): DraftState {
  if (!draft) return 'none';
  if (!isDirty(draft)) return 'clean';
  return draft.baseVersion === section.version ? 'dirty' : 'behind';
}

/** A draft nobody has written in follows the section; one with words in it never moves by itself. */
export function rebase(draft: Draft, section: Pick<StudioSectionView, 'body' | 'version'>): Draft {
  return isDirty(draft) || draft.baseVersion === section.version ? draft : startDraft(section);
}

export interface SaveCheck {
  ok: boolean;
  reason: string | null;
}

export function checkDraft(
  draft: Draft,
  section: Pick<StudioSectionView, 'body'>,
  limits: { maxBody: number },
): SaveCheck {
  if (draft.text.length > limits.maxBody) return { ok: false, reason: 'Too long for one section.' };
  if (!draft.text.trim()) return { ok: false, reason: 'A section cannot be empty.' };
  if (normalise(draft.text) === normalise(section.body))
    return { ok: false, reason: 'Nothing has changed.' };
  return { ok: true, reason: null };
}

// ---- Text -----------------------------------------------------------------------------------------

/** The paragraphs of a section: blank lines separate them; a single line break stays inside one. */
export function paragraphs(body: string): string[] {
  return body
    .replace(/\r\n?/gu, '\n')
    .split(/\n{2,}/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** The lines of a list (the limitations are one entry to a line). */
export function listItems(body: string): string[] {
  return body
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*•]\s+)/u, '').trim())
    .filter(Boolean);
}

export function wordCount(text: string): number {
  return text.split(/\s+/u).filter(Boolean).length;
}

/** A text with the white space at either end set apart from the words between. */
export function splitEdges(text: string): { lead: string; core: string; trail: string } {
  const match = /^(\s*)([\s\S]*?)(\s*)$/u.exec(text);
  return { lead: match?.[1] ?? '', core: match?.[2] ?? text, trail: match?.[3] ?? '' };
}

/**
 * What a reader should be told about how far the words of a section were checked, which is the one
 * place a person's edit could be mistaken for the report's own checked text.
 */
export function provenanceNote(section: Pick<StudioSectionView, 'kind' | 'origin'>): string | null {
  if (section.kind !== 'chapter') {
    return 'Not listed statement by statement: figures here are not checked.';
  }
  if (section.origin === 'human') {
    return 'A person wrote this text. It has not been checked statement by statement.';
  }
  if (section.origin === 'regenerated') {
    return 'The model wrote this text and the server checked its statements, as it checked the report’s.';
  }
  return null;
}

/** A count and its noun: `1 note`, `3 notes`. */
export const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`;

/**
 * What would be lost if the studio were left now, as one sentence. The question the studio asks and the one the shell
 * asks (it adds that the words are lost if the person leaves) say the same thing.
 */
export const unsavedSentence = (unsaved: number): string =>
  `${plural(unsaved, 'section')} ${unsaved === 1 ? 'holds' : 'hold'} words that have not been saved.`;

// ---- Statements ---------------------------------------------------------------------------------

export interface Excerpt {
  before: string;
  /** The words that were found exactly as written in the passage, or null when none were. */
  quote: string | null;
  after: string;
  clippedStart: boolean;
  clippedEnd: boolean;
}

/**
 * The part of a passage worth reading first: the quoted words with a little around them, or the start of
 * the passage when there is no quotation to find. It never alters the words, only where it stops.
 */
export function excerpt(passage: string, quote: string | null, radius = 170): Excerpt {
  const at = quote ? passage.indexOf(quote) : -1;
  if (!quote || at < 0) {
    const clipped = passage.length > radius * 2;
    return {
      before: clipped ? passage.slice(0, radius * 2).replace(/\s+\S*$/u, '') : passage,
      quote: null,
      after: '',
      clippedStart: false,
      clippedEnd: clipped,
    };
  }
  const start = Math.max(0, at - radius);
  const end = Math.min(passage.length, at + quote.length + radius);
  let before = passage.slice(start, at);
  let after = passage.slice(at + quote.length, end);
  if (start > 0) before = before.replace(/^\S*\s+/u, '');
  if (end < passage.length) after = after.replace(/\s+\S*$/u, '');
  return { before, quote, after, clippedStart: start > 0, clippedEnd: end < passage.length };
}
export interface SupportSegment {
  support: SupportClass;
  count: number;
}

/** How the statements of a chapter divide by how well the sources back them, in the order of the taxonomy. */
export function supportSegments(
  statements: readonly Pick<ClaimRecord, 'supportClass'>[],
): SupportSegment[] {
  return SUPPORT_CLASSES.map((support) => ({
    support,
    count: statements.filter((statement) => statement.supportClass === support).length,
  })).filter((segment) => segment.count > 0);
}
