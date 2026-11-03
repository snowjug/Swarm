import { READING, SCRIPTED } from '../../ingest/url/extract.js';
import { inspectText } from '../../models/injection.js';
import { sha256 } from '../../ingest/url/provenance.js';
import { assemble, type Part } from './document.js';
import { parseDocument, parseFragment, DEFAULT_LIMITS } from './parse.js';
import { Reader, REGION_LIMIT, type RawBlock, type Reading, type Region } from './read.js';
import { readFacts } from './meta.js';
import type { RawLink } from './scan.js';
import { readStructured } from './structured.js';
import type {
  ExtractedDocument,
  ExtractedLink,
  Extraction,
  ExtractInput,
  ExtractionMethod,
  ExtractLimits,
  ExtractOptions,
} from './types.js';
const STRUCTURED_LABEL =
  'Structured data (facts the page publishes for machines, not text on the page):';
// The tree is not deeper than the limit of the parser, give or take what it moved: reading allows a little more.
const READ_DEPTH_ALLOWANCE = 100;

interface Body {
  blocks: RawBlock[];
  kept: number;
  scope: 'main' | 'page' | 'all';
  fellBack: boolean;
  chosen: Set<Region> | null;
}

const inside = (region: Region | null, chosen: ReadonlySet<Region>): boolean => {
  for (let at = region; at; at = at.parent) if (chosen.has(at)) return true;
  return false;
};

/**
 * The regions that hold the page's own text, when the page has them: its main region, or else its
 * articles. One is chosen only when it holds a substantial part of what the page has outside its
 * furniture; a page whose `main` is a few words (a banner, a heading) is read as a whole instead.
 */
function chooseRegions(reading: Reading): Set<Region> | null {
  if (reading.regions.length >= REGION_LIMIT) return null;
  const chars = new Map<Region, number>();
  for (const block of reading.blocks) {
    for (let at = block.region; at; at = at.parent) {
      chars.set(at, (chars.get(at) ?? 0) + block.text.length);
    }
  }
  const size = (region: Region): number => chars.get(region) ?? 0;
  const total = reading.kept;
  const enough = (count: number): boolean =>
    (count >= READING.mainChars && count >= total * READING.mainShare) ||
    (count >= READING.dominantChars && count >= total * READING.dominantShare);
  let main: Region | null = null;
  for (const region of reading.regions) {
    if (region.kind === 'main' && (main === null || size(region) > size(main))) main = region;
  }
  if (main && enough(size(main))) return new Set([main]);
  // Articles inside another article or main region are part of it. Several that stand side by side
  // are all kept, unless some are much smaller than the largest: a story with teasers around it.
  const articles = reading.regions.filter((r) => r.kind === 'article' && r.parent === null);
  const largest = articles.reduce((most, region) => Math.max(most, size(region)), 0);
  const group = articles.filter(
    (region) => size(region) > 0 && size(region) >= largest * READING.articleShare,
  );
  const sum = group.reduce((all, region) => all + size(region), 0);
  return group.length > 0 && enough(sum) ? new Set(group) : null;
}

const charsOf = (blocks: readonly RawBlock[]): number =>
  blocks.reduce((sum, block) => sum + block.text.length + 2, 0);

/**
 * The text of one reading: the page's main region or its articles when it has them, else the page
 * without its furniture, else, when that leaves almost nothing of a page that shows much more, the page whole.
 */
function bodyOf(reading: Reading, whole: () => Reading): Body {
  const chosen = chooseRegions(reading);
  let blocks = chosen
    ? reading.blocks.filter((block) => inside(block.region, chosen))
    : reading.blocks;
  let kept = chosen ? charsOf(blocks) : reading.kept;
  const leftOut = reading.leftOut || kept < reading.kept;
  let scope: Body['scope'] = !leftOut ? 'all' : chosen ? 'main' : 'page';
  let fellBack = false;
  if (leftOut && kept < READING.floorChars) {
    const everything = whole();
    if (
      everything.kept >= READING.floorRatio * kept &&
      everything.kept - kept >= READING.gainChars
    ) {
      blocks = everything.blocks;
      kept = everything.kept;
      scope = 'all';
      fellBack = true;
    }
  }
  return { blocks, kept, scope, fellBack, chosen: fellBack ? null : chosen };
}

