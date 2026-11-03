import { describe, expect, it } from 'vitest';
import { UrlFailure } from '../src/ingest/url/failure.js';
import { Breakers } from '../src/research/crawler/breaker.js';
import { parseRetryAfter } from '../src/research/crawler/errors.js';
import { backoffMs } from '../src/research/crawler/retry.js';
import { DEFAULT_TUNING, type CrawlEvent } from '../src/research/crawler/types.js';
import {
  A,
  B,
  fan,
  htmlPage,
  seedOf as seed,
  trial,
  type Reply,
  type Route,
  type Trial,
} from './support/research-world.js';

const C = 'https://c.example.net';
const D = 'https://d.example.io';
const START = 1_800_000_000_000;

const withDelay = (routes: Record<string, Route>, delayMs: number): Record<string, Route> =>
  Object.fromEntries(
    Object.entries(routes).map(([url, route]) => [url, { ...(route as Reply), delayMs }]),
  );
const eventsOf = <T extends CrawlEvent['type']>(done: Trial, type: T) =>
  done.events.filter((event): event is Extract<CrawlEvent, { type: T }> => event.type === type);
const timesTo = (done: Trial, host: string): number[] =>
  done.network.calls.filter((call) => call.host === host).map((call) => call.at - START);

describe('how many requests are open at once', () => {
  it('reads several sites at the same time, up to three, and one request at a time to a site', async () => {
    const hosts = [A, B, C, D];
    const routes: Record<string, Route> = {};
    for (const host of hosts) Object.assign(routes, withDelay(fan(3, host), 400));
    const done = await trial(routes, {
      input: {
        seeds: hosts.map((host) => seed(`${host}/`)),
        budget: { maxDomains: 4, maxPages: 16 },
      },
    });
    expect(done.result.used.pages).toBe(16);
    expect(done.network.maxOpen).toBe(3);
    expect(done.network.maxOpenToHost).toBe(1);
  });

  it('reads one request at a time when it is told to', async () => {
    const hosts = [A, B];
    const routes: Record<string, Route> = {};
    for (const host of hosts) Object.assign(routes, withDelay(fan(2, host), 400));
    const done = await trial(routes, {
      input: { seeds: hosts.map((host) => seed(`${host}/`)), budget: { maxDomains: 2 } },
      tuning: { maxConcurrent: 1 },
    });
    expect(done.network.maxOpen).toBe(1);
  });
});

describe('the delay between requests to one site', () => {
  it('leaves the budget’s delay between the end of one request and the start of the next, robots.txt included', async () => {
    const done = await trial(withDelay(fan(3), 100), {
      input: { seeds: [seed(`${A}/`)], budget: { perDomainDelayMs: 1_000 } },
    });
    // robots.txt, the first page, and then each page, each after the delay.
    expect(timesTo(done, 'a.example.com')).toEqual([0, 1_000, 2_100, 3_200, 4_300]);
    expect(done.network.calls.map((call) => call.purpose)).toEqual([
      'robots',
      'page',
      'page',
      'page',
      'page',
    ]);
  });

  it('applies it to the pages a redirect leads to as well', async () => {
    const routes: Record<string, Route> = {
      [`${A}/`]: { to: `${A}/landing` },
      [`${A}/landing`]: htmlPage('Landing', 2),
    };
    const done = await trial(routes, {
      input: { seeds: [seed(`${A}/`)], budget: { perDomainDelayMs: 1_000 } },
    });
    expect(timesTo(done, 'a.example.com')).toEqual([0, 1_000, 2_000]);
    expect(done.result.used.pages).toBe(1);
  });

  it('does not make one site wait for another', async () => {
    const routes = { ...fan(1, A), ...fan(1, B) };
    const done = await trial(routes, {
      input: { seeds: [seed(`${A}/`), seed(`${B}/`)], budget: { perDomainDelayMs: 1_000 } },
    });
    expect(timesTo(done, 'a.example.com')).toEqual([0, 1_000, 2_000]);
    expect(timesTo(done, 'b.example.org')).toEqual([0, 1_000, 2_000]);
  });
});

