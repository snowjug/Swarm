import { describe, expect, it } from 'vitest';
import { keepValidEdges, shortenNodeQuotes, validateNodeQuotes } from '../src/grounding/graph.js';
import { findQuote } from '../src/grounding/text.js';

// The sentences are the live-captured case: a model joined the first and third sentence of a
// paragraph, skipping the second, and could not repair it because nothing said what was wrong.
const FIRST = 'The Finance Committee will not raise the annual ferry subsidy above $1.8 million.';
const MIDDLE =
  'Any decision to buy a new vessel needs evidence of sustained use and a funding plan before the March budget vote.';
const THIRD =
  'Councillors from the harbour ward have said they will not back a plan that cuts winter service for islanders.';
const PASSAGE = `${FIRST} ${MIDDLE} ${THIRD}`;
const passages = new Map([
  ['S1', PASSAGE],
  [
    'S2',
    'Harbour fees are reviewed each spring, and berthing charges follow the published tariff.',
  ],
]);
const node = (quote: string, id = 'n1', sourceIds: string[] = ['S1']) => ({
  id,
  label: id,
  sourceIds,
  quote,
});
const cited = (ids: string[]) =>
  new Map(ids.map((id) => [id, passages.get(id) ?? ''] as [string, string]));

describe('shortenNodeQuotes', () => {
  it('shortens a quote that joins sentences which are not adjacent to its verbatim start', () => {
    const kept = node(`${FIRST} ${THIRD}`);
    const result = shortenNodeQuotes([kept], passages);
    expect(result.shortened).toEqual(['n1']);
    expect(result.nodes[0]?.quote).toBe(FIRST);
    expect(findQuote(result.nodes[0]!.quote, cited(['S1'])).found).toBe(true);
    // The input is not modified.
    expect(kept?.quote).toBe(`${FIRST} ${THIRD}`);
  });

  it('leaves a quote that is already verbatim untouched, including one marked with an ellipsis', () => {
    const exact = node(`${FIRST} ${MIDDLE}`);
    const marked = node(`${FIRST} … ${THIRD}`, 'n2');
    const result = shortenNodeQuotes([exact, marked], passages);
    expect(result.shortened).toEqual([]);
    expect(result.nodes[0]).toBe(exact);
    expect(result.nodes[1]).toBe(marked);
  });

  it('cuts at a word boundary and drops a dangling ellipsis', () => {
    const result = shortenNodeQuotes(
      [node(`${FIRST} … Something the passage never says`)],
      passages,
    );
    expect(result.nodes[0]?.quote).toBe(FIRST);
    const partial = shortenNodeQuotes(
      [node('The Finance Committee will not raise the annual ferry subsidy above an invented sum')],
      passages,
    );
    expect(partial.nodes[0]?.quote).toBe(
      'The Finance Committee will not raise the annual ferry subsidy above',
    );
  });

  it('does not rescue a quote that has no verbatim start, so validation still rejects it', () => {
    const invented = node('A sentence the document never contained at all');
    const result = shortenNodeQuotes([invented], passages);
    expect(result.shortened).toEqual([]);
    expect(result.nodes[0]).toBe(invented);
    expect(() => validateNodeQuotes(result.nodes, passages)).toThrow(/copied exactly/);
  });

  it('does not rescue a start that is shorter than the minimum quote length', () => {
    const result = shortenNodeQuotes(
      [node('The Finance. Then words that are not in it')],
      passages,
    );
    expect(result.shortened).toEqual([]);
    expect(() => validateNodeQuotes(result.nodes, passages)).toThrow();
  });

  it('only looks in the passages the node cites', () => {
    const elsewhere = node(
      'Harbour fees are reviewed each spring, and berthing charges follow an invented tariff.',
    );
    const result = shortenNodeQuotes([elsewhere], passages);
    // The start is verbatim in S2, but the node cites S1 only.
    expect(result.shortened).toEqual([]);
    const citing = shortenNodeQuotes([{ ...elsewhere, sourceIds: ['S2'] }], passages);
    expect(citing.nodes[0]?.quote).toBe(
      'Harbour fees are reviewed each spring, and berthing charges follow',
    );
  });

  it('never returns a quote that is not a verbatim start of what the model wrote', () => {
    let seed = 20260428;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const words = PASSAGE.split(' ');
    const junk = ['tariff', 'invented', 'unrelated', 'ferries', 'sunshine', '12%', 'maybe'];
    let changed = 0;
    for (let round = 0; round < 300; round += 1) {
      const from = Math.floor(random() * (words.length - 6));
      const to = from + 4 + Math.floor(random() * (words.length - from - 4));
      const slice = words.slice(from, to).join(' ');
      const tail = Array.from(
        { length: Math.floor(random() * 5) },
        () => junk[Math.floor(random() * junk.length)],
      ).join(' ');
      const original = `${slice} ${tail}`.trim();
      const [out] = shortenNodeQuotes([node(original)], passages).nodes;
      const quote = out!.quote;
      if (quote === original) continue;
      changed += 1;
      expect(original.startsWith(quote), `"${quote}" is a start of "${original}"`).toBe(true);
      expect(findQuote(quote, cited(['S1'])).found, `"${quote}" is verbatim`).toBe(true);
      expect(quote).toBe(quote.trim());
    }
    expect(changed).toBeGreaterThan(30);
  });
});

describe('keepValidEdges', () => {
  const edge = (source: string, target: string, label: string) => ({
    source,
    target,
    label,
    weight: 0.5,
    sourceIds: ['S1'],
  });
  const nodes = new Set(['n1', 'n2', 'n3']);
  const relations = new Set(['informs', 'opposes']);

  it('keeps relations between two different existing nodes through a defined relationship type', () => {
    const edges = [edge('n1', 'n2', 'informs'), edge('n3', 'n1', 'opposes')];
    const result = keepValidEdges(edges, nodes, relations);
    expect(result.edges).toEqual(edges);
    expect(result.dropped).toBe(0);
  });

  it('leaves out a relation with an unknown type, a missing endpoint or a self-loop, and counts them', () => {
    const good = edge('n1', 'n2', 'informs');
    const result = keepValidEdges(
      [
        edge('n1', 'n2', 'SupportsChange'),
        good,
        edge('n1', 'n9', 'informs'),
        edge('n7', 'n2', 'informs'),
        edge('n2', 'n2', 'informs'),
      ],
      nodes,
      relations,
    );
    expect(result.edges).toEqual([good]);
    expect(result.dropped).toBe(4);
  });

  it('is case-sensitive about relationship types, like the ontology check it replaces', () => {
    expect(keepValidEdges([edge('n1', 'n2', 'Informs')], nodes, relations).dropped).toBe(1);
  });
});
