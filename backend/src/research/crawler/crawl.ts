import type { CrawlResult, CrawlDeps, CrawlInput } from './types.js';
import { researchBudgetSchema, type ResearchStopReason } from '../../../../shared/research.js';
import { admitSeeds, refuse } from './follow.js';
import type { Candidate } from './frontier.js';
import { alreadyRead, circuitOpen, domainLimit } from './errors.js';
import { CrawlRun, SMALLEST_ROOM } from './run.js';
import { readAddress } from './task.js';

/** The kinds of stop at which what is being read is let go of; for every other, what is begun is finished. */
const ABORTS_WORK: ReadonlySet<ResearchStopReason> = new Set(['cancelled', 'time-limit']);

/** How long what was told to stop is given to end before the crawl returns without it, in milliseconds. */
const GRACE_MS = 2_000;

/**
 * Turns an address away before it takes a place: a site the crawl has read as many of as it may, a
 * robots.txt that is known to forbid it, a host that is being left alone. Each is recorded, and none
 * costs a request. The order matters: the host's breaker lets one probe through when it is asked, so it
 * is asked last, and what is asked is then read.
 */
function admit(run: CrawlRun, candidate: Candidate): boolean {
  const { budget } = run.input;
  const origin = candidate;
  // A page read since this address was queued may have named it as its own: it is not asked for again.
  if (run.read.has(candidate.key)) {
    run.recordVerdict(origin, candidate.key, alreadyRead());
    run.emit({ type: 'skipped', url: candidate.url, reason: 'already-read' });
    return false;
  }
  if (!run.domains.has(candidate.domain) && run.domains.size >= budget.maxDomains) {
    run.domainLimitMet = true;
    run.recordVerdict(origin, candidate.key, domainLimit());
    run.emit({ type: 'skipped', url: candidate.url, reason: 'domain-limit' });
    return false;
  }
  const known = run.robots.get(candidate.origin);
  const path = ((): string => {
    const url = new URL(candidate.url);
    return `${url.pathname}${url.search}`;
  })();
  if (known === 'unavailable' || (typeof known === 'object' && !known.allows(path))) {
    const decision = known === 'unavailable' ? 'unavailable' : 'disallowed';
    run.emit({
      type: 'robots-decision',
      origin: candidate.origin,
      url: candidate.url,
      decision,
      cached: true,
      crawlDelayMs: run.crawlDelayMs(candidate.host),
    });
    refuseForRobots(run, candidate, decision);
    return false;
  }
  const open = run.breakers.check(candidate.host);
  if (!open.allowed) {
    run.recordVerdict(origin, candidate.key, circuitOpen());
    run.emit({
      type: 'circuit-open',
      host: candidate.host,
      failures: run.tuning.breakerThreshold,
      reopensInMs: open.reopensInMs,
      url: candidate.url,
    });
    return false;
  }
  // The breaker has let this one through, as the probe if it was open; the reading of it reports back.
  run.breakers.neutral(candidate.host);
  run.domains.add(candidate.domain);
  run.used.domains = run.domains.size;
  return true;
}

function refuseForRobots(
  run: CrawlRun,
  candidate: Candidate,
  decision: 'unavailable' | 'disallowed',
): void {
  refuse(run, candidate, candidate.key, {
    errorClass: 'robots-disallowed',
    outcome: 'blocked',
    counts: false,
    safety: true,
    transient: false,
    reason: decision === 'unavailable' ? 'robots-unavailable' : 'robots',
    robots: 'disallowed',
    quarantine: null,
    message:
      decision === 'unavailable'
        ? 'The site\u2019s robots.txt could not be read, so the page was not fetched.'
        : 'The site\u2019s robots.txt asks that this page is not fetched.',
    status: null,
    retryAfterMs: null,
  });
}

/** Starts reading what can be read now: the best address on a host that is free and has waited long enough. */
function start(run: CrawlRun, active: Set<Promise<void>>): void {
  const { budget } = run.input;
  while (run.stop === null && active.size < run.tuning.maxConcurrent) {
    // What is being read counts against the limits before it is read, so that they cannot be passed.
    if (run.used.pages + run.reservedPages >= budget.maxPages) return;
    const room = budget.maxTotalBytes - run.used.bytes - run.reservedBytes;
    if (room < SMALLEST_ROOM) return;
    const candidate = run.frontier.take(
      (next) => !run.activeHosts.has(next.host) && run.gate.readyIn(next.host) === 0,
    );
    if (!candidate) return;
    if (!admit(run, candidate)) continue;
    const maxBytes = Math.min(budget.maxBytesPerPage, room);
    run.activeHosts.add(candidate.host);
    run.reservedPages += 1;
    run.reservedBytes += maxBytes;
    const task: Promise<void> = readAddress(run, candidate, maxBytes).finally(() => {
      active.delete(task);
      run.activeHosts.delete(candidate.host);
      run.reservedPages -= 1;
      run.reservedBytes -= maxBytes;
    });
    active.add(task);
  }
}

