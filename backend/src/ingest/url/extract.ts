import { MAX_DOCUMENT_CHARS } from '../../../../shared/types.js';
import { isBoilerplate, landmarkOf, type Landmark } from './boilerplate.js';
import { flattenJson } from './normalize.js';
import { fit, inline, sanitize, tidy } from './text.js';

/**
 * What part of the page the text was taken from. `main`: the page's main region, without the
 * menus and panels in it. `page`: the whole page without its menus, side panels, footers and the
 * like. `all`: everything the page shows, either because there was nothing to leave out or, when
 * `fellBack` is set, because leaving it out would have left almost nothing.
 */
export interface PageReading {
  scope: 'main' | 'page' | 'all';
  fellBack: boolean;
}

export interface ExtractedPage {
  title: string | null;
  description: string | null;
  /** Headings, paragraphs, list items and table rows, one to a line. */
  body: string;
  /** Facts from the page's JSON-LD, as `path: value` lines. They are data about the page, not text on it. */
  structured: string[];
  /** How the body was chosen from what the page shows. */
  reading: PageReading;
}

/**
 * When the main region of a page is the page's text, and when leaving out boilerplate leaves too little.
 * Characters are those of the text that is kept (see `docs/security/url-ingestion.md`).
 */
export const READING = {
  /** A main region has at least this much text and at least `mainShare` of the page's text outside its boilerplate... */
  mainChars: 400,
  mainShare: 0.25,
  /** ...or at least this much, and at least `dominantShare` of it. */
  dominantChars: 200,
  dominantShare: 0.5,
  /** Several articles are all kept when each is at least this share of the largest. */
  articleShare: 0.25,
  /**
   * Leaving out boilerplate may not leave less than `floorChars` characters while the page shows at
   * least `floorRatio` times as much, and at least `gainChars` more.
   */
  floorChars: 200,
  floorRatio: 2,
  gainChars: 80,
} as const;

const LATIN1 =
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'.split(
    ' ',
  );

const NAMED = new Map<string, string>([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['OElig', '\u0152'],
  ['oelig', '\u0153'],
  ['Scaron', '\u0160'],
  ['scaron', '\u0161'],
  ['Yuml', '\u0178'],
  ['fnof', '\u0192'],
  ['circ', '\u02c6'],
  ['tilde', '\u02dc'],
  ['ensp', '\u2002'],
  ['emsp', '\u2003'],
  ['thinsp', '\u2009'],
  ['zwnj', '\u200c'],
  ['zwj', '\u200d'],
  ['lrm', '\u200e'],
  ['rlm', '\u200f'],
  ['ndash', '\u2013'],
  ['mdash', '\u2014'],
  ['lsquo', '\u2018'],
  ['rsquo', '\u2019'],
  ['sbquo', '\u201a'],
  ['ldquo', '\u201c'],
  ['rdquo', '\u201d'],
  ['bdquo', '\u201e'],
  ['dagger', '\u2020'],
  ['Dagger', '\u2021'],
  ['bull', '\u2022'],
  ['hellip', '\u2026'],
  ['permil', '\u2030'],
  ['prime', '\u2032'],
  ['Prime', '\u2033'],
  ['lsaquo', '\u2039'],
  ['rsaquo', '\u203a'],
  ['oline', '\u203e'],
  ['euro', '\u20ac'],
  ['trade', '\u2122'],
  ['larr', '\u2190'],
  ['uarr', '\u2191'],
  ['rarr', '\u2192'],
  ['darr', '\u2193'],
  ['harr', '\u2194'],
  ['rArr', '\u21d2'],
  ['hArr', '\u21d4'],
  ['minus', '\u2212'],
  ['lowast', '\u2217'],
  ['infin', '\u221e'],
  ['asymp', '\u2248'],
  ['ne', '\u2260'],
  ['equiv', '\u2261'],
  ['le', '\u2264'],
  ['ge', '\u2265'],
  ['hearts', '\u2665'],
]);
LATIN1.forEach((name, index) => NAMED.set(name, String.fromCharCode(160 + index)));

