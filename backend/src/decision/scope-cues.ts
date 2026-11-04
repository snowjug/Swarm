import { HIGH_STAKES_DOMAINS, type HighStakesDomain } from '../../../shared/decision.js';

/**
 * The words the scope check reads (`scope.ts`): which words call a clause a matter of employment, credit, law,
 * medicine or safety, and which words say that it is one person’s. They are data and not logic so that they can be
 * read, tested and extended in one place. They are not complete, and nothing says that they are: a question put in
 * other words is not recognised.
 */

export const word = (source: string): RegExp => new RegExp(String.raw`\b(?:${source})\b`, 'giu');

// ---------------------------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------------------------

/** Words that can follow a name and do not make it a modifier of something else: “Maria Lopez for …”. */
const CLOSED =
  'and|or|but|to|for|from|in|on|at|with|without|after|before|because|due|following|over|under|as|by|of|if|when|while|so|that|who|whom|whose|which|than|then|since|until|despite|given|rather|instead|based|per|via|into|against|about|regarding|should|would|could|can|may|might|must|is|was|are|were|has|have|had|be|been|do|does|did|not|now|today|tomorrow|too|also|again|already|still|yet|go|off|out|next|first';
const PRONOUNS = 'we|i|you|they|he|she|it|us|me|them';
export const FOLLOWS = String.raw`(?=\s*(?:$|[,.;:?!)"]|'s\b)|\s+(?:${CLOSED})\b|\s+\p{L}+ly\b)`;
/** Between a determiner and a person noun: up to two words that are not clause words. */
export const MODIFIERS = String.raw`(?:(?!(?:${CLOSED}|${PRONOUNS})\b)[\p{L}-]+\s+){0,2}?`;

export const ROLES =
  'employee|worker|staff member|team member|team lead|tech lead|line manager|colleague|manager|supervisor|intern|apprentice|contractor|assistant|applicant|candidate|recruit|hire|patient|customer|client|borrower|account holder|claimant|tenant|subtenant|lodger|landlord|defendant|plaintiff|suspect|prisoner|inmate|driver|pilot|operator|nurse|doctor|teacher|student|pupil|child|baby|toddler|teenager|person|individual|user|resident|citizen|passenger|player|athlete|man|woman|boy|girl|lady|gentleman|mother|father|parent|son|daughter|wife|husband|spouse|brother|sister|grandmother|grandfather|grandson|granddaughter|uncle|aunt|nephew|niece|cousin|friend|boyfriend|girlfriend|partner|business partner|neighbou?r|boss|employer|lawyer|solicitor|therapist|ceo|cfo|cto|coo|director|executive|chair|president|principal|engineer|developer|analyst|accountant|auditor|clerk|cashier|secretary|receptionist|consultant|advis[eo]r|specialist|officer|official|leader|founder|owner|technician|mechanic|guard|cleaner|carer|caregiver|babysitter|nanny|surgeon|physician|pharmacist|paramedic|midwife|dentist|radiographer|physiotherapist|psychologist|psychiatrist|counsell?or|social worker|salesperson|salesman|saleswoman|sales rep|shopkeeper|shop owner|storekeeper|merchant|banker|barista|chef|cook|waiter|waitress|bartender|courier|porter|janitor|caretaker|labou?rer|foreman|welder|electrician|plumber|carpenter|farmer|miner|lecturer|professor|tutor|referee|journalist|programmer|lifeguard|firefighter|constable|detective|soldier|sailor|captain|head ?teacher|shoplifter|thief|offender|culprit|perpetrator|fraudster|trespasser|intruder|vandal|whistleblower|witness|juror|victim|survivor|heir|beneficiary|guardian|trustee|family|household|couple|bookkeeper|treasurer|controller|underwriter|adjuster|attorney|barrister|paralegal|notary|judge|magistrate|landlady|housemate|roommate|flatmate|starter|joiner|trainee|appointee|nominee|incumbent|successor|predecessor|mentee|diver|climber|swimmer|cyclist|rider|lead|chairman|chairwoman|chairperson|guy|lad|bloke|dude|chap|kid|lass|gal|fellow';
export const PERSON_PLURAL = `(?:${ROLES})s|children|people|staff|persons|women|men`;
/** Words that say which one, so that “the second candidate” and “the former employee” are one person. */
export const QUALIFIERS =
  'first|second|third|fourth|fifth|sixth|last|next|final|other|another|same|only|remaining|former|current|previous|new|old|newest|oldest|junior|senior|top|best|worst|youngest|eldest|older|younger|shortlisted|successful|unsuccessful|rejected|selected|chosen|preferred|internal|external|temporary|permanent|underperforming|struggling|difficult|troubled|sick|injured|elderly|pregnant|disabled|retired|departing|outgoing|incoming|prospective|potential|named|particular|specific|single|individual|\\d+(?:st|nd|rd|th)';
/** The people a decision is made about when it is said in the definite: “reject the applicant”, “admit the patient”. */
export const DECIDED_ROLES =
  'applicant|candidate|borrower|patient|tenant|defendant|claimant|plaintiff|suspect|prisoner|inmate|employee|worker|driver|pilot';
