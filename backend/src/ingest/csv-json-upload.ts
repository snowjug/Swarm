import { z } from 'zod';
import { MAX_PDF_BYTES } from '../../../shared/guided.js';
import { documentInputSchema, MAX_DOCUMENT_CHARS } from '../../../shared/types.js';
import { AppError } from '../errors.js';
import { csvToText, DataError, jsonToText } from './url/normalize.js';
import { fit } from './url/text.js';

const DATA_FILE = /\.(csv|json)$/iu;

export const dataFileInputSchema = z.object({
  name: documentInputSchema.shape.name.refine(
    (name) => DATA_FILE.test(name),
    'Select a CSV or JSON file.',
  ),
  data: z
    .string()
    .min(1)
    .max(Math.ceil(MAX_PDF_BYTES / 3) * 4)
    .regex(
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u,
      'Invalid base64 file data.',
    ),
});

export interface ExtractedDataFile {
  name: string;
  /** The file as readable text: JSON as `path: value` lines, a table as its columns and rows. */
  content: string;
  bytes: number;
  notes: string[];
}

/**
 * Reads an uploaded CSV or JSON file into the text a document holds, on the server, so that what is
 * kept is what was read here and not what a browser said it was. Returns null for any other name,
 * so that the caller can go on to treat the upload as a PDF.
 */
export function extractDataFile(body: unknown): ExtractedDataFile | null {
  const given = (body as { name?: unknown } | null)?.name;
  if (typeof given !== 'string' || !DATA_FILE.test(given)) return null;
  const { name, data } = dataFileInputSchema.parse(body);
  const bytes = Buffer.from(data, 'base64');
  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw new AppError(
      413,
      'FILE_TOO_LARGE',
      `Data files must not exceed ${MAX_PDF_BYTES.toLocaleString('en-US')} bytes.`,
    );
  }
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new AppError(
      422,
      'DATA_FILE_ENCODING',
      'This file is not valid UTF-8 text. Save it as UTF-8 and try again.',
    );
  }
  let read: { text: string; truncated: boolean };
  try {
    read = /\.json$/iu.test(name) ? jsonToText(source) : csvToText(source);
  } catch (error) {
    if (error instanceof DataError) {
      throw new AppError(
        422,
        'DATA_FILE_INVALID',
        `${error.message} Check the file, or paste its text instead.`,
      );
    }
    throw error;
  }
  const fitted = fit(read.text, MAX_DOCUMENT_CHARS);
  const document = documentInputSchema.safeParse({ name, content: fitted.text });
  if (!document.success) {
    throw new AppError(
      422,
      'DATA_FILE_NO_TEXT',
      'This file has fewer than 80 characters of readable data. Add more, or paste its text instead.',
    );
  }
  const notes =
    read.truncated || fitted.truncated
      ? [
          `The file is longer than a document can be (${MAX_DOCUMENT_CHARS.toLocaleString('en-US')} characters), so only the beginning was kept. The text says so.`,
        ]
      : [];
  return {
    name: document.data.name,
    content: document.data.content,
    bytes: bytes.byteLength,
    notes,
  };
}
