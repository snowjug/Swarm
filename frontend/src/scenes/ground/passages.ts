import type { EvidenceChunk } from '../../../../shared/types';

/** `S12` is the twelfth passage: ids are read as numbers, so S2 comes before S10. */
export function passageNumber(id: string): number {
  const match = /^S(\d+)$/iu.exec(id.trim());
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

export function comparePassageIds(a: string, b: string): number {
  return passageNumber(a) - passageNumber(b) || a.localeCompare(b);
}

/** Each id once, in reading order. */
export function uniquePassageIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))].sort(comparePassageIds);
}

export interface PassageIndex {
  all: EvidenceChunk[];
  byId: Map<string, EvidenceChunk>;
  byDocument: Map<string, EvidenceChunk[]>;
}

export function indexPassages(passages: readonly EvidenceChunk[]): PassageIndex {
  const all = [...passages].sort((a, b) => comparePassageIds(a.id, b.id));
  const byId = new Map<string, EvidenceChunk>();
  const byDocument = new Map<string, EvidenceChunk[]>();
  for (const passage of all) {
    byId.set(passage.id, passage);
    const list = byDocument.get(passage.documentId);
    if (list) list.push(passage);
    else byDocument.set(passage.documentId, [passage]);
  }
  for (const list of byDocument.values()) list.sort((a, b) => a.start - b.start || a.end - b.end);
  return { all, byId, byDocument };
}

/** A passage by the name a person typed or a citation holds: `s3`, ` S3 ` and `S3` are one passage. */
export function findPassage(index: PassageIndex | null, id: string): EvidenceChunk | null {
  if (!index) return null;
  return index.byId.get(id) ?? index.byId.get(id.trim().toUpperCase()) ?? null;
}

export interface PlacedPassage {
  passage: EvidenceChunk;
  lane: number;
  /** Where it starts and how long it is, as shares of the document. */
  from: number;
  span: number;
}

/**
 * Places each passage of one document along its length. Passages are cut with a small overlap, so two
 * that touch are put in different lanes and the overlap is seen as one.
 */
export function placePassages(
  passages: readonly EvidenceChunk[],
  length: number,
): { items: PlacedPassage[]; lanes: number } {
  const total = Math.max(1, length, ...passages.map((passage) => passage.end));
  const ends: number[] = [];
  const items = [...passages]
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((passage) => {
      let lane = ends.findIndex((end) => end <= passage.start);
      if (lane < 0) lane = ends.length;
      ends[lane] = passage.end;
      return {
        passage,
        lane,
        from: Math.max(0, passage.start) / total,
        span: Math.max(0.01, (passage.end - passage.start) / total),
      };
    });
  return { items, lanes: Math.max(1, ends.length) };
}

export interface TextSegment {
  start: number;
  end: number;
  text: string;
  /** The passages this stretch of the document belongs to: more than one where two overlap. */
  passageIds: string[];
  /** Inside the quotation that is being pointed at. */
  quoted: boolean;
}

/**
 * Cuts a document into stretches so that each can be marked with the passages it belongs to, and the
 * words of a quotation can be marked inside them. The text itself is never changed; it is only split.
 */
export function segmentDocument(
  content: string,
  passages: readonly Pick<EvidenceChunk, 'id' | 'start' | 'end'>[],
  quote: { start: number; end: number } | null = null,
): TextSegment[] {
  const length = content.length;
  if (length === 0) return [];
  const clamp = (value: number) => Math.min(length, Math.max(0, Math.trunc(value)));
  const valid = passages
    .map((passage) => ({ id: passage.id, start: clamp(passage.start), end: clamp(passage.end) }))
    .filter((passage) => passage.end > passage.start);
  const cuts = new Set<number>([0, length]);
  for (const passage of valid) {
    cuts.add(passage.start);
    cuts.add(passage.end);
  }
  const marked =
    quote && quote.end > quote.start ? { start: clamp(quote.start), end: clamp(quote.end) } : null;
  if (marked) {
    cuts.add(marked.start);
    cuts.add(marked.end);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const segments: TextSegment[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]!;
    const end = points[index + 1]!;
    if (end <= start) continue;
    segments.push({
      start,
      end,
      text: content.slice(start, end),
      passageIds: valid
        .filter((passage) => passage.start <= start && passage.end >= end)
        .map((passage) => passage.id)
        .sort(comparePassageIds),
      quoted: marked !== null && marked.start <= start && marked.end >= end,
    });
  }
  return segments;
}

