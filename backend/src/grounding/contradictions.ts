import type {
  ContradictionKind,
  ContradictionRecord,
  EvidenceRef,
} from '../../../shared/evidence.js';
import type { EvidenceChunk } from '../../../shared/types.js';
import { tokenize } from '../knowledge/retrieval.js';
import { hashText } from './ledger.js';

/** Words that must be shared for two sentences to be about the same thing. */
export const MIN_SHARED_WORDS = 3;
/**
 * Fewer shared words are enough when both sentences count the same thing (the words right after
 * the figure are identical) over an identical, explicit period: "412,000 one-way crossings in
 * 2025" against "365,000 one-way crossings in 2025".
 */
export const MIN_SHARED_WORDS_SAME_QUANTITY = 2;
/** Share of the shorter sentence's content words that the other sentence must also contain. */
export const MIN_TOPIC_OVERLAP = 0.6;
/** Two values closer than this (relative) are the same figure written differently. */
export const RELATIVE_TOLERANCE = 0.02;
export const MAX_CONTRADICTIONS = 20;
const MAX_SENTENCES = 2_000;

export interface SourceSentence {
  passageId: string;
  documentId: string;
  documentName: string;
  /** Exact text, a slice of the passage. */
  text: string;
  passageStart: number;
  passageEnd: number;
  passageHash: string;
}

