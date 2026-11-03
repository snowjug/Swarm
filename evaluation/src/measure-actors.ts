import { rateOf, type Rate, wordsOf } from './measure-stats.js';

export interface GoldActor {
  id: string;
  name: string;
  voice: 'named' | 'implied' | 'missing';
  aliases: readonly string[];
}

export interface LiveActor {
  id: string;
  name: string;
}

const GENERIC_WORDS = new Set([
  'staff',
  'user',
  'public',
  'employee',
  'management',
  'manager',
  'stakeholder',
  'team',
  'people',
  'person',
  'individual',
  'everyone',
  'others',
  'worker',
  'member',
  'group',
  'party',
  'participant',
]);

const MODIFIER_WORDS = new Set([
  'key',
  'other',
  'all',
  'relevant',
  'affected',
  'interested',
  'general',
  'various',
  'internal',
  'external',
]);

const CONNECTIVES = new Set(['and', 'or', 'of', 'the', 'a', 'an', 'for', 'to', 'in']);

const singular = (word: string): string => {
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) return word.slice(0, -1);
  return word;
};

const inSet = (set: ReadonlySet<string>, word: string): boolean =>
  set.has(word) || set.has(singular(word));

/** A name made only of generic words, optionally with the modifiers and connectives the list names. */
export function isGenericName(name: string): boolean {
  const tokens = wordsOf(name).filter((word) => !CONNECTIVES.has(word));
  if (tokens.length === 0) return false;
  const known = tokens.every((word) => inSet(GENERIC_WORDS, word) || inSet(MODIFIER_WORDS, word));
  return known && tokens.some((word) => inSet(GENERIC_WORDS, word));
}

export function genericNamesAccepted(live: readonly LiveActor[]): {
  count: number;
  names: string[];
} {
  const names = live.filter((actor) => isGenericName(actor.name)).map((actor) => actor.name);
  return { count: names.length, names };
}

/** The alias occurs in the name as whole words, case folded. */
export function aliasMatches(name: string, alias: string): boolean {
  const wanted = wordsOf(alias);
  const have = wordsOf(name);
  if (wanted.length === 0 || wanted.length > have.length) return false;
  for (let at = 0; at + wanted.length <= have.length; at += 1) {
    if (wanted.every((word, offset) => have[at + offset] === word)) return true;
  }
  return false;
}

const matchedLength = (name: string, gold: GoldActor): number =>
  Math.max(
    0,
    ...gold.aliases
      .filter((alias) => aliasMatches(name, alias))
      .map((alias) => wordsOf(alias).length),
  );

/** The labelled participant a name matches by its longest alias (the first of equals), or null. */
export function bestMatch(name: string, gold: readonly GoldActor[]): GoldActor | null {
  let best: GoldActor | null = null;
  let length = 0;
  for (const candidate of gold) {
    const own = matchedLength(name, candidate);
    if (own > length) {
      best = candidate;
      length = own;
    }
  }
  return best;
}

const isCovered = (gold: GoldActor, live: readonly LiveActor[]): boolean =>
  live.some((actor) => matchedLength(actor.name, gold) > 0);

/** Share of the labelled participants (named or implied) that a live participant matches. */
export function actorCoverage(
  gold: readonly GoldActor[],
  live: readonly LiveActor[],
): Rate & { missed: string[] } {
  const labelled = gold.filter((actor) => actor.voice !== 'missing');
  const missed = labelled.filter((actor) => !isCovered(actor, live)).map((actor) => actor.id);
  return { ...rateOf(labelled.length - missed.length, labelled.length), missed };
}

/** Share of the labelled missing voices that the proposal surfaced as a participant. */
export function missingVoiceSurfaced(gold: readonly GoldActor[], live: readonly LiveActor[]): Rate {
  const missing = gold.filter((actor) => actor.voice === 'missing');
  return rateOf(missing.filter((actor) => isCovered(actor, live)).length, missing.length);
}

const contentWords = (name: string): Set<string> =>
  new Set(
    wordsOf(name)
      .filter((word) => !CONNECTIVES.has(word) && word.length >= 4)
      .map(singular)
      .filter((word) => !GENERIC_WORDS.has(word) && !MODIFIER_WORDS.has(word)),
  );

/**
 * A lenient reading of coverage, for judging how much the strict one depends on the aliases: a
 * labelled participant counts as covered when any live name shares a word of four letters or more with
 * its own name, that is not a generic word. It is an upper bound, and is not compared with a threshold.
 */
export function actorCoverageLenient(gold: readonly GoldActor[], live: readonly LiveActor[]): Rate {
  const labelled = gold.filter((actor) => actor.voice !== 'missing');
  const liveWords = live.map((actor) => contentWords(actor.name));
  const covered = labelled.filter((actor) => {
    const own = contentWords(actor.name);
    return liveWords.some((words) => [...own].some((word) => words.has(word)));
  });
  return rateOf(covered.length, labelled.length);
}

const nameKey = (name: string): string =>
  [
    ...new Set(
      wordsOf(name)
        .filter((word) => !CONNECTIVES.has(word))
        .map(singular),
    ),
  ]
    .sort()
    .join(' ');

/**
 * Share of live participants that repeat an earlier live participant: the same labelled participant
 * by best match, or the same set of name words. It is measured at the granularity of the labels.
 */
export function actorRedundancy(
  gold: readonly GoldActor[],
  live: readonly LiveActor[],
): Rate & { repeats: string[] } {
  const seenGold = new Set<string>();
  const seenKeys = new Set<string>();
  const repeats: string[] = [];
  for (const actor of live) {
    const match = bestMatch(actor.name, gold)?.id ?? null;
    const key = nameKey(actor.name);
    if ((match !== null && seenGold.has(match)) || seenKeys.has(key)) repeats.push(actor.name);
    if (match !== null) seenGold.add(match);
    seenKeys.add(key);
  }
  return { ...rateOf(repeats.length, live.length), repeats };
}
