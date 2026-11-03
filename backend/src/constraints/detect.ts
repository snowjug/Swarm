import type { ConstraintCategory } from '../../../shared/constraints.js';
import { sentencesOf } from '../stakeholders/mentions.js';
import { splitClauses, type Clause } from './clauses.js';
import { readClauses, type HardnessReading } from './deontic.js';
import {
  APPROVAL_CUE,
  CATEGORY_ORDER,
  CATEGORY_STEMS,
  SOFT_CUE,
  UNDECIDED_CUE,
  WINDOW_TEXT,
} from './lexicon.js';
import { topicOf } from './situation.js';

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
  /** The category is a guess from how the sentence is worded: it states a limit but no word of it names a subject. */
  guessed: boolean;
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
/** A clause that goes on from the one before it as its consequence ("so the vessel must keep sailing"). */
const CONSEQUENCE = /^(?:,\s*so|,\s*which)$/u;
/**
 * A clause that is about a part of what the one before it named ("and some require notice", "and it needs
 * approval"): a pronoun, or a quantifier standing for what was named. A quantifier before a noun ("and all
 * staff must attend") starts a new subject and goes on from nothing.
 */
const ANAPHORIC = new RegExp(
  String.raw`^(?:(?:they|it|these|those|both|each)(?![\p{L}\p{N}])|(?:some|most|all|many|few|none|neither)(?:\s+of\s+(?:them|these|those|which|it))?\s+(?:must|shall|may|can|cannot|need|needs|require|requires|have|has|will|would|do|does|are|is|set|say|ask|include|apply|allow|prohibit|forbid|expect|carry|charge|cover|impose|specify|state)(?![\p{L}\p{N}]))`,
  'iu',
);

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
  guessed: boolean;
}

/** What one clause says: its subject and whether it limits it. Null when it names no subject or limits nothing. */
function readClause(clause: string, limit: HardnessReading): Reading | null {
  const named = categoryOf(clause);
  if (!named) return null;
  const knowledge = KNOWLEDGE_CATEGORIES.has(named.category) && GAP_CUE.test(clause);
  // A limit that is asked for, or said to be possible, is still one that someone has in mind: a soft one.
  const wished =
    limit.cancelled !== null &&
    (limit.cancelled.why === 'asked-for' || limit.cancelled.why === 'hedged');
  if (!limit.hard && !wished && !SOFT_CUE.test(clause) && !knowledge) return null;
  return { ...named, hard: limit.hard, guessed: false };
}

/** Whether a clause goes on from the one before it, so that what it requires is a requirement of what that named. */
const continuesFrom = (clause: Clause): boolean =>
  CONSEQUENCE.test(clause.joint) ||
  (clause.joint.startsWith(',') && ANAPHORIC.test(clause.text.trim()));

