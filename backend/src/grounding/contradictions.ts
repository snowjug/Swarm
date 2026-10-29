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

/** Sentences of a passage, each an exact slice of it, so a quoted sentence is verbatim by construction. */
export function splitSentences(text: string): string[] {
  const parts = text.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])|\n{2,}|\n(?=[-*•]\s)/u);
  return parts.map((part) => part.trim()).filter((part) => part.length >= 20);
}

export interface Measurement {
  raw: string;
  value: number;
  unit: 'percent' | 'currency' | 'count';
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
    measurements.push({
      raw: raw.trim(),
      value: percent ? base : base * (SCALES[suffixKey] ?? 1),
      unit,
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
  const sentences: Indexed[] = [];
  for (const passage of passages) {
    const passageHash = passage.contentHash ?? hashText(passage.text);
    for (const text of splitSentences(passage.text)) {
      if (sentences.length >= MAX_SENTENCES) break;
      const words = new Set(tokenize(text));
      if (words.size < MIN_SHARED_WORDS) continue;
      const { measurements, times } = measurementsIn(text);
      sentences.push({
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
      if (!right || count < MIN_SHARED_WORDS || left.passageId === right.passageId) continue;
      const overlap = count / Math.min(left.words.size, right.words.size);
      if (overlap < MIN_TOPIC_OVERLAP || !sharesPeriod(left.times, right.times)) continue;
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
        if (a && b && differs(a, b)) {
          found.push({
            left,
            right,
            kind: 'numeric',
            confidence: Math.min(0.95, overlap),
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
