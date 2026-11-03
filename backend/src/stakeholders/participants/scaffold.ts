import {
  PARTICIPANT_ROLE_MEANINGS,
  ROLE_CATEGORIES,
  type ParticipantRole,
  type ProposedParticipant,
} from '../../../../shared/stakeholders.js';
import { analyse, excerptAround } from '../mentions.js';
import { capitalise, slugify, truncate, uniqueId } from '../names.js';
import { CATEGORY_PURPOSE } from '../priors.js';
import { PLACEHOLDER_SIZE } from '../rules.js';
import type { ProposalContext } from './context.js';
import { compareNames, isGenericName, nameProblem, nameTokens, normaliseLine } from './language.js';
import { headNounOf } from './reader.js';
import { ROLE_DEFAULTS, roleGapReason } from './taxonomy.js';
import { subjectOf } from './topic.js';
import { STANDS_IN, cueFor, reviewContext, textsOf } from './validate.js';
import { CLOSED_CLASS, INSTRUMENTS, NOT_DESCRIBING } from './vocabulary.js';

/**
 * The decision-structure scaffold of the rules path. Reading the sources finds the parties they name;
 * this adds the few that a decision like this has anyway and the sources leave unsaid, each a clearly
 * marked ROLE-BASED ASSUMPTION and never a finding:
 *
 *  - a decision has an owner, and a change lands on someone;
 *  - a rule, a standard or a code that the sources refer to by name is set and applied by someone, and a
 *    contract has another side: when the sources do not name them, a participant stands for them;
 *  - a group the sources themselves say was left out ("were not asked", "no data on") is a missing voice,
 *    named as the sources name it, and the role as a whole is stood for by those reached with no say;
 *  - a role that the question or the sources speak of ("approval", "rollout", "supplier") and nobody
 *    holds is proposed, named from the scenario's own nouns.
 *
 * Each says why it is there and what it rests on. Only the owner and those affected are standing: the
 * rest are added where the sources or the question call for them, while the list has room, and an
 * assumption never takes the place of a party the sources name, since it ranks last.
 */

export const ROLE_DEFAULTS_NOTE =
  'Influence, authority, information access and plausible actions are defaults for this role, not findings.';

export interface Assumption {
  role: ParticipantRole;
  name: string;
  /** Why it is on the list, in a sentence or two. */
  why: string;
  /** What it rests on, which the participant carries as its first assumption. */
  basis: string;
  /** A passage that says who the participant is, when one does: it is then sourced, and says so. */
  evidence?: { passageId: string; quote: string }[];
}

/** A participant that rests on a role pattern: unless a passage says who it is, nothing is quoted, and it says what it rests on. */
export function assumed(item: Assumption, id: string): ProposedParticipant {
  const defaults = ROLE_DEFAULTS[item.role];
  const category = ROLE_CATEGORIES[item.role][0] ?? 'other';
  const owner = item.role === 'decision-owner';
  const evidence = item.evidence ?? [];
  return {
    id,
    name: normaliseLine(item.name, 120),
    role: item.role,
    category,
    whyTheyMatter: truncate(`${PARTICIPANT_ROLE_MEANINGS[item.role]} ${item.why}`, 600),
    description: '',
    objective: CATEGORY_PURPOSE[category],
    incentives: [],
    pressures: [],
    constraints: [],
    concerns: [],
    influence: defaults.influence,
    decisionAuthority: defaults.decisionAuthority,
    directness: defaults.directness,
    impact: {
      direction: 'unclear',
      rationale: 'No direction is assumed for a role added from a pattern.',
    },
    informationAccess: defaults.informationAccess,
    plausibleActions: defaults.plausibleActions,
    prohibitedClaims: defaults.prohibitedClaims,
    evidence,
    assumptions: [item.basis, ROLE_DEFAULTS_NOTE],
    uncertainty: {
      level: 'high',
      reason:
        evidence.length > 0
          ? 'One passage says this.'
          : 'No passage names this role; it is a role pattern.',
    },
    confidenceBasis: evidence.length > 0 ? 'source-quote' : 'category-pattern',
    priority: owner ? 'key' : evidence.length > 0 ? 'standard' : 'background',
    populationSize:
      PLACEHOLDER_SIZE[owner ? 'key' : evidence.length > 0 ? 'standard' : 'background'],
    synthetic: true,
  };
}

