/**
 * The words with which a text states a limit as a fact: an obligation, a prohibition, a ceiling or a
 * floor, a condition, a binding source, a fixed date. Words of this kind say what is required or ruled
 * out; they are not words about preference, hope or request, which `deontic.ts` reads around them.
 *
 * Like the rest of the rules path, this is a lens and not a list of answers: it names no industry,
 * product or organisation, and a limit it has no word for is not found.
 */

export type CueFamily = 'obligation' | 'prohibition' | 'bound' | 'condition' | 'binding' | 'fixed';

export interface CueSpec {
  family: CueFamily;
  /** A modal verb. What someone asks for ("asks that staff must…") is not yet an obligation. */
  modal: boolean;
  /** The cue carries its own negation ("cannot", "no more than"): a negation before it is not read again. */
  negative: boolean;
  source: string;
  /** The words to show for a match that spans many ("will not … above"); the match itself when absent. */
  shown?: (match: string) => string;
  /**
   * Whether it states a limit with no other word that names what is limited: an obligation, a ban, a
   * right or a restriction on use does ("a patient may not leave until…"); a floor, a ceiling, an
   * exception or a date does not, because "at least once a week" or "unless it rains" says nothing alone.
   */
  standalone?: boolean;
}

const MONTH = String.raw`(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)`;
const MONTH_NAME = String.raw`(?:january|february|march|april|june|july|august|september|october|november|december)`;

/** A date, or part of one, as a source writes it: "30 September", "June 2027", "2028", "Q3", "Friday". */
export const DATE = String.raw`(?:\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?${MONTH}|${MONTH}\s+\d{1,2}(?:st|nd|rd|th)?|${MONTH}\s+(?:19|20)\d{2}|(?:19|20)\d{2}|q[1-4]|(?:mon|tues|wednes|thurs|fri|satur|sun)day|end\s+of\s+(?:the\s+)?(?:day|week|month|quarter|year)|(?:next|this)\s+(?:week|month|quarter|year)|${MONTH_NAME})`;

/** What needs approval, review or leave from someone: a step that has to happen first. */
const PROCESS_STEP = String.raw`(?:approval|consent|permission|sign-?off|authori[sz]ation|clearance|review|audit|inspection|assessment|licen[cs]e|permit|variation|amendment|waiver|exemption|consultation|vote)`;

/** A negated modal or future: a refusal or a ban, which a figure after it turns into a ceiling. */
const NEGATED_MODAL = String.raw`(?:(?:will|would|shall|may|can|could)\s+not|won['’]t|wouldn['’]t|shan['’]t|never)`;

const NOT_PUNCTUATION = String.raw`[^.;:?!]`;

/** The first and the last of the words a long match spans, which is what a person reads of it. */
const spanning =
  (first: RegExp, last: RegExp) =>
  (match: string): string => {
    const head = first.exec(match)?.[0];
    const tail = last.exec(match)?.[0];
    return head && tail ? `${head} … ${tail}` : match;
  };
const BOUND_WORD =
  /(?:above|over|beyond|more\s+than|in\s+excess\s+of|higher\s+than|greater\s+than)/iu;
const DATE_AT_END = new RegExp(`${DATE}$`, 'iu');

