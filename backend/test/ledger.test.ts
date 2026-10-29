import { describe, expect, it } from 'vitest';
import {
  PUBLICATION_STATUSES,
  STATEMENT_TYPES,
  SUPPORT_CLASSES,
  type ClaimRecord,
  type EvidenceRef,
  type PublicationStatus,
  type StatementType,
  type SupportClass,
} from '../../shared/evidence.js';
import type { GroundedClaim, GroundingReview, SupportVerdict } from '../../shared/grounding.js';
import { SUPPORT_VERDICTS } from '../../shared/grounding.js';
import type { SimulationMemory } from '../../shared/guided.js';
import type { EvidenceChunk } from '../../shared/types.js';
import {
  MIN_FINDINGS_FOR_RECOMMENDATION,
  applyReview,
  assessSufficiency,
  buildClaimRecords,
  classifySupport,
  decidePublication,
  hashText,
} from '../src/grounding/ledger.js';

const NOW = new Date('2026-10-29T10:00:00.000Z');

function passage(id: string, text: string, documentId = 'D1'): EvidenceChunk {
  return { id, documentId, documentName: `${documentId}.md`, text, start: 0, end: text.length };
}

function ref(role: EvidenceRef['role'] = 'supports'): EvidenceRef {
  return {
    passageId: 'S1',
    documentId: 'D1',
    documentName: 'D1.md',
    start: 0,
    end: 40,
    quote: null,
    contentHash: hashText('x'),
    role,
  };
}

function claim(overrides: Partial<GroundedClaim> = {}): GroundedClaim {
  return {
    id: 'C1',
    section: 'Findings',
    text: 'The council note reports 412,000 annual passengers.',
    kind: 'extracted-claim',
    sourceIds: ['S1'],
    memoryIds: [],
    quote: null,
    verdict: 'supported',
    checks: { quote: null, overlap: 0.8, numbers: 'match', entailment: null },
    reason: 'Matches the cited passage.',
    ...overrides,
  };
}

function review(claims: GroundedClaim[]): GroundingReview {
  return {
    checkedAt: NOW.toISOString(),
    method: 'deterministic',
    claims,
    counts: { supported: 0, partial: 0, unsupported: 0, contradicted: 0, unchecked: 0 },
    unverifiedFigures: [],
    notes: [],
  };
}

const PENDING = { result: 'pending', note: null, reviewedAt: null } as const;

