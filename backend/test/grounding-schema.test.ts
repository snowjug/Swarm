import { describe, expect, it } from 'vitest';
import {
  MAX_CLAIM_CITATIONS,
  MAX_CLAIM_QUOTE_LENGTH,
  chapterClaimSchema,
  type ChapterClaim,
} from '../../shared/grounding.js';
import { findQuote } from '../src/grounding/text.js';
import { validateChapterClaims } from '../src/grounding/review.js';

const base = {
  text: 'The City Transit Office proposes a six-month electric bus pilot.',
  kind: 'extracted-claim' as const,
  sourceIds: ['S1'],
  memoryIds: [] as string[],
  quote: null as string | null,
};
const parse = (overrides: Record<string, unknown>): ChapterClaim =>
  chapterClaimSchema.parse({ ...base, ...overrides });

// Captured from a real model (gpt-4.1-mini on Azure): it pasted quotes longer than the limit and
// cited more than three memories. Rejecting the chapter for either cost a repair each time and
// the stage failed. Trimming is safe because it can only remove claimed provenance, never add it.
describe('chapter claims are trimmed, not rejected, when a model overshoots a format limit', () => {
  it('cuts an over-long quote to the limit and keeps it a verbatim prefix', () => {
    const passage = `${'The City Transit Office proposes a six-month electric bus pilot with lower fares. '.repeat(8)}`;
    expect(passage.length).toBeGreaterThan(MAX_CLAIM_QUOTE_LENGTH + 100);
    const claim = parse({ kind: 'source-fact', quote: passage.trim() });
    // Cut at the limit, then trimmed, so it is never longer than the limit nor more than a space shorter.
    expect(claim.quote?.length).toBeLessThanOrEqual(MAX_CLAIM_QUOTE_LENGTH);
    expect(claim.quote?.length).toBeGreaterThan(MAX_CLAIM_QUOTE_LENGTH - 5);
    expect(claim.quote).toBe(claim.quote?.trim());
    expect(passage.startsWith(claim.quote ?? '')).toBe(true);
    expect(findQuote(claim.quote ?? '', new Map([['S1', passage]])).found).toBe(true);
    expect(() =>
      validateChapterClaims(
        { claims: [claim] },
        { passages: new Map([['S1', passage]]), memories: new Map() },
      ),
    ).not.toThrow();
  });

  it('does not let trimming launder a quote that is not in the passage', () => {
    const invented = `This sentence is not in the passage at all. ${'More invented words follow. '.repeat(20)}`;
    const claim = parse({ kind: 'source-fact', quote: invented });
    expect(() =>
      validateChapterClaims(
        { claims: [claim] },
        {
          passages: new Map([['S1', 'The City Transit Office proposes a pilot.']]),
          memories: new Map(),
        },
      ),
    ).toThrow(/not verbatim/);
  });

  it('removes duplicates and keeps at most three citations of each kind', () => {
    const claim = parse({
      sourceIds: ['S1', 'S1', 'S2', 'S3', 'S4', 'S5'],
      memoryIds: ['M1', 'M2', 'M3', 'M4', 'M5'],
    });
    expect(claim.sourceIds).toEqual(['S1', 'S2', 'S3']);
    expect(claim.memoryIds).toEqual(['M1', 'M2', 'M3']);
    expect(MAX_CLAIM_CITATIONS).toBe(3);
  });

  it('still validates what remains after trimming', () => {
    const claim = parse({ sourceIds: ['S1', 'S2', 'S3', 'S-invented'] });
    expect(() =>
      validateChapterClaims(
        { claims: [claim] },
        {
          passages: new Map([
            ['S1', 'x'],
            ['S2', 'y'],
            ['S3', 'z'],
          ]),
          memories: new Map(),
        },
      ),
    ).not.toThrow();
    const invented = parse({ sourceIds: ['S-invented'] });
    expect(() =>
      validateChapterClaims(
        { claims: [invented] },
        { passages: new Map([['S1', 'x']]), memories: new Map() },
      ),
    ).toThrow(/not supplied/);
  });

  it('still rejects what is not a format slip', () => {
    expect(() => parse({ quote: 'short' })).toThrow();
    expect(() => parse({ kind: 'invented-kind' })).toThrow();
    expect(() => parse({ text: 'too short' })).toThrow();
    expect(() => parse({ sourceIds: Array.from({ length: 25 }, (_, i) => `S${i}`) })).toThrow();
    expect(parse({ quote: null }).quote).toBeNull();
  });
});
