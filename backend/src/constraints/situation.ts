import type { ConstraintCategory } from '../../../shared/constraints.js';
import type { StakeholderCategory } from '../../../shared/stakeholders.js';
import type { EvidenceChunk } from '../../../shared/types.js';
import { truncate } from '../stakeholders/names.js';
import type { DiscoveryContext } from './types.js';

/**
 * What the situation suggests might limit the change, and so is worth asking about: who is involved (the
 * cast, and the roles the question and the sources name), what kind of change it is (its decision and its
 * alternatives), and what the sources are headed. A kind of limit is asked about only where one of these
 * points to it and nothing in the project says whether it applies, so a person is not asked what the
 * sources already answer. The reason is shown with each question: it is what made it worth asking, never
 * a finding of any source.
 */

export interface Situation {
  category: ConstraintCategory;
  question: string;
  /** What a limit of this kind could change: Swarm's words, not a finding. */
  why: string;
  /** Kinds of actor whose presence makes a limit of this kind likely. */
  actors: readonly StakeholderCategory[];
  /** Words that belong to this kind of limit and few others: one of them points to it. */
  strong: readonly string[];
  /** Words of ordinary talk that this kind of limit shares with others: it takes two of them. */
  weak: readonly string[];
  /** Kinds every decision has (money, time, undoing it): asked after the ones a situation points to. */
  universal?: boolean;
}

