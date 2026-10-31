import type { IncomingMessage, ServerResponse } from 'node:http';
import { brotliCompressSync, constants, deflateSync, gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { UrlFailure, type UrlFailureCode } from '../src/ingest/url/failure.js';
import {
  fetchPublicPage,
  PublicFetcher,
  redirectTarget,
  USER_AGENT,
  type FetchOptions,
  type ResolvedAddress,
  type Resolver,
} from '../src/ingest/url/fetcher.js';
import { validateUrl } from '../src/ingest/url/policy.js';
import { startServer, type SeenRequest, type TestServer } from './support/url-server.js';

const servers: TestServer[] = [];
type Handler = (request: IncomingMessage, response: ServerResponse, seen: SeenRequest) => void;
const serve = async (handler: Handler): Promise<TestServer> => {
  const server = await startServer(handler);
  servers.push(server);
  return server;
};
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

const text = (response: ServerResponse, body: string | Buffer, type = 'text/plain'): void => {
  response.writeHead(200, { 'content-type': type });
  response.end(body);
};
const PAGE = 'A page of plain text that is long enough to be read. '.repeat(4);

// Tests can reach a server on this machine only because the constructor says so.
const local = new PublicFetcher({ allowPrivateForTests: true });
const read = (
  server: TestServer,
  path = '/',
  options: FetchOptions = {},
  fetcher: PublicFetcher = local,
) =>
  fetcher.fetchPublicPage(server.url(path), {
    allowedPorts: [server.port],
    respectRobots: false,
    ...options,
  });

async function failureOf(promise: Promise<unknown>): Promise<UrlFailure> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof UrlFailure) return error;
    throw error;
  }
  throw new Error('The page was read.');
}

const resolver =
  (answers: Record<string, ResolvedAddress[]>, calls: string[] = []): Resolver =>
  async (hostname) => {
    calls.push(hostname);
    const answer = answers[hostname];
    if (!answer) throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
    return answer;
  };
const v4 = (address: string): ResolvedAddress => ({ address, family: 4 });
const v6 = (address: string): ResolvedAddress => ({ address, family: 6 });

describe('what the fetcher sends', () => {
  it('sends a fixed set of headers: no cookie, no credential, no referrer, and no fragment', async () => {
    const server = await serve((_request, response) => {
      response.setHeader('set-cookie', 'session=abc');
      text(response, PAGE);
    });
    const page = await read(server, '/page?x=1#section');
    expect(page).toMatchObject({ status: 200, contentType: 'text/plain', redirects: 0 });
    expect(page.text).toBe(PAGE);
    const [seen] = server.seen;
    expect(seen).toMatchObject({ method: 'GET', url: '/page?x=1' });
    expect(Object.keys(seen!.headers).sort()).toEqual([
      'accept',
      'accept-encoding',
      'connection',
      'host',
      'user-agent',
    ]);
    expect(seen!.headers['user-agent']).toBe(USER_AGENT);
    expect(USER_AGENT).toMatch(
      /^SwarmLab-EvidenceFetcher\/\d+\.\d+\.\d+ \(user-initiated evidence retrieval\)$/u,
    );
    expect(seen!.headers['accept-encoding']).toBe('identity');
  });

  it('does not send a cookie it was given, on the next request', async () => {
    const server = await serve((request, response) => {
      if (request.url === '/start') {
        response.writeHead(302, { location: '/next', 'set-cookie': 'session=abc; Path=/' });
        response.end();
      } else text(response, PAGE);
    });
    await read(server, '/start');
    expect(server.seen).toHaveLength(2);
    expect(server.seen[1]!.headers.cookie).toBeUndefined();
    expect(server.seen[1]!.headers.referer).toBeUndefined();
  });

  it('refuses a loopback server unless the constructor allows it, whatever the options say', async () => {
    const server = await serve((_request, response) => text(response, PAGE));
    const strict = new PublicFetcher();
    for (const options of [{}, { allowPrivateForTests: true }, { allowLoopback: true }]) {
      const failure = await failureOf(read(server, '/', options as FetchOptions, strict));
      expect(failure.code).toBe('blocked');
    }
    expect(
      (await failureOf(fetchPublicPage(server.url('/'), { allowedPorts: [server.port] }))).code,
    ).toBe('blocked');
    expect(server.seen).toHaveLength(0);
  });

  it('lets the constructor allow loopback only: every other private range stays refused', async () => {
    const lookup = resolver({
      'a.example.com': [v4('10.1.2.3')],
      'b.example.com': [v6('fe80::1')],
      'c.example.com': [v4('169.254.169.254')],
    });
    const fetcher = new PublicFetcher({ allowPrivateForTests: true, lookup });
    for (const host of ['a', 'b', 'c']) {
      const failure = await failureOf(
        fetcher.fetchPublicPage(`http://${host}.example.com/`, { respectRobots: false }),
      );
      expect(failure.code, host).toBe('blocked');
    }
  });
});

