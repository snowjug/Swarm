import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from '../../src/errors.js';
import { createModelFactory } from '../../src/models/factory.js';
import { ProviderTelemetry } from '../../src/models/telemetry.js';
import { runWithFunding } from '../../src/public/funding.js';
import { fixtureInput } from '../fixtures.js';
import { closeWorlds, csrf, KEY, openWorld, type World } from '../support/public-world.js';

afterAll(closeWorlds);

type Person = Awaited<ReturnType<World['person']>>;

/** What must not be in anything a stranger is sent: a stack, a path, a query, a table, a host or a setting. */
const INTERNALS: readonly RegExp[] = [
  /node_modules/u,
  /\/home\//u,
  /\bat\s+\S+\s+\(.*:\d+:\d+\)/u,
  /\.(?:ts|js|mjs):\d+/u,
  /\bSELECT\b|\bINSERT\b|\bUPDATE\s+\w+\s+SET\b|\bFROM\s+\w+_\w+/iu,
  /swarm_app|public_users|usage_daily|project_funding|public_settings|row_level|pg_catalog/iu,
  /gpt-4\.1-mini|free-tier\.openai\.azure\.com|operator-key-never-shown/iu,
  /FOUNDRY_|AI_MODEL|AI_PROVIDER|OPENAI_|AZURE_OPENAI|az login|Cognitive Services/u,
  /TypeError|ReferenceError|\bstack\b/u,
];
const internalsIn = (text: string): string[] =>
  INTERNALS.filter((pattern) => pattern.test(text)).map((pattern) => String(pattern));

const bytes = (text: string): string => Buffer.from(text).toString('base64');
const CSV = `name,price,stock\n${Array.from({ length: 12 }, (_, i) => `Item ${i},${i}.50,${i * 3}`).join('\n')}\n`;
const LOCAL = { mode: 'local', agentCount: 6, rounds: 4, seed: 42, network: 'community' };
const auditOf = (w: World, action: string) =>
  w.h.built.repository
    .asSystem(() => w.h.built.repository.audit.list({ limit: 500 }))
    .filter((event) => event.action === action);

