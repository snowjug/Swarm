import { type HighStakesDomain } from '../../../shared/decision.js';
import {
  ALL_VERBS,
  DECIDED_ROLES,
  DECIDING_VERBS,
  FOLLOWS,
  GO_ENDING,
  HONORIFIC,
  MODIFIERS,
  NAMING_VERBS,
  NOT_ADJUNCT,
  NOT_NAMES,
  QUALIFIERS,
  ROLES,
  STATES,
  STRONG_VERBS,
  safeQuote,
  type Cue,
} from './scope-cues.js';
import { GIVEN_NAMES } from './scope-names.js';

/**
 * The ways a person is said in a sentence about a decision, and what is done to them, as one table. Each entry is a
 * construction (“promote Priya”, “give her a raise”, “cut the nurse’s hours”, “let Maria operate the forklift”, “offer the
 * job to the second candidate”): a verb or a matter that belongs to a domain, and a person put where the construction
 * puts one. The same entry is the act that makes the clause a matter of a domain and the person it is done to, so
 * that a policy, a product or a group, which these constructions do not take as their person, is never read as one.
 * They are words and not understanding: a construction that is not in the table is not recognised.
 */

/** A person put in a role: “the second candidate”, “our worst-performing manager”. */
const ROLE_NP = String.raw`(?<role>(?:the|this|that|my|our|his|her|your)\s+(?:(?:${QUALIFIERS})\s+){0,2}${MODIFIERS}(?<noun>${ROLES})\b${NOT_ADJUNCT})`;
/** A person by name: read as one only where `resolve` says so. It begins where a word begins, so that no start inside a long word is tried. */
const NAME_NP = String.raw`(?<![\p{L}'-])(?<hon>${HONORIFIC})?(?<name>[\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*){0,2})`;
const PRON_NP = String.raw`(?<pron>him|her)\b`;
/** The person, in any of the three forms. The role comes first, so that “her manager” is not “her”. */
const PNP = `(?:${ROLE_NP}|${PRON_NP}|${NAME_NP})`;
/** The person who has the matter: “his”, “the nurse’s”, “Mr Okafor’s”. */
const POSSESSOR = String.raw`(?:(?<pron>his|her|my)|(?<role>(?:the|this|that|my|our|your)\s+(?:(?:${QUALIFIERS})\s+){0,2}${MODIFIERS}(?<noun>${ROLES}))'s|(?<![\p{L}'-])(?<hon>${HONORIFIC})?(?<name>[\p{L}][\p{L}-]*(?:\s+[\p{L}][\p{L}-]*){0,2})'s)`;

const NAMED = 'a named person';

/** What a person is promoted to: a post, not an audience, so that a product is never read as a person. */
const POST =
  /^\s+to\s+(?:the\s+|a\s+|an\s+)?(?:\p{L}+\s+){0,2}?(?:head|lead|chief|senior|manager|director|partner|vice|supervisor|executive|principal|officer|president|VP|CEO|CFO|CTO|COO)\b/iu;

const startsUpper = (token: string): boolean => /^\p{Lu}/u.test(token);

interface Resolved {
  label: string;
  /** The role noun, for a role that is a matter of its domain by itself. */
  noun?: string;
  /** Where the person ends in the clause. */
  end: number;
}

interface ResolveOptions {
  /** A single capitalised word is a name without being a known given name. */
  anyName?: boolean;
  /** The person is the possessor of something: “the nurse’s” is wanted, and so is “Maria’s”. */
  possessive?: boolean;
  /** What follows “her” is part of the construction, so that it is not read as “her product”. */
  herOk?: boolean;
  /** Only these role nouns count, for a verb that is also said of customers and users. */
  nouns?: ReadonlySet<string>;
}

const follows = new RegExp(FOLLOWS, 'uy');
const followsAt = (clause: string, at: number): boolean => {
  follows.lastIndex = at;
  return follows.test(clause);
};

