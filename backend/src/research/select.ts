import type {
  AuthorityEstimate,
  PassageLocation,
  ResearchPlan,
  ResearchSource,
  SourceCategory,
} from '../../../shared/research.js';
import { sourceProvenanceSchema, type SourceProvenance } from '../../../shared/scenario.js';
import {
  MAX_DOCUMENT_CHARS,
  MAX_DOCUMENTS,
  MAX_TOTAL_CHARS,
  type EvidenceChunk,
  type SourceDocument,
} from '../../../shared/types.js';
import { detectContradictions } from '../grounding/contradictions.js';
import { documentName } from '../ingest/url/ingest.js';
import { sha256 } from '../ingest/url/provenance.js';
import { chunkDocuments } from '../knowledge/retrieval.js';
import { registrableDomain } from './crawler/urls.js';
import type { CrawledPage } from './crawler/types.js';
import { addMasks, describeMasks, noMasks, redact, type MaskCounts } from './redact.js';
import { CONTROL, squeeze, termsOf } from './text.js';

// What a ranking is made of. They are numbers chosen once, here, and nothing a page says changes them.
const AUTHORITY: Record<AuthorityEstimate, number> = {
  high: 1,
  medium: 0.66,
  low: 0.33,
  unknown: 0.4,
};
const WEIGHT_AUTHORITY = 0.3;
const WEIGHT_RELEVANCE = 0.35;
/** The page a person named is the project's primary source, and is read first, so it is chosen first. */
const BONUS_NAMED = 0.3;
const WEIGHT_RECENCY: Record<ResearchPlan['timeSensitivity']['level'], number> = {
  none: 0.05,
  recent: 0.12,
  'fast-moving': 0.25,
};
const PENALTY_SAME_SITE = 0.12;
const PENALTY_SAME_CATEGORY = 0.08;
/** What keeps both sides of a disagreement: a page that conflicts with one already chosen is wanted. */
const BONUS_OPPOSING_PAIR = 0.3;
const BONUS_OPPOSES_CLAIM = 0.05;

const MIN_CONTENT_CHARS = 80;
/** A page that would have to be cut to less than this to fit is not taken: a stub is not a source. */
const MIN_PARTIAL_CHARS = 3_000;
/** Passages shorter than this are not compared for repeats: a short line repeated is a label, not a copy. */
const MIN_REPEAT_CHARS = 40;
/** The most text compared for disagreements while ranking: the check at the end reads what was kept. */
const MAX_COMPARE_CHARS = 600_000;
const SEPARATOR = '\n\n';
const NAMED_BY_PERSON: ReadonlySet<ResearchSource['discoveredBy']> = new Set([
  'user-url',
  'user-domain',
  'user-added',
]);

/** What the project already holds, so that a page already a source is not added again. */
export interface ExistingEvidence {
  documents: number;
  chars: number;
  /** Hashes of the text of each document, and of the page text a provenance recorded. */
  hashes: ReadonlySet<string>;
  /** Addresses the documents were read from, as their provenance keeps them. */
  addresses: ReadonlySet<string>;
}

export function existingEvidence(documents: readonly SourceDocument[]): ExistingEvidence {
  const hashes = new Set<string>();
  const addresses = new Set<string>();
  let chars = 0;
  for (const document of documents) {
    chars += document.content.length;
    hashes.add(document.provenance?.sha256 ?? sha256(document.content));
    for (const address of [document.provenance?.url, document.provenance?.finalUrl]) {
      if (address) addresses.add(address);
    }
  }
  return { documents: documents.length, chars, hashes, addresses };
}

export interface SelectionInput {
  /** The pages that were read and not set aside, in the order the crawl took them. */
  pages: readonly CrawledPage[];
  plan: Pick<
    ResearchPlan,
    'question' | 'entities' | 'topics' | 'claimsToVerify' | 'timeSensitivity'
  >;
  existing: ExistingEvidence;
  /** Sources that take the other side of a planned claim, which a ranking must not lose. */
  opposing: ReadonlySet<string>;
  /** Epoch milliseconds, for the age of a page. */
  now: number;
  /** For a test: fewer places, or less room, than a project has. */
  maxDocuments?: number;
  maxChars?: number;
}

