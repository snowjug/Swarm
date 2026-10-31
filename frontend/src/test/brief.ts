import {
  BRIEF_SECTION_IDS,
  BRIEF_SECTION_TITLES,
  decisionBriefSchema,
  type BriefRefs,
  type BriefSectionId,
  type BriefView,
  type BriefVisuals,
  type DecisionBrief,
  type StatementOrigin,
  type VisualKind,
} from '../../../shared/brief';
import { RESPONSE_CATEGORIES } from '../../../shared/analysis';

export const GENERATED_AT = '2026-02-01T10:00:00.000Z';

const refs = (overrides: Partial<BriefRefs> = {}): BriefRefs => ({
  evidence: [],
  stakeholderIds: [],
  findingIds: [],
  sensitivityIds: [],
  critiqueIds: [],
  assumptions: [],
  documentIds: [],
  variantIds: [],
  ...overrides,
});

const statement = (
  id: string,
  origin: StatementOrigin,
  text: string,
  support: Partial<BriefRefs> = {},
  reliance: 'high' | 'moderate' | 'low' | null = null,
) => ({ id, origin, text, refs: refs(support), reliance });

const VISUALS: Partial<Record<BriefSectionId, VisualKind[]>> = {
  stakeholders: ['stakeholder-map'],
  'evidence-base': ['evidence-map'],
  'reaction-patterns': ['outcome-distribution'],
  'alternative-outcomes': ['scenario-comparison'],
  uncertainty: ['sensitivity'],
  assumptions: ['assumption-register'],
};

export const NOT_TOLD =
  'What this does not tell you: how many real people act this way, how fast, or whether the assumptions hold. Simulated members are synthetic stand-ins for groups.';

