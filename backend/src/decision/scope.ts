import { type HighStakesDomain, HIGH_STAKES_DOMAINS } from '../../../shared/decision.js';
import {
  ALL_VERBS,
  CUES,
  DECIDED_ROLES,
  DECIDING_VERBS,
  FOLLOWS,
  HONORIFIC,
  MODIFIERS,
  NAME,
  NAMING_VERBS,
  NOT_ADJUNCT,
  NOT_NAMES,
  NUMBER,
  OWN_MATTERS,
  PERSONAL_MATTERS,
  PERSON_PLURAL,
  POLICY_AFTER,
  POLICY_BEFORE,
  PROMOTED_TO,
  ROLES,
  SELF_VERBS,
  STATES,
  STRONG_VERBS,
  roleDomain,
  safeQuote,
  word,
  type Cue,
} from './scope-cues.js';
import { GIVEN_NAMES } from './scope-names.js';
import { PERSON_CUES, PERSON_FINDERS } from './scope-people.js';
import { genericPeople, pairedMatters } from './scope-generic.js';

/**
 * Whether a question is about a matter that Swarm does not decide: a person’s employment, credit, legal, medical or
 * safety situation. It is a reading of words by rules, with no model, so it is explainable and the same every time:
 * it lists the cues it found, and it is not complete (a question put in other words is not recognised). Two things
 * are read apart.
 *
 *  - The domains: the question or its framing speaks of hiring, lending, litigation, treatment, evacuation or the
 *    like. That alone only calls for a notice, so the cues are generous.
 *  - Whether it is about one person: an act of a domain (to dismiss, to approve a loan, to diagnose) and a
 *    reference to one person (“this employee”, “these named applicants”, a name after the verb, “him”, “my”) stand
 *    together in one clause. That forces a human decision, so it is read narrowly: a policy or a process (“our
 *    hiring policy”, “lending criteria”, “a triage protocol”) is not one person, whoever else the sentence
 *    mentions, and a group (“our employees”) is not one person either. A construction that puts a person where an act
 *    is done to them (“promote Priya”, “give her a raise”, “cut the nurse’s hours”, “let Maria operate the forklift”,
 *    “offer the job to the second candidate”) is both at once (`scope-people.ts`).
 */

export interface ScopeFrame {
  decision?: string | null;
  system?: string | null;
  requestedDecision?: string | null;
  alternatives?: readonly { label?: string | null; description?: string | null }[] | null;
}

export interface ConsequentialScope {
  /** The domains the question or its framing speaks of, in a fixed order. */
  domains: HighStakesDomain[];
  /** An act of one of those domains is said of one person. */
  aboutIndividual: boolean;
  /** The cues found, a few words each: never a name, and never more of the question than a few words. */
  basis: string[];
}

// ---------------------------------------------------------------------------------------------
// One person
// ---------------------------------------------------------------------------------------------

const NAMED = 'a named person';

/** What can be a name in a capitalised run: “Is Amara” is “Amara”, and “Berlin Staff” is nothing. */
function properName(run: string | undefined): string[] {
  const tokens = (run ?? '').split(/\s+/u).filter((token) => token !== '');
  let from = tokens.length;
  while (from > 0 && !NOT_NAMES.has((tokens[from - 1] ?? '').toLowerCase())) from -= 1;
  return tokens.slice(from);
}

/** A name that begins at `from` and heads its phrase: `least` capitalised words, or one after a title. */
function nameAt(clause: string, from: number, least: number): boolean {
  const found = new RegExp(String.raw`\s*(${HONORIFIC})?(${NAME}(?:\s+${NAME}){0,2})`, 'uy');
  found.lastIndex = from;
  const match = found.exec(clause);
  if (!match?.[2]) return false;
  let tokens = match[2].split(/\s+/u);
  const stop = tokens.findIndex((token) => NOT_NAMES.has(token.toLowerCase()));
  if (stop === 0) return false;
  if (stop > 0) tokens = tokens.slice(0, stop);
  const known = tokens.length === 1 && GIVEN_NAMES.has((tokens[0] ?? '').toLowerCase());
  if (tokens.length < (match[1] ? 1 : least) && !known) return false;
  const end = from + match[0].indexOf(match[2]) + tokens.join(' ').length;
  const after = new RegExp(FOLLOWS, 'uy');
  after.lastIndex = end;
  return after.test(clause);
}

