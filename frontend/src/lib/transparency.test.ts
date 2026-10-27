import { describe, expect, it } from 'vitest';
import { cleanList, firmnessPercent, firmnessText, nodeQuoteLabel } from './transparency';

describe('self-reported firmness', () => {
  it.each([
    [0.7, 70],
    [0.55, 55],
    [0, 0],
    [1, 100],
    [0.004, 0],
    [0.005, 1],
    [0.999, 100],
  ])('rounds %s to %s%%', (confidence, percent) => {
    expect(firmnessPercent(confidence)).toBe(percent);
  });

  it('keeps an out-of-range value inside 0 to 100 rather than printing nonsense', () => {
    expect(firmnessPercent(1.4)).toBe(100);
    expect(firmnessPercent(-0.2)).toBe(0);
  });

  it.each([undefined, null, Number.NaN, Number.POSITIVE_INFINITY])(
    'shows nothing for %s',
    (confidence) => {
      expect(firmnessPercent(confidence)).toBeNull();
      expect(firmnessText(confidence)).toBeNull();
    },
  );

  it('writes the label with the percentage, including a real zero', () => {
    expect(firmnessText(0.72)).toBe('Self-reported firmness 72%');
    expect(firmnessText(0)).toBe('Self-reported firmness 0%');
  });
});

describe('graph quote label', () => {
  it('names the cited passage the excerpt was checked against', () => {
    expect(nodeQuoteLabel(['S3'])).toBe('Source quote (checked verbatim against S3)');
  });

  it('names every cited passage, because the excerpt may be in any one of them', () => {
    expect(nodeQuoteLabel(['S3', 'S4', 'S3'])).toBe(
      'Source quote (checked verbatim against S3, S4)',
    );
  });

  it('does not invent a passage when none is recorded', () => {
    expect(nodeQuoteLabel([])).toBe('Source quote (no cited passage recorded)');
  });
});

describe('model-written lists', () => {
  it('trims entries and drops empty ones', () => {
    expect(cleanList(['  Keep access open  ', '', '   ', 'Stay on budget'])).toEqual([
      'Keep access open',
      'Stay on budget',
    ]);
    expect(cleanList(undefined)).toEqual([]);
    expect(cleanList(null)).toEqual([]);
  });
});
