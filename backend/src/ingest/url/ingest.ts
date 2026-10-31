import type { SourceProvenance } from '../../../../shared/scenario.js';
import { documentInputSchema, MAX_DOCUMENT_CHARS } from '../../../../shared/types.js';
import { AppError } from '../../errors.js';
import { inspectText } from '../../models/injection.js';
import { extractPage, pageDocument } from './extract.js';
import { UrlFailure } from './failure.js';
import type { FetchedPage, PublicFetcher } from './fetcher.js';
import { csvToText, DataError, jsonToText, plainToText } from './normalize.js';
import { validateUrl } from './policy.js';
import { buildProvenance } from './provenance.js';
import { fit } from './text.js';

export interface UrlIngestSettings {
  allowedPorts: readonly number[];
  allowedHosts: readonly string[];
  maxBytes: number;
  timeoutMs: number;
}

export interface UrlEvidence {
  document: { name: string; content: string; provenance: SourceProvenance };
  /** What a person should know about this page before relying on it. */
  notes: string[];
}

const PASTE = 'You can paste the text instead.';
const MIN_CHARS = 80;

function megabytes(bytes: number): string {
  return bytes >= 1_000_000
    ? `${+(bytes / 1_000_000).toFixed(1)} MB`
    : `${Math.round(bytes / 1_000)} KB`;
}

