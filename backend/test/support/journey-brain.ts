/**
 * The model that answers when the harness's Foundry is in its natural state (`behaviour: 'natural'`): a stand-in for a
 * model, held to the real schema by the fake Foundry and to the real checks by the product. It exists to test the path
 * (a strict schema out, a conforming answer in, the product's own checks, the label on the screen), and says nothing
 * about how any real model behaves.
 */
import type { ProposedParticipant, ProposedParticipants } from '../../../shared/stakeholders.js';
import type { FakeStep, RecordedRequest } from './fake-foundry.js';

interface Passage {
  id: string;
  text: string;
}

const isPassage = (value: unknown): value is Passage =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Passage).id === 'string' &&
  typeof (value as Passage).text === 'string';

const passagesOf = (data: unknown): Passage[] => {
  const evidence = (data as { evidence?: unknown } | null)?.evidence;
  return Array.isArray(evidence) ? evidence.filter(isPassage) : [];
};

/** A quotation: the first passage that holds the words, and the words, exactly as the passage has them. */
const quoting = (
  passages: readonly Passage[],
  words: string,
): { passageId: string; quote: string }[] => {
  const found = passages.find((passage) => passage.text.includes(words));
  return found ? [{ passageId: found.id, quote: words }] : [];
};

// What a reader of the journey's pages would take from them. Each quotation is a sentence of a page; one that is not
// among the passages shown is left out, and the participant or constraint then says that it rests on an assumption.
const SAYS = {
  schedule:
    'The harbour authority reviews its berthing fees once a year, and the board votes on the schedule at a meeting that is open to the public.',
  board: 'the board votes on the schedule at a meeting that is open to the public',
  operators:
    'it asked the operators of coastal vessels what they pay each year for berths, pilots and water at the quay',
  crews: 'it did not survey the crews about the notice they are given',
  pilots:
    'Pilots are licensed by the harbour authority, and every pilot must renew the licence after two years of service on the quays.',
  renewal: 'every pilot must renew the licence after two years of service on the quays',
  master:
    'the harbour master said that the board would hear the request at its next public meeting',
  association:
    'The association of operators asked for a longer notice period before any change to a berthing fee',
  costs:
    'The board compared the cost of running the quays with the money that berthing fees bring in',
  unmeasured:
    'The review did not measure what a higher berthing fee would do to the number of calls by coastal vessels',
};

function scenarioReading(data: unknown): unknown {
  const question = String((data as { question?: unknown } | null)?.question ?? '');
  const asked = (question.split('?')[0] ?? question).trim();
  const bare = asked.replace(/^what (?:could|would|might|will) happen if /iu, '');
  const harbour = /berthing fee/iu.test(question);
  return {
    decision: `Whether ${bare}`,
    system: harbour ? 'Berthing fees for coastal vessels' : '',
    geography: null,
    horizon: /next spring/iu.test(question) ? 'Next spring' : null,
    changes: harbour
      ? [
          {
            name: 'Berthing fee for coastal vessels',
            from: null,
            to: null,
            note: 'The question says the fee is raised, and does not say by how much.',
          },
        ]
      : [],
    baseline: 'The current situation continues without the change.',
    alternatives: [],
    requestedDecision: null,
    desiredOutput: null,
    evidenceMissing: ['What a higher fee did to calls by coastal vessels in earlier years.'],
    assumptions: [
      {
        id: 'read-as-asked',
        text: 'Assumed the question is about the berthing fee and nothing else that the authority sets.',
        origin: 'system',
      },
    ],
    likelyStakeholders: ['Harbour authority', 'Operators of coastal vessels'],
    ambiguities: [],
  };
}