describe('redirects', () => {
  const chain =
    (hops: number): Handler =>
    (request, response) => {
      const step = Number(/^\/hop(\d+)$/u.exec(request.url ?? '')?.[1] ?? Number.NaN);
      if (Number.isNaN(step)) return text(response, PAGE);
      const statuses = [301, 302, 303, 307, 308];
      if (step < hops) {
        const next = step + 1 >= hops ? '/end' : `http://${request.headers.host}/hop${step + 1}`;
        response.writeHead(statuses[step % statuses.length]!, { location: next });
        response.end();
      } else text(response, PAGE);
    };

  it('follows 301, 302, 303, 307 and 308, relative and absolute, up to five times', async () => {
    const server = await serve(chain(5));
    const page = await read(server, '/hop0');
    expect(page.redirects).toBe(5);
    expect(page.finalUrl).toBe(server.url('/end'));
    expect(page.url).toBe(server.url('/hop0'));
    expect(server.seen.map(({ url }) => url)).toEqual([
      '/hop0',
      '/hop1',
      '/hop2',
      '/hop3',
      '/hop4',
      '/end',
    ]);
  });

  it('stops at a sixth redirect, and at a loop', async () => {
    const server = await serve((request, response) => {
      if (request.url === '/loop') {
        response.writeHead(302, { location: '/loop' });
        response.end();
      } else chain(6)(request, response, undefined as never);
    });
    expect((await failureOf(read(server, '/hop0'))).code).toBe('redirects');
    expect(server.seen).toHaveLength(6);
    expect((await failureOf(read(server, '/loop'))).code).toBe('redirects');
    expect((await failureOf(read(server, '/hop0', { maxRedirects: 2 }))).code).toBe('redirects');
  });

  it('judges every redirect target again, and never connects to a refused one', async () => {
    const targets: [string, UrlFailureCode][] = [
      ['http://169.254.169.254/latest/meta-data/', 'blocked'],
      ['http://10.0.0.1/', 'blocked'],
      ['http://192.168.1.1/admin', 'blocked'],
      ['http://100.64.0.1/', 'blocked'],
      ['http://0.0.0.0/', 'blocked'],
      ['http://[fd00::1]/', 'blocked'],
      ['http://[fe80::1]/', 'blocked'],
      ['http://[::ffff:10.0.0.1]/', 'blocked'],
      ['http://[64:ff9b::a00:1]/', 'blocked'],
      ['http://[2002:a9fe:a9fe::1]/', 'blocked'],
      ['http://2852039166/', 'blocked'],
      ['http://0x7f.1/', 'blocked'],
      ['http://localhost/', 'blocked'],
      ['http://db.internal/', 'blocked'],
      ['http://printer.local/', 'blocked'],
      ['ftp://example.com/file', 'invalid'],
      ['file:///etc/passwd', 'invalid'],
      ['javascript:alert(1)', 'invalid'],
      ['http://user:password@example.com/', 'invalid'],
      ['http://example.com:22/', 'port'],
    ];
    const server = await serve((request, response) => {
      const to = new URL(request.url ?? '/', 'http://x').searchParams.get('to') ?? '';
      response.writeHead(302, { location: to });
      response.end();
    });
    for (const [target, code] of targets) {
      const failure = await failureOf(
        read(server, `/?to=${encodeURIComponent(target)}`, { allowedPorts: [server.port, 80] }),
      );
      expect(failure.code, target).toBe(code);
      expect(failure.detail.redirected, target).toBe(true);
    }
    expect(server.seen).toHaveLength(targets.length);
  });

  it('refuses a redirect to a name that resolves to a private address, even among public ones', async () => {
    const lookup = resolver({
      'start.example.com': [v4('127.0.0.1')],
      'private.example.com': [v4('10.0.0.5')],
      'mixed.example.com': [v4('93.184.216.34'), v4('192.168.0.9')],
      'v6.example.com': [v6('fd00::5')],
      'nat64.example.com': [v6('64:ff9b::a00:5')],
    });
    const server = await serve((request, response) => {
      const to = new URL(request.url ?? '/', 'http://x').searchParams.get('to') ?? '';
      response.writeHead(302, { location: `http://${to}:80/` });
      response.end();
    });
    const fetcher = new PublicFetcher({ allowPrivateForTests: true, lookup });
    for (const to of ['private', 'mixed', 'v6', 'nat64']) {
      const failure = await failureOf(
        fetcher.fetchPublicPage(`http://start.example.com:${server.port}/?to=${to}.example.com`, {
          allowedPorts: [server.port, 80],
          respectRobots: false,
        }),
      );
      expect(failure.code, to).toBe('blocked');
      expect(failure.detail.redirected, to).toBe(true);
    }
  });

  it('does not follow a redirect from https to http, but does follow other schemes of the same kind', () => {
    const https = validateUrl('https://example.com/start');
    expect(() => redirectTarget(https, 'http://example.com/next')).toThrow(UrlFailure);
    expect(redirectTarget(https, '/next').href).toBe('https://example.com/next');
    expect(redirectTarget(https, '//other.example.org/x').href).toBe('https://other.example.org/x');
    const http = validateUrl('http://example.com/start');
    expect(redirectTarget(http, 'https://example.com/next').href).toBe('https://example.com/next');
    expect(() => redirectTarget(http, 'http://')).toThrow(UrlFailure);
  });

  it('refuses a redirect that has no destination', async () => {
    const server = await serve((_request, response) => {
      response.writeHead(302);
      response.end();
    });
    const failure = await failureOf(read(server));
    expect(failure).toMatchObject({ code: 'network' });
  });
});

