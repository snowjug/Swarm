import { validateUrl, type ValidatedUrl } from '../../ingest/url/policy.js';
import { UrlFailure } from '../../ingest/url/failure.js';
import { robotsOrigin } from '../../ingest/url/fetcher.js';
import type { ExtractedDocument } from '../extract/index.js';
import { judge, type Verdict } from './errors.js';
import type { Candidate } from './frontier.js';
import type { CrawlRun, Origin } from './run.js';
import { cleanAddress, dedupeKey, registrableDomain } from './urls.js';

/** The most links of one page that are looked at, and the most refusals of its links that are kept. */
const LINKS_LOOKED_AT = 1_000;
const REFUSALS_KEPT_PER_PAGE = 3;
/** Seeds are explicit, and so are all looked at: but only so many are queued. */
const SEEDS_QUEUED = 100;

export type Vetted = { ok: true; validated: ValidatedUrl } | { ok: false; verdict: Verdict };

/**
 * Checks an address as written, before it is queued and again before anything is fetched: its scheme
 * (https unless the crawl reads http), user name, host, port and every other rule of the address
 * policy. A port other than the standard ones is read only when the fetcher was told to allow it. This
 * is the same check the fetcher makes; making it here too turns an address away before it takes a place.
 */
export function vet(run: CrawlRun, address: string): Vetted {
  try {
    const validated = validateUrl(address, {
      ...run.policy,
      httpsOnly: run.input.allowHttp !== true,
    });
    const explicit = new URL(validated.href).port;
    if (explicit !== '' && !run.extraPorts.has(Number(explicit))) {
      const failure = new UrlFailure('port', `Port ${explicit} is not one that may be read.`);
      return { ok: false, verdict: judge(failure, { cancelled: false, now: run.deps.now() }) };
    }
    return { ok: true, validated };
  } catch (error) {
    return { ok: false, verdict: judge(error, { cancelled: false, now: run.deps.now() }) };
  }
}

/** Turns an address away and says so: a record, and an event for the log. */
export function refuse(run: CrawlRun, origin: Origin, key: string, verdict: Verdict): void {
  run.recordVerdict(origin, key, verdict);
  run.emit({
    type: 'fetch-blocked',
    url: origin.url,
    errorClass: verdict.errorClass,
    reason: verdict.reason,
    resolved: verdict.resolved,
  });
}

function candidateOf(
  run: CrawlRun,
  validated: ValidatedUrl,
  origin: Origin,
  score: number,
  matched: string[],
): Omit<Candidate, 'seq'> {
  const url = cleanAddress(validated.href) ?? validated.href;
  return {
    url,
    key: dedupeKey(url),
    depth: origin.depth,
    parentUrl: origin.parentUrl,
    discoveredBy: origin.discoveredBy,
    score,
    matched,
    host: validated.hostname,
    domain: registrableDomain(validated.hostname),
    origin: robotsOrigin(validated),
  };
}

/**
 * Queues the addresses a person (or the caller) named. Each is judged first: one that a rule refuses is
 * recorded as refused, and costs nothing else. The sites of the ones that pass are the sites a crawl
 * that keeps to its own sites may read, and the sites that count as named for a primary source.
 */
export function admitSeeds(run: CrawlRun): void {
  const passed: { origin: Origin; validated: ValidatedUrl }[] = [];
  for (const seed of run.input.seeds) {
    const origin: Origin = {
      url: seed.url,
      depth: Math.max(0, Math.min(3, Math.floor(seed.depth ?? 0))),
      parentUrl: seed.parentUrl ?? null,
      discoveredBy: seed.discoveredBy,
    };
    const vetted = vet(run, seed.url);
    if (!vetted.ok) {
      refuse(run, origin, dedupeKey(seed.url), vetted.verdict);
      continue;
    }
    passed.push({ origin, validated: vetted.validated });
    const domain = registrableDomain(vetted.validated.hostname);
    run.allowedSites?.add(domain);
    if (
      seed.discoveredBy === 'user-url' ||
      seed.discoveredBy === 'user-domain' ||
      seed.discoveredBy === 'user-added'
    ) {
      run.named.add(domain);
    }
  }
  for (const { origin, validated } of passed.slice(0, SEEDS_QUEUED)) {
    const url = cleanAddress(validated.href) ?? validated.href;
    const { score, matched } = run.scorer.seed(url, origin.depth);
    run.frontier.add(candidateOf(run, validated, { ...origin, url }, score, matched));
  }
}

/**
 * Takes the links of a page that are worth reading next. A link is dropped when the page marks it
 * `nofollow`, `ugc` or `sponsored`, when it leaves the site in a crawl that keeps to it, when its
 * address is a trap or not a page, and when it scores too little; of the rest, the best few are queued.
 * A link that a rule of the address policy refuses is recorded (a few for each page), because a page
 * that links to an internal address is a thing a log should show.
 */
export function followLinks(run: CrawlRun, parent: Candidate, document: ExtractedDocument): void {
  if (parent.depth >= run.input.budget.maxDepth || document.robotsMeta.nofollow) return;
  const taken: { entry: Omit<Candidate, 'seq'>; at: number }[] = [];
  let refused = 0;
  document.links.slice(0, LINKS_LOOKED_AT).forEach((link, at) => {
    const address = cleanAddress(link.url);
    if (!address) return;
    const vetted = vet(run, address);
    const origin: Origin = {
      url: address,
      depth: parent.depth + 1,
      parentUrl: parent.url,
      discoveredBy: 'link',
    };
    if (!vetted.ok) {
      if (vetted.verdict.safety && refused < REFUSALS_KEPT_PER_PAGE) {
        refused += 1;
        refuse(run, origin, dedupeKey(address), vetted.verdict);
      }
      return;
    }
    const domain = registrableDomain(vetted.validated.hostname);
    if (run.allowedSites && !run.allowedSites.has(domain)) return;
    const key = dedupeKey(address);
    if (run.frontier.has(key)) return;
    const scored = run.scorer.link({
      url: address,
      text: link.text,
      rel: link.rel,
      inMain: link.inMain,
      depth: origin.depth,
    });
    if (!scored) return;
    taken.push({
      entry: candidateOf(run, vetted.validated, origin, scored.score, scored.matched),
      at,
    });
  });
  taken.sort((a, b) => b.entry.score - a.entry.score || a.at - b.at);
  for (const { entry } of taken.slice(0, run.tuning.linksPerPage)) run.frontier.add(entry);
}