/** A person noun heads its phrase unless one of these follows it: “this employee benefit”, “our customer support”. */
const ADJUNCT =
  'benefits?|handbook|policy|policies|survey|surveys|engagement|turnover|retention|wellbeing|well-being|experience|training|onboarding|relations|rights|satisfaction|data|records?|scheme|programme|program|portal|app|platform|stock|shares?|ownership|assistance|discount|perks?|union|council|forum|network|groups?|segments?|journey|pathways?|flow|base|lists?|population|cohort|care|advocacy|education|transport|safety|support|services?|success|acquisition|feedback|insights?|sentiment|analytics|churn|loyalty|profiles?|personas?|communit(?:y|ies)|teams?|departments?|offices?|branch|stores?|sites?|plant|factory|region|markets?|operations|subsidiary|business|company|division|unit|dashboard|tools?|system|process|workflow|rates?|numbers|volumes?|outcomes?|waiting|capacity|confidence|trust|mix|growth|lifetime|value|identity|identification|verification|authentication|privacy|consent|complaints?|tickets?|accounts?|orders?|cart|basket|checkout|interface|behaviou?r|demographics?|mapping|plans?|packages?|tiers?|editions?|kits?|generation|magnets?|sources?|scoring|nurturing|capture|qualification|funnel|scores?|times?|intake|pool|pipeline|posts?|positions?|roles?|seats?|vacanc(?:y|ies)|openings?|jobs?|titles?';
export const NOT_ADJUNCT = String.raw`(?!\s+(?:${ADJUNCT})\b)`;
export const NUMBER = 'two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\\d+';

/** A role that is a matter of a domain by itself: someone called “this named patient” is a medical matter. */
const ROLE_DOMAIN: Record<string, HighStakesDomain> = {
  patient: 'medical',
  defendant: 'legal',
  plaintiff: 'legal',
  suspect: 'legal',
  prisoner: 'legal',
  inmate: 'legal',
  claimant: 'legal',
  borrower: 'credit',
};
export const roleDomain = (noun: string): HighStakesDomain | undefined =>
  ROLE_DOMAIN[noun.toLowerCase().replace(/s$/u, '')];

export const NAME = String.raw`\p{Lu}\p{Ll}{1,}(?:['-]\p{Lu}?\p{Ll}+)*`;
export const HONORIFIC = String.raw`(?:Mr|Mrs|Ms|Miss|Mx|Dr|Prof|Professor|Sir|Dame|Judge)\.?\s+`;
/** Capitalised words that are not a person: a title, a day, a word of an organisation or of a place, a language, a well-known company or product. */
export const NOT_NAMES: ReadonlySet<string> = new Set(
  (
    'The This That These Those Our My His Her Their Your All Any Each Every Some Most Many Both Either Neither Another Other It Him Them Us Me You We They She He And Or But If When While Whether Which Who What How Why Should Would Could Can May Might Must Do Does Did Is Are Was Were Please ' +
    'Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April June July August September October November December ' +
    'Inc Ltd Llc Corp Corporation Co Company Group Bank University College School Council Authority Agency Department Ministry Hospital Clinic Foundation Trust Partners Associates Consulting Technologies Systems Solutions Services Holdings Industries Institute Society Association Union Board Commission Committee Government Parliament Congress Court Airlines Motors Pharma Labs Studios Media Capital Fund Ventures Network Platform Store Shop Market Foods Energy Power Water Gas Oil Mining Steel Chemicals Telecom Mobile Cloud Software Digital Global International National Federal Municipal City County State Province Region District Office Team Staff Branch Division Unit ' +
    'london berlin madrid rome lisbon dublin amsterdam brussels vienna zurich geneva munich hamburg frankfurt warsaw prague budapest athens stockholm oslo copenhagen helsinki moscow istanbul dubai cairo lagos nairobi accra johannesburg tokyo osaka seoul beijing shanghai shenzhen mumbai delhi bangalore bengaluru chennai hyderabad kolkata pune karachi lahore dhaka singapore bangkok jakarta manila sydney melbourne brisbane perth auckland toronto vancouver montreal ottawa chicago boston seattle denver atlanta miami detroit philadelphia nashville texas california florida ohio oregon nevada arizona colorado america europe asia africa australia canada mexico brazil argentina chile peru colombia china japan korea russia ukraine poland germany france spain italy portugal ireland scotland wales england britain turkey egypt nigeria kenya ghana israel iran iraq pakistan bangladesh vietnam thailand indonesia philippines malaysia nordic scandinavia balkans ' +
    'english french german spanish italian chinese japanese korean arabic hindi russian portuguese dutch swedish american european african asian british indian canadian australian ' +
    'google microsoft amazon apple meta facebook instagram whatsapp twitter linkedin youtube netflix spotify uber lyft airbnb tesla ford toyota honda samsung sony nokia intel nvidia amd oracle sap ibm salesforce hubspot slack zoom teams notion jira confluence asana trello figma canva shopify stripe paypal square visa mastercard amex openai chatgpt copilot azure aws gcp github gitlab docker kubernetes linux windows android ios excel word outlook sharepoint workday zendesk intercom twilio snowflake databricks tableau deloitte accenture mckinsey pwc kpmg bain bcg walmart costco target starbucks mcdonalds nike adidas disney nestle unilever shell barclays hsbc citi chase santander ' +
    'christmas easter ramadan diwali netherlands philippines alps rockies olympics beatles states nations emirates bahamas maldives andes himalayas ' +
    'senior junior head chief lead principal vice general assistant associate deputy interim acting regional global managing executive'
  )
    .split(' ')
    .map((entry) => entry.toLowerCase()),
);

