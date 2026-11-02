import { describe, expect, it } from 'vitest';
import { conflictRecord } from '../../test/ledger';
import { conflictFigures, conflictLabel, groupConflicts, sharedWords } from './conflicts';

describe('groupConflicts', () => {
  it('keeps detected and confirmed conflicts open, the rest reviewed, each in numeric order', () => {
    const groups = groupConflicts([
      conflictRecord({ id: 'X10', status: 'detected' }),
      conflictRecord({ id: 'X2', status: 'confirmed' }),
      conflictRecord({ id: 'X1', status: 'dismissed' }),
      conflictRecord({ id: 'X3', status: 'resolved' }),
    ]);
    expect(groups.open.map((conflict) => conflict.id)).toEqual(['X2', 'X10']);
    expect(groups.reviewed.map((conflict) => conflict.id)).toEqual(['X1', 'X3']);
  });
});

describe('what a conflict says', () => {
  it('gives the two figures for a conflict of numbers and none for one of meaning', () => {
    expect(conflictFigures(conflictRecord())).toEqual({ left: '412,000', right: '365,000' });
    expect(
      conflictFigures(conflictRecord({ kind: 'polarity', leftValue: null, rightValue: null })),
    ).toBeNull();
  });

  it('is read out with its figures, its status and the documents, so that colour is never the only cue', () => {
    const label = conflictLabel(conflictRecord());
    expect(label).toContain('412,000 against 365,000');
    expect(label).toContain('possible conflict');
    expect(label).toContain('council-briefing.md');
    expect(label).toContain('operator-memo.md');
  });

  it('splits the shared wording into words', () => {
    expect(sharedWords('crossings one-way')).toEqual(['crossings', 'one-way']);
    expect(sharedWords('')).toEqual([]);
  });
});