const endOf = (match: RegExpMatchArray): number => (match.index ?? 0) + match[0].length;
const SUBJECT_OF = new RegExp(String.raw`^\s+(?:${ALL_VERBS})\b`, 'iu');
const PASSIVE_BEFORE = /\b(?:was|were|is|are|be|been|being|get|gets|got|getting)\s+$/iu;
/** A person put before the act (“our manager hires …”) does it; the act is not done to them, unless it is said in the passive (“was this employee fired”). */
const doesTheAct = (clause: string, match: RegExpMatchArray): boolean =>
  SUBJECT_OF.test(clause.slice(endOf(match))) &&
  !PASSIVE_BEFORE.test(clause.slice(0, match.index ?? 0));
const personal = new RegExp(String.raw`^(?:${PERSONAL_MATTERS})$`, 'u');
const titled = /^(?:Mr|Mrs|Ms|Miss|Mx|Dr)\b/u;

interface Finder {
  re: RegExp;
  /** What the basis says of what was found: never a name. */
  cue: string | 'quoted';
  /** The group that holds a role noun, for the roles that are a matter of a domain by themselves. */
  noun?: number;
  accept?: (match: RegExpMatchArray, clause: string) => boolean;
}

const finder = (source: string, flags = 'giu'): RegExp => new RegExp(source, flags);