/** Who the construction is about, or nothing when what stands where a person should is a product, a place, a group or a word. */
function resolve(
  match: RegExpMatchArray,
  clause: string,
  options: ResolveOptions = {},
): Resolved | null {
  const groups = match.groups ?? {};
  const spans = match.indices?.groups ?? {};
  if (groups.role) {
    const noun = (groups.noun ?? '').toLowerCase();
    if (options.nouns && !options.nouns.has(noun)) return null;
    const end = spans.role?.[1] ?? 0;
    if (!options.possessive && /^'s\b/iu.test(clause.slice(end))) return null;
    return { label: `“${safeQuote(groups.role)}”`, noun, end };
  }
  if (groups.pron) {
    const him = groups.pron.toLowerCase();
    const end = spans.pron?.[1] ?? 0;
    if (!options.possessive && him === 'her' && !options.herOk && !followsAt(clause, end)) {
      return null;
    }
    return { label: `“${him}”`, end };
  }
  if (groups.name) {
    // Only the words that begin with a capital and are not a title, a day or a word of an organisation are the name.
    const parts = groups.name.split(/(\s+)/u);
    const tokens: string[] = [];
    let length = 0;
    for (let at = 0; at < parts.length; at += 2) {
      const token = parts[at] ?? '';
      if (!startsUpper(token) || NOT_NAMES.has(token.toLowerCase().replace(/'s$/u, ''))) break;
      tokens.push(token);
      length += token.length + (parts[at - 1]?.length ?? 0);
    }
    if (tokens.length === 0) return null;
    const last = tokens[tokens.length - 1] ?? '';
    if (!options.possessive && /'s$/u.test(last)) return null;
    const first = (tokens[0] ?? '').toLowerCase();
    const known = tokens.length === 1 && GIVEN_NAMES.has(first);
    if (!(groups.hon || tokens.length >= 2 || known || options.anyName)) return null;
    return { label: NAMED, end: (spans.name?.[0] ?? 0) + length };
  }
  return null;
}

export interface PersonFinder {
  re: RegExp;
  /** What the basis says of what was found: never a name. */
  label: (match: RegExpMatchArray) => string;
  /** The role noun that was found, for a role that is a matter of a domain by itself. */
  nounOf: (match: RegExpMatchArray) => string | undefined;
  accept: (match: RegExpMatchArray, clause: string) => boolean;
}

export interface PersonCue extends Cue {
  domain: NonNullable<Cue['domain']>;
}

// ---------------------------------------------------------------------------------------------
// The matters that belong to a person, and the domain of each
// ---------------------------------------------------------------------------------------------

const MATTER_DOMAINS: readonly [RegExp, HighStakesDomain][] = [
  [
    /^(?:hours?|shifts?|pay|salary|salaries|wages?|bonus(?:es)?|commission|contract|role|post|position|job|duties|title|promotion|raise|probation|(?:sick |maternity |paternity |parental |annual |unpaid )?leave|holiday|appraisal|interview|offer)$/iu,
    'employment',
  ],
  [
    /^(?:dos(?:e|age)|medications?|medicines?|treatment|therapy|surgery|operation|bed|appointment|diagnosis|prescription|care plan|scan|transplant)$/iu,
    'medical',
  ],
  [
    /^(?:visa|(?:insurance |benefit |injury |warranty )?claim|case|appeal|sentence|bail|custody|lawsuit|settlement|residency|citizenship|asylum|passport|permit|parole|pardon|service|access|entry|admission|membership|coverage|cover|benefits?|will|estate|inheritance|probate|tenancy|testimony|conviction)$/iu,
    'legal',
  ],
  [
    /^(?:loan|mortgage|overdraft|credit|credit limit|debt|line of credit|repayment plan|refinancing)$/iu,
    'credit',
  ],
  [/^(?:licen[cs]e|clearance|certification)$/iu, 'safety'],
];

const domainOfMatter = (matter: string | undefined): HighStakesDomain | null => {
  const word = (matter ?? '').toLowerCase().replace(/\s+/gu, ' ').trim();
  return MATTER_DOMAINS.find(([pattern]) => pattern.test(word))?.[1] ?? null;
};

/** The matters a decision about a person is made of, as words; the ones that are a decision by themselves are below. */
const MATTERS =
  '(?:sick |maternity |paternity |parental |annual |unpaid )?leave|hours?|shifts?|pay|salary|salaries|wages?|bonus(?:es)?|commission|contract|role|post|position|job|duties|title|promotion|raise|probation|holiday|appraisal|interview|dos(?:e|age)|medications?|medicines?|treatment|therapy|surgery|operation|bed|appointment|diagnosis|prescription|care plan|scan|transplant|visa|(?:insurance |benefit |injury |warranty )?claim|case|appeal|sentence|bail|custody|lawsuit|settlement|residency|citizenship|asylum|passport|permit|parole|pardon|will|estate|inheritance|probate|tenancy|testimony|conviction|loan|mortgage|overdraft|credit limit|credit|debt|line of credit|repayment plan|licen[cs]e|clearance|certification';
/** What is not a thing of the person’s but a decision about them: “her promotion”, “Maria’s dismissal”. */
const DECISIONS =
  'promotion|dismissal|termination|demotion|raise|redundancy|sacking|suspension|sentence|parole|bail|extradition|deportation|eviction|conviction|pardon|discharge|diagnosis|prognosis';
/** The verbs that do something to a matter of a person’s. */
const MATTER_VERBS =
  'approv(?:e|es|ed|ing)|den(?:y|ies|ied|ying)|declin(?:e|es|ed|ing)|reject(?:s|ed|ing)?|refus(?:e|es|ed|ing)|grant(?:s|ed|ing)?|cut(?:s|ting)?|reduc(?:e|es|ed|ing)|increas(?:e|es|ed|ing)|rais(?:e|es|ed|ing)|extend(?:s|ed|ing)?|renew(?:s|ed|ing)?|cancel(?:s|led|ling)?|revok(?:e|es|ed|ing)|suspend(?:s|ed|ing)?|freez(?:e|es|ing)|sponsor(?:s|ed|ing)?|withdraw(?:s|ing)?|withdrew|withhold(?:s|ing)?|review(?:s|ed|ing)?|process(?:es|ed|ing)?|expedit(?:e|es|ed|ing)|delay(?:s|ed|ing)?|accept(?:s|ed|ing)?|waiv(?:e|es|ed|ing)|forgiv(?:e|es|ing)|write(?:s)? off|restructur(?:e|es|ed|ing)|chang(?:e|es|ed|ing)|adjust(?:s|ed|ing)?|end(?:s|ed|ing)?|terminat(?:e|es|ed|ing)|stop(?:s|ped|ping)?|reinstat(?:e|es|ed|ing)|restor(?:e|es|ed|ing)|lower(?:s|ed|ing)?|doubl(?:e|es|ed|ing)|halv(?:e|es|ed|ing)|limit(?:s|ed|ing)?|restrict(?:s|ed|ing)?|block(?:s|ed|ing)?|contest(?:s|ed|ing)?|backdat(?:e|es|ed|ing)|pay|pays|paying|paid|honou?r(?:s|ed|ing)?|issu(?:e|es|ed|ing)|fil(?:e|es|ed|ing)|support(?:s|ed|ing)?|fund(?:s|ed|ing)?';
/** The verbs that give a person a matter, or take it from them. */
const GIVE_VERBS =
  'giv(?:e|es|ing)|gave|offer(?:s|ed|ing)?|grant(?:s|ed|ing)?|award(?:s|ed|ing)?|lend(?:s|ing)?|lent|extend(?:s|ed|ing)?|den(?:y|ies|ied|ying)|refus(?:e|es|ed|ing)|owe(?:s|d)?|promis(?:e|es|ed|ing)|allow(?:s|ed|ing)?|pay(?:s|ing)?|paid|approv(?:e|es|ed|ing)|decline(?:s|d)?|declining|reject(?:s|ed|ing)?|sponsor(?:s|ed|ing)?';
/** What is denied a person: a service, an entry, a cover. */
const ACCESS = 'service|access|entry|admission|membership|coverage|cover|benefits?';

const compile = (source: string): RegExp => new RegExp(source, 'giud');

interface Spec {
  /** The construction, with the person written `PNP` or `POSSESSOR`, and the named groups `verb` and `matter`. */
  source: string;
  domain: HighStakesDomain | ((match: RegExpMatchArray) => HighStakesDomain | null);
  options?: ResolveOptions;
  /** What else has to hold for the construction to be what it looks like. */
  ok?: (match: RegExpMatchArray, clause: string, resolved: Resolved) => boolean;
}

const CUES: PersonCue[] = [];
const FINDERS: PersonFinder[] = [];

function add(spec: Spec): void {
  const domainOf = (match: RegExpMatchArray): HighStakesDomain | null =>
    typeof spec.domain === 'string' ? spec.domain : spec.domain(match);
  const accepted = (match: RegExpMatchArray, clause: string): Resolved | null => {
    const resolved = resolve(match, clause, spec.options);
    if (!resolved || domainOf(match) === null) return null;
    return spec.ok && !spec.ok(match, clause, resolved) ? null : resolved;
  };
  CUES.push({
    re: compile(spec.source),
    accept: (match, clause) => accepted(match, clause) !== null,
    domain: (_clause, match) => domainOf(match) ?? 'employment',
    label: (match) =>
      (match.groups?.matter ?? match.groups?.verb ?? safeQuote(match[0])).toLowerCase(),
  });
  FINDERS.push({
    re: compile(spec.source),
    label: (match) => accepted(match, match.input ?? '')?.label ?? NAMED,
    nounOf: (match) => accepted(match, match.input ?? '')?.noun,
    accept: (match, clause) => accepted(match, clause) !== null,
  });
}

const verb = (source: string): string => String.raw`\b(?<verb>${source})`;
const matterDomain = (match: RegExpMatchArray): HighStakesDomain | null =>
  domainOfMatter(match.groups?.matter);

/** A person said after a verb that the rest of the rules already make an act: only the person is read here. */
function addFinder(source: string, options?: ResolveOptions): void {
  FINDERS.push({
    re: compile(source),
    label: (match) => resolve(match, match.input ?? '', options)?.label ?? NAMED,
    nounOf: (match) => resolve(match, match.input ?? '', options)?.noun,
    accept: (match, clause) => resolve(match, clause, options) !== null,
  });
}

/** The people an employer decides about, as role nouns: for verbs that are also said of customers and users. */
const EMPLOYEES: ReadonlySet<string> = new Set([
  'employee',
  'worker',
  'staff member',
  'team member',
  'team lead',
  'tech lead',
  'line manager',
  'colleague',
  'manager',
  'supervisor',
  'intern',
  'apprentice',
  'contractor',
  'assistant',
  'recruit',
  'hire',
  'engineer',
  'developer',
  'analyst',
  'accountant',
  'auditor',
  'clerk',
  'cashier',
  'secretary',
  'receptionist',
  'consultant',
  'specialist',
  'officer',
  'technician',
  'mechanic',
  'cleaner',
  'teacher',
  'nurse',
  'driver',
  'operator',
  'director',
  'executive',
  'ceo',
  'cfo',
  'cto',
  'coo',
  'salesperson',
  'salesman',
  'saleswoman',
  'sales rep',
  'chef',
  'cook',
  'waiter',
  'waitress',
  'bartender',
  'barista',
  'courier',
  'porter',
  'janitor',
  'caretaker',
  'labourer',
  'laborer',
  'foreman',
  'welder',
  'electrician',
  'plumber',
  'carpenter',
  'lecturer',
  'professor',
  'tutor',
  'journalist',
  'programmer',
  'guard',
  'carer',
  'caregiver',
  'receptionist',
  'banker',
  'shopkeeper',
  'storekeeper',
]);

// ---------------------------------------------------------------------------------------------
// Employment
// ---------------------------------------------------------------------------------------------

// “promote Priya”, “promote the second candidate”: a person; “promote Notion to our teams” is not.
add({
  source: `${verb('promot(?:e|es|ed|ing)')}\\s+${PNP}`,
  domain: 'employment',
  ok: (_match, clause, who) =>
    who.label !== NAMED ||
    !/^\s+to\b/iu.test(clause.slice(who.end)) ||
    POST.test(clause.slice(who.end)),
});
add({
  source: `${verb('appoint(?:s|ed|ing)?|reprimand(?:s|ed|ing)?')}\\s+${PNP}`,
  domain: 'employment',
});
add({
  source: String.raw`${verb('keep|keeps|keeping|kept|retain(?:s|ed|ing)?')}\s+${PNP}\s+on\b`,
  domain: 'employment',
  options: { herOk: true },
});
add({
  source: String.raw`${verb('put|puts|putting|place|places|placing|keep|keeps|keeping|kept')}\s+${PNP}\s+on\s+(?:a\s+|an\s+|the\s+)?(?:probation|notice|leave|garden leave|(?:final |formal |written |verbal )?warning|suspension|performance plan|pip)\b`,
  domain: 'employment',
  options: { herOk: true },
});
add({
  source: String.raw`${verb('report(?:s|ed|ing)?')}\s+${PNP}\s+to\s+(?:the\s+|our\s+|his\s+|her\s+|their\s+|my\s+)?(?<matter>hr|human resources|management|boss|board|union|compliance)\b`,
  domain: 'employment',
  options: { herOk: true },
});

// ---------------------------------------------------------------------------------------------
// Law
// ---------------------------------------------------------------------------------------------

add({
  source: String.raw`${verb('report(?:s|ed|ing)?')}\s+${PNP}\s+to\s+(?:the\s+|our\s+)?(?<matter>police|authorities|regulators?|prosecutors?|ombudsman|immigration|courts?|legal)\b`,
  domain: 'legal',
  options: { herOk: true },
});
add({ source: `${verb('settl(?:e|es|ed|ing)')}\\s+with\\s+${PNP}`, domain: 'legal' });
add({
  source: String.raw`${verb('press(?:es|ed|ing)?|fil(?:e|es|ed|ing)|bring(?:s|ing)?|brought|lodg(?:e|es|ed|ing)|mak(?:e|es|ing)|tak(?:e|es|ing)')}\s+(?:(?:a|an|the|any)\s+)?(?:\p{L}+\s+)?(?<matter>charges?|complaints?|grievances?|lawsuits?|claims?|cases?|appeals?|reports?|legal action)\s+against\s+${PNP}`,
  domain: (match) => (/^grievance/iu.test(match.groups?.matter ?? '') ? 'employment' : 'legal'),
  options: { herOk: true },
});
add({
  source: `${verb('extradit(?:e|es|ed|ing)|detain(?:s|ed|ing)?|imprison(?:s|ed|ing)?|jail(?:s|ed|ing)?|pardon(?:s|ed|ing)?|acquit(?:s|ted|ting)?|indict(?:s|ed|ing)?|subpoena(?:s|ed|ing)?')}\\s+${PNP}`,
  domain: 'legal',
});

// ---------------------------------------------------------------------------------------------
// Medicine
// ---------------------------------------------------------------------------------------------

const PATIENTS: ReadonlySet<string> = new Set(['patient', 'resident']);
const STAFF_NOUNS: ReadonlySet<string> = new Set([
  'employee',
  'worker',
  'staff member',
  'team member',
  'colleague',
  'manager',
  'supervisor',
  'intern',
  'apprentice',
  'contractor',
  'assistant',
]);
add({
  source: `${verb('discharg(?:e|es|ed|ing)')}\\s+${PNP}`,
  domain: (match) =>
    match.groups?.noun && STAFF_NOUNS.has(match.groups.noun.toLowerCase())
      ? 'employment'
      : 'medical',
});
add({
  source: String.raw`${verb('admit(?:s|ted|ting)?')}\s+${PNP}\s+to\s+(?:the\s+|a\s+|an\s+)?(?:hospital|ward|icu|intensive care|clinic|care home|nursing home|hospice|rehab|emergency)\b`,
  domain: 'medical',
  options: { herOk: true },
});
add({
  source: `${verb('operat(?:e|es|ed|ing)\\s+on|sedat(?:e|es|ed|ing)|restrain(?:s|ed|ing)?|resuscitat(?:e|es|ed|ing)|intubat(?:e|es|ed|ing)|vaccinat(?:e|es|ed|ing)|quarantin(?:e|es|ed|ing)|hospitali[sz](?:e|es|ed|ing)|amputat(?:e|es|ed|ing)')}\\s+${PNP}`,
  domain: 'medical',
});
add({
  source: String.raw`${verb('put|puts|putting|place|places|placing|start|starts|starting|keep|keeps|keeping|kept|take|takes|taking|took|wean|weaning|move|moves|moving')}\s+${PNP}\s+(?:on|off)\s+(?:a\s+|an\s+|the\s+)?(?:ventilators?|dialysis|oxygen|life support|medications?|medicines?|insulin|antibiotics?|antidepressants?|painkillers?|opioids?|steroids?|statins?|sedatives?|chemotherapy|radiotherapy|treatments?|therapy)\b`,
  domain: 'medical',
  options: { herOk: true },
});
// “let the patient go home”, “send the resident home”: only a patient, since a worker sent home is not a medical matter.
add({
  source: String.raw`${verb('let|lets|letting|send|sends|sending|sent|keep|keeps|keeping|kept|release|releases|releasing|released')}\s+${PNP}\s+(?:go\s+|stay\s+)?(?:home|overnight|in\s+(?:the\s+)?hospital|out of\s+(?:the\s+)?hospital)\b`,
  domain: 'medical',
  options: { herOk: true, nouns: PATIENTS },
});

// ---------------------------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------------------------

// “let Maria operate the forklift”, “clear him to fly”: a person trusted with something that can hurt.
add({
  source: String.raw`${verb('let|lets|letting|allow|allows|allowed|allowing|permit|permits|permitted|permitting|clear|clears|cleared|clearing|certify|certifies|certified|authori[sz]e[sd]?|trust|trusts|trusted')}\s+${PNP}\s+(?:to\s+)?(?<matter>operate|drive|fly|pilot|lift|climb|board|return to (?:work|duty|the line|flying|driving)|work (?:alone|unsupervised|at height)|go back to work|resume (?:work|duty|driving|flying|operating)|use (?:the\s+)?(?:forklift|crane|machine|machinery|equipment|tools)|handle (?:chemicals|explosives|firearms|machinery|hazardous \p{L}+)|enter (?:the\s+)?(?:confined space|restricted area|site|zone|plant))\b`,
  domain: 'safety',
  options: { herOk: true },
});
add({ source: `${verb('ground(?:s|ed|ing)?')}\\s+${PNP}`, domain: 'safety' });

// ---------------------------------------------------------------------------------------------
// What is done to a matter of a person’s
// ---------------------------------------------------------------------------------------------

// “cut the nurse’s hours”, “deny his insurance claim”, “sponsor this candidate’s visa”.
add({
  source: String.raw`${verb(MATTER_VERBS)}\s+${POSSESSOR}\s+(?:(?:\p{L}[\p{L}'-]*)\s+){0,2}?(?<matter>${MATTERS})\b`,
  domain: matterDomain,
  options: { possessive: true },
});
// “her promotion”, “Maria’s dismissal”: the matter is the decision.
add({
  source: String.raw`\b${POSSESSOR}\s+(?<matter>${DECISIONS})\b`,
  domain: (match) => domainOfMatter(match.groups?.matter) ?? decisionDomain(match.groups?.matter),
  options: { possessive: true },
});
// “give her a raise”, “offer him a loan”, “grant the second applicant an interview”.
add({
  source: String.raw`${verb(GIVE_VERBS)}\s+${PNP}\s+(?:(?:a|an|the|some|any|another|extra|more|less|his|her|their|my|\d+)\s+)?(?:(?:\p{L}[\p{L}'-]*)\s+)?(?<matter>${MATTERS})\b`,
  domain: matterDomain,
  options: { herOk: true },
});
// “offer the job to the second candidate”, “grant a loan to the borrower”, “cut hours for the nurse”.
add({
  source: String.raw`${verb(MATTER_VERBS + '|' + GIVE_VERBS)}\s+(?:(?:a|an|the|his|her|their|my|this|that|some|any)\s+)?(?:(?:\p{L}[\p{L}'-]*)\s+){0,2}?(?<matter>${MATTERS})\s+(?:to|for|from|against|of|on)\s+${PNP}`,
  domain: matterDomain,
  options: { herOk: true },
});
// “refuse service to this customer”.
add({
  source: String.raw`${verb('refus(?:e|es|ed|ing)|den(?:y|ies|ied|ying)|withhold(?:s|ing)?|withdraw(?:s|ing)?|revok(?:e|es|ed|ing)|bar(?:s|red|ring)?|ban(?:s|ned|ning)?')}\s+(?:(?:the|any|all|further)\s+)?(?<matter>${ACCESS})\s+(?:to|for|from)\s+${PNP}`,
  domain: 'legal',
  options: { herOk: true },
});

// ---------------------------------------------------------------------------------------------
// The same people after the verbs the rest of the rules already read as acts
// ---------------------------------------------------------------------------------------------

// “hire the first candidate”, “fire the former intern”, “reject the other applicant”.
addFinder(String.raw`${verb(STRONG_VERBS + '|' + NAMING_VERBS)}\s+${ROLE_NP}`);
addFinder(String.raw`${verb(DECIDING_VERBS)}\s+${ROLE_NP}`, {
  nouns: new Set(DECIDED_ROLES.split('|')),
});
// “is the pilot fit to fly”, “is the former intern eligible”.
addFinder(String.raw`${ROLE_NP}\s+(?:(?:is|was|be|been|being)\s+)?(?:${STATES})\b`);
// “should the employee be fired”: the person the act is done to, said first.
addFinder(String.raw`${ROLE_NP}\s+(?:is|was|be|been|being|gets?|got)\s+(?:${ALL_VERBS})\b`);
// “prescribe antibiotics to the child”, “grant bail to the suspect”, “a replacement for the manager”.
addFinder(String.raw`\b(?:to|for|against|about|regarding)\s+${ROLE_NP}`);
// “whom should we lay off”.
addFinder(
  String.raw`\bwhom\s+(?:should|shall|must|can|could|would|do|did|will)\s+(?:we|i)\s+(?:${NAMING_VERBS}|lay off|let go|select|choose|pick|accept|reject|admit|treat|promote|hire)\b`,
);
// “does Mr Khan qualify for the mortgage”, “does she deserve a raise”.
addFinder(String.raw`${PNP}\s+(?:qualif(?:y|ies|ied)|deserv(?:e|es|ed)|merit(?:s|ed)?)\b`, {
  herOk: true,
});
addFinder(String.raw`\b(?:he|she)\s+(?:qualif(?:y|ies|ied)|deserv(?:e|es|ed)|merit(?:s|ed)?)\b`);
// Two given names said together are two people: “between Anita and Mohan”.
FINDERS.push({
  re: compile(
    String.raw`(?<![\p{L}'-])(?<a>\p{Lu}\p{L}+)\s+(?:and|or)\s+(?<b>\p{Lu}\p{L}+)(?![\p{L}'-])`,
  ),
  label: () => NAMED,
  nounOf: () => undefined,
  accept: (match) =>
    GIVEN_NAMES.has((match.groups?.a ?? '').toLowerCase()) &&
    GIVEN_NAMES.has((match.groups?.b ?? '').toLowerCase()),
});

// “let the junior analyst go”, “make him redundant”, “part ways with our sales rep”, “replace the foreman”.
add({
  source: String.raw`${verb('let|lets|letting')}\s+${PNP}\s+${GO_ENDING}`,
  domain: (match) =>
    match.groups?.noun && PATIENTS.has(match.groups.noun.toLowerCase()) ? 'medical' : 'employment',
  options: { herOk: true },
});
add({
  source: String.raw`${verb('make|makes|making|made')}\s+${PNP}\s+redundant\b`,
  domain: 'employment',
  options: { herOk: true },
});
add({
  source: String.raw`${verb('part|parts|parted|parting')}\s+ways\s+with\s+${PNP}`,
  domain: 'employment',
});
add({
  source: `${verb('replac(?:e|es|ed|ing)')}\\s+${PNP}`,
  domain: 'employment',
  options: { nouns: EMPLOYEES },
});
// “what should we do about our employee who keeps stealing”.
add({
  source: String.raw`${verb('deal with|dealing with|handle|handling|do about|do with|manage|address|discipline')}\s+${ROLE_NP}\s+(?:who|that|whose|for\s+\p{L}+ing)\b`,
  domain: 'employment',
  options: { nouns: EMPLOYEES },
});

// “repossess the borrower’s car”, “foreclose on the Hernandez family”.
add({
  source: `${verb('repossess(?:es|ed|ing)?|foreclos(?:e|es|ed|ing) on|garnish(?:es|ed|ing)?')}\\s+${PNP}`,
  domain: 'credit',
});
add({
  source: String.raw`${verb('repossess(?:es|ed|ing)?|garnish(?:es|ed|ing)?|seiz(?:e|es|ed|ing)')}\s+${POSSESSOR}\s+(?:\p{L}+\s+)?(?<matter>car|vehicle|house|home|property|equipment|wages|salary|assets|belongings)\b`,
  domain: 'credit',
  options: { possessive: true },
});
// “lend Sofia the money for the deposit”.
add({
  source: String.raw`${verb('lend|lends|lending|lent|advanc(?:e|es|ed|ing)|loan|loans|loaned|loaning')}\s+${PNP}\s+(?:(?:the|some|any|a|an|his|her|their|my|\d+)\s+)?(?:(?:\p{L}[\p{L}'-]*)\s+)?(?<matter>money|cash|funds|deposit|sum|amount)\b`,
  domain: 'credit',
  options: { herOk: true },
});

// “refer her to a specialist”, “transfer the patient to intensive care”.
add({
  source: String.raw`${verb('transfer|transfers|transferred|transferring|move|moves|moved|moving')}\s+${PNP}\s+to\s+(?:the\s+|a\s+|an\s+)?(?<matter>icu|intensive care|hospital|ward|hospice|care home|nursing home|a&e|theatre|surgery)\b`,
  domain: 'medical',
  options: { herOk: true, nouns: PATIENTS },
});
add({
  source: String.raw`${verb('refer|refers|referred|referring')}\s+${PNP}\s+(?:on\s+)?to\s+(?:a\s+|an\s+|the\s+)?(?:\p{L}+\s+)?(?<matter>specialists?|hospital|clinic|surgeon|consultant|oncologist|cardiologist|psychiatrist|psychologist|therapist|counsell?or|physio(?:therapist)?|dermatologist|neurologist|ward|a&e|icu)\b`,
  domain: 'medical',
  options: { herOk: true },
});
// “send the injured worker back to the line”.
add({
  source: String.raw`${verb('send|sends|sending|sent|put|puts|putting|get|gets|getting')}\s+${PNP}\s+back\s+(?:to|on|into)\s+(?:work|duty|the line|the floor|the road|the field|active duty)\b`,
  domain: 'safety',
  options: { herOk: true },
});
// “testify against our former manager”.
add({
  source: `${verb('testif(?:y|ies|ied|ying)')}\\s+against\\s+${PNP}`,
  domain: 'legal',
  options: { herOk: true },
});

function decisionDomain(matter: string | undefined): HighStakesDomain | null {
  const word = (matter ?? '').toLowerCase();
  if (
    /^(?:promotion|dismissal|termination|demotion|raise|redundancy|sacking|suspension)$/u.test(word)
  ) {
    return 'employment';
  }
  if (/^(?:sentence|parole|bail|extradition|deportation|eviction|conviction|pardon)$/u.test(word)) {
    return 'legal';
  }
  if (/^(?:discharge|diagnosis|prognosis)$/u.test(word)) return 'medical';
  return null;
}

export const PERSON_CUES: readonly PersonCue[] = CUES;
export const PERSON_FINDERS: readonly PersonFinder[] = FINDERS;
