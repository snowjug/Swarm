import { CUE_PATTERNS, LIMIT_WORDS, type CueFamily } from './cues.js';
import { splitClauses, type Clause } from './clauses.js';
import { UNDECIDED_CUE } from './lexicon.js';

/**
 * Whether a text states a limit as a fact or only as something wished for, feared, thought, possible or
 * denied. A cue word ("must", "at most", "cannot") makes a limit hard only if the clause around it
 * asserts it: what someone asks for ("asks the Council to guarantee at least six"), what a party says it
 * feels or fears ("families say they cannot always arrive"), what may or might be needed ("may need to
 * know"), what is only supposed or conditional ("assumed it applied only to", "if it cannot resolve"),
 * what a sentence says is not required ("not mandatory") and what only warns the reader how to read
 * ("must not be assumed") are not limits that hold. Pure: the same text reads the same.
 */

export interface Cue {
  /** The words as written. */
  text: string;
  /** The words to show a person: the whole match, or its first and last words when it spans many. */
  shown: string;
  family: CueFamily;
  modal: boolean;
  negative: boolean;
  /** Whether it can state a limit with no other word that names what is limited. */
  standalone: boolean;
  index: number;
}

/** Why words that look like a limit are not read as one. */
export type Cancellation =
  /** Someone asks for, proposes, hopes, fears, feels or supposes it: a wish or a view is not a rule. */
  | 'asked-for'
  /** It is said to be possible, usual or conditional on something else: a limit that may or may not hold. */
  | 'hedged'
  /** The clause says there is no such limit ("not required", "need not"). */
  | 'negated'
  /** The words warn how to read, or say what is not known ("must not be assumed", "cannot say"). */
  | 'interpretive';

export interface HardnessReading {
  hard: boolean;
  /** The first words that make it hard, as written. */
  cue: Cue | null;
  /** The first words that would have made it hard, and what takes them back; null when none did. */
  cancelled: { cue: Cue; why: Cancellation } | null;
}

const lastOf = (pattern: RegExp, text: string): RegExpMatchArray | null => {
  let last: RegExpMatchArray | null = null;
  for (const found of text.matchAll(pattern)) last = found;
  return last;
};

/** What someone wants, asks, proposes, fears or supposes: what follows is theirs, not a rule. */
const FRAMING_WORDS = String.raw`(?<![\p{L}\p{N}])(?:ask(?:s|ed|ing)?|request(?:s|ed|ing)?|want(?:s|ed|ing)?|wish(?:es|ed)?|would\s+like|would\s+be\s+(?:good|nice|better|helpful|useful|ideal|preferable|welcome)|it\s+would\s+help|nice\s+to\s+have|urg(?:e|es|ed|ing)|call(?:s|ed|ing)?\s+(?:for|on|upon)|propos(?:e|es|ed|ing)|suggest(?:s|ed|ing)?|recommend(?:s|ed|ing)?|advis(?:e|es|ed|ing)|hop(?:e|es|ed|ing)|hopefully|demand(?:s|ed|ing)?|insist(?:s|ed|ing)?|lobb(?:y|ies|ied|ying)|campaign(?:s|ed|ing)?\s+for|worr(?:y|ies|ied|ying)|fear(?:s|ed|ing)?|would\s+rather|prefer(?:s|red)?|preferably|ideally|aim(?:s|ed|ing)?\s+to|intend(?:s|ed|ing)?|plan(?:s|ned|ning)?\s+to|assum(?:e|es|ed|ing)|believ(?:e|es|ed|ing)|thought|think(?:s|ing)?|suppos(?:e|es|ed|ing)|guess(?:es|ed)?|suspect(?:s|ed)?|reckon(?:s|ed)?|imagin(?:e|es|ed)|presum(?:e|es|ed)|feel(?:s|ing)?|felt)(?![\p{L}\p{N}])`;
const FRAMING = new RegExp(FRAMING_WORDS, 'giu');
const FRAMING_ANYWHERE = new RegExp(FRAMING_WORDS, 'iu');
const THAT = /(?<![\p{L}\p{N}])that(?![\p{L}\p{N}])/iu;

