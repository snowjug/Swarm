import { MAX_DOCUMENTS, MAX_DOCUMENT_CHARS, MAX_TOTAL_CHARS } from '../../../../shared/types';
import type { AppConfig, CreateProjectInput } from '../../../../shared/types';

export type DocumentInput = CreateProjectInput['documents'][number];

const keys = new WeakMap<object, number>();
let issued = 0;

/**
 * What a source is known by while the others come and go: the list is replaced, never changed in place, so a
 * position or a name cannot stand for a source (taking the first away would give every other one a new key and
 * the whole row would leave and arrive again). A value that is made from another one (a correction of its text)
 * carries the key on with `carryKey`.
 */
export function keyOf(document: DocumentInput): number {
  let key = keys.get(document);
  if (key === undefined) {
    issued += 1;
    key = issued;
    keys.set(document, key);
  }
  return key;
}

export function carryKey(from: DocumentInput, to: DocumentInput): DocumentInput {
  keys.set(to, keyOf(from));
  return to;
}

type Provenance = NonNullable<DocumentInput['provenance']>;
const fetchedAs = new WeakMap<DocumentInput, { content: string; provenance: Provenance }>();

const wasFetched = (provenance: DocumentInput['provenance']): provenance is Provenance =>
  provenance?.kind === 'url' || provenance?.fetchedByServer === true;

/**
 * The same source with its text changed by the person. A page the server fetched is only called one while its text
 * is the text that came: the server keeps that rule too (it vouches for the exact text it fetched), and the page says
 * so first, rather than go on calling an edited text "a public web page" until the project is made.
 */
export function withText(document: DocumentInput, content: string): DocumentInput {
  const came =
    fetchedAs.get(document) ??
    (wasFetched(document.provenance)
      ? { content: document.content, provenance: document.provenance }
      : undefined);
  const next: DocumentInput = { ...document, content };
  if (came) {
    fetchedAs.set(next, came);
    next.provenance =
      content.trim() === came.content.trim() ? came.provenance : { kind: 'paste' as const };
  }
  return carryKey(document, next);
}

/** Whether this was a page that the server fetched, and has been changed since: it is now the person's own text. */
export const editedPage = (document: DocumentInput): boolean =>
  fetchedAs.has(document) && !wasFetched(document.provenance);

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
  if (!kind) {
    return pdfAvailable
      ? 'Use UTF-8 TXT, Markdown, CSV, JSON or a text-based PDF.'
      : 'Use UTF-8 TXT, Markdown, CSV or JSON.';
  }
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

/** A named public page found in the question, as an address; null when there is none. */
export function firstUrl(text: string): string | null {
  const found = /\bhttps?:\/\/[^\s<>"'`]+/iu.exec(text);
  if (!found) return null;
  // What closes a sentence or a bracket around the address is not part of it.
  const address = found[0].replace(/[.,;:!?)\]}]+$/u, '');
  try {
    const url = new URL(address);
    return url.hostname ? address : null;
  } catch {
    return null;
  }
}

/** The site of an address, for a short label ("example.org"); empty when it is not an address. */
export function siteOf(address: string): string {
  try {
    return new URL(address).hostname.replace(/^www\./u, '');
  } catch {
    return '';
  }
}

const normal = (address: string | undefined): string => {
  try {
    const url = new URL(address ?? '');
    url.hash = '';
    return url.href.replace(/\/$/u, '').toLowerCase();
  } catch {
    return '';
  }
};

/** Whether a source is the page at this address (the one asked for, or the one it ended on after a redirect). */
export function samePage(document: DocumentInput, address: string): boolean {
  const wanted = normal(address);
  return (
    wanted !== '' &&
    [document.provenance?.url, document.provenance?.finalUrl].some((url) => normal(url) === wanted)
  );
}

/** "1.9k characters", "412 characters": what the size of a source is called. */
export function sizeText(characters: number): string {
  if (characters >= 10_000) return `${Math.round(characters / 1000)}k characters`;
  if (characters >= 1_000) return `${(characters / 1000).toFixed(1)}k characters`;
  return `${characters} characters`;
}

/** A message from the server in two parts: its words, and the number to quote when asking about it, if it gave one. */
export function splitRequestId(message: string): { words: string; requestId: string | null } {
  const found = /\s*Request ID: (\S+)\s*$/u.exec(message);
  return found
    ? { words: message.slice(0, found.index).trim(), requestId: found[1] ?? null }
    : { words: message.trim(), requestId: null };
}

export function totalOf(documents: readonly DocumentInput[]): number {
  return documents.reduce((sum, document) => sum + document.content.length, 0);
}

/**
 * Why one more source of this many characters cannot join those attached, in a sentence, or null when it can. The
 * same sentence for a pasted text, a fetched page and a file that was read while something else was attached.
 */
export function roomProblem(
  attached: readonly DocumentInput[],
  characters: number,
  limits: EvidenceLimits,
): string | null {
  if (attached.length < limits.maxDocuments && totalOf(attached) + characters <= limits.maxTotal) {
    return null;
  }
  return `Use at most ${limits.maxDocuments} documents and ${limits.maxTotal.toLocaleString('en-GB')} total characters.`;
}

/** A name for the next pasted source that no attached source has. */
export function nextPasteName(documents: readonly DocumentInput[]): string {
  const taken = new Set(documents.map((document) => document.name));
  for (let n = documents.length + 1; ; n += 1) {
    const name = n === 1 ? 'notes.txt' : `notes-${n}.txt`;
    if (!taken.has(name)) return name;
  }
}
