import type { StakeholderCategory } from '../../../shared/stakeholders.js';

/**
 * A small, generic vocabulary of nouns that name a role or a group, used only by the rules path of
 * stakeholder discovery. It is a lens for reading text, never a list of answers: it names no
 * industry, product or organisation, and a group it does not know is simply not found by the rules
 * path (a model, the scenario's own words and the person fill those gaps).
 */

export interface Head {
  /** The category the noun points to when nothing else in the phrase says otherwise. */
  category: StakeholderCategory;
  /** A noun that names a group only with a describing word before it: "support team", not "team". */
  weak: boolean;
  /**
   * A noun that names a group only when a describing word before it points to this category: a
   * "review panel" is a group of reviewers, but a "new panel" is something on a screen.
   */
  needs?: StakeholderCategory;
}

const nouns = (category: StakeholderCategory, words: string, weak: boolean): [string, Head][] =>
  words.split(' ').map((word) => [word, { category, weak }]);

/** Singular forms. Plurals and possessives are folded onto these by `singular`. */
export const HEADS: ReadonlyMap<string, Head> = new Map<string, Head>([
  ...nouns(
    'end-user',
    'customer client user consumer subscriber member visitor resident citizen buyer',
    false,
  ),
  ...nouns('decision-maker', 'executive director sponsor owner leadership', false),
  ...nouns(
    'operations',
    'manager employee staff worker engineer developer administrator admin operator technician contractor volunteer specialist',
    false,
  ),
  ...nouns(
    'influencer',
    'analyst adviser advisor consultant journalist expert critic advocate investor shareholder',
    false,
  ),
  ...nouns('competitor', 'competitor incumbent', false),
  // "Substitute" is as often a verb or a part of a thing as a group of people: it names a group only
  // with a describing word before it.
  ...nouns('substitute', 'substitute', true),
  ...nouns('partner', 'partner ally collaborator affiliate integrator supplier vendor', false),
  ...nouns(
    'channel',
    'reseller distributor wholesaler broker dealer intermediary aggregator seller',
    false,
  ),
  ...nouns(
    'regulator',
    'regulator watchdog ombudsman inspector legislator lawmaker government ministry',
    false,
  ),
  ...nouns('governance', 'auditor reviewer counsel', false),
  ...nouns(
    'other',
    'team group department unit office division function company firm organisation organization business provider officer',
    true,
  ),
  ...nouns('governance', 'council committee board', true),
  ['panel', { category: 'governance', weak: true, needs: 'governance' }],
  ...nouns('regulator', 'agency authority', true),
  ...nouns('influencer', 'association union community', true),
  ...nouns('decision-maker', 'management', true),
]);

/** Two-word heads, folded to their singular form: "decision makers" and "end users". */
export const PAIR_HEADS: ReadonlyMap<string, Head> = new Map<string, Head>([
  ['decision maker', { category: 'decision-maker', weak: false }],
  ['policy maker', { category: 'decision-maker', weak: false }],
  ['end user', { category: 'end-user', weak: false }],
]);

/**
 * Words that may describe a head ("enterprise customers", "support team"), each with the category it
 * suggests for a head that does not settle its own category, or null when it only narrows the group.
 */
const MODIFIER_LIST: [StakeholderCategory | null, string][] = [
  [
    null,
    'enterprise small medium large regional local national international global internal external independent corporate public private institutional commercial professional',
  ],
  [null, 'individual paying paid premium junior middle new existing prospective returning loyal'],
  [
    'operations',
    'support operations ops engineering infrastructure maintenance service delivery technical platform data helpdesk logistics production it',
  ],
  [
    'governance',
    'legal compliance security privacy risk audit finance procurement policy review oversight governance ethics steering advisory expert',
  ],
  ['decision-maker', 'executive leadership senior product strategy'],
  ['channel', 'sales marketing channel distribution'],
  ['competitor', 'competing rival competitor competitive'],
  ['partner', 'partner third-party'],
  ['regulator', 'regulatory'],
  ['end-user', 'customer user consumer client'],
];

export const MODIFIERS: ReadonlyMap<string, StakeholderCategory | null> = new Map(
  MODIFIER_LIST.flatMap(([category, words]) =>
    words.split(' ').map((word): [string, StakeholderCategory | null] => [word, category]),
  ),
);

/**
 * Describing words that say what state a person is in rather than what kind of group they form: a
 * "new customer" is a person, but a "new team" or a "new panel" is only something that is new. They
 * describe people, and do not make a noun like "team" or "panel" into a group of its own.
 */
