import { extractHtml } from './html.js';
import { DEFAULT_LIMITS } from './parse.js';
import { extractPlain } from './plain.js';
import type { Extraction, ExtractInput, ExtractLimits, ExtractOptions } from './types.js';

export { DEFAULT_LIMITS } from './parse.js';
export { FLAG_LABEL, SHORTENED_NOTICE } from './document.js';
export { extractPdf, looksLikePdf, PdfUnavailable, type PdfReader } from './pdf.js';
export { normalizeDate } from './meta.js';
export type * from './types.js';

/**
 * Reads a fetched page or file into a document of its own text. HTML is parsed by `parse5` (no regular
 * expression reads markup), text, Markdown, CSV and JSON by the project's readers. PDFs are read by
 * `extractPdf`, which needs the project's isolated PDF reader. Nothing in the content is run, followed
 * or obeyed: it is data, and what reads like an instruction to an AI is labelled where it stands.
 */
export async function extractDocument(
  input: ExtractInput,
  options: ExtractOptions = {},
): Promise<Extraction> {
  options.signal?.throwIfAborted();
  const limits: ExtractLimits = { ...DEFAULT_LIMITS, ...options.limits };
  if (input.contentType === 'text/html' || input.contentType === 'application/xhtml+xml') {
    return extractHtml(input, options);
  }
  return extractPlain(input, limits);
}
