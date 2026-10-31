import { MAX_DOCUMENT_CHARS } from '../../../../shared/types.js';

/**
 * Characters that show nothing, or change how the text around them reads, and so can hide an
 * instruction from a person while a model still sees it: soft hyphens, zero-width spaces,
 * bidirectional overrides, word joiners, the Unicode "tag" block and the variation selectors
 * supplement. A zero-width non-joiner or joiner (U+200C, U+200D) stays: some scripts and emoji
 * cannot be written without it.
 */
function isHiding(code: number): boolean {
  return (
    code === 0xad ||
    code === 0x61c ||
    code === 0x180e ||
    code === 0x200b ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x206f) ||
    code === 0xfeff ||
    (code >= 0xfff9 && code <= 0xfffb) ||
    (code >= 0xe0000 && code <= 0xe007f) ||
    (code >= 0xe0100 && code <= 0xe01ef)
  );
}

const MESSAGE = {
  shortened: '[Swarm shortened this page: only the beginning was kept.]',
};

/** True for a control character other than a tab or a line break. */
function isControl(code: number): boolean {
  return (code < 32 && code !== 9 && code !== 10 && code !== 13) || (code >= 127 && code <= 159);
}

/** Replaces each unpaired surrogate, which cannot be encoded, with the replacement character. */
const wellFormed = (text: string): string => text.replace(/\p{Surrogate}/gu, '\ufffd');

/** Text that is safe to keep as a document: well-formed, no control or hiding characters, one kind of line break. */
export function sanitize(text: string): string {
  const whole = wellFormed(text);
  let out = '';
  let start = 0;
  for (let index = 0; index < whole.length;) {
    const code = whole.codePointAt(index) ?? 0;
    const width = code > 0xffff ? 2 : 1;
    if (isControl(code) || isHiding(code)) {
      out += whole.slice(start, index);
      start = index + width;
    }
    index += width;
  }
  out += whole.slice(start);
  return out.replace(/\r\n?|[\u2028\u2029]/gu, '\n');
}

/** One line: runs of white space become a single space. */
export function inline(text: string): string {
  return sanitize(text).replace(/\s+/gu, ' ').trim();
}

/** Text with its blank lines and trailing spaces tidied, and no more than one blank line in a row. */
export function tidy(text: string): string {
  return sanitize(text)
    .replace(/[^\S\n]+$/gmu, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

/**
 * Keeps a document within the size one document may have, and says so inside the text when it had
 * to cut it, so that nobody reads a part as the whole.
 */
export function fit(
  text: string,
  limit = MAX_DOCUMENT_CHARS,
): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  const notice = `\n\n${MESSAGE.shortened}`;
  let kept = text.slice(0, Math.max(0, limit - notice.length));
  const lastBreak = kept.lastIndexOf('\n');
  // Cut at a line end when one is near, and never inside a surrogate pair.
  if (lastBreak > kept.length - 2_000) kept = kept.slice(0, lastBreak);
  kept = wellFormed(kept).replace(/\ufffd$/u, '');
  return { text: `${kept.trimEnd()}${notice}`, truncated: true };
}
