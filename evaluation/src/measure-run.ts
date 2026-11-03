import { scoreDiversity } from './measure-sources.js';
import type { RunGold } from './ai-suite-data.js';

/**
 * What a whole research run is measured on, read from what it left: the record of the run, the
 * documents it added to the project, and the requests the fixture web saw. Everything is plain data
 * and the harness's own comparison; nothing here runs a crawl.
 */

export interface SourceView {
  id: string;
  requestedUrl: string;
  finalUrl: string | null;
  outcome: string;
  quarantine: string | null;
  failure: string | null;
  category: string;
  authority: string;
  documentId: string | null;
  contentHash: string | null;
  /** The last warning of the source: for a page read and not used, the reason. */
  note: string;
}

export interface DocumentView {
  id: string;
  /** The address the document was read from, from its provenance. */
  address: string | null;
  text: string;
  sha256: string | null;
  /** Evidence passages the project holds of it. */
  passages: number;
}

export interface RunView {
  caseId: string;
  status: string;
  stop: string | null;
  used: { pages: number; domains: number; bytes: number; failures: number; duplicates: number };
  sources: SourceView[];
  documents: DocumentView[];
  /** The documents the project held before this run added any. */
  heldBefore: number;
  passageSourceIds: string[];
  planOrigin: string | null;
  suggested: string[];
  /** Requests the fixture web saw while the run was carried out. */
  requests: { host: string; path: string }[];
}

/** The page a fixture page id stands for: its address, host and path. */
export interface WorldAddresses {
  urlOf(pageId: string): string;
}

const hostAndPath = (address: string): { host: string; path: string } | null => {
  try {
    const url = new URL(address);
    return { host: url.hostname, path: url.pathname };
  } catch {
    return null;
  }
};

const sameAddress = (a: string, b: string): boolean => {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.host === y.host && x.pathname === y.pathname && x.search === y.search;
  } catch {
    return false;
  }
};

/** What became of a source, in the words the gold uses. */
export function outcomeLabel(
  source: Pick<SourceView, 'outcome' | 'quarantine' | 'failure'>,
): string {
  if (source.outcome === 'quarantined') return `quarantined:${source.quarantine ?? 'none'}`;
  if (source.outcome === 'failed') return `failed:${source.failure ?? 'none'}`;
  return source.outcome;
}

/** The source a run recorded for a page: asked for under its address, or read from it after a redirect. */
export function sourceFor(sources: readonly SourceView[], address: string): SourceView | undefined {
  return (
    sources.find((source) => sameAddress(source.requestedUrl, address)) ??
    sources.find((source) => source.finalUrl !== null && sameAddress(source.finalUrl, address))
  );
}

export const MAX_DOCUMENTS = 10;
export const MAX_DOCUMENT_CHARS = 40_000;
export const MAX_TOTAL_CHARS = 200_000;

/** The limits of a project that the documents a run added break. */
export function limitProblems(
  added: readonly Pick<DocumentView, 'id' | 'text'>[],
  held = 0,
): string[] {
  const problems: string[] = [];
  if (held + added.length > MAX_DOCUMENTS)
    problems.push(`${held + added.length} documents, more than ${MAX_DOCUMENTS}`);
  for (const document of added) {
    if (document.text.length > MAX_DOCUMENT_CHARS)
      problems.push(`${document.id} has ${document.text.length} characters`);
  }
  const total = added.reduce((sum, document) => sum + document.text.length, 0);
  if (total > MAX_TOTAL_CHARS) problems.push(`${total} characters in all`);
  return problems;
}

/** Where the record of a run and the project disagree. Empty when they agree. */
export function recordProblems(
  view: Pick<RunView, 'sources' | 'documents' | 'passageSourceIds' | 'heldBefore'>,
): string[] {
  const problems: string[] = [];
  const added = view.documents.slice(view.heldBefore);
  const used = view.sources.filter((source) => source.outcome === 'used');
  for (const source of used) {
    const document = added.find((candidate) => candidate.id === source.documentId);
    if (!document) problems.push(`${source.requestedUrl} is used and has no document`);
    else if (source.contentHash !== null && document.sha256 !== source.contentHash)
      problems.push(`${source.requestedUrl} and its document hold different text`);
  }
  for (const document of added) {
    if (!used.some((source) => source.documentId === document.id))
      problems.push(`${document.id} belongs to no used source`);
  }
  const ids = new Set(view.sources.map((source) => source.id));
  for (const id of view.passageSourceIds) {
    if (!ids.has(id))
      problems.push(`a passage names the source ${id}, which the run does not hold`);
  }
  return problems;
}

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

