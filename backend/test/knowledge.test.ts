import { describe, expect, it } from 'vitest';
import { buildLocalGraph, validateCitations } from '../src/knowledge/graph.js';
import { chunkDocuments, retrieve, selectContext } from '../src/knowledge/retrieval.js';
import { sourceText } from './fixtures.js';

describe('local source knowledge', () => {
  const documents = [{ id: 'D1', name: 'transit.md', content: sourceText.repeat(8) }];
  const chunks = chunkDocuments(documents);

  it('creates bounded overlapping passages with exact original offsets and stable IDs', () => {
    expect(chunks.length).toBeGreaterThan(3);
    for (const [index, chunk] of chunks.entries()) {
      expect(chunk.id).toBe(`S${index + 1}`);
      expect(chunk.text).toBe(documents[0]!.content.slice(chunk.start, chunk.end));
      expect(chunk.text.length).toBeLessThanOrEqual(1_200);
      if (index > 0) expect(chunk.start).toBe(chunks[index - 1]!.end - 120);
    }
    expect(chunks.at(-1)!.end).toBe(documents[0]!.content.length);
    expect(chunkDocuments(documents)).toEqual(chunks);
  });

  it('uses actual sparse-vector relevance and does not return success-shaped unrelated evidence', () => {
    expect(retrieve(chunks, 'community transit commuters', 3)).toHaveLength(3);
    expect(retrieve(chunks, 'xylophone zeppelin chemistry')).toEqual([]);
    expect(retrieve(chunks, 'the and is')).toEqual([]);
    for (const result of retrieve(chunks, 'transit')) {
      expect(result.score).toBeGreaterThan(0);
      expect(result.score).toBeLessThanOrEqual(1);
    }
  });

  it('keeps model context inside its character budget', () => {
    const selected = selectContext(chunks, 'transit', 2_400);
    expect(selected.reduce((sum, chunk) => sum + chunk.text.length, 0)).toBeLessThanOrEqual(2_400);
    expect(new Set(selected.map((chunk) => chunk.id)).size).toBe(selected.length);
  });

  it('links every local topic and edge to existing source passages', () => {
    const graph = buildLocalGraph(chunks, 'transit pilot');
    expect(graph.method).toBe('lexical');
    expect(graph.nodes.length).toBeGreaterThanOrEqual(2);
    expect(graph.nodes.length).toBeLessThanOrEqual(12);
    const sourceIds = new Set(chunks.map((chunk) => chunk.id));
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    for (const node of graph.nodes) {
      expect(node.kind).toBe('topic');
      expect(node.sourceIds.length).toBeGreaterThan(0);
      expect(() => validateCitations(node.sourceIds, sourceIds)).not.toThrow();
    }
    for (const edge of graph.edges) {
      expect(nodeIds.has(edge.source) && nodeIds.has(edge.target)).toBe(true);
      expect(edge.label).toBe('co-occurs with');
      expect(() => validateCitations(edge.sourceIds, sourceIds)).not.toThrow();
    }
    expect(() => validateCitations(['S999'], sourceIds)).toThrow('outside the evidence');
  });

  it('fails explicitly on sources with no useful terms', () => {
    const empty = chunkDocuments([{ id: 'D1', name: 'empty.txt', content: 'the and '.repeat(40) }]);
    expect(() => buildLocalGraph(empty, 'anything')).toThrow('at least two informative terms');
  });
});
