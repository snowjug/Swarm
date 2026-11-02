import { describe, expect, it } from 'vitest';
import { conflictRecord } from '../../test/ledger';
import {
  arcGeometry,
  conflictFigures,
  conflictLabel,
  groupConflicts,
  sharedWords,
} from './conflicts';

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

describe('arcGeometry', () => {
  const centres = [20, 80, 140, 200, 260];

  it('stacks arcs that cover the same height at different depths, the shorter inside the longer', () => {
    const [outer, inner] = arcGeometry(
      [
        { id: 'X1', status: 'detected', from: 0, to: 4 },
        { id: 'X2', status: 'detected', from: 1, to: 3 },
      ],
      centres,
      100,
    );
    expect(outer!.apex.x).toBeGreaterThan(inner!.apex.x);
  });

  it('lets arcs that do not meet share a depth', () => {
    const [first, second] = arcGeometry(
      [
        { id: 'X1', status: 'detected', from: 0, to: 1 },
        { id: 'X2', status: 'detected', from: 3, to: 4 },
      ],
      centres,
      100,
    );
    expect(first!.apex.x).toBeCloseTo(second!.apex.x);
  });

  it('keeps arcs that end on the same row from sharing a dot', () => {
    const [first, second] = arcGeometry(
      [
        { id: 'X1', status: 'detected', from: 1, to: 4 },
        { id: 'X2', status: 'confirmed', from: 2, to: 4 },
      ],
      centres,
      90,
    );
    expect(first!.b.y).not.toBe(second!.b.y);
  });

  it('keeps arcs inside the room it was given, however many are stacked', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      id: `X${i}`,
      status: 'detected' as const,
      from: 0,
      to: 4,
    }));
    for (const arc of arcGeometry(many, centres, 40)) expect(arc.apex.x).toBeLessThanOrEqual(40);
  });

  it('skips a conflict whose place is not in the list or has not been measured, and draws a loop for one inside a place', () => {
    expect(arcGeometry([{ id: 'X1', status: 'detected', from: 0, to: 9 }], centres, 90)).toEqual(
      [],
    );
    expect(
      arcGeometry([{ id: 'X1', status: 'detected', from: 0, to: 1 }], [20, Number.NaN], 90),
    ).toEqual([]);
    const [loop] = arcGeometry([{ id: 'X2', status: 'detected', from: 2, to: 2 }], centres, 90);
    expect(loop!.a.y).not.toBe(loop!.b.y);
  });
});
