/**
 * The server for the browser sign-in end-to-end tests, and for nothing else.
 *
 * It is the real application (`buildApp`, serving the built page) in Microsoft Entra sign-in mode,
 * with Microsoft replaced by a small identity provider on a second loopback port:
 *
 *   GET  /<tenant>/oauth2/v2.0/authorize  signs the chosen person in and redirects back with a code
 *   POST /__next {person}                 chooses who the next sign-in is, and forgets earlier visits
 *   GET  /__visits                        the authorize requests received since then
 *
 * The browser makes the same cross-site redirects it would make to Microsoft. The token endpoint is
 * a stand-in that redeems a code only for the PKCE verifier whose challenge came with the authorize
 * request, and the application verifies the ID token against a local signing key. Data is in memory.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { buildApp } from '../../src/app.js';
import { pkceChallenge } from '../../src/auth/oidc.js';
import { TokenVerifier } from '../../src/auth/tokens.js';
import { loadConfig } from '../../src/config.js';
import { Repository } from '../../src/storage/repository.js';
import { TENANT_A, idp, mint } from './entra-idp.js';

const port = Number(process.env.SIGNIN_E2E_PORT ?? 3114);
const idpPort = Number(process.env.SIGNIN_E2E_IDP_PORT ?? 3115);
const CLIENT_ID = 'cccccccc-0000-4000-8000-0000000000aa';
const REDIRECT = `http://127.0.0.1:${port}/auth/callback`;

const people = {
  // The first person with the administrator role in an empty workspace becomes its owner.
  owner: { oid: 'eeeeeee1-0000-4000-8000-000000000001', roles: ['Swarm.User', 'Swarm.Admin'] },
  // Signed in, allowed in, and added to nothing.
  stranger: { oid: 'eeeeeee2-0000-4000-8000-000000000002', roles: ['Swarm.User'] },
  // Microsoft knows them; nobody gave them a Swarm role.
  norole: { oid: 'eeeeeee3-0000-4000-8000-000000000003', roles: [] as string[] },
} as const;

type Person = keyof typeof people;
const isPerson = (value: unknown): value is Person =>
  typeof value === 'string' && Object.hasOwn(people, value);

let next: Person | 'declines' = 'owner';
let visits: Record<string, string>[] = [];
const grants = new Map<string, { person: Person; challenge: string; nonce: string }>();

const fetcher: typeof fetch = async (_input, init) => {
  const form = new URLSearchParams(String(init?.body ?? ''));
  const grant = grants.get(form.get('code') ?? '');
  if (
    !grant ||
    form.get('client_id') !== CLIENT_ID ||
    form.get('redirect_uri') !== REDIRECT ||
    pkceChallenge(form.get('code_verifier') ?? '') !== grant.challenge
  ) {
    return Response.json({ error: 'invalid_grant' }, { status: 400 });
  }
  grants.delete(form.get('code') ?? '');
  const { oid, roles } = people[grant.person];
  return Response.json({
    token_type: 'Bearer',
    access_token: 'never-read-by-swarm',
    id_token: await mint({ aud: CLIENT_ID, oid, roles: [...roles], nonce: grant.nonce }),
  });
};

function authorize(url: URL, response: ServerResponse): void {
  const asked = Object.fromEntries(url.searchParams);
  visits.push(asked);
  if (asked.client_id !== CLIENT_ID || asked.redirect_uri !== REDIRECT) {
    response.writeHead(400).end('unexpected client or redirect address');
    return;
  }
  const back = new URL(REDIRECT);
  back.searchParams.set('state', asked.state ?? '');
  if (next === 'declines') {
    back.searchParams.set('error', 'access_denied');
  } else {
    const code = `code-${grants.size}-${Math.random().toString(36).slice(2)}`;
    grants.set(code, {
      person: next,
      challenge: asked.code_challenge ?? '',
      nonce: asked.nonce ?? '',
    });
    back.searchParams.set('code', code);
  }
  response.writeHead(302, { location: back.toString(), 'cache-control': 'no-store' }).end();
}

function control(request: IncomingMessage, response: ServerResponse): void {
  let body = '';
  request.on('data', (chunk: Buffer) => {
    body += chunk.toString('utf8');
  });
  request.on('end', () => {
    try {
      const url = new URL(request.url ?? '/', `http://127.0.0.1:${idpPort}`);
      if (request.method === 'GET' && url.pathname === '/__health') {
        response.end('ok');
      } else if (request.method === 'GET' && url.pathname === '/__visits') {
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(visits));
      } else if (request.method === 'POST' && url.pathname === '/__next') {
        const { person } = JSON.parse(body) as { person?: unknown };
        if (person !== 'declines' && !isPerson(person)) throw new Error('unknown person');
        next = person;
        visits = [];
        response.writeHead(204).end();
      } else if (
        request.method === 'GET' &&
        /^\/[^/]+\/oauth2\/v2\.0\/authorize$/u.test(url.pathname)
      ) {
        authorize(url, response);
      } else {
        response.writeHead(404).end();
      }
    } catch {
      response.writeHead(400).end();
    }
  });
}

createServer(control).listen(idpPort, '127.0.0.1');

const config = loadConfig({
  PORT: String(port),
  HOST: '127.0.0.1',
  LOG_LEVEL: 'warn',
  RATE_LIMIT_SCALE: '100',
  AI_PROVIDER: 'none',
  AUTH_MODE: 'entra',
  AUTH_ENTRA_TENANT_ID: TENANT_A,
  AUTH_ENTRA_AUDIENCE: 'api://swarm-e2e',
  AUTH_ENTRA_CLIENT_ID: CLIENT_ID,
  AUTH_ENTRA_REDIRECT_URI: REDIRECT,
});
const { app } = await buildApp({
  config,
  repository: new Repository(':memory:'),
  tokenVerifier: new TokenVerifier(config.auth, idp.keys),
  oidc: { fetcher, authorityHost: `http://127.0.0.1:${idpPort}` },
});
await app.listen({ host: config.host, port: config.port });

const stop = () => void app.close().then(() => process.exit(0));
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
