import { gzipSync, deflateSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { crawl } from '../src/research/crawler/crawl.js';
import { systemDeps } from '../src/research/crawler/deps.js';
import { PublicPageFetcher } from '../src/research/crawler/fetch.js';
import { RESEARCH_USER_AGENT } from '../src/research/crawler/identity.js';
import type {
  CrawlEvent,
  CrawlInput,
  CrawlResult,
  CrawlTuning,
} from '../src/research/crawler/types.js';
import { makePdf } from './pdf-fixture.js';
import { prose, sitePage } from './support/research-pages.js';
import {
  A,
  budget,
  seedOf,
  trial,
  type Link,
  type Reply,
  type Route,
} from './support/research-world.js';
import { routes, send, startWorld, type SiteHandler, type World } from './support/research-net.js';

const worlds: World[] = [];
afterEach(async () => {
  await Promise.all(worlds.splice(0).map((world) => world.close()));
});
const open = async (sites: Record<string, SiteHandler>): Promise<World> => {
  const world = await startWorld(sites);
  worlds.push(world);
  return world;
};

const PAGE = sitePage({ title: 'A page', paragraphs: prose(21) });
const HOST = 'a.example.com';
const ROBOTS = 'User-agent: *\nAllow: /\n';

interface Outcome {
  result: CrawlResult;
  events: CrawlEvent[];
  ms: number;
}

/** The real crawler and fetcher, over real sockets to this machine, on the real clock, with limits small enough to meet. */
async function read(
  world: World,
  paths: string[],
  options: {
    tuning?: Partial<CrawlTuning>;
    changes?: Partial<CrawlInput['budget']>;
    signal?: AbortSignal;
  } = {},
): Promise<Outcome> {
  const events: CrawlEvent[] = [];
  const started = Date.now();
  const result = await crawl(
    {
      seeds: paths.map((path) => ({ url: world.url(HOST, path), discoveredBy: 'user-url' })),
      budget: budget({ maxBytesPerPage: 10_000, maxTotalBytes: 100_000, ...options.changes }),
      hints: { terms: [] },
      sameSiteOnly: false,
      signal: options.signal ?? new AbortController().signal,
      allowHttp: true,
    },
    systemDeps({
      fetcher: new PublicPageFetcher({
        seam: { lookup: world.lookup, allowPrivateForTests: true },
        allowedPorts: [world.port],
      }),
      onEvent: (event) => events.push(event),
      tuning: { maxRetries: 0, requestTimeoutMs: 1_500, idleMs: 400, ...options.tuning },
    }),
  );
  return { result, events, ms: Date.now() - started };
}

const site = (
  table: Record<string, string | Buffer | ((response: Parameters<SiteHandler>[1]) => void)>,
  types: Record<string, string> = {},
): Promise<World> =>
  open({
    [HOST]: routes({ '/robots.txt': ROBOTS, ...table }, { '/robots.txt': 'text/plain', ...types }),
  });

const sourceAt = (done: Outcome, path: string, world: World) =>
  done.result.sources.find(({ requestedUrl }) => requestedUrl === world.url(HOST, path))!;

describe('how much of a response is read', () => {
  it('refuses a body that says it is larger than the limit, without reading it', async () => {
    const world = await site({ '/big': 'x'.repeat(300_000) }, { '/big': 'text/html' });
    const done = await read(world, ['/big']);
    expect(sourceAt(done, '/big', world)).toMatchObject({
      outcome: 'quarantined',
      quarantine: { reason: 'oversized' },
      failure: { class: 'too-large' },
    });
    expect(done.result.used.bytes).toBe(0);
  });

  it('stops reading a body that does not say how long it is when it passes the limit, and closes the connection', async () => {
    let closed = false;
    const world = await site({
      '/endless': (response) => {
        response.writeHead(200, { 'content-type': 'text/html' });
        const timer = setInterval(() => response.write('x'.repeat(4_096)), 5);
        response.on('close', () => {
          closed = true;
          clearInterval(timer);
        });
      },
    });
    const done = await read(world, ['/endless']);
    expect(sourceAt(done, '/endless', world)).toMatchObject({
      outcome: 'quarantined',
      failure: { class: 'too-large' },
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(closed).toBe(true);
    expect(done.ms).toBeLessThan(4_000);
  });

  it('counts what a compressed body becomes, not what it was on the wire: a body of a few kilobytes that is millions when unpacked', async () => {
    const bomb = gzipSync(Buffer.alloc(6_000_000, 0x61));
    expect(bomb.length).toBeLessThan(10_000);
    const world = await site({
      '/bomb': (response) => send(response, bomb, 'text/html', 200, { 'content-encoding': 'gzip' }),
      '/deflate': (response) =>
        send(response, deflateSync(Buffer.alloc(6_000_000, 0x61)), 'text/html', 200, {
          'content-encoding': 'deflate',
        }),
    });
    const done = await read(world, ['/bomb', '/deflate']);
    for (const path of ['/bomb', '/deflate']) {
      expect(sourceAt(done, path, world), path).toMatchObject({
        outcome: 'quarantined',
        quarantine: { reason: 'oversized' },
        failure: { class: 'decompression-limit' },
      });
    }
    expect(done.result.used.bytes).toBe(0);
  });

  it('does not use a body that is compressed twice, labelled with an encoding it does not know, or damaged', async () => {
    const once = gzipSync(Buffer.from(PAGE));
    const world = await site({
      '/twice': (response) =>
        send(response, gzipSync(once), 'text/html', 200, { 'content-encoding': 'gzip, gzip' }),
      '/unknown': (response) =>
        send(response, Buffer.from(PAGE), 'text/html', 200, { 'content-encoding': 'zstd' }),
      '/damaged': (response) =>
        send(response, once.subarray(0, 20), 'text/html', 200, { 'content-encoding': 'gzip' }),
      '/liar': (response) => send(response, PAGE, 'text/html', 200, { 'content-encoding': 'gzip' }),
    });
    const done = await read(world, ['/twice', '/unknown', '/damaged', '/liar']);
    expect(done.result.pages).toHaveLength(0);
    expect(done.result.sources).toHaveLength(4);
  });

  it('reads a page that is compressed once and is within the limit, as it reads one that is not compressed', async () => {
    const world = await site({
      '/zipped': (response) =>
        send(response, gzipSync(Buffer.from(PAGE)), 'text/html', 200, {
          'content-encoding': 'gzip',
        }),
      '/plain': PAGE,
    });
    const done = await read(world, ['/zipped', '/plain'], {
      changes: { maxDuplicateRatio: 1 },
    });
    expect(done.result.sources.map(({ outcome }) => outcome).sort()).toEqual(['duplicate', 'used']);
  });
});

describe('what a response may be', () => {
  const table: [type: string, body: Buffer | string][] = [
    ['image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])],
    ['application/octet-stream', Buffer.from('MZ\u0000\u0000binary')],
    ['application/zip', Buffer.from([0x50, 0x4b, 0x03, 0x04, 20, 0])],
    ['video/mp4', Buffer.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70])],
    ['application/javascript', 'alert(1)'],
    ['text/css', 'body { color: red }'],
    ['font/woff2', Buffer.from('wOF2')],
    ['application/x-sh', '#!/bin/sh\nrm -rf /\n'],
    ['application/pdf', makePdf('A PDF with no reader to read it')],
    ['multipart/form-data', '--x\r\n'],
    ['application/x-msdownload', Buffer.from('MZ')],
  ];

  it.each(table)(
    'does not read %s, and says that the type is not one that is read',
    async (type, body) => {
      const world = await site({ '/file': body }, { '/file': type });
      const done = await read(world, ['/file']);
      expect(done.result.pages).toHaveLength(0);
      expect(sourceAt(done, '/file', world)).toMatchObject({
        outcome: 'quarantined',
        quarantine: { reason: 'unsupported-type' },
        failure: { class: 'unsupported-type' },
      });
    },
  );

  it('sets aside bytes that are not text when a response says that they are', async () => {
    const world = await site(
      {
        '/pdf': makePdf('Labelled as a web page'),
        '/zip': Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200, 7)]),
        '/elf': Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(200, 1)]),
        '/png': Buffer.concat([
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          Buffer.alloc(200, 3),
        ]),
        '/noise': Buffer.alloc(3_000, 0x80),
      },
      {
        '/pdf': 'text/html',
        '/zip': 'text/plain',
        '/elf': 'text/html; charset=utf-8',
        '/png': 'application/xhtml+xml',
        '/noise': 'text/html',
      },
    );
    const done = await read(world, ['/pdf', '/zip', '/elf', '/png', '/noise']);
    expect(done.result.pages).toHaveLength(0);
    for (const path of ['/pdf', '/zip', '/elf', '/png', '/noise']) {
      expect(sourceAt(done, path, world), path).toMatchObject({
        outcome: 'quarantined',
        quarantine: { reason: 'binary-as-text' },
      });
    }
  });
});

