import { flattenJson } from '../../ingest/url/normalize.js';

const SKIPPED_FACTS: ReadonlySet<string> = new Set([
  'url',
  'image',
  'logo',
  'sameAs',
  'potentialAction',
  'thumbnailUrl',
  'contentUrl',
  'mainEntityOfPage',
]);
const MAX_STRUCTURED_CHARS = 6_000;
const MAX_ITEMS_PER_BLOCK = 25;
const MAX_TYPES = 20;
// What a comment or a review says about itself is not what the page says about itself.
const OTHER_VOICE = /Comment|Review|Rating|Question|Answer/u;

export interface Structured {
  /** `Type.field: value` lines. They are data about the page, read as data and never evaluated. */
  lines: string[];
  types: string[];
  datePublished: string | null;
  dateModified: string | null;
  authors: string[];
  language: string | null;
  /** The page says it is not free to read. */
  paywalled: boolean;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const textOf = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 300) : null;

function typeLabel(type: unknown): string {
  const first = Array.isArray(type) ? type[0] : type;
  if (typeof first !== 'string') return 'Item';
  const name = (first.split(/[/#]/u).pop() ?? '').replace(/[^A-Za-z0-9_.-]/gu, '').slice(0, 40);
  return name || 'Item';
}

function typesOf(type: unknown): string[] {
  return (Array.isArray(type) ? type : [type])
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => typeLabel(entry));
}

function namesOf(author: unknown): string[] {
  const list = Array.isArray(author) ? author : [author];
  return list
    .slice(0, 5)
    .map((entry) => (isObject(entry) ? textOf(entry.name) : textOf(entry)))
    .filter((name): name is string => name !== null);
}

function accessibleForFree(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const said = value.trim().toLowerCase();
    if (said === 'false') return false;
    if (said === 'true') return true;
  }
  return null;
}

/**
 * Reads the JSON-LD a page publishes about itself. It is parsed, never evaluated, nothing in it is
 * followed, and every container, depth, line and value is capped by `flattenJson`. What the page says
 * about its own dates and authors is kept apart from what a comment or a review in it says.
 */
export function readStructured(blocks: readonly string[]): Structured {
  const found: Structured = {
    lines: [],
    types: [],
    datePublished: null,
    dateModified: null,
    authors: [],
    language: null,
    paywalled: false,
  };
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
    for (const item of items.slice(0, MAX_ITEMS_PER_BLOCK)) {
      if (!isObject(item)) continue;
      const types = typesOf(item['@type']);
      for (const type of types) {
        if (found.types.length < MAX_TYPES && !found.types.includes(type)) found.types.push(type);
      }
      if (!types.some((type) => OTHER_VOICE.test(type))) {
        found.datePublished ??= textOf(item.datePublished);
        found.dateModified ??= textOf(item.dateModified);
        found.language ??= textOf(item.inLanguage);
        if (found.authors.length === 0) found.authors = namesOf(item.author);
        if (accessibleForFree(item.isAccessibleForFree) === false) found.paywalled = true;
      }
      const { lines } = flattenJson(item, {
        root: typeLabel(item['@type']),
        maxLines: 60,
        maxChars: 4_000,
        skipKey: (key) => key.startsWith('@') || SKIPPED_FACTS.has(key),
      });
      for (const fact of lines) {
        if (chars + fact.length > MAX_STRUCTURED_CHARS) return found;
        found.lines.push(fact);
        chars += fact.length + 1;
      }
    }
  }
  return found;
}