describe('looking the name up, and connecting', () => {
  it('connects to the address that was checked, and looks the name up once', async () => {
    const calls: string[] = [];
    let answers = 0;
    // A rebinding attacker answers with a public address to be checked, and a private one afterwards.
    const lookup: Resolver = async (hostname) => {
      calls.push(hostname);
      answers += 1;
      return [v4(answers === 1 ? '127.0.0.2' : '127.0.0.3')];
    };
    const server = await serve((_request, response) => text(response, PAGE));
    const fetcher = new PublicFetcher({ allowPrivateForTests: true, lookup });
    const page = await fetcher.fetchPublicPage(`http://pinned.example.com:${server.port}/page`, {
      allowedPorts: [server.port],
      respectRobots: false,
    });
    expect(page.text).toBe(PAGE);
    expect(calls).toEqual(['pinned.example.com']);
    expect(server.seen).toHaveLength(1);
    expect(server.seen[0]!.localAddress).toBe('127.0.0.2');
    expect(server.seen[0]!.headers.host).toBe(`pinned.example.com:${server.port}`);
  });

  it('pins each redirect hop to the address it was checked as', async () => {
    const calls: string[] = [];
    const lookup = resolver(
      { 'first.example.com': [v4('127.0.0.2')], 'second.example.com': [v4('127.0.0.4')] },
      calls,
    );
    const server = await serve((request, response) => {
      if (request.url === '/') {
        response.writeHead(302, { location: `http://second.example.com:${server.port}/there` });
        response.end();
      } else text(response, PAGE);
    });
    const fetcher = new PublicFetcher({ allowPrivateForTests: true, lookup });
    const page = await fetcher.fetchPublicPage(`http://first.example.com:${server.port}/`, {
      allowedPorts: [server.port],
      respectRobots: false,
    });
    expect(page.finalUrl).toBe(`http://second.example.com:${server.port}/there`);
    expect(calls).toEqual(['first.example.com', 'second.example.com']);
    expect(server.seen.map(({ localAddress }) => localAddress)).toEqual(['127.0.0.2', '127.0.0.4']);
  });

  it('refuses a host if any one of its addresses is private, and never connects', async () => {
    const lookup = resolver({
      'good-then-bad.example.com': [v4('93.184.216.34'), v4('10.0.0.1')],
      'bad-then-good.example.com': [v4('169.254.169.254'), v4('93.184.216.34')],
      'v6.example.com': [v6('2606:4700:4700::1111'), v6('fc00::1')],
    });
    const fetcher = new PublicFetcher({ lookup });
    for (const host of ['good-then-bad', 'bad-then-good', 'v6']) {
      const started = Date.now();
      const failure = await failureOf(
        fetcher.fetchPublicPage(`https://${host}.example.com/`, { timeoutMs: 3_000 }),
      );
      expect(failure.code, host).toBe('blocked');
      // A refusal is not a connection attempt that timed out.
      expect(Date.now() - started, host).toBeLessThan(1_000);
    }
  });

  it('reads a page through a DNS64 address whose IPv4 address is public, and refuses one that is not', async () => {
    const lookup = resolver({
      'dns64-public.example.com': [v6('64:ff9b::5db8:d822')],
      'dns64-private.example.com': [v6('64:ff9b::a00:1')],
    });
    const fetcher = new PublicFetcher({ lookup });
    const private_ = await failureOf(
      fetcher.fetchPublicPage('https://dns64-private.example.com/', { timeoutMs: 3_000 }),
    );
    expect(private_.code).toBe('blocked');
    // The public one is allowed past the address check, so what happens next is a connection that
    // cannot be made from a test machine: it must not be reported as blocked.
    const open = await failureOf(
      fetcher.fetchPublicPage('https://dns64-public.example.com/', {
        timeoutMs: 800,
        idleMs: 400,
        respectRobots: false,
      }),
    );
    expect(open.code).not.toBe('blocked');
  });

  it('reports a name that does not resolve, and a connection that is refused', async () => {
    const empty = new PublicFetcher({ lookup: async () => [] });
    expect(await failureOf(empty.fetchPublicPage('https://nothing.example.com/'))).toMatchObject({
      code: 'network',
      detail: { reason: 'dns' },
    });
    const failing = new PublicFetcher({ lookup: resolver({}) });
    expect(await failureOf(failing.fetchPublicPage('https://missing.example.com/'))).toMatchObject({
      code: 'network',
      detail: { reason: 'dns' },
    });
    const server = await serve((_request, response) => text(response, PAGE));
    const port = server.port;
    await server.close();
    servers.splice(servers.indexOf(server), 1);
    expect(
      await failureOf(local.fetchPublicPage(`http://127.0.0.1:${port}/`, { allowedPorts: [port] })),
    ).toMatchObject({ code: 'network', detail: { reason: 'refused' } });
  });

  it('reports a certificate or protocol failure as one, not as a page', async () => {
    const server = await serve((_request, response) => text(response, PAGE));
    const failure = await failureOf(
      local.fetchPublicPage(`https://127.0.0.1:${server.port}/`, {
        allowedPorts: [server.port],
        respectRobots: false,
        timeoutMs: 3_000,
      }),
    );
    expect(failure).toMatchObject({ code: 'network', detail: { reason: 'tls' } });
  });
});