const FINDERS: Finder[] = [
  // “named applicants”, “an employee named …”
  { re: finder(String.raw`\bnamed\s+(${ROLES}|${PERSON_PLURAL})\b`), cue: 'quoted', noun: 1 },
  {
    re: finder(String.raw`\b(${ROLES}|${PERSON_PLURAL})\s+(?:named|called)\s+(\p{L}[\p{L}'-]*)`),
    cue: NAMED,
    noun: 1,
    accept: (match) => /^\p{Lu}/u.test(match[2] ?? ''),
  },
  // “this employee”, “our worst-performing manager”, “my mother”
  {
    re: finder(
      String.raw`\b(?:this|that|my|our|his|her|your)\s+(?:(?:named|specific|particular)\s+)?${MODIFIERS}(${ROLES})\b${NOT_ADJUNCT}`,
    ),
    cue: 'quoted',
    noun: 1,
    accept: (match, clause) => !doesTheAct(clause, match),
  },
  {
    re: finder(
      String.raw`\bone of (?:our|the|my|these|those)\s+(?:${PERSON_PLURAL})\b${NOT_ADJUNCT}`,
    ),
    cue: 'quoted',
  },
  // “these five applicants”, “those two named patients”
  {
    re: finder(
      String.raw`\b(?:these|those|the following)\s+(?:(?:${NUMBER})\s+)?(?:(?:named|identified|shortlisted|individual)\s+)?(${PERSON_PLURAL})\b${NOT_ADJUNCT}`,
    ),
    cue: 'quoted',
    noun: 1,
    accept: (match, clause) => !doesTheAct(clause, match),
  },
  // “fire the manager”: the act, then a person said in the definite.
  {
    re: finder(String.raw`\b(?:${STRONG_VERBS})\s+the\s+${MODIFIERS}(${ROLES})\b${NOT_ADJUNCT}`),
    cue: 'quoted',
    noun: 1,
  },
  {
    re: finder(
      String.raw`\b(?:${DECIDING_VERBS})\s+the\s+${MODIFIERS}(${DECIDED_ROLES})\b${NOT_ADJUNCT}`,
    ),
    cue: 'quoted',
    noun: 1,
  },
  // “which candidate should we hire”, “which of our two engineers”, “who should we promote”
  {
    re: finder(
      String.raw`\bwhich\s+(?:one\s+)?of\s+(?:our|the|these|those|my)\s+(?:(?:${NUMBER})\s+)?(?:(?:named|shortlisted)\s+)?(${PERSON_PLURAL})\b${NOT_ADJUNCT}`,
    ),
    cue: 'quoted',
    noun: 1,
  },
  {
    re: finder(String.raw`\bwhich\s+(?:\p{L}+\s+){0,2}?(${ROLES})\b${NOT_ADJUNCT}`),
    cue: 'quoted',
    noun: 1,
  },
  {
    re: finder(
      String.raw`\bwho\s+(?:should|shall|must|can|could|would|do|will)\s+(?:we|i)\s+(?:${NAMING_VERBS}|lay off|let go|select|choose|pick|accept|reject|admit|treat)\b`,
    ),
    cue: 'quoted',
  },
  // A name that the act is done to, said in the passive: “Mrs Dlamini be approved”, “she gets promoted”.
  {
    re: finder(
      String.raw`(?:${HONORIFIC})?(${NAME}(?:\s+${NAME}){0,2})\s+(?:is|was|be|been|being|gets?|got)\s+(?:${ALL_VERBS})\b`,
      'gu',
    ),
    cue: NAMED,
    accept: (match) => properName(match[1]).length > 0,
  },
  {
    re: finder(String.raw`\b(?:he|she)\s+(?:is|was|be|been|being|gets?|got)\s+(?:${ALL_VERBS})\b`),
    cue: 'quoted',
  },
  // A name said to be fit, eligible or safe: “Is Amara fit to …”.
  {
    re: finder(
      String.raw`(?:${HONORIFIC})?(${NAME}(?:\s+${NAME}){0,2})\s+(?:(?:is|was|be|been|being)\s+)?(?:${STATES})\b`,
      'gu',
    ),
    cue: NAMED,
    accept: (match) => properName(match[1]).length > 0,
  },
  {
    re: finder(String.raw`\b(?:he|she)\s+(?:(?:is|was|be|been|being)\s+)?(?:${STATES})\b`),
    cue: 'quoted',
  },
  // A name after the act: “fire Maria Lopez”, “diagnose Dr Okafor”.
  {
    re: word(NAMING_VERBS),
    cue: NAMED,
    accept: (match, clause) =>
      !/^(?:lend|underwrit)/iu.test(match[0]) && nameAt(clause, endOf(match), 1),
  },
  {
    re: word(DECIDING_VERBS),
    cue: NAMED,
    accept: (match, clause) => nameAt(clause, endOf(match), 2),
  },
  // A matter for a name: “a loan for John Smith”, “the position to Chen Wei”.
  {
    re: finder(
      String.raw`\b(?:${OWN_MATTERS}|position|role|job|offer)\s+(?:for|to|against|about|on|regarding)\b`,
    ),
    cue: NAMED,
    accept: (match, clause) => nameAt(clause, endOf(match), 2),
  },
  // A name’s matter: “Maria’s mortgage”, “Tom Becker’s contract”.
  {
    re: finder(String.raw`(?:${HONORIFIC})?(${NAME}(?:\s+${NAME})?)'s\s+(${OWN_MATTERS})\b`, 'gu'),
    cue: NAMED,
    accept: (match) => {
      const tokens = properName(match[1]);
      return (
        tokens.length > 0 &&
        (tokens.length > 1 || personal.test(match[2] ?? '') || titled.test(match[0]))
      );
    },
  },
  // “him”, “her”: the person the act is done to.
  { re: finder(String.raw`\b(?:${ALL_VERBS})\s+him\b`), cue: '“him”' },
  { re: finder(String.raw`\b(?:${ALL_VERBS})\s+her\b${FOLLOWS}`), cue: '“her”' },
  {
    re: finder(String.raw`\b(?:for|to|against|about|on|regarding)\s+(?:him\b|her\b${FOLLOWS})`),
    cue: 'quoted',
  },
  {
    re: finder(String.raw`\b(?:let|lay|make|show)\s+(?:him|her)\s+(?:go|off|redundant|the door)\b`),
    cue: 'quoted',
  },
  // “let Maria go”, “make Tom Becker redundant”, “part ways with Sam Lee”, “give Sam a raise”.
  {
    re: finder(
      String.raw`\b(?:[Ll]et(?:s|ting)?|[Mm]ak(?:e|es|ing))\s+(${NAME}(?:\s+${NAME}){0,2})\s+(?:go|redundant)\b`,
      'gu',
    ),
    cue: NAMED,
    accept: (match) => properName(match[1]).length > 0,
  },
  {
    re: finder(
      String.raw`\b[Pp]art(?:s|ed|ing)?\s+ways\s+with\s+(${NAME}(?:\s+${NAME}){0,2})`,
      'gu',
    ),
    cue: NAMED,
    accept: (match) => properName(match[1]).length > 0,
  },
  {
    re: finder(
      String.raw`\b(?:[Gg]ive|[Gg]ives|gave|giving|[Gg]rant|[Gg]ranting|[Dd]eny|[Dd]enying|[Rr]efuse|[Rr]efusing)\s+(${NAME}(?:\s+${NAME}){0,2})\s+(?:a|an|the)\s+(?:raise|pay rise|pay increase|salary increase|promotion|loan|mortgage|overdraft|credit limit|refund)\b`,
      'gu',
    ),
    cue: NAMED,
    accept: (match) => properName(match[1]).length > 0,
  },
  {
    re: finder(String.raw`\b(?:report|reports|reported|reporting)\s+(?:him|her)\b`),
    cue: 'quoted',
  },
  // “offer Sam the job”, “promote Dana or Priya to head of sales”, “pay Sam more”.
  {
    re: finder(
      String.raw`\b[Oo]ffer(?:s|ed|ing)?\s+(${NAME}(?:\s+${NAME}){0,2})\s+(?:the|a|an)\s+(?:\p{L}+\s+){0,3}(?:position|role|job)\b`,
      'gu',
    ),
    cue: NAMED,
    accept: (match) => properName(match[1]).length > 0,
  },
  {
    re: finder(
      String.raw`\b[Pp]romot(?:e|es|ed|ing)\s+(${NAME}(?:\s+${NAME}){0,2})(?:\s+(?:or|and)\s+${NAME}(?:\s+${NAME}){0,2})?\s+${PROMOTED_TO}`,
      'gu',
    ),
    cue: NAMED,
    accept: (match) => properName(match[1]).length > 0,
  },
  {
    re: finder(
      String.raw`\b[Pp]ay(?:s|ing)?\s+(${NAME}(?:\s+${NAME}){0,2})\s+(?:more|less)\b`,
      'gu',
    ),
    cue: NAMED,
    accept: (match) => properName(match[1]).length > 0,
  },
  // The asker is the person: “can I be fired for …”, “will I be refused”.
  {
    re: finder(
      String.raw`\bi\s+(?:(?:am\s+|was\s+)?(?:going to|gonna)\s+)?(?:be|get|got|been|being|getting)\s+(?:${ALL_VERBS})\b`,
    ),
    cue: 'quoted',
  },
  { re: finder(String.raw`\b(?:his|her|my)\s+(?:${OWN_MATTERS})\b`), cue: 'quoted' },
  // The asker’s own matter: “should I sue”. And a man or woman’s: “should she take it”.
  {
    re: finder(
      String.raw`\b(?:(?:should|can|could|shall|must|do|would|may|might)\s+i|whether\s+(?:to|i should))\s+(?:${SELF_VERBS})\b`,
    ),
    cue: 'quoted',
  },
  {
    re: finder(
      String.raw`\b(?:should|can|could|shall|must|do|would|may|might)\s+(?:he|she)\s+(?:${SELF_VERBS}|start|stop|continue|receive|undergo|have|keep)\b`,
    ),
    cue: 'quoted',
  },
];

