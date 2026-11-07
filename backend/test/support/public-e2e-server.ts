/**
 * The server for the browser tests of the public edition, and for nothing else.
 *
 * It is the real application in `SWARM_EDITION=public` (`publicApp`: PostgreSQL in the process with row-level security in
 * force, the real sign-in code, the real spend gate), serving the built page, with three things replaced by fakes that
 * never leave the machine:
 *
 *   Google      the token call and the keys that sign an ID token (`FakeProviders`). The browser is sent to
 *               https://accounts.google.com as it would be, and the test answers there (`page.route`), asking this
 *               server, on its control port, to expect the code it hands back.
 *   Azure       the operator's deployment of the free tier (`FakeFoundry`).
 *   Gemini      a person's own key (`FakeGemini`), which accepts one key.
 *
 * Both models answer a request to read a question into a scenario with a frame made from the question, and nothing else:
 * that is the one model-assisted step the tests take. The control port:
 *
 *   GET  /__health     ok
 *   POST /__google     {code, sub, email, nonce}: what Google will say for the code
 *   GET  /__seen       what each fake model was asked: counts, hosts, paths, whether a credential was sent
 *   POST /__reset      forgets what the fakes were asked
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { FakeGemini } from './fake-gemini.js';
import { FakeFoundry, foundryEnvironment } from './public-foundry.js';
import { E2E_KEY, PUBLIC_E2E_PORTS, type Seen } from './public-e2e-protocol.js';
import { frameOf, questionIn } from './public-brain.js';
import { publicApp } from './public-idp.js';

const port = Number(process.env.E2E_PUBLIC_PORT ?? PUBLIC_E2E_PORTS.app);
const controlPort = Number(process.env.E2E_PUBLIC_CONTROL_PORT ?? PUBLIC_E2E_PORTS.control);

const foundry = new FakeFoundry();
const gemini = new FakeGemini();
gemini.keys.add(E2E_KEY);

foundry.reply = (_call, body) => foundry.ok(undefined, frameOf(questionIn(body)));
gemini.reply = (_call, seen) => gemini.ok(frameOf(questionIn(seen.body)));

const guestMode = process.env.E2E_PUBLIC_GUEST === '1';

const h = await publicApp(
  {
    ...foundryEnvironment,
    PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
    ALLOWED_HOSTS: '127.0.0.1',
    HOST: '127.0.0.1',
    PORT: String(port),
    // One free model call a day, so that the limit is reached in two presses.
    FREE_USER_DAILY_CALLS: process.env.E2E_PUBLIC_FREE_CALLS ?? '1',
    PUBLIC_ADMIN_EMAILS: 'admin@example.com',
    PUBLIC_SIGNUPS_PER_IP_PER_DAY: '1000',
    PUBLIC_SIGNUPS_PER_HOUR: '1000',
    RATE_LIMIT_SCALE: '1000',
    // Guest mode, as it is deployed: no sign-in provider at all, and a visitor starts with one press.
    ...(guestMode
      ? {
          PUBLIC_GUEST_MODE: 'true',
          PUBLIC_GOOGLE_CLIENT_ID: '',
          PUBLIC_GOOGLE_CLIENT_SECRET: '',
          PUBLIC_GITHUB_CLIENT_ID: '',
          PUBLIC_GITHUB_CLIENT_SECRET: '',
          PUBLIC_GUESTS_PER_IP_PER_HOUR: process.env.E2E_PUBLIC_GUESTS_PER_IP ?? '30',
          FREE_GUEST_DAILY_CALLS: process.env.E2E_PUBLIC_GUEST_CALLS ?? '60',
        }
      : {}),
  },
  { serve: true, public: { modelFetcher: foundry.fetch, byokFetcher: gemini.fetch } },
);
await h.app.listen({ host: '127.0.0.1', port });

const answer = (response: ServerResponse, status: number, body?: unknown): void => {
  response
    .writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    .end(body === undefined ? undefined : JSON.stringify(body));
};

const seenOf = (): Seen => ({
  foundry: foundry.seen.map((entry) => ({ url: entry.url, deployment: entry.body.model ?? null })),
  gemini: gemini.seen.map((entry) => ({
    method: entry.method,
    host: entry.host,
    path: entry.path,
    // Whether the fake's key arrived, and as what; the key itself is a constant the tests already hold.
    authorization: entry.authorization,
    bodyHasKey: JSON.stringify(entry.body ?? {}).includes(E2E_KEY),
  })),
});

function control(request: IncomingMessage, response: ServerResponse): void {
  let text = '';
  request.on('data', (chunk: Buffer) => {
    text += chunk.toString('utf8');
  });
  request.on('end', () => {
    try {
      const url = new URL(request.url ?? '/', `http://127.0.0.1:${controlPort}`);
      if (request.method === 'GET' && url.pathname === '/__health') {
        answer(response, 200, { ok: true });
      } else if (request.method === 'GET' && url.pathname === '/__seen') {
        answer(response, 200, seenOf());
      } else if (request.method === 'POST' && url.pathname === '/__reset') {
        foundry.seen.length = 0;
        gemini.seen.length = 0;
        gemini.chats = 0;
        answer(response, 204);
      } else if (request.method === 'POST' && url.pathname === '/__google') {
        const { code, sub, email, nonce } = JSON.parse(text) as Record<string, string>;
        if (!code || !sub || !email || !nonce) throw new Error('incomplete');
        h.providers.expectGoogle(code, { sub, email }, nonce);
        answer(response, 204);
      } else {
        answer(response, 404, { error: 'not here' });
      }
    } catch {
      answer(response, 400, { error: 'bad request' });
    }
  });
}

createServer(control).listen(controlPort, '127.0.0.1');

const stop = () => void h.close().then(() => process.exit(0));
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