describe('what one account, and one address, may do in an hour', () => {
  const environment = {
    RATE_LIMIT_SCALE: '1',
    PUBLIC_RATE_CREATE_PER_HOUR: '3',
    PUBLIC_RATE_WRITES_PER_5MIN: '10',
    PUBLIC_RATE_MODEL_PER_HOUR: '2',
    PUBLIC_RATE_FETCH_PER_HOUR: '2',
    PUBLIC_RATE_EXTRACT_PER_HOUR: '2',
    PUBLIC_MAX_PROJECTS: '100',
  };
  let w: World;

  it('holds an account to a few new projects an hour and an address to three times that, and says how long to wait', async () => {
    w = await openWorld({ environment });
    const [alice, bob, carol, dave] = [
      await w.person('alice'),
      await w.person('bob'),
      await w.person('carol'),
      await w.person('dave'),
    ];
    const make = (who: Person) =>
      w.send(who, 'POST', '/api/projects', fixtureInput({ settings: LOCAL }));
    for (let i = 0; i < 3; i++) expect((await make(alice)).statusCode).toBe(201);
    const refused = await make(alice);
    expect(refused.statusCode).toBe(429);
    expect(refused.json().error.code).toBe('RATE_LIMITED');
    expect(refused.json().error.message).toMatch(
      /^You are doing that a lot\. Wait (?:a minute|\d+ minutes), then try again\.$/u,
    );
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    // Somebody else is not held by it, and the refused try did not count against the address.
    for (let i = 0; i < 3; i++) expect((await make(bob)).statusCode).toBe(201);
    for (let i = 0; i < 3; i++) expect((await make(carol)).statusCode).toBe(201);
    // Nine from this address in the hour is what an address may do.
    const fromTheAddress = await make(dave);
    expect(fromTheAddress.statusCode).toBe(429);
    expect(fromTheAddress.json().error.code).toBe('RATE_LIMITED');
    // A person at another address is let through.
    const erin = await w.person('erin', '10.9.8.7');
    expect(
      (await w.send(erin, 'POST', '/api/projects', fixtureInput({ settings: LOCAL }))).statusCode,
    ).toBe(201);
  });

  it('holds every kind of change to a limit, and the dearest kinds to tighter ones', async () => {
    // Every change an account makes: ten in five minutes here, and nothing else about the route is looked at.
    const alice = await w.person('alice2', '10.1.0.1');
    for (let i = 0; i < 10; i++)
      expect((await w.send(alice, 'DELETE', '/api/byok')).statusCode).toBe(204);
    const eleventh = await w.send(alice, 'DELETE', '/api/byok');
    expect(eleventh.statusCode).toBe(429);
    expect(eleventh.json().error.code).toBe('RATE_LIMITED');

    // Work done by a model: two an hour here. The third is stopped before it is looked at.
    const bob = await w.person('bob2', '10.1.0.2');
    const id = await w.project(bob, undefined, LOCAL);
    expect((await w.propose(bob, id, 'rules')).statusCode).not.toBe(429);
    expect((await w.propose(bob, id, 'rules')).statusCode).not.toBe(429);
    const third = await w.propose(bob, id, 'rules');
    expect(third.statusCode).toBe(429);
    expect(third.json().error.code).toBe('RATE_LIMITED');

    // A page read from the web: two an hour. The first two are answered by the rules for what may be fetched (a
    // loopback address is not one), and the third is stopped before it is looked at.
    const carol = await w.person('carol2', '10.1.0.3');
    const read = () => w.send(carol, 'POST', '/api/evidence/url', { url: 'http://127.0.0.1:9/' });
    expect((await read()).statusCode).not.toBe(429);
    expect((await read()).statusCode).not.toBe(429);
    expect((await read()).statusCode).toBe(429);

    // A file read.
    const dave = await w.person('dave2', '10.1.0.4');
    const extract = () =>
      w.send(dave, 'POST', '/api/documents/extract', {
        name: 'a.csv',
        data: bytes(CSV),
      });
    expect((await extract()).statusCode).toBe(200);
    expect((await extract()).statusCode).toBe(200);
    expect((await extract()).statusCode).toBe(429);
  });

  it('records what it refused as security events with words and counts only, once in a while, and counts it for the administrator', async () => {
    const events = auditOf(w, 'public.rate.limited');
    expect(events.length).toBeGreaterThanOrEqual(6);
    const kinds = new Set(events.map((event) => event.detail.kind));
    for (const kind of ['create', 'writes', 'model', 'fetch', 'extract']) {
      expect(kinds, kind).toContain(kind);
    }
    for (const event of events) {
      expect(Object.keys(event.detail).sort()).toEqual(['kind', 'scope']);
      expect(JSON.stringify(event)).not.toMatch(/@example\.com|127\.0\.0\.1|10\.\d+\.\d+\.\d+/u);
    }
    // Hammering a button does not write more than one.
    const before = events.length;
    const frank = await w.person('frank', '10.1.0.5');
    for (let i = 0; i < 14; i++) await w.send(frank, 'DELETE', '/api/byok');
    expect(auditOf(w, 'public.rate.limited').length).toBe(before + 1);
    // Every refusal is counted, whether or not it was written.
    expect(w.context.ledger.blockedByReason(1)['rate-limited']).toBeGreaterThanOrEqual(before + 4);
  });

  it('forgets a limit when its window is over', async () => {
    let at = Date.parse('2026-03-01T10:00:00Z');
    const timed = await openWorld({ environment, now: () => at });
    const alice = await timed.person('alice3', '10.2.0.1');
    for (let i = 0; i < 10; i++) await timed.send(alice, 'DELETE', '/api/byok');
    expect((await timed.send(alice, 'DELETE', '/api/byok')).statusCode).toBe(429);
    at += 5 * 60_000 + 1_000;
    expect((await timed.send(alice, 'DELETE', '/api/byok')).statusCode).toBe(204);
  });

  it('counts nothing for a request it refuses: not against the account the address turned away, and not for a workspace that is full', async () => {
    let at = Date.parse('2026-03-01T10:00:00Z');
    const timed = await openWorld({
      environment: { ...environment, AUTH_SESSION_IDLE_MINUTES: '480' },
      now: () => at,
    });
    const people = [
      await timed.person('a4'),
      await timed.person('b4'),
      await timed.person('c4'),
      await timed.person('d4'),
    ];
    const make = (who: Person) =>
      timed.send(who, 'POST', '/api/projects', fixtureInput({ settings: LOCAL }));
    // Three people at one address use all nine of the address's hour.
    for (const who of people.slice(0, 3)) {
      for (let i = 0; i < 3; i++) expect((await make(who)).statusCode).toBe(201);
    }
    // A fourth is turned away three times by the address, half an hour on.
    at += 30 * 60_000;
    for (let i = 0; i < 3; i++) expect((await make(people[3]!)).statusCode).toBe(429);
    // When the first nine have left the hour, the fourth is let in: the three refusals did not use up their own account's.
    at += 31 * 60_000;
    expect((await make(people[3]!)).statusCode).toBe(201);

    // A workspace that is full is told so, however often it tries, and is never taken for a person who does too much.
    const full = await openWorld({ environment: { ...environment, PUBLIC_MAX_PROJECTS: '2' } });
    const eve = await full.person('eve', '10.3.0.1');
    for (let i = 0; i < 2; i++) {
      expect(
        (await full.send(eve, 'POST', '/api/projects', fixtureInput({ settings: LOCAL })))
          .statusCode,
      ).toBe(201);
    }
    for (let i = 0; i < 6; i++) {
      const refused = await full.send(
        eve,
        'POST',
        '/api/projects',
        fixtureInput({ settings: LOCAL }),
      );
      expect(refused.statusCode).toBe(409);
      expect(refused.json().error.code).toBe('PROJECT_LIMIT');
    }
  });
});

