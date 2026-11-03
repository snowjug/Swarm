import { gzipSync } from 'node:zlib';
import { describe, expect, it, afterEach } from 'vitest';
import { UrlFailure, type UrlRefusal } from '../src/ingest/url/failure.js';
import {
  PublicFetcher,
  redirectTarget,
  robotsOrigin,
  type FetchHooks,
  type FetchOptions,
  type RobotsCache,
  type RobotsDecision,
} from '../src/ingest/url/fetcher.js';
import { validateUrl } from '../src/ingest/url/policy.js';
import { parseRobots } from '../src/ingest/url/robots.js';
import {
  fakeResolver,
  redirect,
  send,
  startWorld,
  v4,
  type World,
} from './support/research-net.js';

const worlds: World[] = [];
afterEach(async () => {
  await Promise.all(worlds.splice(0).map((world) => world.close()));
});
const open = async (...args: Parameters<typeof startWorld>): Promise<World> => {
  const world = await startWorld(...args);
  worlds.push(world);
  return world;
};

const PAGE = 'A page of plain text that is long enough to be read. '.repeat(4);
const failureOf = async (promise: Promise<unknown>): Promise<UrlFailure> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof UrlFailure) return error;
    throw error;
  }
  throw new Error('The page was read.');
};
const fetchFrom = (world: World, host: string, path: string, options: FetchOptions = {}) =>
  new PublicFetcher({ allowPrivateForTests: true, lookup: world.lookup }).fetchPublicPage(
    world.url(host, path),
    { allowedPorts: [world.port], ...options },
  );

describe('the identity a fetcher is given', () => {
  const ME = {
    userAgent: 'SwarmLab-ResearchCrawler/9.9.9 (research; honours robots.txt)',
    robotsToken: 'SwarmLab-ResearchCrawler',
  };

  it('sends its own user agent on the page and on robots.txt, and obeys the group that names its token', async () => {
    const world = await open({
      'a.example.com': (request, response) =>
        send(
          response,
          request.url === '/robots.txt'
            ? 'User-agent: *\nAllow: /\n\nUser-agent: SwarmLab-ResearchCrawler\nDisallow: /closed\nCrawl-delay: 3\n'
            : PAGE,
          'text/plain',
        ),
    });
    const cache: RobotsCache = new Map();
    const page = await fetchFrom(world, 'a.example.com', '/open', {
      identity: ME,
      robotsCache: cache,
    });
    expect(page.robots).toBe('allowed');
    expect(world.seen['a.example.com']!.map(({ headers }) => headers['user-agent'])).toEqual([
      ME.userAgent,
      ME.userAgent,
    ]);
    const failure = await failureOf(
      fetchFrom(world, 'a.example.com', '/closed/x', { identity: ME, robotsCache: cache }),
    );
    expect(failure.code).toBe('robots');
    // The evidence fetcher is a different crawler with a different name, and the same file allows it.
    const evidence = await fetchFrom(world, 'a.example.com', '/closed/x');
    expect(evidence.robots).toBe('allowed');
  });
});

describe('the address policy, for a caller that reads https only', () => {
  it('refuses http as written and as a redirect target, saying which rule did it', () => {
    expect(() => validateUrl('http://example.com/', { httpsOnly: true })).toThrow(
      expect.objectContaining({ code: 'blocked', detail: { refusal: 'http-not-allowed' } }),
    );
    expect(validateUrl('https://example.com/', { httpsOnly: true }).protocol).toBe('https:');
    const from = validateUrl('https://example.com/start', { httpsOnly: true });
    expect(() => redirectTarget(from, 'http://example.com/next', { httpsOnly: true })).toThrow(
      expect.objectContaining({
        code: 'blocked',
        detail: expect.objectContaining({ redirected: true }),
      }),
    );
  });

  it.each<[string, string, UrlRefusal | null]>([
    ['', 'invalid', 'empty'],
    ['ftp://example.com/file', 'invalid', 'scheme'],
    ['file:///etc/passwd', 'invalid', 'scheme'],
    ['data:text/html,<p>x</p>', 'invalid', 'scheme'],
    ['https://user:secret@example.com/', 'invalid', 'credentials'],
    ['https://exa mple.com/', 'invalid', 'control-characters'],
    ['https://2130706433/', 'blocked', 'ip-form'],
    ['https://0x7f.1/', 'blocked', 'ip-form'],
    ['https://intranet/', 'blocked', 'single-label'],
    ['https://printer.local/', 'blocked', 'internal-name'],
    ['https://metadata.google.internal/', 'blocked', 'internal-name'],
    ['https://example.com:8443/', 'port', null],
  ])('names the rule that refused %s', (address, code, refusal) => {
    let caught: unknown;
    try {
      validateUrl(address);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UrlFailure);
    expect((caught as UrlFailure).code).toBe(code);
    expect((caught as UrlFailure).detail.refusal ?? null).toBe(refusal);
  });

  it('says why an address a name resolved to was refused', async () => {
    const lookup = fakeResolver({
      'rebind.example.com': [v4('93.184.216.34'), v4('169.254.169.254')],
    });
    const failure = await failureOf(
      new PublicFetcher({ lookup }).fetchPublicPage('https://rebind.example.com/', {
        timeoutMs: 2_000,
      }),
    );
    expect(failure).toMatchObject({
      code: 'blocked',
      detail: { resolved: true, address: 'link-local' },
    });
  });
});

