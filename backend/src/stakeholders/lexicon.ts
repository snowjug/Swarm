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
  ...nouns('substitute', 'substitute', false),
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
  ...nouns('governance', 'council committee board panel', true),
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
    'enterprise small medium large regional local national international global internal external independent corporate individual public private institutional commercial professional paying paid premium junior middle new existing prospective returning loyal',
  ],
  [
    'operations',
    'support operations ops engineering infrastructure maintenance service delivery technical platform data helpdesk logistics production it',
  ],
  [
    'governance',
    'legal compliance security privacy risk audit finance procurement policy review oversight governance ethics steering',
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