/** What of a page becomes a document, and where in it each passage sits. */
export interface ChosenDocument {
  sourceId: string;
  document: { name: string; content: string; provenance: SourceProvenance };
  /** Where each passage the extractor found sits in `document.content`. */
  passages: { start: number; end: number; headingPath: string[]; kind: PassageLocation['kind'] }[];
  /** What a reader should know about how the page was kept, for the source's warnings. */
  notes: string[];
  masks: MaskCounts;
}

export interface SetAside {
  sourceId: string;
  /** `duplicate`: the project already holds this text. `read`: read, and not used. */
  outcome: 'read' | 'duplicate';
  reason: string;
}

export interface Selection {
  chosen: ChosenDocument[];
  setAside: SetAside[];
}

const REASON = {
  holds: 'The project already holds a source with this text.',
  tooMany: `The project holds at most ${MAX_DOCUMENTS} sources, and pages that ranked higher were used.`,
  full: `The project already holds ${MAX_DOCUMENTS} sources, the most it can.`,
  size: 'The size limit for the sources of a project was reached.',
  short: 'Too little text was left once repeated passages and page furniture were taken out.',
} as const;

// ---------------------------------------------------------------------------------------------
// Making a document of a page
// ---------------------------------------------------------------------------------------------

const JUNK =
  /^(?:skip to (?:the )?(?:main )?content|back to top|share(?: this)?|print(?: this)?|menu|search|sign in|log in|subscribe(?: to our newsletter)?|follow us|all rights reserved|cookie (?:settings|policy|preferences)|accept (?:all )?cookies|privacy policy|terms (?:of use|and conditions)|©.*)\.?$/iu;

/** A line of furniture the extractor left in, or a line with no letter in it. */
function isFurniture(text: string): boolean {
  const line = squeeze(text);
  if (line.includes('\n') || line.length > 80) return false;
  return !/\p{L}/u.test(line) || JUNK.test(line);
}

const repeatKey = (text: string): string =>
  squeeze(text.toLowerCase()).replace(/[^\p{L}\p{N} ]/gu, '');

interface Built {
  content: string;
  passages: ChosenDocument['passages'];
  keys: string[];
  repeated: number;
  furniture: number;
  masks: MaskCounts;
  /** Stopped before the end of the page, to fit. */
  cut: boolean;
}

/**
 * The text of a page as a project keeps it: its passages in order with the headings above them, minus
 * passages that repeat one already kept (here or in an earlier source) and lines of furniture, with what
 * should not be kept masked. Built from the passages, so that the place of each in the new text is known.
 */
