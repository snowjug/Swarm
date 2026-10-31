import {
  analysisSchema,
  emptyResponseShares,
  type Analysis,
  type Finding,
  type SensitivityRow,
} from '../../../shared/analysis.js';
import { critiqueSetSchema, type CritiqueSet } from '../../../shared/critique.js';
import type { EvidenceRef } from '../../../shared/evidence.js';
import {
  FIXTURE_TIME,
  actorSetFixture,
  analysisFixture,
  scenarioFixture,
  stakeholderSetFixture,
} from '../../../shared/lab-fixtures.js';
import type { StakeholderSet } from '../../../shared/stakeholders.js';
import type { BriefDocument } from '../../src/brief/evidence.js';
import type { BriefInputs, BriefLedgerSummary } from '../../src/brief/facts.js';

export const TIME = FIXTURE_TIME;

export function passage(overrides: Partial<EvidenceRef> = {}): EvidenceRef {
  return {
    passageId: 'P1',
    documentId: 'doc-1',
    documentName: 'Supplied notes.md',
    start: 0,
    end: 120,
    quote: 'Members of the group described how they react to a change of this kind.',
    contentHash: 'a'.repeat(64),
    role: 'supports',
    ...overrides,
  };
}

/** One document of every kind of provenance. */
export function documentsFixture(): BriefDocument[] {
  return [
    { id: 'doc-1', name: 'Supplied notes.md' },
    {
      id: 'doc-2',
      name: 'Public page',
      provenance: {
        kind: 'url',
        url: 'https://example.test/page',
        finalUrl: 'https://example.test/page',
        retrievedAt: TIME,
        sha256: 'b'.repeat(64),
        contentType: 'text/html',
        fetchedByServer: true,
      },
    },
    {
      id: 'doc-3',
      name: 'Pasted address.md',
      provenance: { kind: 'url', url: 'https://example.test/other' },
    },
    {
      id: 'doc-4',
      name: 'Earlier case.md',
      provenance: { kind: 'historical', asOf: '2020-06-01' },
    },
  ];
}

export function baseInputs(overrides: Partial<BriefInputs> = {}): BriefInputs {
  return {
    project: {
      id: 'project-1',
      name: 'Fee review',
      question: 'What could happen if the provider raises the fee?',
    },
    scenario: scenarioFixture(),
    stakeholders: stakeholderSetFixture(),
    actors: actorSetFixture(),
    analysis: analysisFixture(),
    critiques: null,
    documents: [],
    ledgerSummary: null,
    generatedAt: TIME,
    ...overrides,
  };
}

function sharesFor(adverse: number) {
  const shares = emptyResponseShares();
  shares.resist = adverse * 0.4;
  shares.switch = adverse * 0.6;
  shares.wait = (1 - adverse) * 0.4;
  shares['adapt-defensively'] = (1 - adverse) * 0.3;
  shares['accept-with-conditions'] = (1 - adverse) * 0.2;
  shares.adopt = (1 - adverse) * 0.1;
  return shares;
}

const finding = (
  id: string,
  overrides: Partial<Finding> & Pick<Finding, 'kind' | 'classification'>,
): Finding => ({
  variantId: 'proposed-change',
  actorId: null,
  statement: `Simulated finding ${id}.`,
  predicate: 'A predicate that can be checked against each run.',
  holdsIn: 10,
  of: 10,
  interval: { lo: 0.72, hi: 1 },
  ...overrides,
  id,
});

const row = (
  id: string,
  overrides: Partial<SensitivityRow> & Pick<SensitivityRow, 'target' | 'assumptionOrigin'>,
): SensitivityRow => ({
  label: `Assumption ${id} moved`,
  perturbation: 0.2,
  metric: 'Share ending in switch or resist',
  baseMean: 0.45,
  shift: -0.12,
  standardError: 0.01,
  classification: 'assumption-sensitive',
  ...overrides,
  id,
});

