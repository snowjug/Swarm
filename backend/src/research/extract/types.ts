/** How the text of a document was read: from the page's main region, from the page without its furniture, or from all of it. */
export const EXTRACTION_METHODS = [
  'html-main',
  'html-page',
  'html-all',
  'plain-text',
  'json',
  'csv',
  'pdf',
] as const;
export type ExtractionMethod = (typeof EXTRACTION_METHODS)[number];

export type PassageKind = 'paragraph' | 'list' | 'table' | 'quote' | 'structured' | 'metadata';

/** A part of the text that can be pointed at: `text.slice(start, end)` is exactly the passage. */
export interface Passage {
  start: number;
  end: number;
  /** The headings the passage sits under, outermost first. */
  headingPath: string[];
  kind: PassageKind;
  /** Set when a line of the passage reads like an instruction to an AI. The line is labelled in the text. */
  flagged?: true;
}

export interface ExtractedLink {
  /** Absolute, http or https, without a fragment. Whether it may be fetched is for the caller's policy to say. */
  url: string;
  /** What the link says, cut short; empty when that read like an instruction to an AI. */
  text: string;
  /** The words of the `rel` attribute, lower case. */
  rel: string[];
  /** The link is in the page's own text, not in a menu, header, footer or side panel. */
  inMain: boolean;
}

/** What the page and its headers ask of robots about this page. `none` is both noindex and nofollow. */
export interface RobotsMeta {
  noindex: boolean;
  nofollow: boolean;
  noarchive: boolean;
  /** A page that asks not to be read by AI systems. It is recorded; the caller decides what to do. */
  noai: boolean;
  directives: string[];
}

export interface InjectionSummary {
  /** Blocks of text with at least one line that reads like an instruction to an AI. */
  flaggedBlocks: number;
  totalBlocks: number;
  flaggedChars: number;
  totalChars: number;
}

/**
 * A page as the research reads it: its own text in a plain structure (`# ` headings, `- ` items,
 * `> ` quotes, `| ` table rows), with the places a reader can point at. Everything in it is what the
 * page said, kept as data; none of it is an instruction.
 */
export interface ExtractedDocument {
  title: string | null;
  description: string | null;
  /** The address the page names for itself, when it is valid and on the same site. */
  canonicalUrl: string | null;
  language: string | null;
  /** `YYYY-MM-DD`, from the page's own markup. */
  publishedAt: string | null;
  updatedAt: string | null;
  /** Only when the page names its author in markup: structured data, a meta tag or `rel=author`. Never guessed from a byline. */
  author: string | null;
  openGraph: Record<string, string>;
  /** Facts the page publishes for machines (JSON-LD), as `Type.field: value` lines. Data about the page, not text on it. */
  structured: string[];
  robotsMeta: RobotsMeta;
  text: string;
  passages: Passage[];
  /** SHA-256 of `text`. */
  contentHash: string;
  method: ExtractionMethod;
  /** Things a reader should know before relying on the page. Fixed sentences: none of them holds page text. */
  warnings: string[];
  links: ExtractedLink[];
  injection: InjectionSummary;
}

/** What the page showed besides its text, for the checks that set a page aside. None of it is shown to anyone. */
export interface PageSignals {
  /** The first top-level heading, cut short. */
  headline: string | null;
  /** A password field in the text that was kept. */
  passwordField: boolean;
  /** A sample of the text that was left out as furniture or as hidden, for judging what kind of page this is. */
  leftOutSample: string;
  hiddenText: boolean;
  /** Structured data says the content is not free to read. */
  paywallMarked: boolean;
  /** The `@type` values of the page's structured data. */
  schemaTypes: string[];
  /** Scholarly-publisher meta tags (`citation_*`). */
  citationMeta: boolean;
  /** Characters of the page's own text: not the lines that describe the page, and not the structured data. */
  proseChars: number;
  scripted: boolean;
  noscript: boolean;
  cutShort: boolean;
  /** Why the content could not be read at all, as a fixed sentence. */
  problem: { kind: 'malformed' | 'oversized' | 'empty'; detail: string } | null;
}

export interface Extraction {
  document: ExtractedDocument;
  signals: PageSignals;
}

export interface ExtractInput {
  /** The response decoded to text. */
  text: string;
  /** The media type, lower case, without parameters. */
  contentType: string;
  /** Where the text came from, after any redirects. Links are resolved against it. */
  url: string;
  /** The response headers the fetcher kept (`x-robots-tag`, `content-language`). */
  headers?: Readonly<Record<string, string>>;
  /** Epoch milliseconds when it was fetched, so that a date in the future is not believed. */
  fetchedAt?: number;
}

export interface ExtractLimits {
  /** The deepest the markup may nest before it is read no further. */
  maxDepth: number;
  /** The most nodes a page may have before it is read no further. */
  maxNodes: number;
  /** The most time parsing may take before the page is read no further, in milliseconds. */
  maxParseMs: number;
  /** How long parsing runs before it lets the rest of the process have a turn, and hears a stop, in milliseconds. */
  sliceMs: number;
  /** The most characters of a document, with the notice that says when it was cut. */
  maxChars: number;
  maxLinks: number;
}

export interface ExtractOptions {
  signal?: AbortSignal;
  /** Whether an address the page names as canonical is on the same site as the page. */
  sameSite?: (address: string) => boolean;
  limits?: Partial<ExtractLimits>;
}
