import { researchSourceSchema, type ResearchSource } from '../../../shared/research.js';
import { sha256 } from '../../src/ingest/url/provenance.js';
import type { CrawledPage } from '../../src/research/crawler/types.js';
import type { ExtractedDocument, Passage } from '../../src/research/extract/types.js';
import { prose } from './research-pages.js';

export interface Block {
  text: string;
  heading?: string;
  kind?: Passage['kind'];
  path?: string[];
}

/**
 * A page of the given passages, as the crawler hands it over: laid out as the extractor lays text
 * out (a heading line, then its passage), with a record of where it was read from. For the tests
 * of what is done with pages once they are read, where the pages must be exactly what the test says.
 */
export function pageOf(
  number: number,
  blocks: readonly (string | Block)[],
  changes: Partial<ResearchSource> = {},
): CrawledPage {
  let text = '';
  const passages: Passage[] = [];
  for (const item of blocks) {
    const block = typeof item === 'string' ? { text: item } : item;
    if (block.heading) text += `# ${block.heading}\n\n`;
    const start = text.length;
    text += block.text;
    passages.push({
      start,
      end: text.length,
      headingPath: block.path ?? (block.heading ? [block.heading] : []),
      kind: block.kind ?? 'paragraph',
    });
    text += '\n\n';
  }
  text = text.trimEnd();
  const address = changes.requestedUrl ?? `https://site${number}.example.org/page`;
  const source = researchSourceSchema.parse({
    id: `rs-${number.toString(16).padStart(10, '0')}`,
    requestedUrl: address,
    finalUrl: address,
    fetchedAt: '2026-05-01T10:00:00.000Z',
    httpStatus: 200,
    contentType: 'text/html',
    title: `Page ${number}`,
    retrievalMethod: 'http-get',
    category: 'unclassified',
    authority: 'unknown',
    depth: 1,
    discoveredBy: 'link',
    robots: 'allowed',
    outcome: 'read',
    ...changes,
  });
  const document: ExtractedDocument = {
    title: source.title,
    description: null,
    canonicalUrl: null,
    language: 'en',
    publishedAt: null,
    updatedAt: null,
    author: null,
    openGraph: {},
    structured: [],
    robotsMeta: { noindex: false, nofollow: false, noarchive: false, noai: false, directives: [] },
    text,
    passages,
    contentHash: sha256(text),
    method: 'html-main',
    warnings: [],
    links: [],
    injection: { flaggedBlocks: 0, totalBlocks: 0, flaggedChars: 0, totalChars: 0 },
  };
  return { source, document };
}

export const FEES =
  'The harbour authority sets its berthing fees for coastal vessels once a year, after a public meeting of the board that reviews them.';

/** What bears on the question, then prose of the page's own that says nothing about it. */
export const about = (seed: number, ...more: string[]): string[] => [FEES, ...more, ...prose(seed)];

/** Changes to a source: a page that a person named, and one from a site that is estimated to know its subject. */
export const named = { discoveredBy: 'user-url', depth: 0 } as const;
export const gov = { authority: 'high', category: 'government-regulatory' } as const;
