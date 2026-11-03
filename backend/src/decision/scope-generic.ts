import { type HighStakesDomain } from '../../../shared/decision.js';
import {
  ALL_VERBS,
  MODIFIERS,
  NOT_ADJUNCT,
  NOT_NAMES,
  POLICY_AFTER,
  POLICY_BEFORE,
  ROLES,
  roleDomain,
  safeQuote,
} from './scope-cues.js';
import { GIVEN_NAMES } from './scope-names.js';

/**
 * A person read where they stand and not by the verb that is done to them, for the questions that put a person and a
 * matter of a domain together in a way that no construction of `scope-people.ts` has: “ask Olga to step down”, “is she fit
 * to go back to work after surgery”, “which intern do we keep on”, “who should we make redundant”. Two things are read, and
 * each is only what its words say.
 *
 *  - A person: a pronoun (he, she, him, his, her), a name (a capitalised word that is not a title, a place or an
 *    organisation, put where a person is put and not where a subject or a place is), a role said of one (“the nurse”,
 *    “our oldest developer”, “an employee who”), or the person that a question asks about (“who should we …”).
 *  - A matter that is a person’s when a person is in the clause: a notice, a biopsy, a settlement, an interest rate, and the
 *    phrasal verbs of a domain (“make … redundant”, “take … off the ventilator”, “put … on notice”) with the person
 *    between the words, after them, or put first. These are everyday words in other uses (“notice”, “operation”,
 *    “write off”), so they count only beside a person, and never when a policy or a process follows them.
 *
 * Both are rules about words. They are generous on purpose: wrongly reading a person only makes the canvas more
 * careful, and wrongly not reading one makes it sound as if it recommended a person. What a cue says of what it found
 * never holds a name: a label is made of the words of the act, and a person is said as “a named person” or as a role.
 */

export interface GenericPeople {
  /** What the basis says of each person found: never a name. */
  cues: string[];
  /** A role that is a matter of a domain by itself, with the noun. */
  roles: { domain: HighStakesDomain; noun: string }[];
}

const NAMED = 'a named person';

/** What a person does or feels as a stakeholder: the person is then the one who acts, and nothing is done to them. */
const STAKEHOLDER_VERBS =
  'react(?:s|ed|ing)?|respond(?:s|ed|ing)?|feel(?:s|ing)?|felt|think(?:s|ing)?|thought|say|says|said|view(?:s|ed|ing)?|perceiv(?:e|es|ed|ing)|see(?:s|ing)?|saw|like(?:s|d)?|dislike(?:s|d)?|welcom(?:e|es|ed|ing)|support(?:s|ed|ing)?|oppos(?:e|es|ed|ing)|use(?:s|d)?|using|buy(?:s|ing)?|bought|spend(?:s|ing)?|spent|stay(?:s|ed|ing)?|switch(?:es|ed|ing)?|churn(?:s|ed|ing)?|behav(?:e|es|ed|ing)|engag(?:e|es|ed|ing)|perform(?:s|ed|ing)?|benefit(?:s|ed|ing)?|experienc(?:e|es|ed|ing)|notic(?:e|es|ed|ing)|trust(?:s|ed|ing)?|prefer(?:s|red|ring)?|expect(?:s|ed|ing)?|complain(?:s|ed|ing)?|visit(?:s|ed|ing)?|read(?:s|ing)?|click(?:s|ed|ing)?|subscrib(?:e|es|ed|ing)|adopt(?:s|ed|ing)?|learn(?:s|ed|ing)?|understand(?:s|ing)?|participat(?:e|es|ed|ing)|attend(?:s|ed|ing)?|call(?:s|ed|ing)?|contact(?:s|ed|ing)?|search(?:es|ed|ing)?|browse(?:s|d)?|book(?:s|ed|ing)?|order(?:s|ed|ing)?|download(?:s|ed|ing)?|speak(?:s|ing)?|spoke|talk(?:s|ed|ing)?|launch(?:es|ed|ing)?|announc(?:e|es|ed|ing)|introduc(?:e|es|ed|ing)|chang(?:e|es|ed|ing)|hir(?:e|es|ed|ing)|run(?:s|ning)?|manag(?:e|es|ed|ing)|work(?:s|ed|ing)? with|lead(?:s|ing)? the';
