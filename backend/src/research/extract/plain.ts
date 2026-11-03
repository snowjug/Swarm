import { csvToText, DataError, jsonToText, plainToText } from '../../ingest/url/normalize.js';
import { sha256 } from '../../ingest/url/provenance.js';
import { inline } from '../../ingest/url/text.js';
import { assemble, type Part } from './document.js';
import { DEFAULT_LIMITS } from './parse.js';
import { robotsOf } from './meta.js';
import type {
  ExtractedDocument,
  Extraction,
  ExtractInput,
  ExtractionMethod,
  ExtractLimits,
  PageSignals,
} from './types.js';

const ROWS_PER_PASSAGE = 20;
const LINES_PER_PASSAGE = 25;
const HEADING = /^(#{1,6})\s+(\S.*)$/u;
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+\S/u;

const noSignals = (proseChars: number, problem: PageSignals['problem']): PageSignals => ({
  headline: null,
  passwordField: false,
  leftOutSample: '',
  hiddenText: false,
  paywallMarked: false,
  schemaTypes: [],
  citationMeta: false,
  proseChars,
  scripted: false,
  noscript: false,
  cutShort: false,
  problem,
});

/** What was read, as a document that has no page around it: no metadata, no links. */
export function plainDocument(
  input: Pick<ExtractInput, 'headers'>,
  method: ExtractionMethod,
  parts: readonly Part[],
  limits: ExtractLimits,
  title: string | null = null,
  warnings: readonly string[] = [],
): Extraction {
  const assembled = assemble([], parts, [], limits.maxChars);
  const notes = [...warnings];
  if (assembled.truncated) {
    notes.push('The text is longer than one document can be, so only the beginning was kept.');
  }
  if (assembled.injection.flaggedBlocks > 0) {
    notes.push(
      'Some lines read like instructions to an AI. They are labelled in the text and were not followed.',
    );
  }
  const document: ExtractedDocument = {
    title,
    description: null,
    canonicalUrl: null,
    language: null,
    publishedAt: null,
    updatedAt: null,
    author: null,
    openGraph: {},
    structured: [],
    robotsMeta: robotsOf({ metas: [] }, input.headers?.['x-robots-tag']),
    text: assembled.text,
    passages: assembled.passages,
    contentHash: sha256(assembled.text),
    method,
    warnings: notes.slice(0, 8),
    links: [],
    injection: assembled.injection,
  };
  return { document, signals: noSignals(assembled.proseChars, null) };
}

/** A document with no text, for content that could not be read at all. */
export function unreadable(
  input: Pick<ExtractInput, 'headers'>,
  method: ExtractionMethod,
  problem: NonNullable<PageSignals['problem']>,
  limits: ExtractLimits = DEFAULT_LIMITS,
): Extraction {
  const { document } = plainDocument(input, method, [], limits);
  return { document, signals: noSignals(0, problem) };
}

/** Text and Markdown: paragraphs, and where Markdown marks them, headings, lists, quotations and tables. */
function textParts(source: string, markdown: boolean): { parts: Part[]; title: string | null } {
  const parts: Part[] = [];
  let title: string | null = null;
  let run: string[] = [];
  let kind: 'paragraph' | 'list' | 'quote' | 'table' = 'paragraph';
  const close = (): void => {
    if (run.length > 0) parts.push({ kind, lines: run });
    run = [];
    kind = 'paragraph';
  };
  const kindOf = (line: string): typeof kind => {
    if (!markdown) return 'paragraph';
    if (/^\s*>/u.test(line)) return 'quote';
    if (/^\s*\|/u.test(line)) return 'table';
    return ITEM.test(line) ? 'list' : 'paragraph';
  };
  for (const line of source.split('\n')) {
    if (line.trim() === '') {
      close();
      continue;
    }
    const heading = markdown ? HEADING.exec(line) : null;
    if (heading) {
      close();
      const text = inline(heading[2] ?? '');
      title ??= heading[1] === '#' ? text.slice(0, 300) : null;
      parts.push({
        kind: 'heading',
        level: (heading[1] ?? '#').length,
        line: `${heading[1]} ${text}`,
      });
      continue;
    }
    const next = kindOf(line);
    // A list continues over an indented line, and everything else breaks where its kind changes.
    if (
      run.length > 0 &&
      next !== kind &&
      !(kind === 'list' && next === 'paragraph' && /^\s/u.test(line))
    ) {
      close();
    }
    if (run.length === 0) kind = next;
    run.push(line.trimEnd());
  }
  close();
  return { parts, title };
}

function chunks(lines: readonly string[], size: number, kind: 'table' | 'structured'): Part[] {
  const parts: Part[] = [];
  for (let at = 0; at < lines.length; at += size)
    parts.push({ kind, lines: lines.slice(at, at + size) });
  return parts;
}

/** Text, Markdown, CSV and JSON: read as they are, by the project's own readers, and never run. */
export function extractPlain(
  input: ExtractInput,
  limits: ExtractLimits = DEFAULT_LIMITS,
): Extraction {
  try {
    if (input.contentType === 'application/json') {
      const { text } = jsonToText(input.text);
      return plainDocument(
        input,
        'json',
        chunks(text.split('\n'), LINES_PER_PASSAGE, 'structured'),
        limits,
      );
    }
    if (input.contentType === 'text/csv') {
      const { text } = csvToText(input.text);
      return plainDocument(
        input,
        'csv',
        chunks(text.split('\n'), ROWS_PER_PASSAGE, 'table'),
        limits,
      );
    }
    const markdown = input.contentType === 'text/markdown';
    const { parts, title } = textParts(plainToText(input.text), markdown);
    return plainDocument(input, 'plain-text', parts, limits, title);
  } catch (error) {
    if (error instanceof DataError) {
      const method = input.contentType === 'application/json' ? 'json' : 'csv';
      const kind = error.message.includes('no rows') ? 'empty' : 'malformed';
      return unreadable(input, method, { kind, detail: error.message }, limits);
    }
    throw error;
  }
}