describe('what a workspace may hold', () => {
  it('keeps a few projects, says so in a plain sentence, and lets one be deleted to make room', async () => {
    const w = await openWorld({ environment: { PUBLIC_MAX_PROJECTS: '2' } });
    const alice = await w.person();
    const bob = await w.person();
    const make = (who: Person) =>
      w.send(who, 'POST', '/api/projects', fixtureInput({ settings: LOCAL }));
    const first = (await make(alice)).json().id as string;
    expect((await make(alice)).statusCode).toBe(201);
    const refused = await make(alice);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatchObject({
      code: 'PROJECT_LIMIT',
      message: 'You can keep 2 projects. Delete one you no longer need, then try again.',
    });
    expect((await w.send(alice, 'GET', '/api/account')).json().projects).toEqual({
      count: 2,
      limit: 2,
    });
    // Another workspace has its own two.
    expect((await make(bob)).statusCode).toBe(201);
    // Taking away is never refused, and makes room.
    expect((await w.send(alice, 'DELETE', `/api/projects/${first}`)).statusCode).toBe(204);
    expect((await make(alice)).statusCode).toBe(201);
    expect(auditOf(w, 'public.quota.refused').map((event) => event.detail.kind)).toEqual([
      'projects',
    ]);
  });

  it('keeps a limit on the text it stores, refuses what would add to it, and lets a project be deleted to make room', async () => {
    const w = await openWorld({
      environment: { PUBLIC_STORAGE_QUOTA_MB: '1', PUBLIC_MAX_PROJECTS: '20' },
    });
    const alice = await w.person();
    const big = (n: number) =>
      fixtureInput({
        name: `Big ${n}`,
        settings: LOCAL,
        documents: Array.from({ length: 5 }, (_, d) => ({
          name: `d${d}.md`,
          content: `Document ${n}-${d}. ${'The council considers the proposal and the residents respond in turn. '.repeat(540)}`,
        })),
      });
    const made: string[] = [];
    let refused: Awaited<ReturnType<World['send']>> | null = null;
    for (let i = 0; i < 12 && !refused; i++) {
      const response = await w.send(alice, 'POST', '/api/projects', big(i));
      if (response.statusCode === 201) made.push(response.json().id as string);
      else refused = response;
    }
    expect(made.length).toBeGreaterThan(0);
    expect(refused?.statusCode).toBe(413);
    expect(refused?.json().error.code).toBe('STORAGE_LIMIT');
    expect(refused?.json().error.message).toMatch(
      /^Your workspace is full \(\d+\.\d of 1\.0 MB\)\. Delete a project you no longer need, then try again\.$/u,
    );
    const account = (await w.send(alice, 'GET', '/api/account')).json();
    expect(account.storage.usedBytes).toBeGreaterThanOrEqual(1_000_000);
    expect(account.storage.limitBytes).toBe(1_000_000);
    // Adding text to a project that is there is refused as well; a person who is not full is not held.
    const adding = await w.send(alice, 'POST', `/api/projects/${made[0]}/evidence/documents`, {
      documents: [{ name: 'more.md', content: 'More text, enough to be a document of its own.' }],
    });
    expect(adding.statusCode).toBe(413);
    expect(adding.json().error.code).toBe('STORAGE_LIMIT');
    const bob = await w.person();
    expect((await w.send(bob, 'POST', '/api/projects', big(99))).statusCode).toBe(201);
    // Deleting is never refused, and makes room.
    for (const id of made)
      expect((await w.send(alice, 'DELETE', `/api/projects/${id}`)).statusCode).toBe(204);
    expect((await w.send(alice, 'POST', '/api/projects', big(100))).statusCode).toBe(201);
    expect(auditOf(w, 'public.quota.refused').map((event) => event.detail.kind)).toContain(
      'storage',
    );
  });
});

