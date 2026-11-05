import {
  boundEvidenceRef,
  clipQuote,
  type ContradictionKind,
  type ContradictionRecord,
  type EvidenceRef,
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
/** What a statement and its denial must share, over and above what two statements giving different figures must. */
const MIN_POLARITY_OVERLAP = 0.75;
const MIN_POLARITY_SHARED_WORDS = MIN_SHARED_WORDS + 1;
/** Two values closer than this (relative) are the same figure written differently. */
export const RELATIVE_TOLERANCE = 0.02;
export const MAX_CONTRADICTIONS = 20;
/**
 * Sentences read from the sources. The evidence limit (200,000 characters) cannot hold this many
 * sentences of the 20 characters or more that count, so it never cuts a project's evidence short.
 */
export const MAX_SENTENCES = 10_000;
/**
 * The list of sentences that hold a word is not read when it is longer than this: a word that many
 * sentences hold names no particular topic, as a stop word does not. A pair of sentences is still
 * compared on every word it shares, so the limit only decides which pairs are looked at.
 */
export const MAX_POSTING_LENGTH = 512;
/** The most partners one sentence is compared with: those that overlap it most. */
export const MAX_CANDIDATES_PER_SENTENCE = 128;

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

const UNITS = ['percent', 'currency', 'count'] as const;

interface Indexed extends SourceSentence {
  words: Set<string>;
  measurements: Measurement[];
  times: Set<string>;
  /** Whether a sentence without figures denies something. It is read for no other, so not worked out for one. */
  negated: boolean;
  /** The one figure of each unit (percent, currency, count) the sentence holds; null where it holds none or several. */
  singles: readonly [Measurement | null, Measurement | null, Measurement | null];
}

function singlesOf(measurements: readonly Measurement[]): Indexed['singles'] {
  const only = (unit: (typeof UNITS)[number]): Measurement | null => {
    const ofUnit = measurements.filter((measurement) => measurement.unit === unit);
    return ofUnit.length === 1 ? (ofUnit[0] ?? null) : null;
  };
  return [only('percent'), only('currency'), only('count')];
}

/**
 * The evidence for one side of a conflict. A "sentence" is whatever sits between two stops, and a markdown
 * table row has none: it can be several thousand characters. The quote is clipped here, at the source, with a
 * visible ellipsis, to what every record that holds an evidence reference allows; otherwise the first review
 * or brief that cites the conflict is refused ("critiques.1.evidence.1.quote: Too big").
 */
function refOf(sentence: SourceSentence): EvidenceRef {
  return boundEvidenceRef({
    passageId: sentence.passageId,
    documentId: sentence.documentId,
    documentName: sentence.documentName,
    start: sentence.passageStart,
    end: sentence.passageEnd,
    quote: sentence.text,
    contentHash: sentence.passageHash,
    role: 'contradicts',
  });
}

function sharesPeriod(left: Set<string>, right: Set<string>): boolean {
  if (left.size === 0 || right.size === 0) return true;
  for (const token of left) if (right.has(token)) return true;
  return false;
}

/** What a scan did, for a caller that wants to show its work was bounded rather than time it. */
export interface ContradictionScanStats {
  /** Sentences that could be set against another, and so were indexed. */
  sentences: number;
  /** Word lists too long to read (see `MAX_POSTING_LENGTH`). */
  skippedLists: number;
  /** Entries of word lists read while looking for partners. */
  postingVisits: number;
  /** Pairs of sentences compared in full. */
  pairsCompared: number;
  /** Sentences that had more plausible partners than `MAX_CANDIDATES_PER_SENTENCE`. */
  cappedSentences: number;
}

interface Match {
  left: number;
  right: number;
  kind: ContradictionKind;
  confidence: number;
  leftValue: string | null;
  rightValue: string | null;
}

// Two sentences are only ever set against one another when they are of kinds that can contradict:
// both hold a figure of one unit, or one affirms and the other denies, neither holding a figure.
// A sentence that holds several figures of every unit it names is of no kind and is left out.
const FIGURES = 1;
const AFFIRMS = 2;
const DENIES = 3;
/** The kind of sentence that each kind is set against. */
const PARTNER_KIND = [0, FIGURES, DENIES, AFFIRMS] as const;
const collator = new Intl.Collator();

function topicOf(left: Indexed, right: Indexed): string {
  return [...left.words]
    .filter((word) => right.words.has(word))
    .sort()
    .slice(0, 8)
    .join(' ');
}

/** The id of `key` among `ids`, a new one counted up from `first` if it has none yet. */
function idOf(ids: Map<string, number>, key: string, first: number): number {
  let id = ids.get(key);
  if (id === undefined) {
    id = ids.size + first;
    ids.set(key, id);
  }
  return id;
}

/** What the scan reads about each sentence, in arrays, so that its inner loops touch no objects. */
function profileOf(sentences: readonly Indexed[]) {
  const total = sentences.length;
  const kindOf = new Uint8Array(total);
  // One bit for each unit of which the sentence holds exactly one figure.
  const figuresOf = new Uint8Array(total);
  const wordCount = new Int32Array(total);
  const passageOf = new Int32Array(total);
  // Equal numbers name the same periods; zero names none.
  const periodOf = new Int32Array(total);
  const passageIds = new Map<string, number>();
  const periodIds = new Map<string, number>();
  let used = 0;
  sentences.forEach((sentence, position) => {
    let figures = 0;
    sentence.singles.forEach((single, unit) => {
      if (single) figures |= 1 << unit;
    });
    figuresOf[position] = figures;
    if (figures !== 0) kindOf[position] = FIGURES;
    else if (sentence.measurements.length === 0)
      kindOf[position] = sentence.negated ? DENIES : AFFIRMS;
    wordCount[position] = sentence.words.size;
    if (kindOf[position] !== 0) used += sentence.words.size;
    passageOf[position] = idOf(passageIds, sentence.passageId, 0);
    if (sentence.times.size > 0) {
      periodOf[position] = idOf(periodIds, [...sentence.times].sort().join('|'), 1);
    }
  });
  // Passages are listed in the order their ids collate in.
  const rankOfPassage = new Map<string, number>();
  const ordered = [...passageIds.keys()].sort(collator.compare);
  let rank = 0;
  ordered.forEach((id, index) => {
    const before = ordered[index - 1];
    if (before !== undefined && collator.compare(before, id) !== 0) rank = index;
    rankOfPassage.set(id, rank);
  });
  const rankOf = Int32Array.from(
    sentences,
    (sentence) => rankOfPassage.get(sentence.passageId) ?? 0,
  );
  return { kindOf, figuresOf, wordCount, passageOf, periodOf, rankOf, used };
}

/**
 * Each sentence's words as numbers and, for every word and kind of sentence, a list of the sentences of
 * that kind that hold the word, unless the list is too long to be worth reading.
 */
function indexWords(sentences: readonly Indexed[], kindOf: Uint8Array, used: number) {
  const total = sentences.length;
  const wordIds = new Map<string, number>();
  const offsets = new Int32Array(total + 1);
  const wordsOf = new Int32Array(used);
  let at = 0;
  sentences.forEach((sentence, position) => {
    offsets[position] = at;
    if (kindOf[position] === 0) return;
    for (const word of sentence.words) wordsOf[at++] = idOf(wordIds, word, 0);
  });
  offsets[total] = at;
  const lists = wordIds.size * 4;
  const frequency = new Int32Array(lists);
  for (let position = 0; position < total; position += 1) {
    for (let entry = offsets[position]!; entry < offsets[position + 1]!; entry += 1) {
      frequency[wordsOf[entry]! * 4 + kindOf[position]!]! += 1;
    }
  }
  const listStart = new Int32Array(lists + 1);
  let skippedLists = 0;
  for (let list = 0; list < lists; list += 1) {
    const tooLong = frequency[list]! > MAX_POSTING_LENGTH;
    if (tooLong) skippedLists += 1;
    listStart[list + 1] = listStart[list]! + (tooLong ? 0 : frequency[list]!);
  }
  const members = new Int32Array(listStart[lists]!);
  const fill = listStart.slice(0, lists);
  for (let position = 0; position < total; position += 1) {
    for (let entry = offsets[position]!; entry < offsets[position + 1]!; entry += 1) {
      const list = wordsOf[entry]! * 4 + kindOf[position]!;
      if (frequency[list]! <= MAX_POSTING_LENGTH) members[fill[list]!++] = position;
    }
  }
  return {
    offsets,
    wordsOf,
    vocabulary: wordIds.size,
    frequency,
    listStart,
    members,
    skippedLists,
  };
}

/**
 * Every pair of sentences that can contradict one another and share enough words, the best
 * `MAX_CONTRADICTIONS` of them: most alike first, then by how their passages are ordered, so the list
 * does not depend on the order the passages arrive in.
 *
 * A sentence is looked up through a list, for each of its words, of the sentences that hold the word.
 * The work is bounded two ways: a list longer than `MAX_POSTING_LENGTH` is not read, because a word
 * that many sentences hold names no particular topic, as a stop word does not; and a sentence is
 * compared with the `MAX_CANDIDATES_PER_SENTENCE` partners that overlap it most. A pair that is
 * compared is judged on every word it shares, however common. Ordinary evidence of a few hundred
 * sentences reaches neither limit, and the result is then the one a comparison of every pair gives.
 */
function searchPairs(sentences: readonly Indexed[], stats: ContradictionScanStats): Match[] {
  const total = sentences.length;
  const { kindOf, figuresOf, wordCount, passageOf, periodOf, rankOf, used } = profileOf(sentences);
  const { offsets, wordsOf, vocabulary, frequency, listStart, members, skippedLists } = indexWords(
    sentences,
    kindOf,
    used,
  );
  // Where the next sentence to be looked up is in each list: those before it have been dealt with.
  const cursor = listStart.slice(0, vocabulary * 4);
  // For each later sentence, how many words it shares with the sentence in hand.
  const shared = new Int32Array(total);
  const touched = new Int32Array(total);
  // The partners that pass the tests for a pair, with what the comparison needs to know of each.
  const partners = new Int32Array(total);
  const overlaps = new Float64Array(total);
  const standards = new Uint8Array(total);
  const levels = new Int32Array(101);
  const stamp = new Int32Array(vocabulary);
  const best: Match[] = [];
  let postingVisits = 0;
  let pairsCompared = 0;
  let cappedSentences = 0;
  let indexed = 0;

  // Whether a pair of matches goes before one already kept; a later match never goes before an equal one.
  let lastTexts: [number, number, number] = [-1, -1, 0];
  const textOrder = (left: number, kept: number): number => {
    if (lastTexts[0] !== left || lastTexts[1] !== kept) {
      lastTexts = [left, kept, collator.compare(sentences[left]!.text, sentences[kept]!.text)];
    }
    return lastTexts[2];
  };
  const goesBefore = (confidence: number, left: number, right: number, kept: Match): boolean => {
    if (confidence !== kept.confidence) return confidence > kept.confidence;
    if (rankOf[left]! !== rankOf[kept.left]!) return rankOf[left]! < rankOf[kept.left]!;
    if (rankOf[right]! !== rankOf[kept.right]!) return rankOf[right]! < rankOf[kept.right]!;
    return left !== kept.left && textOrder(left, kept.left) < 0;
  };
  const keep = (
    left: number,
    right: number,
    kind: ContradictionKind,
    confidence: number,
    leftValue: string | null,
    rightValue: string | null,
  ): void => {
    let slot = best.length;
    while (slot > 0 && goesBefore(confidence, left, right, best[slot - 1]!)) slot -= 1;
    if (slot === MAX_CONTRADICTIONS) return;
    best.splice(slot, 0, { left, right, kind, confidence, leftValue, rightValue });
    if (best.length > MAX_CONTRADICTIONS) best.pop();
  };

  for (let position = 0; position < total; position += 1) {
    const kind = kindOf[position]!;
    if (kind === 0) continue;
    indexed += 1;
    const from = offsets[position]!;
    const to = offsets[position + 1]!;
    const partnerKind = PARTNER_KIND[kind]!;
    let touchedCount = 0;
    // How many of the sentence's words have a list that is too long to read.
    let unread = 0;
    for (let entry = from; entry < to; entry += 1) {
      const word = wordsOf[entry]!;
      stamp[word] = position + 1;
      const list = word * 4 + partnerKind;
      if (frequency[list]! > MAX_POSTING_LENGTH) {
        unread += 1;
        continue;
      }
      const end = listStart[list + 1]!;
      let first = cursor[list]!;
      while (first < end && members[first]! <= position) first += 1;
      cursor[list] = first;
      postingVisits += end - first;
      for (let slot = first; slot < end; slot += 1) {
        const other = members[slot]!;
        const seen = shared[other]!;
        shared[other] = seen + 1;
        if (seen === 0) touched[touchedCount++] = other;
      }
    }

    // Partners that could not be reported with this sentence are dropped before the rest are ranked.
    // What a partner shares is known from the lists, unless some of them were not read, and then the
    // words are counted again; that is done only for a partner that could still reach what is needed.
    const left = sentences[position]!;
    const figures = figuresOf[position]!;
    const size = wordCount[position]!;
    const period = periodOf[position]!;
    let gated = 0;
    for (let found = 0; found < touchedCount; found += 1) {
      const other = touched[found]!;
      if (passageOf[other] === passageOf[position]) continue;
      if (kind === FIGURES && (figures & figuresOf[other]!) === 0) continue;
      let count = shared[other]!;
      const smaller = Math.min(size, wordCount[other]!);
      // Both name a period, and the same one. Absence of a period never counts as agreement.
      const samePeriod = period !== 0 && period === periodOf[other];
      const reach = count + unread;
      if (kind === FIGURES) {
        if (reach < MIN_SHARED_WORDS_SAME_QUANTITY) continue;
        if (!samePeriod && !(reach >= MIN_SHARED_WORDS && reach / smaller >= MIN_TOPIC_OVERLAP)) {
          continue;
        }
      } else if (reach < MIN_POLARITY_SHARED_WORDS || reach / smaller < MIN_POLARITY_OVERLAP) {
        continue;
      }
      if (unread > 0) {
        count = 0;
        for (let entry = offsets[other]!; entry < offsets[other + 1]!; entry += 1) {
          if (stamp[wordsOf[entry]!] === position + 1) count += 1;
        }
      }
      const overlap = count / smaller;
      const sharesAPeriod =
        period === 0 ||
        periodOf[other] === 0 ||
        samePeriod ||
        sharesPeriod(left.times, sentences[other]!.times);
      let standard: boolean;
      if (kind === FIGURES) {
        standard = count >= MIN_SHARED_WORDS && overlap >= MIN_TOPIC_OVERLAP && sharesAPeriod;
        if (!standard && !(count >= MIN_SHARED_WORDS_SAME_QUANTITY && samePeriod)) continue;
      } else {
        standard =
          count >= MIN_POLARITY_SHARED_WORDS && overlap >= MIN_POLARITY_OVERLAP && sharesAPeriod;
        if (!standard) continue;
      }
      partners[gated] = other;
      overlaps[gated] = overlap;
      standards[gated] = standard ? 1 : 0;
      gated += 1;
    }
    if (gated > MAX_CANDIDATES_PER_SENTENCE) {
      cappedSentences += 1;
      levels.fill(0);
      for (let at = 0; at < gated; at += 1) levels[Math.floor(overlaps[at]! * 100)]! += 1;
      let above = 0;
      let level = 100;
      while (level > 0 && above + levels[level]! < MAX_CANDIDATES_PER_SENTENCE) {
        above += levels[level]!;
        level -= 1;
      }
      let room = MAX_CANDIDATES_PER_SENTENCE - above;
      let kept = 0;
      for (let at = 0; at < gated; at += 1) {
        const bucket = Math.floor(overlaps[at]! * 100);
        if (bucket > level || (bucket === level && room-- > 0)) {
          partners[kept] = partners[at]!;
          overlaps[kept] = overlaps[at]!;
          standards[kept] = standards[at]!;
          kept += 1;
        }
      }
      gated = kept;
    }

    for (let candidate = 0; candidate < gated; candidate += 1) {
      const other = partners[candidate]!;
      const overlap = overlaps[candidate]!;
      pairsCompared += 1;
      if (kind !== FIGURES) {
        keep(position, other, 'polarity', Math.min(0.7, overlap * 0.7), null, null);
        continue;
      }
      const standard = standards[candidate] === 1;
      const right = sentences[other]!;
      for (let unit = 0; unit < UNITS.length; unit += 1) {
        const a = left.singles[unit];
        const b = right.singles[unit];
        if (!a || !b) continue;
        // On the thinner evidence of the same-quantity path, the figures themselves must count the same thing.
        if (!standard && (!a.phrase || a.phrase !== b.phrase)) continue;
        if (differs(a, b)) {
          const confidence = Math.min(0.95, standard ? overlap : Math.max(overlap, 0.6));
          keep(position, other, 'numeric', confidence, format(a), format(b));
          break;
        }
      }
    }
    for (let found = 0; found < touchedCount; found += 1) shared[touched[found]!] = 0;
  }

  stats.sentences = indexed;
  stats.skippedLists = skippedLists;
  stats.postingVisits = postingVisits;
  stats.pairsCompared = pairsCompared;
  stats.cappedSentences = cappedSentences;
  return best;
}

/**
 * Finds statements in different passages that seem to be about the same thing yet disagree: a
 * different figure for the same measure, or one affirming what the other denies. It deliberately
 * favours precision: statements about different periods are never paired, and a sentence with
 * several figures of one kind is skipped rather than guessed at. Every result is a candidate for a
 * person or an independent check to confirm; none is declared true.
 *
 * The scan is bounded, so that evidence at the size limit is read in a fraction of a second whatever
 * it says: see `MAX_POSTING_LENGTH` and `MAX_CANDIDATES_PER_SENTENCE`. Ordinary evidence of a few
 * hundred sentences reaches neither limit. Beyond them, a pair is not looked at when every word it
 * shares is one that more than `MAX_POSTING_LENGTH` sentences hold, and a sentence is compared with
 * only the `MAX_CANDIDATES_PER_SENTENCE` partners that overlap it most. The result has no field to say
 * that a pair was left out, so it does not; a caller that needs to know passes `stats`, which counts
 * the lists not read and the sentences held to their closest partners.
 */
export function detectContradictions(
  passages: readonly EvidenceChunk[],
  now: Date,
  stats: ContradictionScanStats = {
    sentences: 0,
    skippedLists: 0,
    postingVisits: 0,
    pairsCompared: 0,
    cappedSentences: 0,
  },
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
  // A document that says the same sentence again, word for word, adds nothing to a comparison, and
  // hundreds of copies would crowd out the lists the scan reads: only the earliest copy is kept.
  const said = new Map<string, { key: string; start: number }>();
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
      const wording = `${passage.documentId}\u0000${text.replace(/\s+/gu, ' ').toLowerCase()}`;
      const copy = said.get(wording);
      if (copy && copy.key !== key) {
        if (copy.start <= start) continue;
        unique.delete(copy.key);
      }
      said.set(wording, { key, start });
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
        negated: measurements.length === 0 && hasNegation(text),
        singles: singlesOf(measurements),
      });
    }
  }
  const sentences = [...unique.values()];
  return searchPairs(sentences, stats).map((entry, position) => {
    const left = sentences[entry.left]!;
    const right = sentences[entry.right]!;
    return {
      id: `X${position + 1}`,
      kind: entry.kind,
      topic: topicOf(left, right),
      left: refOf(left),
      right: refOf(right),
      leftValue: entry.leftValue,
      rightValue: entry.rightValue,
      confidence: Number(entry.confidence.toFixed(2)),
      status: 'detected',
      note: null,
      detectedBy: 'deterministic-v1',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  });
}

