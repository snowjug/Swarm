import {
  defaultTreeAdapter,
  Parser,
  type DefaultTreeAdapterMap,
  type DefaultTreeAdapterTypes,
  type TreeAdapter,
} from 'parse5';
import { MAX_DOCUMENT_CHARS } from '../../../../shared/types.js';
import type { ExtractLimits } from './types.js';

export type Document = DefaultTreeAdapterTypes.Document;
export type DocumentFragment = DefaultTreeAdapterTypes.DocumentFragment;

export const DEFAULT_LIMITS: ExtractLimits = {
  maxDepth: 512,
  maxNodes: 400_000,
  maxParseMs: 1_500,
  sliceMs: 20,
  maxWork: 200_000,
  maxChars: MAX_DOCUMENT_CHARS,
  maxLinks: 3_000,
};

export interface Parsed<Root> {
  root: Root;
  /** The page was read no further than its end: it nests deeper, has more nodes, or took longer than is read. */
  cutShort: boolean;
}

// How much is handed to the parser at a time, at most. Between two pieces the time spent is checked, the event
// loop is let go of, and a stop is heard. A tag that goes on for ever is met in pieces, not all at once: the
// tokenizer's work on one tag with many attributes grows with the square of their number, so a piece that
// took long is followed by a smaller one, and smaller ones are followed by larger while they are quick.
const PIECE = 8_192;
const SMALLEST_PIECE = 128;
const SLOW_PIECE_MS = 10;
const QUICK_PIECE_MS = 2;
// No page needs more than this many attributes on one element; what comes after them is not read.
const MAX_ATTRIBUTES = 64;

class Stop extends Error {}

const yieldNow = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * Says when the process is to be given a turn. Work that cannot be interrupted is done in stretches, and
 * after each one that has run for a slice (`sliceMs`) the event loop is let go of, and a stop that came
 * meanwhile is heard. With no slice (`Infinity`) it never lets go, and still hears a stop.
 */
export class Pacer {
  private since = performance.now();

  constructor(private readonly sliceMs: number) {}

  due(now = performance.now()): boolean {
    return now - this.since > this.sliceMs;
  }

  /** Lets the rest of the process have a turn, whether or not one is due. */
  async turn(signal?: AbortSignal): Promise<void> {
    await yieldNow();
    signal?.throwIfAborted();
    this.since = performance.now();
  }

  /** A turn if a slice has run out; otherwise only a check for a stop. */
  async maybe(signal?: AbortSignal): Promise<void> {
    if (this.due()) await this.turn(signal);
    else signal?.throwIfAborted();
  }
}

/**
 * The tree the parser builds, with its depth and size watched as it grows. The parser's own work on a
 * deep tree grows with the square of the depth (a hundred thousand nested `div`s took a minute), so a
 * tree deeper than a real page can be is not built any further.
 */
function watchedAdapter(limits: ExtractLimits): TreeAdapter<DefaultTreeAdapterMap> {
  const depths = new WeakMap<object, number>();
  let nodes = 0;
  const place = (parent: object, child: object): void => {
    const depth = (depths.get(parent) ?? 0) + 1;
    if (depth > limits.maxDepth) throw new Stop();
    depths.set(child, depth);
    nodes += 1;
    if (nodes > limits.maxNodes) throw new Stop();
  };
  return {
    ...defaultTreeAdapter,
    createElement: (tagName, namespaceURI, attrs) =>
      defaultTreeAdapter.createElement(
        tagName,
        namespaceURI,
        attrs.length > MAX_ATTRIBUTES ? attrs.slice(0, MAX_ATTRIBUTES) : attrs,
      ),
    appendChild(parent, child) {
      place(parent, child);
      defaultTreeAdapter.appendChild(parent, child);
    },
    insertBefore(parent, child, reference) {
      place(parent, child);
      defaultTreeAdapter.insertBefore(parent, child, reference);
    },
    insertText(parent, text) {
      nodes += 1;
      if (nodes > limits.maxNodes) throw new Stop();
      defaultTreeAdapter.insertText(parent, text);
    },
  };
}

async function feed(
  parser: Parser<DefaultTreeAdapterMap>,
  html: string,
  limits: ExtractLimits,
  signal: AbortSignal | undefined,
  pacer: Pacer,
): Promise<boolean> {
  let spent = 0;
  let piece = PIECE;
  try {
    for (let at = 0; at < html.length;) {
      let end = Math.min(at + piece, html.length);
      // A piece never ends between the two halves of a character.
      const last = html.charCodeAt(end - 1);
      if (end < html.length && last >= 0xd800 && last <= 0xdbff) end += 1;
      const started = performance.now();
      parser.tokenizer.write(html.slice(at, end), false);
      const now = performance.now();
      const took = now - started;
      spent += took;
      if (spent > limits.maxParseMs) return true;
      if (took > SLOW_PIECE_MS) piece = Math.max(SMALLEST_PIECE, piece >> 1);
      else if (took < QUICK_PIECE_MS) piece = Math.min(PIECE, piece << 1);
      at = end;
      if (pacer.due(now)) await pacer.turn(signal);
    }
    parser.tokenizer.write('', true);
    return false;
  } catch (error) {
    if (error instanceof Stop) return true;
    throw error;
  }
}

/** Parses a page without running any of it, and stops where a page stops being one. */
export async function parseDocument(
  html: string,
  limits: ExtractLimits,
  signal?: AbortSignal,
  pacer: Pacer = new Pacer(limits.sliceMs),
): Promise<Parsed<Document>> {
  signal?.throwIfAborted();
  const parser = new Parser<DefaultTreeAdapterMap>({ treeAdapter: watchedAdapter(limits) });
  const cutShort = await feed(parser, html, limits, signal, pacer);
  return { root: parser.document, cutShort };
}

/** Parses markup that is a part of a page, such as what a page keeps for readers without scripts. */
export async function parseFragment(
  html: string,
  limits: ExtractLimits,
  signal?: AbortSignal,
  pacer: Pacer = new Pacer(limits.sliceMs),
): Promise<Parsed<DocumentFragment>> {
  signal?.throwIfAborted();
  const parser = Parser.getFragmentParser<DefaultTreeAdapterMap>(null, {
    treeAdapter: watchedAdapter(limits),
  });
  const cutShort = await feed(parser, html, limits, signal, pacer);
  return { root: parser.getFragment(), cutShort };
}