describe('what a stranger is sent with every answer', () => {
  let w: World;
  let alice: Person;

  it('is told how the page may be used, and nothing else may', async () => {
    w = await openWorld({ log: true });
    alice = await w.person();
    for (const [who, url] of [
      [null, '/api/public/session'],
      [null, '/api/public/status'],
      [alice, '/api/account'],
      [alice, '/api/usage'],
    ] as const) {
      const response = await w.send(who, 'GET', url);
      expect(response.statusCode, url).toBe(200);
      const h = response.headers;
      expect(h['x-content-type-options'], url).toBe('nosniff');
      expect(h['referrer-policy'], url).toBe('no-referrer');
      expect(h['cross-origin-opener-policy'], url).toBe('same-origin');
      expect(h['cross-origin-resource-policy'], url).toBe('same-origin');
      expect(h['strict-transport-security'], url).toMatch(/max-age=\d+/u);
      expect(h['permissions-policy'], url).toMatch(
        /camera=\(\).*geolocation=\(\).*microphone=\(\)/u,
      );
      expect(h['x-powered-by'], url).toBeUndefined();
      expect(h['access-control-allow-origin'], url).toBeUndefined();
      expect(String(h['content-type']), url).toMatch(/^application\/json/u);
      const policy = String(h['content-security-policy']);
      for (const directive of [
        "default-src 'self'",
        "script-src 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ]) {
        expect(policy, `${url}: ${directive}`).toContain(directive);
      }
      expect(policy, url).not.toMatch(
        /unsafe-eval|script-src[^;]*unsafe-inline|script-src[^;]*https?:|cloudflare/u,
      );
    }
    // What is about a person is not kept by anything between.
    expect((await w.send(alice, 'GET', '/api/account')).headers['cache-control']).toMatch(
      /no-store|no-cache|private/u,
    );
  });

  it('is never given a cross-origin allowance, and is refused when it comes from another origin', async () => {
    const evil = { origin: 'https://evil.example' };
    for (const [method, url] of [
      ['GET', '/api/public/session'],
      ['POST', '/auth/start/google'],
      ['GET', '/api/account'],
    ] as const) {
      const response = await w.send(alice, method, url, method === 'POST' ? {} : undefined, evil);
      expect(response.statusCode, url).toBe(403);
      expect(response.json().error.code, url).toBe('ORIGIN_NOT_ALLOWED');
      expect(response.headers['access-control-allow-origin'], url).toBeUndefined();
    }
    const preflight = await w.raw({
      method: 'OPTIONS',
      url: '/api/projects',
      headers: {
        origin: 'https://evil.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'x-swarm-csrf',
        cookie: alice.cookie,
      },
    });
    expect(preflight.statusCode).toBeGreaterThanOrEqual(400);
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
    // The site's own origin is let through, and is still given no cross-origin allowance: it needs none.
    const own = await w.raw({
      method: 'GET',
      url: '/api/public/session',
      headers: { origin: 'http://localhost:3001' },
    });
    expect(own.statusCode).toBe(200);
    expect(own.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('is told of a change that did not come from the page itself, and of a host the site does not answer for', async () => {
    const noHeader = await w.raw({
      method: 'POST',
      url: '/api/projects',
      headers: { cookie: alice.cookie, 'content-type': 'application/json' },
      payload: {},
    });
    expect(noHeader.statusCode).toBe(403);
    expect(noHeader.json().error.code).toBe('CSRF_REQUIRED');
    // The only kind of request a page on another site can make without asking is a form: no JSON, no header.
    const form = await w.raw({
      method: 'POST',
      url: '/api/projects',
      headers: { cookie: alice.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'name=x',
    });
    expect(form.statusCode).toBeGreaterThanOrEqual(400);
    expect(form.statusCode).toBeLessThan(500);
    const otherHost = await w.raw({
      method: 'GET',
      url: '/api/public/session',
      headers: { host: 'evil.example' },
    });
    expect(otherHost.statusCode).toBe(403);
    expect(otherHost.json().error.code).toBe('HOST_NOT_ALLOWED');
  });
});

describe('the bot check, when it is on', () => {
  const secret = 'turnstile-canary-0123456789-abcdef';
  const make = async () => {
    const seen: { url: string; body: URLSearchParams; redirect: RequestRedirect | undefined }[] =
      [];
    let down = false;
    const botFetcher: typeof fetch = async (input, init) => {
      if (down) throw new TypeError('fetch failed');
      const body = new URLSearchParams(String(init?.body));
      seen.push({ url: String(input), body, redirect: init?.redirect });
      return new Response(JSON.stringify({ success: body.get('response') === 'good' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const w = await openWorld({
      environment: { TURNSTILE_SITE_KEY: 'site-key-123', TURNSTILE_SECRET_KEY: secret },
      publicOptions: { botFetcher },
    });
    return {
      w,
      seen,
      setDown: (value: boolean) => {
        down = value;
      },
    };
  };

  it('is told to the page by its site key only, and starts a sign-in only with a token Cloudflare accepts', async () => {
    const { w, seen, setDown } = await make();
    const session = (await w.send(null, 'GET', '/api/public/session')).json();
    expect(session.bot).toEqual({ kind: 'turnstile', siteKey: 'site-key-123' });
    const start = (body: object) => w.send(null, 'POST', '/auth/start/google', body);
    for (const body of [{}, { turnstileToken: '' }, { turnstileToken: 'bad' }]) {
      const refused = await start(body);
      expect(refused.statusCode, JSON.stringify(body)).toBe(403);
      expect(refused.json().error.code).toBe('BOT_CHECK_FAILED');
    }
    const accepted = await start({ turnstileToken: 'good' });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(new URL(accepted.json().url).host).toBe('accounts.google.com');
    // A Cloudflare that cannot be reached stops new sign-ins, and does not let them through.
    setDown(true);
    expect((await start({ turnstileToken: 'good' })).json().error.code).toBe('BOT_CHECK_FAILED');
    // Only its own address is ever asked, with the secret in the form, and no redirect followed.
    expect(seen.length).toBeGreaterThan(0);
    for (const call of seen) {
      expect(call.url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
      expect(call.body.get('secret')).toBe(secret);
      expect(call.body.get('remoteip')).toBeTruthy();
      expect(call.redirect).toBe('error');
    }
    expect(w.answers.join('\n')).not.toContain(secret);
  });

  it('widens the page’s policy for Cloudflare’s own host, and only when the check is on', async () => {
    const { w } = await make();
    const policy = String(
      (await w.send(null, 'GET', '/api/public/session')).headers['content-security-policy'],
    );
    expect(policy).toMatch(/script-src 'self' https:\/\/challenges\.cloudflare\.com/u);
    expect(policy).toMatch(/frame-src https:\/\/challenges\.cloudflare\.com/u);
    expect(policy).toMatch(/connect-src 'self' https:\/\/challenges\.cloudflare\.com/u);
    expect(policy).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline/u);
    const off = await openWorld();
    const answer = await off.send(null, 'GET', '/api/public/session');
    expect(String(answer.headers['content-security-policy'])).not.toContain('cloudflare');
    expect(answer.json().bot).toBeNull();
    expect((await off.send(null, 'POST', '/auth/start/google', {})).statusCode).toBe(200);
  });
});

describe('errors say what to do, and nothing of how the service is made', () => {
  it('words the free model’s failures for a stranger, and keeps their codes', async () => {
    const w = await openWorld();
    const alice = await w.person();
    const factory = createModelFactory(
      w.h.config,
      new ProviderTelemetry(w.h.config.provider),
      null,
      w.h.built.publicEdition!.funding,
    );
    const ask = () =>
      runWithFunding({ workspaceId: alice.workspaceId, funding: 'free', byok: null }, () =>
        factory(() => undefined).json(
          z.object({ ok: z.boolean() }),
          'Say ok.',
          { question: 'q' },
          new AbortController().signal,
          500,
        ),
      ).then(
        () => null,
        (error: unknown) => error as AppError,
      );
    const reply = (status: number, error: object) => () =>
      new Response(JSON.stringify({ error }), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    const cases: [string, () => Response, string][] = [
      [
        'a credential the provider refuses',
        reply(401, {
          code: 'invalid_api_key',
          message:
            'Incorrect API key provided: operator-key-never-shown (free-tier.openai.azure.com)',
        }),
        'MODEL_AUTH',
      ],
      [
        'no permission',
        reply(403, {
          code: 'PermissionDenied',
          message:
            'The principal lacks Cognitive Services OpenAI User on free-tier.openai.azure.com',
        }),
        'MODEL_AUTH',
      ],
      [
        'a deployment that is not there',
        reply(404, {
          code: 'DeploymentNotFound',
          message: 'The API deployment for this resource does not exist: gpt-4.1-mini',
        }),
        'MODEL_NOT_FOUND',
      ],
      [
        'a reply that is not shaped like a completion',
        () =>
          new Response('{"unexpected":"free-tier.openai.azure.com"}', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        'MODEL_PROTOCOL',
      ],
    ];
    for (const [what, answer, code] of cases) {
      w.foundry.reply = answer;
      const error = await ask();
      expect(error, what).toBeInstanceOf(AppError);
      expect(error!.code, what).toBe(code);
      expect(error!.message, what).toBe(
        'The free model is not available right now. Try again later, or use your own key.',
      );
      expect(internalsIn(error!.message), what).toEqual([]);
    }
    // A page where an answer should be: the words are the client's own, and name nothing of the service.
    w.foundry.reply = () =>
      new Response('<html>Bad gateway from free-tier.openai.azure.com</html>', { status: 200 });
    const page = await ask();
    expect(page!.code).toBe('MODEL_OUTPUT_INVALID');
    expect(internalsIn(page!.message)).toEqual([]);
    // A network that does not answer.
    w.foundry.reply = () => {
      throw new TypeError('fetch failed: connect ECONNREFUSED free-tier.openai.azure.com:443');
    };
    const down = await ask();
    expect(down!.code).toBe('MODEL_UNREACHABLE');
    expect(down!.message).toBe(
      'The free model could not be reached. Try again in a moment, or use your own key.',
    );
    expect(internalsIn(down!.message)).toEqual([]);
  });

  it('says it through the routes: a stopped step with the code, and a cause that names nothing', async () => {
    const w = await openWorld();
    const alice = await w.person();
    const id = await w.project(alice);
    w.foundry.reply = () =>
      new Response(
        JSON.stringify({
          error: {
            code: 'DeploymentNotFound',
            message:
              'The API deployment for this resource does not exist: gpt-4.1-mini free-tier.openai.azure.com',
          },
        }),
        { status: 404, headers: { 'content-type': 'application/json' } },
      );
    const response = await w.propose(alice, id);
    expect(response.statusCode, response.body).toBeLessThan(500);
    expect(internalsIn(response.body)).toEqual([]);
    expect(response.body).toContain('MODEL_NOT_FOUND');
  });

  it('does not tell a stranger what is wrong with the operator’s set-up when there is no model', async () => {
    const w = await openWorld({ noModel: true });
    const alice = await w.person();
    const id = await w.project(alice);
    const response = await w.propose(alice, id);
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(internalsIn(response.body)).toEqual([]);
    const config = (await w.send(alice, 'GET', '/api/config')).json();
    expect(config.provider.model).toBeNull();
    expect(config.provider.configured).toBe(false);
    expect(config.provider.reason).toMatch(/^The free tier is not set up/u);
    expect(internalsIn(JSON.stringify(config))).toEqual([]);
  });

  it('answers an unexpected failure with a sentence and an id, and writes no stack, path or query anywhere', async () => {
    const boom = new TypeError(
      "boom at /home/atharv/work/Swarm/backend/src/x.ts:12:3 SELECT * FROM public_users WHERE id = 'u1' (swarm_app)",
    );
    const w = await openWorld({
      log: true,
      publicOptions: {
        wrapGuard: (guard) => ({
          ...guard,
          authenticate: async () => {
            throw boom;
          },
        }),
      },
    });
    const response = await w.raw({ method: 'GET', url: '/api/projects' });
    expect(response.statusCode).toBe(500);
    expect(Object.keys(response.json().error).sort()).toEqual(['code', 'message', 'requestId']);
    expect(internalsIn(response.body)).toEqual([]);
    expect(JSON.stringify(response.headers)).not.toMatch(/boom|public_users/u);
    const written = w.logs.join('');
    expect(written).toContain('Request failed');
    expect(written).not.toMatch(/\/home\/|SELECT|public_users|boom at/u);
  });

  it('answers what is not there, or not allowed, plainly, and the same for what is another person’s', async () => {
    const w = await openWorld();
    const alice = await w.person();
    const bob = await w.person();
    const bobs = (await w.send(bob, 'POST', '/api/projects', fixtureInput())).json().id as string;
    const none = await w.send(alice, 'GET', '/api/projects/00000000-0000-4000-8000-000000000000');
    const notYours = await w.send(alice, 'GET', `/api/projects/${bobs}`);
    expect(notYours.statusCode).toBe(none.statusCode);
    expect({ ...notYours.json().error, requestId: '' }).toEqual({
      ...none.json().error,
      requestId: '',
    });
    const unknown = await w.send(alice, 'GET', '/api/nope');
    expect(unknown.statusCode).toBeGreaterThanOrEqual(400);
    for (const response of [
      none,
      notYours,
      unknown,
      await w.send(alice, 'POST', '/api/projects', { name: 5 }),
    ]) {
      expect(internalsIn(response.body)).toEqual([]);
    }
    expect(w.answers.filter((answer) => /^5\d\d /u.test(answer))).toEqual([]);
  });
});

describe('what may be sent to it', () => {
  it('refuses a body that is too large, a type it does not read, and a file that is not one, cleanly', async () => {
    const w = await openWorld();
    const alice = await w.person();
    const huge = await w.raw({
      method: 'POST',
      url: '/api/projects',
      headers: { cookie: alice.cookie, ...csrf },
      payload: JSON.stringify({ name: 'x'.repeat(700_000) }),
    });
    expect(huge.statusCode).toBe(413);
    expect(huge.json().error.message).toBe(
      'The request exceeds the configured endpoint body-size limit.',
    );
    const text = await w.raw({
      method: 'POST',
      url: '/api/projects',
      headers: { cookie: alice.cookie, 'x-swarm-csrf': '1', 'content-type': 'application/xml' },
      payload: '<project/>',
    });
    expect(text.statusCode).toBe(415);
    expect(text.json().error.message).toBe('Unsupported content type. Use application/json.');
    // Plain text is read, and is not what a project is made of.
    const plain = await w.raw({
      method: 'POST',
      url: '/api/projects',
      headers: { cookie: alice.cookie, 'x-swarm-csrf': '1', 'content-type': 'text/plain' },
      payload: 'hello',
    });
    expect(plain.statusCode).toBe(400);
    const large = await w.send(alice, 'POST', '/api/documents/extract', {
      name: 'a.csv',
      data: Buffer.alloc(3_000_000, 'a,b\n').toString('base64'),
    });
    expect(large.statusCode).toBeGreaterThanOrEqual(400);
    expect(large.statusCode).toBeLessThan(500);
    const notAPdf = await w.send(alice, 'POST', '/api/documents/extract', {
      name: 'x.pdf',
      data: bytes('this is not a pdf at all'),
    });
    expect(notAPdf.statusCode).toBeGreaterThanOrEqual(400);
    expect(notAPdf.statusCode).toBeLessThan(500);
    for (const response of [huge, text, plain, large, notAPdf]) {
      expect(internalsIn(response.body)).toEqual([]);
    }
  });

  it('keeps a script in a document as text, in an answer that cannot be run', async () => {
    const w = await openWorld();
    const alice = await w.person();
    const script = '<script>alert(document.cookie)</script><img src=x onerror=alert(1)>';
    const made = await w.send(
      alice,
      'POST',
      '/api/projects',
      fixtureInput({
        name: script,
        settings: LOCAL,
        documents: [
          {
            name: 'page.md',
            content: `${script} The council considers the proposal and the residents respond in turn.`,
          },
        ],
      }),
    );
    expect(made.statusCode, made.body).toBe(201);
    const got = await w.send(alice, 'GET', `/api/projects/${made.json().id}`);
    expect(String(got.headers['content-type'])).toMatch(/^application\/json/u);
    expect(got.headers['x-content-type-options']).toBe('nosniff');
    expect(JSON.stringify(got.json())).toContain('<script>');
    const exported = await w.send(
      alice,
      'GET',
      `/api/projects/${made.json().id}/export?format=json`,
    );
    expect(String(exported.headers['content-type'])).toMatch(/^application\/json/u);
    expect(exported.headers['content-disposition']).toMatch(/^attachment/u);
    expect(exported.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('the record of security events', () => {
  it('holds who and what, in words and counts, and no address, e-mail, key or document', async () => {
    const w = await openWorld();
    const alice = await w.person();
    const admin = await w.person('admin');
    await w.project(
      alice,
      'The council meets on Thursday evening to decide on the night bus route change, and the residents of the old corridor will speak.',
    );
    await w.send(alice, 'POST', '/api/byok/connect', undefined, {
      'x-swarm-provider': 'gemini',
      'x-swarm-provider-key': KEY,
    });
    await w.raw({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: alice.cookie, ...csrf },
      payload: {},
    });
    await w.send(admin, 'POST', '/api/admin/signups', { enabled: false });
    await w.send(admin, 'POST', '/api/admin/signups', { enabled: true });
    const events = w.h.built.repository.asSystem(() =>
      w.h.built.repository.audit.list({ limit: 500 }),
    );
    const actions = new Set(events.map((event) => event.action));
    for (const action of [
      'public.signup',
      'public.signin',
      'public.signout',
      'public.byok.connect',
      'public.admin.signups',
    ]) {
      expect(actions, action).toContain(action);
    }
    const text = JSON.stringify(events);
    expect(text).not.toMatch(/@example\.com|127\.0\.0\.1|council meets|AIzaSy/u);
  });
});