// ---------------------------------------------------------------------------------------------
// Acts
// ---------------------------------------------------------------------------------------------

/** What is done to a person, by domain: the act that makes a clause about a matter of that domain. */
export const ACT_VERBS: Record<HighStakesDomain, string> = {
  employment:
    'fir(?:e|es|ed|ing)|dismiss(?:es|ed|ing)?|sack(?:s|ed|ing)?|demot(?:e|es|ed|ing)|hir(?:e|es|ed|ing)|rehir(?:e|es|ed|ing)|disciplin(?:e|es|ed|ing)|suspend(?:s|ed|ing)?|terminat(?:e|es|ed|ing)|lay(?:s|ing)? off|laid off',
  credit: 'lend(?:s|ing)?|underwrit(?:e|es|ing)',
  legal:
    'su(?:e|es|ed|ing)|prosecut(?:e|es|ed|ing)|convict(?:s|ed|ing)?|sentenc(?:e|es|ed|ing)|arrest(?:s|ed|ing)?|evict(?:s|ed|ing)?|deport(?:s|ed|ing)?',
  medical: 'diagnos(?:e|es|ed|ing)|prescrib(?:e|es|ed|ing)',
  safety: 'evacuat(?:e|es|ed|ing)',
};
export const NAMING_VERBS = Object.values(ACT_VERBS).join('|');
export const STRONG_VERBS = `${NAMING_VERBS}|treat(?:s|ed|ing)?|admit(?:s|ted|ting)?|discharg(?:e|es|ed|ing)|promot(?:e|es|ed|ing)|replac(?:e|es|ed|ing)`;
/** Verbs that name no domain by themselves but say that a person is being decided about. */
export const DECIDING_VERBS =
  'promot(?:e|es|ed|ing)|approv(?:e|es|ed|ing)|declin(?:e|es|ed|ing)|den(?:y|ies|ied|ying)|reject(?:s|ed|ing)?|accept(?:s|ed|ing)?|rank(?:s|ed|ing)?|shortlist(?:s|ed|ing)?|select(?:s|ed|ing)?|choos(?:e|es|ing)|pick(?:s|ed|ing)?|scor(?:e|es|ed|ing)|rat(?:e|es|ed|ing)|screen(?:s|ed|ing)?|vet(?:s|ted|ting)?|assess(?:es|ed|ing)?|evaluat(?:e|es|ed|ing)|clear(?:s|ed|ing)?|certif(?:y|ies|ied|ying)|admit(?:s|ted|ting)?|discharg(?:e|es|ed|ing)|treat(?:s|ed|ing)?|offer(?:s|ed|ing)?|grant(?:s|ed|ing)?|give|gives|gave|giving|ground(?:s|ed|ing)?|put|puts|putting|place|places|placing';
export const ALL_VERBS = `${NAMING_VERBS}|${DECIDING_VERBS}`;

/** Nouns that belong to one person’s own matter: “her loan”, “his treatment”, “my lawsuit”. */
export const OWN_MATTERS =
  'loan|mortgage|credit|overdraft|treatment|diagnosis|dosage|dose|medication|medicine|prescription|symptoms?|surgery|therapy|injury|lawsuit|case|appeal|sentence|bail|contract|employment|promotion|salary|pay|performance review|dismissal|application|claim|account|licen[cs]e|visa|custody|divorce|condition';
/** The ones that are a person’s even beside a single capitalised word: “Maria’s mortgage”. */
export const PERSONAL_MATTERS =
  'loan|mortgage|overdraft|treatment|diagnosis|dosage|dose|medication|prescription|symptoms?|surgery|therapy|injury|lawsuit|appeal|sentence|bail|promotion|salary|dismissal|employment|application|custody|divorce|visa';
/** What a person is said to be when a decision about them is asked: “is she eligible”, “is he fit to”. */
export const STATES =
  'fit|eligible|safe|qualified|suitable|competent|capable|cleared|entitled|allowed|permitted|able|ready|worthy|deserving';
/** What a person asks about their own matter: “should I sue”. */
export const SELF_VERBS =
  'sue|take|get|quit|resign|accept|decline|refuse|stop|start|borrow|refinance|settle|plead|appeal|apply for|sign|leave|switch|use';

/**
 * The words of a phrase that are safe to quote in the basis: a closed list of determiners, qualifiers, role nouns and verbs.
 * Anything else in the phrase is dropped, so that a name, said in whatever case, is never repeated by a cue; and a
 * capitalised word after the first is dropped even when it is also a verb (“Sue”, “Grant”).
 */
const QUOTABLE = new RegExp(
  String.raw`^(?:the|this|that|these|those|my|our|his|her|your|their|a|an|one|of|which|who|whom|he|she|him|them|it|is|was|be|been|being|get|gets|got|to|for|against|about|on|in|at|with|from|as|off|out|down|up|back|away|home|go|redundant|all|any|each|${QUALIFIERS}|${ROLES}|${PERSON_PLURAL}|${ALL_VERBS}|${STATES}|${NUMBER})$`,
  'iu',
);
export function safeQuote(text: string): string {
  const kept = text.split(/\s+/u).filter((token, index) => {
    const word = token.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, '');
    if (word === '' || (index > 0 && /^\p{Lu}/u.test(word))) return false;
    return QUOTABLE.test(word);
  });
  return kept.join(' ').toLowerCase();
}

