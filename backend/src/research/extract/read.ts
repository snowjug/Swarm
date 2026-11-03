import type { DefaultTreeAdapterTypes } from 'parse5';
import { isBoilerplate, landmarkOf } from '../../ingest/url/boilerplate.js';
import { BlockBuilder, type RawBlock, type Region, type Walker } from './blocks.js';
import { linkOf, plainText, relOf, sampleOf, type RawLink } from './scan.js';
import {
  attributesOf,
  BLOCK,
  DATA_SCRIPT,
  DROPPED,
  embedsDocument,
  extraFurniture,
  hides,
} from './tags.js';

export type { RawBlock, Region } from './blocks.js';

type Node = DefaultTreeAdapterTypes.Node;
type ChildNode = DefaultTreeAdapterTypes.ChildNode;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;
type Element = DefaultTreeAdapterTypes.Element;
type TextNode = DefaultTreeAdapterTypes.TextNode;
type Attributes = ReadonlyMap<string, string>;

export interface HeadFacts {
  title: string | null;
  lang: string | null;
  /** `name`, `property`, `itemprop` or `http-equiv` (lower case), and the content, of every meta tag. */
  metas: { key: string; content: string; head: boolean }[];
  canonical: string | null;
  base: string | null;
  jsonLd: string[];
  /** The words of each `rel=author` link in the page's text. */
  authorLinks: string[];
  times: { datetime: string; itemprop: string; classes: string[] }[];
}

export interface Reading {
  blocks: RawBlock[];
  /** The characters of text in `blocks`. */
  kept: number;
  regions: Region[];
  /** Whether text was left out as furniture. */
  leftOut: boolean;
  hiddenText: boolean;
  leftOutSample: string;
  cutShort: boolean;
  /** The work that reading took, in the units of `BlockBuilder.spend`. */
  work: number;
  scriptChars: number;
  embeds: boolean;
  passwordField: boolean;
  headline: string | null;
  /** The inside of each `noscript` that is not hidden or left out: markup for a reader without scripts. */
  noscript: string[];
  head: HeadFacts;
  links: RawLink[];
}

export interface ReaderOptions {
  /** Leave out furniture: menus, side panels, footers and the like. */
  trim: boolean;
  /** Gather the head's facts and the page's links; once is enough. */
  collect: boolean;
  maxDepth: number;
  maxLinks: number;
  /** The most work reading may do (see `BlockBuilder.spend`); the rest of the page is not read. */
  maxWork: number;
}

const HTML = 'http://www.w3.org/1999/xhtml';
const MATHML = 'http://www.w3.org/1998/Math/MathML';
const NOTED: ReadonlySet<string> = new Set(['html', 'title', 'meta', 'link', 'base', 'script']);
const MAX_REGIONS = 2_000;
const MAX_NOSCRIPT_CHARS = 100_000;
const MAX_JSON_LD_BLOCKS = 20;
const MAX_JSON_LD_CHARS = 300_000;
const MAX_METAS = 120;
const LEFT_OUT_SAMPLE_CHARS = 3_000;

export const REGION_LIMIT = MAX_REGIONS;

const isElement = (node: Node): node is Element => 'tagName' in node;
const isText = (node: Node): node is TextNode => node.nodeName === '#text';
const textInside = (element: Element): string =>
  element.childNodes.map((node) => (isText(node) ? node.value : '')).join('');

/**
 * Reads a parsed page into blocks of its own text. Nothing is run: the tree is data. The reading is
 * a guess from how the page is built (`boilerplate.ts`), and says what it left out. It is recursive,
 * and the depth of the page is capped, so a page cannot make it deeper than its limit.
 */
export class Reader implements Walker {
  private readonly builder: BlockBuilder;
  private readonly regions: Region[] = [];
  private sections = 0;
  private quoting = 0;
  private leftOut = false;
  private hiddenText = false;
  private leftOutSample = '';
  private cutShort = false;
  private scriptChars = 0;
  private embeds = false;
  private passwordField = false;
  private readonly noscript: string[] = [];
  private noscriptChars = 0;
  private readonly links: RawLink[] = [];
  private readonly head: HeadFacts = {
    title: null,
    lang: null,
    metas: [],
    canonical: null,
    base: null,
    jsonLd: [],
    authorLinks: [],
    times: [],
  };