const DURATION =
  /(?<![\p{L}\p{N}])(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+(?:hour|day|week|month|year)s?(?![\p{L}\p{N}])/iu;
const SOURCE_OF_RULES =
  /(?<![\p{L}\p{N}])(?:code|act|directive|statute|regulations?|standard|guidelines?)\s+(?:says?|states?|requires?|sets|provides|gives|specif\w+)(?![\p{L}\p{N}])/iu;
const BY_LAW =
  /(?<![\p{L}\p{N}])(?:by\s+law|statutor\w+|legally|legal\s+(?:duty|obligation|requirement)s?)(?![\p{L}\p{N}])/iu;
const AFTER_OR_BEFORE = /(?<![\p{L}\p{N}])(?:until|before|after|once|prior\s+to)(?![\p{L}\p{N}])/iu;
const NOT_THEIRS_TO_CHANGE =
  /(?<![\p{L}\p{N}])(?:their|its)\s+own(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])(?:cannot|can['’]t)\s+(?:be\s+)?(?:change|alter|control|influence|set)\w*|outside\s+(?:our|their|its)\s+control/iu;

/**
 * What kind of limit a statement is when no word of it names what is limited: judged by what it is about
 * (`topicOf`), and otherwise by its shape, and always a guess a person can change. The law, a rule-giving
 * text and an approval come first; then what the words are about; then a length of time, an order of
 * steps, a party that decides for itself, and last the way the work is done.
 */
export function guessCategory(text: string): ConstraintCategory {
  if (BY_LAW.test(text)) return 'legal';
  if (SOURCE_OF_RULES.test(text)) return 'regulatory';
  if (APPROVAL_CUE.test(text)) return 'organizational';
  const about = topicOf(text);
  if (about) return about;
  if (DURATION.test(text) || WINDOW_TEXT.test(text)) return 'time';
  if (AFTER_OR_BEFORE.test(text)) return 'sequencing';
  if (NOT_THEIRS_TO_CHANGE.test(text)) return 'dependency';
  return 'operational';
}

/** Whether the sentence states a limit that needs no word to name what it limits, and none of its clauses names one. */
function bareLimit(clauses: readonly Clause[], limits: readonly HardnessReading[]): boolean {
  if (clauses.some((clause) => categoryOf(clause.text) !== null)) return false;
  return limits.some((limit) => limit.hard && limit.cue?.standalone === true);
}

/** The reading that is the better account of a sentence: a hard one over a soft one, then the one more about its subject. */
function stronger(best: Reading | null, reading: Reading | null): Reading | null {
  if (!reading) return best;
  if (!best) return reading;
  if (reading.hard && !best.hard) return reading;
  return reading.hard === best.hard && reading.score > best.score ? reading : best;
}

/**
 * What a text says about limits, sentence by sentence. A limit is read where the words that name what is
 * limited and the words that limit it stand in one clause, so that a sentence that mentions a budget in
 * one place and a dependence in another is not taken for a limit on the budget; a clause that names what
 * is limited and says no limit is read with the clause that goes on from it ("…, so the vessel must keep
 * sailing"). A sentence that states an obligation or a ban and names no subject at all is still a limit,
 * on something the words do not say: it is kept, with a category that is a guess and is said to be. A
 * sentence that gives a share of people ("17% said") is a count and is passed over unless it states an
 * obligation. Pure: the same text gives the same sentences.
 */
export function detectIn(text: string, where: Origin): Detection {
  const candidates: Candidate[] = [];
  const undecided: Undecided[] = [];
  let first = true;
  for (const { text: raw } of sentencesOf(text)) {
    // A heading names what the lines under it are about; it states no limit, whatever words it has.
    if (/^#{1,6}\s/u.test(raw)) {
      first = false;
      continue;
    }
    const sentence = unmarked(raw);
    // A passage is cut where its text happens to be, so its first words may be the end of a sentence: one that
    // starts in lower case is the end of a sentence that is in the passage before, and is read there.
    const fragment = first && where.kind === 'passage' && /^\p{Ll}/u.test(sentence);
    first = false;
    if (fragment || sentence.length < MIN_SENTENCE || sentence.length > MAX_SENTENCE) continue;
    const clauses = splitClauses(sentence).filter(
      (clause) => clause.text.trim().length >= MIN_CLAUSE,
    );
    const quote = cutAtWord(sentence, MAX_QUOTE);
    const counted = SHARE.test(sentence);

    const limits = readClauses(clauses);
    let best: Reading | null = null;
    for (const [at, clause] of clauses.entries()) {
      const limit = limits[at] as HardnessReading;
      let reading = readClause(clause.text, limit);
      const next = clauses[at + 1];
      if (!reading && next && continuesFrom(next)) {
        const named = categoryOf(clause.text);
        if (named && limits[at + 1]?.hard) {
          reading = { ...named, hard: true, guessed: false };
        }
      }
      best = stronger(best, reading);
    }
    if (!best && !counted && !POINTS_BACK.test(sentence) && bareLimit(clauses, limits)) {
      best = { category: guessCategory(sentence), score: 0, hard: true, guessed: true };
    }
    if (!best) {
      // Nothing limits what is named, but something says it is not known: that is a question for the person.
      const open = clauses
        .filter((clause) => UNDECIDED_CUE.test(clause.text))
        .map((clause) => categoryOf(clause.text))
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
      guessed: best.guessed,
    });
  }
  return { candidates, undecided };
}
