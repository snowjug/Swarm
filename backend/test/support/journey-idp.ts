/**
 * The test identity provider of the journey: Microsoft Entra's sign-in, replaced by a small server on a loopback port,
 * for `journey-server.ts`. The browser is redirected to it exactly as it would be to Microsoft, with the same
 * parameters (Authorization Code, PKCE with S256, a state and a nonce), and comes back with a code. The token call is
 * a function handed to each application: it redeems a code only for the verifier whose challenge came with the
 * authorize request, and the ID token is really signed, with a key the application's verifier is given.
 *
 *   GET  /<tenant>/oauth2/v2.0/authorize  signs the chosen person in and redirects back with a code
 *
 * Who signs in next is chosen by the harness (`next`), as the sign-in specs of `signin-e2e-server.ts` choose it.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pkceChallenge } from '../../src/auth/oidc.js';
import { TENANT_A, TENANT_B, idp, mint } from './entra-idp.js';
import type { Person } from './journey-protocol.js';

export const CLIENT_ID = 'cccccccc-0000-4000-8000-0000000000bb';
export const AUDIENCE = 'api://swarm-journey';
export { TENANT_A, TENANT_B };

/** The first person with the administrator role in an empty workspace becomes its owner. */
const PEOPLE: Record<Person, { oid: string; tid: string; roles: string[] }> = {
  analyst: {
    oid: 'eeeeeee1-0000-4000-8000-0000000000a1',
    tid: TENANT_A,
    roles: ['Swarm.User', 'Swarm.Admin'],
  },
  // Another tenant: the same application is allowed to sign them in, and they own a workspace of their own.
  outsider: {
    oid: 'eeeeeee2-0000-4000-8000-0000000000b2',
    tid: TENANT_B,
    roles: ['Swarm.User', 'Swarm.Admin'],
  },
};

export interface TestIdp {
  readonly url: string;
  /** The keys the applications verify tokens with, in place of Microsoft's published key set. */
  readonly keys: typeof idp.keys;
  /** Who the next sign-in is. Earlier visits are forgotten. */
  next(person: Person | 'declines'): void;
  /** The authorize requests received since `next` was last called. */
  visits(): Record<string, string>[];
  /** The token call of an application whose sign-in comes back to `redirectUri`. */
  tokenCall(redirectUri: string): typeof fetch;
  /** Lets an application's redirect address be asked for at all. */
  allow(redirectUri: string): void;
  close(): Promise<void>;
}

export async function startIdp(port: number): Promise<TestIdp> {
  let next: Person | 'declines' = 'analyst';
  let visits: Record<string, string>[] = [];
  const allowed = new Set<string>();
  const grants = new Map<
    string,
    { person: Person; challenge: string; nonce: string; redirect: string }
  >();

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
    if (request.method !== 'GET' || !/^\/[^/]+\/oauth2\/v2\.0\/authorize$/u.test(url.pathname)) {
      response.writeHead(404).end();
      return;
    }
    const asked = Object.fromEntries(url.searchParams);
    visits.push(asked);
    if (asked.client_id !== CLIENT_ID || !allowed.has(asked.redirect_uri ?? '')) {
      response.writeHead(400).end('unexpected client or redirect address');
      return;
    }
    const back = new URL(asked.redirect_uri ?? '');
    back.searchParams.set('state', asked.state ?? '');
    if (next === 'declines') {
      back.searchParams.set('error', 'access_denied');
    } else {
      const code = `code-${grants.size}-${Math.random().toString(36).slice(2)}`;
      grants.set(code, {
        person: next,
        challenge: asked.code_challenge ?? '',
        nonce: asked.nonce ?? '',
        redirect: back.origin + back.pathname,
      });
      back.searchParams.set('code', code);
    }
    response.writeHead(302, { location: back.toString(), 'cache-control': 'no-store' }).end();
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}`,
    keys: idp.keys,
    next: (person) => {
      next = person;
      visits = [];
    },
    visits: () => [...visits],
    allow: (redirectUri) => void allowed.add(redirectUri),
    tokenCall:
      (redirectUri): typeof fetch =>
      async (_input, init) => {
        const form = new URLSearchParams(String(init?.body ?? ''));
        const code = form.get('code') ?? '';
        const grant = grants.get(code);
        if (
          !grant ||
          form.get('client_id') !== CLIENT_ID ||
          form.get('redirect_uri') !== redirectUri ||
          grant.redirect !== redirectUri ||
          pkceChallenge(form.get('code_verifier') ?? '') !== grant.challenge
        ) {
          return Response.json({ error: 'invalid_grant' }, { status: 400 });
        }
        grants.delete(code);
        const { oid, roles, tid } = PEOPLE[grant.person];
        return Response.json({
          token_type: 'Bearer',
          access_token: 'never-read-by-swarm',
          id_token: await mint({ aud: CLIENT_ID, oid, roles: [...roles], tid, nonce: grant.nonce }),
        });
      },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