describe('a site that is slow, silent or hostile in how it answers', () => {
  it('gives up on a site that accepts the request and never answers, at the time limit of a request and not before', async () => {
    const world = await site({ '/hang': () => undefined });
    const done = await read(world, ['/hang'], { tuning: { requestTimeoutMs: 700 } });
    expect(sourceAt(done, '/hang', world)).toMatchObject({
      outcome: 'failed',
      failure: { class: 'timeout' },
    });
    expect(done.ms).toBeGreaterThanOrEqual(600);
    expect(done.ms).toBeLessThan(3_000);
  });

  it('gives up on a body that arrives a byte at a time, however steadily the bytes arrive', async () => {
    const world = await site({
      '/drip': (response) => {
        response.writeHead(200, { 'content-type': 'text/html' });
        const timer = setInterval(() => response.write('x'), 40);
        response.on('close', () => clearInterval(timer));
      },
    });
    const done = await read(world, ['/drip'], { tuning: { requestTimeoutMs: 800, idleMs: 300 } });
    expect(sourceAt(done, '/drip', world)).toMatchObject({
      outcome: 'failed',
      failure: { class: 'timeout' },
    });
    expect(done.ms).toBeLessThan(3_500);
  });

  it('gives up on a body that stops in the middle', async () => {
    const world = await site({
      '/stall': (response) => {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.write('<html><body>a few words');
      },
    });
    const done = await read(world, ['/stall'], {
      tuning: { requestTimeoutMs: 3_000, idleMs: 300 },
    });
    expect(sourceAt(done, '/stall', world).outcome).toBe('failed');
    expect(done.ms).toBeLessThan(3_500);
  });

  it('refuses a response whose headers are far larger than any real one', async () => {
    const world = await site({
      '/headers': (response) => {
        response.setHeader('x-padding', 'a'.repeat(60_000));
        send(response, PAGE);
      },
    });
    const done = await read(world, ['/headers']);
    expect(done.result.pages).toHaveLength(0);
    expect(sourceAt(done, '/headers', world).outcome).toBe('failed');
  });

  it('stops at once when the person cancels, and closes the connection to a site that was still answering', async () => {
    let closed = false;
    const world = await site({
      '/hang': (response) => {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.write('<html>');
        response.on('close', () => {
          closed = true;
        });
      },
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 500);
    const done = await read(world, ['/hang'], { signal: controller.signal });
    expect(done.result.stoppedBecause).toBe('cancelled');
    expect(done.ms).toBeLessThan(2_500);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(closed).toBe(true);
  });
});

describe('what a request says about the crawler, and what it keeps from a site', () => {
  it('names itself, carries nothing of anyone’s, and keeps no cookie a site sets', async () => {
    const world = await site({
      '/one': (response) => {
        response.setHeader('set-cookie', ['sid=abc123; Path=/', 'track=1; Path=/']);
        send(response, sitePage({ title: 'One', paragraphs: prose(31) }));
      },
      '/two': sitePage({ title: 'Two', paragraphs: prose(32) }),
    });
    const done = await read(world, ['/one', '/two']);
    expect(done.result.pages).toHaveLength(2);
    const requests = world.seen[HOST]!;
    expect(requests.map((request) => request.url).sort()).toEqual(['/one', '/robots.txt', '/two']);
    for (const request of requests) {
      expect(request.headers['user-agent'], request.url).toBe(RESEARCH_USER_AGENT);
      for (const name of ['cookie', 'authorization', 'proxy-authorization', 'referer', 'origin']) {
        expect(request.headers[name], `${request.url} ${name}`).toBeUndefined();
      }
    }
  });
});

describe('a site that is built to keep a crawler busy', () => {
  /** Every address answers with a page of its own that links to thirty more, none of which has been seen. */
  const endless = (_call: number, url: string): Reply => {
    const id = [...url].reduce(
      (sum, character) => (sum * 31 + character.charCodeAt(0)) % 99_991,
      7,
    );
    const links: Link[] = Array.from({ length: 30 }, (_, index): Link => [
      `${new URL(url).origin}/n${id}-${index}`,
      `Page ${id}-${index}`,
    ]);
    return { body: sitePage({ title: `P${id}`, paragraphs: prose(id), links }) };
  };

  it('is read for no more pages than the budget allows, however many pages it offers', async () => {
    const done = await trial(
      { '*': endless },
      { input: { seeds: [seedOf(`${A}/`)], budget: { maxPages: 12, maxDepth: 3 } } },
    );
    expect(done.result.used.pages).toBe(12);
    expect(done.result.stoppedBecause).toBe('page-limit');
    expect(done.network.pagesAsked()).toHaveLength(12);
    expect(done.result.sources.length).toBeLessThan(200);
  });

  it('is not followed past the depth the budget allows', async () => {
    const done = await trial(
      { '*': endless },
      { input: { seeds: [seedOf(`${A}/`)], budget: { maxPages: 40, maxDepth: 1 } } },
    );
    expect(Math.max(...done.result.pages.map(({ source }) => source.depth))).toBe(1);
    // The page, and the 25 links that are taken from a page.
    expect(done.result.used.pages).toBe(26);
  });

  it('is not made to read a listing for ever, a calendar, a session at a time or an address that repeats itself', async () => {
    const traps = [
      '/calendar/2026/03',
      '/events/?month=2026-04',
      '/news/page/9/',
      '/news?page=30',
      '/search?q=ferry',
      '/a/b/a/b/a/b/a/b',
      '/x/x/x/x',
      '/feed/',
      '/cart/add?id=1',
    ];
    const links: Link[] = [...traps, '/real'].map((path): Link => [path, `Link ${path}`]);
    const routes: Record<string, Route> = {
      [`${A}/`]: { body: sitePage({ title: 'Home', paragraphs: prose(5), links }) },
      '*': endless,
    };
    const done = await trial(routes, { input: { seeds: [seedOf(`${A}/`)] } });
    expect(done.network.pagesAsked().slice(0, 2)).toEqual([`${A}/`, `${A}/real`]);
    for (const trap of traps) expect(done.network.pagesAsked()).not.toContain(`${A}${trap}`);
  });

  it('reads one page for the addresses of one page that differ only in a session or tracking', async () => {
    const links: Link[] = Array.from({ length: 200 }, (_, index): Link => [
      `/story?id=7&utm_campaign=c${index}&PHPSESSID=s${index}`,
      `Story ${index}`,
    ]);
    const done = await trial(
      {
        [`${A}/`]: { body: sitePage({ title: 'Home', paragraphs: prose(5), links }) },
        '*': endless,
      },
      { input: { seeds: [seedOf(`${A}/`)], budget: { maxDepth: 1 } } },
    );
    expect(done.network.pagesAsked().filter((url) => url.includes('/story'))).toHaveLength(1);
  });

  it('is read from a page with a very large number of links by looking at some of them, and queueing a few', async () => {
    const links: Link[] = Array.from({ length: 12_000 }, (_, index): Link => [
      `/p${index}`,
      `Page number ${index}`,
    ]);
    const done = await trial(
      {
        [`${A}/`]: { body: sitePage({ title: 'Home', paragraphs: prose(5), links }) },
        '*': endless,
      },
      { input: { seeds: [seedOf(`${A}/`)], budget: { maxPages: 5, maxDepth: 1 } } },
    );
    expect(done.result.used.pages).toBe(5);
    expect(done.result.sources.length).toBeLessThanOrEqual(200);
  });
});