  constructor(private readonly options: ReaderOptions) {
    this.builder = new BlockBuilder(this, options.maxWork);
  }

  get maxDepth(): number {
    return this.options.maxDepth;
  }

  read(root: ParentNode): Reading {
    this.visitChildren(root, 0);
    this.builder.flush();
    return {
      blocks: this.builder.blocks,
      kept: this.builder.kept,
      regions: this.regions,
      leftOut: this.leftOut,
      hiddenText: this.hiddenText,
      leftOutSample: this.leftOutSample,
      // A page that asked for more work than is done for one was read as far as that went.
      cutShort: this.cutShort || this.builder.exhausted,
      work: this.builder.work,
      scriptChars: this.scriptChars,
      embeds: this.embeds,
      passwordField: this.passwordField,
      headline: this.builder.headline,
      noscript: this.noscript,
      head: this.head,
      links: this.links,
    };
  }

  // -- walking ----------------------------------------------------------------------------------

  visitChildren(parent: ParentNode, depth: number): void {
    for (const node of parent.childNodes) {
      if (this.builder.full) return;
      this.visit(node, depth);
    }
  }

  private visit(node: ChildNode, depth: number): void {
    if (node.nodeName === '#text') {
      const value = (node as TextNode).value;
      this.builder.spend(1 + (value.length >> 8));
      this.builder.text(value);
      return;
    }
    if (!isElement(node)) return;
    this.builder.spend(3 + (node.attrs.length >> 2));
    if (depth > this.options.maxDepth) {
      this.cutShort = true;
      return;
    }
    this.element(node, depth);
  }

  private element(element: Element, depth: number): void {
    const name = element.tagName;
    if (element.namespaceURI !== HTML) {
      // Drawings are not text; the words in a formula are.
      if (element.namespaceURI === MATHML) this.visitChildren(element, depth + 1);
      return;
    }
    if (name === 'head') {
      for (const child of element.childNodes) if (isElement(child)) this.note(child, true);
      return;
    }
    const attributes = attributesOf(element);
    this.note(element, false);
    if (DROPPED.has(name)) {
      this.dropped(element, name, attributes);
      return;
    }
    if (hides(attributes)) {
      this.leaveOut(element, true);
      return;
    }
    if (
      this.options.trim &&
      // The footer of a quotation says who said it.
      ((!(name === 'footer' && this.quoting > 0) &&
        isBoilerplate(name, attributes, this.sections > 0)) ||
        extraFurniture(name, attributes))
    ) {
      this.leaveOut(element, false);
      return;
    }
    this.part(element, name, attributes, depth);
  }

  /** Facts a page gives in its head: its title, language, meta tags, canonical address and structured data. */
  private note(element: Element, inHead: boolean): void {
    const name = element.tagName;
    if (!this.options.collect || !NOTED.has(name) || element.namespaceURI !== HTML) return;
    const attributes = attributesOf(element);
    if (name === 'script') this.script(element, attributes);
    else if (name === 'html') this.head.lang ??= attributes.get('lang') ?? null;
    else if (name === 'title') this.head.title ??= plainText(element, 600);
    else if (name === 'meta') this.meta(attributes, inHead);
    else if (name === 'link') {
      if (relOf(attributes).includes('canonical')) {
        this.head.canonical ??= attributes.get('href') ?? null;
      }
    } else if (name === 'base') this.head.base ??= attributes.get('href') ?? null;
  }

  private meta(attributes: Attributes, inHead: boolean): void {
    const key = (
      attributes.get('name') ??
      attributes.get('property') ??
      attributes.get('itemprop') ??
      attributes.get('http-equiv') ??
      ''
    )
      .trim()
      .toLowerCase();
    const content = attributes.get('content');
    if (key && content !== undefined && this.head.metas.length < MAX_METAS) {
      this.head.metas.push({ key, content: content.slice(0, 1_000), head: inHead });
    }
  }

  private script(element: Element, attributes: Attributes): void {
    const type = attributes.get('type') ?? '';
    const content = textInside(element);
    if (!DATA_SCRIPT.test(type)) this.scriptChars += content.length;
    if (
      /application\/ld\+json/iu.test(type) &&
      this.head.jsonLd.length < MAX_JSON_LD_BLOCKS &&
      content.length <= MAX_JSON_LD_CHARS
    ) {
      this.head.jsonLd.push(content);
    }
  }

