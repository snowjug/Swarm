import { describe, expect, it } from 'vitest';
import type { FetchedPage } from '../src/ingest/url/fetcher.js';
import { UrlFailure } from '../src/ingest/url/failure.js';
import type { CrawlState, PageFetcher } from '../src/research/crawler/types.js';
import { prose, sitePage } from './support/research-pages.js';
import {
  A,
  B,
  failedTrial,
  fan,
  htmlPage,
  seedOf as seed,
  trial,
  VirtualClock,
  type Link,
  type Reply,
  type Route,
  type Trial,
} from './support/research-world.js';

const C = 'https://c.example.net';
const read = (done: Trial) => done.network.pagesAsked();
const outcomes = (done: Trial) =>
  done.result.sources.map(({ requestedUrl, outcome }) => `${outcome} ${requestedUrl}`);

describe('page limit', () => {
  it('reads no more pages than the limit, and says that the limit was reached', async () => {
    const done = await trial(fan(8), {
      input: { seeds: [seed(`${A}/`)], budget: { maxPages: 3 } },
    });
    expect(read(done)).toEqual([`${A}/`, `${A}/p0`, `${A}/p1`]);
    expect(done.result.used.pages).toBe(3);
    expect(done.result.stoppedBecause).toBe('page-limit');
  });

  it('does not start more reads than the limit leaves room for, when several sites are read at once', async () => {
    const routes = { ...fan(2, A), ...fan(2, B), ...fan(2, C) };
    const done = await trial(routes, {
      input: {
        seeds: [seed(`${A}/`), seed(`${B}/`), seed(`${C}/`)],
        budget: { maxPages: 2, maxDomains: 3 },
      },
    });
    expect(read(done)).toHaveLength(2);
    expect(done.result.used.pages).toBe(2);
    expect(done.result.stoppedBecause).toBe('page-limit');
  });
});

describe('size limit', () => {
  // A page of exactly `bytes` bytes, so that the smallest limits the contract allows can be counted out in whole pages.
  const sized = (title: string, seedNumber: number, bytes: number, links: Link[] = []): Reply => {
    const plain = sitePage({ title, paragraphs: prose(seedNumber), links });
    const padding = bytes - Buffer.byteLength(plain) - '<!---->'.length;
    const body = sitePage({
      title,
      paragraphs: prose(seedNumber),
      links,
      head: `<!--${'x'.repeat(padding)}-->`,
    });
    expect(Buffer.byteLength(body)).toBe(bytes);
    return { type: 'text/html', body };
  };
  const links: Link[] = [0, 1, 2, 3].map((index): Link => [`/p${index}`, `Page ${index}`]);
  const pagesOf = (bytes: number): Record<string, Route> => ({
    [`${A}/`]: sized('Home', 1, bytes, links),
    ...Object.fromEntries(
      [0, 1, 2, 3].map((index) => [`${A}/p${index}`, sized(`P${index}`, 10 + index, bytes)]),
    ),
  });

  it('stops when what is left is too little to hold a page, without asking for another', async () => {
    const done = await trial(pagesOf(4_800), {
      input: {
        seeds: [seed(`${A}/`)],
        budget: { maxTotalBytes: 10_000, maxBytesPerPage: 10_000 },
      },
    });
    expect(done.result.stoppedBecause).toBe('byte-limit');
    expect(read(done)).toEqual([`${A}/`, `${A}/p0`]);
    expect(done.result.used.bytes).toBe(9_600);
  });

  it('asks for a page with no more room than is left, and stops when the page does not fit in it', async () => {
    const done = await trial(pagesOf(6_000), {
      input: {
        seeds: [seed(`${A}/`)],
        budget: { maxTotalBytes: 10_000, maxBytesPerPage: 10_000 },
      },
    });
    expect(done.result.stoppedBecause).toBe('byte-limit');
    expect(read(done)).toEqual([`${A}/`, `${A}/p0`]);
    expect(done.result.used.bytes).toBe(6_000);
    expect(done.result.sources[1]).toMatchObject({
      outcome: 'skipped',
      failure: { class: 'too-large' },
    });
  });

  it('does not stop for a page that is over the limit for one page, and reads on', async () => {
    const routes = pagesOf(3_000);
    routes[`${A}/p0`] = sized('Huge', 5, 12_000);
    const done = await trial(routes, {
      input: {
        seeds: [seed(`${A}/`)],
        budget: { maxTotalBytes: 50_000, maxBytesPerPage: 10_000 },
      },
    });
    expect(done.result.stoppedBecause).toBe('frontier-exhausted');
    expect(done.result.sources[1]).toMatchObject({
      outcome: 'quarantined',
      quarantine: { reason: 'oversized' },
    });
    expect(done.result.used.failures).toBe(1);
    expect(done.result.used.bytes).toBe(4 * 3_000);
  });
});

