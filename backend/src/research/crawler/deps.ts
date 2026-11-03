import { randomUUID } from 'node:crypto';
import { PublicPageFetcher } from './fetch.js';
import type { CrawlDeps, PageFetcher } from './types.js';

/** Waits `ms` and resolves; rejects, and stops waiting, as soon as the signal is aborted. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', gone);
      resolve();
    }, ms);
    const gone = (): void => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', gone, { once: true });
  });
}

/**
 * The dependencies of a crawl in production: the real clock, real waiting, real randomness, and the
 * fetcher that reads the public web. This is the one place those are chosen; the crawl itself reads none
 * of them but through what it is given, which is what lets it be run, and tested, with others.
 */
export function systemDeps(
  options: Partial<Pick<CrawlDeps, 'onEvent' | 'traceId' | 'pdf' | 'tuning' | 'extractLimits'>> & {
    fetcher?: PageFetcher;
  } = {},
): CrawlDeps {
  const { fetcher, ...rest } = options;
  return {
    fetcher: fetcher ?? new PublicPageFetcher(),
    now: () => Date.now(),
    sleep,
    random: () => Math.random(),
    onEvent: () => undefined,
    traceId: randomUUID(),
    ...rest,
  };
}
