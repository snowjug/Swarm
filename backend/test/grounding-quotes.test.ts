import { describe, expect, it } from 'vitest';
import type { ChapterClaim } from '../../shared/grounding.js';
import { normalizeClaimQuotes } from '../src/grounding/quotes.js';
import { findQuote } from '../src/grounding/text.js';

// Captured from live runs of the Larkholm demo (gpt-4.1-mini on Azure): the model listed paraphrased
// statements with quotes it had reworded or stitched together, and repeated them through every
// corrective retry, so the whole report failed over a quote that no statement needed.
const FIRST = 'The Finance Committee will not raise the annual ferry subsidy above $1.8 million.';
const MIDDLE =
  'Any decision to buy a new vessel needs evidence of sustained use and a funding plan before the March budget vote.';
const THIRD =
  'Councillors from the harbour ward have said they will not back a plan that cuts winter service for islanders.';
const OTHER =
  'Harbour fees are reviewed each spring, and berthing charges follow the published tariff.';
const passages = new Map([
  ['S1', `${FIRST} ${MIDDLE} ${THIRD}`],
  ['S2', OTHER],
]);

const claim = (overrides: Partial<ChapterClaim> = {}): ChapterClaim => ({
  text: 'The Finance Committee will not raise the ferry subsidy above $1.8 million.',
  kind: 'source-fact',
  sourceIds: ['S1'],
  memoryIds: [],
  quote: FIRST,
  ...overrides,
});

