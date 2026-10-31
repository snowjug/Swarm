import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface SeenRequest {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  /** The address the client connected to, so a test can tell which address a connection was pinned to. */
  localAddress: string | undefined;
}

export interface TestServer {
  port: number;
  /** The addresses it listens on, as its sockets report them: loopback addresses, never a wildcard. */
  addresses: string[];
  seen: SeenRequest[];
  url(path?: string): string;
  close(): Promise<void>;
}

/**
 * The loopback addresses a test can send a name to. The tests that pin a connection to the address a
 * name was checked as read which of them the connection arrived on, so one server listens on each, on
 * one port. Nothing else is listened on: not a wildcard, and not the machine's own network address.
 */
export const LOOPBACK_ADDRESSES: readonly string[] = [
  '127.0.0.1',
  '127.0.0.2',
  '127.0.0.3',
  '127.0.0.4',
];

const listen = (server: Server, address: string, port: number): Promise<void> =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, address, () => {
      server.off('error', reject);
      resolve();
    });
  });

const closeAll = (servers: readonly Server[]): Promise<void> =>
  Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  ).then(() => undefined);

/**
 * A web server on this machine for tests of the fetcher, listening on the loopback addresses only. It
 * is the only kind of server these tests talk to: nothing here reaches the network, and nothing off
 * this machine can reach it.
 */
export async function startServer(
  handler: (request: IncomingMessage, response: ServerResponse, seen: SeenRequest) => void,
): Promise<TestServer> {
  const seen: SeenRequest[] = [];
  const make = (): Server =>
    createServer((request, response) => {
      const entry: SeenRequest = {
        method: request.method ?? '',
        url: request.url ?? '',
        headers: request.headers,
        localAddress: request.socket.localAddress,
      };
      seen.push(entry);
      handler(request, response, entry);
    });
  // The first address picks the port; another process may hold it on one of the others, so try again.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const servers = LOOPBACK_ADDRESSES.map(make);
    try {
      await listen(servers[0]!, LOOPBACK_ADDRESSES[0]!, 0);
      const { port } = servers[0]!.address() as AddressInfo;
      await Promise.all(
        servers.slice(1).map((server, at) => listen(server, LOOPBACK_ADDRESSES[at + 1]!, port)),
      );
      return {
        port,
        addresses: servers.map((server) => (server.address() as AddressInfo).address),
        seen,
        url: (path = '/') => `http://127.0.0.1:${port}${path}`,
        close: () => closeAll(servers),
      };
    } catch (error) {
      await closeAll(servers);
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error('No port was free on every loopback address the tests use.');
}
