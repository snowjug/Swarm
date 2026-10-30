/**
 * Turns the SQL the stores are written in (SQLite dialect, `?` placeholders) into PostgreSQL.
 *
 * Only what actually differs is handled, and anything that cannot be translated safely is refused
 * rather than guessed at, so that a statement which behaves differently cannot slip through:
 *
 * - `?` becomes `$1`, `$2`, ...
 * - `INSERT OR IGNORE` becomes `INSERT ... ON CONFLICT DO NOTHING`.
 * - `BEGIN IMMEDIATE` becomes `BEGIN`; `PRAGMA` has no meaning here and becomes nothing.
 * - `IFNULL` becomes `COALESCE`.
 * - A column alias in mixed case (`AS projectId`) is quoted, because PostgreSQL would fold it to
 *   lower case and the stores read rows by the name they wrote.
 *
 * Text inside quotes and comments is never rewritten.
 */

interface Segment {
  text: string;
  /** False for string literals, quoted identifiers and comments. */
  code: boolean;
}

function segments(sql: string): Segment[] {
  const result: Segment[] = [];
  let start = 0;
  let index = 0;
  const flush = (end: number, code: boolean) => {
    if (end > start) result.push({ text: sql.slice(start, end), code });
    start = end;
  };
  while (index < sql.length) {
    const char = sql[index]!;
    const next = sql[index + 1];
    if (char === "'" || char === '"') {
      flush(index, true);
      index++;
      while (index < sql.length) {
        if (sql[index] === char) {
          if (sql[index + 1] === char) index += 2;
          else break;
        } else index++;
      }
      index++;
      flush(index, false);
    } else if (char === '-' && next === '-') {
      flush(index, true);
      while (index < sql.length && sql[index] !== '\n') index++;
      flush(index, false);
    } else if (char === '/' && next === '*') {
      flush(index, true);
      const end = sql.indexOf('*/', index + 2);
      index = end < 0 ? sql.length : end + 2;
      flush(index, false);
    } else {
      index++;
    }
  }
  flush(sql.length, true);
  return result;
}

const CAPITAL_ALIAS = /\bAS\s+([A-Za-z_][A-Za-z0-9_]*)/giu;

export function toPostgres(sql: string): string {
  const statement = sql.trim().replace(/;+\s*$/u, '');
  if (/^PRAGMA\b/iu.test(statement)) return '';
  if (/^INSERT\s+OR\s+REPLACE\b/iu.test(statement)) {
    throw new Error('INSERT OR REPLACE has no safe translation: write an upsert with ON CONFLICT.');
  }
  let ignoreConflicts = false;
  let placeholder = 0;
  const rewritten = segments(statement)
    .map(({ text, code }) => {
      if (!code) return text;
      return text
        .replace(/^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/iu, (match) => {
          ignoreConflicts = true;
          return match.replace(/OR\s+IGNORE\s+/iu, '');
        })
        .replace(/\bBEGIN\s+IMMEDIATE\b/giu, 'BEGIN')
        .replace(/\bIFNULL\s*\(/giu, 'COALESCE(')
        .replace(/\?/gu, () => `$${++placeholder}`)
        .replace(CAPITAL_ALIAS, (match, name: string) =>
          /[A-Z]/u.test(name) && /[a-z]/u.test(name) ? `AS "${name}"` : match,
        );
    })
    .join('');
  if (!ignoreConflicts) return rewritten;
  const returning = /\s+RETURNING\b[\s\S]*$/iu.exec(rewritten);
  return returning
    ? `${rewritten.slice(0, returning.index)} ON CONFLICT DO NOTHING${returning[0]}`
    : `${rewritten} ON CONFLICT DO NOTHING`;
}