interface Found {
  cues: string[];
  /** The domains that a role is a matter of by itself, with the noun, for the basis. */
  roles: { domain: HighStakesDomain; noun: string }[];
}

function peopleOf(clause: string): Found {
  const found: Found = { cues: [], roles: [] };
  for (const { re, cue, noun, accept } of FINDERS) {
    for (const match of clause.matchAll(re)) {
      if (accept && !accept(match, clause)) continue;
      found.cues.push(cue === 'quoted' ? `“${safeQuote(match[0])}”` : cue);
      const role = noun ? roleDomain(match[noun] ?? '') : undefined;
      if (role) found.roles.push({ domain: role, noun: (match[noun ?? 0] ?? '').toLowerCase() });
    }
  }
  // The constructions that say a person and what is done to them in one: the person is read where they stand.
  for (const finder of PERSON_FINDERS) {
    for (const match of clause.matchAll(finder.re)) {
      if (!finder.accept(match, clause)) continue;
      found.cues.push(finder.label(match));
      const noun = finder.nounOf(match);
      const role = noun ? roleDomain(noun) : undefined;
      if (role && noun) found.roles.push({ domain: role, noun });
    }
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// The reading
// ---------------------------------------------------------------------------------------------

interface Hit {
  domain: HighStakesDomain;
  cue: string;
  /** Said of a field or a rule, not of an act on a person. */
  aside: boolean;
}

/** Every cue with the domain it is listed under; the constructions of `scope-people.ts` give their own domain. */
const CUE_LIST: readonly { domain: HighStakesDomain; cue: Cue }[] = [
  ...HIGH_STAKES_DOMAINS.flatMap((domain) => CUES[domain].map((cue) => ({ domain, cue }))),
  ...PERSON_CUES.map((cue) => ({ domain: 'employment' as const, cue })),
];

function hitsOf(clause: string): Hit[] {
  const hits: Hit[] = [];
  for (const { domain, cue } of CUE_LIST) {
    if (cue.also && clause.search(cue.also) < 0) continue;
    for (const match of clause.matchAll(cue.re)) {
      if (cue.accept && !cue.accept(match, clause)) continue;
      const start = match.index ?? 0;
      const policy =
        POLICY_AFTER.test(clause.slice(endOf(match))) ||
        POLICY_BEFORE.test(clause.slice(Math.max(0, start - 40), start));
      hits.push({
        domain: cue.domain ? cue.domain(clause, match) : domain,
        cue: cue.label ? cue.label(match) : match[0].toLowerCase(),
        aside: cue.topic === true || policy,
      });
    }
  }
  return hits;
}

const SENTENCE_BREAKS = /(?<=[.?!;])\s+(?=\S)|\s[–—]\s/u;
const CLAUSE_BREAKS =
  /\s*[,;:]\s*|\s+\b(if|when|while|because|since|although|though|unless|until|once|whereas|but|after|before)\b\s+/giu;
/** Words that make what follows “after” a clause of its own, and not a place, a time or a procedure: “after surgery”. */
const CLAUSE_WORDS =
  /\b(?:we|i|you|they|he|she|it|there|is|are|was|were|has|have|had|will|would|can|could|should|does|did|do|must|may|might)\b/iu;

/** The clauses of a sentence. “After” and “before” begin one only when a clause follows them: “fit to work after surgery” is one. */
function splitClauses(sentence: string): string[] {
  const pieces = sentence.split(CLAUSE_BREAKS);
  const clauses: string[] = [];
  for (let at = 0; at < pieces.length; at += 2) {
    const fragment = pieces[at] ?? '';
    const conjunction = (pieces[at - 1] ?? '').toLowerCase();
    const brief = fragment.split(' ').length <= 4 && !CLAUSE_WORDS.test(fragment);
    if ((conjunction === 'after' || conjunction === 'before') && brief && clauses.length > 0) {
      clauses[clauses.length - 1] += ` ${conjunction} ${fragment}`;
    } else {
      clauses.push(fragment);
    }
  }
  return clauses;
}
const ABBREVIATIONS = /\b(Mr|Mrs|Ms|Mx|Dr|Prof|Jr|Sr|St|vs|No)\./gu;
/** What is read of all the texts together, and of one text: more than this is not read, however long the text is. */
const MAX_CLAUSES = 40;
/** And of one text, no more than this many characters are read. */
const MAX_CHARACTERS = 12_000;

/** A line break is a break only between paragraphs and list items; elsewhere it is where a pasted line was wrapped. */
const PARAGRAPH_BREAKS = /\n\s*\n|\n(?=\s*(?:[-*•–]|\d+[.)])\s)/u;

/** The text as it is read: text that is all capitals is lowercased, the apostrophes and quotes are the plain ones. */
function plainText(text: string): string {
  const letters = text.replace(/[^\p{L}]/gu, '');
  // Capitals are read for names, so text that is all capitals is read as it is said, not as it is written.
  const plain =
    letters.length >= 8 && letters === letters.toUpperCase() ? text.toLowerCase() : text;
  return plain
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u02bc]/gu, "'")
    .replace(/[\u201c\u201d]/gu, '"')
    .replace(/[\u200b-\u200d\ufeff]/gu, '');
}

