/**
 * A response that says it is text and is not. A site, or something between it and the crawler, can
 * label any bytes as `text/html`; the text readers would then turn an executable, an archive or a PDF
 * into a page of replacement characters, or worse, read part of it as text. The first bytes say what a
 * file is, so they are looked at before anything is read.
 */

const ascii = (text: string): number[] => [...text].map((character) => character.charCodeAt(0));

const startsWith = (body: Buffer, bytes: readonly number[], at = 0): boolean =>
  bytes.every((byte, index) => body[at + index] === byte);

interface Kind {
  /** A short phrase for what the file is, safe to put in a message. */
  label: string;
  matches: (body: Buffer) => boolean;
}

const by = (label: string, bytes: readonly number[], at = 0): Kind => ({
  label,
  matches: (body) => startsWith(body, bytes, at),
});

const between = (byte: number | undefined, low: number, high: number): boolean =>
  byte !== undefined && byte >= low && byte <= high;

// Only signatures that cannot begin a text are here: a word such as `BM` or `ID3` can.
const KINDS: readonly Kind[] = [
  by('a PDF document', ascii('%PDF-')),
  by('a ZIP archive or an office document', [0x50, 0x4b, 0x03, 0x04]),
  by('a ZIP archive or an office document', [0x50, 0x4b, 0x05, 0x06]),
  by('a compressed file', [0x1f, 0x8b]),
  {
    label: 'a compressed file',
    matches: (body) =>
      startsWith(body, ascii('BZh')) &&
      between(body[3], 0x31, 0x39) &&
      startsWith(body, [0x31, 0x41, 0x59, 0x26, 0x53, 0x59], 4),
  },
  by('a compressed file', [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]),
  by('a compressed file', [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]),
  by('a compressed file', [...ascii('Rar!'), 0x1a, 0x07]),
  by('a program', [0x7f, 0x45, 0x4c, 0x46]),
  by('a program', [0xca, 0xfe, 0xba, 0xbe]),
  by('a program', [0xfe, 0xed, 0xfa, 0xce]),
  by('a program', [0xfe, 0xed, 0xfa, 0xcf]),
  by('a program', [0xce, 0xfa, 0xed, 0xfe]),
  by('a program', [0xcf, 0xfa, 0xed, 0xfe]),
  {
    label: 'a program',
    // `MZ` begins every Windows program, and some words: a program has a zero in its first few dozen bytes.
    matches: (body) => body[0] === 0x4d && body[1] === 0x5a && body.subarray(0, 64).includes(0),
  },
  by('an image', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  by('an image', ascii('GIF87a')),
  by('an image', ascii('GIF89a')),
  by('an image', [0xff, 0xd8, 0xff]),
  by('an image', [0x49, 0x49, 0x2a, 0x00]),
  by('an image', [0x4d, 0x4d, 0x00, 0x2a]),
  by('audio or video', ascii('OggS')),
  by('audio or video', ascii('fLaC')),
  by('audio or video', [0x1a, 0x45, 0xdf, 0xa3]),
  by('audio or video', ascii('ftyp'), 4),
  {
    label: 'audio or video',
    matches: (body) => startsWith(body, ascii('ID3')) && between(body[3], 2, 4) && body[4] === 0,
  },
  by('a font', ascii('wOFF')),
  by('a font', ascii('wOF2')),
  by('a database', ascii('SQLite format 3\u0000')),
  by('an old office document', [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
];

const HEAD = 8_192;
// Text with more than this share of control characters is not text.
const CONTROL_SHARE = 0.05;

/** UTF-16 text, with or without a mark, has a zero in every other byte and is text. */
function utf16(head: Buffer): boolean {
  if ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff)) return true;
  let even = 0;
  let odd = 0;
  for (let index = 0; index < head.length; index += 1) {
    if (head[index] === 0) {
      if (index % 2 === 0) even += 1;
      else odd += 1;
    }
  }
  const pairs = Math.floor(head.length / 2);
  return (
    pairs > 8 && (even > pairs * 0.4 || odd > pairs * 0.4) && Math.min(even, odd) < pairs * 0.05
  );
}

/**
 * What the bytes of a response that is labelled as text really are, when they are not text: the kind
 * of file, as a short phrase. Null for text.
 */
export function bytesAreNotText(body: Buffer): string | null {
  for (const kind of KINDS) if (kind.matches(body)) return kind.label;
  const head = body.subarray(0, HEAD);
  if (head.length === 0 || utf16(head)) return null;
  let controls = 0;
  for (const byte of head) {
    if (byte === 0) return 'binary data';
    if ((byte < 0x09 || (byte > 0x0d && byte < 0x20 && byte !== 0x1b)) && byte !== 0x0c)
      controls += 1;
  }
  return controls > head.length * CONTROL_SHARE ? 'binary data' : null;
}

/** The share of a decoded text that is the replacement character, which is what bytes that are not text become. */
export function replacementShare(text: string): number {
  const sample = text.slice(0, HEAD);
  if (sample.length === 0) return 0;
  let bad = 0;
  for (const character of sample) if (character === '\ufffd') bad += 1;
  return bad / sample.length;
}
