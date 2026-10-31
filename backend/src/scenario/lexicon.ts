/**
 * The small, generic vocabulary the rules reading uses: verbs that say something is being changed,
 * words for the people and groups a question names, and words for time. Nothing here belongs to an
 * industry or a product, and none of it is a list of answers: it only tells the reader where in a
 * sentence to look. A test keeps subject-matter words out of this folder.
 */

interface VerbEntry {
  stem: string;
  /** How the change reads once done, as in "to: raised". */
  result: string;
  /** Surface forms that the regular rules would get wrong. */
  forms?: readonly string[];
  /** A word that completes a phrasal verb, as the "out" in "roll out". */
  particle?: string;
}

const VERBS: readonly VerbEntry[] = [
  { stem: 'increase', result: 'increased' },
  { stem: 'raise', result: 'raised' },
  { stem: 'hike', result: 'raised' },
  { stem: 'boost', result: 'increased' },
  { stem: 'grow', result: 'increased', forms: ['grew', 'grown'] },
  { stem: 'rise', result: 'increased', forms: ['rose', 'risen'] },
  { stem: 'expand', result: 'expanded' },
  { stem: 'extend', result: 'extended' },
  { stem: 'double', result: 'doubled' },
  { stem: 'triple', result: 'tripled' },
  { stem: 'halve', result: 'halved' },
  { stem: 'accelerate', result: 'accelerated' },
  { stem: 'reduce', result: 'reduced' },
  { stem: 'decrease', result: 'decreased' },
  { stem: 'cut', result: 'cut', forms: ['cutting'] },
  { stem: 'lower', result: 'lowered' },
  { stem: 'drop', result: 'dropped' },
  { stem: 'fall', result: 'decreased', forms: ['fell', 'fallen'] },
  { stem: 'shrink', result: 'decreased', forms: ['shrank', 'shrunk'] },
  { stem: 'slash', result: 'cut' },
  { stem: 'shorten', result: 'shortened' },
  { stem: 'tighten', result: 'tightened' },
  { stem: 'loosen', result: 'loosened' },
  { stem: 'relax', result: 'relaxed' },
  { stem: 'simplify', result: 'simplified' },
  { stem: 'cap', result: 'capped' },
  { stem: 'limit', result: 'limited' },
  { stem: 'freeze', result: 'frozen', forms: ['froze'] },
  { stem: 'delay', result: 'delayed' },
  { stem: 'postpone', result: 'postponed' },
  { stem: 'add', result: 'added' },
  { stem: 'introduce', result: 'introduced' },
  { stem: 'launch', result: 'launched' },
  { stem: 'release', result: 'released' },
  { stem: 'announce', result: 'announced' },
  { stem: 'offer', result: 'offered' },
  { stem: 'provide', result: 'provided' },
  { stem: 'pilot', result: 'piloted' },
  { stem: 'open', result: 'opened' },
  { stem: 'adopt', result: 'adopted' },
  { stem: 'impose', result: 'imposed' },
  { stem: 'remove', result: 'removed' },
  { stem: 'retire', result: 'retired' },
  { stem: 'discontinue', result: 'discontinued' },
  { stem: 'end', result: 'ended' },
  { stem: 'stop', result: 'stopped' },
  { stem: 'close', result: 'closed' },
  { stem: 'cancel', result: 'cancelled', forms: ['canceled', 'cancelling', 'canceling'] },
  { stem: 'withdraw', result: 'withdrawn', forms: ['withdrew'] },
  { stem: 'integrate', result: 'integrated' },
  { stem: 'embed', result: 'embedded' },
  { stem: 'merge', result: 'merged' },
  { stem: 'combine', result: 'combined' },
  { stem: 'consolidate', result: 'consolidated' },
  { stem: 'bundle', result: 'bundled' },
  { stem: 'unbundle', result: 'unbundled' },
  { stem: 'split', result: 'split', forms: ['splitting'] },
  { stem: 'enable', result: 'enabled' },
  { stem: 'disable', result: 'disabled' },
  { stem: 'activate', result: 'activated' },
  { stem: 'deactivate', result: 'deactivated' },
  { stem: 'allow', result: 'allowed' },
  { stem: 'permit', result: 'permitted' },
  { stem: 'require', result: 'required' },
  { stem: 'mandate', result: 'mandated' },
  { stem: 'restrict', result: 'restricted' },
  { stem: 'prohibit', result: 'prohibited' },
  { stem: 'ban', result: 'banned' },
  { stem: 'approve', result: 'approved' },
  { stem: 'reject', result: 'rejected' },
  { stem: 'default', result: 'made the default' },
  { stem: 'replace', result: 'replaced' },
  { stem: 'switch', result: 'switched' },
  { stem: 'migrate', result: 'migrated' },
  { stem: 'move', result: 'moved' },
  { stem: 'relocate', result: 'relocated' },
  { stem: 'change', result: 'changed' },
  { stem: 'modify', result: 'modified' },
  { stem: 'update', result: 'updated' },
  { stem: 'upgrade', result: 'upgraded' },
  { stem: 'downgrade', result: 'downgraded' },
  { stem: 'redesign', result: 'redesigned' },
  { stem: 'restructure', result: 'restructured' },
  { stem: 'reorganise', result: 'reorganised' },
  { stem: 'reorganize', result: 'reorganised' },
  { stem: 'standardise', result: 'standardised' },
  { stem: 'standardize', result: 'standardised' },
  { stem: 'centralise', result: 'centralised' },
  { stem: 'centralize', result: 'centralised' },
  { stem: 'automate', result: 'automated' },
  { stem: 'outsource', result: 'outsourced' },
  { stem: 'hire', result: 'hired' },
  { stem: 'appoint', result: 'appointed' },
  { stem: 'acquire', result: 'acquired' },
  { stem: 'divest', result: 'divested' },
  { stem: 'fail', result: 'failed' },
  { stem: 'crash', result: 'crashed' },
  { stem: 'roll', result: 'rolled out', particle: 'out' },
  { stem: 'phase', result: 'phased out', particle: 'out' },
  { stem: 'lay', result: 'laid off', particle: 'off', forms: ['laid'] },
  { stem: 'shut', result: 'shut down', particle: 'down', forms: ['shutting'] },
  { stem: 'go', result: 'down', particle: 'down', forms: ['goes', 'went', 'gone'] },
  { stem: 'go', result: 'offline', particle: 'offline', forms: ['goes', 'went', 'gone'] },
];