describe('what a site asks for in its robots.txt', () => {
  const robots = (text: string): Record<string, Route> => ({
    [`${A}/robots.txt`]: { type: 'text/plain', body: text },
  });

  it('waits as long as the site asks for between requests, when that is longer than the budget’s delay', async () => {
    const done = await trial(
      { ...fan(2), ...robots('User-agent: *\nCrawl-delay: 3\n') },
      { input: { seeds: [seed(`${A}/`)] } },
    );
    expect(timesTo(done, 'a.example.com')).toEqual([0, 3_000, 6_000, 9_000]);
    expect(eventsOf(done, 'robots-decision')[0]).toMatchObject({
      decision: 'allowed',
      crawlDelayMs: 3_000,
    });
  });

  it('waits no more than the cap, whatever the site asks for', async () => {
    const done = await trial(
      { ...fan(1), ...robots('User-agent: *\nCrawl-delay: 3600\n') },
      { input: { seeds: [seed(`${A}/`)] } },
    );
    expect(timesTo(done, 'a.example.com')).toEqual([0, 10_000, 20_000]);
    expect(eventsOf(done, 'robots-decision')[0]).toMatchObject({ crawlDelayMs: 10_000 });
  });

  it('keeps the budget’s delay when the site asks for less, or asks something of another crawler', async () => {
    const less = await trial(
      { ...fan(1), ...robots('User-agent: *\nCrawl-delay: 0.1\n') },
      { input: { seeds: [seed(`${A}/`)], budget: { perDomainDelayMs: 1_000 } } },
    );
    expect(timesTo(less, 'a.example.com')).toEqual([0, 1_000, 2_000]);
    const other = await trial(
      { ...fan(1), ...robots('User-agent: otherbot\nCrawl-delay: 30\n') },
      { input: { seeds: [seed(`${A}/`)] } },
    );
    expect(timesTo(other, 'a.example.com')).toEqual([0, 250, 500]);
  });

  it('takes what the site says to this crawler over what it says to all', async () => {
    const done = await trial(
      {
        ...fan(1),
        ...robots(
          'User-agent: *\nCrawl-delay: 1\n\nUser-agent: SwarmLab-ResearchCrawler\nCrawl-delay: 2\n',
        ),
      },
      { input: { seeds: [seed(`${A}/`)] } },
    );
    expect(timesTo(done, 'a.example.com')).toEqual([0, 2_000, 4_000]);
  });

  it('does not fetch what the site disallows, and does not ask for it', async () => {
    const routes: Record<string, Route> = {
      ...fan(3),
      ...robots('User-agent: *\nDisallow: /p1\n'),
    };
    const done = await trial(routes, { input: { seeds: [seed(`${A}/`)] } });
    expect(done.network.pagesAsked()).toEqual([`${A}/`, `${A}/p0`, `${A}/p2`]);
    expect(
      done.result.sources.find(({ requestedUrl }) => requestedUrl === `${A}/p1`),
    ).toMatchObject({
      outcome: 'blocked',
      robots: 'disallowed',
      failure: { class: 'robots-disallowed' },
    });
  });

  it('reads one robots.txt for a site, however many of its pages are read', async () => {
    const done = await trial(fan(4), { input: { seeds: [seed(`${A}/`)] } });
    expect(done.network.calls.filter((call) => call.purpose === 'robots')).toHaveLength(1);
  });

  it('leaves a site alone whose robots.txt cannot be read, and tries none of its pages', async () => {
    const routes: Record<string, Route> = {
      ...fan(3),
      [`${A}/robots.txt`]: { status: 503, type: 'text/plain', body: 'down' },
    };
    const done = await trial(routes, { input: { seeds: [seed(`${A}/`)] } });
    expect(done.network.pagesAsked()).toEqual([]);
    expect(done.result.stoppedBecause).toBe('safety-block');
    expect(done.result.sources[0]).toMatchObject({
      outcome: 'blocked',
      robots: 'disallowed',
      failure: { class: 'robots-disallowed' },
    });
  });

  it('treats a robots.txt that is not there (4xx) as permission', async () => {
    const routes: Record<string, Route> = {
      ...fan(1),
      [`${A}/robots.txt`]: { status: 404, type: 'text/plain', body: 'no' },
    };
    const done = await trial(routes, { input: { seeds: [seed(`${A}/`)] } });
    expect(done.result.used.pages).toBe(2);
    expect(done.result.pages[0]!.source.robots).toBe('absent');
  });
});