const WHAT_PERSON_DOES = new RegExp(String.raw`^\s+(?:${ALL_VERBS}|${STAKEHOLDER_VERBS})\b`, 'iu');
/** A word that stands before a subject, a modifier or a conjunct, and so not before a person the act is done to. */
const BEFORE_SUBJECT: ReadonlySet<string> = new Set(
  'should would could can may might must shall will do does did is are was were am has have had be been if whether that because as than how what why when where who which while once until so and or but not also only just still even ever never both either neither all any each every some no then there here now after before since although though unless whereas'.split(
    ' ',
  ),
);
const DETERMINERS: ReadonlySet<string> = new Set(
  'the a an this that these those our my your their its'.split(' '),
);
/** Verbs that let, make or keep a person do something: the person is then the one a decision is made about. */
const CAUSATIVE: ReadonlySet<string> = new Set(
  'let lets letting allow allows allowing permit permits permitting make makes making have has having help helps helping get gets getting require requires requiring ask asks asking tell tells telling want wants wanting need needs needing force forces forcing stop stops stopping prevent prevents preventing ban bans banning forbid forbids forbidding authorise authorize authorises authorizes clear clears clearing certify certifies enable enables bar bars barring'.split(
    ' ',
  ),
);
/** What a person is said to do or to be when a decision about them is asked and they stand after “should”. */
const PERSON_PREDICATES = new RegExp(
  String.raw`^(?:get|gets|receive|receives|deserve|deserves|qualify|qualifies|be|become|keep|stay|remain|lose|face|apply|return|resume|continue|undergo|need|needs|have|take|go|ready|eligible|fit|safe|safely|entitled|allowed|permitted|able|cleared)\b`,
  'iu',
);
/** A word that stands before a place and not before a person. */
const BEFORE_PLACE: ReadonlySet<string> = new Set(
  'in at from near across within throughout around inside outside via through into onto toward towards during by of per than like'.split(
    ' ',
  ),
);
const HONORIFICS = /^(?:Mr|Mrs|Ms|Miss|Mx|Dr|Prof|Professor|Sir|Dame|Judge)$/u;
const TITLE_WORD = new RegExp(String.raw`^(?:${ROLES})$`, 'iu');