describe('Crawl-delay in robots.txt', () => {
  const delayOf = (text: string, token = 'SwarmLab-ResearchCrawler') =>
    parseRobots(text, token).crawlDelaySeconds;

  it('is read from the group that applies, named before everyone', () => {
    expect(delayOf('User-agent: *\nCrawl-delay: 5\n')).toBe(5);
    expect(
      delayOf(
        'User-agent: *\nCrawl-delay: 5\n\nUser-agent: swarmlab-researchcrawler\nCrawl-delay: 1.5\n',
      ),
    ).toBe(1.5);
    expect(delayOf('User-agent: SomeoneElse\nCrawl-delay: 9\n')).toBeNull();
    expect(delayOf('User-agent: *\nDisallow: /x\n')).toBeNull();
  });

  it.each(['soon', '-3', '1e9', '99999999', '', '4 seconds'])('ignores a delay of %j', (value) => {
    expect(delayOf(`User-agent: *\nCrawl-delay: ${value}\n`)).toBeNull();
  });

  it('does not let a delay with no group, or a later one in the same group, take over', () => {
    expect(delayOf('Crawl-delay: 4\nUser-agent: *\nDisallow: /x\n')).toBeNull();
    expect(delayOf('User-agent: *\nCrawl-delay: 2\nCrawl-delay: 8\n')).toBe(2);
  });
});

describe('robots.txt kept for a whole crawl', () => {
  it('is read once for an origin however many pages are fetched, and reported each time', async () => {
    const world = await open({
      'a.example.com': (request, response) =>
        send(
          response,
          request.url === '/robots.txt' ? 'User-agent: *\nDisallow: /private\n' : PAGE,
          'text/plain',
        ),
    });
    const cache: RobotsCache = new Map();
    const decisions: RobotsDecision[] = [];
    const hooks: FetchHooks = { onRobots: (decision) => decisions.push(decision) };
    const fetcher = new PublicFetcher({ allowPrivateForTests: true, lookup: world.lookup });
    const get = (path: string) =>
      fetcher.fetchPublicPage(world.url('a.example.com', path), {
        allowedPorts: [world.port],
        robotsCache: cache,
        hooks,
      });
    await get('/one');
    await get('/two');
    expect((await failureOf(get('/private/three'))).code).toBe('robots');
    expect(world.seen['a.example.com']!.filter(({ url }) => url === '/robots.txt')).toHaveLength(1);
    expect(
      decisions.map(({ decision, cached }) => `${decision}${cached ? ' (kept)' : ''}`),
    ).toEqual(['allowed', 'allowed (kept)', 'disallowed (kept)']);
    const key = robotsOrigin({ protocol: 'http:', hostname: 'a.example.com', port: world.port });
    expect(cache.get(key)).toMatchObject({ crawlDelaySeconds: null });
  });

  it('forbids the origin for the rest of the crawl when robots.txt could not be read, without asking again', async () => {
    const world = await open({
      'a.example.com': (request, response) =>
        request.url === '/robots.txt'
          ? send(response, 'down', 'text/plain', 503)
          : send(response, PAGE, 'text/plain'),
    });
    const cache: RobotsCache = new Map();
    const get = (path: string) => fetchFrom(world, 'a.example.com', path, { robotsCache: cache });
    for (const path of ['/one', '/two']) {
      expect(await failureOf(get(path))).toMatchObject({
        code: 'robots-unavailable',
        detail: { stage: 'robots' },
      });
    }
    expect(world.seen['a.example.com']).toHaveLength(1);
    expect([...cache.values()]).toEqual(['unavailable']);
  });

  it('marks a robots.txt that cannot be reached as the robots.txt, so that a caller does not retry the page', async () => {
    const world = await open({
      'a.example.com': (request, response) => {
        if (request.url === '/robots.txt') response.socket?.destroy();
        else send(response, PAGE, 'text/plain');
      },
    });
    const cache: RobotsCache = new Map();
    const failure = await failureOf(
      fetchFrom(world, 'a.example.com', '/page', { robotsCache: cache }),
    );
    expect(failure).toMatchObject({
      code: 'network',
      detail: { stage: 'robots', reason: 'closed' },
    });
    expect([...cache.values()]).toEqual(['unavailable']);
  });

  it('does not remember a stop as a verdict on the site', async () => {
    const world = await open({ 'a.example.com': () => undefined });
    const cache: RobotsCache = new Map();
    const failure = await failureOf(
      fetchFrom(world, 'a.example.com', '/page', { robotsCache: cache, timeoutMs: 150 }),
    );
    expect(failure.code).toBe('timeout');
    expect(cache.size).toBe(0);
  });
});

