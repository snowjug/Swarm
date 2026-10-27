import {
  emptyVerdictCounts,
  type GroundedClaim,
  type GroundingReview,
} from '../../../shared/grounding';
import type { SimulationReport } from '../../../shared/types';

export function claimFixture(overrides: Partial<GroundedClaim> = {}): GroundedClaim {
  return {
    id: 'C1',
    section: 'Chapter one',
    text: 'A synthetic statement written only for frontend tests.',
    kind: 'extracted-claim',
    sourceIds: ['S1'],
    memoryIds: [],
    quote: null,
    verdict: 'supported',
    checks: { quote: null, overlap: 0.8, numbers: null, entailment: 'supports' },
    reason: 'Synthetic reason: the cited passage backs this statement.',
    ...overrides,
  };
}

/** A review whose counts are derived from its claims, as the server derives them. */
export function reviewFixture(
  claims: GroundedClaim[],
  overrides: Partial<GroundingReview> = {},
): GroundingReview {
  const counts = emptyVerdictCounts();
  for (const claim of claims) counts[claim.verdict] += 1;
  return {
    checkedAt: '2026-01-02T03:04:05.000Z',
    method: 'deterministic+model',
    claims,
    counts,
    unverifiedFigures: [],
    notes: [],
    ...overrides,
  };
}

/** Seven statements over two chapters: all six kinds and all five verdicts appear. */
export function allKindsAndVerdicts(): GroundedClaim[] {
  return [
    claimFixture({
      id: 'C1',
      kind: 'source-fact',
      verdict: 'supported',
      text: 'Synthetic source fact one.',
      quote: 'a verbatim excerpt of the passage',
      checks: { quote: 'found', overlap: 0.9, numbers: null, entailment: 'supports' },
      reason: 'Reason one: the quote was found verbatim in S1.',
    }),
    claimFixture({
      id: 'C2',
      kind: 'extracted-claim',
      verdict: 'partial',
      sourceIds: ['S1', 'S2'],
      text: 'Synthetic extracted claim two.',
      reason: 'Reason two: only part of it is backed.',
    }),
    claimFixture({
      id: 'C3',
      kind: 'user-assumption',
      verdict: 'unchecked',
      sourceIds: [],
      text: 'Synthetic user assumption three.',
      reason: 'Reason three: an input the user chose.',
    }),
    claimFixture({
      id: 'C4',
      section: 'Chapter two',
      kind: 'ai-hypothesis',
      verdict: 'unchecked',
      sourceIds: [],
      text: 'Synthetic hypothesis four.',
      reason: 'Reason four: speculation, not checkable.',
    }),
    claimFixture({
      id: 'C5',
      section: 'Chapter two',
      kind: 'simulated-event',
      verdict: 'unsupported',
      sourceIds: [],
      memoryIds: ['M-3'],
      text: 'Synthetic simulated event five.',
      reason: 'Reason five: nothing in the cited memory backs it.',
    }),
    claimFixture({
      id: 'C6',
      section: 'Chapter two',
      kind: 'analytical-conclusion',
      verdict: 'supported',
      sourceIds: [],
      text: 'Synthetic analytical conclusion six.',
      reason: 'Reason six: the figures match the recorded metrics.',
    }),
    claimFixture({
      id: 'C7',
      section: 'Chapter two',
      kind: 'extracted-claim',
      verdict: 'contradicted',
      text: 'Synthetic contradicted claim seven.',
      reason: 'Reason seven: the cited passage says the opposite.',
    }),
  ];
}

export function modelReportFixture(
  grounding?: GroundingReview,
  titles: string[] = ['Chapter one', 'Chapter two'],
): SimulationReport {
  return {
    generatedBy: 'llm',
    title: 'Synthetic model-written report',
    executiveSummary: 'Synthetic summary used only in frontend tests.',
    sections: titles.map((title) => ({ title, body: `Body of ${title}.`, sourceIds: ['S1'] })),
    limitations: ['Synthetic test only.'],
    ...(grounding ? { grounding } : {}),
    metrics: {
      initialMean: 0,
      finalMean: 0.2,
      finalSupport: 0.5,
      finalOpposition: 0.25,
      polarization: 0.3,
      totalInteractions: 4,
    },
  };
}