// What a numeric reference to 0x80-0x9f means in a web page: the Windows-1252 character, as browsers read it.
const WINDOWS_1252 = [
  0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
  0x0152, 0x8d, 0x017d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc,
  0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178,
];

function fromCode(code: number): string {
  if (code >= 0x80 && code <= 0x9f)
    return String.fromCodePoint(WINDOWS_1252[code - 0x80] ?? 0xfffd);
  if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '\ufffd';
  return String.fromCodePoint(code);
}

const ENTITY = /&(?:#(\d{1,7});?|#[xX]([0-9a-fA-F]{1,6});?|([A-Za-z][A-Za-z0-9]{1,31});)/gu;

function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(ENTITY, (match, decimal?: string, hex?: string, name?: string) => {
    if (name !== undefined) return NAMED.get(name) ?? match;
    return fromCode(decimal !== undefined ? Number(decimal) : Number.parseInt(hex ?? '', 16));
  });
}

const VOID = new Set([
  'area',
  'base',
  'basefont',
  'bgsound',
  'br',
  'col',
  'embed',
  'frame',
  'hr',
  'img',
  'input',
  'keygen',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

// Nothing inside these is text on the page: code, styling, content for a browser without scripts,
// inert templates, embedded documents and drawings, and the controls of a form.
const DROPPED = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'iframe',
  'object',
  'embed',
  'svg',
  'canvas',
  'applet',
  'input',
  'button',
  'select',
  'textarea',
  'option',
  'optgroup',
  'datalist',
]);

// Elements whose content a browser does not parse as markup: it runs to the matching end tag.
const RAW_TEXT = new Set([
  'script',
  'style',
  'noscript',
  'iframe',
  'noembed',
  'noframes',
  'xmp',
  'textarea',
  'title',
  'plaintext',
]);

const BLOCK = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'body',
  'caption',
  'center',
  'dd',
  'details',
  'dialog',
  'dir',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hgroup',
  'hr',
  'html',
  'legend',
  'li',
  'main',
  'menu',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'tbody',
  'tfoot',
  'thead',
  'tr',
  'ul',
]);

// A start tag of one of these ends an open paragraph, as a browser does when it reads them.
const ENDS_PARAGRAPH = new Set([...BLOCK, 'listing']);

const MAX_TAGS = 150_000;
const MAX_DEPTH = 400;
const MAX_ATTRIBUTES = 40;
const MAX_ATTRIBUTE_CHARS = 2_000;
const MAX_JSON_LD_BLOCKS = 20;
const MAX_JSON_LD_CHARS = 300_000;
const MAX_STRUCTURED_CHARS = 6_000;
// Once this much text has been kept the rest of the page cannot be part of the document.
const MAX_BODY_CHARS = 200_000;
// The most main regions and articles that are followed; any more cannot be chosen as the page's text.
const MAX_REGIONS = 2_000;
const SKIPPED_FACTS = new Set([
  'url',
  'image',
  'logo',
  'sameAs',
  'potentialAction',
  'thumbnailUrl',
  'contentUrl',
  'mainEntityOfPage',
]);

const isSpace = (code: number): boolean =>
  code === 32 || code === 9 || code === 10 || code === 12 || code === 13;
const isLetter = (code: number): boolean =>
  (code >= 65 && code <= 90) || (code >= 97 && code <= 122);

const HIDDEN_STYLE =
  /(?:^|;)(?:display:none|visibility:(?:hidden|collapse)|opacity:0(?:\.0*)?|font-size:0(?:px|pt|em|rem|%)?)(?:;|$)/u;

/** Hidden from a reader: so what it says is not something the page shows to a person. */
function hidden(attributes: Map<string, string>): boolean {
  if (attributes.has('hidden')) return true;
  if (attributes.get('aria-hidden')?.trim().toLowerCase() === 'true') return true;
  const style = attributes.get('style');
  if (style === undefined) return false;
  return HIDDEN_STYLE.test(
    style
      .toLowerCase()
      .replace(/\s+/gu, '')
      .replace(/!important/gu, ''),
  );
}

