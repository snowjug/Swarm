import type { StakeholderCategory } from '../../../../shared/stakeholders.js';
import type { EvidenceChunk } from '../../../../shared/types.js';
import {
  BELONGINGS,
  COMPOUND_FOLLOWERS,
  CONTEXT_CUES,
  MODIFIERS,
  STATE_ONLY,
  singular as foldSingular,
  type ContextCue,
} from '../lexicon.js';
import { analyse, excerptAround, type Mention } from '../mentions.js';
import {
  ANCHORS,
  CLOSED_CLASS,
  COLLECTIVES,
  COMMAND_VERBS,
  COMPOUND_AFTER,
  COMPOUND_PLURALS,
  DECISION_FORMS,
  DEFINITE_BODIES,
  GROUP_NOUNS,
  INSTRUMENTS,
  IRREGULAR_PLURALS,
  KIND_PREPOSITIONS,
  LY_WORDS_THAT_DESCRIBE,
  MACHINE_MODIFIERS,
  NOT_DESCRIBING,
  OBJECT_STARTERS,
  PAIR_NOUNS,
  PEOPLE_VERBS,
  STANCE_FORMS,
  THING_HEADS,
  THINGS_THAT_SAY,
  TIME_WORDS,
  TITLES,
  type GroupNoun,
} from './vocabulary.js';

/**
 * The participant reader: where the passages name a group, by a role noun with the words that say which
 * ones, or by the name of a body. It reads the sentences the discovery lexicon reads, with a wider
 * vocabulary (`vocabulary.ts`) and a fuller idea of what a group's name is:
 *
 *  - a group is named as the sources name it, from its describing words to its noun ("ward nurses",
 *    "county social care team", "Larkholm Health Centre") and not by the bare noun it shares with others;
 *  - the words after the noun that say which ones are meant belong to the name ("councillors from the
 *    harbour ward", "customers on monthly plans");
 *  - a body is a group when it has a name, which is a describing word with a capital and a kind of body
 *    for a noun; the few bodies that decide or check are a group when the text says "the council";
 *  - a group the sources are written in the plural about is named in the plural;
 *  - a sentence that says what a group asks, says or does marks it as voiced, which is what makes a
 *    group matter to a decision.
 *
 * Every name is words of the text and every quote is the sentence the name was read in. Nothing here
 * asks a model, and the same passages always give the same mentions.
 */

interface Token {
  /** As written, without a possessive ending. */
  raw: string;
  lower: string;
  start: number;
  /**
   * Where the word ends. After a plural possessive's apostrophe too, so that "Residents' Association" is one
   * run of words; before a singular possessive's ending, since "the company's reseller" is the reseller.
   */
  end: number;
  /** Whose it is: "company's" is of one, "residents'" and "children's" describe a group. */
  possessive: 'single' | 'plural' | null;
  capital: boolean;
}

