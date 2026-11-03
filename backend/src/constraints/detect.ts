import type { ConstraintCategory } from '../../../shared/constraints.js';
import { sentencesOf } from '../stakeholders/mentions.js';
import {
  APPROVAL_CUE,
  CATEGORY_ORDER,
  CATEGORY_STEMS,
  HARD_CUE,
  SOFT_CUE,
  UNDECIDED_CUE,
  WINDOW_TEXT,
} from './lexicon.js';

/** Where a piece of text came from, so that what is found in it can be labelled by whose words they are. */
export type Origin =
  | { kind: 'question' }
  | { kind: 'scenario'; field: string }
  | { kind: 'assumption'; assumptionId: string; fromUser: boolean }
  | { kind: 'passage'; passageId: string }
  | { kind: 'actor'; actorId: string };

/** A sentence that reads as stating a limit, with the words it was found in. */
export interface Candidate {
  category: ConstraintCategory;
  /** The sentence, cut to the length of a statement. */
  statement: string;
  /** The sentence as written, cut at a word and never reworded, so that it can be found in its source. */
  quote: string;
  where: Origin;
  hardness: 'hard' | 'soft';
  /** The length of time or date the sentence names, in its own words; empty when it names none. */
  windowText: string;
  /** Whether the sentence asks for an approval. */
  approval: boolean;
  /** How strongly the sentence is about its category: the number of distinct words that name it, the weak ones as half. */
  score: number;
}

/** A sentence that says a limit has not been decided or is not known: what it asks for is a question to the person. */
export interface Undecided {
  category: ConstraintCategory;
  quote: string;
  where: Origin;
}

export interface Detection {
  candidates: Candidate[];
  undecided: Undecided[];
}

const MIN_SENTENCE = 20;
const MAX_SENTENCE = 700;
const MAX_STATEMENT = 400;
const MAX_QUOTE = 500;
const MIN_CLAUSE = 12;

const wordPattern = (patterns: readonly string[]): RegExp =>
  new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${patterns.join('|')})(?![\p{L}\p{N}])`, 'giu');

const MATCHERS = CATEGORY_ORDER.map((category) => ({
  category,
  strong: wordPattern(CATEGORY_STEMS[category].strong),
  weak: CATEGORY_STEMS[category].weak ? wordPattern(CATEGORY_STEMS[category].weak) : null,
}));

/** Limits on what is known are limits too, but they are read for these words and not for an obligation. */
const KNOWLEDGE_CATEGORIES: ReadonlySet<ConstraintCategory> = new Set([
  'data-quality',
  'evidence-quality',
  'uncertainty',
]);
const GAP_CUE =
  /\b(?:does\s+not\s+(?:say|state|show|give|explain)|(?:was|were|is|are|has|have)\s+not\s+(?:yet\s+)?(?:been\s+)?(?:tracked|measured|studied|tested|quoted|recorded)|not\s+(?:tracked|measured|studied|tested|recorded)|no\s+(?:data|evidence|information)\b|never\s+(?:been\s+)?measured)\b/iu;

/** A figure given as a share ("17%", "9 per cent"): a count of people in a source, not a limit. */
const SHARE = /\d\s?%|\bper\s?cent\b/iu;
/** A sentence that begins by pointing back, so that said alone it says nothing about what it is about. */
const POINTS_BACK = /^(?:it|this|that|they|these|those|he|she)\b/iu;
const CLAUSES =
  /[;:—–]|,\s+(?:and|but|so|while|whereas|although|because|which)\s+|\s+(?:but|while|whereas|although|because)\s+|,\s+/u;

const distinct = (pattern: RegExp, text: string): number =>
  new Set([...text.matchAll(pattern)].map((found) => found[0].toLowerCase())).size;

/** The category a piece of text is most about, and how strongly; null when nothing in it names a limit's subject. */
export function categoryOf(text: string): { category: ConstraintCategory; score: number } | null {
  let best: { category: ConstraintCategory; score: number } | null = null;
  for (const { category, strong, weak } of MATCHERS) {
    const score = distinct(strong, text) + (weak ? 0.5 * distinct(weak, text) : 0);
    // Categories are tried in order of consequence, so a later one has to beat an earlier one to take it.
    if (score >= 1 && (!best || score > best.score)) best = { category, score };
  }
  return best;
}

const cutAtWord = (text: string, max: number): string => {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return cut.replace(/\s+\S*$/u, '') || cut;
};

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${cutAtWord(text, max - 1).trimEnd()}…`;

/** A sentence without the mark of the list or the heading it sits in. The rest is still what the source wrote. */
const unmarked = (sentence: string): string => sentence.replace(/^[\s\-*•#>]+/u, '');

interface Reading {
  category: ConstraintCategory;
  score: number;
  hard: boolean;
}

/** What one clause says: its subject and whether it limits it. Null when it names no subject or limits nothing. */
function readClause(clause: string): Reading | null {
  const named = categoryOf(clause);
  if (!named) return null;
  const hard = HARD_CUE.test(clause);
  const knowledge = KNOWLEDGE_CATEGORIES.has(named.category) && GAP_CUE.test(clause);
  if (!hard && !SOFT_CUE.test(clause) && !knowledge) return null;
  return { ...named, hard };
}

/**
 * What a text says about limits, sentence by sentence. A limit is read where the words that name what is
 * limited and the words that limit it stand in one clause, so that a sentence that mentions a budget in
 * one place and a dependence in another is not taken for a limit on the budget. A sentence that gives a
 * share of people ("17% said") is a count and is passed over unless it states an obligation. Pure: the
 * same text gives the same sentences.
 */
export function detectIn(text: string, where: Origin): Detection {
  const candidates: Candidate[] = [];
  const undecided: Undecided[] = [];
  let first = true;
  for (const { text: raw } of sentencesOf(text)) {
    const sentence = unmarked(raw);
    // A passage is cut where its text happens to be, so its first words may be the end of a sentence: one that
    // starts in lower case is the end of a sentence that is in the passage before, and is read there.
    const fragment = first && where.kind === 'passage' && /^\p{Ll}/u.test(sentence);
    first = false;
    if (fragment || sentence.length < MIN_SENTENCE || sentence.length > MAX_SENTENCE) continue;
    const clauses = sentence.split(CLAUSES).filter((clause) => clause.trim().length >= MIN_CLAUSE);
    const quote = cutAtWord(sentence, MAX_QUOTE);
    const counted = SHARE.test(sentence);

    let best: Reading | null = null;
    for (const clause of clauses) {
      const reading = readClause(clause);
      if (!reading) continue;
      if (
        !best ||
        (reading.hard && !best.hard) ||
        (reading.hard === best.hard && reading.score > best.score)
      ) {
        best = reading;
      }
    }
    if (!best) {
      // Nothing limits what is named, but something says it is not known: that is a question for the person.
      const open = clauses
        .filter((clause) => UNDECIDED_CUE.test(clause))
        .map((clause) => categoryOf(clause))
        .find((named) => named !== null);
      if (open && !counted) undecided.push({ category: open.category, quote, where });
      continue;
    }
    if ((counted && !best.hard) || (POINTS_BACK.test(sentence) && !best.hard)) continue;
    candidates.push({
      category: best.category,
      statement: clip(sentence, MAX_STATEMENT),
      quote,
      where,
      hardness: best.hard ? 'hard' : 'soft',
      windowText: WINDOW_TEXT.exec(sentence)?.[0] ?? '',
      approval: APPROVAL_CUE.test(sentence) && (best.hard || SOFT_CUE.test(sentence)),
      score: best.score,
    });
  }
  return { candidates, undecided };
}
