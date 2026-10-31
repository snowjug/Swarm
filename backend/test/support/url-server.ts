import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
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
  seen: SeenRequest[];
  url(path?: string): string;
  close(): Promise<void>;
}

/**
 * A web server on this machine, listening on every loopback address, for tests of the fetcher. It is
 * the only kind of server these tests talk to: nothing here reaches the network.
 */
export async function startServer(
  handler: (request: IncomingMessage, response: ServerResponse, seen: SeenRequest) => void,
): Promise<TestServer> {
  const seen: SeenRequest[] = [];
  const server = createServer((request, response) => {
    const entry: SeenRequest = {
      method: request.method ?? '',
      url: request.url ?? '',
      headers: request.headers,
      localAddress: request.socket.localAddress,
    };
    seen.push(entry);
    handler(request, response, entry);
  });
  await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    seen,
    url: (path = '/') => `http://127.0.0.1:${port}${path}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
