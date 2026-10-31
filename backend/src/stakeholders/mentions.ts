import type { StakeholderCategory } from '../../../shared/stakeholders.js';
import type { EvidenceChunk } from '../../../shared/types.js';
import { inspectText } from '../models/injection.js';
import {
  CONTEXT_CUES,
  HEADS,
  MODIFIERS,
  PAIR_HEADS,
  STOPWORDS,
  singular,
  type ContextCue,
  type Head,
} from './lexicon.js';

export interface Sentence {
  text: string;
  /** Where the sentence starts in the passage. */
  start: number;
}

/** The sentences of a passage. A sentence ends at . ! ? followed by a space, and at a line break. */
export function sentencesOf(text: string): Sentence[] {
  const found: Sentence[] = [];
  let from = 0;
  const push = (end: number): void => {
    const raw = text.slice(from, end);
    const trimmed = raw.trim();
    if (trimmed) found.push({ text: trimmed, start: from + raw.indexOf(trimmed) });
  };
  for (const match of text.matchAll(/[.!?]+(?=\s|$)|\n+/gu)) {
    const index = match.index;
    push(match[0].startsWith('\n') ? index : index + match[0].length);
    from = index + match[0].length;
  }
  push(text.length);
  return found;
}

export interface Word {
  raw: string;
  /** Lower case, without possessive or plural ending. */
  base: string;
  start: number;
  end: number;
}

export function wordsOf(sentence: string): Word[] {
  return [...sentence.matchAll(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)].map((match) => ({
    raw: match[0],
    base: singular(match[0]),
    start: match.index,
    end: match.index + match[0].length,
  }));
}

const NOT_ACRONYMS: ReadonlySet<string> = new Set(
  'AN AS AT BY IF IN IS OF ON OR SO TO WE NO OK'.split(' '),
);

/** Whether two neighbouring words are only a space apart, so that they belong to one phrase. */
function joined(sentence: string, left: Word, right: Word): boolean {
  return /^\s+$/u.test(sentence.slice(left.end, right.start));
}

interface Modifier {
  /** The category this word suggests, or null when it only narrows the group. */
  cue: StakeholderCategory | null;
}

/**
 * Whether the word before a head may describe it: a word the vocabulary lists, an acronym, or a
 * capitalised word (a name, such as of an organisation). A capital that only starts the sentence
 * counts only before a head that needs describing ("Neighbourhood groups"), because before any other
 * it is as likely to be an ordinary word as a name, and the bare role is already a group of its own.
 */
function modifierAt(
  sentence: string,
  words: Word[],
  index: number,
  headIndex: number,
  headIsWeak: boolean,
): Modifier | null {
  const word = words[index];
  if (!word) return null;
  const lower = word.raw.toLowerCase();
  // "it" is a pronoun unless it is written as the acronym.
  if (lower === 'it' && word.raw !== 'IT') return null;
  if (MODIFIERS.has(lower)) return { cue: MODIFIERS.get(lower) ?? null };
  if (MODIFIERS.has(word.base)) return { cue: MODIFIERS.get(word.base) ?? null };
  if (/^\p{Lu}{2,6}$/u.test(word.raw)) return NOT_ACRONYMS.has(word.raw) ? null : { cue: null };
  if (STOPWORDS.has(lower)) return null;
  if (!/^\p{Lu}\p{Ll}+$/u.test(word.raw) || word.raw.length < 3) return null;
  const opens = sentence.slice(0, word.start).trim() === '';
  if (opens && (!headIsWeak || index !== headIndex - 1 || lower.endsWith('ly'))) return null;
  return { cue: null };
}

export interface Phrase {
  /** The words of the phrase, in order: up to two describing words and the head. */
  words: Word[];
  head: Head;
  category: StakeholderCategory;
  /** Lower-case singular words joined by spaces: the same for "Customers" and "customer’s". */
  key: string;
  /** The phrase as written, from its first word to its head. */
  surface: string;
  /** Where the phrase starts and ends in the sentence. */
  start: number;
  end: number;
  /** Positions in the sentence's list of words. */
  firstIndex: number;
  headIndex: number;
}

