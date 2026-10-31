import type {
  SectionOrigin,
  StudioSectionView,
  StudioState,
  StudioView,
} from '../../../shared/studio';
import type { Tone } from './ledger';

/** A different tone per state, and always a label beside it: colour is never the only cue. */
export const STATE_TONE: Record<StudioState, Tone> = {
  draft: 'neutral',
  'in-review': 'info',
  'changes-requested': 'caution',
  approved: 'good',
};

export const ORIGIN_TONE: Record<SectionOrigin, Tone> = {
  generated: 'neutral',
  human: 'info',
  regenerated: 'caution',
};

/** Codes of refusals that mean the document is not what the person was looking at. */
const OUT_OF_DATE = new Set([
  'SECTION_CONFLICT',
  'STUDIO_CHANGED',
  'STUDIO_STALE',
  'PROPOSAL_STALE',
  'PROPOSAL_NOT_FOUND',
  'STUDIO_EXISTS',
]);

export type RefusalKind = 'handled' | 'out-of-date' | 'other';

/**
 * How to treat a change the server refused: one the caller deals with itself (asking the person to
 * confirm, say) is not shown as an error; one that means the page was out of date is shown and the
 * studio is loaded again, so that the next thing the person sees is what the document says now; any other
 * is shown as it is.
 */
export function refusalKind(code: string | null, handled?: (code: string) => boolean): RefusalKind {
  if (code !== null && handled?.(code)) return 'handled';
  return code !== null && OUT_OF_DATE.has(code) ? 'out-of-date' : 'other';
}

export interface DiffPart {
  kind: 'same' | 'added' | 'removed';
  text: string;
}

/** Beyond this many tokens (words and the spaces between them) in the part that differs, it is shown as two blocks. */
const MAX_DIFF_TOKENS = 4_000;

/** Words and the runs of white space between them, so that joining the tokens gives back the text. */
const tokens = (text: string): string[] => text.match(/\S+|\s+/gu) ?? [];

function merged(parts: DiffPart[]): DiffPart[] {
  const result: DiffPart[] = [];
  for (const part of parts) {
    if (!part.text) continue;
    const last = result.at(-1);
    if (last && last.kind === part.kind) last.text += part.text;
    else result.push({ ...part });
  }
  return result;
}

/** The difference between two runs of tokens that share no beginning and no end (longest common subsequence). */
function differences(a: string[], b: string[]): DiffPart[] {
  if (a.length > MAX_DIFF_TOKENS || b.length > MAX_DIFF_TOKENS) {
    return [
      { kind: 'removed', text: a.join('') },
      { kind: 'added', text: b.join('') },
    ];
  }
  const width = b.length + 1;
  const length = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      length[i * width + j] =
        a[i] === b[j]
          ? (length[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(length[(i + 1) * width + j] ?? 0, length[i * width + j + 1] ?? 0);
    }
  }
  const parts: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      parts.push({ kind: 'same', text: a[i]! });
      i += 1;
      j += 1;
    } else if ((length[(i + 1) * width + j] ?? 0) >= (length[i * width + j + 1] ?? 0)) {
      parts.push({ kind: 'removed', text: a[i]! });
      i += 1;
    } else {
      parts.push({ kind: 'added', text: b[j]! });
      j += 1;
    }
  }
  for (; i < a.length; i += 1) parts.push({ kind: 'removed', text: a[i]! });
  for (; j < b.length; j += 1) parts.push({ kind: 'added', text: b[j]! });
  return parts;
}

/**
 * What changed between two texts, word by word. The beginning and the end the two texts share are set
 * aside first, so a small edit in a long text is found quickly; what is left between is compared by its
 * longest common subsequence, or, if too long for that, shown as the whole of the old part removed and
 * the whole of the new part added, which is true if less helpful. Joining the `same` and `removed`
 * parts gives the old text; the `same` and `added` parts, the new.
 */
export function diffWords(before: string, after: string): DiffPart[] {
  const a = tokens(before);
  const b = tokens(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  return merged([
    { kind: 'same', text: a.slice(0, start).join('') },
    ...differences(a.slice(start, endA), b.slice(start, endB)),
    { kind: 'same', text: a.slice(endA).join('') },
  ]);
}
/** How many words were taken out and put in, for a line that says so before the detail does. */
export function diffCounts(parts: readonly DiffPart[]): { added: number; removed: number } {
  const words = (text: string): number => text.split(/\s+/u).filter(Boolean).length;
  return {
    added: parts
      .filter((part) => part.kind === 'added')
      .reduce((sum, part) => sum + words(part.text), 0),
    removed: parts
      .filter((part) => part.kind === 'removed')
      .reduce((sum, part) => sum + words(part.text), 0),
  };
}

/** What a reader should know about a section before reading it, in words. */
export function sectionFlags(section: StudioSectionView): string[] {
  const flags: string[] = [];
  if (section.locked) flags.push('Locked');
  if (section.proposal) flags.push('Regenerated text waiting');
  if (section.statements.length > 0 && !section.statementsCurrent) {
    flags.push('Statements describe an earlier text');
  }
  if (section.notes.length > 0) {
    flags.push(`${section.notes.length} reviewer ${section.notes.length === 1 ? 'note' : 'notes'}`);
  }
  return flags;
}

/** Whether a person has changed this section, so that its statements and its provenance need saying. */
export const writtenByPerson = (section: Pick<StudioSectionView, 'origin'>): boolean =>
  section.origin !== 'generated';

/** The actor of a record as a person would read it: the system's own entries, or a principal id. */
export function actorLabel(actor: string): string {
  if (actor === 'system') return 'The report writer';
  if (actor === 'local-user') return 'You (local user)';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/iu.test(actor) ? `${actor.slice(0, 8)}…` : actor;
}

export interface ReviewSummary {
  sections: number;
  byPeople: number;
  notes: number;
  /** Statements the sources directly support, or support in part, in text they were checked against. */
  findings: number;
  /** Chapters whose statements describe an earlier text. */
  notCurrent: number;
  /** Statements shown only as hypotheses, simulations, inputs or unverified. */
  labelled: number;
}

/** What a reviewer is about to approve, in numbers, from the same view the page shows. */
export function reviewSummary(view: StudioView): ReviewSummary {
  const sections = view.document?.sections ?? [];
  let findings = 0;
  let labelled = 0;
  let notCurrent = 0;
  for (const section of sections) {
    if (section.statements.length === 0) continue;
    if (!section.statementsCurrent) {
      notCurrent += 1;
      continue;
    }
    for (const claim of section.statements) {
      const status = claim.publication.status;
      if (status === 'finding' || status === 'qualified') findings += 1;
      else if (status !== 'withheld') labelled += 1;
    }
  }
  return {
    sections: sections.length,
    byPeople: sections.filter(writtenByPerson).length,
    notes: sections.reduce((sum, section) => sum + section.notes.length, 0),
    findings,
    notCurrent,
    labelled,
  };
}
