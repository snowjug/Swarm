import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ResolvedAddress, Resolver } from '../../src/ingest/url/fetcher.js';
import {
  LOOPBACK_ADDRESSES,
  startServer,
  type SeenRequest,
  type TestServer,
} from './url-server.js';

export const v4 = (address: string): ResolvedAddress => ({ address, family: 4 });
export const v6 = (address: string): ResolvedAddress => ({ address, family: 6 });

/** A name server that answers from a table, records what it was asked, and says "not found" otherwise. */
export function fakeResolver(
  answers: Record<string, readonly ResolvedAddress[]>,
  asked: string[] = [],
): Resolver {
  return async (hostname) => {
    asked.push(hostname);
    const answer = answers[hostname];
    if (!answer) throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
    return answer;
  };
}

export type SiteHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  seen: SeenRequest,
) => void;

export interface World {
  port: number;
  /** Resolves every site's name to a loopback address, so the fetcher reaches this machine and nothing else. */
  lookup: Resolver;
  /** What was asked of each site, by host name. */
  seen: Record<string, SeenRequest[]>;
  /** The names asked of the name server, in order. */
  asked: string[];
  url(host: string, path?: string): string;
  close(): Promise<void>;
}

const hostOf = (request: IncomingMessage): string =>
  (request.headers.host ?? '').replace(/:\d+$/u, '').toLowerCase();

/**
 * Several sites on one loopback server: each name is sent to its own loopback address, and the
 * handler that is called is the one for the name that was asked for.
 */
export async function startWorld(sites: Record<string, SiteHandler>): Promise<World> {
  const seen: Record<string, SeenRequest[]> = {};
  const server: TestServer = await startServer((request, response, entry) => {
    const host = hostOf(request);
    (seen[host] ??= []).push(entry);
    const handler = sites[host];
    if (!handler) {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('no such site');
      return;
    }
    handler(request, response, entry);
  });
  const names = Object.keys(sites);
  const asked: string[] = [];
  const table: Record<string, ResolvedAddress[]> = {};
  names.forEach((name, index) => {
    table[name] = [v4(LOOPBACK_ADDRESSES[index % LOOPBACK_ADDRESSES.length]!)];
  });
  return {
    port: server.port,
    lookup: fakeResolver(table, asked),
    seen,
    asked,
    url: (host, path = '/') => `http://${host}:${server.port}${path}`,
    close: () => server.close(),
  };
}

export const send = (
  response: ServerResponse,
  body: string | Buffer,
  type = 'text/html; charset=utf-8',
  status = 200,
  headers: Record<string, string> = {},
): void => {
  response.writeHead(status, { 'content-type': type, ...headers });
  response.end(body);
};

export const redirect = (response: ServerResponse, location: string, status = 302): void => {
  response.writeHead(status, { location });
  response.end();
};

/** Routes by path. Anything not listed is a 404 with a short body. */
export function routes(
  table: Record<string, string | Buffer | ((response: ServerResponse) => void)>,
  types: Record<string, string> = {},
): SiteHandler {
  return (request, response) => {
    const path = (request.url ?? '/').split('?')[0] ?? '/';
    const entry = table[path] ?? table[request.url ?? ''];
    if (entry === undefined) return send(response, 'not here', 'text/plain', 404);
    if (typeof entry === 'function') return entry(response);
    send(response, entry, types[path] ?? (path.endsWith('.txt') ? 'text/plain' : undefined));
  };
}