/** Where a quotation sits in a whole document: the first place its words occur inside one passage. */
export function locateQuote(
  content: string,
  passage: Pick<EvidenceChunk, 'text' | 'start'> | null,
  quote: string | null,
): { start: number; end: number } | null {
  if (!quote) return null;
  if (passage) {
    const at = passage.text.indexOf(quote);
    if (at >= 0) return { start: passage.start + at, end: passage.start + at + quote.length };
  }
  const anywhere = content.indexOf(quote);
  return anywhere >= 0 ? { start: anywhere, end: anywhere + quote.length } : null;
}

/**
 * The stretch of a document to bring into view: the quoted words, else where the passage in focus begins.
 * It reads the marks' own attributes instead of building a selector from an id, so whatever an id holds
 * (it can come from a record this page did not write) cannot make the lookup throw.
 */
export function findMark(
  root: ParentNode,
  quoted: boolean,
  passageId: string | null,
): HTMLElement | null {
  if (quoted) return root.querySelector<HTMLElement>('[data-quoted="true"]');
  if (!passageId) return null;
  for (const mark of root.querySelectorAll<HTMLElement>('[data-start]')) {
    if (mark.dataset.start?.split(' ').includes(passageId)) return mark;
  }
  return null;
}

/** "characters 1 to 1,199": where a passage is in its document, as a reader counts. */
export function rangeText(passage: Pick<EvidenceChunk, 'start' | 'end'>): string {
  return `characters ${(passage.start + 1).toLocaleString('en-GB')} to ${passage.end.toLocaleString('en-GB')}`;
}

/** The words around a figure or a phrase in a quotation, so the figure can be marked in place. */
export function markWithin(
  text: string,
  needle: string | null,
): { before: string; match: string; after: string } | null {
  if (!needle) return null;
  const at = text.indexOf(needle);
  if (at < 0) return null;
  return { before: text.slice(0, at), match: needle, after: text.slice(at + needle.length) };
}

/**
 * A long passage cut to the words around the part that was quoted: the quotation in full, a little either side,
 * and a note of whether anything was left out at each end. Cuts fall at a space, not in a word.
 */
export function clipAroundQuote(
  split: { before: string; quote: string; after: string },
  reach = 220,
): { before: string; quote: string; after: string; cutBefore: boolean; cutAfter: boolean } {
  const cutBefore = split.before.length > reach;
  const cutAfter = split.after.length > reach;
  let before = split.before;
  let after = split.after;
  if (cutBefore) {
    const from = split.before.length - reach;
    const space = split.before.indexOf(' ', from);
    before = split.before.slice(space >= 0 ? space + 1 : from);
  }
  if (cutAfter) {
    const space = split.after.lastIndexOf(' ', reach);
    after = split.after.slice(0, space > 0 ? space : reach);
  }
  return { before, quote: split.quote, after, cutBefore, cutAfter };
}

/** A long quotation cut to the words around the part that matters, with an ellipsis where it was cut. */
export function excerptAround(text: string, needle: string | null, radius = 110): string {
  const flat = text.replace(/\s+/gu, ' ').trim();
  if (flat.length <= radius * 2) return flat;
  const at = needle ? flat.indexOf(needle) : -1;
  const centre = at >= 0 ? at + (needle?.length ?? 0) / 2 : radius;
  const start = Math.max(0, Math.round(centre - radius));
  const end = Math.min(flat.length, Math.round(centre + radius));
  return `${start > 0 ? '… ' : ''}${flat.slice(start, end).trim()}${end < flat.length ? ' …' : ''}`;
}

/**
 * A quotation as it is read, without the list marker its source line began with ("- 44% said…" is "44% said…").
 * The passage the quotation is opened in keeps its own text: this is only for the line that is shown.
 */
export function plainQuote(text: string): string {
  return text.replace(/^\s*(?:[-*•–]|\d{1,2}[.)])\s+/u, '');
}
