/**
 * What on a page is not what the page says: its menus, side panels, footers, cookie and sign-up
 * notices, share buttons, and the markers and edit links of an encyclopedia. A browser shows all of
 * it, so it is "visible", but nobody reads it as the page's text.
 *
 * The page is only a string, so this is judged from how the page is built, by conventions most pages
 * follow. That is a guess and it can be wrong either way: `extractPage` says so, reads the whole page
 * when the guess would leave almost nothing, and the person can always paste the text instead. Names
 * are matched whole, never as part of a longer name: `sidebar` is a side panel, `sidebar-layout` is
 * not. The document itself, its `main` region and its `article`s are never boilerplate, whatever
 * they are called.
 */

/** Elements that are boilerplate wherever they are. */
export const BOILERPLATE_ELEMENTS = ['nav', 'aside', 'footer', 'dialog', 'search'] as const;

/**
 * Elements that hold a part of a page. A `header` inside one of them is the heading of that part and
 * stays; a `header` outside all of them is the header of the page and goes.
 */
export const SECTIONING_ELEMENTS = ['article', 'main', 'section'] as const;

/** Roles that mark boilerplate, on any element. */
export const BOILERPLATE_ROLES = [
  'navigation',
  'banner',
  'contentinfo',
  'complementary',
  'search',
  'menu',
  'menubar',
  'dialog',
  'alertdialog',
  'doc-noteref',
  'doc-backlink',
] as const;

/** Whole class names, and whole ids of a `div`, `ul`, `ol`, `table` or `form`, that mark boilerplate. */
export const BOILERPLATE_NAMES = [
  'sidebar',
  'navbar',
  'navbox',
  'nav',
  'navigation',
  'toc',
  'breadcrumb',
  'breadcrumbs',
  'skip-link',
  'skip-links',
  'skiplink',
  'cookie-banner',
  'cookie-notice',
  'cookie-consent',
  'cookie-bar',
  'cookiebanner',
  'consent-banner',
  'gdpr-banner',
  'modal',
  'popup',
  'advert',
  'adverts',
  'advertisement',
  'ad-slot',
  'adsbygoogle',
] as const;

/**
 * Whole class names that mark boilerplate. They are not read from an id: a heading often gets an id
 * made from its own words ("share", "references"), and the section under it is not boilerplate.
 */
export const BOILERPLATE_CLASSES = [
  'cookie',
  'cookies',
  'consent',
  'share',
  'sharing',
  'social',
  'newsletter',
  'subscribe',
  'noprint',
  'no-print',
  'headerlink',
  'footnote-ref',
  'hatnote',
  'mw-editsection',
  'mw-jump-link',
  'mw-portlet-lang',
  'editsection',
  'catlinks',
  'printfooter',
  'reflist',
] as const;

/**
 * Class names that mark boilerplate only on one kind of element. `reference` is the marker of a
 * citation (`[12]`) on a `sup`, but a documentation generator puts it on every link; `references` is
 * the list of citations when it is an ordered list.
 */
export const BOILERPLATE_ON: Readonly<Record<string, string>> = {
  reference: 'sup',
  references: 'ol',
};

/** The elements whose `id` is read. Headings and sections often carry an id made from their own words. */
export const ID_ELEMENTS = ['div', 'ul', 'ol', 'table', 'form'] as const;

/** Elements that are never boilerplate, whatever they are called or marked: the document and its content. */
export const NEVER_BOILERPLATE = ['html', 'body', 'main', 'article'] as const;

const ELEMENTS: ReadonlySet<string> = new Set(BOILERPLATE_ELEMENTS);
const ROLES: ReadonlySet<string> = new Set(BOILERPLATE_ROLES);
const NAMES: ReadonlySet<string> = new Set(BOILERPLATE_NAMES);
const CLASSES: ReadonlySet<string> = new Set(BOILERPLATE_CLASSES);
const IDS: ReadonlySet<string> = new Set(ID_ELEMENTS);
const ON: ReadonlyMap<string, string> = new Map(Object.entries(BOILERPLATE_ON));
const NEVER: ReadonlySet<string> = new Set(NEVER_BOILERPLATE);

type Attributes = ReadonlyMap<string, string>;

const words = (value: string | undefined): string[] =>
  value === undefined ? [] : value.toLowerCase().split(/\s+/u);

/** A region of the page that holds a part of it: the main content, an article, or another section. */
export type Landmark = 'main' | 'article' | 'section';

export function landmarkOf(name: string, attributes: Attributes): Landmark | null {
  if (name === 'main' || words(attributes.get('role')).includes('main')) return 'main';
  return name === 'article' || name === 'section' ? name : null;
}

/**
 * Whether an element is boilerplate: its text is not read. `insideSection` says whether it is inside
 * an `article`, `main` or `section`, where a `header` is not the header of the page.
 */
export function isBoilerplate(
  name: string,
  attributes: Attributes,
  insideSection: boolean,
): boolean {
  if (NEVER.has(name)) return false;
  const roles = words(attributes.get('role'));
  if (roles.includes('main')) return false;
  if (ELEMENTS.has(name) || (name === 'header' && !insideSection)) return true;
  if (roles.some((role) => ROLES.has(role))) return true;
  for (const token of words(attributes.get('class'))) {
    if (NAMES.has(token) || CLASSES.has(token) || ON.get(token) === name) return true;
  }
  return IDS.has(name) && words(attributes.get('id')).some((token) => NAMES.has(token));
}