export interface RunChecks {
  caseId: string;
  checks: CheckResult[];
  /** The gold stop and what the run recorded; null for a run with no stop to judge. */
  stop: { gold: string; got: string | null; ok: boolean } | null;
  /** For a question-only run: did it end blocked, with the reason, with no request and no document. */
  discovery: { ok: boolean; detail: string } | null;
  outcomes: { page: string; gold: string; got: string; ok: boolean }[];
  /** Pages the gold names an outcome for that the run never asked for. */
  notReached: string[];
  opposing: { pair: [string, string]; read: boolean; kept: boolean }[];
  diversity: { domains: number; maxShare: number } | null;
  limits: string[];
  hostile: { page: string; governmentHigh: boolean }[];
  /** Hosts a run asked for that it should never have asked for. */
  requestedForbidden: string[];
  /** Pages the gold says were never to be fetched, that were. */
  fetchedForbidden: string[];
  consistency: string[];
}

const hostsRequested = (view: RunView): Set<string> =>
  new Set(view.requests.map((request) => request.host));

/** Compares a run with its gold, check by check. */
export function checkRun(
  caseId: string,
  gold: RunGold,
  view: RunView,
  world: WorldAddresses,
): RunChecks {
  const checks: CheckResult[] = [];
  const add = (name: string, ok: boolean, detail: string): void => {
    checks.push({ name, ok, detail });
  };
  const added = view.documents.slice(view.heldBefore);
  const sourceOf = (page: string): SourceView | undefined =>
    sourceFor(view.sources, world.urlOf(page));

  add(
    'status',
    view.status === gold.status,
    `the run is ${view.status}; the gold is ${gold.status}`,
  );
  const stop = gold.stop ? { gold: gold.stop, got: view.stop, ok: view.stop === gold.stop } : null;
  if (stop) add('stop', stop.ok, `stopped for ${stop.got ?? 'nothing'}; the gold is ${stop.gold}`);
  if (gold.requests !== undefined)
    add('requests', view.requests.length === gold.requests, `${view.requests.length} requests`);
  if (gold.documents !== undefined)
    add('documents', added.length === gold.documents, `${added.length} documents`);
  if (gold.documentsAtMost !== undefined)
    add('documentsAtMost', added.length <= gold.documentsAtMost, `${added.length} documents`);
  if (gold.charsAtMost !== undefined) {
    const chars = added.reduce((sum, document) => sum + document.text.length, 0);
    add('charsAtMost', chars <= gold.charsAtMost, `${chars} characters`);
  }
  if (gold.setAside !== undefined) {
    const aside = view.sources.filter((source) => source.outcome === 'read').length;
    add('setAside', aside === gold.setAside, `${aside} pages read and not used`);
  }
  if (gold.setAsideForSizeAtLeast !== undefined) {
    const aside = view.sources.filter(
      (source) => source.outcome === 'read' && /size limit/iu.test(source.note),
    ).length;
    add(
      'setAsideForSize',
      aside >= gold.setAsideForSizeAtLeast,
      `${aside} pages set aside for size`,
    );
  }
  if (gold.pagesRead !== undefined)
    add('pagesRead', view.used.pages === gold.pagesRead, `${view.used.pages} pages fetched`);
  if (gold.pagesAtLeast !== undefined)
    add('pagesAtLeast', view.used.pages >= gold.pagesAtLeast, `${view.used.pages} pages fetched`);
  if (gold.pagesAtMost !== undefined)
    add('pagesAtMost', view.used.pages <= gold.pagesAtMost, `${view.used.pages} pages fetched`);
  if (gold.domainsAtMost !== undefined)
    add('domainsAtMost', view.used.domains <= gold.domainsAtMost, `${view.used.domains} sites`);
  if (gold.bytesAtMost !== undefined)
    add('bytesAtMost', view.used.bytes <= gold.bytesAtMost, `${view.used.bytes} bytes`);
  if (gold.failedAtLeast !== undefined)
    add(
      'failedAtLeast',
      view.used.failures >= gold.failedAtLeast,
      `${view.used.failures} failures`,
    );
  if (gold.duplicatesAtLeast !== undefined)
    add(
      'duplicatesAtLeast',
      view.used.duplicates >= gold.duplicatesAtLeast,
      `${view.used.duplicates} duplicates`,
    );
  if (gold.plan !== undefined)
    add('plan', view.planOrigin === gold.plan, `the plan is from ${view.planOrigin ?? 'nowhere'}`);
  if (gold.suggestionShown !== undefined)
    add(
      'suggestionShown',
      view.suggested.includes(gold.suggestionShown),
      `suggested: ${view.suggested.join(', ') || 'nothing'}`,
    );

  const outcomes: RunChecks['outcomes'] = [];
  const notReached: string[] = [];
  for (const [page, wanted] of Object.entries(gold.outcomes ?? {})) {
    const source = sourceOf(page);
    if (!source) {
      notReached.push(page);
      continue;
    }
    const got = outcomeLabel(source);
    outcomes.push({ page, gold: wanted, got, ok: got === wanted });
  }

  const fetchedForbidden = (gold.notFetched ?? []).filter((page) => {
    const place = hostAndPath(world.urlOf(page));
    return (
      place !== null &&
      view.requests.some((request) => request.host === place.host && request.path === place.path)
    );
  });
  if (gold.notFetched !== undefined)
    add(
      'notFetched',
      fetchedForbidden.length === 0,
      `asked for ${fetchedForbidden.join(', ') || 'none'}`,
    );

  const requested = hostsRequested(view);
  const requestedForbidden = (gold.neverRequestedHosts ?? []).filter((host) => requested.has(host));
  if (gold.neverRequestedHosts !== undefined)
    add(
      'neverRequested',
      requestedForbidden.length === 0,
      `asked for ${requestedForbidden.join(', ') || 'none'}`,
    );

  const opposing = (gold.opposing ?? []).map((pair) => {
    const [a, b] = pair.map(sourceOf) as [SourceView | undefined, SourceView | undefined];
    const read =
      a !== undefined &&
      b !== undefined &&
      [a, b].every((s) => s.outcome === 'used' || s.outcome === 'read');
    const kept = read && a?.outcome === 'used' && b?.outcome === 'used';
    return { pair, read, kept };
  });

  let diversity: RunChecks['diversity'] = null;
  if (gold.diversity) {
    const byDocument = new Map(added.map((document) => [document.id, document]));
    const pages = view.sources
      .filter((source) => source.outcome === 'used' && source.documentId !== null)
      .map((source) => ({
        url: source.finalUrl ?? source.requestedUrl,
        passages: byDocument.get(source.documentId as string)?.passages ?? 0,
      }));
    const scores = scoreDiversity(pages);
    diversity = { domains: scores.domains, maxShare: scores.maxShare };
  }

  const hostile = (gold.hostileNeverGovernmentHigh ?? []).flatMap((page) => {
    const source = sourceOf(page);
    return source && source.outcome === 'used'
      ? [
          {
            page,
            governmentHigh:
              source.category === 'government-regulatory' && source.authority === 'high',
          },
        ]
      : [];
  });

  const discovery =
    gold.stop === 'discovery-unconfigured'
      ? {
          ok:
            view.status === 'blocked' &&
            view.stop === 'discovery-unconfigured' &&
            view.requests.length === 0 &&
            added.length === 0,
          detail: `${view.status}, ${view.stop ?? 'no stop'}, ${view.requests.length} requests, ${added.length} documents`,
        }
      : null;

  return {
    caseId,
    checks,
    stop: gold.stop === 'discovery-unconfigured' ? null : stop,
    discovery,
    outcomes,
    notReached,
    opposing,
    diversity,
    limits: limitProblems(added, view.heldBefore),
    hostile,
    requestedForbidden,
    fetchedForbidden,
    consistency: recordProblems(view),
  };
}