export const CUES: readonly CueSpec[] = [
  // An obligation: something has to be done, or has to be there.
  {
    family: 'obligation',
    modal: true,
    negative: false,
    source: String.raw`must(?!\s+not(?![\p{L}\p{N}]))`,
  },
  {
    family: 'obligation',
    modal: true,
    negative: false,
    source: String.raw`shall(?!\s+not(?![\p{L}\p{N}]))`,
  },
  { family: 'obligation', modal: true, negative: false, source: String.raw`(?:has|have)\s+to` },
  { family: 'obligation', modal: true, negative: false, source: String.raw`needs?\s+to` },
  {
    family: 'obligation',
    modal: false,
    negative: false,
    source: String.raw`require[sd]?(?:\s+to)?`,
  },
  // The noun on its own ("the requirements for the new system") says nothing of what is limited.
  {
    family: 'obligation',
    modal: false,
    negative: false,
    standalone: false,
    source: String.raw`requirements?`,
  },
  { family: 'obligation', modal: false, negative: false, source: String.raw`mandatory|compulsory` },
  {
    family: 'obligation',
    modal: false,
    negative: false,
    source: String.raw`obliged|obligat(?:ed|ion|ions|ory)`,
  },
  // "needs its own review", "would need a variation": a step that has to come first.
  {
    family: 'obligation',
    modal: false,
    negative: false,
    source: String.raw`needs?\s+(?:[\p{L}'’-]+\s+){0,3}${PROCESS_STEP}`,
  },
  // "needs evidence and a plan before the vote": a condition that has to hold first.
  {
    family: 'obligation',
    modal: false,
    negative: false,
    source: String.raw`needs?(?![\p{L}\p{N}])${NOT_PUNCTUATION}{0,100}?\s(?:before|prior\s+to|until|ahead\s+of)`,
    shown: spanning(/^needs?/iu, /(?:before|prior\s+to|until|ahead\s+of)$/iu),
  },

  // A prohibition: something is ruled out.
  { family: 'prohibition', modal: true, negative: true, source: String.raw`must\s+not` },
  { family: 'prohibition', modal: true, negative: true, source: String.raw`shall\s+not` },
  { family: 'prohibition', modal: true, negative: true, source: String.raw`may\s+not` },
  { family: 'prohibition', modal: true, negative: true, source: String.raw`cannot|can['’]t` },
  {
    family: 'prohibition',
    modal: false,
    negative: true,
    source: String.raw`not\s+(?:permitted|allowed)`,
  },
  {
    family: 'prohibition',
    modal: false,
    negative: false,
    source: String.raw`prohibit(?:ed|s|ion|ions)?`,
  },
  { family: 'prohibition', modal: false, negative: false, source: String.raw`forbid(?:s|den)?` },
  {
    family: 'prohibition',
    modal: false,
    negative: false,
    source: String.raw`banned|illegal|unlawful`,
  },
  { family: 'prohibition', modal: false, negative: true, source: String.raw`unable\s+to` },
  // "no one may be rostered…", "no visitor shall enter…": a negative subject with a modal.
  {
    family: 'prohibition',
    modal: true,
    negative: true,
    source: String.raw`no\s+\p{L}+\s+(?:may|shall)`,
  },

  // A ceiling or a floor.
  { family: 'bound', modal: false, negative: true, source: String.raw`no\s+(?:more|less)\s+than` },
  { family: 'bound', modal: false, negative: false, source: String.raw`at\s+(?:most|least)` },
  { family: 'bound', modal: false, negative: true, source: String.raw`not\s+(?:to\s+)?exceed` },
  { family: 'bound', modal: false, negative: true, source: String.raw`not\s+(?:more|less)\s+than` },
  {
    family: 'bound',
    modal: false,
    negative: false,
    source: String.raw`maximum|minimum|cap(?:ped)?|ceiling|quota`,
  },
  {
    family: 'bound',
    modal: false,
    negative: true,
    source: String.raw`no\s+(?:earlier|later)\s+than|not\s+before`,
  },
  { family: 'bound', modal: false, negative: false, source: String.raw`fixed\s+(?:by|at)` },
  {
    family: 'bound',
    modal: false,
    negative: false,
    source: String.raw`limit\s+of\s+(?:[£$€]\s?)?\d`,
  },
  // "will not raise the subsidy above $1.8 million": a refusal with a figure is a ceiling.
  {
    family: 'bound',
    modal: false,
    negative: true,
    source: String.raw`${NEGATED_MODAL}(?![\p{L}\p{N}])${NOT_PUNCTUATION}{0,60}?(?<![\p{L}\p{N}])(?:above|over|beyond|more\s+than|in\s+excess\s+of|higher\s+than|greater\s+than)(?![\p{L}\p{N}])${NOT_PUNCTUATION}{0,25}?(?:[£$€]\s?\d|\d)`,
    shown: spanning(/^\p{L}+(?:\s+not)?|^\S+/iu, BOUND_WORD),
  },
  // "at capacity", "no spare capacity": what can be taken in is used up.
  {
    family: 'bound',
    modal: false,
    negative: false,
    source: String.raw`at\s+(?:full\s+)?capacity|no\s+(?:spare|remaining|free)\s+capacity`,
  },

  // A condition: something holds only if, or unless, something else does.
  {
    family: 'condition',
    modal: false,
    negative: false,
    source: String.raw`only\s+(?:if|when|after|once)`,
  },
  {
    family: 'condition',
    modal: false,
    negative: false,
    source: String.raw`unless|subject\s+to|limited\s+to`,
  },
  {
    family: 'condition',
    modal: false,
    negative: false,
    source: String.raw`provided\s+that|on\s+condition\s+that`,
  },
  // "used only to improve bus services": a restriction on what a thing may be used for.
  {
    family: 'condition',
    modal: false,
    negative: false,
    standalone: true,
    source: String.raw`(?:used|spent|applied|available|reserved|allowed|restricted)\s+(?:only|solely|exclusively)\s+(?:to|for|on|by|in)`,
  },

  // A binding source: the law, a contract, a right that someone holds.
  {
    family: 'binding',
    modal: false,
    negative: false,
    source: String.raw`by\s+law|statutor(?:y|ily)|legally|contractually`,
  },
  {
    family: 'binding',
    modal: false,
    negative: false,
    source: String.raw`legal\s+(?:duty|duties|obligation|obligations|requirement|requirements)`,
  },
  {
    family: 'binding',
    modal: false,
    negative: false,
    standalone: false,
    source: String.raw`binding|enforceable`,
  },
  // "gives online buyers a right to cancel", "has the right to appeal", "is entitled to".
  {
    family: 'binding',
    modal: false,
    negative: false,
    source: String.raw`(?:gives?|grants?|confers?|has|have)\s+(?:[\p{L}'’-]+\s+){0,5}right\s+to|entitled\s+to`,
    shown: (match) => /(?:(?:an?|the)\s+)?right\s+to$/iu.exec(match)?.[0] ?? match,
  },

  // A fixed date: a deadline that names its day, a contract that names its end.
  {
    family: 'fixed',
    modal: false,
    negative: false,
    source: String.raw`deadline(?![\p{L}\p{N}])${NOT_PUNCTUATION}{0,60}?(?<![\p{L}\p{N}])${DATE}`,
    shown: spanning(/^deadline/iu, DATE_AT_END),
  },
  {
    family: 'fixed',
    modal: false,
    negative: false,
    source: String.raw`(?:contract|agreement|lease|licen[cs]e|permit|warranty|arrangement)s?(?![\p{L}\p{N}])${NOT_PUNCTUATION}{0,80}?(?<![\p{L}\p{N}])(?:ends?|expires?|lapses?|terminates?|runs\s+(?:out|until))(?![\p{L}\p{N}])${NOT_PUNCTUATION}{0,30}?(?<![\p{L}\p{N}])${DATE}`,
    shown: (match) => {
      const head = /^\p{L}+/u.exec(match)?.[0];
      const verb =
        /(?:ends?|expires?|lapses?|terminates?|runs\s+(?:out|until))(?![\p{L}\p{N}]).*$/iu.exec(
          match,
        )?.[0];
      return head && verb ? `${head} … ${verb}` : match;
    },
  },
];