describe('classifySupport', () => {
  it('maps a source-backed statement from the verdict of its checks', () => {
    const base = { statementType: 'extracted-claim', contradicting: 0, assumptions: 0 } as const;
    expect(classifySupport({ ...base, verdict: 'supported' })).toBe('directly-supported');
    expect(classifySupport({ ...base, verdict: 'partial' })).toBe('partially-supported');
    expect(classifySupport({ ...base, verdict: 'contradicted' })).toBe('contradicted');
    expect(classifySupport({ ...base, verdict: 'unsupported' })).toBe('unsupported');
    expect(classifySupport({ ...base, verdict: 'unchecked' })).toBe('not-checkable');
  });

  it('never calls a statement directly supported when another source contradicts it', () => {
    expect(
      classifySupport({
        statementType: 'source-fact',
        verdict: 'supported',
        contradicting: 1,
        assumptions: 0,
      }),
    ).toBe('partially-supported');
  });

  it('keeps simulation results, hypotheses and inputs out of the source-backed classes', () => {
    const at = (statementType: StatementType, verdict: SupportVerdict) =>
      classifySupport({ statementType, verdict, contradicting: 0, assumptions: 0 });
    expect(at('simulated-event', 'supported')).toBe('simulation-derived');
    expect(at('simulated-event', 'unsupported')).toBe('unsupported');
    expect(at('analytical-conclusion', 'supported')).toBe('simulation-derived');
    expect(at('analytical-conclusion', 'unchecked')).toBe('not-checkable');
    expect(at('ai-hypothesis', 'supported')).toBe('not-checkable');
    expect(at('user-assumption', 'supported')).toBe('not-applicable');
    expect(at('unresolved-uncertainty', 'unchecked')).toBe('not-applicable');
  });

  it('classes a recommendation as assumption dependent only when it names an assumption', () => {
    const recommendation = (assumptions: number) =>
      classifySupport({
        statementType: 'recommendation',
        verdict: 'supported',
        contradicting: 0,
        assumptions,
      });
    expect(recommendation(1)).toBe('assumption-dependent');
    expect(recommendation(0)).toBe('not-checkable');
  });

  it('only ever calls source-backed statements, or a verified conflict, directly supported', () => {
    for (const statementType of STATEMENT_TYPES) {
      for (const verdict of SUPPORT_VERDICTS) {
        for (const contradicting of [0, 1]) {
          for (const assumptions of [0, 2]) {
            const support = classifySupport({ statementType, verdict, contradicting, assumptions });
            if (support === 'directly-supported') {
              expect(
                statementType === 'contradicting-evidence' ||
                  (['source-fact', 'extracted-claim'].includes(statementType) &&
                    verdict === 'supported' &&
                    contradicting === 0),
                `${statementType}/${verdict}/${contradicting}`,
              ).toBe(true);
            }
          }
        }
      }
    }
  });

  it('gives every combination exactly one class from the defined set', () => {
    for (const statementType of STATEMENT_TYPES) {
      for (const verdict of SUPPORT_VERDICTS) {
        const support = classifySupport({
          statementType,
          verdict,
          contradicting: 0,
          assumptions: 0,
        });
        expect(SUPPORT_CLASSES).toContain(support);
      }
    }
  });
});