describe('trying again', () => {
  const flaky =
    (failures: number, fail: Reply): Route =>
    (call) =>
      call <= failures ? fail : htmlPage('Page', 2);
  const site = (route: Route): Record<string, Route> => ({
    [`${A}/`]: htmlPage('Home', 1, [['/p0', 'Page']]),
    [`${A}/p0`]: route,
  });
  const retries = (done: Trial): number[] => eventsOf(done, 'retry').map((event) => event.delayMs);
  const timeout = (): Reply => ({ fail: new UrlFailure('timeout', 'slow') });

  it('waits longer after each failure, by amounts that come from the numbers it is given', async () => {
    const routes = site(flaky(2, timeout()));
    const half = await trial(routes, { input: { seeds: [seed(`${A}/`)] }, random: () => 0.5 });
    expect(retries(half)).toEqual([375, 750]);
    expect(half.network.asked(`${A}/p0`)).toBe(3);
    expect(half.result.pages.map(({ source }) => source.requestedUrl)).toContain(`${A}/p0`);
    expect(half.result.used.failures).toBe(2);
    const low = await trial(routes, { input: { seeds: [seed(`${A}/`)] }, random: () => 0 });
    expect(retries(low)).toEqual([250, 500]);
    const high = await trial(routes, {
      input: { seeds: [seed(`${A}/`)] },
      random: () => 0.9999999,
    });
    expect(retries(high)).toEqual([500, 1_000]);
    const again = await trial(routes, { input: { seeds: [seed(`${A}/`)] }, random: () => 0.5 });
    expect(JSON.stringify(again.events)).toBe(JSON.stringify(half.events));
  });

  it('never waits more than the ceiling', async () => {
    const done = await trial(site(flaky(6, timeout())), {
      input: { seeds: [seed(`${A}/`)], budget: { maxFailedRequests: 10 } },
      tuning: { maxRetries: 6, breakerThreshold: 10 },
      random: () => 0.5,
    });
    expect(retries(done)).toEqual([375, 750, 1_500, 3_000, 6_000, 6_000]);
  });

  it('gives up after the tries it is allowed, and says what the last failure was', async () => {
    const done = await trial(site({ fail: new UrlFailure('timeout', 'slow') }), {
      input: { seeds: [seed(`${A}/`)] },
    });
    expect(done.network.asked(`${A}/p0`)).toBe(3);
    expect(done.result.sources.at(-1)).toMatchObject({
      outcome: 'failed',
      failure: { class: 'timeout' },
    });
    expect(done.result.used.failures).toBe(3);
  });

  it('tries again for what may pass: a closed connection, a timeout, 408, 425, 429, 500, 502, 503, 504', async () => {
    const transient: Reply[] = [
      { fail: new UrlFailure('network', 'closed', { reason: 'closed' }) },
      ...[408, 425, 429, 500, 502, 503, 504].map((status) => ({ status, body: 'try later' })),
    ];
    for (const reply of transient) {
      const done = await trial(site(flaky(1, reply)), { input: { seeds: [seed(`${A}/`)] } });
      expect(done.network.asked(`${A}/p0`), JSON.stringify(reply)).toBe(2);
      expect(done.result.used.pages).toBe(2);
    }
  });

  it('does not try again for what does not pass: 4xx, a refused connection, a name that is not found, too many redirects, a file that is too big or the wrong type', async () => {
    const final: Reply[] = [
      ...[400, 401, 403, 404, 410, 451].map((status) => ({ status, body: 'no' })),
      { fail: new UrlFailure('network', 'refused', { reason: 'refused' }) },
      { fail: new UrlFailure('network', 'gone', { reason: 'dns' }) },
      { fail: new UrlFailure('redirects', 'loop') },
      { fail: new UrlFailure('size', 'big') },
      { fail: new UrlFailure('type', 'odd') },
    ];
    for (const reply of final) {
      const done = await trial(site(flaky(9, reply)), { input: { seeds: [seed(`${A}/`)] } });
      expect(done.network.asked(`${A}/p0`), JSON.stringify(reply)).toBe(1);
    }
  });

  it('waits as long as a site asks to be left, within the cap, and does not wait at all for longer', async () => {
    const wait = async (header: string) =>
      trial(
        site(flaky(1, { status: 429, headers: { 'retry-after': header }, body: 'slow down' })),
        {
          input: { seeds: [seed(`${A}/`)] },
        },
      );
    expect(retries(await wait('3'))).toEqual([3_000]);
    expect(retries(await wait('10'))).toEqual([10_000]);
    const over = await wait('11');
    expect(retries(over)).toEqual([]);
    expect(over.network.asked(`${A}/p0`)).toBe(1);
    expect(over.result.sources.at(-1)).toMatchObject({ outcome: 'failed', httpStatus: 429 });
    // A date is read as the time until it, from the moment the answer came (500 ms in: robots.txt, the first page, then this one).
    const date = await wait(new Date(START + 6_000).toUTCString());
    expect(retries(date)).toEqual([5_500]);
    expect(retries(await wait('soon'))).toEqual([375]);
  });

  it('does not try again when the failure limit would be passed, or when there is no time left for the wait', async () => {
    const limited = await trial(site(flaky(9, timeout())), {
      input: { seeds: [seed(`${A}/`)], budget: { maxFailedRequests: 1 } },
    });
    expect(limited.network.asked(`${A}/p0`)).toBe(2);
    const late = await trial(
      site(flaky(1, { status: 503, headers: { 'retry-after': '8' }, body: 'x' })),
      {
        input: { seeds: [seed(`${A}/`)], budget: { maxElapsedMs: 5_000 } },
      },
    );
    expect(late.network.asked(`${A}/p0`)).toBe(1);
  });

  it('keeps the host to itself while it waits to try again', async () => {
    const done = await trial(
      {
        ...site(flaky(1, timeout())),
        [`${A}/`]: htmlPage('Home', 1, [
          ['/p0', 'Page'],
          ['/p1', 'Other'],
        ]),
        [`${A}/p1`]: htmlPage('Other', 3),
      },
      { input: { seeds: [seed(`${A}/`)] } },
    );
    const asked = done.network.pagesAsked();
    // p0 is asked twice before p1 is asked once: nothing else is let onto the site in between.
    expect(asked).toEqual([`${A}/`, `${A}/p0`, `${A}/p0`, `${A}/p1`]);
  });
});