function build(page: CrawledPage, seen: ReadonlySet<string>, limit: number): Built | null {
  const { text, passages } = page.document;
  const pieces: { text: string; place: ChosenDocument['passages'][number] | null }[] = [];
  const keys = new Set<string>();
  const masks = noMasks();
  let repeated = 0;
  let furniture = 0;
  let length = 0;
  let cut = false;

  const fit = (piece: string): boolean =>
    length + piece.length + (pieces.length > 0 ? SEPARATOR.length : 0) <= limit;
  const add = (piece: string, place: ChosenDocument['passages'][number] | null): void => {
    length += piece.length + (pieces.length > 0 ? SEPARATOR.length : 0);
    pieces.push({ text: piece, place });
  };
  const masked = (raw: string): string => {
    const found = redact(raw.replace(CONTROL, '').trim());
    addMasks(masks, found.counts);
    return found.text;
  };

  let cursor = 0;
  for (const passage of [...passages].sort((a, b) => a.start - b.start || a.end - b.end)) {
    if (passage.start < cursor) continue;
    const heading = text.slice(cursor, passage.start).replace(CONTROL, '').trim();
    const raw = text.slice(passage.start, passage.end);
    cursor = passage.end;
    if (isFurniture(raw)) {
      furniture += 1;
      continue;
    }
    const key = repeatKey(raw);
    if (key.length >= MIN_REPEAT_CHARS && (seen.has(key) || keys.has(key))) {
      repeated += 1;
      continue;
    }
    const body = masked(raw);
    if (body === '') continue;
    const lead = heading === '' ? '' : masked(heading);
    if (!fit(lead === '' ? body : `${lead}${SEPARATOR}${body}`)) {
      cut = true;
      break;
    }
    if (lead !== '') add(lead, null);
    add(body, { start: 0, end: 0, headingPath: passage.headingPath, kind: passage.kind });
    keys.add(key);
  }
  const tail = text.slice(cursor).replace(CONTROL, '').trim();
  if (!cut && tail !== '' && fit(tail)) add(tail, null);

  let offset = 0;
  const placed: ChosenDocument['passages'] = [];
  for (const piece of pieces) {
    if (piece.place) {
      placed.push({ ...piece.place, start: offset, end: offset + piece.text.length });
    }
    offset += piece.text.length + SEPARATOR.length;
  }
  const content = pieces.map((piece) => piece.text).join(SEPARATOR);
  if (content.length < MIN_CONTENT_CHARS) return null;
  return { content, passages: placed, keys: [...keys], repeated, furniture, masks, cut };
}

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

function notesOf(built: Built): string[] {
  const notes: string[] = [];
  if (built.repeated > 0) {
    notes.push(
      `${plural(built.repeated, 'passage that repeats', 'passages that repeat')} text already kept ${built.repeated === 1 ? 'was' : 'were'} left out.`,
    );
  }
  if (built.furniture > 0) {
    notes.push(
      `${plural(built.furniture, 'line of page furniture', 'lines of page furniture')} ${built.furniture === 1 ? 'was' : 'were'} left out.`,
    );
  }
  const masks = describeMasks(built.masks);
  if (masks) notes.push(masks);
  if (built.cut) {
    notes.push('Only the first part of the page was kept, to fit the size limit for sources.');
  }
  return notes;
}

const hostOf = (address: string | null): string => {
  try {
    return address ? new URL(address).hostname.replace(/^www\./u, '') : 'page';
  } catch {
    return 'page';
  }
};

function provenanceOf(source: ResearchSource, content: string): SourceProvenance {
  return sourceProvenanceSchema.parse({
    kind: 'url',
    url: source.requestedUrl,
    ...(source.finalUrl ? { finalUrl: source.finalUrl } : {}),
    ...(source.fetchedAt ? { retrievedAt: source.fetchedAt } : {}),
    ...(source.contentType ? { contentType: source.contentType } : {}),
    sha256: sha256(content),
    ...(source.title ? { title: source.title } : {}),
    ...((source.updatedAt ?? source.publishedAt)
      ? { asOf: source.updatedAt ?? source.publishedAt }
      : {}),
    fetchedByServer: true,
  });
}

// ---------------------------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------------------------

interface Candidate {
  page: CrawledPage;
  id: string;
  domain: string;
  category: SourceCategory;
  base: number;
  opposesClaim: boolean;
}

const DAY_MS = 86_400_000;

function recency(source: ResearchSource, now: number): number {
  const date = source.updatedAt ?? source.publishedAt;
  const at = date ? Date.parse(`${date}T00:00:00Z`) : Number.NaN;
  if (!Number.isFinite(at)) return 0.4;
  const years = Math.max(0, now - at) / (365.25 * DAY_MS);
  return years <= 1 ? 1 : years <= 3 ? 0.7 : years <= 6 ? 0.4 : 0.2;
}

function relevance(
  terms: ReadonlySet<string>,
  claims: readonly ReadonlySet<string>[],
  page: Set<string>,
): number {
  const covered =
    terms.size === 0 ? 0 : [...terms].filter((term) => page.has(term)).length / terms.size;
  const claimed = claims.reduce((best, claim) => {
    if (claim.size === 0) return best;
    return Math.max(best, [...claim].filter((term) => page.has(term)).length / claim.size);
  }, 0);
  return 0.6 * covered + 0.4 * claimed;
}

