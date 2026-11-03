import {
  researchSourceSchema,
  type AuthorityEstimate,
  type FetchErrorClass,
  type QuarantineReason,
  type ResearchSource,
  type RobotsDecision,
  type SourceCategory,
  type SourceOutcome,
} from '../../../../shared/research.js';
import { redactUrl, sha256 } from '../../ingest/url/provenance.js';
import { inline } from '../../ingest/url/text.js';
import type { ExtractionMethod } from '../extract/index.js';
import type { DiscoveredBy } from './types.js';

const MAX_ADDRESS = 2_048;
const NOT_AN_ADDRESS = '[not a valid address]';

/**
 * An address as it may be kept, shown and logged: no user name or password, no fragment, and the value of
 * every secret-looking query parameter replaced. A secret in the path cannot be told from the rest of it.
 */
export function safeAddress(address: string | null | undefined): string {
  const text = (address ?? '').trim().slice(0, 4 * MAX_ADDRESS);
  try {
    const url = new URL(text);
    url.username = '';
    url.password = '';
    url.hash = '';
    return redactUrl(url.href).slice(0, MAX_ADDRESS);
  } catch {
    return NOT_AN_ADDRESS;
  }
}

const safeOrNull = (address: string | null | undefined): string | null =>
  address ? safeAddress(address) : null;

const line = (text: string | null | undefined, max: number): string | null => {
  const clean = text ? inline(text).slice(0, max) : '';
  return clean || null;
};

export interface SourceDraft {
  requestedUrl: string;
  finalUrl?: string | null;
  canonicalUrl?: string | null;
  fetchedAt?: number | null;
  httpStatus?: number | null;
  contentType?: string | null;
  contentHash?: string | null;
  title?: string | null;
  category: SourceCategory;
  authority: AuthorityEstimate;
  relevance: string;
  publishedAt?: string | null;
  updatedAt?: string | null;
  author?: string | null;
  depth: number;
  parentUrl?: string | null;
  discoveredBy: DiscoveredBy;
  robots: RobotsDecision;
  outcome: SourceOutcome;
  quarantine?: { reason: QuarantineReason; detail: string } | null;
  failure?: { class: FetchErrorClass; message: string } | null;
  warnings?: readonly string[];
  bytes?: number;
  extractionMethod?: ExtractionMethod | null;
  passageCount?: number;
  injectionFlagged?: boolean;
  /** Makes the id of a second record of the same address and text differ from the first. */
  salt?: number;
}

/** The id of a source: stable for an address and the text that was read from it. */
export function sourceId(key: string, contentHash: string | null | undefined, salt = 0): string {
  return `rs-${sha256(`${key}\n${contentHash ?? ''}\n${salt}`).slice(0, 10)}`;
}

const iso = (at: number | null | undefined): string | null => {
  if (at === null || at === undefined || !Number.isFinite(at)) return null;
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/**
 * One record of what became of an address, in the shape `shared/research.ts` stores. Every field that
 * came from a site is cut to the length the contract allows and cleaned of characters that hide text;
 * a record that still does not fit the contract is replaced by a plain failure, never thrown.
 */
export function buildSource(draft: SourceDraft, key: string): ResearchSource {
  const requestedUrl = safeAddress(draft.requestedUrl);
  const candidate = {
    id: sourceId(key, draft.contentHash, draft.salt),
    requestedUrl,
    finalUrl: safeOrNull(draft.finalUrl),
    canonicalUrl: safeOrNull(draft.canonicalUrl),
    fetchedAt: iso(draft.fetchedAt),
    httpStatus:
      draft.httpStatus && draft.httpStatus >= 100 && draft.httpStatus <= 599
        ? draft.httpStatus
        : null,
    contentType: line(draft.contentType, 120),
    contentHash: draft.contentHash ?? null,
    title: line(draft.title, 300),
    retrievalMethod: 'http-get' as const,
    category: draft.category,
    authority: draft.authority,
    relevance: line(draft.relevance, 300) ?? '',
    publishedAt: draft.publishedAt ?? null,
    updatedAt: draft.updatedAt ?? null,
    author: line(draft.author, 160),
    depth: Math.max(0, Math.min(3, draft.depth)),
    parentUrl: safeOrNull(draft.parentUrl),
    discoveredBy: draft.discoveredBy,
    robots: draft.robots,
    outcome: draft.outcome,
    quarantine: draft.quarantine
      ? { reason: draft.quarantine.reason, detail: line(draft.quarantine.detail, 240) ?? '' }
      : null,
    failure: draft.failure
      ? { class: draft.failure.class, message: line(draft.failure.message, 240) ?? '' }
      : null,
    warnings: (draft.warnings ?? []).slice(0, 8).map((warning) => line(warning, 240) ?? ''),
    bytes: Math.max(0, Math.floor(draft.bytes ?? 0)),
    extractionMethod: draft.extractionMethod ?? null,
    documentId: null,
    passageCount: Math.max(0, draft.passageCount ?? 0),
    injectionFlagged: draft.injectionFlagged === true,
  };
  const parsed = researchSourceSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  return researchSourceSchema.parse({
    id: candidate.id,
    requestedUrl: requestedUrl.slice(0, MAX_ADDRESS),
    retrievalMethod: 'http-get',
    category: 'unclassified',
    authority: 'unknown',
    depth: candidate.depth,
    discoveredBy: draft.discoveredBy,
    robots: 'skipped',
    outcome: 'failed',
    failure: { class: 'unknown', message: 'The record of this address could not be kept in full.' },
  });
}
