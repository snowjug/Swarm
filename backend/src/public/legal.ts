import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LegalDocument, LegalText } from '../../../shared/public.js';

/**
 * The terms and the privacy notice. They are text files the owner writes (`legal/terms.md`, `legal/privacy.md`, copied
 * into the image), and the site serves them as plain text. Until the owner replaces a stub, the file says so in its first
 * line, and so does the page: `reviewed` is false for as long as the marker is there.
 */
const MARKER = 'NOT YET REVIEWED';

const TITLES: Record<LegalDocument, string> = { terms: 'Terms of use', privacy: 'Privacy notice' };

const FALLBACK: Record<LegalDocument, string> = {
  terms: `${MARKER}: the owner of this site has not written these terms yet.\n\nUntil they do, treat this service as an experiment: it is provided as it is, it may change or stop at any time, and nothing it produces is advice.`,
  privacy: `${MARKER}: the owner of this site has not written this notice yet.\n\nWhat the service does with your data is described in its FAQ. Until this notice is written, assume nothing beyond that.`,
};

export function legalText(
  document: LegalDocument,
  directory = resolve(process.cwd(), 'legal'),
): LegalText {
  const path = resolve(directory, `${document}.md`);
  let text = FALLBACK[document];
  try {
    if (existsSync(path)) text = readFileSync(path, 'utf8').slice(0, 60_000);
  } catch {
    // An unreadable file is the stub.
  }
  return { title: TITLES[document], text, reviewed: !text.includes(MARKER) };
}
