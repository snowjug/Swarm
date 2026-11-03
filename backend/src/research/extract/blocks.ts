import type { DefaultTreeAdapterTypes } from 'parse5';
import { inline, sanitize } from '../../ingest/url/text.js';
import { attributesOf, hides } from './tags.js';

type Node = DefaultTreeAdapterTypes.Node;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;
type Element = DefaultTreeAdapterTypes.Element;

/** A main region or an article: the part of a page that holds its own text. */
export interface Region {
  kind: 'main' | 'article';
  parent: Region | null;
}

export type BlockKind = 'heading' | 'paragraph' | 'list' | 'table' | 'quote';

/** One block of the page's text: a heading, a paragraph, a list, a table or a quotation. */
export interface RawBlock {
  kind: BlockKind;
  /** The block as it is written in the document: `## Heading`, `- item`, `| a | b |`, `> quote`. */
  text: string;
  region: Region | null;
}

/** What turns the page's elements into the words a block builder is given. */
export interface Walker {
  readonly maxDepth: number;
  visitChildren(parent: ParentNode, depth: number): void;
}

interface Sink {
  /** Where the blocks are going: the page, a list item, a table cell or a quotation. */
  kind: 'root' | 'item' | 'cell' | 'quote';
  blocks: RawBlock[];
}

interface ListState {
  lines: string[];
  cut: boolean;
}

interface Item {
  sink: Sink;
  indent: string;
  list: ListState;
}

interface Cell {
  text: string;
  blocks: RawBlock[];
}

interface TableState {
  caption: string | null;
  rows: Cell[][];
  structural: boolean;
}

// A line break that is the page's own (`br`), as opposed to the ones in its source.
const BREAK = '\ue000';
// Once this much text has been kept the rest of the page cannot be part of the document.
const MAX_BODY_CHARS = 200_000;
const MAX_INLINE_CHARS = 400_000;
const MAX_LIST_LINES = 500;
const MAX_ROWS = 500;
const MAX_COLUMNS = 50;
const MAX_PRE_LINES = 200;
const CELL_CHARS = 400;
const LAYOUT_CELL_CHARS = 200;

const isElement = (node: Node): node is Element => 'tagName' in node;
const oneLine = (block: RawBlock): string => block.text.replace(/\n+/gu, ' ');

/**
 * How the words of a page become blocks: paragraphs, headings, lists, tables and quotations, each
 * as it is written in the document. Words are gathered until a block ends; a list item, a table cell
 * or a quotation gathers its own blocks first, and they are put together when it ends.
 */
export class BlockBuilder {
  private readonly root: Sink = { kind: 'root', blocks: [] };
  private sinks: Sink[] = [this.root];
  private inlineText = '';
  private preformatted = false;
  private preText = '';
  private lists: ListState[] = [];
  private items: Item[] = [];
  /** The main region or article the words being read are in. */
  region: Region | null = null;
  /** The characters of the blocks that have been kept, once they are in the page's own text. */
  kept = 0;
  full = false;
  headline: string | null = null;

  constructor(private readonly walker: Walker) {}

  get blocks(): RawBlock[] {
    return this.root.blocks;
  }

  // -- words -------------------------------------------------------------------------------------

  text(value: string): void {
    if (this.preformatted) {
      if (this.preText.length < MAX_INLINE_CHARS) this.preText += value;
    } else if (this.inlineText.length < MAX_INLINE_CHARS) this.inlineText += value;
  }

  lineBreak(): void {
    if (this.preformatted) this.preText += '\n';
    else this.inlineText += BREAK;
  }

  private get sink(): Sink {
    return this.sinks[this.sinks.length - 1] as Sink;
  }

  private emit(kind: BlockKind, text: string): void {
    if (!text) return;
    this.sink.blocks.push({ kind, text, region: this.region });
    if (this.sink === this.root) {
      this.kept += text.length + 2;
      if (this.kept > MAX_BODY_CHARS) this.full = true;
    }
  }

