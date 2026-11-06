import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PublicFetcher, type Resolver } from '../../src/ingest/url/fetcher.js';
import { fixtureInput } from '../fixtures.js';
import { makeLinkedPdf } from '../support/pdf-links.js';
import { closeWorlds, openWorld, type World } from '../support/public-world.js';
import { startServer, type TestServer } from '../support/url-server.js';

afterAll(closeWorlds);

/**
 * In the public edition a stranger can ask the server to read a web page and to read a file. Both are ways to make the
 * server connect somewhere, so these tests hold that nothing a stranger types, uploads or pastes makes it reach an
 * address inside its own network, a port other than a web page's, or anything at all that is not a public web page. The
 * mechanics of the fetcher itself (the address ranges, one lookup per request, a connection pinned to the address that was
 * checked, every redirect judged again) are held by `backend/test/url-policy.test.ts` and `url-fetcher.test.ts`; this
 * file holds that the public edition reaches the web only through that fetcher, in the form it is in, and that its other
 * ways of reading what a stranger gives it make no request.
 */

/** What a name leads to, in the resolver the fetcher is given: nothing in the tests reaches a real name server. */
const NAMES: Readonly<Record<string, readonly string[]>> = {
  'inside.example': ['10.0.0.5'],
  'metadata.example': ['169.254.169.254'],
  'azure.example': ['168.63.129.16'],
  'loop.example': ['127.0.0.1'],
  'six.example': ['::1'],
  'mapped.example': ['::ffff:127.0.0.1'],
  'private-six.example': ['fd00::1'],
  'mixed.example': ['93.184.216.34', '10.0.0.5'],
  'public.example': ['93.184.216.34'],
};

const lookups: string[] = [];
const resolver: Resolver = async (host) => {
  lookups.push(host);
  const found = NAMES[host];
  if (!found)
    throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
  return found.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
};

/** Addresses that are a server's own network, written in every way a person can write one. */
const INSIDE = [
  'http://127.0.0.1/',
  'http://127.0.0.1:80/',
  'http://127.1/',
  'http://2130706433/',
  'http://0x7f000001/',
  'http://0177.0.0.1/',
  'http://[::1]/',
  'http://[::ffff:127.0.0.1]/',
  'http://[::ffff:7f00:1]/',
  'http://0.0.0.0/',
  'http://0/',
  'http://10.0.0.1/',
  'http://172.16.0.1/',
  'http://172.31.255.255/',
  'http://192.168.1.1/',
  'http://100.64.0.1/',
  'http://169.254.169.254/latest/meta-data/',
  'http://169.254.169.254:80/',
  'http://[::ffff:169.254.169.254]/',
  'http://[fd00:ec2::254]/',
  'http://168.63.129.16/',
  'http://[fe80::1]/',
  'http://[fd00::1]/',
  'http://224.0.0.1/',
  'http://255.255.255.255/',
  // Names that exist only inside a network are refused as they are written, without a lookup.
  'http://localhost/',
  'http://LOCALHOST:80/',
  'http://app.localhost/',
  'http://printer.local/',
  'http://metadata.google.internal/',
  'http://wiki.corp/',
  'http://router.home.arpa/',
];

/** What is not a web page at all, or is written so as to hide where it goes. */
const NOT_A_WEB_PAGE = [
  'file:///etc/passwd',
  'ftp://93.184.216.34/',
  'gopher://93.184.216.34/',
  'javascript:alert(1)',
  'data:text/html,hello',
  'http://user:secret@93.184.216.34/',
  'http://93.184.216.34@127.0.0.1/',
  '//127.0.0.1/',
  'https://',
  'not a url',
  '',
];

const REFUSED = new Set(['URL_BLOCKED', 'URL_INVALID', 'URL_PORT_NOT_ALLOWED']);
const CANARY_PATH = 'zq-canary-path-7421';
const CANARY_QUERY = 'zq-canary-query-7421';