describe('decidePublication', () => {
  const evidence = (supporting: number, contradicting: number) => ({
    supporting: Array.from({ length: supporting }, () => ref('supports')),
    contradicting: Array.from({ length: contradicting }, () => ref('contradicts')),
  });
  const decide = (
    supportClass: SupportClass,
    supporting = 1,
    contradicting = 0,
    assumptionIds: string[] = [],
    review: { result: 'pending' | 'accepted' | 'rejected' | 'needs-revision' } = {
      result: 'pending',
    },
  ) =>
    decidePublication({
      statementType: 'extracted-claim',
      supportClass,
      ...evidence(supporting, contradicting),
      assumptionIds,
      review: { ...PENDING, ...review },
      reason: 'because',
    });

  it('presents a directly supported statement as a finding, and only that', () => {
    expect(decide('directly-supported').status).toBe('finding');
    for (const supportClass of SUPPORT_CLASSES.filter((value) => value !== 'directly-supported')) {
      expect(decide(supportClass, 1, 1, ['A1']).status, supportClass).not.toBe('finding');
    }
  });

  it('refuses to publish a finding that has no resolvable source passage', () => {
    const publication = decide('directly-supported', 0);
    expect(publication.status).toBe('labelled-unverified');
    expect(publication.reasons.join(' ')).toMatch(/resolvable source passage/u);
  });

  it('qualifies a partly supported statement and shows any conflicting source', () => {
    const partial = decide('partially-supported');
    expect(partial.status).toBe('qualified');
    expect(partial.qualification).toMatch(/partly supported/iu);
    const mixed = decide('partially-supported', 1, 1);
    expect(mixed.status).toBe('contradiction-shown');
    expect(mixed.qualification).toMatch(/another source conflicts/iu);
  });

  it('shows a contradicted statement only together with the passage that contradicts it', () => {
    expect(decide('contradicted', 1, 1).status).toBe('contradiction-shown');
    const withheld = decide('contradicted', 1, 0);
    expect(withheld.status).toBe('withheld');
    expect(withheld.reasons.join(' ')).toMatch(/without the contradicting passage/u);
  });

  it('labels an unsupported statement as a hypothesis, never a finding', () => {
    const publication = decide('unsupported');
    expect(publication.status).toBe('labelled-hypothesis');
    expect(publication.qualification).toMatch(/hypothesis/iu);
  });

  it('labels a simulated result as simulated and lists the assumptions it depends on', () => {
    const publication = decide('simulation-derived', 0, 0, ['A1', 'A2']);
    expect(publication.status).toBe('labelled-simulation');
    expect(publication.qualification).toMatch(/not observed/iu);
    expect(publication.qualification).toContain('A1, A2');
  });

  it('names the assumption on an assumption-dependent statement or does not verify it', () => {
    const named = decide('assumption-dependent', 0, 0, ['A3']);
    expect(named.status).toBe('qualified');
    expect(named.qualification).toContain('A3');
    expect(decide('assumption-dependent', 0, 0, []).status).toBe('labelled-unverified');
  });

  it('never shows a statement that cannot be checked as verified', () => {
    expect(decide('not-checkable').status).toBe('labelled-unverified');
    expect(decide('not-applicable').status).toBe('input');
  });

  it('lets a reviewer withhold or flag a statement but never upgrade one', () => {
    expect(decide('directly-supported', 1, 0, [], { result: 'rejected' }).status).toBe('withheld');
    expect(decide('directly-supported', 1, 0, [], { result: 'needs-revision' }).status).toBe(
      'labelled-unverified',
    );
    // Acceptance leaves the class, and so the presentation, exactly where the evidence put it.
    for (const supportClass of SUPPORT_CLASSES) {
      const pending = decide(supportClass, 1, 1, ['A1']);
      const accepted = decide(supportClass, 1, 1, ['A1'], { result: 'accepted' });
      expect(accepted, supportClass).toEqual(pending);
    }
  });

  it('always returns a status from the defined set', () => {
    for (const supportClass of SUPPORT_CLASSES) {
      for (const result of ['pending', 'accepted', 'rejected', 'needs-revision'] as const) {
        for (const supporting of [0, 1]) {
          for (const contradicting of [0, 1]) {
            const status: PublicationStatus = decide(supportClass, supporting, contradicting, [], {
              result,
            }).status;
            expect(PUBLICATION_STATUSES).toContain(status);
          }
        }
      }
    }
  });
});