/** A valid brief with every section, a few kinds of statement, two recommendations and two checks. */
export function briefFixture(overrides: Partial<DecisionBrief> = {}): DecisionBrief {
  const quote = 'Members of the group described how they react to a change of this kind.';
  const sections = BRIEF_SECTION_IDS.map((id) => ({
    id,
    title: BRIEF_SECTION_TITLES[id],
    visuals: VISUALS[id] ?? [],
    statements: [
      statement(`${id}-1`, 'simulation-aggregation', `A simulated statement in ${id}.`, {
        findingIds: ['f1'],
        variantIds: ['proposed-change'],
      }),
    ],
  }));
  const named = (id: BriefSectionId) => sections.find((section) => section.id === id)!;
  named('executive-answer').statements = [
    statement(
      'executive-answer-1',
      'simulation-aggregation',
      'About 19 simulated members ended up looking for an alternative or resisting under “Proposed change”, against about 4 under “No change”.',
      { findingIds: ['f1'], variantIds: ['proposed-change', 'baseline'] },
      'moderate',
    ),
    statement(
      'executive-answer-2',
      'unresolved-uncertainty',
      'Biggest open caveat: the simulated result is sensitive to “Subscribers: cost of switching”.',
      { sensitivityIds: ['s1'] },
    ),
    statement('executive-answer-3', 'unresolved-uncertainty', NOT_TOLD),
  ];
  named('stakeholders').statements = [
    statement(
      'stakeholders-1',
      'inferred-stakeholder',
      '“Subscribers” (Bears cost): 1 cited passage supports it.',
      {
        stakeholderIds: ['subscribers'],
        evidence: [
          {
            passageId: 'P1',
            documentId: 'doc-1',
            documentName: 'Supplied notes.md',
            start: 0,
            end: 80,
            quote,
            contentHash: 'a'.repeat(64),
            role: 'supports',
          },
        ],
      },
      'moderate',
    ),
  ];
  named('assumptions').statements = [
    statement(
      'assumptions-1',
      'system-assumption',
      '“Subscribers”: switching cost is set at 0.40 (Swarm filled it in as a default).',
      { sensitivityIds: ['s1'], assumptions: ['“Subscribers”: switching cost is set at 0.40'] },
    ),
    statement('assumptions-2', 'user-assumption', 'Scenario assumption “The group is reachable”.', {
      assumptions: ['The group is reachable.'],
    }),
  ];
  named('recommendations').statements = [
    statement(
      'recommendations-1',
      'system-assumption',
      'Recommendations are ordered by impact times repeatability divided by effort.',
      {
        assumptions: ['Ordered by impact times repeatability divided by effort.'],
      },
    ),
    statement(
      'rec-1',
      'simulation-aggregation',
      'Mitigate or stage the change for “Subscribers”: about 15 more of its 30 simulated members ended up adverse.',
      { findingIds: ['f2'] },
      'high',
    ),
    statement(
      'rec-2',
      'simulation-aggregation',
      'Validate the assumption “Subscribers”: switching cost before committing.',
      { findingIds: ['f2'] },
      'low',
    ),
  ];
  named('validation-plan').statements = [
    statement(
      'validation-plan-1',
      'system-assumption',
      'Each check below would test an assumption against the real world. None has been run.',
      {
        assumptions: ['The checks are proposals.'],
      },
    ),
    statement('val-1', 'unresolved-uncertainty', 'How long and how costly is it to switch?', {
      sensitivityIds: ['s1'],
    }),
  ];
  return decisionBriefSchema.parse({
    generatedAt: GENERATED_AT,
    analysisId: 'analysis-1',
    question: 'What could happen if the provider raises the fee?',
    headline:
      'With the rules engine, about 19 simulated members ended up looking for an alternative or resisting under “Proposed change”, against about 4 under “No change”. Biggest open caveat: the simulated result is sensitive to “Subscribers: cost of switching”.',
    sections,
    recommendations: [
      {
        id: 'rec-1',
        text: 'Mitigate or stage the change for “Subscribers”: about 15 more of its 30 simulated members ended up adverse.',
        linkedFindingIds: ['f2'],
        priority: 1,
        impact: 'high',
        effort: 'medium',
        reversibility: 'easy',
        horizon: 'Before committing, then through a staged rollout',
        ownerFunction: 'finance',
        leadingIndicators: ['Members of the affected group who ask to change or leave.'],
        assumptions: [],
        validation: 'Stage the change with a small group and compare their reaction.',
      },
      {
        id: 'rec-2',
        text: 'Validate the assumption “Subscribers”: switching cost before committing.',
        linkedFindingIds: ['f2'],
        priority: 2,
        impact: 'medium',
        effort: 'medium',
        reversibility: 'easy',
        horizon: 'Before committing',
        ownerFunction: 'research and analytics',
        leadingIndicators: ['Measured time and cost for the group to switch.'],
        assumptions: ['“Subscribers”: switching cost'],
        validation: 'A short survey and a few interviews with members of the group.',
      },
    ],
    validationPlan: [
      {
        id: 'val-1',
        targets: ['sensitivity s1: Subscribers: cost of switching, 0.2 higher'],
        question: 'How long and how costly is it for “Subscribers” to change?',
        method: 'A short survey and a few interviews, backed by a data pull.',
        successSignal: 'Measured time and cost are in line with the assumed value of 0.40.',
        effort: 'medium',
        duration: '2 to 4 weeks',
      },
    ],
    limitations: [
      'Synthetic actors are not real people. They stand in for groups under declared assumptions.',
      'Every count is a count of simulated members or of seeded runs. None is a rate.',
    ],
    fidelity: {
      engine: 'rules',
      keyActors: 'rules',
      cohorts: 'rules',
      repeatedRuns: 10,
      modelRepeats: 0,
      label: 'Rules: outcomes follow from the declared assumptions',
      caveats: [],
    },
    methodology: {
      runsPerVariant: 10,
      variants: ['No change', 'Proposed change'],
      baseSeed: 100,
      rounds: 8,
      notes: ['Every statement is assembled by rules.'],
    },
    openCritiques: 1,
    generatedBy: 'rules',
    inputRevisions: { analysis: 1 },
    ...overrides,
  });
}