describe('hooks', () => {
  it('lets the caller hold each request, robots.txt first, and tells it when each has ended', async () => {
    const world = await open({
      'a.example.com': (request, response) =>
        send(
          response,
          request.url === '/robots.txt' ? 'User-agent: *\nAllow: /\n' : PAGE,
          'text/plain',
        ),
    });
    const log: string[] = [];
    const hooks: FetchHooks = {
      beforeRequest: async ({ host, purpose }) => {
        log.push(`hold ${purpose} ${host}`);
        return () => log.push(`release ${purpose}`);
      },
    };
    await fetchFrom(world, 'a.example.com', '/page', { hooks });
    expect(log).toEqual([
      'hold robots a.example.com',
      'release robots',
      'hold page a.example.com',
      'release page',
    ]);
  });

  it('does not count a wait to be let go against the time of the fetch', async () => {
    const world = await open({
      'a.example.com': (_request, response) => send(response, PAGE, 'text/plain'),
    });
    const hooks: FetchHooks = {
      beforeRequest: () => new Promise((resolve) => setTimeout(() => resolve(undefined), 350)),
    };
    const page = await fetchFrom(world, 'a.example.com', '/page', {
      hooks,
      respectRobots: false,
      timeoutMs: 250,
    });
    expect(page.text).toBe(PAGE);
  });

  it('still times out on the request itself, and gives the hold back', async () => {
    const world = await open({ 'a.example.com': () => undefined });
    let released = 0;
    const hooks: FetchHooks = { beforeRequest: async () => () => void (released += 1) };
    const failure = await failureOf(
      fetchFrom(world, 'a.example.com', '/page', { hooks, respectRobots: false, timeoutMs: 200 }),
    );
    expect(failure.code).toBe('timeout');
    expect(released).toBe(1);
  });

  it('gives a hold back that arrives after the fetch was stopped', async () => {
    const world = await open({
      'a.example.com': (_request, response) => send(response, PAGE, 'text/plain'),
    });
    const controller = new AbortController();
    let release!: () => void;
    let released = 0;
    const hooks: FetchHooks = {
      beforeRequest: () =>
        new Promise((resolve) => {
          release = () => resolve(() => void (released += 1));
          setTimeout(() => controller.abort(new Error('stopped')), 20);
        }),
    };
    const failure = await failureOf(
      fetchFrom(world, 'a.example.com', '/page', {
        hooks,
        respectRobots: false,
        signal: controller.signal,
      }),
    );
    expect(failure.detail.cancelled).toBe(true);
    release();
    await new Promise((resolve) => setImmediate(resolve));
    expect(released).toBe(1);
    expect(world.seen['a.example.com'] ?? []).toHaveLength(0);
  });

  it('lets the caller turn a redirect down before it is followed', async () => {
    const world = await open({
      'a.example.com': (_request, response) =>
        redirect(response, 'http://b.example.com:' + world.port + '/there'),
      'b.example.com': (_request, response) => send(response, PAGE, 'text/plain'),
    });
    const hops: string[] = [];
    const hooks: FetchHooks = {
      onRedirect: ({ from, to, status }) => {
        hops.push(`${status} ${from} -> ${to}`);
        return 'another site';
      },
    };
    const failure = await failureOf(
      fetchFrom(world, 'a.example.com', '/', { hooks, respectRobots: false }),
    );
    expect(failure).toMatchObject({
      code: 'blocked',
      detail: { refusal: 'caller', redirected: true },
    });
    expect(hops).toEqual([
      `302 ${world.url('a.example.com', '/')} -> ${world.url('b.example.com', '/there')}`,
    ]);
    expect(world.seen['b.example.com'] ?? []).toHaveLength(0);
  });
});