function headAt(
  sentence: string,
  words: Word[],
  index: number,
): { head: Head; first: number } | null {
  const word = words[index];
  if (!word) return null;
  const previous = words[index - 1];
  if (previous && joined(sentence, previous, word)) {
    const pair = PAIR_HEADS.get(`${previous.base} ${word.base}`);
    if (pair) return { head: pair, first: index - 1 };
  }
  const hyphenated = PAIR_HEADS.get(word.base.replaceAll('-', ' '));
  if (hyphenated) return { head: hyphenated, first: index };
  const head = HEADS.get(word.base);
  return head ? { head, first: index } : null;
}

/** A describing word that names a category takes it, when the head's own category is not specific. */
function categoryOf(
  head: Head,
  cuesNearestFirst: (StakeholderCategory | null)[],
): StakeholderCategory {
  const cue = cuesNearestFirst.find((candidate) => candidate !== null) ?? null;
  if (!cue) return head.category;
  if (head.category === 'other') return cue;
  // "Competing vendors" are competitors and "channel partners" are a channel, whatever the noun says.
  if (cue === 'competitor' && (head.category === 'partner' || head.category === 'channel')) {
    return cue;
  }
  return cue === 'channel' && head.category === 'partner' ? cue : head.category;
}

/** "End users" and "users" are one group: the key folds the pair head onto its second word. */
const keyOfWords = (words: readonly Word[]): string =>
  words
    .map((word) => word.base)
    .join(' ')
    .replace(/\bend user$/u, 'user');

/** Every phrase in a sentence that names a group by one of the vocabulary's role nouns. */
export function phrasesOf(sentence: string): Phrase[] {
  const words = wordsOf(sentence);
  const found: Phrase[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const at = headAt(sentence, words, index);
    if (!at) continue;
    const cues: (StakeholderCategory | null)[] = [];
    let first = at.first;
    while (first > 0 && cues.length < 2) {
      const left = words[first - 1];
      const right = words[first];
      if (!left || !right || !joined(sentence, left, right)) break;
      const modifier = modifierAt(sentence, words, first - 1, index, at.head.weak);
      if (!modifier) break;
      cues.push(modifier.cue);
      first -= 1;
    }
    if (at.head.weak && cues.length === 0) continue;
    const phraseWords = words.slice(first, index + 1);
    const firstWord = phraseWords[0];
    const lastWord = phraseWords.at(-1);
    if (!firstWord || !lastWord) continue;
    found.push({
      words: phraseWords,
      head: at.head,
      category: categoryOf(at.head, cues),
      key: keyOfWords(phraseWords),
      surface: sentence.slice(firstWord.start, lastWord.end),
      start: firstWord.start,
      end: lastWord.end,
      firstIndex: first,
      headIndex: index,
    });
  }
  // A role noun that only describes the head after it ("customer support team") is not a group of its own.
  return found.filter(
    (phrase) =>
      !found.some(
        (other) => other.headIndex > phrase.headIndex && other.firstIndex <= phrase.headIndex,
      ),
  );
}

/** The cue, if any, that most of a sentence's other words give: pays, gains, or is exposed. */
export function contextCueOf(sentence: string, phrase: Phrase): ContextCue | null {
  const inside = new Set(phrase.words.map((word) => word.start));
  const counts: Record<ContextCue, number> = { cost: 0, benefit: 0, risk: 0 };
  for (const word of wordsOf(sentence)) {
    if (inside.has(word.start)) continue;
    const lower = word.raw.toLowerCase();
    for (const cue of Object.keys(counts) as ContextCue[]) {
      if (CONTEXT_CUES[cue].has(lower) || CONTEXT_CUES[cue].has(word.base)) counts[cue] += 1;
    }
  }
  const ranked = (Object.entries(counts) as [ContextCue, number][])
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1]);
  const [best, next] = ranked;
  return best && (!next || best[1] > next[1]) ? best[0] : null;
}

/** The part of a long sentence around a phrase, cut at spaces, so that it stays a true excerpt. */
export function excerptAround(sentence: string, start: number, end: number, limit = 300): string {
  if (sentence.length <= limit) return sentence;
  let from = Math.max(0, start - 120);
  let to = Math.min(sentence.length, end + 180);
  if (from > 0) {
    const space = sentence.indexOf(' ', from);
    if (space >= 0 && space < start) from = space + 1;
  }
  if (to < sentence.length) {
    const space = sentence.lastIndexOf(' ', to);
    if (space > end) to = space;
  }
  return sentence.slice(from, to).trim();
}