function researchPlan(): unknown {
  return {
    entities: [
      { name: 'Harbour authority', kind: 'organization' },
      { name: 'Berthing fee', kind: 'concept' },
      { name: 'Coastal vessels', kind: 'concept' },
    ],
    topics: [
      'How the berthing fee schedule is set and reviewed',
      'What operators of coastal vessels pay now, by their own account',
      'The notice that operators are given before a fee changes',
    ],
    claimsToVerify: [
      {
        id: 'c1',
        statement: 'The harbour authority reviews its berthing fees once a year.',
        why: 'When the schedule is reviewed bears on when a change could take effect.',
      },
      {
        id: 'c2',
        statement: 'Operators have asked for a longer notice period before a fee changes.',
        why: 'The notice period could limit how a change is made.',
      },
    ],
    likelySources: [
      {
        category: 'primary',
        description: 'The fee schedule that the harbour authority publishes.',
      },
      { category: 'credible-reporting', description: 'Counts and reporting on calls by vessels.' },
    ],
    timeSensitivity: { level: 'recent', note: 'The schedule is reviewed once a year.' },
    conflictsToLookFor: ['Different figures for one fee in different sources.'],
    missingEvidence: ['What an earlier change in fees did to the number of calls.'],
  };
}

type Mine = Omit<
  ProposedParticipant,
  | 'description'
  | 'incentives'
  | 'pressures'
  | 'constraints'
  | 'concerns'
  | 'informationAccess'
  | 'prohibitedClaims'
  | 'assumptions'
  | 'priority'
  | 'synthetic'
  | 'category'
  | 'populationSize'
> &
  Partial<ProposedParticipant>;

function participantOf(item: Mine): ProposedParticipant {
  return {
    description: '',
    incentives: [],
    pressures: [],
    constraints: [],
    concerns: [],
    informationAccess: [],
    prohibitedClaims: ['What a real person in this role has decided or wants.'],
    assumptions: item.evidence.length === 0 ? ['Assumed from the question, not quoted.'] : [],
    priority: 'standard',
    synthetic: true,
    ...item,
  };
}