const rawTextEnds = new Map<string, RegExp>();
function endOfRawText(html: string, name: string, from: number): { content: string; next: number } {
  if (name === 'plaintext') return { content: html.slice(from), next: html.length };
  let pattern = rawTextEnds.get(name);
  if (!pattern) {
    pattern = new RegExp(`</${name}(?=[\\s/>])`, 'giu');
    rawTextEnds.set(name, pattern);
  }
  pattern.lastIndex = from;
  const found = pattern.exec(html);
  if (!found) return { content: html.slice(from), next: html.length };
  const close = html.indexOf('>', found.index);
  return { content: html.slice(from, found.index), next: close < 0 ? html.length : close + 1 };
}

interface Open {
  name: string;
  dropped: boolean;
  /** Menus, side panels, footers and the like: the text inside is not read (see `boilerplate.ts`). */
  boilerplate: boolean;
  /** An article, a main region or a section, which is where a `header` stays. */
  section: boolean;
  region: Region | null;
}

/** A main region or an article: which lines of the page are in it, and how much text they hold. */
interface Region {
  kind: 'main' | 'article';
  /** The region this one is inside, if any. */
  parent: Region | null;
  /** The lines are `lines[start]` up to, not including, `lines[end]`. */
  start: number;
  end: number;
  /** The text kept before the region, and after it. */
  from: number;
  to: number;
}

interface Scan {
  title: string | null;
  description: string | null;
  jsonLd: string[];
  lines: string[];
  /** The characters of text in `lines`. */
  kept: number;
  regions: Region[];
  /** Whether any text was left out as boilerplate. */
  leftOut: boolean;
}

/**
 * One pass over the page. With `trim` the text of boilerplate elements is left out and the main
 * regions and articles are noted; without it every word the page shows is kept, which is how pages
 * were read before boilerplate was told apart.
 */
