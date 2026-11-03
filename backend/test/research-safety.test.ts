import { afterEach, describe, expect, it, vi } from 'vitest';
import { UrlFailure } from '../src/ingest/url/failure.js';
import { PublicFetcher, type FetchOptions } from '../src/ingest/url/fetcher.js';
import { budget } from './support/research-world.js';
import { crawl } from '../src/research/crawler/crawl.js';
import { systemDeps } from '../src/research/crawler/deps.js';
import { PublicPageFetcher } from '../src/research/crawler/fetch.js';
import { RESEARCH_ROBOTS_TOKEN, RESEARCH_USER_AGENT } from '../src/research/crawler/identity.js';
import type {
  CrawlEvent,
  CrawlInput,
  CrawlResult,
  CrawlTuning,
  PageFetchRequest,
} from '../src/research/crawler/types.js';
import { LOOPBACK_ADDRESSES } from './support/url-server.js';
import {
  fakeResolver,
  redirect,
  routes,
  send,
  startWorld,
  v4,
  v6,
  type SiteHandler,
  type World,
} from './support/research-net.js';

const worlds: World[] = [];
afterEach(async () => {
  await Promise.all(worlds.splice(0).map((world) => world.close()));
});
const open = async (sites: Record<string, SiteHandler>): Promise<World> => {
  const world = await startWorld(sites);
  worlds.push(world);
  return world;
};

const PAGE = `<!doctype html><html><head><title>A page</title></head><body><main><article><h1>A page</h1>${[
  'The harbour authority published the berthing fees for the coming season, and the fees were unchanged for vessels under twelve metres.',
  'Larger vessels pay by the metre, with a surcharge in the summer months that the authority sets each spring after a public notice.',
  'Residents may buy an annual pass, which covers every sailing from the municipal pier and is renewed at the harbour office.',
]
  .map((text) => `<p>${text}</p>`)
  .join('')}</article></main></body></html>`;

interface Outcome {
  result: CrawlResult;
  events: CrawlEvent[];
}

/** Runs the real crawler with the real fetcher, over real sockets to this machine, on the real clock. */
async function read(
  seeds: string[],
  options: {
    world?: World;
    resolver?: ReturnType<typeof fakeResolver>;
    allowHttp?: boolean;
    sameSiteOnly?: boolean;
    changes?: Partial<CrawlInput['budget']>;
    tuning?: Partial<CrawlTuning>;
    signal?: AbortSignal;
  } = {},
): Promise<Outcome> {
  const events: CrawlEvent[] = [];
  const { world } = options;
  const fetcher = new PublicPageFetcher({
    seam: world
      ? { lookup: options.resolver ?? world.lookup, allowPrivateForTests: true }
      : { lookup: options.resolver ?? fakeResolver({}) },
    ...(world ? { allowedPorts: [world.port] } : {}),
  });
  const input: CrawlInput = {
    seeds: seeds.map((url) => ({ url, discoveredBy: 'user-url' })),
    budget: budget({ maxDomains: 10, ...options.changes }),
    hints: { terms: [] },
    sameSiteOnly: options.sameSiteOnly ?? false,
    signal: options.signal ?? new AbortController().signal,
    ...(options.allowHttp ? { allowHttp: true } : {}),
  };
  const result = await crawl(
    input,
    systemDeps({
      fetcher,
      onEvent: (event) => events.push(event),
      tuning: { maxRetries: 0, ...options.tuning },
    }),
  );
  return { result, events };
}

const blocked = (done: Outcome) => done.events.filter((event) => event.type === 'fetch-blocked');

