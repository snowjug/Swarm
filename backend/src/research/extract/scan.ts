import type { DefaultTreeAdapterTypes } from 'parse5';
import { inline } from '../../ingest/url/text.js';
import type { Region } from './read.js';
import { attributesOf, DROPPED, hides } from './tags.js';

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
type TextNode = DefaultTreeAdapterTypes.TextNode;

export interface RawLink {
  /** As written in the page. */
  href: string;
  text: string;
  rel: string[];
  /** In the page's kept text, and not in a part that was left out as furniture. */
  inMain: boolean;
  /** The main region or article the link sits in, if it sits in one. */
  region: Region | null;
}

const MAX_NODES_SAMPLED = 5_000;
const MAX_LINK_TEXT = 160;

const isElement = (node: Node): node is Element => 'tagName' in node;
const isText = (node: Node): node is TextNode => node.nodeName === '#text';
const childrenOf = (node: Node): readonly Node[] =>
  'childNodes' in node ? (node.childNodes as readonly Node[]) : [];

/**
 * The words inside a part of a page, as one line, up to `cap` characters. Scripts, styles and
 * everything else that is not text on the page, and what is hidden, are not read. It looks at no
 * more than a few thousand nodes, however the part is built.
 */
export function plainText(root: Node, cap: number): string {
  let out = '';
  let seen = 0;
  // The stack holds nodes still to be read, last in first out: children are pushed in reverse.
  const stack: Node[] = [...childrenOf(root)].reverse();
  while (stack.length > 0 && out.length < cap && seen < MAX_NODES_SAMPLED) {
    const node = stack.pop() as Node;
    seen += 1;
    if (isText(node)) {
      out += ` ${node.value}`;
      continue;
    }
    if (!isElement(node)) continue;
    if (DROPPED.has(node.tagName) || hides(attributesOf(node))) continue;
    const children = childrenOf(node);
    for (let index = children.length - 1; index >= 0; index -= 1)
      stack.push(children[index] as Node);
  }
  return inline(out).slice(0, cap);
}

export function relOf(attributes: ReadonlyMap<string, string>): string[] {
  return (attributes.get('rel') ?? '').toLowerCase().split(/\s+/u).filter(Boolean).slice(0, 8);
}

/** The link an `a` element makes, if it makes one. */
export function linkOf(element: Element, inMain: boolean, region: Region | null): RawLink | null {
  const attributes = attributesOf(element);
  const href = attributes.get('href')?.trim();
  if (!href || href.length > 2_048 || href.startsWith('#')) return null;
  return {
    href,
    text: plainText(element, MAX_LINK_TEXT),
    rel: relOf(attributes),
    inMain,
    region,
  };
}

export interface Sample {
  /** The start of the text inside, and whether there was any. */
  text: string;
  links: RawLink[];
}

/**
 * What is inside a part of the page that is left out of its text: how it begins, to judge what kind
 * of part it was, and the links it holds, which are still places the page leads to. It does not
 * descend into what a reader cannot see.
 */
export function sampleOf(root: Element, textCap: number, linkRoom: number): Sample {
  const links: RawLink[] = [];
  let text = '';
  let seen = 0;
  const stack: Node[] = [...childrenOf(root)].reverse();
  while (stack.length > 0 && seen < MAX_NODES_SAMPLED) {
    const node = stack.pop() as Node;
    seen += 1;
    if (isText(node)) {
      if (text.length < textCap) text += ` ${node.value}`;
      continue;
    }
    if (!isElement(node)) continue;
    if (DROPPED.has(node.tagName) || hides(attributesOf(node))) continue;
    if (node.tagName === 'a' && links.length < linkRoom) {
      const link = linkOf(node, false, null);
      if (link) links.push(link);
    }
    const children = childrenOf(node);
    for (let index = children.length - 1; index >= 0; index -= 1)
      stack.push(children[index] as Node);
  }
  return { text: inline(text).slice(0, textCap), links };
}