describe('reading a web page for a stranger', () => {
  let w: World;
  let canary: TestServer;

  beforeAll(async () => {
    canary = await startServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('The canary answered. '.repeat(10));
    });
    w = await openWorld({
      log: true,
      // Whatever the operator allows, a stranger is let to read on the two ports a web page is served on.
      environment: { URL_INGEST_ALLOWED_PORTS: `80,443,8080,8443,${canary.port}` },
      urlFetcher: new PublicFetcher({ lookup: resolver }),
    });
  });
  afterAll(async () => {
    await canary.close();
  });

  const read = async (who: Awaited<ReturnType<World['person']>>, url: string) =>
    w.send(who, 'POST', '/api/evidence/url', { url });

  it('refuses every address inside the server’s own network, in every way of writing one, and looks none of them up', async () => {
    const alice = await w.person();
    const before = lookups.length;
    for (const address of INSIDE) {
      const response = await read(alice, address);
      expect(response.statusCode, address).toBeGreaterThanOrEqual(400);
      expect(response.statusCode, address).toBeLessThan(500);
      expect(REFUSED, `${address}: ${response.body}`).toContain(response.json().error.code);
    }
    // An address is judged as it is written. Nothing is asked of a name server for it.
    expect(lookups.length).toBe(before);
    expect(canary.seen).toEqual([]);
  });

  it('refuses what is not a web page, or is written to hide where it goes', async () => {
    const alice = await w.person();
    for (const address of NOT_A_WEB_PAGE) {
      const response = await read(alice, address);
      expect(response.statusCode, address).toBeGreaterThanOrEqual(400);
      expect(response.statusCode, address).toBeLessThan(500);
      expect(REFUSED, `${address}: ${response.body}`).toContain(response.json().error.code);
    }
    const notAString = await w.send(alice, 'POST', '/api/evidence/url', {
      url: { href: 'http://127.0.0.1/' },
    });
    expect(notAString.statusCode).toBeGreaterThanOrEqual(400);
    expect(notAString.statusCode).toBeLessThan(500);
  });

  it('refuses a name that leads inside, or among other places to one, as it would a name that is not there, and keeps the refusal', async () => {
    const alice = await w.person();
    const missing = await read(alice, 'http://nothing-here.example/');
    expect(missing.statusCode).toBeGreaterThanOrEqual(400);
    const inside = [
      'inside.example',
      'metadata.example',
      'azure.example',
      'loop.example',
      'six.example',
      'mapped.example',
      'private-six.example',
      'mixed.example',
    ];
    for (const name of inside) {
      const response = await read(alice, `http://${name}/${CANARY_PATH}?${CANARY_QUERY}=1`);
      expect(response.statusCode, name).toBe(missing.statusCode);
      // The answer does not say whether the name was inside, so a stranger cannot map the network by asking.
      expect(response.json().error.code, name).toBe(missing.json().error.code);
      expect(response.json().error.message.replace(name, 'X'), name).toBe(
        missing.json().error.message.replace('nothing-here.example', 'X'),
      );
      expect(lookups, name).toContain(name);
    }
    expect(canary.seen).toEqual([]);
    // Each was kept as the refusal it was, by host and reason, and nothing of the path or the query.
    const kept = w.h.built.repository
      .asSystem(() => w.h.built.repository.audit.list({ limit: 500 }))
      .filter((event) => event.action === 'evidence.url.refused');
    for (const name of inside) {
      expect(
        kept.some((event) => event.detail.host === name && event.detail.code === 'URL_BLOCKED'),
        name,
      ).toBe(true);
    }
    const everything = JSON.stringify(kept) + w.logs.join('') + w.answers.join('\n');
    expect(everything).not.toContain(CANARY_PATH);
    expect(everything).not.toContain(CANARY_QUERY);
  });

  it('reads only on ports 80 and 443, whatever the operator allows, and never connects to another', async () => {
    const alice = await w.person();
    for (const url of [
      'http://public.example:8080/',
      'https://public.example:8443/',
      `http://public.example:${canary.port}/`,
      `http://127.0.0.1:${canary.port}/`,
      `http://localhost:${canary.port}/`,
    ]) {
      const response = await read(alice, url);
      expect(response.statusCode, url).toBeGreaterThanOrEqual(400);
      expect(response.statusCode, url).toBeLessThan(500);
      expect(REFUSED, `${url}: ${response.body}`).toContain(response.json().error.code);
    }
    expect((await read(alice, 'http://public.example:8080/')).json().error.code).toBe(
      'URL_PORT_NOT_ALLOWED',
    );
    expect(canary.seen).toEqual([]);
  });

  it('does not read a web page for anybody who is not signed in', async () => {
    const response = await w.send(null, 'POST', '/api/evidence/url', { url: canary.url('/') });
    expect(response.statusCode).toBe(401);
    expect(canary.seen).toEqual([]);
  });
});