function participants(data: unknown): ProposedParticipants {
  const passages = passagesOf(data);
  const rests = (words: string) => quoting(passages, words);
  const found = (words: string): 'source-quote' | 'scenario-statement' =>
    rests(words).length > 0 ? 'source-quote' : 'scenario-statement';
  return {
    version: 1,
    participants: [
      participantOf({
        id: 'harbour-authority',
        name: 'Harbour authority that sets the berthing fees',
        role: 'decision-owner',
        whyTheyMatter: 'It reviews the fee schedule and carries the decision to raise a fee.',
        objective: 'Cover the cost of running the quays with a schedule that the board can defend.',
        incentives: ['Keep the quays funded from what berthing fees bring in.'],
        concerns: ['A change that the operators contest in public.'],
        influence: 'high',
        decisionAuthority: 'decides',
        directness: 'direct',
        impact: {
          direction: 'unclear',
          rationale: 'The sources do not say how a change would land on it.',
        },
        plausibleActions: [
          'Raise the fee as proposed.',
          'Phase the rise in.',
          'Give longer notice first.',
        ],
        evidence: rests(SAYS.schedule),
        uncertainty: {
          level: 'medium',
          reason: 'One passage describes how it reviews the schedule.',
        },
        confidenceBasis: found(SAYS.schedule),
        priority: 'key',
      }),
      participantOf({
        id: 'fee-board',
        name: 'Board that votes on the fee schedule',
        role: 'approvers',
        category: 'governance',
        whyTheyMatter: 'It votes on the schedule at a meeting that is open to the public.',
        objective: 'Approve a schedule that it can explain at an open meeting.',
        pressures: ['Operators ask to be heard before a change.'],
        influence: 'high',
        decisionAuthority: 'approves',
        directness: 'direct',
        impact: {
          direction: 'unclear',
          rationale: 'No passage says how a change would affect the board.',
        },
        plausibleActions: [
          'Approve the schedule.',
          'Ask for more time.',
          'Hear the operators first.',
        ],
        evidence: rests(SAYS.board),
        uncertainty: { level: 'medium', reason: 'One passage describes its vote.' },
        confidenceBasis: found(SAYS.board),
        priority: 'key',
      }),
      participantOf({
        id: 'coastal-operators',
        name: 'Operators of coastal vessels paying berthing fees',
        role: 'directly-affected',
        category: 'cost-bearer',
        whyTheyMatter: 'They pay the fee each year for berths, pilots and water at the quay.',
        objective: 'Keep the cost of calling predictable enough to plan their routes.',
        incentives: ['Keep what they pay for a call low and steady.'],
        concerns: ['A change at short notice.'],
        influence: 'medium',
        decisionAuthority: 'none',
        directness: 'direct',
        impact: {
          direction: 'harmed',
          rationale: 'A higher fee could raise what they pay for each call.',
        },
        plausibleActions: [
          'Ask for a longer notice period.',
          'Call at another port.',
          'Accept the change.',
        ],
        evidence: rests(SAYS.operators),
        uncertainty: { level: 'medium', reason: 'A passage says they were asked what they pay.' },
        confidenceBasis: found(SAYS.operators),
        priority: 'key',
        populationSize: 40,
      }),
      participantOf({
        id: 'vessel-crews',
        name: 'Crews of coastal vessels given notice of a change',
        role: 'indirectly-affected',
        category: 'risk-bearer',
        whyTheyMatter: 'They are the ones who are told when a fee changes, and are not asked.',
        objective: 'Know in good time what a change means for their calls.',
        concerns: ['Short notice of a change.'],
        influence: 'low',
        decisionAuthority: 'none',
        directness: 'indirect',
        impact: { direction: 'unclear', rationale: 'The review did not survey them.' },
        plausibleActions: ['Ask their operators for notice.', 'Pass on what they are told.'],
        evidence: rests(SAYS.crews),
        uncertainty: { level: 'high', reason: 'One passage says they were not surveyed.' },
        confidenceBasis: found(SAYS.crews),
        populationSize: 120,
      }),
      participantOf({
        id: 'licensed-pilots',
        name: 'Licensed pilots who move vessels at the quays',
        role: 'implementers',
        category: 'operations',
        whyTheyMatter: 'They carry out the movements that the pilotage charge is set against.',
        objective: 'Keep their licence in good standing and the movements safe.',
        constraints: ['Must renew the licence after two years of service.'],
        influence: 'low',
        decisionAuthority: 'none',
        directness: 'indirect',
        impact: {
          direction: 'unclear',
          rationale: 'No passage says how a berthing fee reaches pilots.',
        },
        plausibleActions: ['Carry on as licensed.', 'Ask the authority how a change reaches them.'],
        evidence: rests(SAYS.pilots),
        uncertainty: { level: 'medium', reason: 'One passage describes their licence.' },
        confidenceBasis: found(SAYS.pilots),
        populationSize: 25,
      }),
      participantOf({
        id: 'harbour-master',
        name: 'Harbour master who hears requests at public meetings',
        role: 'regulators-governance',
        category: 'governance',
        whyTheyMatter: 'It says how requests reach the board and when they are heard.',
        objective: 'Keep the hearing of requests orderly and on the record.',
        influence: 'medium',
        decisionAuthority: 'advises',
        directness: 'indirect',
        impact: {
          direction: 'unclear',
          rationale: 'No passage says how a change would affect the office.',
        },
        plausibleActions: ['Put the request to the board.', 'Set the date of the hearing.'],
        evidence: rests(SAYS.master),
        uncertainty: { level: 'medium', reason: 'One passage reports what it said.' },
        confidenceBasis: found(SAYS.master),
      }),
      participantOf({
        id: 'operators-association',
        name: 'Association of operators asking for longer notice',
        role: 'observers-influencers',
        category: 'influencer',
        whyTheyMatter: 'It speaks for operators and has asked for a longer notice period.',
        objective: 'Win a longer notice period before any change to a berthing fee.',
        pressures: ['Members who cannot plan around a yearly change.'],
        influence: 'medium',
        decisionAuthority: 'advises',
        directness: 'indirect',
        impact: {
          direction: 'mixed',
          rationale: 'Its members could be affected in different ways.',
        },
        plausibleActions: ['Press its request in public.', 'Ask the board to hear it.'],
        evidence: rests(SAYS.association),
        uncertainty: { level: 'medium', reason: 'One passage reports its request.' },
        confidenceBasis: found(SAYS.association),
      }),
    ],
    relations: [
      {
        from: 'fee-board',
        to: 'harbour-authority',
        type: 'influences',
        strength: 0.6,
        rationale: 'The board votes on the schedule that the authority puts forward.',
      },
      {
        from: 'operators-association',
        to: 'fee-board',
        type: 'influences',
        strength: 0.4,
        rationale: 'It asks the board to hear its request.',
      },
    ],
    gaps: [
      {
        role: 'beneficiaries',
        reason: 'No passage says who gains from the money that the fees bring in.',
      },
    ],
  };
}

