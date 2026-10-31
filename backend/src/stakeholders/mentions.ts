import type { StakeholderCategory } from '../../../shared/stakeholders.js';
import type { EvidenceChunk } from '../../../shared/types.js';
import { inspectText } from '../models/injection.js';
import {
  BELONGINGS,
  BELONGINGS_AS_VERBS,
  COMPOUND_FOLLOWERS,
  CONTEXT_CUES,
  FUNCTION_WORDS,
  GENERIC_ROLES,
  HEADS,
  INTRODUCERS,
  MODIFIERS,
  PAIR_HEADS,
  STATE_ONLY,
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

const SPACE = /\s/u;
const isTerminator = (char: string): boolean => char === '.' || char === '!' || char === '?';
const isSpace = (char: string): boolean => SPACE.test(char);

/**
 * The sentences of a passage. A sentence ends after a run of . ! ? that is followed by white space or by
 * the end of the text, and before a run of line breaks. It is one pass over the text with no
 * backtracking: a long run of full stops must cost no more than a long run of letters.
 */
export function sentencesOf(text: string): Sentence[] {
  const found: Sentence[] = [];
  let from = 0;
  const push = (end: number): void => {
    const raw = text.slice(from, end);
    const trimmed = raw.trim();
    if (trimmed) found.push({ text: trimmed, start: from + raw.length - raw.trimStart().length });
  };
  let at = 0;
  while (at < text.length) {
    const char = text.charAt(at);
    if (char === '\n') {
      let end = at + 1;
      while (text.charAt(end) === '\n') end += 1;
      push(at);
      from = end;
      at = end;
    } else if (isTerminator(char)) {
      let end = at + 1;
      while (isTerminator(text.charAt(end))) end += 1;
      // "3.14" and "a.b" are not the end of a sentence: only a run that white space or the end follows.
      if (end === text.length || isSpace(text.charAt(end))) {
        push(end);
        from = end;
      }
      at = end;
    } else {
      at += 1;
    }
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

const SENTENCE_END = /[.!?]["'”’)\]]*$/u;

/**
 * Whether a sentence is written in capitals from end to end and reads as prose: it ends like a sentence
 * and a third of its words are function words ("THE CUSTOMERS WILL PAY MORE AND THE SUPPORT TEAM WILL
 * LOSE STAFF."). In other text a capital tells a name from a word; here every word has one, and says nothing.
 * A menu, a row of names or a title in capitals has few function words, and is not this.
 */
function isShouted(sentence: string, words: readonly Word[]): boolean {
  if (!SENTENCE_END.test(sentence.trimEnd()) || /\p{Ll}/u.test(sentence)) return false;
  const connecting = words.filter((word) => FUNCTION_WORDS.has(word.raw.toLowerCase())).length;
  return connecting >= 2 && connecting * 3 >= words.length;
}

interface Modifier {
  /** The category this word suggests, or null when it only narrows the group. */
  cue: StakeholderCategory | null;
  /** Whether it can make a noun like "team" into a group: a kind of group, a name, not just "new". */
  qualifies: boolean;
}

/**
 * Whether the word before a head may describe it: a word the vocabulary lists, an acronym, or a
 * capitalised word (a name, such as of an organisation). A capital that only starts the sentence
 * counts only before a head that needs describing ("Neighbourhood groups"), because before any other
 * it is as likely to be an ordinary word as a name, and the bare role is already a group of its own.
 * In a sentence written all in capitals only the words the vocabulary lists describe a head: a
 * word that is all capitals is no more an acronym or a name than any other there.
 */
function modifierAt(
  sentence: string,
  words: Word[],
  index: number,
  headIndex: number,
  headIsWeak: boolean,
  shouted: boolean,
): Modifier | null {
  const word = words[index];
  if (!word) return null;
  const lower = word.raw.toLowerCase();
  // "it" is a pronoun unless it is written as the acronym.
  if (lower === 'it' && (word.raw !== 'IT' || shouted)) return null;
  const listed = MODIFIERS.has(lower) ? lower : MODIFIERS.has(word.base) ? word.base : null;
  if (listed !== null) {
    const cue = MODIFIERS.get(listed) ?? null;
    return { cue, qualifies: cue !== null || !STATE_ONLY.has(listed) };
  }
  if (shouted) return null;
  if (/^\p{Lu}{2,6}$/u.test(word.raw)) {
    return NOT_ACRONYMS.has(word.raw) ? null : { cue: null, qualifies: true };
  }
  if (STOPWORDS.has(lower)) return null;
  if (!/^\p{Lu}\p{Ll}+$/u.test(word.raw) || word.raw.length < 3) return null;
  const opens = sentence.slice(0, word.start).trim() === '';
  if (opens && (!headIsWeak || index !== headIndex - 1 || lower.endsWith('ly'))) return null;
  return { cue: null, qualifies: true };
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

const COUNT = /^(?:\p{N}+|hundreds?|thousands?|millions?|billions?|dozens?)$/iu;

/** Whether a count stands straight before the word: "500 members" says how many there are, not who they are. */
function counted(sentence: string, words: readonly Word[], at: number): boolean {
  const before = words[at - 1];
  const word = words[at];
  return (
    before !== undefined &&
    word !== undefined &&
    joined(sentence, before, word) &&
    COUNT.test(before.raw)
  );
}

/** Whether an article, a pointer, a possessive or a quantity stands straight before the word. */
function introduced(sentence: string, words: readonly Word[], at: number): boolean {
  const before = words[at - 1];
  const word = words[at];
  return (
    before !== undefined &&
    word !== undefined &&
    joined(sentence, before, word) &&
    (INTRODUCERS.has(before.raw.toLowerCase()) || /['’]s$/iu.test(before.raw))
  );
}

/**
 * Whether the role noun at `at` is the first word of a compound that names something else: "customer
 * survey" and "user interface" (nouns the vocabulary lists), "admin controls" and "customer record"
 * (a noun for what a group has or sets, after a role noun in the singular: "customers control the
 * rollout" is a plural subject and a verb). After a singular subject a verb ends in -s, so a noun that
 * is also a verb ("the admin controls access") makes a compound in that form only when no article or
 * possessive stands before the role noun.
 */
function startsCompound(sentence: string, words: readonly Word[], at: number): boolean {
  const word = words[at];
  const next = words[at + 1];
  if (!word || !next || !joined(sentence, word, next)) return false;
  if (COMPOUND_FOLLOWERS.has(next.base)) return true;
  if (!BELONGINGS.has(next.base) || word.raw.toLowerCase() !== word.base) return false;
  const verbLike = BELONGINGS_AS_VERBS.has(next.base) && next.raw.toLowerCase() !== next.base;
  return !verbLike || !introduced(sentence, words, at);
}

/**
 * Whether a word that names a thing stands straight before a position that any organisation has
 * ("account manager", "records manager"): that is the title of a function, and the position alone,
 * which is all the phrase would name, is no group of its own.
 */
function titled(sentence: string, words: readonly Word[], at: number): boolean {
  const before = words[at - 1];
  const word = words[at];
  return (
    before !== undefined &&
    word !== undefined &&
    GENERIC_ROLES.has(word.base) &&
    /^\p{Ll}/u.test(before.raw) &&
    joined(sentence, before, word) &&
    (COMPOUND_FOLLOWERS.has(before.base) || BELONGINGS.has(before.base))
  );
}

/**
 * Every phrase in a sentence that names a group by one of the vocabulary's role nouns. A role noun is
 * not taken when it starts a compound that names something else, when a count stands before it ("about
 * 4,200 employees" says how big a firm is), or when it is only the tail of a title ("account manager").
 */
export function phrasesOf(
  sentence: string,
  words: Word[] = wordsOf(sentence),
  shouted: boolean = isShouted(sentence, words),
): Phrase[] {
  const found: Phrase[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const at = headAt(sentence, words, index);
    if (!at) continue;
    if (startsCompound(sentence, words, index)) continue;
    const cues: (StakeholderCategory | null)[] = [];
    let qualified = false;
    let first = at.first;
    while (first > 0 && cues.length < 2) {
      const left = words[first - 1];
      const right = words[first];
      if (!left || !right || !joined(sentence, left, right)) break;
      const modifier = modifierAt(sentence, words, first - 1, index, at.head.weak, shouted);
      if (!modifier) break;
      cues.push(modifier.cue);
      qualified ||= modifier.qualifies;
      first -= 1;
    }
    // "Team" and "panel" name a group only when a describing word says what kind: "new" does not.
    if (at.head.weak && !qualified) continue;
    if (at.head.needs && !cues.includes(at.head.needs)) continue;
    if (counted(sentence, words, first)) continue;
    if (first === at.first && titled(sentence, words, first)) continue;
    const phraseWords = words.slice(first, index + 1);
    const firstWord = phraseWords[0];
    const lastWord = phraseWords.at(-1);
    if (!firstWord || !lastWord) continue;
    const surface = sentence.slice(firstWord.start, lastWord.end);
    found.push({
      words: phraseWords,
      head: at.head,
      category: categoryOf(at.head, cues),
      key: keyOfWords(phraseWords),
      surface: shouted ? surface.toLowerCase() : surface,
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

/** A sentence of a passage, with what reading it for groups needs, worked out once. */
interface Analysed extends Sentence {
  lowered: string;
  /** It speaks to an AI system, so it is data about the document and is never read as description. */
  suspicious: boolean;
  /** It is a label, a menu entry or a list of names, which says nothing about the groups it names. */
  label: boolean;
  words: Word[];
  phrases: Phrase[];
}

const analysed = new WeakMap<EvidenceChunk, Analysed[]>();

const BULLET = /^\s*(?:[-*•·]|\d+[.)])\s/u;
const LINK = /(?:https?:\/\/|www\.)\S+/giu;
const startsWithCapital = (word: Word): boolean => /^\p{Lu}/u.test(word.raw);
/** Capitalised words in a row that make a list of names and not a name: "Alpha Beta Gamma Delta Epsilon". */
const LONG_RUN = 5;

/**
 * The text with each link made of dots, as long as it was, so that a word in a path
 * ("example.org/users/support") is not read as a word of the sentence and the places of the others
 * do not move.
 */
const maskLinks = (text: string): string => text.replace(LINK, (link) => '·'.repeat(link.length));

/**
 * What a line of text is: a sentence, a fragment of up to three words with no full stop (a heading, a
 * menu entry, a link), or a list of names (three or more words, nearly all of them capitalised, with
 * no full stop: a row of a menu or of a table of contents). It is recognised by the shape that prose has
 * and these lack, and it names no market, product or word: a sentence ends with a full stop, and has
 * words that are not capitalised. Numbers do not count, so that "2 History 3 Methods" is a list.
 */
export type Shape = 'sentence' | 'fragment' | 'list';

export function shapeOf(sentence: string, words: readonly Word[]): Shape {
  if (SENTENCE_END.test(sentence.trimEnd())) return 'sentence';
  const spoken = words.filter((word) => !/^\p{N}+$/u.test(word.raw));
  const content = spoken.filter((word) => !STOPWORDS.has(word.raw.toLowerCase()));
  const capitals = content.filter(startsWithCapital).length;
  if (content.length >= 3 && capitals / content.length >= 0.75) return 'list';
  // A person's own bulleted list of groups is an item each, not a menu.
  return spoken.length <= 3 && !BULLET.test(sentence) ? 'fragment' : 'sentence';
}

/**
 * Which lines say nothing about the groups they name. A list of names never does. A fragment is a
 * heading when it stands between sentences, and a heading introduces what follows it, so a group named
 * in it is found; next to another fragment or a list it is a menu, a table of contents or a row of
 * links, and is not.
 */
function labels(shapes: readonly Shape[]): boolean[] {
  return shapes.map((shape, at) => {
    if (shape === 'list') return true;
    if (shape === 'sentence') return false;
    return shapes[at - 1] === 'fragment' || shapes[at - 1] === 'list'
      ? true
      : shapes[at + 1] === 'fragment' || shapes[at + 1] === 'list';
  });
}

/** The words that lie in a run of five or more capitalised words, not counting the one that opens the sentence. */
function inLongRun(sentence: string, words: readonly Word[]): Set<number> {
  const inside = new Set<number>();
  let start = -1;
  const close = (end: number): void => {
    if (start >= 0 && end - start >= LONG_RUN) {
      for (let at = start; at < end; at += 1) inside.add(at);
    }
    start = -1;
  };
  for (let at = 1; at < words.length; at += 1) {
    const word = words[at];
    const before = words[at - 1];
    if (!word || !before) continue;
    if (start >= 0 && startsWithCapital(word) && joined(sentence, before, word)) continue;
    close(at);
    if (startsWithCapital(word)) start = at;
  }
  close(words.length);
  return inside;
}

/**
 * The sentences of a passage, each cut into words and phrases. A passage is read many times in one
 * discovery (once for the role nouns and again for every name the question and the graph add), and
 * each reading would otherwise cut every sentence again: a graph of forty people and organisations
 * over a large project took seconds. A passage is never changed, so what is worked out is kept for
 * as long as the passage is.
 */
function analyse(passage: EvidenceChunk): Analysed[] {
  let found = analysed.get(passage);
  if (!found) {
    const sentences = sentencesOf(passage.text);
    const cut = sentences.map((sentence) => {
      const readable = maskLinks(sentence.text);
      return { sentence, readable, words: wordsOf(readable) };
    });
    const label = labels(cut.map(({ sentence, words }) => shapeOf(sentence.text, words)));
    found = cut.map(({ sentence, readable, words }, at) => {
      const isLabel = label[at] === true;
      // Capitals tell a name from a word, except in a sentence that is all capitals and reads as prose.
      const shouted = !isLabel && isShouted(readable, words);
      const listed = isLabel || shouted ? new Set<number>() : inLongRun(readable, words);
      return {
        ...sentence,
        lowered: sentence.text.toLowerCase(),
        suspicious: inspectText(sentence.text).suspicious,
        label: isLabel,
        words,
        phrases: isLabel
          ? []
          : phrasesOf(readable, words, shouted).filter((phrase) => {
              for (let word = phrase.firstIndex; word <= phrase.headIndex; word += 1) {
                if (listed.has(word)) return false;
              }
              return true;
            }),
      };
    });
    analysed.set(passage, found);
  }
  return found;
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
    for (const sentence of analyse(passage)) {
      if (sentence.suspicious || sentence.label) continue;
      for (const phrase of sentence.phrases) {
        if (sentence.start + phrase.end <= overlap) continue;
        const mark = `${phrase.key}|${sentence.lowered}`;
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
    for (const sentence of analyse(passage)) {
      if (seen.has(sentence.lowered) || sentence.suspicious || sentence.label) continue;
      const { words, phrases } = sentence;
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
      seen.add(sentence.lowered);
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