describe('a name that leads to an address that is not public is never connected to', () => {
  const table: [address: string, reason: string][] = [
    ['0.0.0.0', 'unspecified'],
    ['0.1.2.3', 'unspecified'],
    ['10.0.0.1', 'private-network'],
    ['10.255.255.255', 'private-network'],
    ['100.64.0.1', 'shared-address-space'],
    ['100.127.255.255', 'shared-address-space'],
    ['100.100.100.200', 'shared-address-space'],
    ['127.0.0.1', 'loopback'],
    ['127.255.255.254', 'loopback'],
    ['169.254.169.254', 'link-local'],
    ['169.254.0.1', 'link-local'],
    ['172.16.0.1', 'private-network'],
    ['172.31.255.255', 'private-network'],
    ['192.0.0.8', 'protocol-assignment'],
    ['192.0.2.1', 'documentation'],
    ['192.88.99.1', 'deprecated-relay'],
    ['192.168.0.1', 'private-network'],
    ['198.18.0.1', 'benchmarking'],
    ['198.19.255.255', 'benchmarking'],
    ['198.51.100.7', 'documentation'],
    ['203.0.113.9', 'documentation'],
    ['224.0.0.1', 'multicast'],
    ['239.255.255.250', 'multicast'],
    ['240.0.0.1', 'reserved'],
    ['255.255.255.255', 'broadcast'],
    ['::', 'unspecified'],
    ['::1', 'loopback'],
    ['::2', 'ipv4-compatible'],
    ['fe80::1', 'link-local'],
    ['fec0::1', 'site-local'],
    ['fc00::1', 'unique-local'],
    ['fd00:ec2::254', 'unique-local'],
    ['ff02::1', 'multicast'],
    ['2001:db8::1', 'documentation'],
    ['2001::1', 'teredo'],
    ['2001:1::1', 'protocol-assignment'],
    ['::ffff:127.0.0.1', 'loopback'],
    ['::ffff:10.0.0.1', 'private-network'],
    ['::ffff:169.254.169.254', 'link-local'],
    ['::ffff:a9fe:a9fe', 'link-local'],
    ['64:ff9b::a00:1', 'private-network'],
    ['2002:7f00:1::', 'loopback'],
    ['2002:a9fe:a9fe::', 'link-local'],
    ['100::1', 'reserved'],
    ['4000::1', 'reserved'],
  ];

  it('refuses every class of address that a name can be made to answer with, and says why in the log only', async () => {
    const names = table.map((_, index) => `h${index}.example.com`);
    const answers = Object.fromEntries(
      table.map(([address], index) => [
        names[index]!,
        [address.includes(':') ? v6(address) : v4(address)],
      ]),
    );
    const asked: string[] = [];
    const started = Date.now();
    const done = await read(
      names.map((name) => `https://${name}/`),
      { resolver: fakeResolver(answers, asked) },
    );
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(asked.sort()).toEqual([...names].sort());
    expect(done.result.pages).toHaveLength(0);
    expect(done.result.stoppedBecause).toBe('safety-block');
    expect(done.result.sources).toHaveLength(table.length);
    const byName = Object.fromEntries(
      blocked(done).map((event) => [new URL(event.url).hostname, event]),
    );
    table.forEach(([address, reason], index) => {
      expect(byName[names[index]!], address).toMatchObject({
        reason,
        resolved: true,
        errorClass: 'dns',
      });
    });
    // A person is told that the name was not found, which says nothing about what is inside a network.
    for (const source of done.result.sources) {
      expect(source.failure).toMatchObject({
        message: 'The name could not be found on the public web.',
      });
    }
  });

  it('refuses a name when any one of its answers is not public, in whatever order they come', async () => {
    const answers = {
      'one.example.com': [v4('203.0.113.1'), v4('10.0.0.1')],
      'two.example.com': [v4('10.0.0.1'), v4('203.0.113.1')],
      'three.example.com': [v4('203.0.113.1'), v6('::1')],
      'four.example.com': [v6('2001:db8::1'), v4('127.0.0.1')],
    };
    const done = await read(
      Object.keys(answers).map((name) => `https://${name}/`),
      {
        resolver: fakeResolver(answers),
      },
    );
    expect(done.result.stoppedBecause).toBe('safety-block');
    expect(blocked(done)).toHaveLength(4);
  });

  it('asks again for each request, so that a name that changes its answer cannot get a request to an address that was not checked', async () => {
    let lookups = 0;
    const world = await open({
      'rebind.example.com': routes({ '/robots.txt': 'User-agent: *\nAllow: /\n', '/page': PAGE }),
    });
    const resolver: typeof world.lookup = async () => {
      lookups += 1;
      return lookups === 1 ? [v4(LOOPBACK_ADDRESSES[1]!)] : [v4('10.0.0.5')];
    };
    const done = await read([world.url('rebind.example.com', '/page')], {
      world,
      resolver,
      allowHttp: true,
    });
    // Whichever request is the one that is asked the second time, it is not connected to, and no page is asked for.
    const asked = world.seen['rebind.example.com']?.map((entry) => entry.url) ?? [];
    expect(asked).not.toContain('/page');
    expect(done.result.pages).toHaveLength(0);
    const blockedEvents = blocked(done);
    expect(blockedEvents).toHaveLength(1);
    // Refused when the page's name was looked up again, or when robots.txt's was: the two are asked separately.
    expect(['private-network', 'robots-unavailable']).toContain(blockedEvents[0]!.reason);
    expect(lookups).toBeGreaterThanOrEqual(2);
  });

  it('connects to the address that was checked, not to one the name leads to when it is asked again', async () => {
    const world = await open({
      'pinned.example.com': routes({ '/robots.txt': 'User-agent: *\nAllow: /\n', '/page': PAGE }),
    });
    const resolver: typeof world.lookup = async () => [v4(LOOPBACK_ADDRESSES[2]!)];
    const done = await read([world.url('pinned.example.com', '/page')], {
      world,
      resolver,
      allowHttp: true,
    });
    expect(done.result.pages).toHaveLength(1);
    const addresses = world.seen['pinned.example.com']!.map((entry) => entry.localAddress);
    expect(new Set(addresses)).toEqual(new Set([LOOPBACK_ADDRESSES[2]]));
  });
});