function scan(html: string, trim: boolean): Scan {
  const stack: Open[] = [];
  // Where each open element is on the stack, by name. An end tag, or a start tag that implies one,
  // finds what it closes from this and not by looking down the stack: on a page nested as deep as is
  // allowed, that look would be most of the work for every tag.
  const places = new Map<string, number[]>();
  const nearest = (name: string): number => places.get(name)?.at(-1) ?? -1;
  const lines: string[] = [];
  const jsonLd: string[] = [];
  const regions: Region[] = [];
  let current: Region | null = null;
  let title: string | null = null;
  let description: string | null = null;
  let ogDescription: string | null = null;
  let line = '';
  let prefix = '';
  let dropped = 0;
  let skipped = 0;
  let sections = 0;
  let leftOut = false;
  let cells = 0;
  let rowCells = 0;
  let pre = 0;
  let kept = 0;

  const flush = (): void => {
    const text = inline(line);
    const lead = prefix;
    line = '';
    prefix = '';
    if (!text || kept > MAX_BODY_CHARS) return;
    if (lead.startsWith('#') && lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
    lines.push(`${lead}${text}`);
    kept += text.length + lead.length + 1;
  };
  // A block ends the line, except inside a table cell, where it only separates words.
  const boundary = (): void => {
    if (cells > 0) line += ' ';
    else flush();
  };
  const text = (raw: string): void => {
    if (dropped > 0 || kept > MAX_BODY_CHARS) return;
    const decoded = decodeEntities(raw);
    if (skipped > 0) {
      leftOut ||= inline(decoded) !== '';
      return;
    }
    if (pre === 0) {
      line += decoded;
      return;
    }
    decoded.split(/\r\n|\r|\n/u).forEach((part, index) => {
      if (index > 0) flush();
      line += part;
    });
  };

  const popTo = (index: number): void => {
    while (stack.length > index) {
      const element = stack.pop() as Open;
      const where = places.get(element.name) as number[];
      where.pop();
      if (where.length === 0) places.delete(element.name);
      if (element.dropped) {
        dropped -= 1;
        continue;
      }
      if (element.boilerplate) skipped -= 1;
      if (element.section) sections -= 1;
      if (element.name === 'td' || element.name === 'th') cells -= 1;
      else if (element.name === 'pre') pre -= 1;
      if (BLOCK.has(element.name)) {
        boundary();
        if (element.name === 'tr') rowCells = 0;
      }
      const region = element.region;
      if (region) {
        region.end = lines.length;
        region.to = kept;
        current = region.parent;
      }
    }
  };
  // Closes the nearest open element with one of these names, unless an element with one of the stops
  // is nearer: a new list item ends the last item of its own list, not one of an outer list.
  const closeNearest = (names: readonly string[], stops: readonly string[]): void => {
    let target = -1;
    for (const name of names) target = Math.max(target, nearest(name));
    if (target < 0 || stops.some((name) => nearest(name) > target)) return;
    popTo(target);
  };
  // The end tags that a page may leave out: a new list item ends the last, a new row ends the row.
  const impliedEnds = (name: string): void => {
    if (name === 'li') closeNearest(['li'], ['ul', 'ol', 'menu', 'table']);
    else if (name === 'dt' || name === 'dd') closeNearest(['dt', 'dd'], ['dl', 'table']);
    else if (name === 'tr') closeNearest(['tr'], ['table', 'thead', 'tbody', 'tfoot']);
    else if (name === 'td' || name === 'th') closeNearest(['td', 'th'], ['tr', 'table']);
    else if (name === 'thead' || name === 'tbody' || name === 'tfoot') {
      closeNearest(['thead', 'tbody', 'tfoot'], ['table']);
    }
    if (ENDS_PARAGRAPH.has(name)) {
      closeNearest(['p'], ['table', 'td', 'th', 'caption', 'button', 'body', 'html', 'template']);
    }
  };

  const open = (name: string, attributes: Map<string, string>, selfClosing: boolean): void => {
    if (VOID.has(name) || (selfClosing && (name === 'svg' || name === 'math'))) {
      if (dropped > 0) return;
      if (name === 'meta') {
        const key = (attributes.get('name') ?? attributes.get('property') ?? '').toLowerCase();
        const content = inline(decodeEntities(attributes.get('content') ?? '')).slice(0, 600);
        if (content && key === 'description') description ??= content;
        else if (content && key === 'og:description') ogDescription ??= content;
      } else if (name === 'br') flush();
      else if (name === 'hr') boundary();
      return;
    }
    impliedEnds(name);
    // A page nested deeper than any real one is read no further: what it hides could not be tracked.
    if (stack.length >= MAX_DEPTH) {
      dropped += 1;
      return;
    }
    const element: Open = {
      name,
      dropped: DROPPED.has(name) || hidden(attributes),
      boilerplate: false,
      section: false,
      region: null,
    };
    const where = places.get(name);
    if (where) where.push(stack.length);
    else places.set(name, [stack.length]);
    stack.push(element);
    if (element.dropped) {
      dropped += 1;
      return;
    }
    let landmark: Landmark | null = null;
    if (trim) {
      landmark = landmarkOf(name, attributes);
      element.boilerplate = isBoilerplate(name, attributes, sections > 0);
      if (element.boilerplate) skipped += 1;
    }
    if (landmark) {
      element.section = true;
      sections += 1;
    }
    if (BLOCK.has(name)) {
      if (name === 'tr' || name === 'table' || name === 'caption') flush();
      else boundary();
      if (name === 'tr') rowCells = 0;
      if (cells === 0) {
        if (/^h[1-6]$/u.test(name)) prefix = `${'#'.repeat(Number(name[1]))} `;
        else if (name === 'li') prefix = '- ';
      }
    }
    if (name === 'td' || name === 'th') {
      cells += 1;
      // Not `line.trimEnd()` first: that copies the whole row for every cell, which is quadratic in
      // a row of many cells. The white space before the bar is collapsed when the line is flushed.
      if (rowCells > 0 && dropped === 0 && skipped === 0) line += ' | ';
      rowCells += 1;
    } else if (name === 'pre') pre += 1;
    // Only a block can be a region: a block is where a line begins and ends, so the lines of the page
    // say what is inside it. (A table cell is an exception; its row is one line.)
    if (
      (landmark === 'main' || landmark === 'article') &&
      BLOCK.has(name) &&
      skipped === 0 &&
      regions.length < MAX_REGIONS
    ) {
      const region: Region = {
        kind: landmark,
        parent: current,
        start: lines.length,
        end: lines.length,
        from: kept,
        to: kept,
      };
      regions.push(region);
      element.region = region;
      current = region;
    }
  };

  const close = (name: string): void => {
    if (name === 'br') return open('br', new Map(), false);
    const index = nearest(name);
    if (index >= 0) popTo(index);
  };

  const length = html.length;
  let position = 0;
  let tags = 0;
  while (position < length && tags < MAX_TAGS) {
    const start = html.indexOf('<', position);
    if (start < 0) {
      text(html.slice(position));
      break;
    }
    if (start > position) text(html.slice(position, start));
    const next = html.charCodeAt(start + 1);
    if (html.startsWith('<!--', start)) {
      // `<!-->` and `<!--->` are comments that end at once; any other comment runs to `-->`.
      if (html.startsWith('<!-->', start)) position = start + 5;
      else if (html.startsWith('<!--->', start)) position = start + 6;
      else {
        const end = html.indexOf('-->', start + 4);
        position = end < 0 ? length : end + 3;
      }
      continue;
    }
    if (next === 0x21 || next === 0x3f) {
      const end = html.indexOf('>', start + 2);
      position = end < 0 ? length : end + 1;
      continue;
    }
    if (next === 0x2f) {
      if (!isLetter(html.charCodeAt(start + 2))) {
        const end = html.indexOf('>', start + 2);
        position = end < 0 ? length : end + 1;
        continue;
      }
      let cursor = start + 2;
      while (
        cursor < length &&
        !isSpace(html.charCodeAt(cursor)) &&
        html[cursor] !== '>' &&
        html[cursor] !== '/'
      ) {
        cursor += 1;
      }
      tags += 1;
      close(html.slice(start + 2, cursor).toLowerCase());
      const end = html.indexOf('>', cursor);
      position = end < 0 ? length : end + 1;
      continue;
    }
    if (!isLetter(next)) {
      text('<');
      position = start + 1;
      continue;
    }

    let cursor = start + 1;
    while (
      cursor < length &&
      !isSpace(html.charCodeAt(cursor)) &&
      html[cursor] !== '>' &&
      html[cursor] !== '/'
    ) {
      cursor += 1;
    }
    const name = html.slice(start + 1, cursor).toLowerCase();
    const attributes = new Map<string, string>();
    let selfClosing = false;
    let closed = false;
    while (cursor < length) {
      while (cursor < length && (isSpace(html.charCodeAt(cursor)) || html[cursor] === '/')) {
        selfClosing = html[cursor] === '/' && html[cursor + 1] === '>';
        cursor += 1;
      }
      if (cursor >= length) break;
      if (html[cursor] === '>') {
        cursor += 1;
        closed = true;
        break;
      }
      const nameStart = cursor;
      while (
        cursor < length &&
        !isSpace(html.charCodeAt(cursor)) &&
        html[cursor] !== '=' &&
        html[cursor] !== '>' &&
        html[cursor] !== '/'
      ) {
        cursor += 1;
      }
      if (cursor === nameStart) cursor += 1;
      const attribute = html.slice(nameStart, cursor).toLowerCase();
      while (cursor < length && isSpace(html.charCodeAt(cursor))) cursor += 1;
      let value = '';
      if (html[cursor] === '=') {
        cursor += 1;
        while (cursor < length && isSpace(html.charCodeAt(cursor))) cursor += 1;
        const quote = html[cursor];
        if (quote === '"' || quote === "'") {
          const end = html.indexOf(quote, cursor + 1);
          value = html.slice(cursor + 1, end < 0 ? length : end);
          cursor = end < 0 ? length : end + 1;
        } else {
          const valueStart = cursor;
          while (cursor < length && !isSpace(html.charCodeAt(cursor)) && html[cursor] !== '>') {
            cursor += 1;
          }
          value = html.slice(valueStart, cursor);
        }
      }
      if (attributes.size < MAX_ATTRIBUTES && !attributes.has(attribute)) {
        attributes.set(attribute, value.slice(0, MAX_ATTRIBUTE_CHARS));
      }
    }
    // A tag the page never finishes is not a tag.
    if (!closed) break;
    tags += 1;
    position = cursor;

    if (RAW_TEXT.has(name)) {
      const raw = endOfRawText(html, name, position);
      position = raw.next;
      if (dropped === 0 && !hidden(attributes)) {
        if (name === 'title' && title === null) {
          title = inline(decodeEntities(raw.content)).slice(0, 300) || null;
        } else if (
          name === 'script' &&
          /application\/ld\+json/iu.test(attributes.get('type') ?? '') &&
          jsonLd.length < MAX_JSON_LD_BLOCKS &&
          raw.content.length <= MAX_JSON_LD_CHARS
        ) {
          jsonLd.push(raw.content);
        }
      }
      continue;
    }
    open(name, attributes, selfClosing);
  }
  popTo(0);
  flush();
  return {
    title,
    description: description ?? ogDescription,
    jsonLd,
    lines,
    kept,
    regions,
    leftOut,
  };
}

/**
 * The regions that hold the page's own text, when the page has them: its main region, or else its
 * articles. One is chosen only when it holds a substantial part of what the page has outside its
 * boilerplate; a page whose `main` is a few words (a banner, a heading) is read as a whole instead.
 */
function chooseRegions(regions: readonly Region[], total: number): Region[] | null {
  // Once the most that are followed have been, which of the rest holds the page's text is not known.
  if (regions.length >= MAX_REGIONS) return null;
  const size = (region: Region): number => region.to - region.from;
  const enough = (chars: number): boolean =>
    (chars >= READING.mainChars && chars >= total * READING.mainShare) ||
    (chars >= READING.dominantChars && chars >= total * READING.dominantShare);
  let main: Region | null = null;
  for (const region of regions) {
    if (region.kind === 'main' && (main === null || size(region) > size(main))) main = region;
  }
  if (main && enough(size(main))) return [main];
  // Articles inside another article or main region are part of it. Several that stand side by side
  // are all kept, unless some are much smaller than the largest: a story with teasers around it.
  const articles = regions.filter((region) => region.kind === 'article' && region.parent === null);
  const largest = Math.max(0, ...articles.map(size));
  const group = articles.filter(
    (region) => size(region) > 0 && size(region) >= largest * READING.articleShare,
  );
  const chars = group.reduce((sum, region) => sum + size(region), 0);
  return group.length > 0 && enough(chars) ? group : null;
}

/**
 * Reads the text of an HTML page without running any of it. The page is only a string that is
 * scanned once, by a small tokenizer: no script is evaluated, no style is applied, no frame, image,
 * form or link is fetched or followed (the text of a link is kept, its address is not), and the
 * amount of work is capped however the page is built. What a browser would hide, or would not show,
 * is left out: scripts, styles, templates, frames, drawings, form controls, comments, and anything
 * marked `hidden`, `aria-hidden="true"`, `display:none` or `visibility:hidden`. Everything that is
 * kept is data to read, however it is worded.
 *
 * Of what the page does show, the text of the page itself is kept and its boilerplate is not: menus,
 * side panels, footers, notices and the like (`boilerplate.ts`), and, when the page has a main
 * region with a substantial part of the text, everything outside it. That is a guess from how the
 * page is built. When it would leave almost nothing of a page that shows much more, the page is
 * read whole, and `reading` says so.
 */
export function extractPage(html: string): ExtractedPage {
  const first = scan(html, true);
  const chosen = chooseRegions(first.regions, first.kept);
  let lines = first.lines;
  let kept = first.kept;
  if (chosen) {
    lines = chosen.flatMap((region, index) => [
      ...(index > 0 ? [''] : []),
      ...first.lines.slice(region.start, region.end),
    ]);
    kept = chosen.reduce((sum, region) => sum + region.to - region.from, 0);
  }
  const leftOut = first.leftOut || kept < first.kept;
  let reading: PageReading = {
    scope: !leftOut ? 'all' : chosen ? 'main' : 'page',
    fellBack: false,
  };
  if (leftOut && kept < READING.floorChars) {
    const whole = scan(html, false);
    if (whole.kept >= READING.floorRatio * kept && whole.kept - kept >= READING.gainChars) {
      lines = whole.lines;
      reading = { scope: 'all', fellBack: true };
    }
  }
  return {
    title: first.title,
    description: first.description,
    body: tidy(lines.join('\n')),
    structured: structuredFacts(first.jsonLd),
    reading,
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function typeLabel(type: unknown): string {
  const first = Array.isArray(type) ? type[0] : type;
  if (typeof first !== 'string') return 'Item';
  const name = (first.split(/[/#]/u).pop() ?? '').replace(/[^A-Za-z0-9_.-]/gu, '').slice(0, 40);
  return name || 'Item';
}

/**
 * Facts a page publishes about itself for machines (JSON-LD), as `Type.field: value` lines. They are
 * read as data and labelled as such; none of it is evaluated or followed.
 */
function structuredFacts(blocks: string[]): string[] {
  const facts: string[] = [];
  let chars = 0;
  for (const block of blocks) {
    let data: unknown;
    try {
      data = JSON.parse(block);
    } catch {
      continue;
    }
    const graph = isObject(data) && Array.isArray(data['@graph']) ? data['@graph'] : null;
    const items: unknown[] = graph ?? (Array.isArray(data) ? data : [data]);
    for (const item of items.slice(0, 25)) {
      if (!isObject(item)) continue;
      const { lines } = flattenJson(item, {
        root: typeLabel(item['@type']),
        maxLines: 60,
        maxChars: 4_000,
        skipKey: (key) => key.startsWith('@') || SKIPPED_FACTS.has(key),
      });
      for (const fact of lines) {
        if (chars + fact.length > MAX_STRUCTURED_CHARS) return facts;
        facts.push(fact);
        chars += fact.length + 1;
      }
    }
  }
  return facts;
}

export interface PageDocument {
  /** The document text, at most `limit` characters. */
  text: string;
  /** How much readable text and data the page had, before it was cut to fit. */
  readableChars: number;
  truncated: boolean;
}

/**
 * The text of a page as one document: its title and description, what it says, and the facts it
 * publishes for machines, labelled. When it is too long the body is cut, with a notice in the text
 * itself, and the facts are kept: they are short, and often what the page is for.
 */
export function pageDocument(page: ExtractedPage, limit = MAX_DOCUMENT_CHARS): PageDocument {
  const head = [
    page.title ? `Title: ${sanitize(page.title)}` : '',
    page.description ? `Description: ${sanitize(page.description)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const structured = page.structured.length
    ? `Structured data:\n${page.structured.join('\n')}`
    : '';
  const room = Math.max(0, limit - head.length - structured.length - 4);
  const body = fit(page.body, room);
  const text = [head, body.text, structured].filter(Boolean).join('\n\n');
  return {
    text,
    readableChars: page.body.length + structured.length,
    truncated: body.truncated,
  };
}
