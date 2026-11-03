import { lintText, ownWords } from '../../brief/lint.js';
import { singular } from '../lexicon.js';
import { truncate } from '../names.js';

/**
 * The language rules behind the participant checks: what a name may not be, what generated text may
 * not say about people, and when two names are one. They read generated words only. A quotation in
 * curly marks is a source's or a person's own text and is never judged here (`ownWords`), exactly as
 * the brief's wording guard treats it. None of these rules names a market, a product or a group of
 * people by what it sells or does: a pattern is a form of words, and a refusal is always a sentence a
 * person can act on.
 */

const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
export const wordsIn = (text: string): string[] => text.toLowerCase().match(WORD) ?? [];

// ---------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------

const FILLER: ReadonlySet<string> = new Set(
  'the a an of for in on at to and or with by from our their its this that these those'.split(' '),
);

/** The words that make a name what it is: lower case, singular, without articles and joiners. */
export const nameTokens = (name: string): string[] =>
  wordsIn(name)
    .map(singular)
    .filter((token) => token !== '' && !FILLER.has(token));

/** Nouns that name a position in any organisation, or nobody in particular. A name made only of them says nothing. */
const GENERIC_NOUNS: ReadonlySet<string> = new Set(
  (
    'staff specialist management manager user public employee stakeholder team worker people person individual ' +
    'member group party participant actor personnel others everyone someone anyone organisation organization ' +
    'company business department unit office division function entity body leadership'
  ).split(' '),
);
const GENERIC_MODIFIERS: ReadonlySet<string> = new Set(
  'general key other all relevant affected interested internal external various different certain main primary secondary end whole wider broader overall'.split(
    ' ',
  ),
);

/**
 * Whether a name is only a generic word, or a few of them: "Staff", "Users", "Key stakeholders",
 * "Team members". "Support staff" and "Sales team" are not: they say which staff and which team.
 */
export function isGenericName(name: string): boolean {
  const tokens = nameTokens(name);
  if (tokens.length === 0) return true;
  if (tokens.length > 3) return false;
  return (
    tokens.every((token) => GENERIC_NOUNS.has(token) || GENERIC_MODIFIERS.has(token)) &&
    tokens.some((token) => GENERIC_NOUNS.has(token))
  );
}

/** A role noun that is a real role but says little alone: it is worth saying which ones matter here. */
const BROAD_NOUNS: ReadonlySet<string> = new Set(
  'customer client consumer buyer subscriber engineer developer administrator analyst volunteer resident citizen visitor'.split(
    ' ',
  ),
);

export function isBroadName(name: string): boolean {
  const tokens = nameTokens(name);
  return tokens.length === 1 && BROAD_NOUNS.has(tokens[0] ?? '');
}

export type NameMatch = 'same' | 'contained' | 'overlap' | 'different';

const jaccard = (a: ReadonlySet<string>, b: ReadonlySet<string>): number => {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return shared / (a.size + b.size - shared);
};

/** How two names relate: the same words, one inside the other, mostly shared, or apart. */
export function compareNames(a: string, b: string): NameMatch {
  const left = new Set(nameTokens(a));
  const right = new Set(nameTokens(b));
  if (left.size === 0 || right.size === 0) return 'different';
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  const inside = [...small].every((token) => large.has(token));
  if (inside && small.size === large.size) return 'same';
  if (inside) return 'contained';
  return jaccard(left, right) >= 0.6 ? 'overlap' : 'different';
}

/** How alike two statements are by the words they use, 0 to 1. */
export function likeness(a: string, b: string): number {
  return jaccard(new Set(nameTokens(a)), new Set(nameTokens(b)));
}

// ---------------------------------------------------------------------------------------------
// What generated text may not say about people
// ---------------------------------------------------------------------------------------------