function constraints(data: unknown): unknown {
  const passages = passagesOf(data);
  const rests = (words: string) => quoting(passages, words);
  return {
    constraints: [
      {
        category: 'regulatory',
        statement: 'Every pilot must renew the licence after two years of service on the quays.',
        evidence: rests(SAYS.renewal),
        hardness: 'hard',
        affectedActors: [],
        affectedAlternatives: [],
        window: 'Every two years',
      },
      {
        category: 'time',
        statement: 'Operators have asked for a longer notice period before any change to a fee.',
        evidence: rests(SAYS.association),
        hardness: 'soft',
        affectedActors: [],
        affectedAlternatives: [],
        window: '',
      },
      {
        category: 'budget',
        statement: 'The fees are weighed against the cost of running the quays.',
        evidence: rests(SAYS.costs),
        hardness: 'soft',
        affectedActors: [],
        affectedAlternatives: [],
        window: '',
      },
      {
        category: 'evidence-quality',
        statement: 'The review did not measure what a higher fee does to the number of calls.',
        evidence: rests(SAYS.unmeasured),
        hardness: 'soft',
        affectedActors: [],
        affectedAlternatives: [],
        window: '',
      },
    ],
    questions: [
      {
        category: 'legal',
        question: 'Does the licence renewal rule apply to every pilot who serves coastal vessels?',
        why: 'It could limit how many pilots are on hand when calls change.',
      },
    ],
  };
}

function criticism(data: unknown): unknown {
  const digest = data as { analysisId?: unknown; runsPerVariant?: unknown } | null;
  return {
    critiques: [
      {
        role: 'methodology',
        target: { kind: 'analysis', id: String(digest?.analysisId ?? '') },
        severity: 'minor',
        objection:
          'Every alternative is run on the same seeds, so the comparison shows how they differ under these assumptions and says little about how far the assumptions hold.',
        basis: [`runsPerVariant ${String(digest?.runsPerVariant ?? '')}`],
        evidencePassageIds: [],
        impactOnConclusion:
          'The result is a statement about the model, so it could change if the assumptions it leans on change.',
      },
    ],
  };
}

function ontology(): unknown {
  return {
    entityTypes: [
      {
        name: 'Organisation',
        description: 'A body named in the sources, such as the harbour authority or its board.',
      },
      {
        name: 'Group',
        description:
          'A group of firms or people named in the sources, such as the operators of coastal vessels.',
      },
      {
        name: 'Topic',
        description: 'A subject the sources discuss, such as a fee or a notice period.',
      },
    ],
    relationshipTypes: [
      { name: 'sets', description: 'One party sets, or votes on, what another has to follow.' },
      {
        name: 'asks',
        description: 'One party asks another for something, as the sources report it.',
      },
      { name: 'is licensed by', description: 'One party holds a licence that another gives.' },
    ],
  };
}