function listed(numbers: readonly number[]): string {
  const words = numbers.map(String);
  return words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

/** A plain sentence for a person, always ending with the way out. It names the site and never the address. */
function explain(failure: UrlFailure, host: string | null, settings: UrlIngestSettings): AppError {
  const site = host ?? 'the site';
  const { status, contentType, redirected, reason } = failure.detail;
  switch (failure.code) {
    case 'invalid':
      return new AppError(
        400,
        'URL_INVALID',
        `That does not look like a web address Swarm can read. Use a full address that starts with https:// or http://, with no user name or password. ${PASTE}`,
      );
    case 'blocked':
      return new AppError(
        422,
        'URL_BLOCKED',
        `${
          redirected ? 'This page sends the reader on to an address' : 'This address is not one'
        } that Swarm reads. Swarm reads only public web pages: never a private network, a local address, a name used only inside a network, or a site that this server's settings do not allow. ${PASTE}`,
      );
    case 'port':
      return new AppError(
        422,
        'URL_PORT_NOT_ALLOWED',
        `${redirected ? 'This page sends the reader on to' : 'This address uses'} a port that Swarm does not read from. It reads only from port ${listed(settings.allowedPorts)}. ${PASTE}`,
      );
    case 'type':
      return new AppError(
        422,
        'URL_UNSUPPORTED_TYPE',
        `${site} sent ${
          contentType && contentType !== 'unknown'
            ? `a file of type ${contentType}`
            : 'a file of a type Swarm does not read'
        }. Swarm reads web pages, plain text, Markdown, CSV and JSON. ${PASTE}`,
      );
    case 'size':
      return new AppError(
        422,
        'URL_TOO_LARGE',
        `That page is larger than the ${megabytes(settings.maxBytes)} Swarm reads from one page, so it was not read. ${PASTE}`,
      );
    case 'timeout': {
      const seconds = Math.round(settings.timeoutMs / 1_000);
      return new AppError(
        422,
        'URL_TIMEOUT',
        `${site} took longer than ${seconds} second${seconds === 1 ? '' : 's'} to answer, so Swarm stopped. Try again later. ${PASTE}`,
      );
    }
    case 'redirects':
      return new AppError(
        422,
        'URL_TOO_MANY_REDIRECTS',
        `This address sends the reader on more than five times, so Swarm stopped. ${PASTE}`,
      );
    case 'robots':
      return new AppError(
        422,
        'URL_ROBOTS_DISALLOWED',
        `${site} asks automated tools not to read this page (in its robots.txt), and Swarm respects that. ${PASTE}`,
      );
    case 'robots-unavailable':
      return new AppError(
        422,
        'URL_ROBOTS_DISALLOWED',
        `Swarm could not read the robots.txt of ${site}, which says what automated tools may read, so it did not fetch the page. Try again later. ${PASTE}`,
      );
    case 'no-text':
      return new AppError(
        422,
        'URL_NO_TEXT',
        `This page needs JavaScript or has no readable text, so there was nothing for Swarm to read. ${PASTE}`,
      );
    case 'status': {
      const code = status ?? 0;
      const what =
        code === 404 || code === 410
          ? `${site} says the page was not found (HTTP ${code}). Check the address.`
          : code === 401 || code === 403
            ? `${site} refused access (HTTP ${code}). Swarm reads only pages that are public without signing in.`
            : code === 429
              ? `${site} asked Swarm to slow down (HTTP 429). Try again later.`
              : code >= 500
                ? `${site} had a problem and answered with an error (HTTP ${code}). Try again later.`
                : `${site} answered with an error (HTTP ${code}).`;
      return new AppError(422, 'URL_FETCH_FAILED', `${what} ${PASTE}`);
    }
    case 'network': {
      const what =
        reason === 'dns'
          ? `Swarm could not find ${site}. Check the address.`
          : reason === 'refused'
            ? `${site} refused the connection.`
            : reason === 'tls'
              ? `Swarm could not make a secure connection to ${site}: its security certificate could not be verified.`
              : reason === 'closed'
                ? `The connection to ${site} closed before the page arrived. Try again later.`
                : reason === 'encoding'
                  ? `${site} sent the page in a form Swarm cannot read.`
                  : `Swarm could not read ${site}. Try again later.`;
      return new AppError(422, 'URL_FETCH_FAILED', `${what} ${PASTE}`);
    }
  }
}

/** A file name for the document that cannot be anything but a name: letters, digits and a few marks. */
export function documentName(title: string | null, host: string): string {
  const raw = title ? `${host} - ${title}` : host;
  const cleaned = raw
    .replace(/[^\p{L}\p{M}\p{N} ._()-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .replace(/^[.\s-]+|[.\s-]+$/gu, '');
  return `${cleaned.slice(0, 100).trim() || 'web page'}.txt`;
}

interface Text {
  content: string;
  readableChars: number;
  truncated: boolean;
  title: string | null;
  structured: boolean;
}

function textOf(page: FetchedPage): Text {
  if (page.contentType === 'text/html' || page.contentType === 'application/xhtml+xml') {
    const extracted = extractPage(page.text);
    const document = pageDocument(extracted);
    return {
      content: document.text,
      readableChars: document.readableChars,
      truncated: document.truncated,
      title: extracted.title,
      structured: extracted.structured.length > 0,
    };
  }
  const plain =
    page.contentType === 'application/json'
      ? jsonToText(page.text)
      : page.contentType === 'text/csv'
        ? csvToText(page.text)
        : { text: plainToText(page.text), truncated: false };
  const fitted = fit(plain.text, MAX_DOCUMENT_CHARS);
  return {
    content: fitted.text,
    readableChars: plain.text.length,
    truncated: plain.truncated || fitted.truncated,
    title: null,
    structured: false,
  };
}

/**
 * Reads a public page for a person and returns it as a document they can add to a project, with
 * where it came from. The page is untrusted data from start to end: it is fetched by the safe
 * fetcher, turned into text without running anything, and handed back as text. Whatever it says,
 * it is evidence to read, never an instruction; text that reads like an instruction to an AI is
 * kept and reported in the notes.
 */
export async function ingestUrl(
  fetcher: PublicFetcher,
  input: string,
  settings: UrlIngestSettings,
): Promise<UrlEvidence> {
  const policy = { allowedPorts: settings.allowedPorts, allowedHosts: settings.allowedHosts };
  let host: string | null = null;
  let page: FetchedPage;
  try {
    host = validateUrl(input, policy).hostname;
    page = await fetcher.fetchPublicPage(input, {
      ...policy,
      maxBytes: settings.maxBytes,
      timeoutMs: settings.timeoutMs,
    });
  } catch (error) {
    if (error instanceof UrlFailure) throw explain(error, host, settings);
    throw error;
  }
  const site = host ?? 'the site';

  let text: Text;
  try {
    text = textOf(page);
  } catch (error) {
    if (error instanceof DataError) {
      throw new AppError(422, 'URL_NO_TEXT', `${error.message} ${PASTE}`);
    }
    throw error;
  }
  if (text.readableChars < MIN_CHARS) {
    throw explain(new UrlFailure('no-text', 'There is too little text.'), host, settings);
  }

  const content = text.content.trim();
  const provenance = buildProvenance({
    url: page.url,
    finalUrl: page.finalUrl,
    contentType: page.contentType,
    text: content,
    title: text.title,
  });
  const candidate = { name: documentName(text.title, site), content, provenance };
  if (!documentInputSchema.safeParse(candidate).success) {
    throw explain(new UrlFailure('no-text', 'The text is not a usable document.'), host, settings);
  }

  const notes = [
    `Retrieved public evidence: what the page said when Swarm read it${
      provenance.retrievedAt ? ` on ${provenance.retrievedAt.slice(0, 10)}` : ''
    }. Swarm has not checked that it is true.`,
  ];
  if (text.truncated) {
    notes.push(
      `The page was longer than a document can be (${MAX_DOCUMENT_CHARS.toLocaleString('en-US')} characters), so only the beginning was kept. The text says so.`,
    );
  }
  if (text.structured) {
    notes.push(
      'Facts the page publishes for machines (structured data) are listed at the end, labelled as such.',
    );
  }
  const finalHost = hostOf(page.finalUrl);
  if (finalHost && finalHost !== host)
    notes.push(`The address sent the reader on to ${finalHost}.`);
  if (inspectText(content).suspicious) {
    notes.push(
      'This page contains text that reads like instructions to an AI system. Swarm keeps it as evidence to read and never follows it, but treat what the page says with care.',
    );
  }
  return { document: candidate, notes };
}

function hostOf(address: string): string | null {
  try {
    return new URL(address).hostname.replace(/\.$/u, '');
  } catch {
    return null;
  }
}