const GROUPS = String.raw`(?:women|woman|men|girls?|boys?|females?|males?|mothers?|fathers?|elderly|seniors?|older (?:people|adults?|customers?|workers?|users?|staff)|young (?:people|adults?|customers?|workers?|users?)|teenagers?|teens|youths?|millennials?|boomers?|gen(?:eration)? ?z|immigrants?|foreigners?|refugees?|migrants?|muslims?|christians?|jews|hindus?|sikhs?|buddhists?|atheists?|blacks|whites|asians?|latinos?|latinas?|hispanics?|arabs?|africans?|disabled (?:people|customers?|users?|workers?)|people with disabilit(?:y|ies)|autistic people|the disabled|the elderly|the poor|the rich|gay (?:people|men)|lesbians?|transgender people|trans people|minorit(?:y|ies)|ethnic minorit(?:y|ies)|pregnant (?:women|people|workers?)|single mothers?)`;
const SWEEPING = String.raw`(?:are|were|tend(?:s)? to|always|never|cannot|can['’]?t|don['’]?t|do not|won['’]?t|usually|typically|naturally|inherently|simply|prefer|distrust|resent|hate|fear|lack|struggle|only care|can(?:not)? be trusted)`;
/** A protected group with a sweeping claim about what its members are or do: "older customers never…". */
const SWEEPING_CLAIM = new RegExp(String.raw`\b${GROUPS}\s+(?:\p{L}+\s+){0,2}?${SWEEPING}\b`, 'iu');
/** A put-down attached to a group of people: "lazy employees", "greedy customers". */
const PUT_DOWN = new RegExp(
  String.raw`\b(?:lazy|greedy|stupid|ignorant|selfish|irrational|hysterical|naive|backward|primitive|dangerous|criminal|dishonest|untrustworthy|incompetent|entitled|whiny|clueless|tech-?illiterate)\s+(?:${GROUPS}|employees?|workers?|customers?|users?|staff|people|managers?|engineers?|clients?)\b`,
  'iu',
);
const SET_PHRASES =
  /\b(?:set in their ways|too old to (?:learn|change|adapt)|can['’]?t be bothered)\b/iu;

/** The words that make a generalisation about people, or null. */
export function findStereotype(text: string): string | null {
  const own = ownWords(text);
  return (
    SWEEPING_CLAIM.exec(own)?.[0] ?? PUT_DOWN.exec(own)?.[0] ?? SET_PHRASES.exec(own)?.[0] ?? null
  );
}

/** Words that claim a hidden reason: nothing in a source can say what someone keeps to themselves. */
const HIDDEN_MOTIVE =
  /\b(?:secretly|privately|covertly|deep down|at heart|in their hearts?|hidden agendas?|ulterior motives?|secret (?:agenda|plan|motive|goal|wish|intent(?:ion)?s?))\b/iu;

const HONORIFIC_NAME =
  /\b(?:Mr|Mrs|Ms|Mx|Dr|Prof|Professor|Sir|Dame)\.?\s+\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+)?/u;
const TITLE_NAME =
  /\b(?:CEO|CFO|CTO|COO|CIO|Chair(?:man|woman|person)?|President|Minister|Senator|Mayor|Governor|Founder)\s+\p{Lu}[\p{L}'’-]+\s+\p{Lu}[\p{L}'’-]+/u;
const MENTAL_STATE =
  /\b(?:wants?|wished?|hopes?|believes?|thinks?|feels?|felt|fears?|intends?|plans?|hates?|loves?|resents?|desires?|aims?|knows?|knew|(?:is|was) (?:afraid|angry|worried|jealous|ashamed|proud))\b/iu;

const escapePattern = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

/** Whether text points at one identified person: an honorific or a job title with a name, or a name the sources hold as a person. */
export function namesPerson(text: string, personLabels: readonly string[] = []): string | null {
  const own = ownWords(text);
  const pattern = HONORIFIC_NAME.exec(own) ?? TITLE_NAME.exec(own);
  if (pattern) return pattern[0];
  const lower = own.toLowerCase();
  for (const label of personLabels) {
    const wanted = label.trim().toLowerCase();
    if (
      wanted.length >= 4 &&
      new RegExp(`(?<![\\p{L}\\p{N}])${escapePattern(wanted)}(?![\\p{L}\\p{N}])`, 'u').test(lower)
    ) {
      return label;
    }
  }
  return null;
}

/**
 * A claim to know what is in someone's mind: a hidden reason, or a mental state put on an identified
 * person. A group's concern is a role's assumption and is judged elsewhere; this is about what no
 * source can show.
 */
export function findUnsupportedMotive(
  text: string,
  personLabels: readonly string[] = [],
): string | null {
  const own = ownWords(text);
  const hidden = HIDDEN_MOTIVE.exec(own)?.[0];
  if (hidden) return hidden;
  for (const sentence of own.split(/(?<=[.!?])\s+|[;\n]/u)) {
    if (!namesPerson(sentence, personLabels)) continue;
    const mental = MENTAL_STATE.exec(sentence)?.[0];
    if (mental) return `${mental} (said of a named person)`;
  }
  return null;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u;
const PHONE =
  /(?:\+\d[\d\s().-]{7,}\d|\(\d{2,4}\)[\s.-]?\d{3,4}[\s.-]?\d{3,4}|\b\d{3}[\s.-]\d{3,4}[\s.-]\d{4}\b)/u;
const HANDLE = /(?<![\w@])@[A-Za-z0-9_]{3,30}\b/u;
const STREET =
  /\b\d{1,5}\s+(?:\p{Lu}[\p{L}'’-]+\s+){1,3}(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Boulevard|Blvd|Close|Court|Way)\b/u;

const SECRET_SOURCES: readonly { source: string; flags: string }[] = [
  { source: String.raw`\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]*`, flags: 'u' },
  { source: String.raw`\b(?:Bearer|Basic)\s+\S+`, flags: 'iu' },
  { source: String.raw`\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@`, flags: 'iu' },
  {
    source: String.raw`\b(?:InstrumentationKey|AccountKey|SharedAccessKey|Password|Pwd)=[^;\s]+`,
    flags: 'iu',
  },
  {
    source: String.raw`\b(?:password|passwd|secret|token|api[_-]?key|authorization|signature|cookie)\s*[=:]\s*\S+`,
    flags: 'iu',
  },
  { source: String.raw`\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}`, flags: 'u' },
  { source: String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----`, flags: 'u' },
  { source: String.raw`\b[A-Za-z0-9_]{32,}\b`, flags: 'u' },
];

/** Credentials taken out of text before it goes anywhere: the model is never sent a secret that a source held. */
export function redactSecrets(text: string): string {
  let clean = text;
  for (const { source, flags } of SECRET_SOURCES) {
    clean = clean.replace(new RegExp(source, `g${flags}`), '[redacted]');
  }
  return clean;
}

/** The kind of personal or secret detail text carries, or null. */
export function findPersonalDetail(text: string): string | null {
  const own = ownWords(text);
  if (EMAIL.test(own)) return 'an email address';
  if (PHONE.test(own)) return 'a phone number';
  if (HANDLE.test(own)) return 'a social media handle';
  if (STREET.test(own)) return 'a street address';
  if (SECRET_SOURCES.some(({ source, flags }) => new RegExp(source, flags).test(own))) {
    return 'something that looks like a credential';
  }
  return null;
}

const WORDING_KINDS: Readonly<Record<string, string>> = {
  prediction: 'a forecast',
  overclaim: 'a claim of certainty',
  percentage: 'a percentage',
  'real-world-claim': 'a figure about the real world',
};

/** The rules of the brief's wording guard broken by text of our own: a forecast, an overclaim, a percentage, a figure about the world. */
export function wordingProblem(text: string): string | null {
  const first = lintText(text)[0];
  if (!first) return null;
  return `${WORDING_KINDS[first.rule] ?? 'overclaiming wording'} (“${first.match.trim().slice(0, 40)}”)`;
}

/**
 * What stops a name from standing, by the rules that block a participant: it points at an identified
 * person, holds a personal detail, generalises about people or claims to know a hidden reason. A name the
 * rules path takes from a source or makes from one is held to them before it is proposed, so that a
 * source's own words never make a proposal that its own checks would refuse.
 */
export function nameProblem(name: string, personLabels: readonly string[] = []): string | null {
  if (namesPerson(name, personLabels)) return 'it points at an identified person';
  if (findPersonalDetail(name)) return 'it holds a personal detail';
  if (findStereotype(name)) return 'it generalises about people';
  if (findUnsupportedMotive(name, personLabels)) return 'it claims to know a hidden reason';
  return null;
}

// ---------------------------------------------------------------------------------------------
// Tidying text
// ---------------------------------------------------------------------------------------------

/** One clean line: no markup, no control characters, one space between words, cut to `max`. */
export function normaliseLine(text: string, max: number): string {
  return truncate(
    text
      .replace(/<[^>]{0,200}>/gu, ' ')
      .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim(),
    max,
  );
}

/** Lines that are not empty and not the same as an earlier one, in the order given. */
export function distinctLines(lines: readonly string[], max: number, each: number): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const line of lines) {
    const clean = normaliseLine(line, each);
    const key = wordsIn(clean).join(' ');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    kept.push(clean);
    if (kept.length === max) break;
  }
  return kept;
}