describe('normalizeClaimQuotes', () => {
  it('leaves verbatim quotes, missing quotes on paraphrases and quotes on other kinds untouched', () => {
    const claims = [
      claim(),
      claim({ kind: 'extracted-claim', quote: `${FIRST} … ${THIRD}` }),
      claim({ kind: 'extracted-claim', quote: null }),
      claim({ kind: 'ai-hypothesis', sourceIds: [], quote: 'text that no passage contains' }),
      claim({ kind: 'simulated-event', sourceIds: [], quote: 'text that no passage contains' }),
    ];
    const result = normalizeClaimQuotes(claims, passages);
    expect(result).toMatchObject({ shortened: 0, removed: 0, relabelled: 0 });
    result.claims.forEach((kept, index) => expect(kept).toBe(claims[index]));
  });

  it('shortens a source fact whose quote runs on into text the passage does not contain', () => {
    const original = claim({ quote: `${FIRST} Trams will replace every bus by 2030.` });
    const result = normalizeClaimQuotes([original], passages);
    expect(result).toMatchObject({ shortened: 1, removed: 0, relabelled: 0 });
    expect(result.claims[0]).toMatchObject({ kind: 'source-fact', quote: FIRST });
    expect(findQuote(result.claims[0]?.quote ?? '', passages).found).toBe(true);
    expect(original.quote).toBe(`${FIRST} Trams will replace every bus by 2030.`);
  });

  it('shortens a paraphrase the same way when the start of its quote is verbatim', () => {
    // The live model joined the first and third sentences of a paragraph.
    const result = normalizeClaimQuotes(
      [claim({ kind: 'extracted-claim', quote: `${FIRST} ${THIRD}` })],
      passages,
    );
    expect(result).toMatchObject({ shortened: 1, removed: 0, relabelled: 0 });
    expect(result.claims[0]?.quote).toBe(FIRST);
  });

  it('removes the quote from a paraphrase when no start of it is in a cited passage', () => {
    const result = normalizeClaimQuotes(
      [claim({ kind: 'extracted-claim', quote: 'The committee has frozen the ferry subsidy' })],
      passages,
    );
    expect(result).toMatchObject({ shortened: 0, removed: 1, relabelled: 0 });
    expect(result.claims[0]?.quote).toBeNull();
    expect(result.claims[0]?.kind).toBe('extracted-claim');
  });

  // Captured from live runs: the model labelled statements "source-fact" and either gave no quote or
  // one that was not in the passage, repeated it through every corrective retry, and the report failed.
  // The label promises a verbatim quote, so a statement that has none is a paraphrase and is shown as one.
  it('shows a source fact whose quote has no verbatim start as an extracted claim, without the quote', () => {
    const invented = claim({ quote: 'The committee has frozen the ferry subsidy' });
    const result = normalizeClaimQuotes([invented], passages);
    expect(result).toMatchObject({ shortened: 0, removed: 1, relabelled: 1 });
    expect(result.claims[0]).toMatchObject({ kind: 'extracted-claim', quote: null });
    expect(result.claims[0]?.text).toBe(invented.text);
    expect(invented.kind).toBe('source-fact');
  });

  it('shows a source fact that has no quote at all as an extracted claim', () => {
    const result = normalizeClaimQuotes([claim({ quote: null })], passages);
    expect(result).toMatchObject({ shortened: 0, removed: 0, relabelled: 1 });
    expect(result.claims[0]).toMatchObject({ kind: 'extracted-claim', quote: null });
  });

  it('only looks in the passages the statement cites', () => {
    const quote = `${OTHER} An invented sentence about trams.`;
    const uncited = normalizeClaimQuotes([claim({ kind: 'extracted-claim', quote })], passages);
    // S2 holds the start of the quote, but the statement cites S1 only.
    expect(uncited).toMatchObject({ shortened: 0, removed: 1 });
    const cited = normalizeClaimQuotes(
      [claim({ kind: 'extracted-claim', sourceIds: ['S2'], quote })],
      passages,
    );
    expect(cited).toMatchObject({ shortened: 1, removed: 0 });
    expect(cited.claims[0]?.quote).toBe(OTHER);
  });

  it('never changes what a statement says or cites, only its quote and, at most, a label it could not back', () => {
    const original = claim({
      kind: 'extracted-claim',
      sourceIds: ['S1', 'S2'],
      memoryIds: ['M1'],
      quote: `${FIRST} Something invented follows.`,
    });
    const [changed] = normalizeClaimQuotes([original], passages).claims;
    expect({ ...changed, quote: null }).toEqual({ ...original, quote: null });
    const [weakened] = normalizeClaimQuotes([claim({ quote: null })], passages).claims;
    expect({ ...weakened, kind: 'source-fact' }).toEqual(claim({ quote: null }));
  });

  it('is idempotent: a second pass changes and counts nothing', () => {
    const once = normalizeClaimQuotes(
      [
        claim({ quote: `${FIRST} ${THIRD}` }),
        claim({ kind: 'extracted-claim', quote: 'The committee has frozen the ferry subsidy' }),
        claim({ quote: 'The committee has frozen the ferry subsidy' }),
        claim({ quote: null }),
      ],
      passages,
    );
    expect(once).toMatchObject({ shortened: 1, removed: 2, relabelled: 2 });
    const twice = normalizeClaimQuotes(once.claims, passages);
    expect(twice.claims).toEqual(once.claims);
    expect(twice).toMatchObject({ shortened: 0, removed: 0, relabelled: 0 });
  });

  it('only ever shortens or removes a quote, and a source fact never keeps one that is not verbatim', () => {
    let seed = 20261028;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const words = `${FIRST} ${MIDDLE} ${THIRD}`.split(' ');
    const junk = ['tariff', 'invented', 'unrelated', 'ferries', 'sunshine', '12%', 'maybe'];
    let adjusted = 0;
    let relabelled = 0;
    for (let round = 0; round < 300; round += 1) {
      const from = Math.floor(random() * (words.length - 6));
      const to = from + 4 + Math.floor(random() * (words.length - from - 4));
      const tail = Array.from(
        { length: Math.floor(random() * 5) },
        () => junk[Math.floor(random() * junk.length)],
      ).join(' ');
      // Some quotes are pure inventions, which have no verbatim start at all.
      const quote =
        random() < 0.2
          ? `${tail} and then something else entirely`.trim()
          : `${words.slice(from, to).join(' ')} ${tail}`.trim();
      const kind = random() < 0.5 ? 'source-fact' : 'extracted-claim';
      const original = claim({ kind, quote });
      const [out] = normalizeClaimQuotes([original], passages).claims;
      expect(out?.sourceIds).toEqual(original.sourceIds);
      // The invariant the "source fact" label rests on.
      if (out?.kind === 'source-fact') {
        expect(findQuote(out.quote ?? '', passages).found, `"${out.quote}" is verbatim`).toBe(true);
      }
      if (out?.kind !== kind) {
        relabelled += 1;
        expect(kind).toBe('source-fact');
        expect(out).toMatchObject({ kind: 'extracted-claim', quote: null });
      }
      if (out?.quote === quote) continue;
      adjusted += 1;
      if (out?.quote === null) continue;
      expect(quote.startsWith(out?.quote ?? ''), `"${out?.quote}" starts "${quote}"`).toBe(true);
      expect(findQuote(out?.quote ?? '', passages).found).toBe(true);
    }
    expect(adjusted).toBeGreaterThan(30);
    expect(relabelled).toBeGreaterThan(5);
  });
});
