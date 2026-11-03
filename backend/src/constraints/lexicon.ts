import type { ConstraintCategory } from '../../../shared/constraints.js';
import { ANY_CUE } from './cues.js';

/**
 * A small, generic vocabulary for reading text for limits, used only by the rules path of constraint
 * discovery. It is a lens, never a list of answers: it names no industry, product or organisation, and a
 * limit it has no word for is simply not found by the rules (a model, the person's own words and the
 * questions put to them fill those gaps).
 *
 * A sentence is read as stating a constraint when it has BOTH words that name what is limited (a stem
 * of one of the categories below) and words that limit (a cue), so that a sentence that only mentions
 * money, or only says "must", is not one. Words of ordinary talk about people and markets weigh half as
 * much as the rest, so that they never carry a sentence on their own.
 */

interface Stems {
  /** Patterns for a word or phrase, each already bounded on its left: `regulat\w*` is "regulator", "regulation". */
  strong: readonly string[];
  /** Words of ordinary talk: they count for half, and a sentence cannot be named by them alone. */
  weak?: readonly string[];
}

export const CATEGORY_STEMS: Record<ConstraintCategory, Stems> = {
  budget: {
    strong: [
      'budget\\w*',
      'fund(?:s|ed|ing)?',
      'spend(?:s|ing)?',
      'spent',
      'afford\\w*',
      'financ(?:e|es|ial|ing)',
      'invest(?:ment|ments)?',
      'expense\\w*',
      'fiscal',
      'subsid\\w*',
      'grants?',
      'costs?',
      'costly',
      'money',
    ],
    weak: ['pay(?:s|ing)?', 'fees?', 'prices?'],
  },
  time: {
    strong: ['deadlines?', 'timelines?', 'time[- ]?frames?', 'lead[- ]times?', 'notice periods?'],
    weak: [
      'quarters?',
      'weeks?',
      'months?',
      'years?',
      'days?',
      'windows?',
      'schedule\\w*',
      'dates?',
    ],
  },
  capacity: {
    strong: [
      'capacit\\w+',
      'throughput',
      'workloads?',
      'concurrent\\w*',
      'simultaneous\\w*',
      'volumes?',
      'quotas?',
      'bandwidth',
      'overload\\w*',
      'absorb\\w*',
      'at once',
      // "can only handle", "cannot take on": what is handled says what the limit is about.
      "(?:can|could|able to|unable to|cannot|can['’]t)\\s+(?:only\\s+)?(?:handle|take on|cope with|process|support)",
    ],
    weak: ['handle[sd]?', 'seats?', 'slots?'],
  },
  staffing: {
    strong: [
      'headcount',
      'hiring',
      'hires?',
      'personnel',
      'staffing',
      'fte',
      'rota',
      'on-call',
      'skills?',
      'training',
    ],
    weak: ['staff', 'teams?', 'engineers?'],
  },
  'technical-feasibility': {
    strong: [
      'technically',
      'feasib\\w+',
      'compatib\\w+',
      'integrations?',
      'apis?',
      'architecture',
      'not supported',
      'cannot be built',
      'limitations?',
    ],
    weak: ['platforms?', 'systems?'],
  },
  infrastructure: {
    strong: [
      'infrastructure',
      'hosting',
      'servers?',
      'hardware',
      'data cent(?:re|er)s?',
      'cloud',
      'outages?',
      'uptime',
      'downtime',
      'network\\w*',
    ],
  },
  legal: {
    strong: [
      'law',
      'laws',
      'lawful\\w*',
      'legal\\w*',
      'statut\\w+',
      'liabilit\\w+',
      'liable',
      'litigation',
      'intellectual property',
      'copyright\\w*',
      'licen[cs]\\w+',
      'terms of service',
      'court\\w*',
    ],
  },
  regulatory: {
    strong: [
      'regulat\\w+',
      'complian\\w+',
      'comply',
      'certif\\w+',
      'permits?',
      'guidance',
      'standards?',
      'authorit(?:y|ies)',
      'agenc(?:y|ies)',
      'oversight',
      'supervis\\w+',
    ],
  },
  privacy: {
    strong: [
      'privacy',
      'personal data',
      'data protection',
      'consent',
      'retention',
      'pii',
      'anonymi[sz]\\w+',
      'confidential\\w*',
      'transcripts?',
    ],
  },
  security: {
    strong: [
      'security',
      'secure[d]?',
      'encrypt\\w*',
      'authenticat\\w+',
      'access control',
      'credentials?',
      'vulnerab\\w+',
      'breach\\w*',
      'tokens?',
    ],
  },
  safety: {
    strong: ['safety', 'safely', 'hazard\\w*', 'injur(?:y|ies)', 'harm(?:s|ed)?', 'danger\\w*'],
  },
  contractual: {
    strong: [
      'contract(?:s|ual|ually)?',
      'agreements?',
      'sla',
      'service[- ]level',
      'commitments?',
      'renewals?',
      'exclusiv\\w+',
      'lock-?in',
      'penalt(?:y|ies)',
      'warrant(?:y|ies)',
    ],
    weak: ['terms?', 'notice'],
  },
  geographic: {
    strong: [
      'jurisdictions?',
      'cross-border',
      'territor(?:y|ies)',
      'countr(?:y|ies)',
      'region(?:s|al)?',
      'export\\w*',
      'time ?zones?',
    ],
    weak: ['local'],
  },
  cultural: {
    strong: [
      'cultur(?:e|es|al)',
      'norms?',
      'tradition\\w*',
      'religio\\w+',
      'customs?',
      'languages?',
    ],
  },
  organizational: {
    strong: [
      'governance',
      'committees?',
      'board',
      'council',
      'polic(?:y|ies)',
      'sign-?off',
      'mandate\\w*',
      'decision rights',
      'procurement',
      'reorgani[sz]\\w+',
      'approval chain',
    ],
    weak: ['organi[sz]ation\\w*', 'management'],
  },
  operational: {
    strong: [
      'operations?',
      'operational',
      'workflows?',
      'procedures?',
      'runbooks?',
      'support hours',
      'service hours',
      'maintenance windows?',
      'shifts?',
    ],
    weak: ['process(?:es)?'],
  },
  market: {
    strong: ['competit\\w+', 'seasonal\\w*', 'pricing pressure'],
    weak: ['markets?', 'demand', 'supply'],
  },
  customer: {
    strong: ['expectations?'],
    weak: ['customers?', 'clients?', 'subscribers?', 'users?'],
  },
  dependency: {
    strong: [
      'depend(?:s|ed|ent|ency|encies|ing)?',
      'relies on',
      'rely on',
      'prerequisites?',
      'third[- ]part(?:y|ies)',
      'suppliers?',
      'vendors?',
      'upstream',
      'blocked by',
    ],
  },
  sequencing: {
    strong: [
      'sequenc\\w+',
      'phased',
      'in order',
      'prior to',
      'precede\\w*',
      'precedence',
      'stages?',
    ],
    weak: ['first', 'then'],
  },
  adoption: {
    strong: [
      'adoption',
      'uptake',
      'change management',
      'willingness',
      'resistance',
      'learning curve',
      'opt-?in',
      'opt-?out',
    ],
  },
  accessibility: {
    strong: ['accessib\\w+', 'screen readers?', 'assistive', 'disabilit\\w+', 'wcag'],
  },
  reputational: {
    strong: ['reputation\\w*', 'brand', 'public perception', 'press', 'media', 'scandal'],
  },
  environmental: {
    strong: [
      'environment\\w*',
      'emissions?',
      'carbon',
      'energy',
      'sustainab\\w+',
      'waste',
      'climate',
    ],
  },
  'data-quality': {
    strong: [
      'data quality',
      'missing data',
      'inaccurate',
      'incomplete',
      'not tracked',
      'not measured',
      'stale',
      'dirty data',
    ],
  },
  'evidence-quality': {
    strong: [
      'disputed',
      'unverified',
      'case study',
      'sample size',
      'anecdot\\w+',
      'self-reported',
      'peer-?review\\w*',
    ],
  },
  uncertainty: {
    strong: ['uncertain\\w*', 'unknown', 'unclear', 'undecided', 'not decided', 'open question'],
  },
  reversibility: {
    strong: ['reversib\\w+', 'irreversib\\w+', 'roll ?back', 'undo', 'undone', 'one-way', 'sunk'],
  },
};