const isCapitalised = (token: string): boolean => /^\p{Lu}\p{Ll}+(?:[-']\p{L}+)*$/u.test(token);
const bare = (token: string): string => token.replace(/^[("'“]+|[)"'”.,;:?!]+$/gu, '');
const lowerWord = (token: string | undefined): string =>
  (token ?? '').toLowerCase().replace(/[^\p{L}'-]/gu, '');

/** Whether a capitalised word can be a person: put where an act is done to one, and not a subject, a place, or a thing. */
function nameAt(words: readonly string[], at: number): boolean {
  const word = bare(words[at] ?? '').replace(/'s$/u, '');
  if (at === 0 || !isCapitalised(word)) return false;
  const lower = word.toLowerCase();
  if (NOT_NAMES.has(lower) || TITLE_WORD.test(lower)) return false;
  const next = bare(words[at + 1] ?? '');
  if (isCapitalised(next) && NOT_NAMES.has(next.toLowerCase())) return false;
  const previous = bare(words[at - 1] ?? '');
  if (HONORIFICS.test(previous)) return true;
  // After a capitalised word: “Mia Chen” is a name once, and “Google Workspace” is no one. A question word that opens the clause is capitalised too.
  if (!/^\p{Ll}/u.test(previous) && !(at === 1 && NOT_NAMES.has(previous.toLowerCase()))) {
    return false;
  }
  const before = previous.toLowerCase();
  if (BEFORE_PLACE.has(before) || DETERMINERS.has(before)) return false;
  if (BEFORE_SUBJECT.has(before)) {
    // “hire Ananya or Rohit”: the second name of two. “Should Priya get …”: a known name, or one said to be given a matter.
    if (before === 'or' || before === 'and') return isCapitalised(bare(words[at - 2] ?? ''));
    return GIVEN_NAMES.has(lower) || PERSON_PREDICATES.test(bare(words[at + 1] ?? ''));
  }
  return true;
}

/** Roles that are as much a product persona as a person: not read where the role stands alone beside a matter. */
const PERSONA = /^(?:user|player|passenger|citizen|individual)$/iu;

const ROLE_PHRASE = new RegExp(
  String.raw`\b(?<det>the|this|that|my|our|his|her|your)\s+${MODIFIERS}(?<noun>${ROLES})\b${NOT_ADJUNCT}`,
  'giud',
);
const RELATIVE = new RegExp(
  String.raw`\b(?:(?:an?|any|one)\s+${MODIFIERS}(?:${ROLES})|someone|somebody|anyone|anybody)\s+who\b`,
  'giu',
);
/** A punitive act on someone said in the indefinite is still about a person: “fire an employee with a health condition”. */
const INDEFINITE_TARGET = new RegExp(
  String.raw`\b(?:fir(?:e|es|ed|ing)|dismiss(?:es|ed|ing)?|sack(?:s|ed|ing)?|lay(?:s|ing)? off|laid off|let(?:s|ting)? go|terminat(?:e|es|ed|ing)|demot(?:e|es|ed|ing)|disciplin(?:e|es|ed|ing)|suspend(?:s|ed|ing)?|evict(?:s|ed|ing)?|deport(?:s|ed|ing)?|arrest(?:s|ed|ing)?|prosecut(?:e|es|ed|ing)|reprimand(?:s|ed|ing)?|expel(?:s|led|ling)?|mak(?:e|es|ing) redundant|made redundant)\s+(?:an?|any|one)\s+${MODIFIERS}(?:${ROLES})\b(?!')${NOT_ADJUNCT}`,
  'giu',
);
/** A question about how to go about something, or about a process: what it says of “an employee” is any employee. */
const PROCESS_QUESTION =
  /\bhow\b|\b(?:approach|process|procedures?|polic(?:y|ies)|steps|guidance|guidelines|checklist|best practice|handbook|template|training)\b/iu;
const PRONOUN = /\b(?:he|she|him|his|her|hers|himself|herself)\b/giu;
/** The person a question asks about: “who should we make redundant”, “which one do we keep on”, “who should be promoted”. */
const WHO = new RegExp(
  String.raw`\b(?:who|whom)\s+(?:(?:should|shall|must|can|could|would|will|do|did|ought)\s+(?:we|i|they|you)|(?:should|must|can|could|would|will|shall)\s+be)\b|\bwhich\s+(?:one|of\s+(?:them|those|these))\s+(?:should|shall|must|can|could|would|will|do|did)\b`,
  'giu',
);
const HOUSEHOLD = new RegExp(
  String.raw`\b(?:evict|sue|foreclose on|deport|arrest|reject|deny|approve|refuse|decline|lend to|settle with|report|admit|treat|discharge|hire|fire|dismiss|promote|help|repossess|seize|garnish)\s+the\s+(\p{L}{3,}s)(?:'|\b)`,
  'giu',
);
/** The asker’s own matter, said with “we” or “I”: “do we file for divorce”, “should I contest my father’s will”. */
const OWN_ACT = new RegExp(
  String.raw`\b(?:(?:fil(?:e|es|ed|ing) for|seek(?:s|ing)?|sought|appl(?:y|ies|ied|ying) for|go(?:es|ing)? for|accept(?:s|ed|ing)?|sign(?:s|ed|ing)?|reject(?:s|ed|ing)?)\s+(?:(?:a|an|the|his|her|their|my|our)\s+)?(?:divorce|custody|asylum|probate|restraining order|plea (?:deal|bargain)|parole|bail|annulment)|(?:contest(?:s|ed|ing)?|challeng(?:e|es|ed|ing)|draft(?:s|ed|ing)?|revok(?:e|es|ed|ing)|sign(?:s|ed|ing)?)\s+(?:(?:a|an|the|his|her|their|my|our)\s+)?(?:\p{L}+(?:'s)?\s+){0,2}?will|(?:start(?:s|ed|ing)?|begin(?:s|ning)?|began|commenc(?:e|es|ed|ing)|launch(?:es|ed|ing)?|bring(?:s|ing)?|fil(?:e|es|ed|ing)|issu(?:e|es|ed|ing)|serv(?:e|es|ed|ing)|pursu(?:e|es|ed|ing))\s+(?:(?:an?|the|his|her|their|my|our)\s+)?(?:eviction|repossession|foreclosure|deportation|custody|divorce)\s+(?:proceedings?|action|process|papers|notice|order))\b`,
  'iu',
);
const FIRST_PERSON = /\b(?:we|i)\b/iu;

/** The people a clause speaks of, as the basis says them. */
export function genericPeople(clause: string): GenericPeople {
  const found: GenericPeople = { cues: [], roles: [] };

  for (const match of clause.matchAll(PRONOUN)) {
    const after = clause.slice((match.index ?? 0) + match[0].length);
    const subject = /^(?:he|she)$/iu.test(match[0]);
    if (subject && WHAT_PERSON_DOES.test(after)) continue;
    found.cues.push(`“${match[0].toLowerCase()}”`);
  }

  const words = clause.split(' ');
  for (let at = 0; at < words.length; at += 1) {
    if (nameAt(words, at)) found.cues.push(NAMED);
  }

  for (const match of clause.matchAll(ROLE_PHRASE)) {
    const noun = (match.groups?.noun ?? '').toLowerCase();
    const after = clause.slice(match.indices?.[0]?.[1] ?? 0);
    if (/^'s\b/iu.test(after)) continue;
    const domain = roleDomain(noun);
    if (PERSONA.test(noun) && !domain) continue;
    const before = lowerWord(
      clause
        .slice(0, match.index ?? 0)
        .trimEnd()
        .split(' ')
        .pop(),
    );
    // “let the apprentice use the lathe”: the person is allowed to act, and the decision is about them.
    if (WHAT_PERSON_DOES.test(after) && !CAUSATIVE.has(before)) continue;
    if ((match.groups?.det ?? '').toLowerCase() === 'the') {
      if (BEFORE_SUBJECT.has(before) && !domain) continue;
    }
    found.cues.push(`“${safeQuote(match[0])}”`);
    if (domain) found.roles.push({ domain, noun });
  }

  for (const match of clause.matchAll(RELATIVE)) found.cues.push(`“${safeQuote(match[0])}”`);
  // “How should a manager approach dismissing an employee” asks about a process, and is not about one person.
  if (!PROCESS_QUESTION.test(clause)) {
    for (const match of clause.matchAll(INDEFINITE_TARGET)) {
      found.cues.push(`“${safeQuote(match[0])}”`);
    }
  }
  for (const match of clause.matchAll(WHO)) found.cues.push(`“${match[0].toLowerCase()}”`);
  for (const match of clause.matchAll(HOUSEHOLD)) {
    const surname = match[1] ?? '';
    if (/^\p{Lu}/u.test(surname) && !NOT_NAMES.has(surname.toLowerCase())) found.cues.push(NAMED);
  }
  if (FIRST_PERSON.test(clause) && OWN_ACT.test(clause)) found.cues.push('a personal matter');
  return found;
}

// ---------------------------------------------------------------------------------------------
// Matters that are a person’s when a person is in the clause
// ---------------------------------------------------------------------------------------------

export interface PairedMatter {
  domain: HighStakesDomain;
  cue: string;
  aside: boolean;
}

interface Pair {
  domain: HighStakesDomain | ((clause: string) => HighStakesDomain);
  re: RegExp;
  /** What the basis says; by default the words that matched, which hold no person. */
  label?: (match: RegExpMatchArray) => string;
}

const w = (source: string): RegExp => new RegExp(String.raw`\b(?:${source})\b`, 'giu');
/** Up to four words between the two words of a phrasal verb: the person, when they stand between them. */
const GAP = String.raw`(?:\s+\S+){0,4}?`;
/** The two words of the construction, without what stands between them: “make redundant”, “put on notice”. */
const parts = (match: RegExpMatchArray): string =>
  [match.groups?.a, match.groups?.b]
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .join(' ')
    .toLowerCase();

/** A phrasal verb: the verb, then what it takes with it, with the person between the two or after them or put first. */
const phrasal = (
  domain: Pair['domain'],
  verb: string,
  rest: string,
  after = String.raw`\b`,
): Pair => ({
  domain,
  re: new RegExp(String.raw`\b(?<a>${verb})${GAP}\s+(?<b>${rest})${after}`, 'giu'),
  label: parts,
});

const CREDIT_CONTEXT =
  /\b(?:loans?|mortgages?|credit|overdrafts?|borrow\w*|lend\w*|applications?|debts?)\b/iu;
const SAFETY_CONTEXT =
  /\b(?:competent|fit|safe|safely|certified|qualified|cleared|licen[cs]ed?|operate|drive|fly|pilot|driver|operator|crane|forklift)\b/iu;
const POSSESSIVE = String.raw`(?:the |his |her |their |this |that |our |my )?`;

const PAIRED: readonly Pair[] = [
  {
    domain: 'employment',
    re: w(
      String.raw`(?:her|his|their|my)\s+notice|(?:written|formal)\s+notice|(?:give|gave|giving|serve|served|serving|hand(?:ed|ing)? in)\s+notice(?!\s+to\s+(?:our|the|my|his|her|their)\s+(?:\p{L}+\s+)?(?:landlord|landlady|tenant|lodger|subtenant|supplier|vendor|bank|council|school|customer|client))|notice period|severance|part-time|full-time|(?:un)?paid leave|(?:the\s+)?(?:right|best|wrong|ideal|perfect|best-qualified)\s+(?:person|candidate|fit|hire)\s+for\s+(?:the|this|that|our)\s+(?:job|role|position|post)|suspend(?:s|ed|ing)?|suspension|(?:a|an|the|another|second|final|first|follow-up)\s+interview|(?:a\s+)?second chance|another chance|one more chance|final chance|sick leave|(?:maternity|paternity|parental|compassionate|annual|medical|garden) leave|sabbatical|leave of absence|counter-?offers?|secondments?|relocat(?:e|es|ed|ing|ion)|step(?:s|ped|ping)? (?:down|aside)|stand(?:s|ing)? down|resign(?:s|ed|ing|ation)?|retir(?:e|es|ed|ing|ement)|pay (?:rise|raise|cut|increase|freeze)|(?:a|the|his|her|their|my)\s+raise|bonus(?:es)?|salary|salaries|wages?|overtime|grievance|reinstat(?:e|es|ed|ing)|reappoint(?:s|ed|ing)?|appoint(?:s|ed|ing)?|(?:director|manager|senior|lead|head|vice|chair)\s+(?:post|role|position|seat)|(?:the|a|this|that|his|her|their)\s+(?:post|vacancy|opening|secondment)|(?:her|his|their|my|the|a)\s+appointment\s+(?:as|to)|job offers?|terminat(?:e|es|ed|ing|ion)|reprimand(?:s|ed|ing)?|(?:written|verbal|final|formal|first|second) warning|probation(?:ary)?|promotion (?:to|round|panel)|(?:overdue|due|eligible|ready|up|considered|passed over) for (?:a )?promotion|(?:his|her|their|my) promotion|(?:be|been|being|get|gets|got|getting)\s+(?:promoted|appointed|reinstated|suspended|disciplined|reprimanded|transferred|relocated)|demot(?:e|es|ed|ing|ion)|shortlist(?:s|ed|ing)?`,
    ),
  },
  {
    domain: 'employment',
    re: new RegExp(
      String.raw`\b(?<a>forward) for (?:the |a |an )?(?:\p{L}+ ){0,2}(?<b>post|role|position|job|promotion|seat|vacancy|nomination|election)\b`,
      'giu',
    ),
    label: (match) => `put forward for a ${match.groups?.b ?? 'post'}`.toLowerCase(),
  },
  phrasal(
    'employment',
    'pass(?:es|ed|ing)? over',
    String.raw`for (?:a |the )?(?:promotion|role|job|post|position)`,
  ),
  phrasal(
    'employment',
    'ask(?:s|ed|ing)?',
    String.raw`to (?:resign|retire|step down|leave (?:the |our |this )?(?:company|firm|business|practice|team|organi[sz]ation|school|department))`,
  ),
  {
    domain: 'employment',
    re: new RegExp(
      String.raw`\b(?<a>remov(?:e|es|ed|ing)|oust(?:s|ed|ing)?|unseat(?:s|ed|ing)?)\s+(?:the|our|my|his|her|their|this|that)\s+(?:\p{L}+\s+){0,2}(?<b>chair\w*|ceo|cfo|cto|coo|director|president|principal|manager|head|leader|founder|supervisor|executive)\b`,
      'giu',
    ),
    label: parts,
  },
  {
    domain: 'employment',
    re: new RegExp(
      String.raw`\b(?<a>keep(?:s|ing)?)${GAP}\s+(?<b>on)(?= *$| *[,.;:?!)"]| (?:after|beyond|until|for|past|permanently|full-time|part-time|as|next|when|once|following)\b)`,
      'giu',
    ),
    label: parts,
  },
  phrasal('employment', 'mak(?:e|es|ing)|made', 'redundant'),
  {
    domain: 'legal',
    re: new RegExp(
      String.raw`\b(?<a>give|gave|giving|serve|served|serving|issue|issued|issuing)\s+(?:\p{L}+\s+){0,1}notice\s+to\s+(?:the|our|my|his|her)\s+(?:\p{L}+\s+)?(?<b>tenant|lodger|subtenant)\b`,
      'giu',
    ),
    label: (match) =>
      `${match.groups?.a ?? 'give'} notice to a ${match.groups?.b ?? 'tenant'}`.toLowerCase(),
  },
  {
    domain: (clause) =>
      /\b(?:colleagues?|managers?|employees?|bosses|boss|co-?workers?|staff|supervisors?|team members?|workers?)\b/iu.test(
        clause,
      )
        ? 'employment'
        : 'legal',
    re: new RegExp(
      String.raw`\b(?<a>report(?:s|ed|ing)?)${GAP}\s+(?<b>for (?:stealing|theft|fraud|harassment|misconduct|bullying|discrimination|cheating|corruption|bribery|embezzlement|assault|abuse))\b`,
      'giu',
    ),
    label: parts,
  },
  {
    domain: 'employment',
    re: new RegExp(
      String.raw`\b(?<a>let(?:s|ting)?)${GAP}\s+(?<b>go)(?=\s*(?:$|[,.;:?!)"])|\s+(?:or|and|but|if|because|since|after|before|due|rather|instead|now|today|tomorrow|next|without|given|based|following|during)\b|(?:\s+of)?\s+(?:the|our|my|his|her|their|this|that|these|those|one|two|three|four|five|an?)\b)`,
      'giu',
    ),
    label: parts,
  },
  {
    // “let go Tom Becker”: a name after the words, read with capitals.
    domain: 'employment',
    re: /\b(?<a>[Ll]et(?:s|ting)?)(?:\s+\S+){0,4}?\s+(?<b>go)(?:\s+of)?\s+(?=\p{Lu}\p{Ll})/gu,
    label: parts,
  },
  phrasal('employment', 'lay(?:s|ing)?|laid', 'off'),
  phrasal(
    'employment',
    'transfer(?:s|red|ring)?|mov(?:e|es|ed|ing)|reassign(?:s|ed|ing)?|redeploy(?:s|ed|ing)?',
    String.raw`to (?:the |a |our |his |her )?(?:\p{L}+ ){0,2}(?:office|branch|team|department|site|store|division|unit|shift|night shift|part-time|full-time|zero-hours)`,
  ),
  phrasal('employment', 'rank(?:s|ed|ing)?', '(?:below|above|lower|higher)'),
  phrasal(
    'employment',
    'remov(?:e|es|ed|ing)|appoint(?:s|ed|ing)?|replac(?:e|es|ed|ing)',
    String.raw`as (?:a |the |his |her |their |our )?(?:director|chair|manager|head|ceo|cfo|cto|coo|lead|supervisor|president|principal|officer|partner)`,
  ),
  phrasal(
    'employment',
    'tak(?:e|es|ing)|took|taken',
    String.raw`off ${POSSESSIVE}(?:\p{L}+ ){0,2}(?:project|rota|rotas|shifts?|payroll|team|account|case|roster|schedule|duty|duties|list|register)`,
  ),
  phrasal(
    'employment',
    'put(?:s|ting)?',
    String.raw`on (?:a |an |the )?(?:notice|probation|garden leave|leave|suspension|(?:final |formal |written |verbal )?warning|(?:performance |improvement )?plan|pip|restricted duties|light duties|short-time|(?:night|day|late|early|weekend|split) shifts?|nights|the rota|a rota)`,
  ),
  phrasal(
    (clause) => (SAFETY_CONTEXT.test(clause) ? 'safety' : 'employment'),
    'sign(?:s|ed|ing)?',
    'off',
  ),
  phrasal(
    (clause) => (CREDIT_CONTEXT.test(clause) ? 'credit' : 'employment'),
    'turn(?:s|ed|ing)?',
    'down',
  ),
  phrasal(
    (clause) => (SAFETY_CONTEXT.test(clause) ? 'safety' : 'employment'),
    'stand(?:s|ing)?|stood',
    'down',
  ),
  {
    domain: 'credit',
    re: w(
      String.raw`interest rates?|payment holidays?|repayments?|instal?lments?|collateral|guarantors?|arrears|foreclos(?:e|es|ed|ing|ure)|repossess(?:es|ed|ing|ion)?|write(?:s)?[- ]off|written off|debts?|credit (?:cards?|lines?)|(?:his|her|their|my)\s+(?:credit |card |spending |overdraft )?limit|(?:credit|card|spending|overdraft) limit`,
    ),
  },
  phrasal('credit', 'writ(?:e|es|ing)|wrote|written', 'off'),
  phrasal(
    'credit',
    'call(?:s|ed|ing)?',
    String.raw`in ${POSSESSIVE}(?:\p{L}+'s )?(?:loan|debt|overdraft|mortgage)`,
  ),
  phrasal(
    'credit',
    'report(?:s|ed|ing)?',
    String.raw`to (?:the )?credit (?:bureau|bureaus|agency|agencies|reference agency)`,
  ),
  phrasal(
    'credit',
    'put(?:s|ting)?',
    String.raw`on (?:a |an |the )?(?:payment plan|repayment plan|watchlist|debt plan)`,
  ),
  {
    domain: 'legal',
    re: w(
      String.raw`settlements?|testimon(?:y|ies)|testif(?:y|ies|ied|ying)|annulment|plea (?:deal|bargain|agreement)|plead(?:s|ed|ing)? (?:guilty|not guilty|no contest)|(?:arrest|search) warrants?|probate|last will|tenanc(?:y|ies)|indict(?:s|ed|ing|ment)?|acquit(?:s|ted|ting|tal)?|verdicts?|(?:disciplinary|court|tribunal|custody|bail|parole) hearings?|(?:stand|stood|facing|face) trial|on trial|tribunals?|non-compete|nda|whistleblow(?:er|ing)?|liable|citizenship|extradit(?:e|es|ed|ing|ion)|guardianship|(?:press|pressing|drop|dropping|bring|file|criminal)\s+charges?|charged with|restraining orders?|custody|release(?:s|d)? (?:the )?suspect`,
    ),
  },
  phrasal(
    'legal',
    '(?:give|gave|giving|hand(?:ing)? over|withhold(?:ing)?|destroy(?:ing)?|submit(?:ting)?|present(?:ing)?|offer(?:ing)?)',
    'evidence',
  ),
  phrasal(
    'legal',
    '(?:contest|challenge|draft|revoke|change|read|sign|witness)',
    String.raw`(?:last\s+)?will`,
  ),
  phrasal(
    'legal',
    'hand(?:s|ed|ing)?',
    String.raw`over to (?:the )?(?:police|authorities|prosecutors?|immigration|border|court|regulator)`,
  ),
  phrasal('legal', 'tak(?:e|es|ing)|took|taken', String.raw`to (?:court|tribunal)`),
  phrasal(
    'legal',
    '(?:throw|throws|throwing|threw|kick|kicks|kicking|kicked|turf|turfs|turfing|turfed|move|moves|moving|moved|force|forces|forcing|forced)',
    String.raw`out of (?:the |his |her |their |our )?(?:flat|apartment|house|home|property|premises|building|unit|room)`,
  ),
  phrasal('legal', 'turn(?:s|ed|ing)?', 'away'),
  phrasal(
    'legal',
    'remov(?:e|es|ed|ing)|appoint(?:s|ed|ing)?|replac(?:e|es|ed|ing)',
    String.raw`as (?:a |the |his |her |their )?(?:guardian|trustee|executor|custodian|conservator)`,
  ),
  {
    domain: 'medical',
    re: w(
      String.raw`biops(?:y|ies)|(?:be|been|being|get|gets|got)\s+discharged|dialysis|transplants?|ventilators?|feeding tubes?|life support|blood thinners?|anticoagulants?|antibiotics?|physiotherapy|referral|(?:an?|the|his|her|their|my)\s+(?:ct |mri |ultrasound )?scan|mri|x-?rays?|test results?|prognosis|care plans?|wards?|icu|intensive care|sedat(?:e|es|ed|ing|ion)|ambulance|inpatients?|outpatients?|blood (?:pressure|tests?|sugar)|wounds?|fractures?|stroke|operat(?:e|es|ed|ing) on|(?:needs?|needed|requires?|for|after|before|an?|the)\s+operation|surgical|chemo(?:therapy)?|insulin`,
    ),
  },
  phrasal(
    'medical',
    'refer(?:s|red|ring)?',
    String.raw`(?:to|for) (?:a |an |the )?(?:specialist|biopsy|scan|consultant|surgeon|hospital|clinic|therapist|psychiatrist|physio\w*|counsell?or|oncolog\w*|cardiolog\w*)`,
  ),
  phrasal(
    'medical',
    'admit(?:s|ted|ting)?',
    String.raw`(?:overnight|to (?:the )?(?:ward|hospital|icu|clinic))`,
  ),
  phrasal(
    'medical',
    'tak(?:e|es|ing)|took|taken',
    String.raw`off ${POSSESSIVE}(?:ventilator|medication|medicines?|life support|drug|drip|insulin|oxygen|dialysis|antibiotics|treatment|steroids|painkillers|opioids|respirator)`,
  ),
  phrasal(
    'medical',
    'put(?:s|ting)?',
    String.raw`on (?:a |an |the )?(?:ventilator|drip|insulin|medication|oxygen|dialysis|life support|antibiotics|waiting list|diet|care plan|bed rest|steroids|painkillers|feeding tube|respirator)`,
  ),
  phrasal('medical', 'wean(?:s|ed|ing)?', 'off'),
  {
    domain: 'safety',
    re: w(
      String.raw`unsupervised|safely|ground(?:ed|ing)?(?!\s+(?:rules?|floor|breaking|work|truth|zero|level|water))|(?:an?|the)\s+(?:un)?safe\s+(?:pilot|driver|operator|surgeon|worker|employee|guard|carer|nurse|doctor|mechanic|technician)|forklifts?|cranes?|ladders?|scaffold(?:s|ing)?|lathes?|chemicals?|machinery|harness(?:es)?|hazardous|work(?:s|ing)? at height|power tools?|firearms?|explosives?|toxic|radiation|confined spaces?|drunk|under the influence|(?:after|before) (?:two |a few |some |three )?(?:beers?|drinks?|glasses? of wine)|drink-driving|sleep-deprived|exhausted|licen[cs]e|clearance|(?:safe|safely|unsafe) (?:to|for)|supervis(?:e|ion)`,
    ),
  },
  phrasal(
    'safety',
    'pull(?:s|ed|ing)?|tak(?:e|es|ing)|took|taken',
    String.raw`(?:off|out of) ${POSSESSIVE}(?:line|site|job|rota|roster|duty|flight|shift|project|ladder|roof|crane|forklift|machine|machinery|equipment|rig|ship|vessel|aircraft|plane)`,
  ),
  phrasal(
    'safety',
    'clear(?:s|ed|ing)?|certif(?:y|ies|ied|ying)|authori[sz](?:e|es|ed|ing)|approv(?:e|es|ed|ing)',
    String.raw`to (?:fly|drive|work|operate|enter|return|practi[sc]e|dive|climb|swim|ride|lift|go back|resume|continue|handle|use|travel|compete|play|teach)`,
  ),
  phrasal(
    'safety',
    'stop(?:s|ping)?|prevent(?:s|ing)?|ban(?:s|ning)?|forbid(?:s|ding)?|bar(?:s|ring)?|keep(?:s|ing)?',
    String.raw`from (?:driving|flying|operating|working|diving|climbing|swimming|cycling|riding|handling|lifting|entering)`,
  ),
  {
    domain: 'safety',
    re: new RegExp(
      String.raw`\b(?<a>let(?:s|ting)?|allow(?:s|ed|ing)?|permit(?:s|ted|ting)?)(?:\s+\S+){0,8}?\s+(?<b>alone|unsupervised|unaccompanied|on (?:his|her|their) own|by (?:him|her|them)self|at night|after dark)\b`,
      'giu',
    ),
    label: parts,
  },
];

/** The matters of a domain that a person in the clause makes the person’s: said only when a person was found. */
export function pairedMatters(clause: string): PairedMatter[] {
  const found: PairedMatter[] = [];
  for (const { domain, re, label } of PAIRED) {
    for (const match of clause.matchAll(re)) {
      const start = match.index ?? 0;
      const policy =
        POLICY_AFTER.test(clause.slice(start + match[0].length)) ||
        POLICY_BEFORE.test(clause.slice(Math.max(0, start - 40), start));
      found.push({
        domain: typeof domain === 'function' ? domain(clause) : domain,
        cue: label ? label(match) : match[0].toLowerCase(),
        aside: policy,
      });
    }
  }
  return found;
}
