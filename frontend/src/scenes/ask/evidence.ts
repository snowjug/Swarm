import { MAX_DOCUMENTS, MAX_DOCUMENT_CHARS, MAX_TOTAL_CHARS } from '../../../../shared/types';
import type { AppConfig, CreateProjectInput } from '../../../../shared/types';

export type DocumentInput = CreateProjectInput['documents'][number];

export interface EvidenceLimits {
  maxDocuments: number;
  maxChars: number;
  maxTotal: number;
  maxBytes: number;
  maxPages: number;
}

/** What the server will take, from its own configuration; the shared constants before it has answered. */
export function limitsOf(config: AppConfig | null): EvidenceLimits {
  const limits = config?.limits;
  return {
    maxDocuments: limits?.maxDocuments ?? MAX_DOCUMENTS,
    maxChars: limits?.maxDocumentChars ?? MAX_DOCUMENT_CHARS,
    maxTotal: limits?.maxTotalChars ?? MAX_TOTAL_CHARS,
    maxBytes: limits?.maxPdfBytes ?? 2_000_000,
    maxPages: limits?.maxPdfPages ?? 40,
  };
}

/** Base64 of some bytes, in chunks that a call can take. */
export function base64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return btoa(chunks.join(''));
}

export type FileKind = 'pdf' | 'table' | 'text';

/** What a file is read as, or null when it is not a kind Swarm reads. */
export function fileKind(name: string): FileKind | null {
  if (/\.pdf$/iu.test(name)) return 'pdf';
  if (/\.(csv|json)$/iu.test(name)) return 'table';
  if (/\.(txt|md|markdown)$/iu.test(name)) return 'text';
  return null;
}

/** Why a file cannot be read, in a sentence, or null when it can. Nothing is read to answer this. */
export function fileProblem(
  file: { name: string; size: number },
  limits: EvidenceLimits,
  pdfAvailable: boolean,
): string | null {
  const kind = fileKind(file.name);
  if (!kind) return 'Use UTF-8 TXT, Markdown, CSV, JSON or a text-based PDF.';
  if (kind === 'pdf' && !pdfAvailable) return 'PDF extraction is unavailable on this server.';
  if (kind === 'pdf' && file.size > limits.maxBytes)
    return 'PDF files must be at most 2 MB before extraction.';
  if (kind === 'table' && file.size > limits.maxBytes)
    return 'CSV and JSON files must be at most 2 MB.';
  if (kind === 'text' && file.size > limits.maxChars * 4) {
    return `Text sources must be at most ${limits.maxChars.toLocaleString('en-GB')} characters.`;
  }
  return null;
}

/**
 * What the validator found wrong with a source, in the product's words: its own messages are written for a person
 * where the schema gave one, and "Too big: expected string to have <=40000 characters" is not.
 */
export function documentProblem(
  issues: readonly { code: string; message: string; path: readonly PropertyKey[] }[],
  limits: EvidenceLimits,
): string {
  return issues
    .map((issue) => {
      if (issue.code === 'too_big' && issue.path[0] === 'content')
        return `A source can hold at most ${limits.maxChars.toLocaleString('en-GB')} characters.`;
      if (issue.code === 'too_big' && issue.path[0] === 'name')
        return 'That file name is too long.';
      return issue.message;
    })
    .join(' ');
}

/** "1.9k characters", "412 characters": what the size of a source is called. */
export function sizeText(characters: number): string {
  if (characters >= 10_000) return `${Math.round(characters / 1000)}k characters`;
  if (characters >= 1_000) return `${(characters / 1000).toFixed(1)}k characters`;
  return `${characters} characters`;
}

export function totalOf(documents: readonly DocumentInput[]): number {
  return documents.reduce((sum, document) => sum + document.content.length, 0);
}

/** A name for the next pasted source that no attached source has. */
export function nextPasteName(documents: readonly DocumentInput[]): string {
  const taken = new Set(documents.map((document) => document.name));
  for (let n = documents.length + 1; ; n += 1) {
    const name = n === 1 ? 'notes.txt' : `notes-${n}.txt`;
    if (!taken.has(name)) return name;
  }
}
