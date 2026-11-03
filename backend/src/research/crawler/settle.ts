import type { FetchedPage } from '../../ingest/url/fetcher.js';
import {
  extractDocument,
  extractPdf,
  PdfUnavailable,
  type ExtractedDocument,
  type Extraction,
} from '../extract/index.js';
import { classifySource } from './classify.js';
import { judge, type Verdict } from './errors.js';
import type { Candidate } from './frontier.js';
import { followLinks } from './follow.js';
import { binaryAsText, quarantineOf, type Quarantine } from './quarantine.js';
import { whyRead, type CrawlRun } from './run.js';
import { bytesAreNotText, replacementShare } from './sniff.js';
import type { SourceDraft } from './source.js';
import { dedupeKey, registrableDomain, sameSite } from './urls.js';

const BINARY_SHARE = 0.2;

const askedNotToBeUsed = (): Verdict => ({
  errorClass: 'robots-disallowed',
  outcome: 'blocked',
  counts: false,
  safety: true,
  transient: false,
  reason: 'noai',
  robots: 'disallowed',
  quarantine: null,
  message: 'The page asks that AI systems do not use it, so it was set aside.',
  status: null,
  retryAfterMs: null,
});

async function read(
  run: CrawlRun,
  page: FetchedPage,
  now: number,
): Promise<Extraction | Quarantine> {
  const pdf = page.contentType === 'application/pdf';
  if (!pdf) {
    const kind =
      bytesAreNotText(page.body) ??
      (replacementShare(page.text) > BINARY_SHARE ? 'binary data' : null);
    if (kind) return binaryAsText(kind);
  }
  if (pdf && run.deps.pdf) {
    // The project's PDF reader takes one file at a time.
    return run.pdf(() =>
      extractPdf(page.body, run.deps.pdf!, { headers: page.headers }, undefined, run.signal),
    );
  }
  return extractDocument(
    {
      text: page.text,
      contentType: page.contentType,
      url: page.finalUrl,
      headers: page.headers,
      fetchedAt: now,
    },
    {
      signal: run.signal,
      sameSite: (address) => sameSite(address, page.finalUrl),
      ...(run.deps.extractLimits ? { limits: run.deps.extractLimits } : {}),
    },
  );
}

const isQuarantine = (value: Extraction | Quarantine): value is Quarantine => 'reason' in value;