/** Which pairs of candidates disagree with each other (a different figure, a statement and its denial). */
function disagreements(pages: readonly CrawledPage[], now: number): Map<string, Set<string>> {
  const pairs = new Map<string, Set<string>>();
  if (pages.length < 2) return pairs;
  let room = MAX_COMPARE_CHARS;
  const documents: SourceDocument[] = [];
  for (const page of pages) {
    const { text } = page.document;
    if (text.length > room) continue;
    room -= text.length;
    documents.push({ id: page.source.id, name: page.source.id, content: text });
  }
  const link = (from: string, to: string): void => {
    const set = pairs.get(from) ?? new Set<string>();
    set.add(to);
    pairs.set(from, set);
  };
  for (const conflict of detectContradictions(chunkDocuments(documents), new Date(now))) {
    const [a, b] = [conflict.left.documentId, conflict.right.documentId];
    if (a === b) continue;
    link(a, b);
    link(b, a);
  }
  return pairs;
}

/**
 * Chooses which of the pages that were read become sources of the project. A project holds at most ten
 * documents and 200,000 characters, so a run that read more must choose, and what it chooses by is
 * stated here: how much authority the kind of site is estimated to have, how much of the plan a page
 * covers, how recent it is (as much as the plan says time matters), whether a person named it, and
 * spread: another page from a site or of a kind already chosen counts for less, and a page that
 * disagrees with one already chosen counts for more, so that both sides of a disagreement stay. Every
 * page that is not chosen stays on the run's list with the reason. Nothing a page says changes the
 * ranking, and the result is the same for the same pages in the same order.
 */
