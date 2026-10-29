import type {
  ClaimRecord,
  ContradictionRecord,
  EvidenceRef,
  EvidenceSufficiency,
  Ledger,
} from '../../../shared/evidence';

export const evidenceRef = (overrides: Partial<EvidenceRef> = {}): EvidenceRef => ({
  passageId: 'S1',
  documentId: 'D1',
  documentName: 'council-briefing.md',
  start: 0,
  end: 120,
  quote: 'Council counts show 412,000 one-way crossings in 2025.',
  contentHash: 'a'.repeat(64),
  role: 'supports',
  ...overrides,
});

export const claimRecord = (overrides: Partial<ClaimRecord> = {}): ClaimRecord => ({
  id: 'C1',
  version: 1,
  statementType: 'source-fact',
  text: 'The council counted 412,000 crossings in 2025.',
  section: 'Evidence',
  generationStage: 'report',
  supportClass: 'directly-supported',
  supporting: [evidenceRef()],
  contradicting: [],
  assumptionIds: [],
  simulationEvents: [],
  lineage: { projectId: 'p1', parentId: null, branchFromRound: null },
  verification: {
    method: 'deterministic',
    verdict: 'supported',
    reason: 'Matches the cited passage.',
    quote: 'found',
    overlap: 1,
    numbers: 'match',
    entailment: null,
  },
  review: { result: 'pending', note: null, reviewedAt: null },
  publication: { status: 'finding', qualification: null, reasons: [] },
  history: [],
  ...overrides,
});

export const conflictRecord = (
  overrides: Partial<ContradictionRecord> = {},
): ContradictionRecord => ({
  id: 'X1',
  kind: 'numeric',
  topic: 'crossings one-way',
  left: evidenceRef({ role: 'contradicts' }),
  right: evidenceRef({
    passageId: 'S2',
    documentId: 'D2',
    documentName: 'operator-memo.md',
    quote: 'Our ticketing system recorded 365,000 one-way crossings in 2025.',
    role: 'contradicts',
  }),
  leftValue: '412,000',
  rightValue: '365,000',
  confidence: 0.6,
  status: 'detected',
  note: null,
  detectedBy: 'deterministic-v1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

export const sufficiency = (
  level: EvidenceSufficiency['level'] = 'sufficient',
  overrides: Partial<EvidenceSufficiency> = {},
): EvidenceSufficiency => ({
  level,
  reasons: [],
  counts: {
    'directly-supported': 0,
    'partially-supported': 0,
    contradicted: 0,
    unsupported: 0,
    'not-applicable': 0,
    'not-checkable': 0,
    'simulation-derived': 0,
    'assumption-dependent': 0,
  },
  directlySupportedShare: null,
  ...overrides,
});

export const ledgerFixture = (overrides: Partial<Ledger> = {}): Ledger => ({
  claims: [
    claimRecord(),
    claimRecord({
      id: 'C2',
      statementType: 'ai-hypothesis',
      text: 'Residents may switch to the ferry if fares fall.',
      supportClass: 'not-checkable',
      supporting: [],
      publication: {
        status: 'labelled-unverified',
        qualification: 'Not verified.',
        reasons: [],
      },
    }),
    claimRecord({
      id: 'C3',
      text: 'The Council has approved the ferry.',
      supportClass: 'unsupported',
      publication: {
        status: 'labelled-hypothesis',
        qualification: 'No cited source supports this.',
        reasons: [],
      },
      review: { result: 'rejected', note: null, reviewedAt: '2026-01-02T00:00:00.000Z' },
    }),
  ],
  contradictions: [conflictRecord()],
  sufficiency: sufficiency('limited', { reasons: ['Only 1 directly supported finding.'] }),
  reviewedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});