/** The number in the id of a conflict ("X12" is 12), or 0. */
const numberOfId = (id: string): number => Number(/^X(\d+)$/u.exec(id)?.[1] ?? 0);

/**
 * Two conflicts are one pair of statements when they quote the same two sentences of the same documents,
 * whichever comes first. A conflict that a ledger already holds may carry the whole sentence, and a new scan
 * clips it (`refOf`), so both are compared as clipped.
 */
const pairKey = (record: ContradictionRecord): string =>
  [record.left, record.right]
    .map((side) => `${side.documentId}\u0000${clipQuote(side.quote ?? '')}`)
    .sort()
    .join('\u0001');

/** The most conflicts a ledger holds: what a person has reviewed is kept beside what later scans add. */
export const MAX_HELD_CONFLICTS = MAX_CONTRADICTIONS * 2;

/**
 * What a ledger holds after a fresh scan of its sources: the conflicts it already has, with whatever a
 * person decided about them, and any candidate the scan finds that it does not hold, as detected and
 * numbered after the last. A search that has since been corrected, or evidence that has since been
 * added, then shows in a ledger that was built before, and nothing already reviewed is lost.
 */
export function reconcileConflicts(
  held: readonly ContradictionRecord[],
  found: readonly ContradictionRecord[],
): ContradictionRecord[] {
  const known = new Set(held.map(pairKey));
  let last = held.reduce((most, record) => Math.max(most, numberOfId(record.id)), 0);
  const added: ContradictionRecord[] = [];
  for (const record of found) {
    const key = pairKey(record);
    if (known.has(key)) continue;
    known.add(key);
    last += 1;
    added.push({ ...record, id: `X${last}` });
  }
  return [...held, ...added].slice(0, MAX_HELD_CONFLICTS);
}
