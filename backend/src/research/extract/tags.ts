import type { DefaultTreeAdapterTypes } from 'parse5';

type Element = DefaultTreeAdapterTypes.Element;

/** Nothing inside these is text on the page: code, styling, inert templates, other documents, drawings and the controls of a form. */
export const DROPPED: ReadonlySet<string> = new Set([
  'script',
  'style',
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
  'noscript',
  'head',
  'title',
  'meta',
  'link',
  'base',
  'audio',
  'video',
  'source',
  'track',
  'map',
  'area',
  'frame',
  'frameset',
  'noframes',
  'noembed',
  'img',
  'picture',
]);

/** Where a line of text ends and another begins. */
export const BLOCK: ReadonlySet<string> = new Set([
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
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
]);

/**
 * Furniture that `boilerplate.ts` does not know: the comments under an article, the stories it
 * recommends, its pager and its share buttons. Names are matched whole, as there.
 */
const EXTRA_CLASSES: ReadonlySet<string> = new Set([
  'comments',
  'comments-area',
  'comment-list',
  'commentlist',
  'comment-section',
  'comment-respond',
  'comment-form',
  'disqus_thread',
  'fb-comments',
  'related',
  'related-posts',
  'related-content',
  'related-articles',
  'related-links',
  'related-stories',
  'more-stories',
  'recommended',
  'recommendations',
  'most-read',
  'most-popular',
  'trending',
  'also-read',
  'pagination',
  'pager',
  'share-buttons',
  'share-links',
  'social-share',
  'share-bar',
  'sharedaddy',
  'addthis_toolbox',
  'tag-list',
  'post-tags',
  'tagcloud',
  'signup',
  'sign-up',
  'newsletter-signup',
  'subscribe-form',
]);
const EXTRA_ID_ELEMENTS: ReadonlySet<string> = new Set([
  'div',
  'section',
  'ul',
  'ol',
  'aside',
  'form',
  'table',
]);

const words = (value: string | undefined): string[] =>
  value === undefined ? [] : value.toLowerCase().split(/\s+/u);

export function extraFurniture(name: string, attributes: ReadonlyMap<string, string>): boolean {
  if (words(attributes.get('class')).some((token) => EXTRA_CLASSES.has(token))) return true;
  return (
    EXTRA_ID_ELEMENTS.has(name) &&
    words(attributes.get('id')).some((token) => EXTRA_CLASSES.has(token))
  );
}

const EMPTY: ReadonlyMap<string, string> = new Map();
const MAX_ATTRIBUTE_CHARS = 2_000;

export function attributesOf(element: Element): ReadonlyMap<string, string> {
  if (element.attrs.length === 0) return EMPTY;
  const found = new Map<string, string>();
  for (const { name, value } of element.attrs) {
    if (!found.has(name)) {
      found.set(
        name,
        value.length > MAX_ATTRIBUTE_CHARS ? value.slice(0, MAX_ATTRIBUTE_CHARS) : value,
      );
    }
  }
  return found;
}

const WHITE = new Set(['#fff', '#ffffff', 'white', 'rgb(255,255,255)']);
const BLACK = new Set(['#000', '#000000', 'black', 'rgb(0,0,0)']);

function declarations(style: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const part of style
    .toLowerCase()
    .replace(/!important/gu, '')
    .split(';')) {
    const colon = part.indexOf(':');
    if (colon > 0)
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).replace(/\s+/gu, ''));
  }
  return found;
}

const lengthOf = (value: string | undefined): { amount: number; unit: string } | null => {
  // A length is a few characters. What is longer is not one, and no pattern is run over it: a long run of
  // digits with the wrong end made the pattern below take time with the square of its length.
  if (!value || value.length > 24) return null;
  const match = /^(-?(?:\d+(?:\.\d*)?|\.\d+))([a-z%]*)$/u.exec(value);
  return match ? { amount: Number(match[1]), unit: match[2] ?? '' } : null;
};

/**
 * Whether an inline style hides the text of an element from a reader: not shown, not visible, fully
 * transparent, too small to read, pushed far off the page, collapsed to nothing, or the colour of its
 * own background. A style sheet or a class can hide text in ways that cannot be seen without rendering
 * the page, which is not done.
 */
export function styleHides(style: string): boolean {
  const rules = declarations(style);
  if (rules.get('display') === 'none') return true;
  const visibility = rules.get('visibility');
  if (visibility === 'hidden' || visibility === 'collapse') return true;
  const opacity = Number(rules.get('opacity'));
  if (rules.has('opacity') && opacity <= 0) return true;
  const size = lengthOf(rules.get('font-size'));
  if (size) {
    const tiny = size.unit === 'px' ? 2 : size.unit === 'pt' ? 1.5 : size.unit === '%' ? 10 : 0.1;
    if (size.amount <= tiny) return true;
  }
  for (const property of [
    'text-indent',
    'left',
    'top',
    'right',
    'bottom',
    'margin-left',
    'margin-top',
  ]) {
    const offset = lengthOf(rules.get(property));
    if (offset && offset.amount <= -1_000) return true;
  }
  if (rules.get('overflow') === 'hidden') {
    for (const property of ['height', 'max-height', 'width', 'max-width']) {
      const extent = lengthOf(rules.get(property));
      if (extent && extent.amount === 0) return true;
    }
  }
  const colour = rules.get('color');
  const background = rules.get('background-color') ?? rules.get('background');
  if (colour && background) {
    return (
      colour === background ||
      (WHITE.has(colour) && WHITE.has(background)) ||
      (BLACK.has(colour) && BLACK.has(background))
    );
  }
  return false;
}

/** Hidden from a reader, so what it says is not something the page shows to a person. */
export function hides(attributes: ReadonlyMap<string, string>): boolean {
  if (attributes.has('hidden')) return true;
  if (attributes.get('aria-hidden')?.trim().toLowerCase() === 'true') return true;
  const style = attributes.get('style');
  return style !== undefined && styleHides(style);
}

/** A frame, object or embed that shows another document to a reader, as opposed to a tracking pixel or a blank. */
export function embedsDocument(attributes: ReadonlyMap<string, string>): boolean {
  if (hides(attributes)) return false;
  if (Number.parseFloat(attributes.get('width') ?? '') <= 1) return false;
  if (Number.parseFloat(attributes.get('height') ?? '') <= 1) return false;
  const address = (
    attributes.get('src') ??
    attributes.get('data-src') ??
    attributes.get('data') ??
    ''
  ).trim();
  return attributes.has('srcdoc') || (address !== '' && !/^about:/iu.test(address));
}

// A script that holds data for a page's own scripts, not code that builds what it shows.
export const DATA_SCRIPT = /json|importmap|speculationrules/iu;
