import type { StakeholderCategory } from '../../../../shared/stakeholders.js';
import { FUNCTION_WORDS, HEADS, INTRODUCERS, KIND_PREPOSITIONS, STOPWORDS } from '../lexicon.js';

/**
 * The words the participant reader knows a group by, beyond the small vocabulary of the discovery
 * lexicon. Like that one it is a lens for reading text and never a list of answers: it holds common
 * nouns for people in a role, for the kinds of body that people form and for the kinds of text that set
 * rules, taken from every walk of life and favouring none, and it names no organisation, product or
 * place. A group it does not know is simply not found, and a model or the person fills the gap.
 */

/**
 * How a noun names a group. `strong`: a person, or a kind of body, that is a group on its own
 * ("nurses"). `weak`: a group only with a describing word before it ("traffic team", not "team").
 * `proper`: a group only as a name, that is with a capitalised word before it ("Heritage Trust", not
 * "a trust").
 */
export type NounClass = 'strong' | 'weak' | 'proper';

export interface GroupNoun {
  category: StakeholderCategory;
  kind: NounClass;
}

const nouns = (
  category: StakeholderCategory,
  kind: NounClass,
  words: string,
): [string, GroupNoun][] => words.split(/\s+/u).map((word) => [word, { category, kind }]);

/**
 * Singular forms, which plurals and possessives are folded onto. The discovery lexicon's own nouns are
 * all here. The rest are grouped by what kind of party they are, and drawn from health, learning, public
 * service, transport, trade, labour and civil society alike.
 */
export const GROUP_NOUNS: ReadonlyMap<string, GroupNoun> = new Map<string, GroupNoun>([
  ...[...HEADS].map(([word, head]): [string, GroupNoun] => [
    word,
    { category: head.category, kind: head.weak ? 'weak' : 'strong' },
  ]),
  ...nouns(
    'end-user',
    'strong',
    'patient passenger commuter traveller traveler tourist shopper pupil student learner parent child ' +
      'family carer caregiver guardian tenant guest diner borrower patron attendee applicant claimant ' +
      'voter taxpayer householder homeowner pensioner rider cyclist pedestrian motorist driver ' +
      'islander villager neighbour neighbor household trainee apprentice viewer listener audience ' +
      'jobseeker holder',
  ),
  ...nouns('beneficiary', 'strong', 'beneficiary recipient grantee'),
  ...nouns(
    'operations',
    'strong',
    'nurse doctor physician clinician practitioner surgeon pharmacist clerk teacher lecturer ' +
      'instructor tutor representative receptionist cleaner mechanic electrician plumber chef waiter ' +
      'cashier coordinator supervisor foreman dispatcher librarian caretaker porter paramedic midwife ' +
      'therapist counsellor counselor trainer scientist crew workforce personnel attendant steward ' +
      'warden firefighter secretary registrar',
  ),
  ...nouns(
    'decision-maker',
    'strong',
    'chairperson chairman chairwoman mayor minister president superintendent headteacher',
  ),
  ...nouns(
    'channel',
    'strong',
    'retailer merchant trader shopkeeper stockist franchisee carrier courier importer exporter',
  ),
  ...nouns(
    'partner',
    'strong',
    'subcontractor manufacturer producer grower farmer landlord lender funder donor insurer ' +
      'consultancy',
  ),
  ...nouns(
    'governance',
    'strong',
    'accountant lawyer solicitor attorney trustee governor councillor assessor',
  ),
  ...nouns('regulator', 'strong', 'inspectorate tribunal'),
  ...nouns(
    'influencer',
    'strong',
    'campaigner activist lobbyist commentator blogger columnist economist researcher',
  ),
  ...nouns('competitor', 'strong', 'rival challenger'),
  // Kinds of body that name a group only with a describing word before them.
  ...nouns('influencer', 'weak', 'alliance coalition federation forum club institute charity'),
  ...nouns('partner', 'weak', 'cooperative'),
  ...nouns('other', 'weak', 'centre center'),
  // Kinds of body that are a group only as a name: a "library" is a place until it has a name.
  ...nouns(
    'other',
    'proper',
    'service foundation trust fund bank network society clinic hospital school college university museum library',
  ),
]);

/** Two-word nouns, folded to their singular form. */
export const PAIR_NOUNS: ReadonlyMap<string, GroupNoun> = new Map<string, GroupNoun>([
  ['social worker', { category: 'operations', kind: 'strong' }],
  ['care worker', { category: 'operations', kind: 'strong' }],
  ['health visitor', { category: 'operations', kind: 'strong' }],
  ['think tank', { category: 'influencer', kind: 'strong' }],
  ['pressure group', { category: 'influencer', kind: 'strong' }],
  ['regulatory body', { category: 'regulator', kind: 'strong' }],
  ['governing body', { category: 'governance', kind: 'strong' }],
  ['decision maker', { category: 'decision-maker', kind: 'strong' }],
  ['policy maker', { category: 'decision-maker', kind: 'strong' }],
  ['end user', { category: 'end-user', kind: 'strong' }],
]);

