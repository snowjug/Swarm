import { describe, expect, it } from 'vitest';
import type { ChapterClaim } from '../../shared/grounding.js';
import {
  MAX_REVIEWED_CLAIMS,
  normalizeChapter,
  normalizeClaims,
  type ChapterIdentifiers,
} from '../src/grounding/normalize.js';
import { validateChapterClaims } from '../src/grounding/review.js';

// Captured from live runs of the Larkholm demo (gpt-4.1-mini on Azure): after three corrective retries a
// chapter still carried a memory identifier the model had made up (it fixed the one problem it was told
// about and kept the rest), and the whole report failed. An identifier that was not supplied can only be
// removed: nothing is verified against it, so removing it cannot create support.
const SENTENCE =
  'The City Transit Office proposes a six-month electric bus pilot with lower fares.';
const supplied: ChapterIdentifiers = {
  passages: new Map([
    ['S1', `${SENTENCE} Fares fall by 20 percent.`],
    ['S2', 'Neighborhood groups ask for accessible stops and clear information about the pilot.'],
  ]),
  memories: new Map([
    ['M1', 'Proxy 3 replied to Proxy 1 and moved toward support.'],
    ['M2', 'Proxy 2 posted a concern about winter service.'],
  ]),
  interviews: new Set(['I1']),
};

const claim = (overrides: Partial<ChapterClaim> = {}): ChapterClaim => ({
  text: SENTENCE,
  kind: 'source-fact',
  sourceIds: ['S1'],
  memoryIds: [],
  quote: 'proposes a six-month electric bus pilot with lower fares',
  ...overrides,
});

describe('normalizeClaims', () => {
  it('leaves statements whose identifiers were all supplied exactly as they are', () => {
    const claims = [
      claim(),
      claim({ kind: 'simulated-event', sourceIds: [], memoryIds: ['M1', 'M2'], quote: null }),
    ];
    const result = normalizeClaims(claims, supplied);
    expect(result.claims).toEqual(claims);
    expect(result).toMatchObject({
      overflow: 0,
      removedCitations: 0,
      shortenedQuotes: 0,
      removedQuotes: 0,
    });
  });

  it('removes identifiers that were not supplied, keeps the ones that were, and counts them', () => {
    const original = claim({
      kind: 'extracted-claim',
      sourceIds: ['S1', 'S9', 'S2'],
      memoryIds: ['M-guessed-4', 'M1'],
      quote: null,
    });
    const result = normalizeClaims([original], supplied);
    expect(result.claims[0]).toMatchObject({ sourceIds: ['S1', 'S2'], memoryIds: ['M1'] });
    expect(result.removedCitations).toBe(2);
    // Nothing else about the statement changes, and the input is not modified.
    expect({ ...result.claims[0], sourceIds: [], memoryIds: [] }).toEqual({
      ...original,
      sourceIds: [],
      memoryIds: [],
    });
    expect(original.sourceIds).toEqual(['S1', 'S9', 'S2']);
  });

  it('judges a quote against the passages that remain, not the ones that were named', () => {
    const result = normalizeClaims(
      [
        claim({
          kind: 'extracted-claim',
          sourceIds: ['S9'],
          quote: 'proposes a six-month electric bus pilot with lower fares',
        }),
      ],
      supplied,
    );
    // S1 holds the quote, but the statement does not cite S1: a paraphrase loses a quote it cannot back.
    expect(result.claims[0]).toMatchObject({ sourceIds: [], quote: null });
    expect(result).toMatchObject({ removedCitations: 1, removedQuotes: 1 });
  });

  it('keeps the first statements up to the limit and counts the rest as left out', () => {
    const many = Array.from({ length: MAX_REVIEWED_CLAIMS + 3 }, (_, index) =>
      claim({ text: `Statement number ${index + 1} about the pilot.` }),
    );
    const result = normalizeClaims(many, supplied);
    expect(result.claims.map((item) => item.text)).toEqual(
      many.slice(0, MAX_REVIEWED_CLAIMS).map((item) => item.text),
    );
    expect(result.overflow).toBe(3);
  });

  it('does not count citations on statements that were left out', () => {
    const many = Array.from({ length: MAX_REVIEWED_CLAIMS + 1 }, (_, index) =>
      claim({ sourceIds: index < MAX_REVIEWED_CLAIMS ? ['S1'] : ['S1', 'S9', 'S8'] }),
    );
    expect(normalizeClaims(many, supplied)).toMatchObject({ overflow: 1, removedCitations: 0 });
  });

  it('is idempotent: a second pass changes and counts nothing', () => {
    const once = normalizeClaims(
      [
        claim({
          sourceIds: ['S1', 'S9'],
          quote: `proposes a six-month electric bus pilot. Trams.`,
        }),
        claim({ kind: 'ai-hypothesis', sourceIds: [], memoryIds: ['M-x'], quote: null }),
      ],
      supplied,
    );
    const twice = normalizeClaims(once.claims, supplied);
    expect(twice.claims).toEqual(once.claims);
    expect(twice).toMatchObject({
      overflow: 0,
      removedCitations: 0,
      shortenedQuotes: 0,
      removedQuotes: 0,
    });
  });

  it('never adds a citation or a statement, whatever the model wrote', () => {
    let seed = 20261029;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const pool = ['S1', 'S2', 'S3', 'S-x', 'M1', 'M2', 'M3', 'I1', 'zz'];
    const pickIds = (): string[] =>
      Array.from(
        { length: Math.floor(random() * 4) },
        () => pool[Math.floor(random() * pool.length)]!,
      );
    for (let round = 0; round < 200; round += 1) {
      const claims = Array.from({ length: 1 + Math.floor(random() * 9) }, () =>
        claim({ sourceIds: pickIds(), memoryIds: pickIds() }),
      );
      const result = normalizeClaims(claims, supplied);
      expect(result.claims.length).toBeLessThanOrEqual(claims.length);
      expect(result.claims.length).toBeLessThanOrEqual(MAX_REVIEWED_CLAIMS);
      result.claims.forEach((out, index) => {
        const before = claims[index]!;
        expect(before.sourceIds).toEqual(expect.arrayContaining(out.sourceIds));
        expect(before.memoryIds).toEqual(expect.arrayContaining(out.memoryIds));
        expect(out.sourceIds.every((id) => supplied.passages.has(id))).toBe(true);
        expect(out.memoryIds.every((id) => supplied.memories.has(id))).toBe(true);
        expect(out.text).toBe(before.text);
        // The only label that ever changes is a source fact that could not keep its quote.
        expect(
          out.kind === before.kind ||
            (before.kind === 'source-fact' && out.kind === 'extracted-claim' && out.quote === null),
        ).toBe(true);
        if (out.kind === 'source-fact') expect(out.quote).not.toBeNull();
        expect((out.quote ?? '').length).toBeLessThanOrEqual((before.quote ?? '').length);
      });
    }
  });
});

