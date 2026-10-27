import { describe, expect, it } from 'vitest';
import {
  SUPPORT_VERDICTS,
  SUPPORT_VERDICT_LABELS,
  emptyVerdictCounts,
  type SupportVerdict,
} from '../../../shared/grounding';
import { allKindsAndVerdicts, claimFixture } from '../test/grounding';
import {
  VERDICT_MEANINGS,
  chaptersWithoutStatements,
  contradictedClaims,
  groupBySection,
  methodLine,
  needsAttention,
  noReviewMessage,
  orderedTallies,
  quoteLabel,
  statementsText,
  summaryText,
  tallyVerdicts,
  totalStatements,
} from './grounding';

const counts = (patch: Partial<Record<SupportVerdict, number>>) => ({
  ...emptyVerdictCounts(),
  ...patch,
});

describe('verdict ordering and tallies', () => {
  it('lists every verdict in the shared reading order with its shared label', () => {
    const tallies = orderedTallies(counts({ supported: 3, contradicted: 1 }));
    expect(tallies.map((tally) => tally.verdict)).toEqual([...SUPPORT_VERDICTS]);
    expect(tallies.map((tally) => tally.label)).toEqual(
      SUPPORT_VERDICTS.map((verdict) => SUPPORT_VERDICT_LABELS[verdict]),
    );
    expect(tallies.map((tally) => tally.count)).toEqual([3, 0, 0, 1, 0]);
  });

  it('does not depend on the key order of the counts object and treats a missing key as zero', () => {
    const shuffled = { unchecked: 1, contradicted: 2, supported: 5 } as Record<
      SupportVerdict,
      number
    >;
    expect(orderedTallies(shuffled).map((tally) => `${tally.verdict}:${tally.count}`)).toEqual([
      'supported:5',
      'partial:0',
      'unsupported:0',
      'contradicted:2',
      'unchecked:1',
    ]);
    expect(totalStatements(shuffled)).toBe(8);
  });

  it('writes the one-line summary with the shared labels', () => {
    expect(
      summaryText(
        counts({ supported: 7, partial: 2, unsupported: 1, contradicted: 1, unchecked: 1 }),
      ),
    ).toBe(
      '12 statements checked · 7 Supported · 2 Partly supported · 1 Not supported · 1 Contradicted · 1 Not checkable',
    );
  });

  it('keeps the zero counts and the singular form', () => {
    expect(summaryText(counts({ supported: 1 }))).toBe(
      '1 statement checked · 1 Supported · 0 Partly supported · 0 Not supported · 0 Contradicted · 0 Not checkable',
    );
    expect(statementsText(0)).toBe('0 statements');
    expect(statementsText(2)).toBe('2 statements');
  });

  it('tallies claims by verdict', () => {
    expect(tallyVerdicts(allKindsAndVerdicts())).toEqual({
      supported: 2,
      partial: 1,
      unsupported: 1,
      contradicted: 1,
      unchecked: 2,
    });
    expect(tallyVerdicts([])).toEqual(emptyVerdictCounts());
  });

  it('flags only the verdicts that give a reader no reason to rely on a statement', () => {
    expect(SUPPORT_VERDICTS.filter(needsAttention)).toEqual(['unsupported', 'contradicted']);
  });

  it('explains every verdict without saying the cited passage is true', () => {
    for (const verdict of SUPPORT_VERDICTS) {
      expect(VERDICT_MEANINGS[verdict].length).toBeGreaterThan(10);
      expect(VERDICT_MEANINGS[verdict].toLowerCase()).not.toMatch(/\btrue\b|\bproves?\b/u);
    }
    expect(VERDICT_MEANINGS.supported).toBe('Backed by the cited passage.');
    expect(VERDICT_MEANINGS.partial).toBe('Only part of it is backed by the cited passage.');
    expect(VERDICT_MEANINGS.unsupported).toBe('Nothing in the cited passage backs it.');
    expect(VERDICT_MEANINGS.contradicted).toBe(
      'The cited passage says something that conflicts with it.',
    );
    expect(VERDICT_MEANINGS.unchecked).toBe(
      'A hypothesis, assumption or interpretation that is not claimed to be evidence.',
    );
  });
});

