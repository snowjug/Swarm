import { AppError } from '../../errors.js';
import { DEFAULT_LIMITS } from './parse.js';
import { plainDocument, unreadable } from './plain.js';
import type { Part } from './document.js';
import type { Extraction, ExtractInput, ExtractLimits } from './types.js';

/**
 * The project's PDF reader, which parses in an isolated worker with its own memory, time and size
 * limits (`ingest/pdf.ts`, `PdfService`). The crawler has no PDF parser of its own: a PDF is read
 * there or it is not read.
 */
export interface PdfReader {
  extract(
    name: string,
    base64: string,
    signal?: AbortSignal,
  ): Promise<{ content: string; pageCount: number; bytes: number }>;
}

const SIGNATURE = '%PDF-';

const OVERSIZED = new Set(['PDF_PAGE_LIMIT', 'PDF_TEXT_LIMIT', 'PDF_BYTE_LIMIT']);

/** Whether the bytes begin the way every PDF does. */
export const looksLikePdf = (bytes: Buffer): boolean =>
  bytes.subarray(0, SIGNATURE.length).toString('latin1') === SIGNATURE;

/** A PDF busy elsewhere, or a reader that is stopping: not a verdict on the PDF, so it is for the caller to try again. */
export class PdfUnavailable extends Error {
  constructor() {
    super('The PDF reader is not available.');
    this.name = 'PdfUnavailable';
  }
}

function paragraphs(text: string): Part[] {
  return text
    .split(/\n{2,}/u)
    .map((block) => block.replace(/\s*\n\s*/gu, ' ').trim())
    .filter(Boolean)
    .map((line): Part => ({ kind: 'paragraph', lines: [line] }));
}

/** Reads a PDF through the existing reader, and says plainly when it cannot: no OCR, no repair, no guessing. */
export async function extractPdf(
  bytes: Buffer,
  reader: PdfReader,
  input: Pick<ExtractInput, 'headers'>,
  limits: ExtractLimits = DEFAULT_LIMITS,
  signal?: AbortSignal,
): Promise<Extraction> {
  if (!looksLikePdf(bytes)) {
    return unreadable(
      input,
      'pdf',
      { kind: 'malformed', detail: 'The file is not a PDF.' },
      limits,
    );
  }
  try {
    const read = await reader.extract('page.pdf', bytes.toString('base64'), signal);
    return plainDocument(input, 'pdf', paragraphs(read.content), limits);
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof AppError) {
      if (error.code === 'PDF_BUSY' || error.code === 'SERVER_STOPPING') throw new PdfUnavailable();
      if (OVERSIZED.has(error.code)) {
        return unreadable(
          input,
          'pdf',
          { kind: 'oversized', detail: 'The PDF is longer than Swarm reads.' },
          limits,
        );
      }
      if (error.code === 'PDF_NO_TEXT') {
        return unreadable(
          input,
          'pdf',
          {
            kind: 'empty',
            detail: 'The PDF has no text to read. Scanned pages need OCR, which Swarm does not do.',
          },
          limits,
        );
      }
    }
    return unreadable(
      input,
      'pdf',
      {
        kind: 'malformed',
        detail: 'The PDF is damaged, encrypted or in a form Swarm cannot read.',
      },
      limits,
    );
  }
}