describe('normalizeChapter', () => {
  const draft = {
    body: `${SENTENCE} Recorded views differ.`,
    sourceIds: ['S1', 'S9'],
    memoryIds: ['M1', 'M-guessed-1', 'M-guessed-2'],
    interviewIds: ['I1', 'I9'],
    claims: [claim({ sourceIds: ['S1', 'S7'] })],
  };

  it('removes every identifier that was not supplied from the chapter and from its statements', () => {
    const result = normalizeChapter(draft, supplied);
    expect(result.chapter).toMatchObject({
      body: draft.body,
      sourceIds: ['S1'],
      memoryIds: ['M1'],
      interviewIds: ['I1'],
    });
    expect(result.chapter.claims[0]?.sourceIds).toEqual(['S1']);
    // S9, two memories and I9 from the chapter, and S7 from the statement.
    expect(result.removedCitations).toBe(5);
  });

  it('carries every other field of the reply through untouched', () => {
    const result = normalizeChapter({ ...draft, title: 'Evidence' }, supplied);
    expect(result.chapter.title).toBe('Evidence');
  });
});

describe('a slip in an identifier does not fail a chapter, but a missing citation still does', () => {
  const check = (claims: ChapterClaim[]) => () =>
    validateChapterClaims({ claims }, { passages: supplied.passages, memories: supplied.memories });

  it('accepts a statement that cites one passage that was supplied and one that was not', () => {
    expect(check([claim({ sourceIds: ['S9', 'S1'] })])).not.toThrow();
  });

  it('accepts a source-backed statement that also names a memory that was not supplied', () => {
    expect(
      check([claim({ kind: 'extracted-claim', memoryIds: ['M-plaza-4-agent-3'], quote: null })]),
    ).not.toThrow();
  });

  it('accepts an event that cites one real memory and one made up', () => {
    expect(
      check([
        claim({
          kind: 'simulated-event',
          sourceIds: [],
          memoryIds: ['M-guessed', 'M1'],
          quote: null,
        }),
      ]),
    ).not.toThrow();
  });

  it('accepts a conclusion that names an identifier that was not supplied', () => {
    expect(
      check([claim({ kind: 'analytical-conclusion', sourceIds: ['S9'], quote: null })]),
    ).not.toThrow();
  });

  it('accepts more statements than the limit: the extra ones are left out, not rejected', () => {
    expect(check(Array.from({ length: MAX_REVIEWED_CLAIMS + 2 }, () => claim()))).not.toThrow();
  });

  it('still rejects a source-backed statement whose only passage was not supplied', () => {
    expect(check([claim({ sourceIds: ['S9'], quote: null })])).toThrow(
      /claims\[0\] \(source-fact\) cites a passage that was not supplied.*valid passage IDs: S1, S2/,
    );
  });

  it('still rejects an event whose only memory was not supplied', () => {
    expect(
      check([claim({ kind: 'simulated-event', sourceIds: [], memoryIds: ['M9'], quote: null })]),
    ).toThrow(/cites a simulation memory that was not supplied.*valid memory IDs: M1, M2/);
  });

  it('never accepts a problem in a statement that was cut by the limit as if it were checked', () => {
    // The sixth statement is fine and the seventh is not, but only six are ever reviewed.
    const six = Array.from({ length: MAX_REVIEWED_CLAIMS }, () => claim());
    expect(check([...six, claim({ sourceIds: [], quote: null })])).not.toThrow();
    expect(check([claim({ sourceIds: [], quote: null }), ...six])).toThrow(/claims\[0\]/);
  });
});