export function selectDocuments(input: SelectionInput): Selection {
  const documentLimit = input.maxDocuments ?? Math.max(0, MAX_DOCUMENTS - input.existing.documents);
  const charLimit = input.maxChars ?? Math.max(0, MAX_TOTAL_CHARS - input.existing.chars);
  const setAside: SetAside[] = [];

  const pages = input.pages.filter(({ source, document }) => {
    const address = source.finalUrl ?? source.requestedUrl;
    const held =
      input.existing.hashes.has(document.contentHash) ||
      input.existing.addresses.has(address) ||
      input.existing.addresses.has(source.requestedUrl);
    if (held) setAside.push({ sourceId: source.id, outcome: 'duplicate', reason: REASON.holds });
    return !held;
  });

  const planTerms = termsOf(
    [
      input.plan.question,
      ...input.plan.topics,
      ...input.plan.entities.map((entity) => entity.name),
    ].join(' '),
  );
  const claimTerms = input.plan.claimsToVerify.map((claim) => termsOf(claim.statement));
  const recencyWeight = WEIGHT_RECENCY[input.plan.timeSensitivity.level];
  const candidates: Candidate[] = pages.map((page) => {
    const { source } = page;
    const named = NAMED_BY_PERSON.has(source.discoveredBy) && source.depth === 0;
    return {
      page,
      id: source.id,
      domain: registrableDomain(hostOf(source.finalUrl ?? source.requestedUrl)),
      category: source.category,
      base:
        WEIGHT_AUTHORITY * AUTHORITY[source.authority] +
        WEIGHT_RELEVANCE * relevance(planTerms, claimTerms, termsOf(page.document.text)) +
        recencyWeight * recency(source, input.now) +
        (named ? BONUS_NAMED : 0),
      opposesClaim: input.opposing.has(source.id),
    };
  });
  const pairs = disagreements(pages, input.now);
  const sites = new Set(candidates.map((candidate) => candidate.domain)).size;
  const spread = sites > 1 ? 1 : 0.2;

  const chosen: ChosenDocument[] = [];
  const chosenIds: Candidate[] = [];
  const seen = new Set<string>();
  let chars = 0;
  let remaining = candidates;
  while (remaining.length > 0 && chosen.length < documentLimit) {
    const score = (candidate: Candidate): number =>
      candidate.base +
      (candidate.opposesClaim ? BONUS_OPPOSES_CLAIM : 0) -
      PENALTY_SAME_SITE *
        spread *
        chosenIds.filter((other) => other.domain === candidate.domain).length -
      PENALTY_SAME_CATEGORY *
        chosenIds.filter((other) => other.category === candidate.category).length +
      (chosenIds.some((other) => pairs.get(candidate.id)?.has(other.id)) ? BONUS_OPPOSING_PAIR : 0);
    const best = remaining.reduce((top, candidate) => {
      const difference = score(candidate) - score(top);
      return difference > 1e-12 || (Math.abs(difference) <= 1e-12 && candidate.id < top.id)
        ? candidate
        : top;
    });
    remaining = remaining.filter((candidate) => candidate !== best);
    const { source } = best.page;

    const room = charLimit - chars;
    const built =
      room >= MIN_CONTENT_CHARS ? build(best.page, seen, Math.min(MAX_DOCUMENT_CHARS, room)) : null;
    if (!built) {
      setAside.push({
        sourceId: source.id,
        outcome: 'read',
        reason: room < MIN_CONTENT_CHARS ? REASON.size : REASON.short,
      });
      continue;
    }
    if (built.cut && built.content.length < MIN_PARTIAL_CHARS) {
      setAside.push({ sourceId: source.id, outcome: 'read', reason: REASON.size });
      continue;
    }
    const provenance = provenanceOf(source, built.content);
    if (input.existing.hashes.has(provenance.sha256 ?? '')) {
      setAside.push({ sourceId: source.id, outcome: 'duplicate', reason: REASON.holds });
      continue;
    }
    chars += built.content.length;
    for (const key of built.keys) seen.add(key);
    chosenIds.push(best);
    chosen.push({
      sourceId: source.id,
      document: {
        name: documentName(source.title, hostOf(source.finalUrl ?? source.requestedUrl)),
        content: built.content,
        provenance,
      },
      passages: built.passages,
      notes: notesOf(built),
      masks: built.masks,
    });
  }
  for (const candidate of remaining) {
    setAside.push({
      sourceId: candidate.id,
      outcome: 'read',
      reason: charLimit <= 0 ? REASON.size : documentLimit <= 0 ? REASON.full : REASON.tooMany,
    });
  }
  return { chosen, setAside };
}

// ---------------------------------------------------------------------------------------------
// Where each passage of the project came from
// ---------------------------------------------------------------------------------------------

/**
 * For each evidence chunk of the documents that research added: where in its page it sat, as the part of
 * a page the chunk does not keep. A chunk takes the place of the passage it overlaps most; one that holds
 * only a heading takes the place of the passage after it, or before it when there is none.
 */
export function locatePassages(
  chunks: readonly EvidenceChunk[],
  chosen: readonly Pick<ChosenDocument, 'sourceId' | 'passages'>[],
  documentIds: ReadonlyMap<string, string>,
): Record<string, PassageLocation> {
  const located: Record<string, PassageLocation> = {};
  for (const item of chosen) {
    const documentId = documentIds.get(item.sourceId);
    if (documentId === undefined) continue;
    const places = [...item.passages].sort((a, b) => a.start - b.start);
    for (const chunk of chunks.filter((candidate) => candidate.documentId === documentId)) {
      let best: (typeof places)[number] | undefined;
      let most = 0;
      for (const place of places) {
        const overlap = Math.min(chunk.end, place.end) - Math.max(chunk.start, place.start);
        if (overlap > most) {
          best = place;
          most = overlap;
        }
      }
      best ??= places.find((place) => place.start >= chunk.end) ?? places[places.length - 1];
      located[chunk.id] = {
        sourceId: item.sourceId,
        headingPath: best
          ? best.headingPath.slice(0, 6).map((heading) => heading.slice(0, 160))
          : [],
        kind: best?.kind ?? 'paragraph',
      };
    }
  }
  return located;
}