describe('buildClaimRecords', () => {
  const text = 'The council note reports 412,000 annual passengers on the island ferry route.';
  const passages = new Map([['S1', passage('S1', text)]]);
  const memories = new Map<string, SimulationMemory>([
    [
      'M1',
      {
        id: 'M1',
        platform: 'plaza',
        round: 2,
        simulatedMinute: 30,
        kind: 'action',
        agentId: 'agent-1',
        actionType: 'post',
        text: 'A post.',
        opinion: 0.2,
        peerIds: [],
        sourceIds: [],
      },
    ],
  ]);
  const base = {
    projectId: 'p1',
    parentId: null,
    branchFromRound: null,
    passages,
    memories,
    assumptions: [
      { id: 'A1', statement: 'Run an electric ferry trial', scope: 'scenario' as const },
      { id: 'A2', statement: 'Ridership stays flat', scope: 'general' as const },
    ],
    conflicts: [],
    now: NOW,
  };

  it('creates one record per statement with evidence, hash, lineage and history', () => {
    const records = buildClaimRecords({
      ...base,
      parentId: 'p0',
      branchFromRound: 3,
      review: review([claim({ quote: 'reports 412,000 annual passengers' })]),
    });
    expect(records).toHaveLength(1);
    const [record] = records;
    expect(record?.supportClass).toBe('directly-supported');
    expect(record?.publication.status).toBe('finding');
    expect(record?.supporting[0]).toMatchObject({
      passageId: 'S1',
      documentId: 'D1',
      quote: 'reports 412,000 annual passengers',
      contentHash: hashText(text),
    });
    expect(record?.lineage).toEqual({ projectId: 'p1', parentId: 'p0', branchFromRound: 3 });
    expect(record?.history).toHaveLength(1);
    expect(record?.history[0]).toMatchObject({ version: 1, actor: 'system' });
    expect(record?.review).toEqual(PENDING);
  });

  it('keeps a quote that is not in the passage out of the evidence', () => {
    const [record] = buildClaimRecords({
      ...base,
      review: review([claim({ quote: 'a sentence the passage never contains' })]),
    });
    expect(record?.supporting[0]?.quote).toBeNull();
  });

  it('drops a citation that does not resolve instead of inventing evidence', () => {
    const [record] = buildClaimRecords({ ...base, review: review([claim({ sourceIds: ['S9'] })]) });
    expect(record?.supporting).toEqual([]);
    expect(record?.publication.status).toBe('labelled-unverified');
  });

  it('turns a model contradiction into evidence that is shown with the statement', () => {
    const quote = 'annual passengers on the island ferry route';
    const [record] = buildClaimRecords({
      ...base,
      review: review([
        claim({
          verdict: 'contradicted',
          checks: {
            quote: null,
            overlap: 0.6,
            numbers: 'mismatch',
            entailment: 'contradicts',
            entailmentQuote: quote,
          },
        }),
      ]),
    });
    expect(record?.supportClass).toBe('contradicted');
    expect(record?.contradicting).toHaveLength(1);
    expect(record?.contradicting[0]?.quote).toBe(quote);
    expect(record?.publication.status).toBe('contradiction-shown');
  });

  it('withholds a contradicted statement when no contradicting passage can be shown', () => {
    const [record] = buildClaimRecords({
      ...base,
      review: review([
        claim({
          verdict: 'contradicted',
          checks: { quote: null, overlap: 0.6, numbers: null, entailment: 'contradicts' },
        }),
      ]),
    });
    expect(record?.publication.status).toBe('withheld');
  });

  it('downgrades a supported statement when a different source conflicts with the cited one', () => {
    const other: EvidenceRef = {
      ...ref('contradicts'),
      passageId: 'S2',
      documentId: 'D2',
      quote: '365,000 passengers',
    };
    const [record] = buildClaimRecords({
      ...base,
      conflicts: [{ id: 'X1', left: { ...ref(), passageId: 'S1' }, right: other }],
      review: review([claim()]),
    });
    expect(record?.supportClass).toBe('partially-supported');
    expect(record?.contradicting[0]?.passageId).toBe('S2');
    expect(record?.publication.status).toBe('contradiction-shown');
  });

  it('lists the scenario inputs on a simulated statement and links the memory it cites', () => {
    const [record] = buildClaimRecords({
      ...base,
      review: review([
        claim({
          kind: 'simulated-event',
          sourceIds: [],
          memoryIds: ['M1'],
          text: 'Proxies split in round 2.',
        }),
      ]),
    });
    expect(record?.supportClass).toBe('simulation-derived');
    expect(record?.assumptionIds).toEqual(['A1']);
    expect(record?.simulationEvents).toEqual([{ memoryId: 'M1', platform: 'plaza', round: 2 }]);
    expect(record?.publication.status).toBe('labelled-simulation');
    expect(record?.publication.qualification).toContain('A1');
  });

  it('is a pure function of its inputs', () => {
    const input = {
      ...base,
      review: review([claim(), claim({ id: 'C2', kind: 'ai-hypothesis' })]),
    };
    expect(buildClaimRecords(input)).toEqual(buildClaimRecords(input));
  });
});