/** Stems whose last consonant is doubled before -ed and -ing. */
const DOUBLING = new Set(['cap', 'drop', 'ban', 'stop', 'permit', 'embed']);

/** Verbs that change a quantity by some amount, so that "how much?" is a fair question. */
const SCALAR = new Set([
  'increase',
  'raise',
  'hike',
  'boost',
  'grow',
  'rise',
  'expand',
  'extend',
  'accelerate',
  'reduce',
  'decrease',
  'cut',
  'lower',
  'drop',
  'fall',
  'shrink',
  'slash',
  'shorten',
  'tighten',
  'loosen',
  'relax',
  'cap',
  'limit',
  'delay',
  'postpone',
]);

function inflections(stem: string): string[] {
  const forms = [stem];
  const consonantY = /[^aeiou]y$/u.test(stem);
  if (/(?:s|x|z|ch|sh)$/u.test(stem)) forms.push(`${stem}es`);
  else if (consonantY) forms.push(`${stem.slice(0, -1)}ies`);
  else forms.push(`${stem}s`);
  if (stem.endsWith('e')) forms.push(`${stem}d`, `${stem.slice(0, -1)}ing`);
  else if (consonantY) forms.push(`${stem.slice(0, -1)}ied`, `${stem}ing`);
  else if (DOUBLING.has(stem)) {
    forms.push(`${stem}${stem.slice(-1)}ed`, `${stem}${stem.slice(-1)}ing`);
  } else forms.push(`${stem}ed`, `${stem}ing`);
  return forms;
}

export interface VerbMatch {
  result: string;
  /** How many words the verb takes: 2 for a phrasal verb. */
  words: 1 | 2;
  /** Whether it changes an amount, so that the size of the change matters. */
  scalar: boolean;
}