const DECISION_WORDS =
  'call(?:s|ed|ing)? back|progress(?:es|ed|ing)?|advanc(?:e|es|ed|ing)|rank(?:s|ed|ing)?|reject(?:s|ed|ing)?|accept(?:s|ed|ing)?|select(?:s|ed|ing)?|choos(?:e|es|ing)|pick(?:s|ed|ing)?|shortlist(?:s|ed|ing)?|screen(?:s|ed|ing)?|scor(?:e|es|ed|ing)|rat(?:e|es|ed|ing)|decid(?:e|es|ed|ing)|approv(?:e|es|ed|ing)|declin(?:e|es|ed|ing)|den(?:y|ies|ied|ying)|turn(?:s|ed|ing)? down|admit(?:s|ted|ting)?|interview(?:s|ed|ing)?|invit(?:e|es|ed|ing)|offer(?:s|ed|ing)?|giv(?:e|es|ing)|gave';
const DECIDING = word(DECISION_WORDS);
const CREDIT_WORDS = word(
  'loans?|credit|mortgages?|cards?|lend(?:s|ing|ers?)?|borrow(?:s|ed|ing|ers?)?|overdrafts?|financ(?:e|ing)',
);

// ---------------------------------------------------------------------------------------------
// Cues of a domain
// ---------------------------------------------------------------------------------------------

export interface Cue {
  re: RegExp;
  /** A word for the field, not for an act: it calls for a notice and never pairs with a person. */
  topic?: boolean;
  /** The clause must also hold this, for a word that names a domain only beside another. */
  also?: RegExp;
  /** Which domain, when it depends on the clause or on what matched. */
  domain?: (clause: string, match: RegExpMatchArray) => HighStakesDomain;
  /** A match that is not a cue after all: a capitalised word that is not a name, a product that is not a person. */
  accept?: (match: RegExpMatchArray, clause: string) => boolean;
  /** What the basis says of the match, when the match holds more than a few words of the question. */
  label?: (match: RegExpMatchArray) => string;
}

/** A run of capitalised words that can be a name: none of them a title, a day or a word of an organisation. */
export const isName = (run: string | undefined): boolean =>
  run === undefined || !run.split(/\s+/u).some((token) => NOT_NAMES.has(token.toLowerCase()));

/** The people an employer decides about: for acts that are not named for what they do to a person, such as “let … go”. */
const STAFF =
  'employee|worker|staff member|team member|colleague|manager|supervisor|intern|apprentice|contractor|assistant|recruit|engineer|developer|analyst|accountant|clerk|cashier|secretary|receptionist|consultant|specialist|officer|technician|mechanic|cleaner|teacher|nurse|director|executive|[Cc][Ee][Oo]|[Cc][Ff][Oo]|[Cc][Tt][Oo]|[Cc][Oo][Oo]|leader|founder';
/** “our contractor”, “these two engineers”, “one of our sales managers”. */
const THE_STAFF = String.raw`(?:this|that|my|our|the|his|her|these|those|one of our)\s+(?:\p{L}+\s+){0,3}?(?:${STAFF})s?\b${NOT_ADJUNCT}`;
/** Him or her, or one of the people above, or a name: the group is the name, and it is read only if `isName` says so. */
const PERSON_OBJECT = String.raw`(?:him|her|${THE_STAFF}|(\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+){0,2}))`;
/** What ends “let X go”, so that it is never “let X go through the gate”. */
const GO_ENDS = String.raw`go(?=\s*(?:$|[,.;:?!)"])|\s+(?:or|and|but|if|because|since|after|before|due|rather|instead|now|today|tomorrow|next|without|given|based|following|during)\b)`;
export const GO_ENDING = GO_ENDS;
/** What a person is promoted to: a post, not a customer, so that a product is never read as a person. */
export const PROMOTED_TO = String.raw`to\s+(?:the\s+|a\s+|an\s+)?(?:\p{L}+\s+){0,2}?(?:head|lead|chief|senior|manager|director|partner|vice|supervisor|executive|principal|officer|president|VP|[Cc][Ee][Oo]|[Cc][Ff][Oo]|[Cc][Tt][Oo]|[Cc][Oo][Oo])\b`;
/** One to three capitalised words, one capture group: the same as the name in `PERSON_OBJECT`. */
export const NAMES = String.raw`(\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+){0,2})`;
/** A cue read with capitals, since it holds a name: it counts only if what stands for the name can be one. Its label is said without the person. */
const ofPerson = (source: string, label: string): Cue => ({
  re: new RegExp(source, 'gu'),
  accept: (match) => isName(match[1]),
  label: () => label,
});

const SAFE_TO_NOT =
  'say|assume|ignore|skip|conclude|infer|presume|bet|claim|argue|suggest|expect|think|believe|guess';