describe('what a stranger gives the server to read that is not an address', () => {
  let w: World;
  let canary: TestServer;

  beforeAll(async () => {
    canary = await startServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('The canary answered.');
    });
    w = await openWorld({
      environment: { URL_INGEST_ALLOWED_PORTS: `80,443,${canary.port}` },
      urlFetcher: new PublicFetcher({ lookup: resolver }),
    });
  });
  afterAll(async () => {
    await canary.close();
  });

  /** Time for a request that was going to be made to be made. */
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 400));

  it('makes no request for a PDF that links to an address, opens one, runs a script or names a remote file', async () => {
    const alice = await w.person();
    const pdf = makeLinkedPdf(
      'Fictional transit study: residents discuss accessible bus stops, funding, public evidence and a reversible pilot. No measured public opinion is provided.',
      canary.url('').replace(/\/$/u, ''),
    );
    const response = await w.send(alice, 'POST', '/api/documents/extract', {
      name: 'linked.pdf',
      data: pdf.toString('base64'),
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().content).toContain('Fictional transit study');
    await settle();
    expect(canary.seen).toEqual([]);
  });

  it('makes no request for addresses that are only written in a document, in a project, its export, or the text of a data file', async () => {
    const alice = await w.person();
    const link = canary.url('/pixel.png');
    const text = `The council notes ![pixel](${link}) <img src="${link}"> <a href="${link}">the report</a> and ${link} again, and the residents answer in turn.`;
    const made = await w.send(
      alice,
      'POST',
      '/api/projects',
      fixtureInput({
        documents: [{ name: 'links.md', content: text }],
        settings: { mode: 'local', agentCount: 6, rounds: 4, seed: 42, network: 'community' },
      }),
    );
    expect(made.statusCode, made.body).toBe(201);
    await w.send(alice, 'GET', `/api/projects/${made.json().id}`);
    await w.send(alice, 'GET', `/api/projects/${made.json().id}/export?format=json`);
    const rows = Array.from({ length: 8 }, (_, i) => `row${i},${link},${i}`).join('\n');
    const data = await w.send(alice, 'POST', '/api/documents/extract', {
      name: 'links.csv',
      data: Buffer.from(`name,link,n\n${rows}\n`).toString('base64'),
    });
    expect(data.statusCode, data.body).toBe(200);
    await settle();
    expect(canary.seen).toEqual([]);
  });

  it('does not run the crawler for a stranger unless the operator turned it on, and makes no request when it is asked to', async () => {
    const alice = await w.person();
    const id = await w.project(alice);
    for (const [url, payload] of [
      [`/api/projects/${id}/research/sources`, { url: canary.url('/page') }],
      [`/api/projects/${id}/research`, {}],
    ] as const) {
      const response = await w.send(alice, 'POST', url, payload);
      expect(response.statusCode, `${url}: ${response.body}`).toBe(403);
      expect(response.json().error.code).toBe('RESEARCH_DISABLED');
    }
    await settle();
    expect(canary.seen).toEqual([]);
  });
});