/** An analysis with a repeatable adverse finding for a harmed cohort, a competitor event chain and a spread of sensitivity rows. */
export function richAnalysis(): Analysis {
  const base = analysisFixture();
  return analysisSchema.parse({
    ...base,
    findings: [
      base.findings[0],
      finding('f2', {
        kind: 'majority-response',
        actorId: 'subscribers',
        statement:
          'Most simulated subscribers ended up looking for an alternative or resisting in 10 of 10 runs.',
        classification: 'repeatable',
      }),
      finding('f3', {
        kind: 'second-order-event',
        actorId: 'rival-provider',
        statement: 'A simulated counter-move by the rival provider followed in 9 of 10 runs.',
        holdsIn: 9,
        interval: { lo: 0.6, hi: 0.98 },
        classification: 'mostly-repeatable',
      }),
      finding('f4', {
        kind: 'ordering',
        statement: 'The proposed change left more simulated members adverse than no change.',
        holdsIn: 5,
        of: 10,
        interval: { lo: 0.24, hi: 0.76 },
        classification: 'unstable',
      }),
    ],
    sensitivity: [
      row('s1', {
        target: { kind: 'trait', actorId: 'subscribers', trait: 'switchingCost' },
        label: 'Subscribers: cost of switching, 0.2 higher',
        assumptionOrigin: 'system-assumption',
        shift: -0.18,
      }),
      row('s2', {
        target: { kind: 'trait', actorId: 'subscribers', trait: 'trust' },
        label: 'Subscribers: trust, 0.2 higher',
        assumptionOrigin: 'evidence',
        shift: 0.14,
      }),
      row('s3', {
        target: { kind: 'intensity', actorId: null, trait: null },
        label: 'Strength of the change, 0.2 higher',
        assumptionOrigin: 'scenario',
        shift: 0.31,
      }),
      row('s4', {
        target: { kind: 'trait', actorId: 'resellers', trait: 'openness' },
        label: 'Resellers: openness, 0.2 higher',
        assumptionOrigin: 'user',
        shift: 0.01,
        classification: 'robust',
      }),
      row('s5', {
        target: { kind: 'population', actorId: 'subscribers', trait: null },
        label: 'Subscribers: population, twice as large',
        assumptionOrigin: 'system-assumption',
        shift: 0.04,
        standardError: 0.04,
        classification: 'inconclusive',
      }),
    ],
    representativeRun: {
      seed: 104,
      variantId: 'proposed-change',
      rounds: [
        {
          round: 1,
          stanceMean: -0.2,
          responseShares: sharesFor(0.45),
          byActor: [{ actorId: 'subscribers', stanceMean: -0.2 }],
          signals: {},
        },
      ],
      final: {
        stanceMean: -0.2,
        responseShares: sharesFor(0.45),
        byActor: [
          {
            actorId: 'subscribers',
            members: 30,
            stanceMean: -0.2,
            responseShares: sharesFor(0.45),
          },
        ],
      },
      events: [
        {
          id: 'e1',
          round: 2,
          kind: 'announcement',
          actorId: 'provider',
          description: 'The provider announced the change.',
          causedBy: [],
        },
        {
          id: 'e2',
          round: 3,
          kind: 'counter-move',
          actorId: 'rival-provider',
          description: 'The rival provider answered with an offer aimed at the affected group.',
          causedBy: ['e1'],
        },
        {
          id: 'e3',
          round: 4,
          kind: 'scrutiny',
          actorId: 'regulator',
          description: 'The regulator asked for information.',
          causedBy: ['e1', 'share-leaning-to-switch'],
        },
      ],
      work: { members: 43, updates: 344 },
    },
  });
}

/** The fixture stakeholders, with cited passages for the cohort the findings are about. */
export function richStakeholders(): StakeholderSet {
  const set = stakeholderSetFixture();
  const subscribers = set.stakeholders.find((entry) => entry.id === 'subscribers');
  if (subscribers) {
    subscribers.evidence = [
      passage(),
      passage({
        passageId: 'P2',
        documentId: 'doc-2',
        documentName: 'Public page',
        start: 200,
        end: 320,
        quote: 'The page describes how the group responded to an earlier change.',
      }),
    ];
    subscribers.assumptions = ['The group is assumed to be reachable by the provider.'];
  }
  set.gaps = ['No source speaks for the regulator.'];
  return set;
}

export function critiquesFixture(analysisId: string | null = 'analysis-1'): CritiqueSet {
  return critiqueSetSchema.parse({
    analysisId,
    generatedAt: TIME,
    mode: 'rules',
    critiques: [
      {
        id: 'c1',
        role: 'assumption',
        target: { kind: 'finding', id: 'f2' },
        severity: 'major',
        objection: 'The result rests on an assumption that nothing cited supports.',
        origin: 'rules',
        status: 'open',
        createdAt: TIME,
      },
      {
        id: 'c2',
        role: 'methodology',
        target: { kind: 'analysis', id: 'analysis-1' },
        severity: 'minor',
        objection: 'There are only ten seeded runs for each variant.',
        origin: 'rules',
        status: 'accepted',
        createdAt: TIME,
      },
    ],
  });
}

export function ledgerFixture(): BriefLedgerSummary {
  return {
    conflicts: [
      {
        id: 'X1',
        topic: 'monthly volume',
        status: 'detected',
        left: passage({ passageId: 'P1', documentId: 'doc-1', quote: 'The volume is 12 a month.' }),
        right: passage({
          passageId: 'P3',
          documentId: 'doc-3',
          documentName: 'Pasted address.md',
          role: 'contradicts',
          quote: 'The volume is 15 a month.',
        }),
        leftValue: '12',
        rightValue: '15',
      },
    ],
    sufficiency: { level: 'limited', reasons: ['Only one statement is directly supported.'] },
  };
}

/** Everything the brief can be made from, with evidence, conflicts, critiques and every kind of source. */
export function richInputs(overrides: Partial<BriefInputs> = {}): BriefInputs {
  return baseInputs({
    scenario: scenarioFixture({
      evidenceAvailable: ['A summary of earlier changes that the person has on file'],
      evidenceMissing: ['Independent counts of the group the change affects'],
    }),
    stakeholders: richStakeholders(),
    analysis: richAnalysis(),
    critiques: critiquesFixture(),
    documents: documentsFixture(),
    ledgerSummary: ledgerFixture(),
    inputRevisions: { scenario: 1, stakeholders: 2, actors: 1, analysis: 3, critiques: 1 },
    ...overrides,
  });
}