/** What a page that was fetched becomes: evidence, a duplicate, or something set aside. */
export async function settle(
  run: CrawlRun,
  candidate: Candidate,
  page: FetchedPage,
): Promise<void> {
  const now = run.deps.now();
  run.used.pages += 1;
  run.used.bytes += page.bytes;
  run.emit({
    type: 'fetch-ok',
    url: candidate.url,
    finalUrl: page.finalUrl,
    status: page.status,
    contentType: page.contentType,
    bytes: page.bytes,
    redirects: page.redirects,
  });
  const finalKey = dedupeKey(page.finalUrl);
  run.frontier.mark(finalKey);
  const finalDomain = registrableDomain(new URL(page.finalUrl).hostname);
  run.domains.add(finalDomain);
  run.used.domains = run.domains.size;

  const draft = (more: Partial<SourceDraft>): SourceDraft => {
    const found = classifySource(page.finalUrl, run.classify);
    return {
      requestedUrl: candidate.url,
      finalUrl: page.finalUrl,
      fetchedAt: now,
      httpStatus: page.status,
      contentType: page.contentType,
      category: found.category,
      authority: found.authority,
      relevance: whyRead(candidate),
      depth: candidate.depth,
      parentUrl: candidate.parentUrl,
      discoveredBy: candidate.discoveredBy,
      robots: page.robots,
      outcome: 'read',
      bytes: page.bytes,
      ...more,
    };
  };
  const setAside = (reason: Quarantine, document?: ExtractedDocument): void => {
    run.used.quarantined += 1;
    run.record(
      draft({
        outcome: 'quarantined',
        quarantine: reason,
        ...(document
          ? {
              title: document.title,
              contentHash: document.contentHash,
              extractionMethod: document.method,
              injectionFlagged: document.injection.flaggedBlocks > 0,
              warnings: document.warnings,
            }
          : {}),
      }),
      finalKey,
    );
    run.emit({ type: 'quarantine', url: candidate.url, reason: reason.reason });
  };
  const duplicateOf = (
    of: string,
    by: 'canonical-url' | 'content-hash' | 'near-duplicate',
    document?: ExtractedDocument,
  ): void => {
    run.used.duplicates += 1;
    run.record(
      draft({
        outcome: 'duplicate',
        ...(document ? { title: document.title, contentHash: document.contentHash } : {}),
      }),
      finalKey,
    );
    run.emit({ type: 'duplicate', url: candidate.url, of, by });
  };

  // The page this address leads to is one that was read already, under another spelling.
  const alias = run.read.get(finalKey);
  if (alias !== undefined && finalKey !== candidate.key) {
    duplicateOf(alias, 'canonical-url');
    return;
  }

  let extraction: Extraction | Quarantine;
  try {
    extraction = await read(run, page, now);
  } catch (error) {
    if (run.signal.aborted) {
      run.recordVerdict(candidate, candidate.key, judge(null, { cancelled: true, now: 0 }));
      return;
    }
    if (error instanceof PdfUnavailable) {
      run.recordVerdict(candidate, candidate.key, {
        ...judge(null, { cancelled: false, now: now }),
        message: 'The PDF reader was busy, so the file was not read.',
      });
      return;
    }
    setAside({ reason: 'malformed', detail: 'The content could not be read.' });
    return;
  }
  if (isQuarantine(extraction)) {
    setAside(extraction);
    return;
  }
  const { document, signals } = extraction;
  if (document.robotsMeta.noai) {
    run.recordVerdict(candidate, candidate.key, askedNotToBeUsed());
    run.emit({
      type: 'fetch-blocked',
      url: candidate.url,
      errorClass: 'robots-disallowed',
      reason: 'noai',
    });
    return;
  }
  const markup = { schemaTypes: signals.schemaTypes, citationMeta: signals.citationMeta };
  const found = classifySource(page.finalUrl, run.classify, markup);
  const base: Partial<SourceDraft> = {
    title: document.title,
    canonicalUrl: document.canonicalUrl,
    contentHash: document.contentHash,
    category: found.category,
    authority: found.authority,
    publishedAt: document.publishedAt,
    updatedAt: document.updatedAt,
    author: document.author,
    extractionMethod: document.method,
    injectionFlagged: document.injection.flaggedBlocks > 0,
    warnings: [
      ...document.warnings,
      ...(document.robotsMeta.noindex
        ? ['The page asks not to be indexed by search engines.']
        : []),
      ...(document.robotsMeta.nofollow ? ['The page asks that its links are not followed.'] : []),
      ...(document.injection.flaggedBlocks > 0
        ? [
            'Its links were not followed, because it has text that reads like instructions to an AI.',
          ]
        : []),
    ],
  };

  const set = quarantineOf(extraction);
  if (set) {
    setAside(set, document);
    // A page with almost no text of its own can still be a list of places worth reading.
    if (set.reason === 'empty') followLinks(run, candidate, document);
    return;
  }
  const canonicalKey = document.canonicalUrl ? dedupeKey(document.canonicalUrl) : null;
  const canonicalRead =
    canonicalKey && canonicalKey !== finalKey ? run.read.get(canonicalKey) : undefined;
  if (canonicalRead !== undefined) {
    duplicateOf(canonicalRead, 'canonical-url', document);
    return;
  }
  const repeated = run.content.find(document.text, document.contentHash, finalDomain);
  if (repeated) {
    duplicateOf(repeated.url, repeated.by, document);
    return;
  }

  const source = run.record(
    draft({ ...base, outcome: 'used', passageCount: document.passages.length }),
    finalKey,
  );
  const crawled = { source, document };
  run.pages.push(crawled);
  run.lastPage = crawled;
  run.content.add(page.finalUrl, document.text, document.contentHash, finalDomain);
  // What a page says about itself (its canonical address) never keeps another address from being read:
  // only a page that was read under an address is a reason not to read that address again.
  run.read.set(finalKey, page.finalUrl);
  followLinks(run, candidate, document);
}