describe('grouping statements by chapter', () => {
  it('groups in first-seen order, keeps the order inside a chapter and tallies each group', () => {
    const groups = groupBySection(allKindsAndVerdicts());
    expect(groups.map((group) => group.section)).toEqual(['Chapter one', 'Chapter two']);
    expect(groups.map((group) => group.claims.map((claim) => claim.id))).toEqual([
      ['C1', 'C2', 'C3'],
      ['C4', 'C5', 'C6', 'C7'],
    ]);
    expect(groups[0]!.counts).toEqual(counts({ supported: 1, partial: 1, unchecked: 1 }));
    expect(groups[1]!.counts).toEqual(
      counts({ supported: 1, unsupported: 1, contradicted: 1, unchecked: 1 }),
    );
  });

  it('merges a chapter whose statements are not adjacent into one group', () => {
    const claims = [
      claimFixture({ id: 'C1', section: 'A' }),
      claimFixture({ id: 'C2', section: 'B' }),
      claimFixture({ id: 'C3', section: 'A' }),
    ];
    const groups = groupBySection(claims);
    expect(groups.map((group) => [group.section, group.claims.map((claim) => claim.id)])).toEqual([
      ['A', ['C1', 'C3']],
      ['B', ['C2']],
    ]);
  });

  it('follows the report chapter order when it is given and puts unknown chapters last', () => {
    const claims = [
      claimFixture({ id: 'C1', section: 'Beta' }),
      claimFixture({ id: 'C2', section: 'Unlisted' }),
      claimFixture({ id: 'C3', section: 'Alpha' }),
    ];
    expect(groupBySection(claims, ['Alpha', 'Beta']).map((group) => group.section)).toEqual([
      'Alpha',
      'Beta',
      'Unlisted',
    ]);
  });

  it('returns no group for no statements', () => {
    expect(groupBySection([])).toEqual([]);
  });

  it('picks out the contradicted statements and the chapters with nothing listed', () => {
    const claims = allKindsAndVerdicts();
    expect(contradictedClaims(claims).map((claim) => claim.id)).toEqual(['C7']);
    expect(
      chaptersWithoutStatements(['Chapter one', 'Chapter two', 'Chapter three'], claims),
    ).toEqual(['Chapter three']);
    expect(chaptersWithoutStatements(['X', 'X', 'Y'], [])).toEqual(['X', 'Y']);
  });
});

describe('labels', () => {
  it('says plainly which checks ran', () => {
    expect(methodLine('deterministic+model')).toBe(
      'Quote, word-overlap and figure checks, plus an independent model check that had to quote real text',
    );
    expect(methodLine('deterministic')).toBe(
      'Deterministic checks only — the independent model check did not run',
    );
  });

  it('chooses the honest empty state from the engine and from whether the report is finished', () => {
    expect(noReviewMessage('local', true)).toBe(
      'The rules-based report is assembled from recorded metrics and verbatim excerpts, so it has no model-written statements to check.',
    );
    expect(noReviewMessage('local', false)).toBe(noReviewMessage('local', true));
    expect(noReviewMessage('llm', true)).toBe(
      'This model-written report has no grounding review, so none of its statements were checked.',
    );
    expect(noReviewMessage('llm', false)).toBe(
      'This partial model-written report has no grounding review, so none of its statements have been checked.',
    );
  });

  it('labels a quote by what the server checked, never by more', () => {
    const found = { sourceIds: ['S1'], checks: { quote: 'found' as const } };
    expect(quoteLabel(found)).toBe('Quoted from S1');
    expect(quoteLabel({ ...found, sourceIds: ['S1', 'S2', 'S1'] })).toBe(
      'Quoted from one of S1, S2',
    );
    expect(quoteLabel({ ...found, checks: { quote: 'not-found' } })).toBe(
      'Quote not found verbatim in S1',
    );
    expect(quoteLabel({ sourceIds: ['S1', 'S4'], checks: { quote: 'not-found' } })).toBe(
      'Quote not found verbatim in any of S1, S4',
    );
    expect(quoteLabel({ ...found, checks: { quote: null } })).toBe('Quote not checked against S1');
    expect(quoteLabel({ sourceIds: [], checks: { quote: 'found' } })).toBe(
      'Quote with no cited passage recorded',
    );
  });
});
