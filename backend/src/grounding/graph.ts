import { AppError } from '../errors.js';
import { findQuote } from './text.js';

/**
 * Every node of a model-built graph must carry an excerpt that really appears in one of the
 * passages it cites. Node ids are restricted to a safe identifier alphabet by the schema, so they
 * can be named in the error that is sent back to the model for a corrective retry.
 */
export function validateNodeQuotes(
  nodes: ReadonlyArray<{ id: string; sourceIds: string[]; quote: string }>,
  passages: ReadonlyMap<string, string>,
): void {
  const failing = nodes
    .filter((node) => {
      const cited = new Map<string, string>();
      for (const id of node.sourceIds) {
        const text = passages.get(id);
        if (text !== undefined) cited.set(id, text);
      }
      return !findQuote(node.quote, cited).found;
    })
    .map((node) => node.id);
  if (failing.length > 0) {
    throw new AppError(
      502,
      'MODEL_OUTPUT_INVALID',
      `Node quotes must be copied exactly (at least 12 characters) from one of the passages that node cites; fix the quote for: ${failing.slice(0, 8).join(', ')}.`,
    );
  }
}