export const SITUATIONS: readonly Situation[] = [
  {
    category: 'legal',
    question: 'Does a law, or a legal duty owed to someone, limit this change?',
    why: 'A legal limit can rule an alternative out altogether.',
    actors: ['regulator', 'governance'],
    strong: [
      'laws?',
      'legal(?:ly)?',
      'lawful\\w*',
      'legislat\\w+',
      'statut\\w+',
      'liabilit\\w+',
      'courts?',
      'discriminat\\w+',
    ],
    weak: ['dut(?:y|ies)', 'rights?', 'entitle\\w*', 'consumers?', 'tenants?', 'obligations?'],
  },
  {
    category: 'regulatory',
    question: 'Does a regulator, a licence or a required approval limit this change?',
    why: 'A required approval or licence can hold the change back or rule it out.',
    actors: ['regulator', 'governance'],
    strong: [
      'regulat\\w+',
      'licen[cs]\\w+',
      'permits?',
      'complian\\w+',
      'oversight',
      'accredit\\w+',
      'inspect\\w+',
      'certif\\w+',
    ],
    weak: [
      'authorit(?:y|ies)',
      'agenc(?:y|ies)',
      'ministr(?:y|ies)',
      'approv\\w+',
      'standards?',
      'guidelines?',
      'planning',
      'consultations?',
    ],
  },
  {
    category: 'safety',
    question:
      'Could the change put people at risk, so that a safety rule or a duty of care applies?',
    why: 'A safety limit can rule out a change that would otherwise save time or money.',
    actors: ['risk-bearer'],
    strong: [
      'safety',
      'safely',
      'hazard\\w*',
      'injur\\w+',
      'danger\\w*',
      'emergenc\\w+',
      'clinical',
      'patients?',
      'medic\\w+',
      'hospitals?',
      'pharmac\\w+',
      'infection\\w*',
      'accidents?',
    ],
    weak: [
      'safe',
      'harm\\w*',
      'health\\w*',
      'drugs?',
      'evacuat\\w+',
      'children',
      'child',
      'vulnerable',
    ],
  },
  {
    category: 'privacy',
    question: 'Does the change touch personal or confidential data, and how long may it be kept?',
    why: 'Rules on personal data can limit what may be kept, shared or automated.',
    actors: [],
    strong: [
      'personal data',
      'personal details',
      'privacy',
      'confidential\\w*',
      'data protection',
      'biometric\\w*',
      'cameras?',
      'cctv',
      'surveillance',
      '(?:face|facial|plate|voice)[- ]recognition',
      'transcripts?',
      'location data',
    ],
    weak: [
      'records?',
      'identif\\w+',
      'track(?:ing|ed)',
      'images?',
      'photograph\\w*',
      'recordings?',
      'monitoring',
    ],
  },
  {
    category: 'contractual',
    question: 'Do any contracts or commitments bind the change?',
    why: 'A contract can fix terms, prices or notice periods that the change has to respect.',
    actors: ['partner', 'channel'],
    strong: [
      'contract\\w*',
      'agreements?',
      'suppliers?',
      'vendors?',
      'resellers?',
      'marketplaces?',
      'franchis\\w+',
      'leases?',
      'renewals?',
      'subcontract\\w+',
      'outsourc\\w+',
      'third[- ]part(?:y|ies)',
    ],
    weak: ['providers?', 'operators?', 'partners?', 'distributors?', 'carriers?', 'notice'],
  },
  {
    category: 'dependency',
    question:
      'Does the change depend on something outside your control, such as a supplier or another team?',
    why: 'If something it depends on is not ready, the change cannot go ahead as planned.',
    actors: ['partner', 'channel'],
    strong: [
      'depend\\w*',
      'suppliers?',
      'vendors?',
      'third[- ]part(?:y|ies)',
      'upstream',
      'downstream',
      'reli(?:es|ed|ance|ant|y)',
      'waiting for',
    ],
    weak: [
      'platforms?',
      'providers?',
      'partners?',
      'marketplaces?',
      'carriers?',
      'resellers?',
      'operators?',
    ],
  },
  {
    category: 'capacity',
    question: 'Who has to carry the change out, and is there a limit on how much they can take on?',
    why: 'A limit on capacity can delay the change or leave part of it undone.',
    actors: ['operations', 'channel'],
    strong: [
      'capacity',
      'workloads?',
      'throughput',
      'backlog\\w*',
      'bandwidth',
      'overload\\w*',
      'migrat\\w+',
    ],
    weak: [
      'volumes?',
      'demand',
      'peaks?',
      'queues?',
      'spare',
      'slots?',
      'beds?',
      'seats?',
      'chairs?',
      'implement\\w+',
      'roll-?out',
      'engineers?',
      'teams?',
    ],
  },
  {
    category: 'staffing',
    question:
      'Is there a limit on staff hours, rotas or notice, from an agreement or from who is available?',
    why: 'Staffing rules can limit when the change can run and who can carry it out.',
    actors: ['operations'],
    strong: [
      'rotas?',
      'rost\\w+',
      'shifts?',
      'overtime',
      'unions?',
      'headcount',
      'hir(?:e|es|ed|ing)',
      'recruit\\w*',
      'workforce',
    ],
    weak: [
      'staff\\w*',
      'employees?',
      'workers?',
      'volunteers?',
      'nurses?',
      'teachers?',
      'pharmacists?',
      'weekends?',
      'on-call',
    ],
  },
  {
    category: 'infrastructure',
    question:
      'Does the change need buildings, equipment or systems that are not there yet, or that take time to get?',
    why: 'Equipment and works have lead times that fix the order and pace of the change.',
    actors: [],
    strong: [
      'infrastructure',
      'equipment',
      'hardware',
      'servers?',
      'grid',
      'terminals?',
      'premises',
      'upgrad\\w+',
      'construct\\w*',
      'install\\w*',
      'procure\\w*',
    ],
    weak: [
      'buildings?',
      'facilit(?:y|ies)',
      'networks?',
      'vehicles?',
      'vessels?',
      'buses',
      'fleet',
      'lifts?',
    ],
  },
  {
    category: 'accessibility',
    question:
      'Does the change have to work for people with disabilities, or for people who need another language?',
    why: 'An access duty or gap can rule out a change that works for only some of the people it reaches.',
    actors: [],
    strong: [
      'accessib\\w+',
      'disabilit\\w+',
      'disabled',
      'wheelchairs?',
      'step-free',
      'screen readers?',
      'translat\\w+',
      'literacy',
      'inclusi\\w+',
      'equalit(?:y|ies)',
    ],
    weak: [
      'older',
      'elderly',
      'carers?',
      'languages?',
      'chat',
      'portal',
      'website',
      'app',
      'online',
      'entrance',
    ],
  },
  {
    category: 'budget',
    question: 'Is there a budget or a spending limit on this decision? If so, what is it?',
    why: 'A spending limit can rule an alternative out or slow it down.',
    actors: ['cost-bearer'],
    strong: [
      'budget\\w*',
      'subsid\\w+',
      'grants?',
      'fund\\w+',
      'afford\\w*',
      'financ\\w+',
      'costs?',
      'costly',
    ],
    weak: [
      'price[sd]?',
      'pricing',
      'pay(?:s|ing|ment|ments)?',
      'fees?',
      'revenue',
      'spend\\w*',
      'invest\\w+',
      'expens\\w+',
      'saving\\w*',
    ],
    universal: true,
  },
  {
    category: 'time',
    question: 'Is there a deadline, or a date before which nothing can start?',
    why: 'Timing decides when the change reaches people and who can respond first.',
    actors: [],
    strong: ['deadlines?', 'timelines?', 'timetables?', 'schedul\\w+', 'lead times?', 'expir\\w+'],
    weak: ['launch\\w*', 'quarters?', 'seasons?', 'horizon', '(?:19|20)\\d{2}'],
    universal: true,
  },
  {
    category: 'reversibility',
    question: 'Could the change be undone if it goes badly?',
    why: 'If it cannot be undone, being wrong costs more.',
    actors: [],
    strong: [
      'irreversib\\w+',
      'permanent\\w*',
      'one-way',
      'decommission\\w*',
      'phase[- ]out',
      'abolish\\w*',
      'discontinu\\w+',
    ],
    weak: [
      'replac\\w+',
      'retir\\w+',
      'scrap\\w*',
      'shut\\w*',
      'clos(?:e|es|ed|ing|ure|ures)',
      'sell\\w*',
      'withdraw\\w*',
      'remov\\w+',
      'shorten\\w*',
      'demolish\\w*',
      'merg(?:e|es|ed|ing|er)',
    ],
    universal: true,
  },
];