const ASSUMPTION_TAIL =
  'It is a role-based assumption: it stands for whoever fills the role, which no passage names.';

/** What the sources imply without saying who. `words` are the words that, in a name on the list, mean that someone already stands for it. */
export interface Implied extends Assumption {
  kind: 'unheard' | 'instrument' | 'contract';
  words: string[];
  /** The sentence it was read in. */
  quote: string;
}

const UNHEARD = {
  none: /\bno\s+(?:data|evidence|information|research|records?)\b[^.;]{0,30}?\b(?:on|for|about|from)\s+([^.;:]{3,110})/iu,
  passive:
    /^(.{3,110}?)\s+(?:were|was|are|is|have been|has been)\s+not\s+(?:asked|included|consulted|surveyed|interviewed|invited|represented|heard|covered|reached)\b/iu,
};

/** The groups a phrase names, as the sources write them: one for each side of an "and", and none for a phrase that holds a name. */
function groupsIn(raw: string): string[] {
  const text = raw
    .replace(/,\s+(?=(?:who|which|that)\b).*$/iu, '')
    .replace(/,\s+(?=(?:because|since|although|but|so)\b).*$/iu, '')
    .replace(/\s+(?:because|since|although|but|so)\b.*$/iu, '');
  // A group is named whole, and a clause that says which ("who do not use the library") belongs to the
  // last of those it follows.
  const clause = /\s+(?:who|which|that)\b.*$/iu.exec(text)?.[0] ?? '';
  const subject = clause === '' ? text : text.slice(0, text.length - clause.length);
  const named = (phrase: string): string | null => {
    const clean = phrase
      .replace(/^(?:the|a|an|those|these|any|all|some|many|most)\s+/iu, '')
      .replace(/[\s,;:]+$/u, '')
      .replace(/\s+/gu, ' ')
      .trim();
    const words = clean.split(' ');
    // A capital after the first word is a name, and a name is not a group.
    if (
      clean === '' ||
      words.length > 12 ||
      /\p{N}/u.test(clean) ||
      !/^[\p{L}][\p{L}'’ -]*$/u.test(clean) ||
      words.slice(1).some((word) => /^\p{Lu}/u.test(word))
    ) {
      return null;
    }
    const name = capitalise(clean);
    return headNounOf(name) !== null || /\bpeople\b/iu.test(clean) ? name : null;
  };
  const parts = subject.split(/,?\s+and\s+|,\s+/iu);
  const last = parts.length - 1;
  const each = parts.map((part, index) => named(index === last ? `${part}${clause}` : part));
  // "Customers on premium and enterprise plans" is one group; "children and parents" are two.
  if (each.every((name) => name !== null)) return each as string[];
  const whole = named(`${subject}${clause}`);
  return whole ? [whole] : [];
}

const INSTRUMENT_NAME = new RegExp(
  String.raw`((?:\p{Lu}[\p{L}'’-]*\s+){1,4}(?:${[...INSTRUMENTS].map(capitalise).join('|')})s?)(?![\p{L}])`,
  'gu',
);
const CONTRACT =
  /\b(?:[Tt]he|[Aa]n?|[Tt]his|[Tt]hat|[Oo]ur|[Tt]heir|[Ii]ts)\s+(\p{Ll}[\p{L}-]{2,}(?:\s+\p{Ll}[\p{L}-]{2,})?)\s+(contract|agreement)\b/gu;

const quoteWhy = (lead: string, quote: string): string =>
  `${lead} “${truncate(quote, 200)}”${/[.!?…]$/u.test(quote.trim()) ? '' : '.'}`;

/** The part of a long sentence around what was read in it, cut at spaces, so that what is quoted is an excerpt that a passage holds. */
const excerptOf = (sentence: string, at: RegExpExecArray): string =>
  excerptAround(sentence, at.index, at.index + at[0].length);

/** What the sources imply without saying who: the other side of a contract, whoever sets a rule they name, and groups they say were left out. */
export function impliedIn(context: ProposalContext): Implied[] {
  const found: Implied[] = [];
  const seen = new Set<string>();
  const add = (item: Implied): void => {
    const key = item.name.toLowerCase();
    if (seen.has(key) || found.filter((other) => other.kind === item.kind).length >= 2) return;
    seen.add(key);
    found.push(item);
  };
  for (const passage of context.passages) {
    for (const sentence of analyse(passage)) {
      if (sentence.suspicious || sentence.label) continue;
      const text = sentence.readable;

      const left = UNHEARD.none.exec(text) ?? UNHEARD.passive.exec(text);
      const quote = left ? excerptOf(sentence.text, left) : '';
      for (const group of left ? groupsIn(left[1] ?? '') : []) {
        add({
          kind: 'unheard',
          role: 'missing-voices',
          name: group,
          words: nameTokens(group),
          quote: sentence.text,
          why: quoteWhy('The sources say this group was left out:', quote),
          basis:
            'Taken from a passage that says this group was not heard; no passage names it as a party.',
          evidence: [{ passageId: passage.id, quote }],
        });
      }

      for (const match of text.matchAll(INSTRUMENT_NAME)) {
        const words = (match[1] ?? '').trim().split(/\s+/u);
        while (words.length > 0 && CLOSED_CLASS.has((words[0] ?? '').toLowerCase())) words.shift();
        if (words.length < 2) continue;
        const rule = words.join(' ');
        add({
          kind: 'instrument',
          role: 'regulators-governance',
          name: `Body that sets ${rule}`,
          words: nameTokens(words.slice(0, -1).join(' ')),
          quote: sentence.text,
          why: quoteWhy(
            `The sources refer to ${rule}, which someone sets and applies, and do not name who:`,
            excerptOf(sentence.text, match),
          ),
          basis: `Added because ${rule} has a body behind it; no passage names which.`,
        });
      }

      for (const match of text.matchAll(CONTRACT)) {
        const kind = match[1] ?? '';
        const noun = match[2] ?? 'contract';
        const words = kind.split(' ');
        if (words.some((word) => NOT_DESCRIBING.has(word) || word.endsWith('ly'))) continue;
        add({
          kind: 'contract',
          role: 'partners-suppliers',
          name: `Other side of the ${kind} ${noun}`,
          words: nameTokens(kind),
          quote: sentence.text,
          why: quoteWhy(
            `${/^[aeiou]/iu.test(noun) ? 'An' : 'A'} ${noun} has another side, and no passage says who:`,
            excerptOf(sentence.text, match),
          ),
          basis: `Added because the ${kind} ${noun} has another side; no passage names who.`,
        });
      }
    }
  }
  return found;
}

/**
 * Whether a party already on the list stands for the implied one. A missing voice is stood for by a party
 * that names the same group or one at least as specific, or one of two words or more that it takes in
 * ("Customers on premium" for "Customers on premium and enterprise plans"), but not by a bare noun, which
 * speaks for no one in particular. A contract's other side is stood for by a party the sentence names,
 * and the body behind a rule by a party that has the words that name the rule.
 */
function stoodFor(item: Implied, held: readonly ProposedParticipant[]): boolean {
  const sentence = new Set(nameTokens(item.quote));
  return held.some((participant) => {
    const own = nameTokens(participant.name);
    if (item.kind === 'unheard') {
      return (
        compareNames(item.name, participant.name) === 'same' ||
        item.words.every((word) => own.includes(word)) ||
        (own.length >= 2 && own.every((word) => item.words.includes(word)))
      );
    }
    if (item.kind === 'contract' && own.length > 0 && own.every((word) => sentence.has(word))) {
      return true;
    }
    const shared = item.words.filter((word) => own.includes(word)).length;
    return item.words.length > 0 && shared >= Math.min(2, item.words.length);
  });
}

/** What a role that nobody holds is called, from the scenario's own nouns. */
const ROLE_NAMES: Partial<Record<ParticipantRole, (topic: string) => string>> = {
  implementers: (topic) => `Those who would carry out ${topic}`,
  approvers: (topic) => `Approvers of ${topic}`,
  'regulators-governance': (topic) => `Body that oversees ${topic}`,
  'partners-suppliers': (topic) => `Suppliers and partners for ${topic}`,
  'competitors-alternatives': (topic) => `Alternatives to ${topic}`,
  'opponents-resistors': (topic) => `Those who may object to ${topic}`,
};
const GAP_ORDER: readonly ParticipantRole[] = [
  'implementers',
  'approvers',
  'regulators-governance',
  'partners-suppliers',
  'competitors-alternatives',
  'opponents-resistors',
];

/**
 * The assumptions that complete a list the reading made. The first two are standing: a decision has an
 * owner and a change lands on someone, whatever the sources say. The rest are added in the order of how
 * much a decision turns on them, while the list has `room` for them.
 */
export function scaffold(
  context: ProposalContext,
  participants: readonly ProposedParticipant[],
  used: Set<string>,
  room: number,
): ProposedParticipant[] {
  const topic = subjectOf(context.scenario, context.question);
  const held = new Set(participants.map((participant) => participant.role));
  const holds = (role: ParticipantRole): boolean =>
    held.has(role) || (STANDS_IN[role] ?? []).some((other) => held.has(other));
  const standing: Assumption[] = [];
  if (!held.has('decision-owner')) {
    standing.push({
      role: 'decision-owner',
      name: `Decision owner for ${topic}`,
      why: 'A decision like this has an owner, and no passage names who it is.',
      basis: 'Added because every decision has someone who makes it; the sources do not name them.',
    });
  }
  if (!holds('directly-affected')) {
    standing.push({
      role: 'directly-affected',
      name: `Those directly affected by ${topic}`,
      why: 'A change like this lands on someone, and no passage names who.',
      basis: 'Added because a change lands on someone; the sources do not name who.',
    });
  }

  // What the sources say was left out is a party they name, so it is not held to the room that assumptions are.
  const implied = impliedIn(context).filter((item) => !stoodFor(item, participants));
  const unheard = implied.filter((item) => item.kind === 'unheard');
  const optional: Assumption[] = implied.filter((item) => item.kind !== 'unheard');
  const text = textsOf(
    reviewContext({
      passages: context.passages,
      graph: context.graph,
      scenario: context.scenario,
      question: context.question,
    }),
  );
  for (const role of GAP_ORDER) {
    const name = ROLE_NAMES[role]?.(topic);
    const cue = cueFor(role, text);
    if (!name || cue === null || holds(role) || optional.some((item) => item.role === role))
      continue;
    optional.push({
      role,
      name,
      why: `${roleGapReason(role, cue)} ${ASSUMPTION_TAIL}`,
      basis: `Added because the question or the sources mention “${cue}” and nobody holds this role.`,
    });
  }
  if (
    !held.has('missing-voices') &&
    unheard.length === 0 &&
    !optional.some((item) => item.role === 'missing-voices')
  ) {
    optional.push({
      role: 'missing-voices',
      name: `Those reached by ${topic} who have no say in it`,
      why: `${roleGapReason('missing-voices', null)} ${ASSUMPTION_TAIL}`,
      basis:
        'Added because a change reaches people who are not at the table; the sources do not say who.',
    });
  }

  const taken = [...participants];
  const added: ProposedParticipant[] = [];
  const room_ = Math.max(0, room - standing.length - unheard.length);
  for (const item of [...standing, ...unheard, ...optional.slice(0, room_)]) {
    if (
      isGenericName(item.name) ||
      nameProblem(item.name, context.personLabels) !== null ||
      taken.some((other) => compareNames(other.name, item.name) === 'same')
    ) {
      continue;
    }
    const participant = assumed(item, uniqueId(slugify(item.name), used));
    taken.push(participant);
    added.push(participant);
  }
  return added;
}