/**
 * A heading with nothing under it, as when what was under it was left out as furniture (a list of
 * references, a panel of related links), says nothing and is not kept.
 */
function withoutEmptyHeadings(blocks: readonly RawBlock[]): RawBlock[] {
  const level = (block: RawBlock): number => block.text.indexOf(' ');
  const open: { index: number; level: number; filled: boolean }[] = [];
  const empty = new Set<number>();
  const close = (above: number): void => {
    while (open.length > 0 && (open[open.length - 1] as { level: number }).level >= above) {
      const heading = open.pop() as { index: number; filled: boolean };
      if (!heading.filled) empty.add(heading.index);
    }
  };
  blocks.forEach((block, index) => {
    if (block.kind === 'heading') {
      close(level(block));
      open.push({ index, level: level(block), filled: false });
    } else {
      for (const heading of open) heading.filled = true;
    }
  });
  close(0);
  return blocks.filter((_, index) => !empty.has(index));
}

function partsOf(blocks: readonly RawBlock[]): Part[] {
  return withoutEmptyHeadings(blocks).map((block): Part =>
    block.kind === 'heading'
      ? { kind: 'heading', level: block.text.indexOf(' '), line: block.text }
      : { kind: block.kind, lines: block.text.split('\n') },
  );
}

function finishLinks(
  raw: readonly RawLink[],
  base: string,
  chosen: ReadonlySet<Region> | null,
  maxLinks: number,
): ExtractedLink[] {
  const seen = new Set<string>();
  const links: ExtractedLink[] = [];
  for (const link of raw) {
    if (links.length >= maxLinks) break;
    let target: URL;
    try {
      target = new URL(link.href, base);
    } catch {
      continue;
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') continue;
    if (target.username || target.password) continue;
    target.hash = '';
    const url = target.href;
    if (url.length > 2_048 || seen.has(url)) continue;
    seen.add(url);
    // What a link says is shown to nobody and given to no model as it is; a line that reads like an instruction is dropped.
    const text =
      link.text.split(' ').length >= 3 && inspectText(link.text).suspicious ? '' : link.text;
    links.push({
      url,
      text,
      rel: link.rel,
      inMain: link.inMain && (chosen === null || inside(link.region, chosen)),
    });
  }
  return links;
}

const sameHost = (a: string, b: string): boolean => {
  try {
    return new URL(a).hostname === new URL(b).hostname;
  } catch {
    return false;
  }
};

/**
 * Reads a web page. It is parsed by a standards-compliant parser that runs nothing, with its depth,
 * size and time watched. What a browser would hide, or would not show, is left out; of what the page
 * shows, its own text is kept and its furniture is not. That is a guess from how the page is built,
 * and the document says so when it matters.
 */
export async function extractHtml(
  input: ExtractInput,
  options: ExtractOptions = {},
): Promise<Extraction> {
  const limits: ExtractLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const maxDepth = limits.maxDepth + READ_DEPTH_ALLOWANCE;
  const parsed = await parseDocument(input.text, limits, options.signal);
  const reader = (trim: boolean, collect: boolean): Reader =>
    new Reader({ trim, collect, maxDepth, maxLinks: limits.maxLinks });
  const first = reader(true, true).read(parsed.root);
  let cutShort = parsed.cutShort || first.cutShort;
  options.signal?.throwIfAborted();
  let body = bodyOf(first, () => reader(false, false).read(parsed.root));

  let noscript = false;
  if (body.kept < READING.floorChars && first.noscript.length > 0) {
    const fragment = await parseFragment(first.noscript.join('\n'), limits, options.signal);
    const inner = reader(true, false).read(fragment.root);
    const fallback = bodyOf(inner, () => reader(false, false).read(fragment.root));
    if (
      fallback.kept >= READING.floorChars &&
      fallback.kept >= READING.floorRatio * body.kept &&
      fallback.kept - body.kept >= READING.gainChars
    ) {
      body = fallback;
      cutShort ||= fragment.cutShort || inner.cutShort;
      noscript = true;
    }
  }
  const scripted =
    first.embeds ||
    (first.scriptChars > 0 &&
      first.scriptChars >= SCRIPTED.scriptShare * input.text.length &&
      body.kept <= SCRIPTED.textShare * input.text.length);

  const structured = readStructured(first.head.jsonLd);
  const baseHref = first.head.base ? safeResolve(first.head.base, input.url) : null;
  const base =
    baseHref && (options.sameSite ? options.sameSite(baseHref) : sameHost(baseHref, input.url))
      ? baseHref
      : input.url;
  const facts = readFacts({
    head: first.head,
    structured,
    headline: first.headline,
    headers: input.headers ?? {},
    url: base,
    fetchedAt: input.fetchedAt,
    sameSite: options.sameSite,
  });

  const head = [
    facts.title ? `Title: ${facts.title}` : '',
    facts.description ? `Description: ${facts.description}` : '',
    facts.publishedAt ? `Published: ${facts.publishedAt}` : '',
    facts.updatedAt ? `Updated: ${facts.updatedAt}` : '',
    facts.author ? `Author: ${facts.author}` : '',
  ].filter(Boolean);
  const tail = structured.lines.length > 0 ? [STRUCTURED_LABEL, ...structured.lines] : [];
  const assembled = assemble(head, partsOf(body.blocks), tail, limits.maxChars);

  const warnings: string[] = [];
  if (body.fellBack) {
    warnings.push(
      'Swarm could not tell the page\u2019s own text from its menus and side panels, so it kept everything the page shows. Some of it may not be about the page.',
    );
  }
  if (noscript) {
    warnings.push(
      'This page shows almost no text without scripts, so Swarm kept the text it holds for readers without scripts.',
    );
  }
  if (scripted) {
    warnings.push(
      'Parts of this page are built by scripts or shown from other pages, and Swarm reads neither, so something a browser shows may be missing.',
    );
  }
  if (cutShort) {
    warnings.push(
      'The page is larger or more deeply built than Swarm reads, so only the beginning was kept.',
    );
  }
  if (assembled.truncated) {
    warnings.push('The page is longer than one document can be, so only the beginning was kept.');
  }
  if (first.hiddenText) {
    warnings.push('The page hides some of its text from readers; Swarm left the hidden text out.');
  }
  if (assembled.injection.flaggedBlocks > 0) {
    warnings.push(
      'Some lines read like instructions to an AI. They are labelled in the text and were not followed.',
    );
  }
  warnings.push(...facts.warnings);

  const method: ExtractionMethod =
    body.scope === 'main' ? 'html-main' : body.scope === 'page' ? 'html-page' : 'html-all';
  const document: ExtractedDocument = {
    title: facts.title,
    description: facts.description,
    canonicalUrl: facts.canonicalUrl,
    language: facts.language,
    publishedAt: facts.publishedAt,
    updatedAt: facts.updatedAt,
    author: facts.author,
    openGraph: facts.openGraph,
    structured: structured.lines,
    robotsMeta: facts.robotsMeta,
    text: assembled.text,
    passages: assembled.passages,
    contentHash: sha256(assembled.text),
    method,
    warnings: warnings.slice(0, 8),
    links: finishLinks(first.links, base, body.chosen, limits.maxLinks),
    injection: assembled.injection,
  };
  return {
    document,
    signals: {
      headline: first.headline,
      passwordField: first.passwordField,
      leftOutSample: first.leftOutSample,
      hiddenText: first.hiddenText,
      paywallMarked: structured.paywalled,
      schemaTypes: structured.types,
      citationMeta: facts.citationMeta,
      proseChars: assembled.proseChars,
      scripted,
      noscript,
      cutShort,
      problem: null,
    },
  };
}

function safeResolve(address: string, base: string): string | null {
  try {
    const target = new URL(address, base);
    return target.protocol === 'http:' || target.protocol === 'https:' ? target.href : null;
  } catch {
    return null;
  }
}