const wrap = (source: string): string => String.raw`(?<![\p{L}\p{N}])(?:${source})(?![\p{L}\p{N}])`;

export const CUE_PATTERNS: readonly (CueSpec & { standalone: boolean; pattern: RegExp })[] =
  CUES.map((spec) => ({
    ...spec,
    standalone:
      spec.standalone ??
      (spec.family === 'obligation' || spec.family === 'prohibition' || spec.family === 'binding'),
    pattern: new RegExp(wrap(spec.source), 'giu'),
  }));

/** Any word that can make a limit hard, before the clause around it has been read: see `readHardness`. */
export const ANY_CUE = new RegExp(wrap(CUES.map((spec) => spec.source).join('|')), 'iu');

/**
 * Words of limits that rule nothing out by themselves: a limit, a dependence, a commitment, a notice, a
 * term of an agreement, an unavailable resource. A statement with one of them can be a firm limit, and a
 * model that says so may be believed; a statement with none is a fact, a wish or an opinion, and cannot be
 * made one by a model's say-so.
 */
export const LIMIT_WORDS = new RegExp(
  wrap(
    [
      String.raw`limit(?:s|ed|ing|ation|ations)?`,
      String.raw`constrain(?:s|ed|t|ts)?`,
      String.raw`restrict(?:s|ed|ion|ions)?`,
      String.raw`no\s+spare|not\s+enough|too\s+few|insufficient|short\s+of|shortage`,
      String.raw`lack(?:s|ed|ing)?`,
      String.raw`(?:do|does|did)\s+not\s+have`,
      String.raw`depend(?:s|ed|ent|ency|encies|ing)?\s+on|relies\s+on|rely\s+on|contingent|bound`,
      String.raw`committed|commitments?`,
      String.raw`deadlines?|notice|lead\s+times?`,
      String.raw`capacity|quotas?`,
      String.raw`needs?`,
      String.raw`agreements?|contracts?|contractual\w*|clauses?|terms|polic(?:y|ies)`,
      String.raw`laws?|legal\w*|codes?|standards?|regulat\w+|rules?`,
      String.raw`fixed|voluntary`,
      String.raw`not\s+(?:available|able)`,
      String.raw`(?:does|do)\s+not\s+(?:work|operate|open|run)`,
      String.raw`(?:will|would|can|could|may|might)\s+take(?:\s+(?:about|around|roughly|up\s+to))?\s+(?:\d|one|two|three|four|five|six|seven|eight|nine|ten|twelve)`,
    ].join('|'),
  ),
  'iu',
);