export function visualsFixture(overrides: Partial<BriefVisuals> = {}): BriefVisuals {
  const responses = (values: number[]) =>
    RESPONSE_CATEGORIES.map((category, index) => ({
      category,
      mean: values[index] ?? 0,
      min: (values[index] ?? 0) - 1,
      max: (values[index] ?? 0) + 1,
    }));
  return {
    analysisId: 'analysis-1',
    runsPerVariant: 10,
    stakeholderMap: [
      {
        category: 'cost-bearer',
        label: 'Bears cost',
        stakeholders: [
          {
            id: 'subscribers',
            name: 'Subscribers',
            priority: 'standard',
            direction: 'harmed',
            supporting: 1,
            contradicting: 0,
            uncertainty: 'medium',
            origin: 'inferred-stakeholder',
          },
        ],
      },
      {
        category: 'competitor',
        label: 'Competitor',
        stakeholders: [
          {
            id: 'rival-provider',
            name: 'Rival provider',
            priority: 'key',
            direction: 'unclear',
            supporting: 0,
            contradicting: 0,
            uncertainty: 'high',
            origin: 'inferred-stakeholder',
          },
        ],
      },
    ],
    outcomeDistribution: [
      {
        variantId: 'baseline',
        label: 'No change',
        kind: 'baseline',
        runs: 10,
        members: 43,
        responses: responses([3.9, 7.8, 16, 12, 2.3, 1.6]),
        adverse: { mean: 3.9, min: 1.8, max: 5.7 },
        stanceMean: 0.12,
      },
      {
        variantId: 'proposed-change',
        label: 'Proposed change',
        kind: 'alternative',
        runs: 10,
        members: 43,
        responses: responses([2.4, 4.8, 9.6, 7.2, 11, 7.6]),
        adverse: { mean: 18.6, min: 17, max: 21 },
        stanceMean: -0.2,
      },
    ],
    scenarioComparison: [
      {
        variantId: 'proposed-change',
        label: 'Proposed change',
        members: 43,
        adverseMean: 18.6,
        baselineAdverseMean: 3.9,
        adverseDelta: 14.7,
        stanceMean: -0.2,
        stanceDelta: -0.32,
        pairedRuns: 10,
        worseInRuns: 10,
        findingId: 'f1',
        classification: 'mostly-repeatable',
        holdsIn: 10,
        of: 10,
      },
    ],
    sensitivity: [
      {
        id: 's1',
        label: 'Subscribers: cost of switching, 0.2 higher',
        metric: 'Share ending in switch or resist',
        shift: -0.18,
        standardError: 0.01,
        classification: 'assumption-sensitive',
        origin: 'system-assumption',
        evidenced: false,
      },
      {
        id: 's2',
        label: 'Subscribers: trust, 0.2 higher',
        metric: 'Share ending in switch or resist',
        shift: 0.04,
        standardError: 0.03,
        classification: 'inconclusive',
        origin: 'supplied-evidence',
        evidenced: true,
      },
    ],
    assumptionRegister: [
      {
        id: 'sensitivity-s1',
        text: '“Subscribers”: switching cost is set at 0.40 (Swarm filled it in as a default).',
        value: '0.40',
        origin: 'system-assumption',
        sensitive: true,
        evidenced: false,
        effect: 'moving it by +0.20 changed “Share ending in switch or resist” by -0.18',
      },
      {
        id: 'scenario-a-one',
        text: 'Scenario assumption “The group is reachable”.',
        value: null,
        origin: 'user-assumption',
        sensitive: false,
        evidenced: false,
        effect: null,
      },
    ],
    evidenceMap: [
      {
        stakeholderId: 'subscribers',
        name: 'Subscribers',
        category: 'cost-bearer',
        supporting: 1,
        contradicting: 0,
        documents: ['Supplied notes.md'],
        gap: false,
      },
      {
        stakeholderId: 'rival-provider',
        name: 'Rival provider',
        category: 'competitor',
        supporting: 0,
        contradicting: 0,
        documents: [],
        gap: true,
      },
    ],
    traitTable: [],
    lookups: {
      findings: [
        {
          id: 'f1',
          statement:
            'Under the proposed change, simulated members ended less favourable in 10 of 10 runs.',
          classification: 'mostly-repeatable',
          holdsIn: 10,
          of: 10,
          interval: { lo: 0.72, hi: 1 },
        },
        {
          id: 'f2',
          statement:
            'Most simulated subscribers ended up looking for an alternative in 6 of 10 runs.',
          classification: 'unstable',
          holdsIn: 6,
          of: 10,
          interval: { lo: 0.31, hi: 0.83 },
        },
      ],
      variants: [
        { id: 'baseline', label: 'No change' },
        { id: 'proposed-change', label: 'Proposed change' },
      ],
      stakeholders: [
        { id: 'subscribers', name: 'Subscribers' },
        { id: 'rival-provider', name: 'Rival provider' },
      ],
      documents: [],
    },
    ...overrides,
  };
}

export function viewFixture(overrides: Partial<BriefView> = {}): BriefView {
  return {
    brief: briefFixture(),
    visuals: visualsFixture(),
    latestAnalysis: { id: 'analysis-1', completedAt: GENERATED_AT },
    changedSince: [],
    may: { generate: true, export: true },
    ...overrides,
  };
}