const matcher = (words: readonly string[]): RegExp =>
  new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${words.join('|')})(?![\p{L}\p{N}])`, 'giu');

const MATCHERS = new Map(
  SITUATIONS.map((situation) => [
    situation.category,
    { strong: matcher(situation.strong), weak: matcher(situation.weak) },
  ]),
);

interface Hits {
  strong: string[];
  weak: string[];
}

const distinct = (pattern: RegExp, text: string): string[] => [
  ...new Set([...text.matchAll(pattern)].map((found) => found[0].toLowerCase())),
];

const hitsIn = (situation: Situation, text: string): Hits => {
  const matchers = MATCHERS.get(situation.category) as { strong: RegExp; weak: RegExp };
  const strong = distinct(matchers.strong, text);
  return { strong, weak: distinct(matchers.weak, text).filter((word) => !strong.includes(word)) };
};

/** A word that belongs to the kind counts twice a word it shares with others. */
const weighed = (hits: Hits, strongWeight: number, weakWeight: number): number =>
  strongWeight * hits.strong.length + weakWeight * hits.weak.length;

/**
 * What kind of limit a sentence is about, by the words of the kinds above, when it names one: at least
 * one word of the kind and one more of ordinary talk, or two of its own.
 */
export function topicOf(text: string): ConstraintCategory | null {
  let best: { category: ConstraintCategory; points: number } | null = null;
  for (const situation of SITUATIONS) {
    const points = weighed(hitsIn(situation, text), 2, 1);
    if (points >= 3 && (!best || points > best.points))
      best = { category: situation.category, points };
  }
  return best?.category ?? null;
}

/** The headings of the sources, as written: the lines a source marks as headings. */
export function headingsOf(passages: readonly EvidenceChunk[]): string[] {
  const headings: string[] = [];
  for (const passage of passages) {
    for (const found of passage.text.matchAll(/^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gmu)) {
      const heading = found[1]?.trim();
      if (heading) headings.push(heading);
    }
  }
  return headings;
}

/** The words of the person: the question and what the scenario says the decision and its alternatives are. */
function personText(context: DiscoveryContext): string {
  const { scenario } = context;
  return [
    context.question,
    scenario?.decision,
    scenario?.system,
    scenario?.baseline,
    ...(scenario?.alternatives.flatMap((alternative) => [
      alternative.label,
      alternative.description,
    ]) ?? []),
  ]
    .filter(Boolean)
    .join(' ');
}

export interface Implied {
  situation: Situation;
  /** How much points to it: a heading counts most, then the person's words and the cast, then the sources. */
  points: number;
  /** What pointed to it, in a sentence for the person; empty when nothing did. */
  reason: string;
}

const quoted = (hits: Hits): string =>
  [...hits.strong, ...hits.weak]
    .slice(0, 3)
    .map((word) => `“${word}”`)
    .join(', ');

/**
 * The kinds of limit the situation points to, strongest first. Not whether they apply: only that, from who
 * is involved and what is said, they could, which is worth a question where nothing says otherwise.
 */
export function impliedBy(
  context: DiscoveryContext,
  passages: readonly EvidenceChunk[],
): Implied[] {
  const own = personText(context);
  const headings = headingsOf(passages).join('\n');
  const body = passages.map((passage) => passage.text).join('\n');
  const implied: Implied[] = [];
  for (const situation of SITUATIONS) {
    const inHeadings = hitsIn(situation, headings);
    const inOwn = hitsIn(situation, own);
    const inBody = hitsIn(situation, body);
    const actors = context.actors.filter((actor) => situation.actors.includes(actor.category));
    const dependent =
      situation.category === 'dependency' &&
      context.actorRelations.some(
        (relation) => relation.type === 'depends-on' || relation.type === 'supplies',
      );
    const points =
      Math.min(6, weighed(inHeadings, 3, 2)) +
      Math.min(4, weighed(inOwn, 2, 1)) +
      Math.min(4, 2 * (actors.length + (dependent ? 1 : 0))) +
      Math.min(4, weighed(inBody, 2, 1));
    if (points < 2 && !situation.universal) continue;
    const reason =
      points < 2
        ? ''
        : weighed(inHeadings, 3, 2) > 0
          ? `A section of the sources is about ${quoted(inHeadings)}, but no limit of this kind has been found in them.`
          : actors.length > 0
            ? `${actors
                .slice(0, 2)
                .map((actor) => truncate(actor.name, 40))
                .join(
                  ' and ',
                )} ${actors.length === 1 ? 'is' : 'are'} involved, and nothing in the project says whether a limit of this kind applies.`
            : dependent
              ? 'Some of the actors depend on others, and nothing in the project says whether a limit of this kind applies.'
              : weighed(inOwn, 2, 1) > 0
                ? `Your question and scenario mention ${quoted(inOwn)}, and nothing in the project says whether a limit of this kind applies.`
                : `The sources mention ${quoted(inBody)}, and nothing in them says whether a limit of this kind applies.`;
    implied.push({ situation, points, reason });
  }
  return implied;
}