export interface Mention {
  key: string;
  surface: string;
  category: StakeholderCategory;
  cue: ContextCue | null;
  passageId: string;
  /** A verbatim excerpt of the passage: the sentence the group is named in. */
  quote: string;
}

/**
 * Every place the passages name a group with one of the vocabulary's role nouns. A sentence that
 * speaks to an AI system is skipped: it is data about the document, not a description of the world.
 * Passages overlap by a few characters; a mention inside the overlap was already found in the
 * passage before, and a sentence is counted once however many passages repeat it.
 */
export function findMentions(passages: readonly EvidenceChunk[]): Mention[] {
  const mentions: Mention[] = [];
  const seen = new Set<string>();
  const previous = new Map<string, EvidenceChunk>();
  for (const passage of passages) {
    const before = previous.get(passage.documentId);
    previous.set(passage.documentId, passage);
    const overlap = before ? Math.max(0, before.end - passage.start) : 0;
    for (const sentence of sentencesOf(passage.text)) {
      if (inspectText(sentence.text).suspicious) continue;
      for (const phrase of phrasesOf(sentence.text)) {
        if (sentence.start + phrase.end <= overlap) continue;
        const mark = `${phrase.key}|${sentence.text.toLowerCase()}`;
        if (seen.has(mark)) continue;
        seen.add(mark);
        mentions.push({
          key: phrase.key,
          surface: phrase.surface,
          category: phrase.category,
          cue: phrase.category === 'end-user' ? contextCueOf(sentence.text, phrase) : null,
          passageId: passage.id,
          quote: excerptAround(sentence.text, phrase.start, phrase.end),
        });
      }
    }
  }
  return mentions;
}

/** The key a stakeholder name has, so that "Rival providers" and "the rival provider" are one. */
export function keyOf(name: string): string {
  const words = wordsOf(name);
  while (words[0] && STOPWORDS.has(words[0].raw.toLowerCase())) words.shift();
  return keyOfWords(words);
}

/** The category a name points to: its last role noun, or a describing word when it has none. */
export function categoryOfName(name: string): StakeholderCategory {
  const words = wordsOf(name);
  let head: Head | null = null;
  let headIndex = words.length;
  for (let index = 0; index < words.length; index += 1) {
    const at = headAt(name, words, index);
    if (at) {
      head = at.head;
      headIndex = at.first;
    }
  }
  const cues = words
    .slice(0, headIndex)
    .map((word) => MODIFIERS.get(word.raw.toLowerCase()) ?? MODIFIERS.get(word.base) ?? null)
    .reverse();
  if (head) return categoryOf(head, cues);
  return cues.find((cue) => cue !== null) ?? 'other';
}

export interface Occurrence {
  passageId: string;
  quote: string;
}

/**
 * Where the passages name a group, as whole words and whatever the plural: one excerpt per sentence.
 * Words that are part of a longer group ("rival providers" when asked for "providers") are not it.
 */
export function occurrencesOf(
  passages: readonly EvidenceChunk[],
  name: string,
  limit = 4,
): { found: Occurrence[]; sentences: number } {
  const key = keyOf(name);
  const wanted = key.split(' ').filter(Boolean);
  const found: Occurrence[] = [];
  const seen = new Set<string>();
  let sentences = 0;
  if (wanted.length === 0) return { found, sentences };
  for (const passage of passages) {
    for (const sentence of sentencesOf(passage.text)) {
      const lowered = sentence.text.toLowerCase();
      if (seen.has(lowered) || inspectText(sentence.text).suspicious) continue;
      const words = wordsOf(sentence.text);
      const phrases = phrasesOf(sentence.text);
      const at = words.findIndex((_, index) => {
        const first = words[index];
        const last = words[index + wanted.length - 1];
        return (
          first !== undefined &&
          last !== undefined &&
          wanted.every((part, offset) => words[index + offset]?.base === part) &&
          !phrases.some(
            (phrase) => phrase.start <= first.start && phrase.end >= last.end && phrase.key !== key,
          )
        );
      });
      const first = words[at];
      const last = words[at + wanted.length - 1];
      if (at < 0 || !first || !last) continue;
      seen.add(lowered);
      sentences += 1;
      if (found.length < limit) {
        found.push({
          passageId: passage.id,
          quote: excerptAround(sentence.text, first.start, last.end),
        });
      }
    }
  }
  return { found, sentences };
}
