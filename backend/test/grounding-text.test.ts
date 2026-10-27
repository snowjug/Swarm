import { describe, expect, it } from 'vitest';
import {
  findQuote,
  MIN_QUOTE_CHARS,
  normalizeText,
  numbersIn,
  wordOverlap,
} from '../src/grounding/text.js';

const passages = (entries: Record<string, string>) => new Map(Object.entries(entries));

describe('normalizeText', () => {
  it('makes cosmetic differences disappear', () => {
    const a = normalizeText('The  “City”\u2019s plan —  see **this**…\n now');
    const b = normalizeText('the "city"\'s plan - see this ... now');
    expect(a).toBe(b);
  });

  it('applies Unicode compatibility normalisation', () => {
    expect(normalizeText('ﬁne  ＡＢＣ')).toBe('fine abc');
  });
});

describe('findQuote', () => {
  const source = passages({
    S1: 'The City Transit Office proposes a six-month electric bus pilot with lower fares.',
    S2: 'Neighborhood groups ask for accessible stops and clear information about the pilot.',
  });

  it('finds an exact quote and reports which passage holds it', () => {
    expect(findQuote('proposes a six-month electric bus pilot', source)).toEqual({
      found: true,
      passageId: 'S1',
    });
    expect(findQuote('ask for accessible stops and clear information', source).passageId).toBe(
      'S2',
    );
  });

  it('ignores case, spacing, quote style, dashes and markdown emphasis', () => {
    expect(findQuote('PROPOSES  a six–month   **electric** bus pilot', source).found).toBe(true);
    expect(findQuote('“accessible stops” and clear information', source).found).toBe(false);
    expect(findQuote('accessible stops and clear information', source).found).toBe(true);
  });

  it('does not find text that is merely similar', () => {
    expect(findQuote('proposes a twelve-month electric bus pilot', source).found).toBe(false);
    expect(findQuote('proposes a six-month electric tram pilot', source).found).toBe(false);
  });

  it('allows an ellipsis for an omission, but only in order and within one passage', () => {
    expect(findQuote('proposes a six-month … with lower fares', source)).toEqual({
      found: true,
      passageId: 'S1',
    });
    expect(findQuote('lower fares … proposes a six-month', source).found).toBe(false);
    expect(findQuote('proposes a six-month ... accessible stops and clear', source).found).toBe(
      false,
    );
  });

  it('rejects quotes that are too short to mean anything', () => {
    expect(MIN_QUOTE_CHARS).toBe(12);
    expect(findQuote('bus pilot', source).found).toBe(false);
    expect(findQuote('', source).found).toBe(false);
    expect(findQuote('…', source).found).toBe(false);
    // Long overall, but one fragment is a few common words.
    expect(findQuote('proposes a six-month … the', source).found).toBe(false);
  });

  it('only searches the passages it is given', () => {
    const only = passages({ S2: source.get('S2')! });
    expect(findQuote('proposes a six-month electric bus pilot', only).found).toBe(false);
  });
});

describe('numbersIn', () => {
  it.each([
    ['1,200 riders', ['1200']],
    ['up 40% to $3.50', ['40', '3.5']],
    ['version 007 and 3.0', ['7', '3']],
    ['0.35 then 0.350 again', ['0.35']],
    ['no figures here', []],
    ['rounds 1-3 of 10', ['1', '3', '10']],
  ])('reads %j', (text, expected) => {
    expect(numbersIn(text)).toEqual(expected);
  });
});

describe('wordOverlap', () => {
  it('measures the share of content words present', () => {
    expect(wordOverlap('electric bus pilot fares', 'electric bus pilot fares lower')).toBe(1);
    expect(wordOverlap('electric bus pilot fares', 'electric tram pilot costs')).toBe(0.5);
    expect(wordOverlap('electric bus pilot', 'something entirely unrelated')).toBe(0);
  });

  it('ignores stop words and numbers, and treats a claim with no content words as covered', () => {
    expect(wordOverlap('the and of 2025', 'anything')).toBe(1);
    expect(wordOverlap('The pilot', 'pilot')).toBe(1);
  });
});