/** Parties that have views and interests, and what they say or feel: a report of a view, not a rule. */
const PEOPLE = String.raw`(?:customers?|clients?|users?|residents?|famil(?:y|ies)|patients?|staff|employees?|workers?|engineers?|managers?|parents?|students?|pupils?|visitors?|guests?|respondents?|members?|participants?|stakeholders?|councillors?|islanders?|neighbou?rs?|locals?|people|households?|reviewers?|carers?|travellers?|passengers?|commuters?|owners?|tenants?|buyers?|shoppers?|traders?|retailers?|teachers?|nurses?|doctors?|colleagues?|administrators?|consultants?|officers?|voters?|taxpayers?|supporters?|volunteers?)`;
const VIEW = new RegExp(
  String.raw`(?<![\p{L}\p{N}])${PEOPLE}(?![\p{L}\p{N}])[^.;:?!]{0,40}?(?<![\p{L}\p{N}])(?:say|says|said|saying|feel|feels|felt|told|tell|tells|complain\w*|believe\w*|think\w*|consider\w*|argue\w*|claim\w*|worr(?:y|ies|ied))(?![\p{L}\p{N}])`,
  'iu',
);

/** A modal that says an obligation is possible, right before the words of the obligation: "may need to". */
const HEDGE_MODAL =
  /(?<![\p{L}\p{N}])(?:may|might|could|possibly|perhaps|probably|potentially|likely)(?:\s+\p{L}+){0,2}\s*$/iu;
/** Words that make what follows a usual case or a condition, not a rule. */
const HEDGE_ADVERB =
  /(?<![\p{L}\p{N}])(?:usually|typically|generally|normally|often|sometimes|occasionally|in\s+some\s+cases|where\s+possible|if\s+possible|if\s+(?:needed|necessary)|as\s+far\s+as\s+possible|in\s+principle)(?![\p{L}\p{N}])/iu;