/**
 * When two categories name a sentence equally, the one earlier here is taken: the limits whose neglect
 * does the most harm come first.
 */
export const CATEGORY_ORDER: readonly ConstraintCategory[] = [
  'legal',
  'regulatory',
  'safety',
  'privacy',
  'security',
  'contractual',
  'budget',
  'time',
  'capacity',
  'staffing',
  'dependency',
  'technical-feasibility',
  'infrastructure',
  'sequencing',
  'organizational',
  'operational',
  'geographic',
  'cultural',
  'accessibility',
  'adoption',
  'reputational',
  'environmental',
  'market',
  'customer',
  'data-quality',
  'evidence-quality',
  'reversibility',
  'uncertainty',
];

/**
 * Any word that can make a limit hard: an obligation, a ban, a ceiling or a floor, a condition, a binding
 * source, a fixed date (`cues.ts`). Having one is not enough: `readHardness` reads the clause around it,
 * because a wish, a possibility or a denial is not a limit that holds.
 */
export const HARD_CUE = ANY_CUE;

/** Words that limit without ruling anything out: a preference, a dependence, a commitment, a notice. */
export const SOFT_CUE =
  /\b(?:should|ought\s+to|ideally|prefer(?:red|s)?|limited|limits?|constrain(?:ed|s|t)|restrict(?:ed|ion|ions|s)?|no\s+spare|not\s+enough|too\s+few|insufficient|short\s+of|shortage|lack(?:s|ed|ing)?\s+(?:of|the)|(?:do|does|did)\s+not\s+have\s+(?:the|enough|any)|depends?\s+on|dependent\s+on|relies\s+on|rely\s+on|contingent|bound\s+by|committed|commitments?|deadline|notice\s+period|lead\s+time)\b/iu;