describe('time limit', () => {
  const slow = (count: number): Record<string, Route> => {
    const routes = fan(count);
    for (const [url, route] of Object.entries(routes)) {
      routes[url] = { ...(route as object), delayMs: 1_900 } as Route;
    }
    return routes;
  };

  it('stops at the limit, lets go of the page that was being read, and lists it as not read', async () => {
    const done = await trial(slow(5), {
      input: { seeds: [seed(`${A}/`)], budget: { maxElapsedMs: 5_000 } },
    });
    expect(done.result.stoppedBecause).toBe('time-limit');
    expect(done.result.used.elapsedMs).toBe(5_000);
    expect(done.result.used.pages).toBe(2);
    expect(outcomes(done)).toEqual([`used ${A}/`, `used ${A}/p0`, `skipped ${A}/p1`]);
    expect(done.result.sources[2]!.failure).toMatchObject({ class: 'cancelled' });
  });

  it('stops at the limit when a site never answers', async () => {
    const routes = slow(5);
    routes[`${A}/p0`] = { hang: true };
    const done = await trial(routes, {
      input: { seeds: [seed(`${A}/`)], budget: { maxElapsedMs: 5_000 } },
    });
    expect(done.result.stoppedBecause).toBe('time-limit');
    expect(done.result.used.elapsedMs).toBe(5_000);
    expect(outcomes(done)).toEqual([`used ${A}/`, `skipped ${A}/p0`]);
  });

  it('returns after a grace period even when the fetcher ignores being told to stop', async () => {
    const stuck: PageFetcher = { fetch: () => new Promise<FetchedPage>(() => undefined) };
    const done = await trial(
      { [`${A}/`]: htmlPage('Home', 1) },
      {
        input: { seeds: [seed(`${A}/`)], budget: { maxElapsedMs: 5_000 } },
        deps: { fetcher: stuck },
      },
    );
    expect(done.result.stoppedBecause).toBe('time-limit');
    expect(done.result.used.elapsedMs).toBeGreaterThanOrEqual(5_000);
    expect(done.result.used.elapsedMs).toBeLessThanOrEqual(7_000);
  });

  it('does not count the time that the crawl was paused for', async () => {
    const clock = new VirtualClock();
    let paused = 0;
    const done = await trial(fan(3), {
      clock,
      input: {
        seeds: [seed(`${A}/`)],
        budget: { maxElapsedMs: 5_000 },
        pause: {
          async waitIfPaused(signal) {
            paused += 1;
            if (paused === 2) await clock.sleep(60_000, signal);
          },
        },
      },
    });
    expect(done.result.stoppedBecause).toBe('frontier-exhausted');
    expect(done.result.used.pages).toBe(4);
    expect(done.result.used.elapsedMs).toBeLessThan(5_000);
    expect(clock.now() - 1_800_000_000_000).toBeGreaterThanOrEqual(60_000);
  });
});

