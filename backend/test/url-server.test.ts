import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { LOOPBACK_ADDRESSES, startServer, type TestServer } from './support/url-server.js';

// The fetcher's tests talk to servers on this machine. They are meant to be reachable from nowhere else,
// so the fixture has to listen on the loopback addresses it names and not on a wildcard.
const servers: TestServer[] = [];
const start = async (): Promise<TestServer> => {
  const server = await startServer((_request, response) => response.end('ok'));
  servers.push(server);
  return server;
};
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

const outside = Object.values(networkInterfaces())
  .flat()
  .find((entry) => entry?.family === 'IPv4' && !entry.internal)?.address;

describe('the web server the URL tests use', () => {
  it('listens on loopback addresses only, one port on each of the addresses the pinning tests send names to', async () => {
    const server = await start();
    expect(server.addresses).toEqual([...LOOPBACK_ADDRESSES]);
    for (const address of server.addresses) {
      expect(address, 'not a wildcard').not.toMatch(/^(?:0\.0\.0\.0|::)$/u);
      expect(address, 'on this machine').toMatch(/^127\./u);
    }
    for (const address of LOOPBACK_ADDRESSES) {
      const answer = await fetch(`http://${address}:${server.port}/`);
      expect(await answer.text(), address).toBe('ok');
    }
    expect(server.seen.map(({ localAddress }) => localAddress)).toEqual([...LOOPBACK_ADDRESSES]);
  });

  it.skipIf(outside === undefined)(
    'does not answer on the address that the rest of the network sees this machine by',
    async () => {
      const server = await start();
      const outcome = await new Promise<string>((resolve) => {
        const socket = connect({ host: outside!, port: server.port, timeout: 2_000 });
        socket.once('connect', () => resolve('connected'));
        socket.once('timeout', () => resolve('timeout'));
        socket.once('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? 'error'));
      });
      expect(outcome).toBe('ECONNREFUSED');
    },
  );

  it('can be closed, and then answers nowhere', async () => {
    const server = await start();
    await server.close();
    servers.splice(servers.indexOf(server), 1);
    await expect(fetch(`http://127.0.0.1:${server.port}/`)).rejects.toThrow();
  });
});