describe('the delay for an answer that is a number or a date', () => {
  it('reads seconds, dates and nothing else', () => {
    expect(parseRetryAfter('120', START)).toBe(120_000);
    expect(parseRetryAfter('0', START)).toBe(0);
    expect(parseRetryAfter(' 7 ', START)).toBe(7_000);
    for (const text of ['-5', '1.5', '1e3', '0x10', 'soon', '', '9999999', '5 seconds']) {
      expect(parseRetryAfter(text, START), text).toBeNull();
    }
    expect(parseRetryAfter(undefined, START)).toBeNull();
    expect(parseRetryAfter('Sun, 06 Nov 1994 08:49:37 GMT', START)).toBe(0);
    expect(parseRetryAfter(new Date(START + 90_000).toUTCString(), START)).toBe(90_000);
  });

  it('backs off exponentially from the base to the ceiling, with a random share taken off', () => {
    const at = (attempt: number, random: number) =>
      backoffMs(attempt, DEFAULT_TUNING, () => random);
    expect([0, 1, 2, 3, 4, 5, 6].map((attempt) => at(attempt, 1))).toEqual([
      500, 1_000, 2_000, 4_000, 8_000, 8_000, 8_000,
    ]);
    expect([0, 1, 2].map((attempt) => at(attempt, 0))).toEqual([250, 500, 1_000]);
    // A number outside [0, 1) cannot make the wait longer than the ceiling or negative.
    expect(at(0, 5)).toBeLessThanOrEqual(500);
    expect(at(0, -5)).toBeGreaterThanOrEqual(250);
    expect(at(0, Number.NaN)).toBeGreaterThanOrEqual(0);
  });
});

