import { describe, expect, it } from 'vitest';
import {
  MAX_CLAIM_CITATIONS,
  MAX_CLAIM_QUOTE_LENGTH,
  MIN_CLAIM_QUOTE_LENGTH,
  chapterClaimSchema,
  type ChapterClaim,
} from '../../shared/grounding.js';
import { findQuote } from '../src/grounding/text.js';
import { normalizeClaimQuotes } from '../src/grounding/quotes.js';
import { validateChapterClaims } from '../src/grounding/review.js';
import { validateNodeQuotes } from '../src/grounding/graph.js';
import { MAX_NODE_QUOTE_LENGTH, extractedGraphSchema } from '../src/models/schemas.js';
import { guidedGraphSchema } from '../src/guided/schemas.js';

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
    const passages = new Map([['S1', 'The City Transit Office proposes a pilot.']]);
    // The quote survives trimming only as far as it was a quote; nothing in it is in the passage, so
    // the statement can no longer be a source fact. It is shown as a paraphrase, with no quote.
    const [shown] = normalizeClaimQuotes([claim], passages).claims;
    expect(shown).toMatchObject({ kind: 'extracted-claim', quote: null });
    expect(findQuote(invented, passages).found).toBe(false);
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
    expect(() => parse({ kind: 'invented-kind' })).toThrow();
    expect(() => parse({ text: 'too short' })).toThrow();
    expect(() => parse({ sourceIds: Array.from({ length: 25 }, (_, i) => `S${i}`) })).toThrow();
    expect(parse({ quote: null }).quote).toBeNull();
  });

  // Captured from a live Azure run: a model wrote "quote": "" for a statement that had none and
  // repeated it through three corrective retries, because the schema error ("expected string to have
  // >=8 characters") never said that null was the answer. The stage failed on the fourth reply.
  describe('an empty or too-short quote means "no quote"', () => {
    it.each(['', '   ', 'n/a', 'short', 'seven c'])('reads %j as null', (quote) => {
      expect(parse({ quote }).quote).toBeNull();
    });

    it('keeps a quote of the minimum length, trimmed', () => {
      expect(MIN_CLAIM_QUOTE_LENGTH).toBe(8);
      expect(parse({ quote: `  ${'x'.repeat(MIN_CLAIM_QUOTE_LENGTH)}  ` }).quote).toBe(
        'x'.repeat(MIN_CLAIM_QUOTE_LENGTH),
      );
      expect(parse({ quote: 'x'.repeat(MIN_CLAIM_QUOTE_LENGTH - 1) }).quote).toBeNull();
    });

    it('never lets a source fact stand on it: that label needs a real verbatim quote, or it is shown as a paraphrase', () => {
      const claim = parse({ kind: 'source-fact', quote: '' });
      expect(claim.quote).toBeNull();
      const [shown] = normalizeClaimQuotes(
        [claim],
        new Map([['S1', 'The City Transit Office proposes a pilot.']]),
      ).claims;
      expect(shown).toMatchObject({ kind: 'extracted-claim', quote: null });
    });

    it('treats a quote that was left out altogether the same way', () => {
      const claim = chapterClaimSchema.parse({
        text: base.text,
        kind: 'ai-hypothesis',
        sourceIds: undefined,
        memoryIds: undefined,
      });
      expect(claim).toMatchObject({ quote: null, sourceIds: [], memoryIds: [] });
    });

    it('is harmless on a statement that needs no quote', () => {
      const claim = parse({ kind: 'ai-hypothesis', sourceIds: [], quote: '' });
      expect(claim.quote).toBeNull();
      expect(() =>
        validateChapterClaims({ claims: [claim] }, { passages: new Map(), memories: new Map() }),
      ).not.toThrow();
    });
  });
});