const SINGLE = new Map<string, VerbMatch>();
const PHRASAL = new Map<string, VerbMatch>();
for (const entry of VERBS) {
  const target = entry.particle ? PHRASAL : SINGLE;
  const match: VerbMatch = {
    result: entry.result,
    words: entry.particle ? 2 : 1,
    scalar: SCALAR.has(entry.stem),
  };
  for (const form of [...inflections(entry.stem), ...(entry.forms ?? [])]) {
    const key = entry.particle ? `${form} ${entry.particle}` : form;
    if (!target.has(key)) target.set(key, match);
  }
}

/** The change verb that starts at `index` in `words` (lower case), if there is one. */
export function verbAt(words: readonly string[], index: number): VerbMatch | null {
  const word = words[index];
  if (word === undefined) return null;
  const next = words[index + 1];
  if (next !== undefined) {
    const phrasal = PHRASAL.get(`${word} ${next}`);
    if (phrasal) return phrasal;
  }
  return SINGLE.get(word) ?? null;
}

/** Verbs whose "to" names what something becomes, as in "move to annual terms". */
export const MOVEMENT_RESULTS: ReadonlySet<string> = new Set([
  'moved',
  'switched',
  'migrated',
  'relocated',
  'changed',
]);

/** Verbs after which "into X" names the thing that receives the change, as in "integrate it into X". */
export const TARGET_RESULTS: ReadonlySet<string> = new Set([
  'integrated',
  'embedded',
  'added',
  'introduced',
  'launched',
  'rolled out',
  'released',
  'offered',
  'provided',
]);

/** Verbs whose "to" introduces what is required, allowed or forbidden, as in "require X to publish Y". */
export const REQUIREMENT_RESULTS: ReadonlySet<string> = new Set([
  'required',
  'mandated',
  'allowed',
  'permitted',
  'prohibited',
]);

/** Comparatives that say which way something differs, as in "a higher rate". The size is left open. */
export const COMPARATIVES: ReadonlyMap<string, VerbMatch> = new Map(
  [
    'higher',
    'larger',
    'bigger',
    'smaller',
    'longer',
    'shorter',
    'faster',
    'slower',
    'cheaper',
    'stricter',
    'looser',
  ].map((word) => [word, { result: word, words: 1, scalar: true }] as const),
);

/** Words that open a prepositional phrase or a new clause, which end the name of what is changed. */
export const BOUNDARY_WORDS: ReadonlySet<string> = new Set([
  'by',
  'from',
  'to',
  'in',
  'across',
  'within',
  'over',
  'for',
  'at',
  'per',
  'until',
  'with',
  'without',
  'than',
  'as',
  'via',
  'through',
  'among',
  'between',
  'after',
  'before',
  'during',
  'while',
  'because',
  'so',
  'that',
  'which',
  'who',
  'if',
  'when',
  'instead',
  'rather',
  'whereas',
  'but',
  'then',
]);

/** Articles, possessives and demonstratives that do not belong in the name of a variable. */
export const DETERMINERS: ReadonlySet<string> = new Set([
  'the',
  'a',
  'an',
  'its',
  'their',
  'our',
  'your',
  'my',
  'his',
  'her',
  'this',
  'that',
  'these',
  'those',
]);

/** Auxiliary words that carry no meaning of their own in the name of a variable. */
export const AUXILIARIES: ReadonlySet<string> = new Set([
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'will',
  'would',
  'could',
  'should',
  'might',
  'may',
  'can',
  'gets',
  'get',
  'got',
  'also',
  'both',
]);

export const PRONOUNS: ReadonlySet<string> = new Set([
  'we',
  'i',
  'you',
  'they',
  'it',
  'he',
  'she',
  'us',
  'someone',
  'somebody',
  'everyone',
  'nobody',
]);