  /** The words gathered so far become a paragraph. */
  flush(): void {
    const raw = this.inlineText;
    this.inlineText = '';
    if (!raw) return;
    const lines = raw
      .split(BREAK)
      .map((line) => inline(line))
      .filter(Boolean);
    this.emit('paragraph', lines.join('\n'));
  }

  /** The words inside an element, as one line, leaving what is gathered outside it as it was. */
  capture(element: Element, depth: number): string {
    const saved = this.inlineText;
    this.inlineText = '';
    this.walker.visitChildren(element, depth + 1);
    const got = this.inlineText;
    this.inlineText = saved;
    return inline(got.split(BREAK).join(' '));
  }

  /** Reads with the blocks gathered in `sink`, outside any list that the page is in the middle of. */
  private gather(sink: Sink, read: () => void): void {
    const { lists, items } = this;
    this.lists = [];
    this.items = [];
    this.sinks.push(sink);
    read();
    this.flush();
    this.sinks.pop();
    this.lists = lists;
    this.items = items;
  }

  // -- headings, captions, code and quotations ------------------------------------------------------

  heading(element: Element, level: number, depth: number): void {
    this.flush();
    const text = this.capture(element, depth).slice(0, 400);
    if (!text) return;
    if (level === 1 && this.headline === null) this.headline = text.slice(0, 200);
    // Inside a list item or a quotation a heading is words like any others; in a cell it stays one, for a table that lays out a page.
    if (this.sink.kind === 'item' || this.sink.kind === 'quote') this.emit('paragraph', text);
    else this.emit('heading', `${'#'.repeat(level)} ${text}`);
  }

  caption(element: Element, depth: number): void {
    this.flush();
    const text = this.capture(element, depth);
    if (text) this.emit('paragraph', `Figure: ${text}`);
  }

  preformat(element: Element, depth: number): void {
    this.flush();
    this.preformatted = true;
    this.preText = '';
    this.walker.visitChildren(element, depth + 1);
    this.preformatted = false;
    const lines = sanitize(this.preText)
      .split('\n')
      .slice(0, MAX_PRE_LINES)
      .map((line) => line.trimEnd());
    this.preText = '';
    while (lines.length > 0 && lines[0] === '') lines.shift();
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    this.emit('paragraph', lines.join('\n'));
  }

  quote(element: Element, depth: number): void {
    this.flush();
    const sink: Sink = { kind: 'quote', blocks: [] };
    this.gather(sink, () => this.walker.visitChildren(element, depth + 1));
    const lines = sink.blocks.flatMap((block) => block.text.split('\n'));
    this.emit('quote', lines.map((line) => `> ${line}`).join('\n'));
  }

  // -- lists -------------------------------------------------------------------------------------

  list(element: Element, depth: number): void {
    this.flush();
    const outer = this.lists.length === 0;
    const state: ListState = outer
      ? { lines: [], cut: false }
      : (this.lists[this.lists.length - 1] as ListState);
    // What an item says before a list inside it comes first, so the lines keep the order of the page.
    const parent = this.items[this.items.length - 1];
    if (parent) {
      this.flush();
      this.line(parent);
    }
    this.lists.push(state);
    this.walker.visitChildren(element, depth + 1);
    this.lists.pop();
    this.flush();
    if (outer) {
      if (state.cut) state.lines.push('- (more items are not shown)');
      this.emit('list', state.lines.join('\n'));
    }
  }

  /** Whether an item is being read inside a list, and so is one of its lines. */
  get inList(): boolean {
    return this.lists.length > 0;
  }

  private line(item: Item): void {
    const text = item.sink.blocks.map(oneLine).join(' ').trim();
    item.sink.blocks = [];
    if (!text) return;
    if (item.list.lines.length >= MAX_LIST_LINES) item.list.cut = true;
    else item.list.lines.push(`${item.indent}- ${text}`);
  }