describe('limits on what is read', () => {
  it('refuses a page that declares more than the limit, without reading it', async () => {
    const server = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain', 'content-length': '5000' });
      response.end('x'.repeat(5000));
    });
    expect((await failureOf(read(server, '/', { maxBytes: 1_000 }))).code).toBe('size');
  });

  it('stops reading a page of unknown length at the limit, and the server sees the connection end', async () => {
    let sent = 0;
    let closed: () => void = () => undefined;
    const ended = new Promise<void>((resolve) => (closed = resolve));
    const server = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      const timer = setInterval(() => {
        sent += 100_000;
        response.write('y'.repeat(100_000));
      }, 5);
      response.on('close', () => {
        clearInterval(timer);
        closed();
      });
    });
    expect((await failureOf(read(server, '/', { maxBytes: 150_000 }))).code).toBe('size');
    await ended;
    expect(sent).toBeLessThan(20_000_000);
  });

  it('allows a page of exactly the limit, and refuses one byte more', async () => {
    const server = await serve((request, response) => {
      const size = Number(new URL(request.url ?? '/', 'http://x').searchParams.get('size'));
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.write('a'.repeat(size - 1));
      response.end('b');
    });
    expect((await read(server, '/?size=1000', { maxBytes: 1_000 })).bytes).toBe(1_000);
    expect((await failureOf(read(server, '/?size=1001', { maxBytes: 1_000 }))).code).toBe('size');
  });

  it('gives up on a server that drips bytes forever, when the total time is spent', async () => {
    const server = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      const timer = setInterval(() => response.write('.'), 20);
      response.on('close', () => clearInterval(timer));
    });
    const started = Date.now();
    const failure = await failureOf(read(server, '/', { timeoutMs: 400, idleMs: 5_000 }));
    expect(failure.code).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(2_500);
  });

  it('gives up on a connection that goes quiet, and on one that never answers', async () => {
    const quiet = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.write('a start, and then nothing');
    });
    const silent = await serve(() => undefined);
    for (const server of [quiet, silent]) {
      const started = Date.now();
      const failure = await failureOf(read(server, '/', { idleMs: 150, timeoutMs: 8_000 }));
      expect(failure.code).toBe('timeout');
      expect(Date.now() - started).toBeLessThan(3_000);
    }
  });

  it('refuses a page whose type is not on the list, and shows only a safe type name', async () => {
    const types: [string | undefined, string][] = [
      ['application/pdf', 'application/pdf'],
      ['image/png', 'image/png'],
      ['application/octet-stream', 'application/octet-stream'],
      ['application/javascript', 'application/javascript'],
      ['text/javascript', 'text/javascript'],
      ['image/svg+xml', 'image/svg+xml'],
      ['video/mp4', 'video/mp4'],
      ['text/html-sandboxed', 'text/html-sandboxed'],
      ['text/<script>alert(1)</script>', 'unknown'],
      ['not a type at all', 'unknown'],
      [undefined, 'unknown'],
    ];
    const server = await serve((request, response) => {
      const type = new URL(request.url ?? '/', 'http://x').searchParams.get('type');
      if (type === 'none') response.writeHead(200);
      else response.writeHead(200, { 'content-type': type ?? '' });
      response.end(PAGE);
    });
    for (const [type, shown] of types) {
      const failure = await failureOf(read(server, `/?type=${encodeURIComponent(type ?? 'none')}`));
      expect(failure.code, String(type)).toBe('type');
      expect(failure.detail.contentType, String(type)).toBe(shown);
    }
  });

  it.each([
    ['text/html; charset=utf-8', 'text/html'],
    ['TEXT/HTML', 'text/html'],
    ['application/xhtml+xml', 'application/xhtml+xml'],
    ['text/plain', 'text/plain'],
    ['text/markdown; charset=UTF-8', 'text/markdown'],
    ['text/csv', 'text/csv'],
    ['application/json; charset=utf-8', 'application/json'],
  ])('reads %s', async (header, media) => {
    const server = await serve((_request, response) => text(response, PAGE, header));
    expect((await read(server)).contentType).toBe(media);
  });

  it.each([404, 410, 401, 403, 429, 500, 503])(
    'reports an answer of %i as a status',
    async (status) => {
      const server = await serve((_request, response) => {
        response.writeHead(status, { 'content-type': 'text/plain' });
        response.end('an error page');
      });
      expect(await failureOf(read(server))).toMatchObject({ code: 'status', detail: { status } });
    },
  );
});