/** Words that stop a number from taking the next word as its unit. */
export const NOT_UNITS: ReadonlySet<string> = new Set([
  ...BOUNDARY_WORDS,
  ...DETERMINERS,
  ...AUXILIARIES,
  ...PRONOUNS,
  'and',
  'or',
  'of',
  'on',
  'into',
  'onto',
  'up',
  'down',
  'off',
  'out',
  'next',
  'last',
  'more',
  'less',
  'each',
  'every',
  'all',
  'any',
  'some',
  'higher',
  'lower',
  'bigger',
  'smaller',
  'longer',
  'shorter',
  'times',
]);

export const TIME_UNITS = 'hours?|days?|weeks?|months?|quarters?|years?|decades?';

/** Words for a whole number, used in time spans such as "within two years". */
export const NUMBER_WORDS =
  'a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|eighteen|twenty|thirty|couple of|few|several|\\d+(?:\\.\\d+)?';

/** Words that name a kind of place; they make "in a selected region" a place and not a thing. */
export const PLACE_NOUNS =
  'regions?|countr(?:y|ies)|nations?|cit(?:y|ies)|provinces?|territor(?:y|ies)|count(?:y|ies)|districts?|continents?|islands?';

/** Large named areas that read as a place wherever they appear after "in". Matched with case. */
export const MACRO_REGIONS =
  'Europe|Asia|Africa|Oceania|North America|South America|Latin America|Middle East|EU|UK|US|USA|EMEA|APAC|LATAM';

/** Roles that exist in any setting. Each stands for a group of people or organisations. */
const ROLES: readonly (readonly [singular: string, plural: string])[] = [
  ['customer', 'customers'],
  ['client', 'clients'],
  ['user', 'users'],
  ['consumer', 'consumers'],
  ['administrator', 'administrators'],
  ['admin', 'admins'],
  ['engineer', 'engineers'],
  ['manager', 'managers'],
  ['executive', 'executives'],
  ['employee', 'employees'],
  ['employer', 'employers'],
  ['worker', 'workers'],
  ['contractor', 'contractors'],
  ['partner', 'partners'],
  ['reseller', 'resellers'],
  ['supplier', 'suppliers'],
  ['vendor', 'vendors'],
  ['competitor', 'competitors'],
  ['rival', 'rivals'],
  ['regulator', 'regulators'],
  ['auditor', 'auditors'],
  ['investor', 'investors'],
  ['shareholder', 'shareholders'],
  ['analyst', 'analysts'],
  ['citizen', 'citizens'],
  ['resident', 'residents'],
  ['member', 'members'],
  ['owner', 'owners'],
  ['operator', 'operators'],
  ['household', 'households'],
  ['staff', 'staff'],
];

const ROLE_BY_WORD = new Map<string, string>();
for (const [singular, plural] of ROLES) {
  ROLE_BY_WORD.set(singular, plural);
  ROLE_BY_WORD.set(plural, plural);
}

/** The group a word names, as it is listed (the plural), or null. */
export function roleOf(word: string): string | null {
  return ROLE_BY_WORD.get(word.toLowerCase()) ?? null;
}

/** Adjectives that narrow a group without naming an industry, as in "existing" or "small". */
export const ROLE_MODIFIERS: ReadonlySet<string> = new Set([
  'existing',
  'new',
  'potential',
  'current',
  'former',
  'prospective',
  'small',
  'large',
  'key',
  'major',
  'individual',
  'internal',
  'external',
  'local',
  'senior',
  'junior',
  'frontline',
  'front-line',
  'power',
  'paying',
  'paid',
  'free',
  'enterprise',
  'regular',
  'occasional',
  'loyal',
  'casual',
  'lapsed',
  'returning',
  'first-time',
  'corporate',
  'third-party',
  'end',
]);

/** Function words that are common in English and rare in other languages. */
export const ENGLISH_WORDS: ReadonlySet<string> = new Set([
  'the',
  'a',
  'an',
  'of',
  'to',
  'in',
  'on',
  'at',
  'by',
  'for',
  'with',
  'from',
  'if',
  'and',
  'or',
  'is',
  'are',
  'was',
  'were',
  'be',
  'will',
  'would',
  'could',
  'might',
  'what',
  'how',
  'we',
  'our',
  'it',
  'its',
  'that',
  'this',
  'as',
  'can',
  'do',
  'does',
  'happen',
  'change',
  'changes',
]);