/** Plurals the ending rules do not fold, or fold wrongly. */
export const IRREGULAR_PLURALS: ReadonlyMap<string, string> = new Map([
  ['children', 'child'],
  ['nurses', 'nurse'],
  ['crews', 'crew'],
]);

/**
 * Bodies that are a group even with no describing word, when the text refers to them with "the": the
 * body that decides or checks. Others (a team, a company) are too common a word to be one alone.
 */
export const DEFINITE_BODIES: ReadonlySet<string> = new Set(
  'council committee board association union authority agency alliance coalition federation'.split(
    ' ',
  ),
);

/** Positions that say what a person is in charge of: "head of finance", "director of operations". */
export const TITLES: ReadonlyMap<string, StakeholderCategory> = new Map<
  string,
  StakeholderCategory
>([
  ['head', 'operations'],
  ['director', 'decision-maker'],
  ['chief', 'decision-maker'],
  ['president', 'decision-maker'],
  ['manager', 'operations'],
  ['officer', 'operations'],
  ['dean', 'operations'],
]);

/**
 * What the sources say a group asks, says or does. A sentence with one of these in it gives the groups
 * it names a position or an action, which is what makes a group matter to a decision.
 */
const STANCE_VERBS =
  'say ask want need expect fear worry note argue believe think feel suggest propose recommend agree ' +
  'disagree insist prefer hope intend wish accept reject refuse resist express explain warn oppose ' +
  'complain decide approve negotiate arrange collect handle provide deliver point';

/**
 * What only people do, in the form a plural subject takes: "handlers say", "leads ask". A plural noun
 * the vocabulary does not know is taken for a party when one of these follows it ("lanes need" is not
 * this: a thing can need, provide or handle).
 */
export const PEOPLE_VERBS: ReadonlySet<string> = new Set(
  (
    'say ask want expect fear worry believe think feel hope wish prefer insist argue agree disagree ' +
    'object complain oppose refuse resist warn accept reject suggest recommend propose decide'
  ).split(' '),
);

/**
 * Plural nouns for what a text holds or measures, not for who is in it: "reports say" and "figures
 * suggest" do not name a party, so a plural noun with a verb of saying is a party only when it is not one of these.
 */
export const THINGS_THAT_SAY: ReadonlySet<string> = new Set(
  (
    'report figure number result study survey statistic finding record document estimate forecast ' +
    'projection model plan policy rule term cost fee rate charge note minute table chart graph ' +
    'source article paper page draft proposal option guideline regulation law data detail sign ' +
    'indication reading measure outcome trend notice letter email message review'
  ).split(' '),
);

/** The forms of the stance verbs a sentence may carry, including the irregular ones. */
export const STANCE_FORMS: ReadonlySet<string> = new Set([
  ...'said told asked felt thought wrote planned planning'.split(' '),
  ...STANCE_VERBS.split(' ').flatMap((verb) => {
    const stem = verb.endsWith('e') ? verb.slice(0, -1) : verb;
    return [verb, `${verb}s`, `${verb}es`, `${stem}ed`, `${stem}ing`, `${verb}ed`];
  }),
]);

/**
 * What a party does that starts a change. The party a sentence says it of is the one making the decision,
 * and a party that only approves, advises or carries it out is not: those verbs are not here.
 */
export const DECISION_FORMS: ReadonlySet<string> = new Set(
  (
    'propose proposes proposed decide decides decided commit commits committed plan plans planned ' +
    'intend intends intended announce announces announced introduce introduces introduced adopt ' +
    'adopts adopted'
  ).split(' '),
);

/** The closed class of words: articles, pointers, prepositions, conjunctions and auxiliaries, and a few more. */
export const CLOSED_CLASS: ReadonlySet<string> = new Set([
  ...STOPWORDS,
  ...FUNCTION_WORDS,
  ...INTRODUCERS,
  ...(
    'about over under between among across against during within without around near outside inside ' +
    'through throughout toward towards upon per via onto beside behind beyond along despite except ' +
    'including like just also even ever never always often already yet there here now whereas ' +
    'not very more most less least much many both either neither whether others'
  ).split(' '),
]);

/** Words that never describe a group: the closed class, a verb of saying, and more. */
export const NOT_DESCRIBING: ReadonlySet<string> = new Set([
  ...CLOSED_CLASS,
  ...STANCE_FORMS,
  ...(
    'best better good bad old whole entire current final initial original early late recent specific ' +
    'particular appropriate relevant proposed possible available necessary important big little real ' +
    'named designated dedicated assigned appointed'
  ).split(' '),
  // The forms of a verb that cannot be a describing word: a verb stands between a noun and the next one.
  ...(
    'gives makes takes gets keeps shows lets puts holds pays sends sells buys means leads serves ' +
    'operates covers faces includes requires allows ensures enables helps affects causes creates ' +
    'provides remains becomes seems appears follows involves brings sees knows finds wants needs ' +
    'commits votes adopts signs meets considers reviews approves agrees opens closes starts ends ' +
    'relies depends works comes goes lives stays reports moves grows drives rises falls reaches ' +
    'wishes tries uses sets cuts runs plays calls passes changes ' +
    'gave made took got kept held paid sent sold bought led brought saw knew found began chose ' +
    'wrote spoke met stood understood'
  ).split(' '),
]);