describe('compressed answers', () => {
  const send =
    (encoding: string | undefined, body: Buffer): Handler =>
    (_request, response) => {
      response.writeHead(200, {
        'content-type': 'text/plain',
        ...(encoding ? { 'content-encoding': encoding } : {}),
      });
      response.end(body);
    };

  it.each([
    ['gzip', gzipSync(Buffer.from(PAGE))],
    ['x-gzip', gzipSync(Buffer.from(PAGE))],
    ['deflate', deflateSync(Buffer.from(PAGE))],
    ['br', brotliCompressSync(Buffer.from(PAGE))],
    ['identity', Buffer.from(PAGE)],
  ])('reads a body sent as %s, though identity was asked for', async (encoding, body) => {
    const server = await serve(send(encoding, body));
    expect((await read(server)).text).toBe(PAGE);
  });

  // 60 MB of zeros is a few kilobytes on the wire: the size of the answer says nothing about the size of the text.
  const zeros = Buffer.alloc(60 * 1024 * 1024);
  it.each([
    ['gzip', gzipSync(zeros)],
    ['deflate', deflateSync(zeros)],
    ['br', brotliCompressSync(zeros, { params: { [constants.BROTLI_PARAM_QUALITY]: 1 } })],
  ])('stops a %s decompression bomb at the output limit', async (encoding, bomb) => {
    expect(bomb.length).toBeLessThan(200_000);
    const server = await serve(send(encoding, bomb));
    const started = Date.now();
    const failure = await failureOf(read(server, '/', { maxBytes: 200_000 }));
    expect(failure.code).toBe('size');
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('refuses damaged data, and an encoding it cannot undo', async () => {
    const damaged = await serve(send('gzip', Buffer.from('this is not gzip data at all')));
    expect(await failureOf(read(damaged))).toMatchObject({
      code: 'network',
      detail: { reason: 'encoding' },
    });
    const unknown = await serve(send('zstd', Buffer.from(PAGE)));
    expect(await failureOf(read(unknown))).toMatchObject({
      code: 'network',
      detail: { reason: 'encoding' },
    });
  });
});

describe('reading bytes as text', () => {
  it('uses the declared charset, a byte-order mark, or a meta tag, and otherwise UTF-8', async () => {
    const cafe = 'Caf\u00e9 au lait, served daily from nine until five, priced in euros.';
    const cases: [string, Buffer, string][] = [
      ['text/plain; charset=iso-8859-1', Buffer.from(cafe, 'latin1'), cafe],
      ['text/plain; charset="windows-1252"', Buffer.from(cafe, 'latin1'), cafe],
      ['text/plain', Buffer.from(cafe, 'utf8'), cafe],
      [
        'text/plain',
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(cafe, 'utf8')]),
        cafe,
      ],
      [
        'text/plain',
        Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(cafe, 'utf16le')]),
        cafe,
      ],
      [
        'text/html',
        Buffer.from(
          `<html><head><meta charset="windows-1252"></head><body>${cafe}</body></html>`,
          'latin1',
        ),
        `<html><head><meta charset="windows-1252"></head><body>${cafe}</body></html>`,
      ],
      ['text/plain; charset=no-such-charset', Buffer.from(cafe, 'utf8'), cafe],
      ['text/plain; charset=utf-7', Buffer.from(PAGE), PAGE],
    ];
    for (const [type, body, expected] of cases) {
      const server = await serve((_request, response) => text(response, body, type));
      expect((await read(server)).text, type).toBe(expected);
    }
  });
});