/** Words that say a limit is not known, so that what is wanted is a question and not a constraint. */
export const UNDECIDED_CUE =
  /\b(?:not\s+yet\s+(?:been\s+)?(?:decided|defined|set|agreed|settled|known|clear)|(?:has|have)\s+not\s+(?:yet\s+)?been\s+(?:set|decided|defined|agreed|settled)|undecided|unknown|unclear|to\s+be\s+(?:decided|determined|confirmed)|(?:nobody|no\s+one)\s+has\s+(?:set|decided|defined|measured|quoted)|\bnot\s+yet\b|(?:has|have|had|was|were)\s+not\s+(?:yet\s+)?(?:been\s+)?(?:tested|checked|assessed|reviewed))\b/iu;

/** Words that say what a source does not say or has not measured: a gap in what is known, which no limit can be read from. */
export const GAP_CUE =
  /\b(?:does\s+not\s+(?:say|state|show|give|explain)|(?:was|were|is|are|has|have)\s+not\s+(?:yet\s+)?(?:been\s+)?(?:tracked|measured|studied|tested|quoted|recorded)|not\s+(?:tracked|measured|studied|tested|recorded)|no\s+(?:data|evidence|information)\b|never\s+(?:been\s+)?measured)\b/iu;

/** Words that make a sentence about a requirement for approval. */
export const APPROVAL_CUE =
  /\b(?:approv(?:al|ed|e|es)|sign-?off|authori[sz]ation|authori[sz]ed|clearance|consent\s+of|permission)\b/iu;

/** A length of time or a date the sentence gives, kept as the words it was found in. */
export const WINDOW_TEXT =
  /\b(?:(?:within|for|over|after|before|until|by|no\s+(?:earlier|later)\s+than)\s+(?:the\s+)?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+(?:hour|day|week|month|quarter|year)s?|(?:until|by|before|after)\s+(?:the\s+)?(?:end\s+of\s+)?(?:q[1-4]|(?:the\s+)?(?:next|this|last)\s+(?:day|week|month|quarter|year)))\b/iu;

/** What a hard or a soft constraint says of its own breach: Swarm's words about the kind of limit, not a source's. */
export const IMPACT_IF_VIOLATED = {
  hard: 'If this limit is not met, the alternative cannot go ahead as described.',
  soft: 'If this limit is not met, the alternative is weaker, not ruled out.',
} as const;
