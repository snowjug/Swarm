import type { ClaimRecord } from '../../../shared/evidence';
import type {
  StudioCapabilities,
  StudioSectionView,
  StudioView,
  StudioVersion,
} from '../../../shared/studio';
import { claimRecord, conflictRecord } from './ledger';

const AT = '2026-02-01T10:00:00.000Z';

export const hash = (digit: string): string => digit.repeat(64);

export const version = (overrides: Partial<StudioVersion> = {}): StudioVersion => ({
  version: 1,
  body: 'The council counted 412,000 crossings in 2025.',
  origin: 'generated',
  actor: 'system',
  at: AT,
  reason: null,
  restoredFrom: null,
  ...overrides,
});

/** A chapter that still holds the generated text and the statements the ledger checked for it. */
export const sectionView = (overrides: Partial<StudioSectionView> = {}): StudioSectionView => {
  const body = overrides.body ?? 'The council counted 412,000 crossings in 2025.';
  return {
    id: 'S1',
    kind: 'chapter',
    title: 'What the sources show',
    body,
    version: 1,
    origin: 'generated',
    locked: null,
    citations: { sourceIds: ['S1'], memoryIds: [], interviewIds: [] },
    notes: [],
    versions: [version({ body })],
    statements: [claimRecord()],
    statementsCurrent: true,
    grounding: null,
    proposal: null,
    ...overrides,
  };
};

const hypothesis: ClaimRecord = claimRecord({
  id: 'C2',
  statementType: 'ai-hypothesis',
  text: 'Residents may switch to the ferry if fares fall.',
  supportClass: 'not-checkable',
  supporting: [],
  publication: { status: 'labelled-unverified', qualification: 'Not verified.', reasons: [] },
});

export const defaultSections = (): StudioSectionView[] => [
  sectionView({
    id: 'summary',
    kind: 'summary',
    title: 'Executive summary',
    body: 'A short summary of the report.',
    versions: [version({ body: 'A short summary of the report.' })],
    statements: [],
  }),
  sectionView({ statements: [claimRecord(), hypothesis] }),
  sectionView({
    id: 'S2',
    title: 'What the simulation produced',
    body: 'Simulated proxies split on the proposal.',
    versions: [version({ body: 'Simulated proxies split on the proposal.' })],
    statements: [],
  }),
  sectionView({
    id: 'limitations',
    kind: 'limitations',
    title: 'Limitations',
    body: 'Fictional proxies, not observations.\nThe sources are few.',
    versions: [version({ body: 'Fictional proxies, not observations.\nThe sources are few.' })],
    statements: [],
  }),
];

export const capabilities = (overrides: Partial<StudioCapabilities> = {}): StudioCapabilities => ({
  edit: true,
  review: false,
  export: true,
  ...overrides,
});

type Document = NonNullable<StudioView['document']>;

/** A studio view as the server sends it. `document: null` is a report nobody has opened yet. */
export function studioView(
  overrides: Partial<Omit<StudioView, 'document'>> & {
    document?: Partial<Document> | null;
  } = {},
): StudioView {
  const { document, ...rest } = overrides;
  return {
    document:
      document === null
        ? null
        : {
            schemaVersion: 1,
            revision: 3,
            state: 'draft',
            baseHash: hash('a'),
            createdAt: AT,
            createdBy: 'local-user',
            updatedAt: AT,
            sections: defaultSections(),
            approval: null,
            decisions: [
              { action: 'started', actor: 'local-user', at: AT, note: null, revision: 1 },
            ],
            archive: [],
            ...document,
          },
    stale: false,
    reportReady: true,
    capabilities: capabilities(),
    regeneration: { available: true, reason: null },
    passages: [
      {
        id: 'S1',
        documentId: 'D1',
        documentName: 'council-briefing.md',
        text: 'Council counts show 412,000 one-way crossings in 2025. The year before was lower.',
        start: 0,
        end: 80,
      },
    ],
    memories: [],
    assumptions: [
      { id: 'A1', statement: 'The proxies start from recorded opinions.', scope: 'scenario' },
    ],
    conflicts: [conflictRecord()],
    report: {
      title: 'Ferry crossing decision',
      question: 'Should the fictional council fund a ferry?',
      engine: 'local',
    },
    limits: { maxBody: 12_000, maxNote: 1_000, maxVersions: 100, maxInstruction: 500 },
    ...rest,
  };
}