/** Words for a time, which say when and not which group: they are not part of the words after a group's noun. */
export const TIME_WORDS: ReadonlySet<string> = new Set(
  (
    'january february march april may june july august september october november december ' +
    'monday tuesday wednesday thursday friday saturday sunday spring summer autumn fall winter ' +
    'today tomorrow yesterday day days week weeks weekend weekends weekday weekdays month months ' +
    'year years morning mornings afternoon afternoons evening evenings night nights noon midnight ' +
    'quarter quarters decade decades'
  ).split(' '),
);

/** Words that mark the end of a closed class of words before a group: a preposition, a determiner, a conjunction. */
export const ANCHORS: ReadonlySet<string> = NOT_DESCRIBING;

export { KIND_PREPOSITIONS };

/** Words that, written after a role noun in the singular, make a compound for something else: "patient records". */
export const COMPOUND_AFTER: ReadonlySet<string> = new Set(
  (
    'record room station desk bay pass card loan benefit care protection safety seat income ' +
    'number name data file history journey voice engagement forum feedback house home ' +
    'spending trip account fare ticket dashboard portal app website site ' +
    'page email message form base segment count volume demand behaviour behavior expectations ' +
    'trust loyalty rights wellbeing welfare health education training turnover rota shift ' +
    'hours availability levels numbers rate survey surveys research'
  ).split(' '),
);

/**
 * Plurals that are as often a verb, which make a compound only when what follows is not a determiner or a
 * pronoun: "patient records are kept" is a compound, and "the clerk records the call" is a clerk.
 */
export const COMPOUND_PLURALS: ReadonlySet<string> = new Set(
  'records rates shifts trips accounts fares tickets houses homes'.split(' '),
);

/** Words that begin what a verb acts on, so that the word before them is the verb. */
export const OBJECT_STARTERS: ReadonlySet<string> = new Set(
  'the a an this that these those his her its their our my your it them him us all each every some any no'.split(
    ' ',
  ),
);

/** Words ending in "ly" that describe and are not adverbs. */
export const LY_WORDS_THAT_DESCRIBE: ReadonlySet<string> = new Set(
  'monthly weekly daily yearly quarterly hourly nightly early elderly family friendly assembly supply'.split(
    ' ',
  ),
);

/** Nouns for a group that is many people at once, though written in the singular: they take a plural verb's place. */
export const COLLECTIVES: ReadonlySet<string> = new Set(
  'staff personnel workforce crew audience management leadership'.split(' '),
);

/** Things that a "board" or a "panel" is, when one of these stands before it: not a body of people. */
export const THING_MODIFIERS: ReadonlySet<string> = new Set(
  'notice bulletin message white black dash score leader circuit story sign solar control display instrument switch'.split(
    ' ',
  ),
);

const set = (words: string): ReadonlySet<string> => new Set(words.split(' '));

/**
 * Nouns that name a body of people only with some words before them, and a thing with others: the word
 * nearest the noun decides. A "notice board" and a "content delivery network" are things; so is an "admin
 * center", which is a page or a place that people go to.
 */
export const THING_HEADS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['board', THING_MODIFIERS],
  ['panel', THING_MODIFIERS],
  [
    'network',
    set(
      'content delivery computer neural wireless cellular virtual private area data sensor mesh storage',
    ),
  ],
  ['center', set('admin data help download notification control update message')],
  ['centre', set('admin data help download notification control update message')],
]);

/**
 * Words that open an instruction, a heading or a menu item in documentation ("Configure widgets", "Manage
 * users", "Turn off captions"): what a person does with a thing, not who they are. Only verbs that no
 * group is described by are here: "select" and "set" are left out, since a select committee and set
 * designers are groups.
 */
export const COMMAND_VERBS: ReadonlySet<string> = set(
  'configure manage create add edit delete remove assign enable disable deploy install uninstall view use ' +
    'upgrade migrate troubleshoot restore turn learn get try go enter click download connect register reset ' +
    'invite customize customise integrate automate optimize optimise join apply allow restrict choose',
);

/**
 * Words that, standing right before a role noun, say that no person does the job: an "auto attendant" is a
 * phone menu and a "robotic cleaner" a machine. "Virtual" and "AI" are not here: a virtual team and an AI
 * researcher are people.
 */
export const MACHINE_MODIFIERS: ReadonlySet<string> = set('auto automated automatic robotic');

/** Texts that set rules, and so imply a body that sets or applies them. */
export const INSTRUMENTS: ReadonlySet<string> = new Set(
  'code standard act policy regulation directive charter guideline framework agreement law legislation statute bylaw'.split(
    ' ',
  ),
);