describe('an address that is written in a way that is not a public web page is refused before anything is looked up', () => {
  const addresses = [
    'https://user:secret@a.example.com/',
    'https://user@a.example.com/',
    'ftp://a.example.com/file',
    'file:///etc/passwd',
    'gopher://a.example.com/',
    'javascript:alert(1)',
    'data:text/html,hello',
    'ws://a.example.com/',
    'https://a.example.com:22/',
    'https://a.example.com:8080/',
    'https://a.example.com:99999/',
    'https://a.example.com:443443/',
    'https://2130706433/',
    'https://0x7f.0.0.1/',
    'https://0177.0.0.1/',
    'https://127.1/',
    'https://017700000001/',
    'https://[::1]/',
    'https://[::ffff:127.0.0.1]/',
    'https://[fd00:ec2::254]/',
    'https://127.0.0.1/',
    'https://10.1.2.3/admin',
    'https://169.254.169.254/latest/meta-data/',
    'https://100.100.100.200/latest/meta-data/',
    'https://localhost/',
    'https://LOCALHOST./',
    'https://foo.localhost/',
    'https://metadata.google.internal/computeMetadata/v1/',
    'https://metadata/',
    'https://intranet/',
    'https://printer.local/',
    'https://router.lan/',
    'https://files.corp/',
    'https://nas.home.arpa/',
    'https://a.example.com%2f@evil.example.net/',
    'https://a.example.com/\u0000',
    'https://a.example.com/ spaced',
    `https://a.example.com/${'a'.repeat(3_000)}`,
    `https://${'a'.repeat(300)}.example.com/`,
    '//a.example.com/',
    'a.example.com/',
    '',
  ];

  it('turns every one away as a rule of the address, and the name server is never asked', async () => {
    const asked: string[] = [];
    const done = await read(addresses, { resolver: fakeResolver({}, asked) });
    expect(asked).toEqual([]);
    expect(done.result.pages).toHaveLength(0);
    expect(done.result.sources.length).toBeGreaterThan(30);
    for (const source of done.result.sources) {
      expect(source.outcome, source.requestedUrl).toBe('blocked');
      expect(source.failure?.class, source.requestedUrl).toMatch(
        /^(?:invalid-url|blocked-address|blocked-scheme|blocked-port)$/u,
      );
    }
    expect(done.result.stoppedBecause).toBe('safety-block');
  });

  it('keeps no user name or password in what it records and logs about them', async () => {
    const done = await read(['https://user:hunter2-canary@a.example.com/'], {});
    expect(JSON.stringify(done)).not.toContain('hunter2-canary');
  });

  it('turns away a link of a page the same way, and asks for none of them', async () => {
    const links = addresses
      .filter(
        (address) =>
          /^https?:/u.test(address) &&
          address.length < 500 &&
          ![...address].some((character) => character.charCodeAt(0) < 32),
      )
      .map(
        (address) =>
          `<li><a href="${address.replace(/"/gu, '&quot;')}">${address.slice(8, 30)}</a></li>`,
      )
      .join('');
    const world = await open({
      'a.example.com': routes({
        '/robots.txt': 'User-agent: *\nAllow: /\n',
        '/': PAGE.replace('</article>', `<ul>${links}</ul></article>`),
      }),
    });
    const done = await read([world.url('a.example.com')], { world, allowHttp: true });
    expect(done.result.pages).toHaveLength(1);
    expect(world.seen['a.example.com']?.map((entry) => entry.url)).toEqual(['/robots.txt', '/']);
    // The name server was asked for the site itself, once for robots.txt and once for the page, and for nothing a link named.
    expect(new Set(world.asked)).toEqual(new Set(['a.example.com']));
    const refused = done.result.sources.filter(({ outcome }) => outcome === 'blocked');
    expect(refused.length).toBeGreaterThan(0);
    expect(refused.length).toBeLessThanOrEqual(3);
    for (const source of refused) expect(source.parentUrl).toBe(world.url('a.example.com'));
  });

  it('reads a backslash in an address the way the fetcher does, so that what follows it is a path and not another host', async () => {
    const asked: string[] = [];
    const done = await read(['https://a.example.com\\@evil.example.net/'], {
      resolver: fakeResolver({ 'a.example.com': [v4('10.0.0.1')] }, asked),
    });
    expect(new Set(asked)).toEqual(new Set(['a.example.com']));
    expect(done.result.pages).toHaveLength(0);
  });

  it('reads only https unless the crawl is told it may read http', async () => {
    const world = await open({
      'plain.example.com': routes({ '/robots.txt': 'User-agent: *\nAllow: /\n', '/': PAGE }),
    });
    const secure = await read([world.url('plain.example.com')], { world });
    expect(secure.result.sources[0]).toMatchObject({
      outcome: 'blocked',
      failure: { class: 'blocked-scheme' },
    });
    expect(world.seen['plain.example.com']).toBeUndefined();
    const plain = await read([world.url('plain.example.com')], { world, allowHttp: true });
    expect(plain.result.pages).toHaveLength(1);
  });
});