describe('what a caller can read of a response', () => {
  it('gets the bytes after decompression, and only a few headers, cut short', async () => {
    const world = await open({
      'a.example.com': (_request, response) => {
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-encoding': 'gzip',
          'content-language': 'fr',
          'x-robots-tag': 'noindex, nofollow',
          'last-modified': 'Tue, 03 Mar 2026 10:00:00 GMT',
          'set-cookie': 'session=abc',
          'x-secret': 'nope',
          link: `<https://example.com/a>; rel="canonical"${' '.repeat(5_000)}`,
        });
        response.end(gzipSync(Buffer.from(PAGE)));
      },
    });
    const page = await fetchFrom(world, 'a.example.com', '/', { respectRobots: false });
    expect(page.body.toString('utf8')).toBe(PAGE);
    expect(Object.keys(page.headers).sort()).toEqual([
      'content-language',
      'last-modified',
      'link',
      'x-robots-tag',
    ]);
    expect(page.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(page.headers.link!.length).toBeLessThanOrEqual(2_000);
  });

  it('gives the Retry-After of an error, cut short, for a caller to read and never to show', async () => {
    const world = await open({
      'a.example.com': (_request, response) =>
        send(response, 'slow down', 'text/plain', 429, {
          'retry-after': '7' + ' '.repeat(5) + '9'.repeat(200),
        }),
    });
    const failure = await failureOf(
      fetchFrom(world, 'a.example.com', '/', { respectRobots: false }),
    );
    expect(failure.detail.status).toBe(429);
    expect(failure.detail.retryAfter!.length).toBeLessThanOrEqual(80);
    expect(failure.detail.retryAfter!.startsWith('7')).toBe(true);
  });

  it('says that the output of a decompressor passed the limit, and not that the wire did', async () => {
    const world = await open({
      'bomb.example.com': (_request, response) => {
        response.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' });
        response.end(gzipSync(Buffer.alloc(30 * 1024 * 1024)));
      },
      'big.example.com': (_request, response) => send(response, 'x'.repeat(5_000), 'text/plain'),
    });
    const bomb = await failureOf(
      fetchFrom(world, 'bomb.example.com', '/', { respectRobots: false, maxBytes: 100_000 }),
    );
    expect(bomb).toMatchObject({ code: 'size', detail: { decompressed: true } });
    const big = await failureOf(
      fetchFrom(world, 'big.example.com', '/', { respectRobots: false, maxBytes: 1_000 }),
    );
    expect(big.code).toBe('size');
    expect(big.detail.decompressed).toBeUndefined();
  });

  it('refuses a response whose head is far larger than any real one', async () => {
    const world = await open({
      'a.example.com': (_request, response) => {
        response.writeHead(200, { 'content-type': 'text/plain', 'x-padding': 'a'.repeat(60_000) });
        response.end(PAGE);
      },
    });
    const failure = await failureOf(
      fetchFrom(world, 'a.example.com', '/', { respectRobots: false }),
    );
    expect(failure.code).toBe('network');
  });

  it('reads only the types it is told to, and asks for them', async () => {
    const world = await open({
      'a.example.com': (_request, response) =>
        send(response, Buffer.from('%PDF-1.4 fake'), 'application/pdf'),
    });
    expect(
      (await failureOf(fetchFrom(world, 'a.example.com', '/', { respectRobots: false }))).code,
    ).toBe('type');
    const allowed = new Set(['application/pdf']);
    const page = await fetchFrom(world, 'a.example.com', '/', {
      respectRobots: false,
      allowedContentTypes: allowed,
    });
    expect(page.contentType).toBe('application/pdf');
    expect(page.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const asked = world.seen['a.example.com']!.at(-1)!;
    expect(asked.headers.accept).toContain('application/pdf');
    expect(world.seen['a.example.com']![0]!.headers.accept).not.toContain('application/pdf');
  });

  it('stops when the caller says so, and says that it was the caller', async () => {
    const world = await open({ 'a.example.com': () => undefined });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const started = Date.now();
    const failure = await failureOf(
      fetchFrom(world, 'a.example.com', '/', {
        respectRobots: false,
        signal: controller.signal,
        timeoutMs: 8_000,
      }),
    );
    expect(failure.detail.cancelled).toBe(true);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
