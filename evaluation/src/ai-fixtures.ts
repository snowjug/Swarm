import { createServer as createNetServer } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fakeResolver, v4 } from '../../backend/test/support/research-net.js';
import { LOOPBACK_ADDRESSES, startServer } from '../../backend/test/support/url-server.js';
import { PublicPageFetcher } from '../../backend/src/research/crawler/fetch.js';
import { expandHtml, type ExpandContext, type SitePage, type SiteSet } from './ai-datasets.js';

export interface RecordedRequest {
  host: string;
  /** Path and query, as the client sent them. */
  path: string;
}

export interface SiteWorld {
  /** The product's own page fetcher, pointed at this world and nowhere else. */
  fetcher: PublicPageFetcher;
  urlOf(pageId: string): string;
  pageAt(address: string): SitePage | undefined;
  requests: readonly RecordedRequest[];
  close(): Promise<void>;
}

/** A port on this machine that nothing listens on: the server is bound to find one, and let go of it. */
async function unusedPort(): Promise<number> {
  const probe = createNetServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const address = probe.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

const pathnameOf = (path: string): string => new URL(path, 'http://fixture.invalid').pathname;

/**
 * The fictional web of the site fixtures, served from this machine: every host name goes to a loopback
 * address of its own and to the one server, which answers by the Host header. A name with no entry is
 * not found; a name that resolves to a port nothing listens on is refused. The fetcher is the
 * product's, with every one of its checks on; only its name server is replaced, and only loopback
 * addresses are allowed.
 */
export async function startSiteWorld(sites: SiteSet): Promise<SiteWorld> {
  const byId = new Map(sites.pages.map((page) => [page.id, page]));
  const routes = new Map<string, SitePage>();
  for (const page of sites.pages) {
    if (sites.hosts[page.host]?.resolve === 'server')
      routes.set(`${page.host}${pathnameOf(page.path)}`, page);
  }
  const closedPort = await unusedPort();
  const requests: RecordedRequest[] = [];
  let port = 0;
  const portOf = (host: string): number =>
    sites.hosts[host]?.resolve === 'closed-port' ? closedPort : port;
  const urlOf = (id: string): string => {
    const page = byId.get(id);
    if (!page) throw new Error(`The fixture names a page ${id}, which does not exist.`);
    return `http://${page.host}:${portOf(page.host)}${page.path}`;
  };
  const context: ExpandContext = {
    fragments: sites.fragments,
    urlOf,
    get port(): number {
      return port;
    },
  };

  const answer = (page: SitePage, response: ServerResponse, depth = 0): void => {
    const reply = page.response;
    if (!reply) {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('not here');
      return;
    }
    if (reply.behaviour === 'hang') return;
    if (reply.alias) {
      const target = byId.get(reply.alias);
      if (target && depth < 3) return answer(target, response, depth + 1);
    }
    const status = reply.status ?? (reply.location ? 302 : 200);
    if (reply.location) {
      response.writeHead(status, { location: expandHtml(reply.location, context) });
      response.end();
      return;
    }
    const body =
      reply.bodyBase64 !== undefined
        ? Buffer.from(reply.bodyBase64, 'base64')
        : expandHtml(reply.html ?? '', context);
    response.writeHead(status, { 'content-type': reply.contentType ?? 'text/html; charset=utf-8' });
    response.end(body);
  };

  const handler = (request: IncomingMessage, response: ServerResponse): void => {
    const host = (request.headers.host ?? '').replace(/:\d+$/u, '').toLowerCase();
    const target = new URL(request.url ?? '/', 'http://fixture.invalid');
    requests.push({ host, path: `${target.pathname}${target.search}` });
    const known = sites.hosts[host];
    if (known?.resolve !== 'server') {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('no such site');
      return;
    }
    if (target.pathname === '/robots.txt') {
      if (known.robots === undefined) {
        response.writeHead(404, { 'content-type': 'text/plain' });
        response.end('none');
      } else {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end(known.robots);
      }
      return;
    }
    const page = routes.get(`${host}${target.pathname}`);
    if (!page) {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('not here');
      return;
    }
    answer(page, response);
  };

  const server = await startServer(handler);
  port = server.port;
  const table: Record<string, ReturnType<typeof v4>[]> = {};
  Object.entries(sites.hosts).forEach(([host, entry], index) => {
    if (entry.resolve === 'nxdomain') return;
    table[host] = [v4(LOOPBACK_ADDRESSES[index % LOOPBACK_ADDRESSES.length] ?? '127.0.0.1')];
  });
  const fetcher = new PublicPageFetcher({
    seam: { lookup: fakeResolver(table), allowPrivateForTests: true },
    allowedPorts: [port, closedPort],
  });
  return {
    fetcher,
    urlOf,
    pageAt: (address) => {
      try {
        const url = new URL(address);
        return routes.get(`${url.hostname}${url.pathname}`);
      } catch {
        return undefined;
      }
    },
    requests,
    close: () => server.close(),
  };
}

/**
 * Time that runs as the wall clock does, except that a wait is cut short: `sleep(ms)` lasts `ms / factor`
 * of real time and then moves the clock on to where `ms` would have taken it. A politeness delay costs
 * milliseconds, a stall of the machine is not multiplied, and a crawl that waits for nothing reaches its
 * time limit all the same.
 */
export function warpedClock(factor = 25): {
  now: () => number;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
} {
  const origin = Date.now();
  const epoch = 1_800_000_000_000;
  let skipped = 0;
  const real = (): number => epoch + (Date.now() - origin);
  const now = (): number => real() + skipped;
  return {
    now,
    sleep: (ms, signal) =>
      new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        const deadline = now() + Math.max(0, ms);
        const timer = setTimeout(
          () => {
            signal.removeEventListener('abort', gone);
            skipped = Math.max(skipped, deadline - real());
            resolve();
          },
          Math.max(0, ms / factor),
        );
        const gone = (): void => {
          clearTimeout(timer);
          reject(signal.reason);
        };
        signal.addEventListener('abort', gone, { once: true });
      }),
  };
}