describe('redirects', () => {
  let livePort = 0;
  /** A redirect target on the port of the test server, so that it is the address and not the port that is judged. */
  const withPort = (target: string): string =>
    /^https?:\/\/[^@]*\//u.test(target) && !target.includes('@')
      ? target.replace(/^(https?:\/\/)(\[[^\]]+\]|[^/:]+)/u, `$1$2:${livePort}`)
      : target;
  const site = async (
    extra: Record<string, string | Buffer | ((response: Parameters<SiteHandler>[1]) => void)> = {},
  ): Promise<World> => {
    const world = await open({
      'a.example.com': routes({
        '/robots.txt': 'User-agent: *\nDisallow: /private/\n',
        '/': PAGE,
        '/new': PAGE.replace('A page', 'The new page'),
        ...extra,
      }),
      'b.example.org': routes({ '/': PAGE, '/landing': PAGE }),
    });
    livePort = world.port;
    return world;
  };

  it('refuses a redirect to an address that is not public, and never asks for what it leads to', async () => {
    // Loopback addresses are not listed: the server of these tests is on one, so the test setup allows them.
    // They are refused, and tested, in the table of addresses above, which runs without that allowance.
    const targets = [
      'http://10.0.0.1/admin',
      'http://169.254.169.254/latest/meta-data/',
      'http://100.100.100.200/latest/meta-data/',
      'http://[fd00:ec2::254]/',
      'http://[fe80::1]/',
      'http://[::ffff:a9fe:a9fe]/',
      'http://localhost/',
      'http://metadata.google.internal/computeMetadata/v1/',
      'http://2130706433/',
      'http://0x7f.0.0.1/',
      'http://user:pw@a.example.com/',
      'ftp://a.example.com/file',
      'file:///etc/passwd',
      'gopher://a.example.com/',
    ];
    const extra = Object.fromEntries(
      targets.map((target, index) => [
        `/go${index}`,
        (response: Parameters<SiteHandler>[1]) => redirect(response, withPort(target)),
      ]),
    );
    const world = await site(extra);
    const asked: string[] = [];
    const resolver = fakeResolver({ 'a.example.com': [v4(LOOPBACK_ADDRESSES[0]!)] }, asked);
    const done = await read(
      targets.map((_, index) => world.url('a.example.com', `/go${index}`)),
      { world, resolver, allowHttp: true, tuning: { maxConcurrent: 1 } },
    );
    expect(done.result.pages).toHaveLength(0);
    for (const source of done.result.sources) {
      expect(source.outcome, source.requestedUrl).toBe('blocked');
      expect(source.failure?.class, source.requestedUrl).toBe('redirect-refused');
    }
    expect(done.result.sources).toHaveLength(targets.length);
    // The name server was asked for nothing but the site itself.
    expect(new Set(asked)).toEqual(new Set(['a.example.com']));
    expect(done.result.stoppedBecause).toBe('safety-block');
  }, 30_000);

  it('refuses a redirect to a name that leads to an address that is not public', async () => {
    const world = await site({
      '/go': (response) => redirect(response, `http://sneaky.example.com:${livePort}/`),
    });
    const resolver = fakeResolver({
      'a.example.com': [v4(LOOPBACK_ADDRESSES[0]!)],
      'sneaky.example.com': [v4('10.9.9.9')],
    });
    const rewritten = world.url('a.example.com', '/go');
    const done = await read([rewritten], { world, resolver, allowHttp: true });
    expect(done.result.pages).toHaveLength(0);
    expect(done.result.sources[0]).toMatchObject({
      outcome: 'blocked',
      failure: { class: 'redirect-refused' },
    });
  });

  it('follows a redirect on the same site, and records both where it was sent and where it ended', async () => {
    const world = await site({ '/old': (response) => redirect(response, '/new', 301) });
    const done = await read([world.url('a.example.com', '/old')], { world, allowHttp: true });
    const { source } = done.result.pages[0]!;
    expect(source.requestedUrl).toBe(world.url('a.example.com', '/old'));
    expect(source.finalUrl).toBe(world.url('a.example.com', '/new'));
    expect(source.title).toBe('The new page');
    expect(done.events.filter((event) => event.type === 'redirect')).toHaveLength(1);
  });

  it('ends a redirect loop and a chain that is too long, after no more requests than it allows', async () => {
    const chain = Object.fromEntries(
      Array.from({ length: 8 }, (_, index) => [
        `/c${index}`,
        (response: Parameters<SiteHandler>[1]) => redirect(response, `/c${index + 1}`),
      ]),
    );
    const world = await site({
      '/a': (response) => redirect(response, '/b'),
      '/b': (response) => redirect(response, '/a'),
      ...chain,
    });
    const done = await read([world.url('a.example.com', '/a'), world.url('a.example.com', '/c0')], {
      world,
      allowHttp: true,
      changes: { maxRedirects: 5 },
      tuning: { maxConcurrent: 1 },
    });
    expect(done.result.pages).toHaveLength(0);
    for (const source of done.result.sources) {
      expect(source.outcome).toBe('failed');
      expect(source.failure?.class).toBe('redirect-refused');
    }
    const pagesAsked = world.seen['a.example.com']!.filter((entry) => entry.url !== '/robots.txt');
    expect(pagesAsked.length).toBeLessThanOrEqual(2 * (5 + 1));
  }, 30_000);

  it('follows no redirect at all when the budget allows none', async () => {
    const world = await site({ '/old': (response) => redirect(response, '/new') });
    const done = await read([world.url('a.example.com', '/old')], {
      world,
      allowHttp: true,
      changes: { maxRedirects: 0 },
    });
    expect(done.result.pages).toHaveLength(0);
    expect(world.seen['a.example.com']?.map((entry) => entry.url)).toEqual(['/robots.txt', '/old']);
  });

  it('does not follow a redirect to another site when the crawl keeps to its own', async () => {
    const world = await site({
      '/away': (response) => redirect(response, `http://b.example.org:${livePort}/landing`),
    });
    const done = await read([world.url('a.example.com', '/away')], {
      world,
      allowHttp: true,
      sameSiteOnly: true,
    });
    expect(done.result.pages).toHaveLength(0);
    expect(done.result.sources[0]).toMatchObject({
      outcome: 'skipped',
      failure: { class: 'redirect-refused' },
    });
    expect(world.seen['b.example.org']).toBeUndefined();
  });

  it('applies robots.txt to the page a redirect leads to', async () => {
    const world = await site({
      '/go': (response) => redirect(response, '/private/page'),
      '/private/page': PAGE,
    });
    const done = await read([world.url('a.example.com', '/go')], { world, allowHttp: true });
    expect(done.result.pages).toHaveLength(0);
    expect(done.result.sources[0]).toMatchObject({
      outcome: 'blocked',
      failure: { class: 'robots-disallowed' },
    });
    expect(world.seen['a.example.com']?.map((entry) => entry.url)).not.toContain('/private/page');
  });
});