  /** An item of a list, whose words are kept together as one line. */
  item(element: Element, depth: number): void {
    const list = this.lists[this.lists.length - 1] as ListState;
    const indent = '  '.repeat(Math.min(this.lists.length - 1, 4));
    const item: Item = { sink: { kind: 'item', blocks: [] }, indent, list };
    this.items.push(item);
    this.sinks.push(item.sink);
    this.walker.visitChildren(element, depth + 1);
    this.flush();
    this.sinks.pop();
    this.items.pop();
    this.line(item);
  }

  definitions(element: Element, depth: number): void {
    this.flush();
    const lines: string[] = [];
    let term = '';
    const walk = (parent: Element, level: number): void => {
      for (const child of parent.childNodes) {
        if (!isElement(child) || this.full || level > this.walker.maxDepth) continue;
        if (hides(attributesOf(child))) continue;
        if (child.tagName === 'dt') term = this.capture(child, level);
        else if (child.tagName === 'dd') {
          const said = this.capture(child, level);
          if (said && lines.length < MAX_LIST_LINES)
            lines.push(term ? `- ${term}: ${said}` : `- ${said}`);
        } else if (child.tagName === 'div') walk(child, level + 1);
      }
    };
    walk(element, depth + 1);
    this.emit('list', lines.join('\n'));
  }

  // -- tables ------------------------------------------------------------------------------------

  table(element: Element, depth: number): void {
    this.flush();
    const state: TableState = { caption: null, rows: [], structural: false };
    this.parts(element, state, depth + 1);
    this.finish(state);
  }

  private parts(parent: Element, state: TableState, depth: number): void {
    for (const child of parent.childNodes) {
      if (!isElement(child) || this.full || depth > this.walker.maxDepth) continue;
      if (hides(attributesOf(child))) continue;
      if (child.tagName === 'caption') state.caption = this.capture(child, depth) || null;
      else if (['thead', 'tbody', 'tfoot'].includes(child.tagName))
        this.parts(child, state, depth + 1);
      else if (child.tagName === 'tr' && state.rows.length < MAX_ROWS) {
        this.row(child, state, depth + 1);
      }
    }
  }

  private row(element: Element, state: TableState, depth: number): void {
    const cells: Cell[] = [];
    for (const child of element.childNodes) {
      if (!isElement(child) || cells.length >= MAX_COLUMNS) continue;
      if (child.tagName !== 'td' && child.tagName !== 'th') continue;
      if (hides(attributesOf(child))) continue;
      const sink: Sink = { kind: 'cell', blocks: [] };
      this.gather(sink, () => this.walker.visitChildren(child, depth + 1));
      const text = sink.blocks.map(oneLine).join(' ').trim();
      const paragraphs = sink.blocks.filter((block) => block.kind === 'paragraph').length;
      if (
        text.length > CELL_CHARS ||
        paragraphs > 2 ||
        sink.blocks.some((block) => block.kind !== 'paragraph')
      ) {
        state.structural = true;
      }
      cells.push({ text, blocks: sink.blocks });
    }
    if (cells.some((cell) => cell.text)) state.rows.push(cells);
  }

  /** A table of data becomes a row to a line; a table that lays out a page gives its cells' text as it is. */
  private finish(state: TableState): void {
    const { rows } = state;
    if (rows.length === 0) return;
    const widest = rows.flat().reduce((most, cell) => Math.max(most, cell.text.length), 0);
    if (state.structural || (rows.length === 1 && widest > LAYOUT_CELL_CHARS)) {
      for (const cell of rows.flat())
        for (const block of cell.blocks) this.emit(block.kind, block.text);
      return;
    }
    const lines = rows.map((row) => `| ${row.map((cell) => cell.text).join(' | ')} |`);
    if (state.caption) lines.unshift(`Table: ${state.caption}`);
    this.emit('table', lines.join('\n'));
  }
}
