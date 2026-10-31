import { inline, tidy } from './text.js';

/** Data that cannot be read as what it says it is. The message is for a person. */
export class DataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataError';
  }
}

export interface FlattenOptions {
  /** A label for the top of every path, such as the type of a structured-data item. */
  root?: string;
  maxDepth?: number;
  maxLines?: number;
  maxChars?: number;
  /** Keys that carry nothing worth reading (addresses, identifiers). */
  skipKey?: (key: string) => boolean;
}

const MAX_ITEMS = 100;
const MAX_KEYS = 200;
const MAX_VALUE_CHARS = 300;
const MAX_KEY_CHARS = 80;
const MAX_COLUMNS = 50;
const MAX_ROWS = 500;
const MAX_CELL_CHARS = 300;
const MAX_FIELD_LINES = 4_000;

const plainKey = /^[A-Za-z_][A-Za-z0-9_-]*$/u;

function keyPath(parent: string, key: string): string {
  const clean = inline(key).slice(0, MAX_KEY_CHARS);
  if (plainKey.test(clean)) return parent ? `${parent}.${clean}` : clean;
  return `${parent}[${JSON.stringify(clean)}]`;
}

function show(value: string | number | boolean | null): string {
  if (typeof value !== 'string') return String(value);
  const text = inline(value);
  return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS)}\u2026` : text;
}

/**
 * Turns parsed JSON into `path: value` lines. Only what is there is written: nothing is evaluated,
 * nothing is looked up, and every container, depth, line and value is capped, so a large or deeply
 * nested document costs a bounded amount of work and text.
 */
export function flattenJson(
  value: unknown,
  options: FlattenOptions = {},
): { lines: string[]; truncated: boolean } {
  const maxDepth = options.maxDepth ?? 8;
  const maxLines = options.maxLines ?? MAX_FIELD_LINES;
  const maxChars = options.maxChars ?? 60_000;
  const lines: string[] = [];
  let chars = 0;
  let truncated = false;

  const add = (line: string): boolean => {
    if (lines.length >= maxLines || chars + line.length > maxChars) {
      truncated = true;
      return false;
    }
    lines.push(line);
    chars += line.length + 1;
    return true;
  };

  const visit = (node: unknown, path: string, depth: number): boolean => {
    if (node === null || typeof node === 'string' || typeof node === 'number') {
      return add(`${path || 'value'}: ${show(node)}`);
    }
    if (typeof node === 'boolean') return add(`${path || 'value'}: ${node}`);
    if (depth >= maxDepth) {
      truncated = true;
      return add(`${path}: (more nested data is not shown)`);
    }
    if (Array.isArray(node)) {
      for (const [index, item] of node.slice(0, MAX_ITEMS).entries()) {
        if (!visit(item, `${path}[${index}]`, depth + 1)) return false;
      }
      if (node.length > MAX_ITEMS) {
        truncated = true;
        return add(`${path}: (${node.length - MAX_ITEMS} more items are not shown)`);
      }
      return true;
    }
    if (typeof node === 'object') {
      const keys = Object.keys(node);
      for (const key of keys.slice(0, MAX_KEYS)) {
        if (options.skipKey?.(key)) continue;
        const child = (node as Record<string, unknown>)[key];
        if (!visit(child, keyPath(path, key), depth + 1)) return false;
      }
      if (keys.length > MAX_KEYS) {
        truncated = true;
        return add(`${path}: (${keys.length - MAX_KEYS} more fields are not shown)`);
      }
    }
    return true;
  };

  visit(value, options.root ?? '', 0);
  return { lines, truncated };
}

/** JSON as readable lines. A document that is not JSON is refused, not guessed at. */
export function jsonToText(source: string): { text: string; truncated: boolean } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source.replace(/^\ufeff/u, ''));
  } catch {
    throw new DataError('This is not valid JSON.');
  }
  const { lines, truncated } = flattenJson(parsed);
  return { text: lines.join('\n'), truncated };
}

function delimiterOf(source: string): string {
  const head = source.split(/\r\n|\n|\r/u, 5).join('\n');
  let best = ',';
  let most = 0;
  for (const candidate of [',', ';', '\t', '|']) {
    let inQuotes = false;
    let count = 0;
    for (const character of head) {
      if (character === '"') inQuotes = !inQuotes;
      else if (character === candidate && !inQuotes) count += 1;
    }
    if (count > most) {
      most = count;
      best = candidate;
    }
  }
  return best;
}

/** RFC 4180 records: quoted fields, doubled quotes, line breaks inside quotes. Stops after `limit` records. */
function csvRecords(source: string, delimiter: string, limit: number): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;
  let touched = false;
  const endField = (): void => {
    if (record.length < MAX_COLUMNS) record.push(field.slice(0, MAX_CELL_CHARS));
    field = '';
  };
  const endRecord = (): void => {
    if (touched || record.length > 0 || field !== '') {
      endField();
      records.push(record);
    }
    record = [];
    touched = false;
  };
  for (let index = 0; index < source.length && records.length < limit; index += 1) {
    const character = source[index] as string;
    if (inQuotes) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          if (field.length < MAX_CELL_CHARS) field += '"';
          index += 1;
        } else inQuotes = false;
      } else if (field.length < MAX_CELL_CHARS) field += character;
    } else if (character === '"' && field === '') {
      inQuotes = true;
      touched = true;
    } else if (character === delimiter) {
      endField();
      touched = true;
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      endRecord();
    } else if (field.length < MAX_CELL_CHARS) field += character;
  }
  if (records.length < limit) endRecord();
  return records;
}

/**
 * A table as readable lines: its columns, then each row as `column: value` pairs, so a row can be
 * read, and cited, without the header above it. The number of rows, columns and the size of a cell
 * are capped.
 */
export function csvToText(source: string): { text: string; truncated: boolean } {
  const text = source.replace(/^\ufeff/u, '');
  const records = csvRecords(text, delimiterOf(text), MAX_ROWS + 2).filter((record) =>
    record.some((cell) => cell.trim() !== ''),
  );
  const [first, ...rows] = records;
  if (!first || rows.length === 0) throw new DataError('This table has no rows to read.');
  const seen = new Set<string>();
  const columns = first.map((cell, index) => {
    const name = inline(cell).slice(0, MAX_KEY_CHARS) || `column ${index + 1}`;
    const unique = seen.has(name) ? `${name} (${index + 1})` : name;
    seen.add(unique);
    return unique;
  });
  const lines = [`Columns: ${columns.join(' | ')}`];
  for (const [number, row] of rows.slice(0, MAX_ROWS).entries()) {
    const pairs = row
      .map((cell, index) => [columns[index] ?? `column ${index + 1}`, inline(cell)] as const)
      .filter(([, value]) => value !== '')
      .map(([name, value]) => `${name}: ${value}`);
    lines.push(`Row ${number + 1}: ${pairs.join(' | ')}`);
  }
  const truncated = rows.length > MAX_ROWS;
  if (truncated) lines.push(`(more rows are not shown: the first ${MAX_ROWS} are above)`);
  return { text: lines.join('\n'), truncated };
}

/** Plain text and Markdown stay as written; only what cannot be shown, or could hide something, goes. */
export function plainToText(source: string): string {
  return tidy(source);
}
