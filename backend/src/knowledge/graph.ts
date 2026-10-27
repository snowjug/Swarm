import type { EvidenceChunk, KnowledgeEdge, KnowledgeGraph } from '../../../shared/types.js';
import { AppError } from '../errors.js';
import { frequencies, tokenize } from './retrieval.js';

export function buildLocalGraph(chunks: EvidenceChunk[], question: string): KnowledgeGraph {
  const counts = frequencies(chunks.map((chunk) => chunk.text).join('\n'));
  const queryTerms = new Set(tokenize(question));
  const ranked = [...counts]
    .sort(
      ([left, leftCount], [right, rightCount]) =>
        rightCount * (queryTerms.has(right) ? 1.5 : 1) -
          leftCount * (queryTerms.has(left) ? 1.5 : 1) || left.localeCompare(right),
    )
    .slice(0, 12);
  if (ranked.length < 2) {
    throw new AppError(
      422,
      'INSUFFICIENT_SOURCE',
      'The sources need at least two informative terms. Add substantial source material.',
    );
  }
  const termsByChunk = chunks.map((chunk) => new Set(tokenize(chunk.text)));
  const highest = Math.max(...ranked.map(([, count]) => count));
  const nodes = ranked.map(([term, count], index) => {
    const matching = chunks.filter((_, chunkIndex) => termsByChunk[chunkIndex]?.has(term));
    return {
      id: `topic-${index + 1}`,
      label: term.charAt(0).toUpperCase() + term.slice(1),
      kind: 'topic' as const,
      summary: `Frequent source term: ${count} occurrences in the indexed overlapping passages; present in ${matching.length} passages. Not a semantic entity inference.`,
      weight: count / highest,
      sourceIds: matching.slice(0, 4).map((chunk) => chunk.id),
    };
  });
  const edges: KnowledgeEdge[] = [];
  for (let left = 0; left < nodes.length; left += 1) {
    for (let right = left + 1; right < nodes.length; right += 1) {
      const source = nodes[left];
      const target = nodes[right];
      if (!source || !target) throw new Error('The knowledge graph is inconsistent.');
      const matching = chunks.filter(
        (_, index) =>
          termsByChunk[index]?.has(source.label.toLowerCase()) &&
          termsByChunk[index]?.has(target.label.toLowerCase()),
      );
      if (matching.length) {
        edges.push({
          source: source.id,
          target: target.id,
          label: 'co-occurs with',
          weight: matching.length / Math.max(chunks.length, 1),
          sourceIds: matching.slice(0, 4).map((chunk) => chunk.id),
        });
      }
    }
  }
  return {
    method: 'lexical',
    nodes,
    edges: edges.sort((left, right) => right.weight - left.weight).slice(0, 36),
    notes: [
      'Local term-frequency extraction: nodes are topics, not verified people or organizations.',
      'Edges indicate passage co-occurrence, not causal or established semantic relationships.',
      'Overlapping chunks can count the same occurrence more than once.',
    ],
  };
}

export function validateCitations(sourceIds: string[], allowed: Set<string>): void {
  if (sourceIds.some((id) => !allowed.has(id))) {
    // Model-supplied IDs are deliberately not echoed; the trusted list of valid IDs helps a repair.
    throw new AppError(
      502,
      'MODEL_OUTPUT_INVALID',
      `The model returned citations outside the evidence provided to it (valid passage IDs: ${[...allowed].slice(0, 20).join(', ') || 'none'}). Retry or use a more reliable model.`,
    );
  }
}
