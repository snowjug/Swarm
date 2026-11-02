import { describe, expect, it } from 'vitest';
import {
  axisRounds,
  countLimit,
  fitFromZero,
  fitSymmetric,
  linePath,
  linear,
  niceLimit,
  roundAtX,
  stackShares,
} from './chart';

describe('chart geometry', () => {
  it('maps a domain onto a range, and a flat domain to the middle', () => {
    const y = linear([-1, 1], [100, 0]);
    expect(y(1)).toBe(0);
    expect(y(0)).toBe(50);
    expect(y(-1)).toBe(100);
    expect(linear([0, 0], [0, 10])(0)).toBe(5);
  });

  it('draws a line from points', () => {
    expect(
      linePath([
        { x: 0, y: 1.234 },
        { x: 10, y: 2 },
      ]),
    ).toBe('M0 1.23 L10 2');
    expect(linePath([])).toBe('');
  });

  it('fits a symmetric domain to small inclinations and never past −1 to 1', () => {
    expect(fitSymmetric([0.01, -0.03])).toEqual([-0.05, 0.05]);
    expect(fitSymmetric([0.3, -0.1])).toEqual([-0.5, 0.5]);
    expect(fitSymmetric([0.9, -2])).toEqual([-1, 1]);
    expect(fitSymmetric([])).toEqual([-0.05, 0.05]);
  });

  it('fits polarization from zero, and counts to a whole number', () => {
    expect(fitFromZero([0.011, 0.02])).toEqual([0, 0.05]);
    expect(fitFromZero([0.4])).toEqual([0, 0.5]);
    expect(countLimit([0, 3, 7])).toBe(7);
    expect(countLimit([0])).toBe(1);
    expect(niceLimit(0.07)).toBe(0.1);
  });

  it('labels every round that fits and always the first and the last', () => {
    expect(axisRounds(8, 600)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const thin = axisRounds(24, 300);
    expect(thin[0]).toBe(0);
    expect(thin.at(-1)).toBe(24);
    for (let index = 1; index < thin.length; index += 1) {
      expect(thin[index]! - thin[index - 1]!).toBeGreaterThanOrEqual(2);
    }
  });

  it('finds the round nearest to a position across the plot', () => {
    expect(roundAtX(0, 10, 110, 4)).toBe(0);
    expect(roundAtX(60, 10, 110, 4)).toBe(2);
    expect(roundAtX(999, 10, 110, 4)).toBe(4);
    expect(roundAtX(50, 10, 10, 4)).toBe(0);
  });

  it('stacks the shares so that they always fill 0 to 1', () => {
    const bands = stackShares([
      { opposition: 0.25, undecided: 0.5, support: 0.25 },
      { opposition: 0, undecided: 1, support: 0 },
    ]);
    expect(bands.support.upper).toEqual([1, 1]);
    expect(bands.opposition.upper).toEqual([0.25, 0]);
    expect(bands.undecided.lower).toEqual([0.25, 0]);
    expect(bands.undecided.upper).toEqual([0.75, 1]);
  });
});