export const STATE_ONLY: ReadonlySet<string> = new Set(
  'individual paying paid premium junior middle new existing prospective returning loyal'.split(
    ' ',
  ),
);

/**
 * A role noun with one of these straight after it is the first word of a compound that names something else:
 * "customer survey", "user interface", "customer success".
 */
export const COMPOUND_FOLLOWERS: ReadonlySet<string> = new Set(
  (
    'survey support service success experience journey interface account portal profile relationship ' +
    'satisfaction behaviour behavior story guide manual documentation ticket analytics insight data research list'
  ).split(' '),
);

/**
 * Nouns for what a group has, uses or sets: a role noun written in the singular with one of these straight
 * after it describes that thing ("admin controls", "reseller rates"), not the group. They name no industry.
 */
export const BELONGINGS: ReadonlySet<string> = new Set(
  'control panel console dashboard setting tool permission fee rate record'.split(' '),
);

/**
 * Of the nouns above, those that are also verbs: after a singular subject the verb ends in -s ("the admin
 * controls access"), so in that form they make a compound only when no article or possessive stands
 * before the role noun.
 */
export const BELONGINGS_AS_VERBS: ReadonlySet<string> = new Set(['control', 'rate', 'record']);

/** Words that stand before a noun to introduce it: an article, a pointer, a possessive, a quantity. */
export const INTRODUCERS: ReadonlySet<string> = new Set(
  'the a an this that these those each every our their its his her your my one another some any no'.split(
    ' ',
  ),
);

/**
 * Words that make a string of words a sentence and not a list of names or a menu: articles, pointers,
 * prepositions, conjunctions and auxiliary verbs. It is what tells prose from a row of labels when every
 * word is in capitals, so it holds no word that could name a group or describe one.
 */
export const FUNCTION_WORDS: ReadonlySet<string> = new Set(
  (
    'the a an this that these those and or but nor of to in on at by with from into than because after before ' +
    'since until will would may might can could should must shall is are was were be been being has have had ' +
    'do does did not for as if when while who which what how so'
  ).split(' '),
);

/**
 * Roles that name a position in any organisation and not a party to a change. Mentioned alone, with no
 * sign that anything is at stake for them, they start as background and not as a group of their own.
 */
export const GENERIC_ROLES: ReadonlySet<string> = new Set(
  'manager employee staff worker member specialist'.split(' '),
);

/** Function words and sentence openers that are never part of a group's name. */
export const STOPWORDS: ReadonlySet<string> = new Set(
  (
    'the a an this that these those our their its his her your my we they it some many most all any each every other another ' +
    'such both few several various one two three also only however meanwhile then thus therefore instead overall finally ' +
    'currently recently today still often first second next last no not key main major primary potential future likely ' +
    'typical additional further same different own certain whether when where while if as and or but for of to in on at by ' +
    'with from into than because after before since until will would may might can could should must is are was were be ' +
    'been has have had do does did who which what how why so yet four five six seven eight nine ten eleven twelve hundred thousand million dozen'
  ).split(' '),
);

/** Words in a sentence that say the group pays, gains or is exposed. They only ever move an end user. */
export const CONTEXT_CUES = {
  cost: new Set(
    'pay pays paying paid cost costs charge charges charged fee fees bill bills billed expense expenses burden afford fund levy surcharge'.split(
      ' ',
    ),
  ),
  benefit: new Set(
    'benefit benefits benefited benefiting gain gains gained save saves saved saving savings advantage profit improve improves improved improvement reward'.split(
      ' ',
    ),
  ),
  risk: new Set(
    'risk risks exposure exposed loss losses outage breach liable liability harm harmed vulnerable disruption disrupt threat damage'.split(
      ' ',
    ),
  ),
} as const;
export type ContextCue = keyof typeof CONTEXT_CUES;

/** A word without its possessive and plural ending: "customers’" and "Customer's" become "customer". */
export function singular(word: string): string {
  const lower = word
    .toLowerCase()
    .replace(/['’]s?$/u, '')
    .trim();
  if (lower.length > 4 && lower.endsWith('ies')) return `${lower.slice(0, -3)}y`;
  if (lower.length > 4 && /(?:ses|xes|zes|ches|shes)$/u.test(lower)) return lower.slice(0, -2);
  if (lower.length > 3 && lower.endsWith('s') && !/(?:ss|us|is)$/u.test(lower)) {
    return lower.slice(0, -1);
  }
  return lower;
}