/** The clauses of a text: where an act and a person must stand together to be about one another. */
function clausesOf(text: string, limit: number): string[] {
  const clauses: string[] = [];
  // Paragraph by paragraph, and stop at the limit: how much of a long text is read does not depend on how long it is.
  for (const paragraph of plainText(text.slice(0, MAX_CHARACTERS)).split(PARAGRAPH_BREAKS)) {
    const sentences = paragraph
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, 2_400)
      .replace(ABBREVIATIONS, '$1')
      .split(SENTENCE_BREAKS);
    for (const sentence of sentences) {
      for (const clause of splitClauses(sentence)) {
        const trimmed = clause.trim();
        if (trimmed === '') continue;
        clauses.push(trimmed);
        if (clauses.length >= limit) return clauses;
      }
    }
  }
  return clauses;
}

/** Verbs that say little by themselves: a cue of one is dropped when a longer cue holds it (“make” and “make redundant”). */
const WEAK_VERBS: ReadonlySet<string> = new Set(
  'make put let take give keep turn sign call pull write pass ask stop send move get lay'.split(
    ' ',
  ),
);

/** Cues once each, and a cue that holds another (“we fire” and “fire”) is that other. */
const distinct = (cues: readonly string[]): string[] => {
  const once = [...new Set(cues)];
  return once.filter((cue) => {
    if (WEAK_VERBS.has(cue)) {
      return !once.some((other) => other !== cue && other.split(' ').includes(cue));
    }
    return !once.some(
      (other) =>
        other !== cue && other.length < cue.length && !WEAK_VERBS.has(other) && cue.includes(other),
    );
  });
};