describe('failure limit', () => {
  it('stops when more requests have failed than the limit', async () => {
    const routes = fan(10);
    for (let index = 0; index < 10; index += 1) delete routes[`${A}/p${index}`];
    const done = await trial(routes, {
      input: { seeds: [seed(`${A}/`)], budget: { maxFailedRequests: 2 } },
    });
    expect(done.result.stoppedBecause).toBe('failure-limit');
    expect(done.result.used.failures).toBe(3);
    expect(read(done)).toEqual([`${A}/`, `${A}/p0`, `${A}/p1`, `${A}/p2`]);
  });

  it('does not count what a rule refused, which is not a failure of the site', async () => {
    const done = await trial(
      {},
      {
        input: {
          seeds: [seed('ftp://a.example.com/x'), seed('https://a.example.com:8443/')],
          budget: { maxFailedRequests: 0 },
        },
      },
    );
    expect(done.result.used.failures).toBe(0);
  });
});

describe('what ends a crawl that nothing is left to read for', () => {
  it('says the frontier is exhausted when every link was read', async () => {
    const done = await trial(fan(2), { input: { seeds: [seed(`${A}/`)] } });
    expect(done.result.stoppedBecause).toBe('frontier-exhausted');
  });

  it('says a safety rule blocked it when every address was refused by one, and asks for nothing', async () => {
    const done = await trial(
      {},
      {
        input: {
          seeds: [
            seed('ftp://a.example.com/x'),
            seed('https://169.254.169.254/latest/'),
            seed('https://localhost/'),
          ],
        },
      },
    );
    expect(done.result.stoppedBecause).toBe('safety-block');
    expect(done.network.calls).toHaveLength(0);
    expect(done.result.pages).toHaveLength(0);
    expect(done.result.sources).toHaveLength(3);
  });

  it('does not say so when one address was read', async () => {
    const done = await trial(fan(0), {
      input: { seeds: [seed(`${A}/`), seed('ftp://a.example.com/x')] },
    });
    expect(done.result.stoppedBecause).toBe('frontier-exhausted');
  });
});

describe('being told to stop', () => {
  it('stops for a reason that the caller gives, which is asked before every fetch and after every page', async () => {
    const seen: { pages: number; queued: number; last: string | null }[] = [];
    const done = await trial(fan(6), {
      input: {
        seeds: [seed(`${A}/`)],
        shouldStop: (state: CrawlState) => {
          seen.push({
            pages: state.pages.length,
            queued: state.queued,
            last: state.lastPage?.source.title ?? null,
          });
          const answer = state.pages.length >= 3 ? 'evidence-sufficient' : null;
          // Whatever a caller does with what it is shown must not change the crawl.
          (state.pages as unknown[]).push('x');
          (state.used as { pages: number }).pages = 99;
          return answer;
        },
      },
    });
    expect(done.result.stoppedBecause).toBe('evidence-sufficient');
    expect(done.result.pages).toHaveLength(3);
    expect(done.result.used.pages).toBe(3);
    expect(seen[0]).toEqual({ pages: 0, queued: 1, last: null });
    expect(seen.map((entry) => entry.last)).toContain('Home');
    expect(seen.map((entry) => entry.last)).toContain('P1');
  });

  it('passes on what a caller throws, after letting go of what was being read', async () => {
    const routes = { ...fan(2, A), ...fan(2, B) };
    routes[`${B}/`] = { hang: true };
    const failed = await failedTrial(routes, {
      input: {
        seeds: [seed(`${A}/`), seed(`${B}/`)],
        shouldStop: (state) => {
          if (state.pages.length >= 1) throw new Error('caller failed');
          return null;
        },
      },
    });
    expect(failed.error).toMatchObject({ message: 'caller failed' });
    expect(failed.network.inFlight).toBe(0);
  });

  it('refuses a budget that is not valid', async () => {
    await expect(
      trial(fan(1), { input: { seeds: [seed(`${A}/`)], budget: { maxPages: 0 } } }),
    ).rejects.toThrow();
    await expect(
      trial(fan(1), { input: { seeds: [seed(`${A}/`)], budget: { maxElapsedMs: Number.NaN } } }),
    ).rejects.toThrow();
  });
});