describe('applyReview', () => {
  const [record] = buildClaimRecords({
    projectId: 'p1',
    parentId: null,
    branchFromRound: null,
    passages: new Map([
      ['S1', passage('S1', 'The council note reports 412,000 annual passengers on the ferry.')],
    ]),
    memories: new Map(),
    assumptions: [],
    conflicts: [],
    now: NOW,
    review: review([claim({ verdict: 'unsupported', reason: 'No passage backs it.' })]),
  });

  it('records the review, bumps the version and appends history without changing the evidence', () => {
    if (!record) throw new Error('fixture');
    const reviewed = applyReview(
      record,
      { result: 'accepted', note: 'Checked with the owner.' },
      new Date('2026-10-30T00:00:00Z'),
    );
    expect(reviewed.version).toBe(2);
    expect(reviewed.review).toEqual({
      result: 'accepted',
      note: 'Checked with the owner.',
      reviewedAt: '2026-10-30T00:00:00.000Z',
    });
    expect(reviewed.history).toHaveLength(2);
    expect(reviewed.history[1]).toMatchObject({ version: 2, actor: 'reviewer' });
    expect(reviewed.supportClass).toBe(record.supportClass);
    expect(reviewed.supporting).toEqual(record.supporting);
    expect(record.version).toBe(1);
  });

  it('cannot turn an unsupported statement into a finding by accepting it', () => {
    if (!record) throw new Error('fixture');
    expect(record.supportClass).toBe('unsupported');
    expect(applyReview(record, { result: 'accepted', note: null }, NOW).publication.status).toBe(
      'labelled-hypothesis',
    );
  });

  it('withholds a statement a reviewer rejects', () => {
    if (!record) throw new Error('fixture');
    expect(applyReview(record, { result: 'rejected', note: null }, NOW).publication.status).toBe(
      'withheld',
    );
  });
});

describe('assessSufficiency', () => {
  function records(supportClasses: SupportClass[]): ClaimRecord[] {
    return supportClasses.map((supportClass, index) => ({
      id: `C${index + 1}`,
      version: 1,
      statementType: 'extracted-claim',
      text: `Statement ${index + 1} about the council.`,
      section: 'Findings',
      generationStage: 'report',
      supportClass,
      supporting: [ref()],
      contradicting: [],
      assumptionIds: [],
      simulationEvents: [],
      lineage: { projectId: 'p', parentId: null, branchFromRound: null },
      verification: {
        method: 'deterministic',
        verdict: 'supported',
        reason: '',
        quote: null,
        overlap: 1,
        numbers: null,
        entailment: null,
      },
      review: PENDING,
      publication: { status: 'finding', qualification: null, reasons: [] },
      history: [],
    }));
  }
  const direct = (count: number): SupportClass[] =>
    Array.from({ length: count }, () => 'directly-supported');

  it('is insufficient when nothing rests on a source', () => {
    const result = assessSufficiency([], 0);
    expect(result.level).toBe('insufficient');
    expect(result.directlySupportedShare).toBeNull();
    expect(result.reasons.join(' ')).toMatch(/No statement rests on a source/u);
  });

  it(`is insufficient below ${MIN_FINDINGS_FOR_RECOMMENDATION} directly supported findings`, () => {
    expect(assessSufficiency(records(direct(2)), 0).level).toBe('insufficient');
    expect(assessSufficiency(records(direct(3)), 0).level).not.toBe('insufficient');
  });

  it('is insufficient when fewer than half the source-backed statements are directly supported', () => {
    const result = assessSufficiency(
      records([...direct(3), ...Array.from({ length: 4 }, () => 'unsupported' as const)]),
      0,
    );
    expect(result.level).toBe('insufficient');
    expect(result.reasons.join(' ')).toMatch(/43%/u);
  });

  it('is limited, not sufficient, when a contradiction or an open conflict remains', () => {
    expect(assessSufficiency(records([...direct(5), 'contradicted']), 0).level).toBe('limited');
    expect(assessSufficiency(records(direct(5)), 1).level).toBe('limited');
  });

  it('is sufficient only when enough strongly supported findings stand with no open conflict', () => {
    const result = assessSufficiency(records(direct(4)), 0);
    expect(result.level).toBe('sufficient');
    expect(result.directlySupportedShare).toBe(1);
    expect(result.counts['directly-supported']).toBe(4);
  });
});