const FIRE_NOT =
  'up|off|away|back|at|on|in|safety|alarms?|drills?|exits?|doors?|hazards?|risks?|season|stations?|departments?|brigade|service|engines?|extinguishers?|code|marshal|sprinklers?|insurance|damage|evacuation|trucks?|fighters?|fighting|prevention|protection|regulations?|rating|ratings|walls?|escape|detection|retardant|watch|bans?';
const FIRE_OBJECT = `him|her|them|this|that|my|our|his|their|one of|someone|somebody|anyone|(?:the|a|an)\\s+(?:\\p{L}+\\s+)?(?:${ROLES})\\b`;

export const CUES: Record<HighStakesDomain, Cue[]> = {
  employment: [
    { re: word('hir(?:e|es|ed|ing)|rehir(?:e|es|ed|ing)') },
    { re: word('recruit(?:s|ed|ing|ment)?'), topic: true },
    { re: word('shortlist(?:s|ed|ing)?') },
    { re: word('job offers?|job (?:applicants?|candidates?|interviews?|applications?)') },
    ofPerson(
      String.raw`\b[Oo]ffer(?:s|ed|ing)?\s+(?:${PERSON_OBJECT}\s+)?(?:the|a|an)\s+(?:\p{L}+\s+){0,3}(?:position|role|job)\b`,
      'offer the job',
    ),
    { re: word('(?:cv|resume|résumé|application)s? screening'), topic: true },
    {
      re: word(
        'dismiss(?:es|ed|ing|al|als)?(?!\\s+(?:the|this|that|an?|any|all|such|these|those|his|her|their|my|our)?\\s*(?:idea|ideas|proposal|proposals|concern|concerns|suggestion|suggestions|notion|notions|possibility|possibilities|option|options|request|requests|rumou?rs?|criticism|objection|objections|theory|theories|hypothesis|warning|warnings|feedback)\\b)',
      ),
    },
    { re: word('(?:sack|sacked|sacking)(?!\\s+of\\b)') },
    { re: word('lay(?:s|ing)? off|laid off|made redundant') },
    { re: word('(?:let|lay|make|show)\\s+(?:him|her)\\s+(?:go|off|redundant|the door)') },
    // “let Maria go”, “let our contractor go”, “let go of two engineers”, “which engineer should we let go”
    ofPerson(String.raw`\b[Ll]et(?:s|ting)?\s+${PERSON_OBJECT}\s+${GO_ENDS}`, 'let go'),
    ofPerson(String.raw`\b[Ll]et(?:s|ting)?\s+go\s+of\s+${PERSON_OBJECT}`, 'let go'),
    {
      re: new RegExp(String.raw`\b[Ll]et(?:s|ting)?\s+${GO_ENDS}`, 'gu'),
      also: word(`(?:${STAFF})s?|staff`),
    },
    { re: word('mak(?:e|es|ing) redundant') },
    ofPerson(String.raw`\b[Mm]ak(?:e|es|ing)\s+${PERSON_OBJECT}\s+redundant\b`, 'make redundant'),
    ofPerson(String.raw`\b[Pp]art(?:s|ed|ing)?\s+ways\s+with\s+${PERSON_OBJECT}`, 'part ways'),
    ofPerson(
      String.raw`\b[Ee]nd(?:s|ed|ing)?\s+(?:his|her|their|my|(\p{Lu}\p{Ll}+)'s)\s+(?:employment|contract|tenure|position|role|job)\b`,
      'end employment',
    ),
    {
      re: word(
        '(?:non-?renew(?:s|ed|ing|al)?|not\\s+renew(?:ing)?|(?:decline|declining|refuse|refusing)\\s+to\\s+renew)\\b[^.?!]{0,40}?\\bcontract',
      ),
      also: word(`(?:${STAFF})s?|him|her`),
      label: () => 'not renew contract',
    },
    ofPerson(
      String.raw`\b[Rr]eplac(?:e|es|ed|ing)\s+(?:him|her|(?:this|that|my|our|the|his|her)\s+(?:\p{L}+\s+){0,2}?(?:${STAFF})\b${NOT_ADJUNCT})`,
      'replace',
    ),
    {
      re: word(
        '(?:a|an|the|his|her|their|my)\\s+(?:raise|pay (?:rise|increase)|salary increase)|raises?\\s+(?:for|to)\\s+(?:him|her)',
      ),
    },
    ofPerson(
      String.raw`\b(?:[Gg]ive|[Gg]ives|gave|giving)\s+(?:the|this|that|a|an)\s+(?:\p{L}+\s+){0,2}?(?:job|position|role)\s+to\b`,
      'give the job to',
    ),
    ofPerson(
      String.raw`\b[Pp]ay(?:s|ing)?\s+${PERSON_OBJECT}\s+(?:more|less)\b`,
      'pay more or less',
    ),
    // “promote Dana to head of sales”: a name after the act is a name only where a post follows.
    ofPerson(
      String.raw`\b[Pp]romot(?:e|es|ed|ing)\s+${NAMES}(?:\s+(?:or|and)\s+${NAMES})?\s+${PROMOTED_TO}`,
      'promote to a post',
    ),
    {
      re: word('layoffs?|redundanc(?:y|ies)|downsiz(?:e|es|ed|ing)|job cuts|headcount reductions?'),
      topic: true,
    },
    { re: word('demot(?:e|es|ed|ing|ion|ions)') },
    { re: word('disciplin(?:e|es|ed|ing)|disciplinary(?: action| hearing| process| procedure)?') },
    { re: word('performance (?:reviews?|appraisals?|improvement plans?)') },
    {
      re: word(
        'severance|pay (?:rise|raise|cut)s?|salary (?:review|decision|offer|negotiation|freeze|cut)s?',
      ),
    },
    { re: word('(?:quit|leave|resign from)(?: (?:my|our|the|this|his|her))? job') },
    {
      re: word(
        "terminat(?:e|es|ed|ing|ion)(?=[^.?!]{0,50}\\b(?:employee|employment|staff|worker|position|role|job|colleague|manager|contractor|(?:his|her) contract|\\p{L}+'s contract)\\b)",
      ),
    },
    {
      re: /\b[Ff]iring\s+(?:him|her|them|this|that|my|our|his|their|one of|someone|somebody|anyone|(?:the|an?)\s+(?:\p{L}+\s+)?(?:employee|worker|staff member|team member|colleague|manager|supervisor|intern|apprentice|contractor|assistant|engineer|developer|analyst|accountant|clerk|cashier|secretary|receptionist|consultant|director|executive|nurse|teacher|driver|chef|cleaner|technician|mechanic)\b|\p{Lu}\p{Ll}+\b)/gu,
      label: () => 'firing',
    },
    { re: new RegExp(String.raw`\b[Ff]ire\b(?=\s+(?:${FIRE_OBJECT}|\p{Lu}\p{Ll}+))`, 'gu') },
    {
      re: new RegExp(
        String.raw`\b(?:should|shall|can|could|would|must|may|might|do|does|did|to|we|i|they|you)\s+(?:not\s+)?fire\b(?!\s+(?:${FIRE_NOT})\b)`,
        'giu',
      ),
    },
    {
      re: /\b(?:be|been|being|get|gets|got|getting|was|were|is|are)\b[^.?!]{0,40}?\bfired\b(?!\s+up\b)|\bfired\s+(?:for|because|from|after|without|by)\b/giu,
      label: () => 'fired',
    },
    {
      re: /\b(?:cut|cutting|reduce|reducing|freeze|freezing|raise|raising|increase|increasing)\s+(?:his|her|their|my)\s+(?:pay|salary|hours|bonus|wages)\b/giu,
    },
    {
      re: new RegExp(
        String.raw`\bpromot(?:e|es|ed|ing)\s+(?:him|her|them|(?:this|that|my|our|the|a|an|one of our)\s+(?:\p{L}+\s+)?(?:${ROLES}))\b`,
        'giu',
      ),
      label: (match) => safeQuote(match[0]),
    },
    {
      re: /\b(?:his|her|their|my)\s+promotion\b|\b(?:deny|denying|refuse|refusing|grant|granting|decide on|up for|passed over for|due for|eligible for)\s+(?:a\s+)?promotion\b/giu,
    },
    { re: /\bpromotion (?:decisions?|criteria|panel|round|board|process)\b/giu, topic: true },
    {
      re: /\b(?:ready|due|overdue|eligible|up|considered|in line|worthy|deserving)\s+for\s+(?:a\s+|the\s+)?promotion\b|\bpromotion\s+to\s+(?:the\s+)?(?:senior|head|director|manager|vp|vice|chief|lead|principal|partner)\b/giu,
    },
    {
      re: /\b(?:full|part)-time (?:offer|position|role|job)\b|\b(?:permanent|fixed-term|zero-hours) (?:contract|role|position|job)\b/giu,
    },
    {
      re: /\b(?:deserv(?:e|es|ed|ing)|merit(?:s|ed|ing)?|earn(?:s|ed|ing)?)\s+(?:a\s+|an\s+|the\s+)?(?:promotion|raise|bonus|pay rise|pay increase)\b/giu,
    },
    {
      re: word('applicants?|candidates?'),
      also: DECIDING,
      domain: (clause) => (clause.search(CREDIT_WORDS) >= 0 ? 'credit' : 'employment'),
    },
  ],
  credit: [
    { re: word('loans?|mortgages?|overdrafts?') },
    {
      re: word(
        '(?:credit|loan|mortgage|card|overdraft) applications?|applications? for (?:an? )?(?:credit|loan|mortgage|card|overdraft)',
      ),
    },
    { re: word('lend(?:s|ing)?|underwrit(?:e|es|ing)') },
    { re: word('lenders?|underwriters?|borrowers?'), topic: true },
    {
      re: word(
        'credit (?:limits?|scores?|checks?|ratings?|histor(?:y|ies)|worthiness|decisions?|approvals?|applications?|lines?|files?|reports?)|creditworth(?:y|iness)',
      ),
    },
    { re: word('credit (?:scoring|assessments?|risk|policy|policies|criteria)'), topic: true },
    { re: word('borrow(?:s|ed|ing)?|refinanc(?:e|es|ed|ing)') },
    { re: word('debt (?:collection|recovery|relief)') },
    { re: word('(?:credit|debit|store) cards? (?:applications?|limits?|approvals?|decisions?)') },
    {
      re: /\b(?:approv(?:e|es|ed|ing)|declin(?:e|es|ed|ing)|den(?:y|ies|ied|ying)|reject(?:s|ed|ing)?|grant(?:s|ed|ing)?|issu(?:e|es|ed|ing)|cancel(?:s|led|ling)?|clos(?:e|es|ed|ing)|freez(?:e|es|ing))(?:\s+or\s+(?:approv(?:e|es)|declin(?:e|es)|den(?:y|ies)|reject(?:s)?))?\s+(?:the |a |an |this |that |his |her |their |my |our )?(?:credit |debit |store )?(?:card|account|loan|mortgage|overdraft|limit|facility)\b/giu,
    },
    { re: word('interest rate (?:offers?|decisions?)') },
    {
      re: word(
        '(?:extend|extends|extended|extending|deny|denies|denied|denying|withdraw|withdrawing|refuse|refusing)\\s+(?:\\p{L}+\\s+)?credit',
      ),
      label: (match) => (match[0].split(/\s+/u)[0] ?? 'credit').toLowerCase() + ' credit',
    },
  ],
  legal: [
    { re: word('lawsuits?|litigat(?:e|es|ed|ing)') },
    { re: word('press(?:es|ed|ing)? charges|out[- ]of[- ]court') },
    {
      re: word(
        'report(?:s|ed|ing)?\\s+(?:him|her|them|this \\p{L}+|that \\p{L}+)\\s+to\\s+(?:the\\s+)?(?:police|authorities|regulator|prosecutors?)',
      ),
      label: () => 'report to the police',
    },
    { re: word('litigation|liabilit(?:y|ies)'), topic: true },
    { re: /\bsu(?:e|es|ed|ing)\b/gu },
    {
      re: word(
        'legal (?:advice|action|cases?|disputes?|proceedings?|claims?|liability|rights?|counsel|opinion|strategy|risk|status|aid|fees?|representation|guardian|guardianship)',
      ),
    },
    {
      re: word(
        'contract (?:disputes?|breach|termination)|breach(?:es|ed)? of (?:the |a |his |her |their )?(?:contract|agreement|duty|terms)',
      ),
    },
    { re: word('defendants?|plaintiffs?|claimants?|appellants?|courts?'), topic: true },
    {
      re: word(
        'court (?:cases?|rulings?|orders?|dates?|hearings?|judg(?:e)?ments?|decisions?|appearances?)',
      ),
    },
    { re: word('convict(?:s|ed|ion|ions|ing)?') },
    { re: word('sentenc(?:ed|ing)|(?:prison|jail|custodial|life|suspended) sentences?') },
    { re: word('bail|parole|custody|divorce|injunctions?|restraining orders?') },
    {
      re: word('probation'),
      domain: (clause) =>
        /\b(?:employees?|staff|workers?|new (?:starters?|hires?|joiners?)|starters?|hires?|recruits?|apprentices?|interns?|trainees?|contractors?|probationary|new employees?)\b/iu.test(
          clause,
        )
          ? 'employment'
          : 'legal',
    },
    { re: word('evict(?:s|ed|ion|ions|ing)?|deport(?:s|ed|ation|ations|ing)?') },
    {
      re: word(
        '(?:cancel(?:s|led|ling)?|revok(?:e|es|ed|ing)|refus(?:e|es|ed|ing)|den(?:y|ies|ied|ying)|grant(?:s|ed|ing)?|approv(?:e|es|ed|ing))\\s+(?:his|her|their|my|the|a|this|that)\\s+visa',
      ),
    },
    {
      re: word(
        'immigration (?:status|cases?|appeals?|hearings?|decisions?)|asylum|visa (?:applications?|refusals?|denials?|decisions?|status)',
      ),
    },
    { re: word('arrest(?:s|ed|ing)?|prosecut(?:e|es|ed|ing|ion|or|ors)') },
    { re: word('plead(?:s|ed|ing)? (?:not )?guilty') },
    {
      re: word(
        'settl(?:e|es|ed|ing) (?:the |a |this |that |his |her |their |our |my )?(?:case|claim|suit|lawsuit|dispute)',
      ),
    },
    {
      re: word(
        'appeal(?:s|ed|ing)? (?:the |a |this |that |his |her |their |my )?(?:verdict|ruling|decision|conviction|sentence)',
      ),
    },
    { re: word('power of attorney|statut(?:e|es|ory)|legally') },
    { re: word('copyright infringement|patent infringement') },
  ],
  medical: [
    { re: word('diagnos(?:e|es|ed|ing|is)') },
    { re: word('treatments?') },
    {
      re: /\btreat(?:s|ed|ing)?\s+(?:him|her|them|(?:this|that|the|a|an|his|her|their|my|our|these|those)\s+(?:\p{L}+\s+){0,2}?(?:patients?|conditions?|illness(?:es)?|diseases?|infections?|injur(?:y|ies)|symptoms?|cancer|diabetes|pain))\b/giu,
      label: () => 'treat',
    },
    { re: word('prescrib(?:e|es|ed|ing)|prescriptions?|dos(?:e|es|age|ages)') },
    { re: /\b\d+(?:\.\d+)?\s?(?:mg|mcg|µg|ml|iu)\b/giu },
    {
      re: word(
        'medications?|medicines?|drug (?:dose|doses|interactions?|therapy)|antibiotics?|antidepressants?|antipsychotics?|painkillers?|opioids?|insulin|steroids?|statins?|sedatives?|morphine|codeine|paracetamol|ibuprofen|aspirin|warfarin|heparin|metformin|penicillin|amoxicillin|lithium|sertraline|diazepam|methadone|fentanyl|oxycodone|tramadol|naloxone|adrenaline|epinephrine|anaesthetics?|anesthetics?',
      ),
    },
    {
      re: word(
        'patients?|clinical|clinicians?|hospitals?|triage|emergency (?:department|room|care)',
      ),
      topic: true,
    },
    { re: word('symptoms?|surg(?:ery|eries|ical|eon|eons)|therap(?:y|ies|ist|ists)') },
    {
      re: word(
        'amputat(?:e|es|ed|ing|ion)|intubat(?:e|es|ed|ing|ion)|transfus(?:e|es|ed|ing|ion)|tracheostomy|colonoscopy|endoscopy|mammogram|defibrillat(?:e|es|ed|ing|ion)|organ donor|transplant(?:s|ed|ing|ation)?|dialysis|biops(?:y|ies)|feeding tubes?|life support|ventilators?',
      ),
    },
    { re: word('hospitali[sz](?:e|es|ed|ing|ation|ations)') },
    {
      re: word(
        'medical (?:advice|decisions?|treatment|diagnosis|condition|history|records?|necessity|opinion|emergency|care)|health (?:condition|diagnosis|emergency|crisis)|mental health (?:crisis|assessment|diagnosis)',
      ),
    },
    {
      re: word(
        'suicid(?:e|al)|self-harm|overdos(?:e|es|ed)|pregnan(?:t|cy)|vaccin(?:e|es|ate|ated|ation|ations)|cancer|diabetes|chemotherapy|radiotherapy',
      ),
    },
  ],
  safety: [
    { re: word('safety[- ]critical|life[- ]threatening|life[- ]and[- ]death') },
    {
      re: word(
        'injur(?:y|ies|ed|e)|fatal(?:ity|ities|ly)?|unsafe|dangerous|accidents?|near[- ]miss(?:es)?',
      ),
    },
    { re: word('hazard(?:s|ous)?|evacuations?'), topic: true },
    { re: word('evacuat(?:e|es|ed|ing)') },
    { re: new RegExp(String.raw`\bsafe to (?!(?:${SAFE_TO_NOT})\b)\p{L}+`, 'giu') },
    { re: /\bsafe for (?:him|her|them|this|that|the|a|my|our)\b/giu },
    {
      re: word(
        '(?:fit|cleared?|certified|authori[sz]ed) (?:for duty|to (?:fly|drive|work|operate|enter|return|practi[sc]e|continue|serve|teach|stand trial))',
      ),
    },
    {
      re: new RegExp(
        String.raw`\bclear(?:s|ed|ing)?\s+(?:him|her|them|(?:this|that|the|our|my)\s+(?:\p{L}+\s+)?(?:${ROLES}))\s+to\s+(?:fly|drive|work|operate|enter|return|practi[sc]e)\b`,
        'giu',
      ),
      label: (match) => safeQuote(match[0]),
    },
    {
      re: word(
        '(?:emergency|safety) (?:shutdowns?|stops?|procedures?|response|evacuations?|overrides?)',
      ),
    },
    {
      re: word(
        'structural (?:failure|collapse|integrity|safety)|risk of (?:death|injury|harm|serious harm)',
      ),
    },
    {
      re: word(
        '(?:ground|grounding|grounded) (?:the |a |this |that |our |his |her )?(?:flights?|aircraft|plane|pilot|fleet)',
      ),
    },
    { re: word('safeguarding|child (?:protection|safety|abuse|neglect)') },
  ],
};