describe('robots.txt', () => {
  const read1 = async (
    robots: string | ((response: Parameters<SiteHandler>[1]) => void),
    path: string,
  ) => {
    const world = await open({
      'a.example.com': routes({ '/robots.txt': robots, [path]: PAGE, '/open': PAGE }),
    });
    const done = await read([world.url('a.example.com', path)], { world, allowHttp: true });
    return { world, done };
  };

  it('is obeyed: a page that it disallows is not asked for', async () => {
    const { world, done } = await read1('User-agent: *\nDisallow: /secret\n', '/secret/report');
    expect(done.result.pages).toHaveLength(0);
    expect(done.result.sources[0]).toMatchObject({
      outcome: 'blocked',
      robots: 'disallowed',
      failure: { class: 'robots-disallowed' },
    });
    expect(world.seen['a.example.com']?.map((entry) => entry.url)).toEqual(['/robots.txt']);
  });

  it('is applied by the longest match, so that an allowed folder inside a disallowed one can be read', async () => {
    const robots = 'User-agent: *\nDisallow: /docs/\nAllow: /docs/public/\n';
    expect((await read1(robots, '/docs/public/a')).done.result.pages).toHaveLength(1);
    expect((await read1(robots, '/docs/private/a')).done.result.pages).toHaveLength(0);
  });

  it('is read for this crawler’s own name before it is read for everyone', async () => {
    const robots = 'User-agent: *\nAllow: /\n\nUser-agent: SwarmLab-ResearchCrawler\nDisallow: /\n';
    const { done } = await read1(robots, '/anything');
    expect(done.result.pages).toHaveLength(0);
    const open = 'User-agent: SwarmLab-ResearchCrawler\nAllow: /\n\nUser-agent: *\nDisallow: /\n';
    expect((await read1(open, '/anything')).done.result.pages).toHaveLength(1);
  });

  it('does not stop a read when the site has none (4xx), and does when it cannot be read (5xx)', async () => {
    const none = await open({
      'a.example.com': (_request, response, seen) => {
        if (seen.url === '/robots.txt') return send(response, 'gone', 'text/plain', 404);
        return send(response, PAGE);
      },
    });
    const absent = await read([none.url('a.example.com', '/page')], {
      world: none,
      allowHttp: true,
    });
    expect(absent.result.pages[0]!.source.robots).toBe('absent');
    const broken = await open({
      'a.example.com': (_request, response, seen) => {
        if (seen.url === '/robots.txt') return send(response, 'oops', 'text/plain', 503);
        return send(response, PAGE);
      },
    });
    const forbidden = await read([broken.url('a.example.com', '/page')], {
      world: broken,
      allowHttp: true,
    });
    expect(forbidden.result.pages).toHaveLength(0);
    expect(broken.seen['a.example.com']?.map((entry) => entry.url)).toEqual(['/robots.txt']);
    expect(forbidden.result.sources[0]).toMatchObject({ outcome: 'blocked', robots: 'disallowed' });
  });

  it('forbids the whole site for the rest of the crawl when it cannot be read, without asking again', async () => {
    const broken = await open({
      'a.example.com': (_request, response, seen) => {
        if (seen.url === '/robots.txt') return send(response, 'oops', 'text/plain', 500);
        return send(response, PAGE);
      },
    });
    const done = await read(
      [broken.url('a.example.com', '/one'), broken.url('a.example.com', '/two')],
      { world: broken, allowHttp: true },
    );
    expect(broken.seen['a.example.com']?.map((entry) => entry.url)).toEqual(['/robots.txt']);
    expect(done.result.sources.map(({ outcome }) => outcome)).toEqual(['blocked', 'blocked']);
  });

  it('is read to a limit of a little over 500 kilobytes, whatever size a site makes it: rules inside the limit apply, and a page is still read', async () => {
    const padding = '# padding\n'.repeat(400_000);
    const allowed = await read1(`User-agent: *\nDisallow: /nothing\n${padding}`, '/open');
    expect(allowed.done.result.sources[0]!.outcome).toBe('used');
    const disallowed = await read1(`User-agent: *\nDisallow: /open\n${padding}`, '/open');
    expect(disallowed.done.result.sources[0]).toMatchObject({
      outcome: 'blocked',
      failure: { class: 'robots-disallowed' },
    });
  }, 30_000);
});