describe('robots.txt (RFC 9309)', () => {
  const site =
    (robots: (response: ServerResponse) => void): Handler =>
    (request, response) => {
      if (request.url === '/robots.txt') return robots(response);
      text(response, PAGE);
    };
  const robotsText = (body: string) => (response: ServerResponse) => text(response, body);
  const withRobots = (server: TestServer, path: string, options: FetchOptions = {}) =>
    read(server, path, { respectRobots: true, ...options });

  it('reads robots.txt with the same headers as the page, before the page', async () => {
    const server = await serve(site(robotsText('User-agent: *\nDisallow: /private\n')));
    const page = await withRobots(server, '/public');
    expect(page.robots).toBe('allowed');
    expect(server.seen.map(({ url }) => url)).toEqual(['/robots.txt', '/public']);
    expect(server.seen[0]!.headers['user-agent']).toBe(USER_AGENT);
    expect(server.seen[0]!.headers.cookie).toBeUndefined();
  });

  it('refuses a page that robots.txt disallows for everyone, and fetches nothing else', async () => {
    const server = await serve(site(robotsText('User-agent: *\nDisallow: /private\n')));
    expect((await failureOf(withRobots(server, '/private/report'))).code).toBe('robots');
    expect(server.seen.map(({ url }) => url)).toEqual(['/robots.txt']);
  });

  it('obeys the group that names this fetcher, over the group for everyone', async () => {
    const closed = await serve(
      site(
        robotsText(
          'User-agent: *\nAllow: /\n\nUser-agent: swarmlab-evidencefetcher\nDisallow: /\n',
        ),
      ),
    );
    expect((await failureOf(withRobots(closed, '/anything'))).code).toBe('robots');
    const open = await serve(
      site(
        robotsText(
          'User-agent: *\nDisallow: /\n\nUser-agent: SwarmLab-EvidenceFetcher\nAllow: /\n',
        ),
      ),
    );
    expect((await withRobots(open, '/anything')).robots).toBe('allowed');
  });

  it.each([404, 410, 403, 401, 400])(
    'treats a %i for robots.txt as no rules, so the page is read',
    async (status) => {
      const server = await serve(
        site((response) => {
          response.writeHead(status, { 'content-type': 'text/plain' });
          response.end('User-agent: *\nDisallow: /');
        }),
      );
      expect(await withRobots(server, '/page')).toMatchObject({ robots: 'absent', text: PAGE });
    },
  );

  it.each([500, 502, 503, 504])('refuses the page when robots.txt answers %i', async (status) => {
    const server = await serve(
      site((response) => {
        response.writeHead(status);
        response.end();
      }),
    );
    expect((await failureOf(withRobots(server, '/page'))).code).toBe('robots-unavailable');
    expect(server.seen.map(({ url }) => url)).toEqual(['/robots.txt']);
  });

  it('refuses the page when robots.txt cannot be reached: reset, silence, or a refused redirect', async () => {
    const reset = await serve(
      site((response) => {
        response.socket?.destroy();
      }),
    );
    expect(await failureOf(withRobots(reset, '/page'))).toMatchObject({
      code: 'network',
      detail: { reason: 'closed' },
    });
    const silent = await serve(
      site(() => {
        /* never answers */
      }),
    );
    expect(
      (await failureOf(withRobots(silent, '/page', { idleMs: 150, timeoutMs: 8_000 }))).code,
    ).toBe('timeout');
    expect(silent.seen.map(({ url }) => url)).toEqual(['/robots.txt']);
    const toMetadata = await serve(
      site((response) => {
        response.writeHead(302, { location: 'http://169.254.169.254/robots.txt' });
        response.end();
      }),
    );
    expect(
      (await failureOf(withRobots(toMetadata, '/page', { allowedPorts: [toMetadata.port, 80] })))
        .code,
    ).toBe('robots-unavailable');
    expect(toMetadata.seen.map(({ url }) => url)).toEqual(['/robots.txt']);
  });

  it('follows up to five redirects to reach robots.txt, and treats more as unreadable', async () => {
    const hops =
      (count: number): Handler =>
      (request, response) => {
        const step = Number(/^\/robots(\d+)\.txt$/u.exec(request.url ?? '')?.[1] ?? Number.NaN);
        if (request.url === '/robots.txt' || (!Number.isNaN(step) && step < count)) {
          response.writeHead(301, { location: `/robots${Number.isNaN(step) ? 1 : step + 1}.txt` });
          response.end();
        } else if (!Number.isNaN(step)) {
          text(response, 'User-agent: *\nDisallow: /secret\n');
        } else text(response, PAGE);
      };
    const five = await serve(hops(5));
    expect((await failureOf(withRobots(five, '/secret/x'))).code).toBe('robots');
    expect((await withRobots(five, '/open')).robots).toBe('allowed');
    const six = await serve(hops(6));
    expect((await failureOf(withRobots(six, '/open'))).code).toBe('robots-unavailable');
  });

  it('applies the longest matching rule, wildcards, end anchors, and prefers Allow on a tie', async () => {
    const server = await serve(
      site(
        robotsText(
          [
            'User-agent: *',
            'Disallow: /shop/',
            'Allow: /shop/public/',
            'Disallow: /*.pdf$',
            'Disallow: /tmp',
            'Allow: /tmp',
            'Disallow: /search?q=*&page=',
          ].join('\r\n'),
        ),
      ),
    );
    const allowed = ['/', '/shop', '/shop/public/item', '/files/report.pdf.html', '/tmp/x'];
    for (const path of allowed)
      expect((await withRobots(server, path)).robots, path).toBe('allowed');
    for (const path of ['/shop/item', '/files/report.pdf', '/search?q=a&page=2']) {
      expect((await failureOf(withRobots(server, path))).code, path).toBe('robots');
    }
  });

  it('fetches robots.txt once for each site, however many pages and redirects follow', async () => {
    const server = await serve((request, response) => {
      if (request.url === '/robots.txt')
        return text(response, 'User-agent: *\nDisallow: /nothing\n');
      if (request.url === '/a') {
        response.writeHead(302, { location: '/b' });
        return response.end();
      }
      text(response, PAGE);
    });
    await withRobots(server, '/a');
    expect(server.seen.filter(({ url }) => url === '/robots.txt')).toHaveLength(1);
  });

  it('checks the robots.txt of the site a redirect leads to', async () => {
    const other = await serve(site(robotsText('User-agent: *\nDisallow: /\n')));
    const first = await serve((request, response) => {
      if (request.url === '/robots.txt') return text(response, 'User-agent: *\nAllow: /\n');
      response.writeHead(302, { location: other.url('/page') });
      response.end();
    });
    const failure = await failureOf(
      withRobots(first, '/', { allowedPorts: [first.port, other.port] }),
    );
    expect(failure).toMatchObject({ code: 'robots', detail: { redirected: true } });
  });

  it('reads no more than the first 500 KiB, and ignores a robots.txt that is garbage', async () => {
    const big = `${'# padding\n'.repeat(60_000)}User-agent: *\nDisallow: /\n`;
    const server = await serve(site(robotsText(big)));
    expect((await withRobots(server, '/page')).robots).toBe('allowed');
    const junk = await serve(
      site((response) =>
        text(response, '<html><body>Not found, really</body></html>', 'text/html'),
      ),
    );
    expect((await withRobots(junk, '/page')).robots).toBe('allowed');
  });
});