  private dropped(element: Element, name: string, attributes: Attributes): void {
    if (name === 'noscript') {
      const inside = textInside(element);
      if (inside.trim() && this.noscriptChars < MAX_NOSCRIPT_CHARS) {
        const part = inside.slice(0, MAX_NOSCRIPT_CHARS - this.noscriptChars);
        this.noscript.push(part);
        this.noscriptChars += part.length;
      }
    } else if (name === 'iframe' || name === 'object' || name === 'embed') {
      if (embedsDocument(attributes)) this.embeds = true;
    } else if (name === 'input' && attributes.get('type')?.trim().toLowerCase() === 'password') {
      this.passwordField = true;
    }
  }

  /** Leaves a part of the page out of its text, noting what kind of text it held and where it led. */
  private leaveOut(element: Element, hidden: boolean): void {
    this.builder.spend(20);
    const room = Math.max(0, this.options.maxLinks - this.links.length);
    const sample = sampleOf(element, 400, hidden || !this.options.collect ? 0 : room);
    if (sample.text) {
      if (hidden) this.hiddenText = true;
      else this.leftOut = true;
      if (this.leftOutSample.length < LEFT_OUT_SAMPLE_CHARS)
        this.leftOutSample += `${sample.text}\n`;
    }
    this.links.push(...sample.links);
  }

  // -- a part of the page ------------------------------------------------------------------------

  private part(element: Element, name: string, attributes: Attributes, depth: number): void {
    const landmark = landmarkOf(name, attributes);
    if (landmark) this.sections += 1;
    const saved = this.builder.region;
    if (
      (landmark === 'main' || landmark === 'article') &&
      BLOCK.has(name) &&
      this.regions.length < MAX_REGIONS
    ) {
      this.builder.flush();
      this.builder.region = { kind: landmark, parent: saved };
      this.regions.push(this.builder.region);
    }
    this.content(element, name, attributes, depth);
    if (this.builder.region !== saved) {
      this.builder.flush();
      this.builder.region = saved;
    }
    if (landmark) this.sections -= 1;
  }

  private content(element: Element, name: string, attributes: Attributes, depth: number): void {
    const builder = this.builder;
    if (/^h[1-6]$/u.test(name)) return builder.heading(element, Number(name[1]), depth);
    switch (name) {
      case 'ul':
      case 'ol':
      case 'menu':
      case 'dir':
        return builder.list(element, depth);
      case 'li':
        if (builder.inList) return builder.item(element, depth);
        break;
      case 'dl':
        return builder.definitions(element, depth);
      case 'table':
        return builder.table(element, depth);
      case 'blockquote':
        this.quoting += 1;
        builder.quote(element, depth);
        this.quoting -= 1;
        return;
      case 'pre':
        return builder.preformat(element, depth);
      case 'figcaption':
        return builder.caption(element, depth);
      case 'br':
        return builder.lineBreak();
      case 'hr':
        return builder.flush();
      case 'q':
        builder.text('\u201c');
        this.visitChildren(element, depth + 1);
        builder.text('\u201d');
        return;
      case 'a':
        this.anchor(element, attributes);
        break;
      case 'time':
        this.time(attributes);
        break;
    }
    const block = BLOCK.has(name);
    if (block) builder.flush();
    this.visitChildren(element, depth + 1);
    if (block) builder.flush();
  }

  private anchor(element: Element, attributes: Attributes): void {
    if (!this.options.collect) return;
    if (this.links.length < this.options.maxLinks) {
      this.builder.spend(10);
      const link = linkOf(element, true, this.builder.region);
      if (link) this.links.push(link);
    }
    if (relOf(attributes).includes('author') && this.head.authorLinks.length < 4) {
      this.head.authorLinks.push(plainText(element, 160));
    }
  }

  private time(attributes: Attributes): void {
    const datetime = attributes.get('datetime')?.trim();
    if (this.options.collect && datetime && this.head.times.length < 20) {
      this.head.times.push({
        datetime: datetime.slice(0, 40),
        itemprop: (attributes.get('itemprop') ?? '').toLowerCase(),
        classes: (attributes.get('class') ?? '').toLowerCase().split(/\s+/u).filter(Boolean),
      });
    }
  }
}