/** The "if" of a condition: what is said inside it describes a case, it does not lay a rule down. */
const CONDITION = /(?<![\p{L}\p{N}])(?:if|whether|in\s+case)(?![\p{L}\p{N}])/iu;
const NEGATION =
  /(?<![\p{L}\p{N}])(?:not|n['’]t|never|no\s+longer|without|no)(?:\s+\p{L}+){0,2}\s*$/iu;

/** Read from the cue on: what the same words say when they warn how to read, or what is not known. */
const INTERPRETIVE: readonly RegExp[] = [
  /^must\s+not\s+be\s+(?:assumed|taken|read|treated|interpreted|regarded|considered|seen|understood|confused|mistaken|presumed|equated|construed)/iu,
  /^must\s+(?:have\s+(?:been|had|done|made|taken|meant)|be\s+(?:wrong|right|true|false|due|because|the\s+case|a\s+mistake))/iu,
  /^may\s+not\s+(?:be\s+(?:able|ready|possible|available|sure|enough|feasible|practical|viable|affordable|clear)|have\s+(?:enough|the)|work|apply|happen|know)/iu,
  /^(?:cannot|can['’]t)\s+(?:be\s+(?:sure|certain|confident|known|said|ruled\s+out)|say|tell|know|assume|predict|estimate|judge|rule\s+out|always|necessarily)/iu,
  /^unable\s+to\s+(?:say|tell|know|predict|estimate|judge)/iu,
];

/** A clause that explains or follows from the one before it, and so is said under the same "wants" or "fears". */
const DEPENDENT = /^(?:,\s*(?:because|which|so)|because)$/u;
/** What a hypothetical says would follow, as opposed to what a rule lays down: "would fall below 50 hours unless…". */
const HYPOTHETICAL = /(?<![\p{L}\p{N}])(?:would|could|might)(?![\p{L}\p{N}])/iu;
/** A count of a group ("at least 40% of visitors"): a finding about people, not a bound on anything. */
const OF_PEOPLE = new RegExp(
  String.raw`^[^.;:?!]{0,30}?\bof\s+(?:the\s+|all\s+|our\s+|its\s+|those\s+)?${PEOPLE}(?![\p{L}\p{N}])`,
  'iu',
);
/** A past finding ("rose by at most 3%", "averaged no more than two hours"): what was measured, not what is allowed. */
const FINDING =
  /(?<![\p{L}\p{N}])(?:rose|fell|grew|dropped|increased|decreased|reached|averaged|recorded|measured|totalled|totaled|showed|found|saw|had|took)(?![\p{L}\p{N}])/iu;

function cuesIn(clause: string): Cue[] {
  const found: Cue[] = [];
  for (const spec of CUE_PATTERNS) {
    for (const match of clause.matchAll(spec.pattern)) {
      found.push({
        text: match[0],
        shown: (spec.shown ? spec.shown(match[0]) : match[0]).replace(/\s+/gu, ' '),
        family: spec.family,
        modal: spec.modal,
        negative: spec.negative,
        standalone: spec.standalone,
        index: match.index ?? 0,
      });
    }
  }
  return found.sort((a, b) => a.index - b.index || b.text.length - a.text.length);
}

function cancellationOf(clause: string, cue: Cue, inherited: boolean): Cancellation | null {
  const before = clause.slice(0, cue.index);
  const from = clause.slice(cue.index);
  if (INTERPRETIVE.some((pattern) => pattern.test(from))) return 'interpretive';
  // A floor or a ceiling that counts a group, or that sums up what was measured, is a finding and not a limit.
  if (
    cue.family === 'bound' &&
    (OF_PEOPLE.test(from.slice(cue.text.length)) || FINDING.test(before))
  ) {
    return 'interpretive';
  }
  if (!cue.negative && NEGATION.test(before)) return 'negated';
  if (inherited || VIEW.test(before)) return 'asked-for';
  const asked = lastOf(FRAMING, before);
  if (asked) {
    const between = before.slice((asked.index ?? 0) + asked[0].length);
    // A modal needs its own "that": "wants to enter must show a pass" is a rule, "insists that staff must" a demand.
    if (!cue.modal || THAT.test(between)) return 'asked-for';
  }
  if (HEDGE_ADVERB.test(before) || CONDITION.test(before)) return 'hedged';
  if (cue.family === 'obligation' && HEDGE_MODAL.test(before)) return 'hedged';
  // "would take it to 48 hours unless Sunday hours are added" predicts; it does not lay a rule down.
  if (/^unless(?![\p{L}\p{N}])/iu.test(cue.text) && HYPOTHETICAL.test(before)) return 'hedged';
  return null;
}

/** How one clause reads, given whether the clause before it was said under a "wants" or a "fears". A question states nothing. */
export function readClauseHardness(clause: string, inherited = false): HardnessReading {
  if (clause.trimEnd().endsWith('?')) return { hard: false, cue: null, cancelled: null };
  let cancelled: HardnessReading['cancelled'] = null;
  for (const cue of cuesIn(clause)) {
    const why = cancellationOf(clause, cue, inherited);
    if (why === null) return { hard: true, cue, cancelled };
    cancelled ??= { cue, why };
  }
  return { hard: false, cue: null, cancelled };
}

/** How each clause of a sentence reads, a clause that explains a wish or a fear being read as part of it. */
export function readClauses(clauses: readonly Clause[]): HardnessReading[] {
  const readings: HardnessReading[] = [];
  let framed = false;
  for (const clause of clauses) {
    const inherited: boolean = framed && DEPENDENT.test(clause.joint);
    readings.push(readClauseHardness(clause.text, inherited));
    framed = inherited || FRAMING_ANYWHERE.test(clause.text) || VIEW.test(clause.text);
  }
  return readings;
}

/** How a sentence, or a quote of one, reads: hard if any clause of it states a limit that holds. */
export function readHardness(text: string): HardnessReading {
  let cancelled: HardnessReading['cancelled'] = null;
  for (const reading of readClauses(splitClauses(text))) {
    if (reading.hard) return { ...reading, cancelled: reading.cancelled ?? cancelled };
    cancelled ??= reading.cancelled;
  }
  return { hard: false, cue: null, cancelled };
}

/**
 * Whether a text says something that a model could fairly read as a firm limit although no word of
 * obligation, ban, ceiling or condition is in it: a word of limits (a notice, a deadline, a capacity, a
 * term of an agreement) in a clause that does not ask, hedge or say it is not known.
 */
export function limitSupport(text: string): string | null {
  let framed = false;
  for (const clause of splitClauses(text)) {
    const inherited: boolean = framed && DEPENDENT.test(clause.joint);
    framed = inherited || FRAMING_ANYWHERE.test(clause.text) || VIEW.test(clause.text);
    if (inherited || clause.text.trimEnd().endsWith('?') || UNDECIDED_CUE.test(clause.text)) {
      continue;
    }
    for (const found of clause.text.matchAll(new RegExp(LIMIT_WORDS.source, 'giu'))) {
      const before = clause.text.slice(0, found.index ?? 0);
      if (
        lastOf(FRAMING, before) ||
        VIEW.test(before) ||
        HEDGE_ADVERB.test(before) ||
        CONDITION.test(before) ||
        NEGATION.test(before)
      ) {
        continue;
      }
      return found[0];
    }
  }
  return null;
}
