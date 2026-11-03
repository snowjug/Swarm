import { inspectText } from '../../models/injection.js';
import { fit } from '../../ingest/url/text.js';
import { sha256 } from '../../ingest/url/provenance.js';
import type { InjectionSummary, Passage, PassageKind } from './types.js';

/** What stands in front of a line that reads like an instruction to an AI. The line itself is kept, as what the page said. */
export const FLAG_LABEL = '[flagged: reads like an instruction to an AI; not followed]';

/** The notice that says a document was cut. It is the one `fit` writes, so that every cut reads the same. */
export const SHORTENED_NOTICE = fit('', 1_000, true).text.trim();

const MAX_PASSAGES = 500;
const MAX_PATH_DEPTH = 6;
const MAX_PATH_ENTRY = 160;
const SEPARATOR = '\n\n';

/** A part of a document: a heading, which only sets the path, or text that can be pointed at. */
export type Part =
  { kind: 'heading'; level: number; line: string } | { kind: PassageKind; lines: string[] };

export interface Assembled {
  text: string;
  passages: Passage[];
  truncated: boolean;
  injection: InjectionSummary;
  /** The characters of the body's own words, before any label. */
  proseChars: number;
}

interface Piece {
  kind: PassageKind | 'heading' | 'notice';
  lines: string[];
  path: string[];
  flagged: boolean;
}