describe('leaving a site alone that keeps failing', () => {
  const failing = (): Record<string, Route> => {
    const routes = fan(8);
    for (let index = 0; index < 8; index += 1) {
      routes[`${A}/p${index}`] = {
        fail: new UrlFailure('network', 'refused', { reason: 'closed' }),
      };
    }
    return routes;
  };

  it('stops asking a site after it has failed several times in a row, and says so for every address it did not ask for', async () => {
    const done = await trial(failing(), {
      input: { seeds: [seed(`${A}/`)], budget: { maxFailedRequests: 50 } },
      tuning: { maxRetries: 0 },
    });
    // The page, then three that failed; the breaker opened on the third.
    expect(done.network.pagesAsked()).toEqual([`${A}/`, `${A}/p0`, `${A}/p1`, `${A}/p2`]);
    const opened = eventsOf(done, 'circuit-open');
    expect(opened[0]).toMatchObject({ host: 'a.example.com', failures: 3, reopensInMs: 30_000 });
    const skipped = done.result.sources.filter(({ outcome }) => outcome === 'skipped');
    expect(skipped).toHaveLength(5);
    for (const source of skipped) expect(source.failure).toMatchObject({ class: 'circuit-open' });
    expect(done.result.used.failures).toBe(3);
  });

  it('lets one request through after the cooldown, and trusts the site again when it answers', async () => {
    const routes: Record<string, Route> = {
      ...withDelay(fan(0, B), 3_000),
      [`${A}/`]: htmlPage('Home', 1, [
        ['/p0', 'Page 0'],
        ['/p1', 'Page 1'],
        ['/p2', 'Page 2'],
      ]),
      [`${B}/`]: { ...(htmlPage('Other', 2, [[`${A}/late`, 'Late']]) as Reply), delayMs: 3_000 },
      [`${A}/late`]: htmlPage('Late', 5),
    };
    for (let index = 0; index < 3; index += 1) {
      routes[`${A}/p${index}`] = {
        fail: new UrlFailure('network', 'closed', { reason: 'refused' }),
      };
    }
    routes[`${A}/p0`] = { fail: new UrlFailure('network', 'closed', { reason: 'closed' }) };
    routes[`${A}/p1`] = { fail: new UrlFailure('network', 'closed', { reason: 'closed' }) };
    routes[`${A}/p2`] = { fail: new UrlFailure('network', 'closed', { reason: 'closed' }) };
    const done = await trial(routes, {
      input: {
        seeds: [seed(`${A}/`), seed(`${B}/`)],
        budget: { maxDomains: 2, maxFailedRequests: 50 },
      },
      tuning: { maxRetries: 0, breakerCooldownMs: 1_000 },
    });
    expect(eventsOf(done, 'circuit-open')).toHaveLength(1);
    expect(done.network.pagesAsked()).toContain(`${A}/late`);
    expect(done.result.pages.map(({ source }) => source.requestedUrl)).toContain(`${A}/late`);
  });
});

describe('the breaker', () => {
  it('opens after the threshold, lets one probe through after the cooldown, and closes on its success or opens again on its failure', () => {
    let now = 0;
    const breakers = new Breakers(() => now, 3, 1_000);
    expect(breakers.check('h')).toMatchObject({ allowed: true, state: 'closed' });
    expect(breakers.failure('h')).toMatchObject({ opened: false, failures: 1 });
    expect(breakers.failure('h')).toMatchObject({ opened: false, failures: 2 });
    // A success in between starts the count again.
    breakers.success('h');
    expect(breakers.failure('h')).toMatchObject({ opened: false, failures: 1 });
    breakers.failure('h');
    expect(breakers.failure('h')).toMatchObject({ opened: true, failures: 3, reopensInMs: 1_000 });
    now = 400;
    expect(breakers.check('h')).toEqual({ allowed: false, state: 'open', reopensInMs: 600 });
    now = 1_000;
    // Half open: one request is the probe; others wait for its answer.
    expect(breakers.check('h')).toMatchObject({ allowed: true, state: 'half-open' });
    expect(breakers.check('h')).toMatchObject({ allowed: false, state: 'half-open' });
    // The probe fails: open again, with a new cooldown.
    expect(breakers.failure('h')).toMatchObject({ opened: true });
    now = 1_500;
    expect(breakers.check('h')).toMatchObject({ allowed: false, state: 'open', reopensInMs: 500 });
    now = 2_000;
    expect(breakers.check('h')).toMatchObject({ allowed: true, state: 'half-open' });
    breakers.success('h');
    expect(breakers.check('h')).toMatchObject({ allowed: true, state: 'closed' });
    expect(breakers.failure('h')).toMatchObject({ opened: false, failures: 1 });
  });

  it('keeps hosts apart, and frees the probe when a request said nothing about the host', () => {
    let now = 0;
    const breakers = new Breakers(() => now, 1, 1_000);
    breakers.failure('one');
    expect(breakers.check('two')).toMatchObject({ allowed: true, state: 'closed' });
    expect(breakers.check('one')).toMatchObject({ allowed: false });
    now = 1_000;
    expect(breakers.check('one')).toMatchObject({ allowed: true });
    breakers.neutral('one');
    expect(breakers.check('one')).toMatchObject({ allowed: true, state: 'half-open' });
  });
});