export const DOMAIN_ORDER = HIGH_STAKES_DOMAINS;

/** What follows a cue when it names a policy, a process or a market and not an act on a person. */
export const POLICY_AFTER = new RegExp(
  String.raw`^\s+(?:policy|policies|process|processes|procedure|procedures|criteria|criterion|programmes?|programs?|schemes?|rules?|frameworks?|guidelines?|standards?|protocols?|practices?|systems?|platforms?|markets?|rates?|strateg(?:y|ies)|approach(?:es)?|models?|regimes?|laws?|regulations?|reforms?|requirements?|thresholds?|caps?|quotas?|budgets?|costs?|industry|sector|pipelines?|workflows?|training|culture|campaigns?|launch(?:es)?|devices?|products?|services?|apps?|tools?|software|algorithms?|dashboards?|screening|scoring|automation|transparency|disclosures?|rollouts?|initiatives?|plans?|drives?|freezes?|targets?|data|statistics|trends?|levels?|numbers?|volumes?|outcomes?|pathways?|capacity|waiting)\b`,
  'iu',
);
/** What can come before a cue to say that the clause is about a rule and not about a person. */
export const POLICY_BEFORE =
  /\b(?:policy|policies|process|processes|procedure|procedures|criteria|rules?|framework|guidelines?|standards?|protocols?|practices?|approach|strategy|programme|program|scheme|changes?|reform|reforms)\s+(?:on|for|around|about|to|of|regarding|governing|surrounding|in)\s+(?:the\s+|our\s+|its\s+|their\s+)?$/iu;