/** The text of a heading line without its marks. */
const titleOf = (line: string): string => line.replace(/^#{1,6}\s+/u, '').slice(0, MAX_PATH_ENTRY);

function label(
  lines: readonly string[],
  scanned: { chars: number },
  budget: number,
): { lines: string[]; flagged: boolean } {
  let flagged = false;
  const out = lines.map((line) => {
    scanned.chars += line.length;
    if (scanned.chars > budget || !inspectText(line).suspicious) return line;
    flagged = true;
    return `${FLAG_LABEL} ${line}`;
  });
  return { lines: out, flagged };
}

const length = (lines: readonly string[]): number =>
  lines.reduce((sum, line) => sum + line.length, 0) + Math.max(0, lines.length - 1);

/**
 * What the page said about itself (its title, description, author, Open Graph data) and that was left
 * out because it reads like an instruction to an AI is still text of the page that does. There is no line to
 * label, so it is counted as one block that was flagged, with what link following and the judgement
 * of whether a page is mostly instructions look at.
 */
export function withFlaggedFacts(
  summary: InjectionSummary,
  flaggedFacts: readonly string[],
): InjectionSummary {
  if (flaggedFacts.length === 0) return summary;
  const chars = flaggedFacts.reduce((sum, text) => sum + text.length, 0);
  return {
    flaggedBlocks: summary.flaggedBlocks + 1,
    totalBlocks: summary.totalBlocks + 1,
    flaggedChars: summary.flaggedChars + chars,
    totalChars: summary.totalChars + chars,
  };
}

/**
 * Puts the parts of a document in order as one text, so that `text.slice(start, end)` of each
 * passage is the passage. Lines that read like an instruction to an AI are labelled where they stand.
 * A document is at most `limit` characters: when the body is longer it ends with the notice, and the
 * `tail` (structured data, which is short and often what a page is for) is kept after it.
 */
export function assemble(
  head: readonly string[],
  body: readonly Part[],
  tail: readonly string[],
  limit: number,
): Assembled {
  // What is read for instructions is no more than what can end up in the document. The structured data
  // is read first, with a budget of its own: it is kept however long the body is, so what a long body
  // leaves of a shared budget must not decide whether it is read.
  const scanBudget = limit * 2;
  const tailLines = label(tail, { chars: 0 }, scanBudget);
  const scanned = { chars: 0 };
  const pieces: Piece[] = [];
  const path: { level: number; title: string }[] = [];
  const pathNow = (): string[] => path.slice(0, MAX_PATH_DEPTH).map((entry) => entry.title);
  const summary: InjectionSummary = {
    flaggedBlocks: 0,
    totalBlocks: 0,
    flaggedChars: 0,
    totalChars: 0,
  };
  let proseChars = 0;

  if (tail.length > 0) {
    const chars = tail.reduce((sum, line) => sum + line.length, 0);
    summary.totalBlocks += 1;
    summary.totalChars += chars;
    if (tailLines.flagged) {
      summary.flaggedBlocks += 1;
      summary.flaggedChars += chars;
    }
  }
  if (head.length > 0)
    pieces.push({ kind: 'metadata', lines: [...head], path: [], flagged: false });
  for (const part of body) {
    const lines = part.kind === 'heading' ? [part.line] : part.lines;
    const chars = lines.reduce((sum, line) => sum + line.length, 0);
    const result = label(lines, scanned, scanBudget);
    summary.totalBlocks += 1;
    summary.totalChars += chars;
    proseChars += chars;
    if (result.flagged) {
      summary.flaggedBlocks += 1;
      summary.flaggedChars += chars;
    }
    if (part.kind === 'heading') {
      while (path.length > 0 && (path[path.length - 1] as { level: number }).level >= part.level)
        path.pop();
      path.push({ level: part.level, title: titleOf(part.line) });
      pieces.push({ kind: 'heading', lines: result.lines, path: [], flagged: result.flagged });
    } else {
      pieces.push({
        kind: part.kind,
        lines: result.lines,
        path: pathNow(),
        flagged: result.flagged,
      });
    }
  }
  const tailLength = tailLines.lines.length > 0 ? length(tailLines.lines) + SEPARATOR.length : 0;

  const room = Math.max(0, limit - tailLength);
  const needOf = (piece: Piece, first: boolean): number =>
    length(piece.lines) + (first ? 0 : SEPARATOR.length);
  const everything = pieces.reduce((sum, piece, index) => sum + needOf(piece, index === 0), 0);
  const truncated = everything > room;
  // When the body is cut, the notice that says so is part of what has to fit.
  const budget = truncated ? room - SEPARATOR.length - SHORTENED_NOTICE.length : room;
  const kept: Piece[] = [];
  let used = 0;
  for (const piece of pieces) {
    const need = needOf(piece, kept.length === 0);
    if (!truncated || used + need <= budget) {
      kept.push(piece);
      used += need;
      continue;
    }
    const space = budget - used - (kept.length > 0 ? SEPARATOR.length : 0);
    if (space > 80 && piece.kind !== 'heading') {
      const cut = cutLines(piece.lines, space);
      if (cut.length > 0) kept.push({ ...piece, lines: cut });
    }
    break;
  }

  let text = '';
  const passages: Passage[] = [];
  const add = (piece: Piece): void => {
    if (text) text += SEPARATOR;
    const start = text.length;
    text += piece.lines.join('\n');
    if (piece.kind === 'heading' || piece.kind === 'notice') return;
    if (passages.length < MAX_PASSAGES) {
      passages.push({
        start,
        end: text.length,
        headingPath: piece.path,
        kind: piece.kind,
        ...(piece.flagged ? { flagged: true as const } : {}),
      });
    }
  };
  kept.forEach(add);
  if (truncated) add({ kind: 'notice', lines: [SHORTENED_NOTICE], path: [], flagged: false });
  if (tailLines.lines.length > 0) {
    add({ kind: 'structured', lines: tailLines.lines, path: [], flagged: tailLines.flagged });
  }
  return { text, passages, truncated, injection: summary, proseChars };
}

/** The first lines that fit in `space` characters, or the start of the first line when it alone is too long. */
function cutLines(lines: readonly string[], space: number): string[] {
  const out: string[] = [];
  let used = 0;
  for (const line of lines) {
    const need = line.length + (out.length > 0 ? 1 : 0);
    if (used + need <= space) {
      out.push(line);
      used += need;
      continue;
    }
    if (out.length === 0) {
      const head = line.slice(0, space);
      const at = head.lastIndexOf(' ');
      const kept = at > space * 0.6 ? head.slice(0, at) : head;
      out.push(kept.replace(/[\ud800-\udbff]$/u, '').trimEnd());
    }
    break;
  }
  return out.filter(Boolean);
}

export const contentHashOf = sha256;