function sourceGraph(data: unknown): unknown {
  const passages = passagesOf(data);
  const node = (
    id: string,
    label: string,
    kind: 'topic' | 'organization' | 'group',
    entityType: string,
    summary: string,
    weight: number,
    words: string,
  ) => {
    const found = passages.find((passage) => passage.text.includes(words));
    return found
      ? { id, label, kind, entityType, summary, weight, sourceIds: [found.id], quote: words }
      : null;
  };
  const nodes = [
    node(
      'harbour_authority',
      'Harbour authority',
      'organization',
      'Organisation',
      'Reviews the berthing fees once a year, and its board votes on the schedule.',
      0.9,
      SAYS.schedule,
    ),
    node(
      'operators',
      'Operators of coastal vessels',
      'group',
      'Group',
      'Pay the berthing fee, and were asked what they pay each year.',
      0.8,
      SAYS.operators,
    ),
    node(
      'pilots',
      'Licensed pilots',
      'group',
      'Group',
      'Hold a licence from the authority, and renew it every two years.',
      0.5,
      SAYS.pilots,
    ),
    node(
      'berthing_fee',
      'Berthing fee',
      'topic',
      'Topic',
      'The charge for a berth, weighed against the cost of running the quays.',
      0.9,
      SAYS.costs,
    ),
    node(
      'notice_period',
      'Notice period',
      'topic',
      'Topic',
      'Operators have asked for a longer notice before a fee changes.',
      0.6,
      SAYS.association,
    ),
  ].filter((item): item is NonNullable<typeof item> => item !== null);
  const has = (id: string) => nodes.some((item) => item.id === id);
  const citing = (id: string) => nodes.find((item) => item.id === id)?.sourceIds ?? [];
  const edges = [
    ['harbour_authority', 'berthing_fee', 'sets', 0.8],
    ['operators', 'notice_period', 'asks', 0.6],
    ['pilots', 'harbour_authority', 'is licensed by', 0.5],
  ]
    .filter(([from, to]) => has(String(from)) && has(String(to)))
    .map(([from, to, label, weight]) => ({
      source: String(from),
      target: String(to),
      label: String(label),
      weight: Number(weight),
      sourceIds: citing(String(from)),
    }));
  return { nodes, edges };
}

function actorReading(data: unknown): unknown {
  const actors = (data as { actors?: { id: string; name: string }[] } | null)?.actors ?? [];
  return {
    actors: actors.map((actor) => ({
      id: actor.id,
      priorBelief: `Assumed from its role as ${actor.name.toLowerCase()}: nothing says where it stands before the change.`,
      objectives: [],
      concerns: [],
      constraints: [],
      traits: {},
    })),
  };
}

/** How the instructions of the task that proposes the participants, and of the one that reads the constraints, begin. */
export const PARTICIPANTS_OPENING = 'Propose the participants in the decision';
export const CONSTRAINTS_OPENING = 'Find the constraints of the decision in the data';

const TASKS: [string, (data: unknown) => unknown][] = [
  ['Read the question into a scenario frame', scenarioReading],
  ['You plan the research for a what-if question', researchPlan],
  ['Define a small ontology for the supplied sources', ontology],
  ['Extract a source-grounded graph under the supplied ontology', sourceGraph],
  [PARTICIPANTS_OPENING, participants],
  ['For each key actor in data.actors, propose where it stands', actorReading],
  [CONSTRAINTS_OPENING, constraints],
  ['You are an independent reviewer of a scenario analysis', criticism],
];

/** What to answer a request with, or undefined when this stand-in has nothing to say to it. */
export function naturalReply(request: RecordedRequest): FakeStep | undefined {
  const task = TASKS.find(([opening]) => request.system.includes(opening));
  return task ? { kind: 'reply', value: task[1](request.data) } : undefined;
}