/**
 * What the question and its framing say about matters that Swarm does not decide. Pure, and the same every time.
 * Nothing here refuses anything: it says what the person should be told, and the canvas does the telling.
 */
export function consequentialScope(
  question: string,
  frame?: ScopeFrame | null,
): ConsequentialScope {
  const texts = [
    question,
    frame?.decision,
    frame?.requestedDecision,
    frame?.system,
    ...(frame?.alternatives ?? []).flatMap((alternative) => [
      alternative.label,
      alternative.description,
    ]),
  ].filter((text): text is string => typeof text === 'string' && text.trim() !== '');

  const cues = new Map<HighStakesDomain, string[]>();
  const people: string[] = [];
  let aboutIndividual = false;
  const note = (domain: HighStakesDomain, cue: string): void => {
    cues.set(domain, [...(cues.get(domain) ?? []), cue]);
  };

  // What is read of all the texts together is bounded: more clauses than any question holds are not read.
  let budget = MAX_CLAUSES;
  for (const text of texts) {
    const clauses = clausesOf(text, budget);
    budget -= clauses.length;
    for (const clause of clauses) {
      const hits = hitsOf(clause);
      const found = peopleOf(clause);
      const generic = genericPeople(clause);
      const persons = [...found.cues, ...generic.cues];
      // A matter such as a notice or “make … redundant” is a domain’s only where a person stands in the clause.
      const paired = persons.length > 0 ? pairedMatters(clause) : [];
      for (const hit of hits) note(hit.domain, hit.cue);
      for (const role of [...found.roles, ...generic.roles]) note(role.domain, role.noun);
      for (const hit of paired) note(hit.domain, hit.cue);
      const acts =
        hits.some((hit) => !hit.aside) ||
        paired.some((hit) => !hit.aside) ||
        found.roles.length > 0 ||
        generic.roles.length > 0;
      if (persons.length === 0 || !acts) continue;
      aboutIndividual = true;
      people.push(...persons);
    }
  }

  // What is reported never repeats a name: a last guard behind the labels, which are made without one.
  const names = namesIn(texts);
  const domains = HIGH_STAKES_DOMAINS.filter((domain) => cues.has(domain));
  const basis = [
    ...domains.flatMap((domain) =>
      distinct(cues.get(domain) ?? [])
        .slice(0, 2)
        .map((cue) => `${domain}: “${withoutNames(cue, names)}”`),
    ),
    ...(aboutIndividual
      ? distinct(people)
          .slice(0, 2)
          .map((cue) => `about one person: ${withoutNames(cue, names)}`)
      : []),
  ].slice(0, 8);
  return { domains, aboutIndividual, basis };
}

/** The capitalised words that can be a name: any that is not at the start of a sentence, and one that is only if it is a given name. */
function namesIn(texts: readonly string[]): ReadonlySet<string> {
  const names = new Set<string>();
  for (const text of texts) {
    const plain = plainText(text.slice(0, 12_000));
    for (const match of plain.matchAll(/\p{Lu}\p{Ll}[\p{L}'-]*/gu)) {
      const lower = match[0].toLowerCase().replace(/'s$/u, '');
      const at = match.index ?? 0;
      const opening = at === 0 || /[.!?:;\n]\s*$/u.test(plain.slice(Math.max(0, at - 3), at));
      if (lower.length < 2 || NOT_NAMES.has(lower)) continue;
      if (!opening || GIVEN_NAMES.has(lower)) names.add(lower);
    }
  }
  return names;
}

/** A cue without any word that is a name in the text it was read from: “promote … to head” and not the name between. */
function withoutNames(cue: string, names: ReadonlySet<string>): string {
  if (names.size === 0) return cue;
  return cue
    .replace(/[\p{L}][\p{L}'-]*/gu, (word) =>
      names.has(word.toLowerCase().replace(/'s$/u, '')) ? '' : word,
    )
    .replace(/\s{2,}/gu, ' ')
    .replace(/“\s+/gu, '“')
    .replace(/\s+”/gu, '”')
    .trim();
}