const MIN_SENTENCE_LENGTH = 20;
const SENTENCE_BREAK = /(?<=[.!?])\s+(?=[A-Z0-9"“(])|\n{2,}|\n(?=[-*•]\s)/u;

/** Every piece of the text between sentence breaks, trimmed, however short. */
function sentencePieces(text: string): string[] {
  return text.split(SENTENCE_BREAK).map((part) => part.trim());
}

/** Sentences of a passage, each an exact slice of it, so a quoted sentence is verbatim by construction. */
export function splitSentences(text: string): string[] {
  return sentencePieces(text).filter((part) => part.length >= MIN_SENTENCE_LENGTH);
}

/** How much of the text beside a passage is read to tell whether the passage was cut mid-sentence. */
const CONTEXT_LENGTH = 48;
const ENDS_SENTENCE = /[.!?]["”’')\]]*$/u;
const BREAK_BEFORE = /(?:[.!?]["”’')\]]*\s+|\n[ \t]*\n\s*)$/u;
const BREAK_AFTER = /^(?:\s*\n[ \t]*\n|[ \t]*\n[ \t]*[-*•]\s)/u;
const BULLET = /^[-*•]\s/u;

/** The document's text just before `position`, read from the passages that cover it. Null if none does. */
function textBefore(position: number, siblings: readonly EvidenceChunk[]): string | null {
  if (position <= 0) return '';
  const holder = siblings.find((other) => other.start < position && other.end >= position);
  if (!holder) return null;
  const upTo = position - holder.start;
  return holder.text.slice(Math.max(0, upTo - CONTEXT_LENGTH), upTo);
}

/** The document's text just after `position`. Empty at the end of the document, null if unknown. */
function textAfter(position: number, siblings: readonly EvidenceChunk[]): string | null {
  const holder = siblings.find((other) => other.start <= position && other.end > position);
  if (holder) {
    const from = position - holder.start;
    return holder.text.slice(from, from + CONTEXT_LENGTH);
  }
  return siblings.some((other) => other.end > position) ? null : '';
}

function startsSentence(before: string | null, text: string): boolean {
  if (before === null) return false;
  const joined = before + (/^\s*/u.exec(text)?.[0] ?? '');
  if (joined.trim() === '') return true;
  return BREAK_BEFORE.test(joined) || (/\n[ \t]*$/u.test(joined) && BULLET.test(text.trimStart()));
}

function endsSentence(piece: string, text: string, after: string | null): boolean {
  if (ENDS_SENTENCE.test(piece)) return true;
  if (after === null) return false;
  if (after === '') return true;
  return BREAK_AFTER.test((/\s*$/u.exec(text)?.[0] ?? '') + after);
}

/** A sentence a passage holds whole, with where it sits in its document. */
export interface PlacedSentence {
  text: string;
  /** Character offset of the sentence in the document, not in the passage. */
  start: number;
}

/**
 * The sentences of a passage that the passage holds whole. Passages are cut at a fixed size and
 * overlap their neighbours by 120 characters, beginning wherever that falls, often mid-word. The
 * first sentence of a passage can therefore be the tail of a sentence from the one before, and the
 * last the head of one that continues in the next. Such a fragment has lost a negation or the front
 * of a figure, and set against the whole sentence it came from, or against anything else, it looks
 * like a disagreement that is nowhere in the document. A sentence shorter than the overlap is whole
 * in at least one passage wherever the cut falls; a longer one that straddles a cut is whole in none
 * and is not compared. `siblings` are the passages of the same document.
 */
export function completeSentences(
  passage: EvidenceChunk,
  siblings: readonly EvidenceChunk[],
): PlacedSentence[] {
  const pieces = sentencePieces(passage.text);
  const opens = startsSentence(textBefore(passage.start, siblings), passage.text);
  const after = textAfter(passage.end, siblings);
  const placed: PlacedSentence[] = [];
  let cursor = 0;
  pieces.forEach((piece, index) => {
    // The pieces are trimmed slices of the text, in order, so each is found at or after the last.
    const at = piece === '' ? cursor : Math.max(passage.text.indexOf(piece, cursor), 0);
    cursor = at + piece.length;
    if (piece.length < MIN_SENTENCE_LENGTH) return;
    if (index === 0 && !opens) return;
    if (index === pieces.length - 1 && !endsSentence(piece, passage.text, after)) return;
    placed.push({ text: piece, start: passage.start + at });
  });
  return placed;
}

export interface Measurement {
  raw: string;
  value: number;
  unit: 'percent' | 'currency' | 'count';
  /** What the figure counts: the first content words after it. "412,000 one-way crossings" gives "one-way crossings". */
  phrase: string;
}

const SCALES: Record<string, number> = {
  thousand: 1e3,
  k: 1e3,
  million: 1e6,
  m: 1e6,
  billion: 1e9,
  bn: 1e9,
};
const CURRENCY_WORDS = /^\s*(?:usd|eur|gbp|dollars?|euros?|pounds?)\b/iu;
const MEASURE =
  /([$€£])?\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s?(%|percent|per cent|thousand|million|billion|bn|m|k)?(?![\p{L}\p{N}])/giu;
const TIME_WORDS =
  /\b(?:Q[1-4]|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b|(?:19|20)\d{2})/giu;

/** Figures in a sentence. Years are time qualifiers, not measurements, and are returned separately. */
export function measurementsIn(sentence: string): {
  measurements: Measurement[];
  times: Set<string>;
} {
  const times = new Set((sentence.match(TIME_WORDS) ?? []).map((token) => token.toLowerCase()));
  const measurements: Measurement[] = [];
  for (const match of sentence.matchAll(MEASURE)) {
    const [raw, symbol, whole = '', decimals = '', suffix = ''] = match;
    const suffixKey = suffix.toLowerCase();
    const isYear =
      !symbol && !decimals && !suffix && /^(?:19|20)\d{2}$/u.test(whole) && !whole.includes(',');
    if (isYear) continue;
    const base = Number(`${whole.replaceAll(',', '')}${decimals}`);
    if (!Number.isFinite(base)) continue;
    const percent = suffixKey === '%' || suffixKey === 'percent' || suffixKey === 'per cent';
    const after = sentence.slice(
      (match.index ?? 0) + raw.length,
      (match.index ?? 0) + raw.length + 14,
    );
    const unit = percent ? 'percent' : symbol || CURRENCY_WORDS.test(after) ? 'currency' : 'count';
    const phrase = tokenize(
      sentence.slice((match.index ?? 0) + raw.length, (match.index ?? 0) + raw.length + 60),
    )
      .slice(0, 2)
      .join(' ');
    measurements.push({
      raw: raw.trim(),
      value: percent ? base : base * (SCALES[suffixKey] ?? 1),
      unit,
      phrase,
    });
  }
  return { measurements, times };
}

const NEGATIONS = new Set([
  'not',
  'no',
  'never',
  'cannot',
  'without',
  'neither',
  'nor',
  'fails',
  'failed',
  'denies',
  'denied',
  'rejects',
  'rejected',
  'opposes',
  'oppose',
  'declined',
  'refuses',
  'refused',
]);

export function hasNegation(sentence: string): boolean {
  const words =
    sentence
      .normalize('NFKC')
      .toLowerCase()
      .match(/[\p{L}'’]+/gu) ?? [];
  return words.some((word) => NEGATIONS.has(word) || /n['’]t$/u.test(word));
}

function differs(left: Measurement, right: Measurement): boolean {
  if (left.unit !== right.unit) return false;
  if (left.unit === 'percent') return Math.abs(left.value - right.value) >= 1;
  const larger = Math.max(Math.abs(left.value), Math.abs(right.value));
  return larger > 0 && Math.abs(left.value - right.value) / larger > RELATIVE_TOLERANCE;
}

function format(measurement: Measurement): string {
  return measurement.raw;
}

interface Indexed extends SourceSentence {
  words: Set<string>;
  measurements: Measurement[];
  times: Set<string>;
  negated: boolean;
}

function refOf(sentence: SourceSentence): EvidenceRef {
  return {
    passageId: sentence.passageId,
    documentId: sentence.documentId,
    documentName: sentence.documentName,
    start: sentence.passageStart,
    end: sentence.passageEnd,
    quote: sentence.text,
    contentHash: sentence.passageHash,
    role: 'contradicts',
  };
}

function sharesPeriod(left: Set<string>, right: Set<string>): boolean {
  if (left.size === 0 || right.size === 0) return true;
  return [...left].some((token) => right.has(token));
}

/** Both name a period, and the same one. Absence of a period never counts as agreement. */
function sameExplicitPeriod(left: Set<string>, right: Set<string>): boolean {
  return left.size > 0 && left.size === right.size && [...left].every((token) => right.has(token));
}

/**
 * Finds statements in different passages that seem to be about the same thing yet disagree: a
 * different figure for the same measure, or one affirming what the other denies. It deliberately
 * favours precision: statements about different periods are never paired, and a sentence with
 * several figures of one kind is skipped rather than guessed at. Every result is a candidate for a
 * person or an independent check to confirm; none is declared true.
 */
export function detectContradictions(
  passages: readonly EvidenceChunk[],
  now: Date,
): ContradictionRecord[] {
  const documents = new Map<string, EvidenceChunk[]>();
  for (const passage of passages) {
    const group = documents.get(passage.documentId);
    if (group) group.push(passage);
    else documents.set(passage.documentId, [passage]);
  }
  // The overlap between two passages holds some sentences twice. They are one sentence, found by
  // where it sits in its document, and a conflict reported once for each copy would list the same
  // two quotations twice. The earliest passage that holds it is kept, whatever order they arrive in.
  const unique = new Map<string, Indexed>();
  for (const passage of passages) {
    const passageHash = passage.contentHash ?? hashText(passage.text);
    for (const { text, start } of completeSentences(
      passage,
      documents.get(passage.documentId) ?? [],
    )) {
      const key = `${passage.documentId}:${start}:${text}`;
      const earlier = unique.get(key);
      if (earlier) {
        const earlierFirst =
          earlier.passageStart - passage.start || earlier.passageId.localeCompare(passage.id);
        if (earlierFirst <= 0) continue;
      } else if (unique.size >= MAX_SENTENCES) {
        continue;
      }
      const words = new Set(tokenize(text));
      if (words.size < MIN_SHARED_WORDS) continue;
      const { measurements, times } = measurementsIn(text);
      unique.set(key, {
        passageId: passage.id,
        documentId: passage.documentId,
        documentName: passage.documentName,
        text,
        passageStart: passage.start,
        passageEnd: passage.end,
        passageHash,
        words,
        measurements,
        times,
        negated: hasNegation(text),
      });
    }
  }
  const sentences = [...unique.values()];

  const index = new Map<string, number[]>();
  sentences.forEach((sentence, position) => {
    for (const word of sentence.words) index.set(word, [...(index.get(word) ?? []), position]);
  });

  const found: {
    left: Indexed;
    right: Indexed;
    kind: ContradictionKind;
    confidence: number;
    leftValue: string | null;
    rightValue: string | null;
    shared: string[];
  }[] = [];
  const paired = new Set<string>();
  sentences.forEach((left, leftPosition) => {
    const shared = new Map<number, number>();
    for (const word of left.words) {
      for (const other of index.get(word) ?? []) {
        if (other > leftPosition) shared.set(other, (shared.get(other) ?? 0) + 1);
      }
    }
    for (const [rightPosition, count] of shared) {
      const right = sentences[rightPosition];
      if (!right || left.passageId === right.passageId) continue;
      const overlap = count / Math.min(left.words.size, right.words.size);
      const standard =
        count >= MIN_SHARED_WORDS &&
        overlap >= MIN_TOPIC_OVERLAP &&
        sharesPeriod(left.times, right.times);
      const sameQuantity =
        !standard &&
        count >= MIN_SHARED_WORDS_SAME_QUANTITY &&
        sameExplicitPeriod(left.times, right.times);
      if (!standard && !sameQuantity) continue;
      const key = `${leftPosition}:${rightPosition}`;
      if (paired.has(key)) continue;
      const topic = [...left.words].filter((word) => right.words.has(word)).sort();

      const units = (['percent', 'currency', 'count'] as const).filter((unit) => {
        const a = left.measurements.filter((measurement) => measurement.unit === unit);
        const b = right.measurements.filter((measurement) => measurement.unit === unit);
        return a.length === 1 && b.length === 1;
      });
      let recorded = false;
      for (const unit of units) {
        const a = left.measurements.find((measurement) => measurement.unit === unit);
        const b = right.measurements.find((measurement) => measurement.unit === unit);
        // On the thinner evidence of the same-quantity path, the figures themselves must count the same thing.
        if (sameQuantity && (!a?.phrase || a.phrase !== b?.phrase)) continue;
        if (a && b && differs(a, b)) {
          found.push({
            left,
            right,
            kind: 'numeric',
            confidence: Math.min(0.95, sameQuantity ? Math.max(overlap, 0.6) : overlap),
            leftValue: format(a),
            rightValue: format(b),
            shared: topic,
          });
          recorded = true;
          break;
        }
      }
      if (
        !recorded &&
        standard &&
        left.measurements.length === 0 &&
        right.measurements.length === 0 &&
        left.negated !== right.negated &&
        overlap >= 0.75 &&
        count >= MIN_SHARED_WORDS + 1
      ) {
        found.push({
          left,
          right,
          kind: 'polarity',
          confidence: Math.min(0.7, overlap * 0.7),
          leftValue: null,
          rightValue: null,
          shared: topic,
        });
        recorded = true;
      }
      if (recorded) paired.add(key);
    }
  });

  found.sort(
    (a, b) =>
      b.confidence - a.confidence ||
      a.left.passageId.localeCompare(b.left.passageId) ||
      a.right.passageId.localeCompare(b.right.passageId) ||
      a.left.text.localeCompare(b.left.text),
  );
  return found.slice(0, MAX_CONTRADICTIONS).map((entry, position) => ({
    id: `X${position + 1}`,
    kind: entry.kind,
    topic: entry.shared.slice(0, 8).join(' '),
    left: refOf(entry.left),
    right: refOf(entry.right),
    leftValue: entry.leftValue,
    rightValue: entry.rightValue,
    confidence: Number(entry.confidence.toFixed(2)),
    status: 'detected',
    note: null,
    detectedBy: 'deterministic-v1',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }));
}
