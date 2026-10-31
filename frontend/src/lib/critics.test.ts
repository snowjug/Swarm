import { describe, expect, it } from 'vitest';
import { CRITIC_ROLE_QUESTIONS, type CritiquesView } from '../../../shared/critique';
import { critiqueFixture } from '../test/critics';
import {
  day,
  groupByRole,
  impactHeading,
  isOutOfDate,
  modeText,
  summarise,
  targetLabel,
} from './critics';
describe('summarising a review', () => {
  it('counts the criticisms by severity and by status, including the ones with none', () => {
    const summary = summarise([
      critiqueFixture({ id: 'a', severity: 'blocking' }),
      critiqueFixture({ id: 'b', severity: 'major', status: 'accepted' }),
      critiqueFixture({ id: 'c', severity: 'major', status: 'disputed' }),
      critiqueFixture({ id: 'd', severity: 'minor' }),
    ]);
    expect(summary.total).toBe(4);
    expect(summary.bySeverity).toEqual({ blocking: 1, major: 2, minor: 1, note: 0 });
    expect(summary.byStatus).toEqual({ open: 2, responded: 0, accepted: 1, disputed: 1 });
  });

  it('counts nothing for no criticisms', () => {
    expect(summarise([])).toEqual({
      total: 0,
      bySeverity: { blocking: 0, major: 0, minor: 0, note: 0 },
      byStatus: { open: 0, responded: 0, accepted: 0, disputed: 0 },
    });
  });
});

describe('grouping by critic', () => {
  it('puts the critics in their own order, headed by the question each asks, and leaves out those with nothing', () => {
    const groups = groupByRole([
      critiqueFixture({ id: 'a', role: 'adversarial' }),
      critiqueFixture({ id: 'b', role: 'evidence' }),
      critiqueFixture({ id: 'c', role: 'adversarial' }),
    ]);
    expect(groups.map((group) => group.role)).toEqual(['evidence', 'adversarial']);
    expect(groups[0]?.question).toBe(CRITIC_ROLE_QUESTIONS.evidence);
    expect(groups[1]?.label).toBe('Adversarial reviewer');
    // Within a critic, the order the server gave.
    expect(groups[1]?.critiques.map((critique) => critique.id)).toEqual(['a', 'c']);
  });
});

describe('words for a criticism', () => {
  it('names what a criticism is about', () => {
    expect(targetLabel({ kind: 'analysis', id: 'x' })).toBe('The analysis as a whole');
    expect(targetLabel({ kind: 'brief', id: 'brief' })).toBe('The decision brief');
    expect(targetLabel({ kind: 'finding', id: 'f1' })).toBe('Finding f1');
    expect(targetLabel({ kind: 'stakeholder', id: 'regulator' })).toBe('Stakeholder regulator');
    expect(targetLabel({ kind: 'assumption', id: 's1' })).toBe('Assumption s1');
    expect(targetLabel({ kind: 'recommendation', id: 'r1' })).toBe('Recommendation r1');
    expect(targetLabel({ kind: 'statement', id: 'st-1' })).toBe('Statement st-1');
  });

  it('says what the impact means once the person has accepted or disputed it', () => {
    expect(impactHeading('open')).toContain('If this stands');
    expect(impactHeading('responded')).toContain('If this stands');
    expect(impactHeading('accepted')).toBe('Accepted: this applies to the conclusion');
    expect(impactHeading('disputed')).toBe('Disputed: this is what is contested');
  });

  it('shows a date the same way in every time zone', () => {
    expect(day('2026-02-01T23:59:00.000Z')).toBe('2026-02-01');
  });

  it('says how a review was made', () => {
    expect(modeText('rules')).toBe('Deterministic checks only');
    expect(modeText('both')).toBe('Deterministic checks and a model review');
    expect(modeText('model')).toBe('Model review only');
  });
});

describe('a review of an earlier analysis', () => {
  const view = (reviewed: string | null, newest: string | null): CritiquesView => ({
    critiques: reviewed
      ? {
          analysisId: reviewed,
          generatedAt: '2026-02-01T09:00:00.000Z',
          mode: 'rules',
          critiques: [],
        }
      : null,
    analysis: newest ? { id: newest, completedAt: null } : null,
    may: { run: true, respond: true },
    model: { available: false },
  });

  it('is out of date only when a different analysis has finished since', () => {
    expect(isOutOfDate(view('a', 'a'))).toBe(false);
    expect(isOutOfDate(view('a', 'b'))).toBe(true);
    expect(isOutOfDate(view(null, 'b'))).toBe(false);
    expect(isOutOfDate(view('a', null))).toBe(false);
  });
});