const TOKEN = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*['’]?/gu;
const IRREGULAR_PLURAL_BASE = /^(?:children|people|men|women)$/iu;

function tokensOf(sentence: string, shouted: boolean): Token[] {
  const tokens: Token[] = [];
  for (const match of sentence.matchAll(TOKEN)) {
    let text = match[0];
    let end = match.index + text.length;
    let possessive: Token['possessive'] = null;
    if (/['’]$/u.test(text)) {
      // A trailing apostrophe is a possessive only after an s ("residents'"); otherwise it closes a quotation.
      text = text.slice(0, -1);
      if (/s$/iu.test(text)) possessive = 'plural';
      else end -= 1;
    } else if (/['’]s$/iu.test(text)) {
      text = text.slice(0, -2);
      possessive = IRREGULAR_PLURAL_BASE.test(text) ? 'plural' : 'single';
      if (possessive === 'single') end = match.index + text.length;
    }
    tokens.push({
      raw: text,
      lower: text.toLowerCase(),
      start: match.index,
      end,
      possessive,
      capital: !shouted && /^\p{Lu}/u.test(text),
    });
  }
  return tokens;
}

/** Whether only white space lies between two words, so that they belong to one phrase. */
const joined = (text: string, left: Token, right: Token): boolean =>
  /^\s+$/u.test(text.slice(left.end, right.start));

const DETERMINERS: ReadonlySet<string> = new Set('the a an their its our these those'.split(' '));
const ADVERBS: ReadonlySet<string> = new Set('just only mostly mainly'.split(' '));
const COUNT = /^(?:\p{N}+|hundreds?|thousands?|millions?|billions?|dozens?)$/iu;
const NOT_ACRONYMS: ReadonlySet<string> = new Set(
  'AN AS AT BY IF IN IS OF ON OR SO TO WE NO OK'.split(' '),
);
/** Kinds of party that are people in a position or a role, so that capitalised words before them may be a person's name. */
const PERSON_CATEGORIES: ReadonlySet<StakeholderCategory> = new Set([
  'operations',
  'end-user',
  'decision-maker',
  'influencer',
  'beneficiary',
  'cost-bearer',
  'risk-bearer',
]);

interface Head {
  category: StakeholderCategory;
  kind: GroupNoun['kind'] | 'title';
  lemma: string;
  plural: boolean;
  /** Where the noun starts and ends: a noun of two words spans both. */
  first: number;
  last: number;
}

/** A noun's singular form when the lexicon knows it, and whether the text wrote it in the plural. */
function lemmaOf(lower: string): { lemma: string; plural: boolean } | null {
  const irregular = IRREGULAR_PLURALS.get(lower);
  if (irregular) return { lemma: irregular, plural: true };
  const known = (word: string): boolean => GROUP_NOUNS.has(word) || TITLES.has(word);
  if (known(lower)) return { lemma: lower, plural: false };
  const stems: string[] = [];
  if (lower.endsWith('ies') && lower.length > 4) stems.push(`${lower.slice(0, -3)}y`);
  if (lower.endsWith('es') && lower.length > 3) stems.push(lower.slice(0, -2));
  if (lower.endsWith('s') && !lower.endsWith('ss') && lower.length > 3)
    stems.push(lower.slice(0, -1));
  const stem = stems.find(known);
  return stem ? { lemma: stem, plural: true } : null;
}

/**
 * A plural noun the vocabulary does not know that the sentence has asking, saying or wanting something
 * ("baggage handlers say", "team leads ask"): by agreement of the verb it is a plural subject, and a
 * subject that says something is a party. It is a group of an unknown kind, held as `other`.
 */
function speaker(text: string, tokens: readonly Token[], index: number): Head | null {
  const token = tokens[index];
  const verb = tokens[index + 1];
  if (!token || !verb || !joined(text, token, verb) || !PEOPLE_VERBS.has(verb.lower)) return null;
  const lower = token.lower;
  if (!/[^sui]s$/u.test(lower) || lower.length < 5 || token.possessive !== null) return null;
  if (CLOSED_CLASS.has(lower) || !/\p{L}/u.test(lower) || lower.endsWith('ly')) return null;
  const lemma = foldSingular(token.raw);
  if (THINGS_THAT_SAY.has(lemma)) return null;
  return { category: 'other', kind: 'strong', lemma, plural: true, first: index, last: index };
}

function headAt(text: string, tokens: readonly Token[], index: number): Head | null {
  const token = tokens[index];
  if (!token) return null;
  const own = lemmaOf(token.lower);
  const previous = tokens[index - 1];
  if (own && previous && joined(text, previous, token)) {
    const lemma = `${previous.lower} ${own.lemma}`;
    const pair = PAIR_NOUNS.get(lemma);
    if (pair) return { ...pair, lemma, plural: own.plural, first: index - 1, last: index };
  }
  const hyphenated = token.lower.replaceAll('-', ' ');
  const spaced = PAIR_NOUNS.get(hyphenated);
  if (spaced) return { ...spaced, lemma: hyphenated, plural: false, first: index, last: index };
  if (!own) return speaker(text, tokens, index);
  const noun = GROUP_NOUNS.get(own.lemma);
  if (noun) return { ...noun, lemma: own.lemma, plural: own.plural, first: index, last: index };
  const title = TITLES.get(own.lemma);
  return title
    ? {
        category: title,
        kind: 'title',
        lemma: own.lemma,
        plural: own.plural,
        first: index,
        last: index,
      }
    : null;
}

interface Modifier {
  token: Token;
  /** Listed by the discovery lexicon, a name (capitalised in the middle of a sentence), or just a word. */
  kind: 'listed' | 'capital' | 'plain';
  cue: StakeholderCategory | null;
  /** Whether it says what kind of group this is, as "support" does and "new" does not. */
  qualifies: boolean;
}

/** Whether the word before a head may describe it, and how. */
function modifierOf(token: Token, opensSentence: boolean): Modifier | null {
  // "The company's reseller" is the reseller of the company: the possessor is another party, not a description.
  if (token.possessive === 'single') return null;
  // "Configure widgets" and "Manage users" are what a person does with a thing, in a heading or a menu: the verb
  // describes nobody, and the words after it are left to stand on their own.
  if (COMMAND_VERBS.has(token.lower)) return null;
  const folded = foldSingular(token.raw);
  const listed = MODIFIERS.has(token.lower) ? token.lower : MODIFIERS.has(folded) ? folded : null;
  if (listed !== null) {
    const cue = MODIFIERS.get(listed) ?? null;
    return { token, kind: 'listed', cue, qualifies: cue !== null || !STATE_ONLY.has(listed) };
  }
  if (token.capital && /^\p{Lu}{2,6}$/u.test(token.raw)) {
    return NOT_ACRONYMS.has(token.raw)
      ? null
      : { token, kind: 'capital', cue: null, qualifies: true };
  }
  if (!describes(token)) return null;
  // A lower-case word that ends in s, in a place where a noun is expected, is a verb as often as a noun
  // ("the limit protects children"); a name, a plural possessive and the discovery lexicon's words are not.
  if (!token.capital && token.possessive === null && /[^sui]s$/u.test(token.lower)) return null;
  // A plural noun for a group is a group of its own, not a word that describes the one after it: "auditors
  // scold nurses" has two. Only a name may hold one ("Harbour Pilots Association").
  const name = token.capital && !opensSentence && /^\p{Lu}[\p{L}\p{N}'’-]*\p{Ll}/u.test(token.raw);
  if (!name && token.possessive === null && lemmaOf(token.lower)?.plural === true) return null;
  return { token, kind: name ? 'capital' : 'plain', cue: null, qualifies: true };
}

/** A word that can say which group is meant: not a closed-class word, a verb of saying, a time or an adverb. */
const describes = (token: Token): boolean =>
  !NOT_DESCRIBING.has(token.lower) &&
  /\p{L}/u.test(token.lower) &&
  token.lower.length >= 3 &&
  (!token.lower.endsWith('ly') || LY_WORDS_THAT_DESCRIBE.has(token.lower));

/** Whether the word before a run of describing words is not part of the phrase, so that the run starts it. */
function anchored(text: string, tokens: readonly Token[], first: number): boolean {
  const previous = tokens[first - 1];
  const token = tokens[first];
  if (!previous || !token || !joined(text, previous, token)) return true;
  return (
    previous.possessive !== null || ANCHORS.has(previous.lower) || /^\p{N}+$/u.test(previous.lower)
  );
}

/**
 * Whether a group stands where words after it belong to it: it opens the sentence or a clause, or follows
 * a preposition, an article or a conjunction. After a verb ("collects patients in pre-booked slots") the
 * words after it may belong to the verb.
 */
function standsAlone(text: string, tokens: readonly Token[], first: number): boolean {
  const previous = tokens[first - 1];
  const token = tokens[first];
  if (!previous || !token || !joined(text, previous, token)) return true;
  return previous.possessive !== null || CLOSED_CLASS.has(previous.lower);
}

function categoryOf(
  head: StakeholderCategory,
  cuesNearestFirst: readonly (StakeholderCategory | null)[],
): StakeholderCategory {
  const cue = cuesNearestFirst.find((candidate) => candidate !== null) ?? null;
  if (!cue) return head;
  if (head === 'other') return cue;
  if (cue === 'competitor' && (head === 'partner' || head === 'channel')) return cue;
  return cue === 'channel' && head === 'partner' ? cue : head;
}

/**
 * The words after a group's noun that say which ones are meant, when a preposition starts them: "from the
 * harbour ward", "with long contracts". At most one more preposition is followed, and the phrase stops at
 * the first word that cannot be part of a noun phrase. After a position's noun a capitalised word is left
 * out, since it may be a person's name.
 */
function kindOf(
  text: string,
  tokens: readonly Token[],
  nounLast: number,
  position: boolean,
  bareTitle: boolean,
): { last: number; words: string[] } | null {
  const noun = tokens[nounLast];
  const lead = tokens[nounLast + 1];
  if (!noun || !lead || !joined(text, noun, lead) || !KIND_PREPOSITIONS.has(lead.lower))
    return null;
  // A word that is a position only with what it is in charge of ("head of finance") is not one before an
  // article: "the head of the queue" is a place in a line.
  const first = tokens[nounLast + 2];
  if (bareTitle && first && DETERMINERS.has(first.lower)) return null;
  let last = -1;
  let prepositions = 0;
  let content = 0;
  for (let at = nounLast + 2; at < tokens.length && content < 4; at += 1) {
    const token = tokens[at];
    const before = tokens[at - 1];
    if (!token || !before || !joined(text, before, token)) break;
    if (KIND_PREPOSITIONS.has(token.lower)) {
      prepositions += 1;
      if (prepositions > 1) break;
      continue;
    }
    if (DETERMINERS.has(token.lower) || ADVERBS.has(token.lower)) continue;
    if (!describes(token) || TIME_WORDS.has(token.lower)) break;
    if (position && content >= 1 && token.capital) break;
    content += 1;
    last = at;
    // A plural noun with a word after it that is no preposition or article is the subject of that word,
    // a verb: "customers on standard plans use a portal" says who, and stops at "plans".
    const following = tokens[at + 1];
    if (
      /[^sui]s$/u.test(token.lower) &&
      following !== undefined &&
      joined(text, token, following) &&
      describes(following)
    ) {
      break;
    }
  }
  if (last < 0) return null;
  const words = tokens
    .slice(nounLast + 1, last + 1)
    .map((token) => token.lower)
    .filter((word) => !DETERMINERS.has(word));
  return { last, words };
}

/** Whether the verb straight after a phrase is one of starting a change: the phrase is who decides. */
function decides(text: string, tokens: readonly Token[], last: number): boolean {
  const noun = tokens[last];
  const verb = tokens[last + 1];
  return (
    noun !== undefined &&
    verb !== undefined &&
    joined(text, noun, verb) &&
    DECISION_FORMS.has(verb.lower)
  );
}

interface Found {
  key: string;
  surface: string;
  category: StakeholderCategory;
  plural: boolean;
  /** Written as a name: a body with a describing word and a noun that both begin with a capital. */
  proper: boolean;
  /** The verb straight after it is one of starting a change: "the Council proposes", "the hospital plans". */
  decides: boolean;
  start: number;
  end: number;
  /** Token positions: the phrase's first word, the noun's, and the phrase's last. */
  first: number;
  headLast: number;
  last: number;
}

function phrasesIn(
  sentence: string,
  tokens: readonly Token[],
  listed: ReadonlySet<number>,
): Found[] {
  const found: Found[] = [];
  // Where a thing's name stood ("admin center"): a noun inside it only describes the thing and is no group.
  const things: { first: number; headLast: number }[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const head = headAt(sentence, tokens, index);
    const headToken = head ? tokens[head.last] : undefined;
    if (!head || !headToken) continue;
    const next = tokens[head.last + 1];
    // "patient records" and "customer service" are about something else; a plural names people, and a
    // role noun that begins the name of a rule ("the Marden Consumer Code") belongs to that name.
    const afterNext = tokens[head.last + 2];
    if (
      !head.plural &&
      next &&
      joined(sentence, headToken, next) &&
      (COMPOUND_FOLLOWERS.has(next.lower) ||
        COMPOUND_AFTER.has(next.lower) ||
        (COMPOUND_PLURALS.has(next.lower) &&
          !(
            afterNext &&
            joined(sentence, next, afterNext) &&
            OBJECT_STARTERS.has(afterNext.lower)
          )) ||
        (BELONGINGS.has(next.lower) && /^\p{Ll}/u.test(headToken.raw)) ||
        (INSTRUMENTS.has(next.lower) && next.capital))
    ) {
      continue;
    }

    const mods: Modifier[] = [];
    let first = head.first;
    while (first > 0 && mods.length < 3) {
      const left = tokens[first - 1];
      const right = tokens[first];
      const modifier =
        left && right && joined(sentence, left, right) ? modifierOf(left, first === 1) : null;
      if (!modifier) break;
      mods.push(modifier);
      first -= 1;
    }
    // Plain words describe a group only when something that is not part of it stands before them: a word
    // that could as well be a verb ("told ward nurses") does not start a name.
    while (
      mods.length > 0 &&
      mods[mods.length - 1]?.kind === 'plain' &&
      !anchored(sentence, tokens, first)
    ) {
      mods.pop();
      first += 1;
    }
    // Two capitalised words in a row before the noun of a person ("Alice Chen manager") are a name, and a
    // person's name is never a group's: the words are left out and the role is kept.
    const nameLike = (modifier: Modifier | undefined): boolean =>
      modifier !== undefined && modifier.token.capital && modifier.kind !== 'listed';
    const personal = mods.findIndex((modifier, at) => nameLike(modifier) && nameLike(mods[at + 1]));
    if (head.kind === 'strong' && PERSON_CATEGORIES.has(head.category) && personal >= 0) {
      mods.splice(personal);
      first = head.first - mods.length;
    }
    // A "notice board" is a thing, not a body of people; so are a "content delivery network" and an "admin
    // center". And a role noun that a machine word stands before ("auto attendants") names a system.
    const nearest = mods[0]?.token.lower;
    if (nearest !== undefined && THING_HEADS.get(head.lemma)?.has(nearest)) {
      things.push({ first: head.first - mods.length, headLast: head.last });
      continue;
    }
    if (nearest !== undefined && MACHINE_MODIFIERS.has(nearest) && head.kind !== 'proper') continue;

    const firstToken = tokens[first];
    if (!firstToken) continue;
    const before = tokens[first - 1];
    if (before && COUNT.test(before.raw) && joined(sentence, before, firstToken)) continue;
    const qualified = mods.some((modifier) => modifier.qualifies);
    const named = mods.some((modifier) => modifier.kind === 'capital' || modifier.token.capital);
    const introduced =
      before !== undefined && joined(sentence, before, firstToken) && before.lower === 'the';
    const bareBody =
      !qualified && DEFINITE_BODIES.has(head.lemma) && (introduced || headToken.capital);
    if (head.kind === 'weak' && !qualified && !bareBody) continue;
    if (head.kind === 'proper' && !(named && headToken.capital)) continue;

    // The words that say which ones are meant follow a group, or a position that says what it is in charge
    // of. After a single person ("a human support engineer with a summary") they describe a case, not a group,
    // and after a verb ("collects patients in pre-booked slots") they may belong to the verb.
    const position = head.kind === 'title' || TITLES.has(head.lemma);
    const more =
      (head.plural || COLLECTIVES.has(head.lemma) || position) &&
      standsAlone(sentence, tokens, first)
        ? kindOf(sentence, tokens, head.last, position, head.kind === 'title')
        : null;
    // A position says what it is in charge of ("head of finance"); alone it is only a word.
    if (head.kind === 'title' && (!more || tokens[head.last + 1]?.lower !== 'of')) continue;
    const lastIndex = more ? more.last : head.last;
    const lastToken = tokens[lastIndex];
    if (!lastToken) continue;
    let inList = false;
    for (let at = first; at <= lastIndex && !inList; at += 1) inList = listed.has(at);
    if (inList) continue;

    const words = [
      ...[...mods].reverse().map((modifier) => foldSingular(modifier.token.raw)),
      head.lemma,
      ...(more?.words ?? []),
    ];
    found.push({
      key: words.join(' '),
      surface: sentence.slice(firstToken.start, lastToken.end),
      category: categoryOf(
        head.category,
        mods.map((modifier) => modifier.cue),
      ),
      plural: head.plural,
      proper: named && headToken.capital && mods.length > 0,
      decides: decides(sentence, tokens, lastIndex),
      start: firstToken.start,
      end: lastToken.end,
      first,
      headLast: head.last,
      last: lastIndex,
    });
  }
  // A noun that only describes the one after it ("customer support team"), or that stands inside the
  // words that say which group is meant ("carers of patients with dementia"), is not a group of its own.
  return found.filter(
    (phrase) =>
      !things.some((thing) => thing.first <= phrase.headLast && thing.headLast > phrase.headLast) &&
      !found.some(
        (other) =>
          other !== phrase &&
          ((other.first <= phrase.headLast && other.headLast > phrase.headLast) ||
            (other.headLast < phrase.first && other.last >= phrase.first)),
      ),
  );
}

/** The cue, if any, that most of a sentence's other words give: pays, gains, or is exposed. */
function contextCueOf(tokens: readonly Token[], inside: ReadonlySet<number>): ContextCue | null {
  const counts: Record<ContextCue, number> = { cost: 0, benefit: 0, risk: 0 };
  for (const [position, token] of tokens.entries()) {
    if (inside.has(position)) continue;
    for (const cue of Object.keys(counts) as ContextCue[]) {
      if (CONTEXT_CUES[cue].has(token.lower) || CONTEXT_CUES[cue].has(foldSingular(token.raw))) {
        counts[cue] += 1;
      }
    }
  }
  const ranked = (Object.entries(counts) as [ContextCue, number][])
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1]);
  const [best, next] = ranked;
  return best && (!next || best[1] > next[1]) ? best[0] : null;
}

/** Whether the sentence says what someone asks, says or does, which gives the groups in it a position. */
const isVoiced = (tokens: readonly Token[]): boolean =>
  tokens.some((token) => STANCE_FORMS.has(token.lower));

/**
 * The noun a group's name is built on ("engineer" for "Tier-two engineers", "council" for "Larkholm
 * Island Council"), or null when the name has none: the last noun before any words that say which ones.
 */
export function headNounOf(name: string): string | null {
  const tokens = tokensOf(name, false);
  let found: string | null = null;
  for (const [index, token] of tokens.entries()) {
    if (index > 0 && KIND_PREPOSITIONS.has(token.lower)) break;
    found = headAt(name, tokens, index)?.lemma ?? found;
  }
  return found;
}

interface Reading extends Mention {
  plural: boolean;
}

/**
 * A group is written in the plural when the sources ever speak of it so: it is a population, and the
 * singular would say one member of it. A body or a position the sources only write in the singular stays
 * singular.
 */
function settled(readings: readonly Reading[]): Mention[] {
  const tallies = new Map<string, { plural: Map<string, number>; single: Map<string, number> }>();
  for (const reading of readings) {
    const entry = tallies.get(reading.key) ?? { plural: new Map(), single: new Map() };
    const tally = reading.plural ? entry.plural : entry.single;
    tally.set(reading.surface, (tally.get(reading.surface) ?? 0) + 1);
    tallies.set(reading.key, entry);
  }
  const chosen = new Map<string, string>();
  for (const [key, entry] of tallies) {
    const pool = entry.plural.size > 0 ? entry.plural : entry.single;
    const best = [...pool].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (best) chosen.set(key, best);
  }
  return readings.map(({ plural: _plural, ...mention }) => ({
    ...mention,
    surface: chosen.get(mention.key) ?? mention.surface,
  }));
}

/**
 * Every place the passages name a group, in reading order. A sentence that speaks to an AI system is
 * skipped, as is a label or a list of names, and a sentence in the overlap of two passages is counted once.
 */
export function readMentions(passages: readonly EvidenceChunk[]): Mention[] {
  const readings: Reading[] = [];
  const seen = new Set<string>();
  const previous = new Map<string, EvidenceChunk>();
  for (const passage of passages) {
    const before = previous.get(passage.documentId);
    previous.set(passage.documentId, passage);
    const overlap = before ? Math.max(0, before.end - passage.start) : 0;
    for (const sentence of analyse(passage)) {
      // A heading names what it is about even beside other headings, where the discovery lexicon reads a menu.
      const heading = /^\s*#{1,6}\s+\S/u.test(sentence.text);
      if (sentence.suspicious || (sentence.label && !heading)) continue;
      const tokens = tokensOf(sentence.readable, sentence.shouted);
      const voiced = isVoiced(tokens);
      for (const phrase of phrasesIn(sentence.readable, tokens, sentence.listed)) {
        if (sentence.start + phrase.end <= overlap) continue;
        const mark = `${phrase.key}|${sentence.lowered}`;
        if (seen.has(mark)) continue;
        seen.add(mark);
        const inside = new Set<number>();
        for (let at = phrase.first; at <= phrase.last; at += 1) inside.add(at);
        readings.push({
          key: phrase.key,
          surface: sentence.shouted ? phrase.surface.toLowerCase() : phrase.surface,
          category: phrase.category,
          cue: phrase.category === 'end-user' ? contextCueOf(tokens, inside) : null,
          passageId: passage.id,
          quote: excerptAround(sentence.text, phrase.start, phrase.end),
          voiced,
          named: phrase.proper,
          decides: phrase.decides,
          plural: phrase.plural,
        });
      }
    }
  }
  return settled(readings);
}