describe('cancelling', () => {
  it('stops at once when cancelled in the middle of a fetch, and reads nothing after', async () => {
    const controller = new AbortController();
    const routes = fan(4);
    routes[`${A}/p0`] = () => {
      controller.abort();
      return { hang: true };
    };
    const done = await trial(routes, {
      input: { seeds: [seed(`${A}/`)], signal: controller.signal },
    });
    expect(done.result.stoppedBecause).toBe('cancelled');
    expect(read(done)).toEqual([`${A}/`, `${A}/p0`]);
    expect(outcomes(done)).toEqual([`used ${A}/`, `skipped ${A}/p0`]);
  });

  it('stops at once when cancelled while waiting to try again', async () => {
    const controller = new AbortController();
    const clock = new VirtualClock();
    const routes = fan(2);
    routes[`${A}/p0`] = { fail: new UrlFailure('timeout', 'slow', {}) };
    const done = await trial(routes, {
      clock,
      random: () => 0.5,
      input: { seeds: [seed(`${A}/`)], signal: controller.signal },
      deps: {
        sleep: (ms, signal) => {
          if (ms === 375) controller.abort();
          return clock.sleep(ms, signal);
        },
      },
    });
    expect(done.result.stoppedBecause).toBe('cancelled');
    expect(done.network.asked(`${A}/p0`)).toBe(1);
    expect(done.result.sources.at(-1)).toMatchObject({ outcome: 'skipped' });
  });

  it('stops at once when cancelled while the crawl is paused', async () => {
    const controller = new AbortController();
    const done = await trial(fan(2), {
      input: {
        seeds: [seed(`${A}/`)],
        signal: controller.signal,
        pause: {
          waitIfPaused: (signal) =>
            new Promise<void>((_resolve, reject) => {
              signal.addEventListener('abort', () => reject(signal.reason), { once: true });
              queueMicrotask(() => controller.abort());
            }),
        },
      },
    });
    expect(done.result.stoppedBecause).toBe('cancelled');
    expect(done.network.calls).toHaveLength(0);
  });

  it('reads nothing when it was cancelled before it began', async () => {
    const controller = new AbortController();
    controller.abort();
    const done = await trial(fan(2), {
      input: { seeds: [seed(`${A}/`)], signal: controller.signal },
    });
    expect(done.result.stoppedBecause).toBe('cancelled');
    expect(done.network.calls).toHaveLength(0);
  });
});

describe('redirects and depth', () => {
  it('follows no redirect when the budget allows none, and records the page that redirected as failed', async () => {
    const routes: Record<string, Route> = {
      [`${A}/`]: { to: `${A}/landing` },
      [`${A}/landing`]: htmlPage('Landing', 2),
    };
    const done = await trial(routes, {
      input: { seeds: [seed(`${A}/`)], budget: { maxRedirects: 0 } },
    });
    expect(read(done)).toEqual([`${A}/`]);
    expect(done.result.sources[0]).toMatchObject({
      outcome: 'failed',
      failure: { class: 'redirect-refused' },
    });
  });

  it('keeps the depth of a page that a person named, and of the pages found from it', async () => {
    const routes: Record<string, Route> = {
      [`${A}/`]: htmlPage('Home', 1, [['/one', 'One']]),
      [`${A}/one`]: htmlPage('One', 2, [['/two', 'Two']]),
      [`${A}/two`]: htmlPage('Two', 3),
    };
    const done = await trial(routes, {
      input: { seeds: [seed(`${A}/`)], budget: { maxDepth: 2 } },
    });
    expect(done.result.pages.map(({ source }) => source.depth)).toEqual([0, 1, 2]);
    expect(done.result.pages.map(({ source }) => source.parentUrl)).toEqual([
      null,
      `${A}/`,
      `${A}/one`,
    ]);
  });
});
