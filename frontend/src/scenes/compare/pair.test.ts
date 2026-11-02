import { describe, expect, it } from 'vitest';
import { defaultPair, samePair, setAgainst, setReference, swapPair, validPair } from './pair';

const set = [
  { id: 'base', kind: 'baseline' as const },
  { id: 'change', kind: 'alternative' as const },
  { id: 'smaller', kind: 'alternative' as const },
  { id: 'larger', kind: 'alternative' as const },
];

describe('the pair of scenarios set against each other', () => {
  it('starts with the baseline against the first alternative', () => {
    expect(defaultPair(set)).toEqual({ a: 'base', b: 'change' });
  });

  it('has nothing to set against when only one scenario ran', () => {
    expect(defaultPair([set[0]!])).toEqual({ a: 'base', b: null });
    expect(defaultPair([])).toEqual({ a: '', b: null });
  });

  it('uses the first scenario as the reference when none is the baseline', () => {
    const none = [
      { id: 'x', kind: 'alternative' as const },
      { id: 'y', kind: 'alternative' as const },
    ];
    expect(defaultPair(none)).toEqual({ a: 'x', b: 'y' });
  });

  it('sets a scenario against the reference without touching the reference', () => {
    expect(setAgainst({ a: 'base', b: 'change' }, set, 'larger')).toEqual({
      a: 'base',
      b: 'larger',
    });
  });

  it('swaps the two when the reference is chosen as the one set against it', () => {
    expect(setAgainst({ a: 'base', b: 'change' }, set, 'base')).toEqual({ a: 'change', b: 'base' });
  });

  it('swaps the two when the one set against the reference is chosen as the reference', () => {
    expect(setReference({ a: 'base', b: 'change' }, set, 'change')).toEqual({
      a: 'change',
      b: 'base',
    });
    expect(setReference({ a: 'base', b: 'change' }, set, 'smaller')).toEqual({
      a: 'smaller',
      b: 'change',
    });
  });

  it('ignores a scenario that does not exist', () => {
    const pair = { a: 'base', b: 'change' };
    expect(setAgainst(pair, set, 'ghost')).toBe(pair);
    expect(setReference(pair, set, 'ghost')).toBe(pair);
  });

  it('is repaired when a scenario it names is no longer there', () => {
    expect(validPair({ a: 'base', b: 'gone' }, set)).toEqual({ a: 'base', b: 'change' });
    expect(validPair({ a: 'gone', b: 'change' }, set)).toEqual({ a: 'base', b: 'change' });
    expect(validPair({ a: 'base', b: 'base' }, set)).toEqual({ a: 'base', b: 'change' });
    expect(validPair(null, set)).toEqual({ a: 'base', b: 'change' });
  });

  it('keeps a pair that is valid exactly as it is', () => {
    const pair = { a: 'smaller', b: 'larger' };
    expect(validPair(pair, set)).toBe(pair);
  });

  it('swaps and compares', () => {
    expect(swapPair({ a: 'x', b: 'y' })).toEqual({ a: 'y', b: 'x' });
    expect(swapPair({ a: 'x', b: null })).toEqual({ a: 'x', b: null });
    expect(samePair({ a: 'x', b: 'y' }, { a: 'x', b: 'y' })).toBe(true);
    expect(samePair({ a: 'x', b: 'y' }, { a: 'y', b: 'x' })).toBe(false);
  });
});