/** The shortest time until something that is waiting could be read. */
function earliestReady(run: CrawlRun): number {
  let soonest = Number.POSITIVE_INFINITY;
  for (const host of run.frontier.hosts()) {
    if (run.activeHosts.has(host)) continue;
    soonest = Math.min(soonest, run.gate.readyIn(host));
  }
  return soonest;
}

async function pause(run: CrawlRun): Promise<void> {
  const gate = run.input.pause;
  if (!gate) return;
  const before = run.deps.now();
  try {
    await gate.waitIfPaused(run.signal);
  } finally {
    // Time spent paused is not time spent working, and does not count against the time limit.
    run.pausedMs += Math.max(0, run.deps.now() - before);
  }
}

/** Waits until a read ends, the next place frees up, or the time limit comes. */
async function wait(run: CrawlRun, active: ReadonlySet<Promise<void>>): Promise<void> {
  const wake = new AbortController();
  const signal = AbortSignal.any([run.signal, wake.signal]);
  const timers: number[] = [Math.max(1, run.input.budget.maxElapsedMs - run.elapsed())];
  const ready = earliestReady(run);
  if (Number.isFinite(ready) && ready > 0) timers.push(ready);
  const sleeps = timers.map((ms) => run.deps.sleep(ms, signal).catch(() => undefined));
  try {
    await Promise.race([...active, ...sleeps]);
  } finally {
    wake.abort();
  }
}

/** Why the crawl ended when there was nothing left to read. */
function exhausted(run: CrawlRun): ResearchStopReason {
  if (run.domainLimitMet) return 'domain-limit';
  if (run.attempted > 0 && run.refusedBySafety === run.attempted) return 'safety-block';
  return 'frontier-exhausted';
}

async function loop(run: CrawlRun): Promise<void> {
  const active = new Set<Promise<void>>();
  try {
    for (;;) {
      run.stop = run.checkStops();
      if (run.stop) break;
      await pause(run);
      run.stop = run.checkStops();
      if (run.stop) break;
      start(run, active);
      if (active.size === 0 && (run.frontier.size === 0 || !Number.isFinite(earliestReady(run)))) {
        run.stop = exhausted(run);
        break;
      }
      await wait(run, active);
    }
  } catch (error) {
    if (!run.signal.aborted) {
      // Something the caller supplied failed: what is being read is let go of, and the failure is passed on.
      run.abort.abort(error);
      await ended(run, active);
      throw error;
    }
    run.stop ??= run.input.signal.aborted ? 'cancelled' : 'time-limit';
  }
  if (run.stop && ABORTS_WORK.has(run.stop)) run.abort.abort(new Error('The crawl has ended.'));
  await ended(run, active);
}

/**
 * Waits for what is being read to end. It ends by itself within its own time limits, or at once when it
 * was told to stop; a fetcher that does neither is not waited for beyond a grace period, so that a stuck
 * request cannot hold up the end of a crawl.
 */
async function ended(run: CrawlRun, active: ReadonlySet<Promise<void>>): Promise<void> {
  if (active.size === 0) return;
  const patience = run.signal.aborted ? GRACE_MS : run.tuning.requestTimeoutMs + GRACE_MS;
  const wake = new AbortController();
  const late = run.deps.sleep(patience, wake.signal).catch(() => undefined);
  try {
    await Promise.race([Promise.allSettled([...active]), late]);
  } finally {
    wake.abort();
  }
}

/**
 * Reads the web for a research run, within a budget, and says what it read and what became of every
 * address it tried. It is the whole of the crawling: which addresses are read, in what order, how
 * often, and when it stops are all decided here, by code, from the budget and from what the pages
 * link to. No page and no model decides any of it, and nothing a page says is an instruction.
 *
 * It reads no clock and no random number of its own: time, waiting, jitter and the fetcher are
 * `deps`. A crawl given the same fetcher, the same clock and the same numbers does the same things.
 * It throws only for a budget that is not valid, or when something the caller supplied (`shouldStop`,
 * the pause gate) throws; nothing a site does ends it that way.
 */
export async function crawl(input: CrawlInput, deps: CrawlDeps): Promise<CrawlResult> {
  const budget = researchBudgetSchema.parse(input.budget);
  const run = new CrawlRun({ ...input, budget }, deps);
  try {
    admitSeeds(run);
    await loop(run);
    const reason = run.stop ?? 'frontier-exhausted';
    run.used.elapsedMs = run.elapsed();
    run.emit({ type: 'budget-stop', reason });
    return {
      pages: [...run.pages],
      sources: [...run.sources],
      stoppedBecause: reason,
      used: { ...run.used },
    };
  } finally {
    run.close();
  }
}
