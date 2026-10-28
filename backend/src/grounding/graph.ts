import { AppError } from '../errors.js';
import { citedPassages, verbatimStart } from './quotes.js';
import { findQuote } from './text.js';

interface QuoteNode {
  id: string;
  sourceIds: string[];
  quote: string;
}

/**
 * Shortens every node quote that runs past the text it cites to its longest verbatim start. A quote
 * that is already verbatim is untouched, and one with no verbatim start of the minimum length is left
 * as it is, so `validateNodeQuotes` still rejects it. This can only reduce what a quote claims: the
 * result is always a true excerpt of a cited passage. It is pure, and returns the ids it changed so
 * the change can be disclosed.
 */
export function shortenNodeQuotes<T extends QuoteNode>(
  nodes: readonly T[],
  passages: ReadonlyMap<string, string>,
): { nodes: T[]; shortened: string[] } {
  const shortened: string[] = [];
  const result = nodes.map((node) => {
    const cited = citedPassages(node.sourceIds, passages);
    if (findQuote(node.quote, cited).found) return node;
    const start = verbatimStart(node.quote, cited);
    if (start === null) return node;
    shortened.push(node.id);
    return { ...node, quote: start };
  });
  return { nodes: result, shortened };
}

/**
 * Keeps the relations that connect two different, existing nodes through a relationship type that
 * the scenario ontology defines. A relation that does not is left out rather than failing the whole
 * graph: leaving one out removes a claimed link and cannot add one.
 */
export function keepValidEdges<T extends { source: string; target: string; label: string }>(
  edges: readonly T[],
  nodeIds: ReadonlySet<string>,
  relationNames: ReadonlySet<string>,
): { edges: T[]; dropped: number } {
  const kept = edges.filter(
    (edge) =>
      nodeIds.has(edge.source) &&
      nodeIds.has(edge.target) &&
      edge.source !== edge.target &&
      relationNames.has(edge.label),
  );
  return { edges: kept, dropped: edges.length - kept.length };
}

/**
 * Every node of a model-built graph must carry an excerpt that really appears in one of the
 * passages it cites. Node ids are restricted to a safe identifier alphabet by the schema, so they
 * can be named in the error that is sent back to the model for a corrective retry.
 */
export function validateNodeQuotes(
  nodes: readonly QuoteNode[],
  passages: ReadonlyMap<string, string>,
): void {
  const failing = nodes
    .filter((node) => !findQuote(node.quote, citedPassages(node.sourceIds, passages)).found)
    .map((node) => node.id);
  if (failing.length > 0) {
    throw new AppError(
      502,
      'MODEL_OUTPUT_INVALID',
      `Node quotes must be copied exactly (at least 12 characters) from one of the passages that node cites; fix the quote for: ${failing.slice(0, 8).join(', ')}. ` +
        'Each quote must be one contiguous excerpt: do not join sentences that are not next to each other. Shorten the quote to one excerpt, or mark each omission with an ellipsis (…).',
    );
  }
}