// Captured from a live Azure run (gpt-4.1-mini, a scenario with five sources): Graph Build failed with
// "nodes.7.quote: Too big: expected string to have <=240 characters" after two corrective retries,
// each of which re-requested the whole graph and took about 28 seconds.
describe('graph node quotes are trimmed, not rejected, when a model overshoots the limit', () => {
  const passage =
    `${'The Finance Committee will not raise the annual ferry subsidy above $1.8 million. '.repeat(6)}`.trim();
  const node = (overrides: Record<string, unknown> = {}) => ({
    id: 'n1',
    label: 'Finance Committee',
    kind: 'group' as const,
    summary: 'The committee that sets the ferry subsidy ceiling.',
    weight: 0.8,
    sourceIds: ['S1'],
    quote: passage,
    ...overrides,
  });
  const parse = (nodes: ReturnType<typeof node>[]) =>
    extractedGraphSchema.parse({ nodes, edges: [] }).nodes;

  it('cuts an over-long quote to the limit and keeps it a verbatim prefix of the passage', () => {
    expect(passage.length).toBeGreaterThan(MAX_NODE_QUOTE_LENGTH + 100);
    const [kept] = parse([node(), node({ id: 'n2' })]);
    expect(kept?.quote.length).toBeLessThanOrEqual(MAX_NODE_QUOTE_LENGTH);
    expect(kept?.quote.length).toBeGreaterThan(MAX_NODE_QUOTE_LENGTH - 5);
    expect(kept?.quote).toBe(kept?.quote.trim());
    expect(passage.startsWith(kept?.quote ?? '')).toBe(true);
    expect(() =>
      validateNodeQuotes(parse([node(), node({ id: 'n2' })]), new Map([['S1', passage]])),
    ).not.toThrow();
  });

  it('applies to the guided graph schema as well, and leaves short quotes untouched', () => {
    const short = 'will not raise the annual ferry subsidy above $1.8 million';
    const nodes = guidedGraphSchema.parse({
      nodes: [
        { ...node({ quote: short }), entityType: 'Group' },
        { ...node({ id: 'n2' }), entityType: 'Group' },
      ],
      edges: [],
    }).nodes;
    expect(nodes[0]?.quote).toBe(short);
    expect(nodes[1]?.quote.length).toBeLessThanOrEqual(MAX_NODE_QUOTE_LENGTH);
  });

  it('does not let trimming launder a quote that is not in the cited passage', () => {
    const invented = `This sentence is nowhere in the passage. ${'More invented words follow. '.repeat(20)}`;
    const nodes = parse([node({ quote: invented }), node({ id: 'n2' })]);
    expect(nodes[0]?.quote.length).toBeLessThanOrEqual(MAX_NODE_QUOTE_LENGTH);
    expect(() => validateNodeQuotes(nodes, new Map([['S1', passage]]))).toThrow(/copied exactly/);
  });

  it('still rejects what is not a format slip', () => {
    expect(() => parse([node({ quote: 'too short' }), node({ id: 'n2' })])).toThrow();
    expect(() => parse([node({ kind: 'invented' as never }), node({ id: 'n2' })])).toThrow();
    expect(() => parse([node({ sourceIds: [] }), node({ id: 'n2' })])).toThrow();
    expect(() => parse([node()])).toThrow();
  });
});

// Captured from a live Azure run (gpt-4.1-mini, the Larkholm demo sources): the model gave the same
// quote in all three attempts, joining the first and third sentences of a paragraph and skipping the
// second. It was rightly rejected as not verbatim, but the feedback only said "copy exactly", so the
// model never learned what was wrong and the stage failed after three whole-graph requests.
describe('a node quote that joins sentences which are not next to each other', () => {
  const first = 'The Finance Committee will not raise the annual ferry subsidy above $1.8 million.';
  const middle =
    'Any decision to buy a new vessel needs evidence of sustained use and a funding plan before the March budget vote.';
  const third =
    'Councillors from the harbour ward have said they will not back a plan that cuts winter service for islanders.';
  const passages = new Map([['S1', `${first} ${middle} ${third}`]]);
  const quoteOf = (quote: string) => [{ id: 'Council_Larkholm', sourceIds: ['S1'], quote }];
  const message = (quote: string): string => {
    try {
      validateNodeQuotes(quoteOf(quote), passages);
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error('Expected the quote to be rejected.');
  };

  it('is still rejected: skipping a sentence is not an exact excerpt', () => {
    expect(message(`${first} ${third}`)).toContain('Node quotes must be copied exactly');
  });

  it('tells the model which node to fix, and how: one contiguous excerpt or an ellipsis', () => {
    const feedback = message(`${first} ${third}`);
    expect(feedback).toContain('fix the quote for: Council_Larkholm');
    expect(feedback).toContain('one contiguous excerpt');
    expect(feedback).toContain('not next to each other');
    expect(feedback).toContain('ellipsis');
    // The node id comes before the guidance, so the short user-facing form of the error keeps it.
    expect(feedback.indexOf('Council_Larkholm')).toBeLessThan(feedback.indexOf('ellipsis'));
    expect(feedback.slice(0, 200)).toContain('Council_Larkholm');
  });

  it('is accepted once the omission is marked, or when it is one contiguous excerpt', () => {
    expect(() => validateNodeQuotes(quoteOf(`${first} … ${third}`), passages)).not.toThrow();
    expect(() => validateNodeQuotes(quoteOf(`${first} ${middle}`), passages)).not.toThrow();
    expect(() => validateNodeQuotes(quoteOf(third), passages)).not.toThrow();
  });

  it('does not accept an ellipsis that hides text which is not in the passage', () => {
    expect(() =>
      validateNodeQuotes(
        quoteOf(`${first} … The ferry will be free for everyone next year.`),
        passages,
      ),
    ).toThrow(/copied exactly/);
  });
});