describe('how the crawler sets up the fetcher it reads with', () => {
  const request = (changes: Partial<PageFetchRequest> = {}): PageFetchRequest => ({
    url: 'https://a.example.com/',
    maxBytes: 10_000,
    timeoutMs: 1_000,
    idleMs: 500,
    maxRedirects: 3,
    signal: new AbortController().signal,
    allowHttp: false,
    allowPdf: false,
    robots: new Map(),
    hooks: {},
    ...changes,
  });
  const optionsOf = async (changes: Partial<PageFetchRequest>): Promise<FetchOptions> => {
    let seen: FetchOptions | undefined;
    const spy = vi
      .spyOn(PublicFetcher.prototype, 'fetchPublicPage')
      .mockImplementation(async (_address, options) => {
        seen = options;
        throw new UrlFailure('network', 'stopped', { reason: 'closed' });
      });
    try {
      await new PublicPageFetcher().fetch(request(changes)).catch(() => undefined);
    } finally {
      spy.mockRestore();
    }
    return seen!;
  };

  it('obeys robots.txt, as itself, with the crawl’s own cache and hooks, and cannot be told not to', async () => {
    const robots = new Map();
    const hooks = { onRobots: () => undefined };
    const options = await optionsOf({ robots, hooks });
    expect(options.respectRobots).toBe(true);
    expect(options.identity).toEqual({
      userAgent: RESEARCH_USER_AGENT,
      robotsToken: RESEARCH_ROBOTS_TOKEN,
    });
    expect(options.robotsCache).toBe(robots);
    expect(options.hooks).toBe(hooks);
  });

  it('reads https only unless the crawl allows http, and a PDF only when it may', async () => {
    expect((await optionsOf({})).httpsOnly).toBe(true);
    expect((await optionsOf({ allowHttp: true })).httpsOnly).toBe(false);
    expect([...(await optionsOf({})).allowedContentTypes!]).not.toContain('application/pdf');
    expect([...(await optionsOf({ allowPdf: true })).allowedContentTypes!]).toContain(
      'application/pdf',
    );
  });

  it('passes on the limits of the request, and never reads more than it is given', async () => {
    const options = await optionsOf({
      maxBytes: 12_345,
      timeoutMs: 777,
      idleMs: 55,
      maxRedirects: 2,
    });
    expect(options).toMatchObject({
      maxBytes: 12_345,
      timeoutMs: 777,
      idleMs: 55,
      maxRedirects: 2,
    });
  });

  it('keeps the address policy it was given: ports and hosts', async () => {
    let seen: FetchOptions | undefined;
    const spy = vi
      .spyOn(PublicFetcher.prototype, 'fetchPublicPage')
      .mockImplementation(async (_address, options) => {
        seen = options;
        throw new UrlFailure('network', 'stopped', { reason: 'closed' });
      });
    try {
      await new PublicPageFetcher({ allowedPorts: [8443], allowedHosts: ['*.example.com'] })
        .fetch(request())
        .catch(() => undefined);
    } finally {
      spy.mockRestore();
    }
    expect(seen).toMatchObject({ allowedPorts: [8443], allowedHosts: ['*.example.com'] });
  });
});
