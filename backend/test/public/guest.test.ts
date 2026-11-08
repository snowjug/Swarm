import { createHash } from 'node:crypto';
import type { InjectOptions } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createModelFactory } from '../../src/models/factory.js';
import { ProviderTelemetry } from '../../src/models/telemetry.js';
import { loadPublicConfig } from '../../src/public/config.js';
import { runWithFunding } from '../../src/public/funding.js';
import { LedgerRefusal } from '../../src/public/storage/ledger.js';
import { fixtureInput } from '../fixtures.js';
import { FakeFoundry, foundryEnvironment } from '../support/public-foundry.js';
import { publicApp, type PublicHarness } from '../support/public-idp.js';

/**
 * Guest mode: a visitor who does not sign in starts a temporary private workspace with one call, and is held to a
 * tighter allowance than a person who signed in. Everything that keeps people apart (row security, the guard, the ledger,
 * the kill switch) is the public edition's own, and these tests show that a guest goes through all of it.
 */

const csrf = { 'x-swarm-csrf': '1', 'content-type': 'application/json' };
const OWNER_KEY = 'canary-owner-key-0123456789abcdef0123456789abcdef';
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const HOUR = 3_600_000;

const open: PublicHarness[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((made) => made.close()));
});

interface Guest {
  cookie: string;
  workspaceId: string;
  userId: string;
  address: string;
}

async function setup(
  environment: Record<string, string> = {},
  options: { now?: () => number } = {},
) {
  const foundry = new FakeFoundry();
  const logs: string[] = [];
  const answers: string[] = [];
  const h = await publicApp(
    {
      ...foundryEnvironment,
      PUBLIC_GUEST_MODE: 'true',
      PUBLIC_OWNER_KEY_SHA256: sha256(OWNER_KEY),
      PUBLIC_SIGNUPS_PER_IP_PER_DAY: '1000',
      PUBLIC_SIGNUPS_PER_HOUR: '1000',
      ...environment,
    },
    {
      public: { modelFetcher: foundry.fetch },
      ...(options.now ? { now: options.now } : {}),
      log: { stream: { write: (chunk: string) => logs.push(chunk) }, level: 'debug' },
    },
  );
  open.push(h);
  const edition = h.built.publicEdition!;
  const context = edition.context;
  const { repository } = h.built;

  const inject = async (request: InjectOptions) => {
    const response = await h.app.inject(request);
    answers.push(`${response.statusCode} ${JSON.stringify(response.headers)} ${response.body}`);
    return response;
  };
  /** What a visitor's page does when "Try it now" is pressed. */
  const start = (address = '203.0.113.7', headers: Record<string, string> = csrf) =>
    inject({
      method: 'POST',
      url: '/auth/guest',
      remoteAddress: address,
      headers,
      payload: {},
    });
  const guest = async (address = '203.0.113.7'): Promise<Guest> => {
    const response = await start(address);
    expect(response.statusCode, response.body).toBe(200);
    const cookie = String(response.headers['set-cookie']).split(';')[0]!;
    const token = cookie.slice(cookie.indexOf('=') + 1);
    const found = repository.asSystem(() =>
      repository.sessions.find(token, context.lifetime.idleMs),
    );
    return {
      cookie,
      workspaceId: found!.principal.tenantId,
      userId: found!.principal.id,
      address,
    };
  };
  const ask = (
    who: { cookie: string; address?: string },
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    payload?: object,
  ) =>
    inject({
      method,
      url,
      ...(who.address ? { remoteAddress: who.address } : {}),
      headers: { cookie: who.cookie, ...(method === 'GET' ? {} : csrf) },
      ...(payload !== undefined ? { payload } : method === 'POST' ? { payload: {} } : {}),
    });
  const owner = (method: 'GET' | 'POST', url: string, key: string | null = OWNER_KEY) =>
    inject({
      method,
      url,
      headers: key ? { 'x-swarm-owner-key': key } : {},
    });

  const factory = createModelFactory(
    h.config,
    new ProviderTelemetry(h.config.provider),
    null,
    edition.funding,
  );
  const schema = z.object({ ok: z.boolean() });
  /** One model call made for a workspace on the free tier, as a request or a run would make it. */
  const call = (workspaceId: string) =>
    runWithFunding({ workspaceId, funding: 'free', byok: null }, () =>
      factory(() => undefined).json(
        schema,
        'Say ok.',
        { question: 'q' },
        new AbortController().signal,
        4_000,
        { route: { role: 'extraction' } },
      ),
    );
  const audit = () =>
    repository.asSystem(() => repository.audit.list({ limit: 500 })).map((event) => event.action);

  return {
    h,
    foundry,
    edition,
    context,
    repository,
    logs,
    answers,
    inject,
    start,
    guest,
    ask,
    owner,
    call,
    audit,
  };
}

describe('starting as a guest', () => {
  it('makes a private workspace and a cookie that scripts cannot read, with one call and no address', async () => {
    const t = await setup();
    const before = (await t.inject({ method: 'GET', url: '/api/public/session' })).json();
    expect(before).toMatchObject({ signedIn: false, guestMode: true, guestRetentionHours: 24 });

    const a = await t.guest('203.0.113.1');
    const b = await t.guest('203.0.113.2');
    expect(a.workspaceId).not.toBe(b.workspaceId);

    const session = (await t.ask(a, 'GET', '/api/public/session')).json();
    expect(session.signedIn).toBe(true);
    expect(session.user).toMatchObject({
      provider: 'guest',
      guest: true,
      emailMasked: 'guest',
      isAdmin: false,
    });
    const account = (await t.ask(a, 'GET', '/api/account')).json();
    expect(account).toMatchObject({
      guest: true,
      provider: 'guest',
      emailMasked: 'guest',
      isAdmin: false,
      projects: { count: 0 },
    });
    // A guest has no address to show, and the synthetic one it is stored with is never sent.
    expect(JSON.stringify(t.answers)).not.toContain('guest.invalid');
    const started = await t.start('203.0.113.3');
    const cookie = String(started.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/u);
    expect(cookie).toMatch(/SameSite=Lax/u);
    expect(started.json()).toEqual({ started: true });
    expect(String(started.headers['cache-control'])).toContain('no-store');
  });

  it('sets the __Host- cookie, Secure, on a site served over https', async () => {
    const t = await setup({
      PUBLIC_BASE_URL: 'https://swarm.example.com',
      ALLOWED_HOSTS: 'localhost,swarm.example.com',
      TRUST_PROXY: '1',
    });
    const response = await t.start();
    expect(response.statusCode, response.body).toBe(200);
    const cookie = String(response.headers['set-cookie']);
    expect(cookie).toMatch(/^__Host-swarm_session=[A-Za-z0-9_-]{16,}/u);
    expect(cookie).toMatch(/; Path=\//u);
    expect(cookie).toMatch(/; Secure/u);
    expect(cookie).toMatch(/; HttpOnly/u);
    expect(cookie).toMatch(/; SameSite=Lax/u);
    expect(cookie).not.toMatch(/Domain=/iu);
  });

  it('is refused without the page’s header, from another site, when guest mode is off, and when new visitors are not let in', async () => {
    const t = await setup();
    expect((await t.start('203.0.113.9', { 'content-type': 'application/json' })).statusCode).toBe(
      403,
    );
    expect(
      (await t.start('203.0.113.9', { ...csrf, 'sec-fetch-site': 'cross-site' })).statusCode,
    ).toBe(403);

    const off = await setup({ PUBLIC_GUEST_MODE: 'false' });
    const refused = await off.start();
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe('NOT_AVAILABLE');
    expect((await off.inject({ method: 'GET', url: '/api/public/session' })).json().guestMode).toBe(
      false,
    );

    const closed = await setup({ PUBLIC_SIGNUPS_ENABLED: 'false' });
    expect((await closed.start()).statusCode).toBe(403);
    expect(
      (await closed.inject({ method: 'GET', url: '/api/public/session' })).json().guestMode,
    ).toBe(false);
    // Nothing was made by any of the refusals.
    expect(t.context.users.count() + off.context.users.count() + closed.context.users.count()).toBe(
      0,
    );
  });

  it('is a valid site with no OAuth app when guest mode is on, and not otherwise', () => {
    const base = {
      PUBLIC_BASE_URL: 'https://swarm.example.com',
      PUBLIC_PEPPER: 'p'.repeat(40),
    };
    const config = loadPublicConfig({ ...base, PUBLIC_GUEST_MODE: 'true' });
    expect(config.providers).toEqual({ google: null, github: null });
    expect(config.guestMode).toBe(true);
    expect(config.guests).toEqual({ perIpPerHour: 10, perHour: 300, retentionHours: 24 });
    expect(config.free.guest).toEqual({
      dailyTokens: 80_000,
      dailyCalls: 60,
      lifetimeTokens: 240_000,
      concurrentRuns: 2,
      concurrentCalls: 4,
      tokensPerRun: 15_000,
    });
    // The signed-in person's allowance is what it was.
    expect(config.free).toMatchObject({
      userDailyTokens: 60_000,
      userDailyCalls: 40,
      userConcurrentRuns: 1,
      userConcurrentCalls: 3,
    });
    expect(() => loadPublicConfig(base)).toThrow(/needs a way to sign in, or guest mode/u);
  });
});

describe('two guests', () => {
  it('cannot see, change or delete each other’s projects, and are kept apart by the database as well', async () => {
    const t = await setup();
    const a = await t.guest('203.0.113.1');
    const b = await t.guest('203.0.113.2');
    const made = await t.ask(a, 'POST', '/api/projects', fixtureInput({ name: 'Guest A project' }));
    expect(made.statusCode, made.body).toBe(201);
    const id = made.json().id as string;

    expect((await t.ask(a, 'GET', `/api/projects/${id}`)).statusCode).toBe(200);
    expect((await t.ask(b, 'GET', '/api/projects')).json().projects).toEqual([]);
    const missing = await t.ask(
      b,
      'GET',
      `/api/projects/${'00000000-0000-4000-8000-000000000000'}`,
    );
    const theirs = await t.ask(b, 'GET', `/api/projects/${id}`);
    // Another guest's project is answered exactly as one that does not exist.
    expect(theirs.statusCode).toBe(404);
    expect(theirs.json().error.code).toBe(missing.json().error.code);
    expect((await t.ask(b, 'DELETE', `/api/projects/${id}`)).statusCode).toBe(404);
    expect((await t.ask(a, 'GET', `/api/projects/${id}`)).statusCode).toBe(200);

    // The same wall in the database: a statement made for B's workspace finds none of A's rows.
    const rows = (workspaceId: string) =>
      t.repository.asTenant(workspaceId, () =>
        t.repository.extend((db) => db.prepare('SELECT id FROM projects').all()),
      );
    expect(rows(a.workspaceId).map((row) => row.id)).toEqual([id]);
    expect(rows(b.workspaceId)).toEqual([]);
    // And no guest can reach the owner's or a signed-in person's data: the account of one is not the other's.
    expect((await t.ask(b, 'GET', '/api/account')).json().projects.count).toBe(0);
  });
});

describe('the guest allowance', () => {
  it('is 80,000 tokens, 60 calls, 2 runs and 4 calls at a time, and a signed-in person keeps theirs', async () => {
    const t = await setup();
    const g = await t.guest();
    const guestView = (await t.ask(g, 'GET', '/api/usage')).json();
    expect(guestView.free).toMatchObject({
      available: true,
      today: { tokenLimit: 80_000, callLimit: 60, tokensPerRun: 15_000, runsLeft: 5 },
      lifetime: { limit: 240_000 },
      inFlight: { limit: 4 },
    });
    const person = await t.h.signIn({
      provider: 'google',
      subject: 'g-person',
      email: 'person@example.com',
    });
    const personView = (await t.ask(person, 'GET', '/api/usage')).json();
    expect(personView.free).toMatchObject({
      today: { tokenLimit: 60_000, callLimit: 40, runsLeft: 4 },
      lifetime: { limit: 300_000 },
      inFlight: { limit: 3 },
    });
    // The same call is let in for a guest and refused for a person: it is the allowance that differs.
    const personWorkspace = t.repository.asSystem(() =>
      t.context.users.find('google', 'g-person'),
    )!.workspaceId;
    const hold = { funding: 'free' as const, tokens: 70_000, microUsd: 0 };
    expect(() => t.context.ledger.reserve({ workspaceId: g.workspaceId, ...hold })).not.toThrow();
    expect(() => t.context.ledger.reserve({ workspaceId: personWorkspace, ...hold })).toThrow(
      LedgerRefusal,
    );
  });

  it('runs out: the page is told, the model is not called, and the next call says what to do', async () => {
    const t = await setup();
    const g = await t.guest();
    await t.call(g.workspaceId);
    expect(t.foundry.seen).toHaveLength(1);
    // Use up the day.
    t.context.ledger.settle(
      t.context.ledger.reserve({
        workspaceId: g.workspaceId,
        funding: 'free',
        tokens: 10,
        microUsd: 0,
      }),
      { inputTokens: 40_000, outputTokens: 39_000, reasoningTokens: null, microUsd: 0 },
    );
    const view = (await t.ask(g, 'GET', '/api/usage')).json();
    expect(view.free).toMatchObject({ available: false, reason: 'user-cap' });
    const before = t.foundry.seen.length;
    await expect(t.call(g.workspaceId)).rejects.toMatchObject({
      statusCode: 429,
      code: 'FREE_TIER_USER_CAP',
    });
    expect(t.foundry.seen).toHaveLength(before);
    // Another guest is not held by it.
    const other = await t.guest('203.0.113.50');
    await expect(t.call(other.workspaceId)).resolves.toEqual({ ok: true });
  });

  it('allows four calls at once and refuses a fifth, and counts calls against the day', async () => {
    const t = await setup({ FREE_GUEST_DAILY_CALLS: '6' });
    const g = await t.guest();
    const ledger = t.context.ledger;
    const held = [1, 2, 3, 4].map(() =>
      ledger.reserve({ workspaceId: g.workspaceId, funding: 'free', tokens: 100, microUsd: 0 }),
    );
    expect(() =>
      ledger.reserve({ workspaceId: g.workspaceId, funding: 'free', tokens: 100, microUsd: 0 }),
    ).toThrow(expect.objectContaining({ reason: 'concurrent' }));
    for (const reservation of held) {
      ledger.settle(reservation, {
        inputTokens: 10,
        outputTokens: 10,
        reasoningTokens: null,
        microUsd: 0,
      });
    }
    ledger.settle(
      ledger.reserve({ workspaceId: g.workspaceId, funding: 'free', tokens: 100, microUsd: 0 }),
      { inputTokens: 10, outputTokens: 10, reasoningTokens: null, microUsd: 0 },
    );
    ledger.settle(
      ledger.reserve({ workspaceId: g.workspaceId, funding: 'free', tokens: 100, microUsd: 0 }),
      { inputTokens: 10, outputTokens: 10, reasoningTokens: null, microUsd: 0 },
    );
    // Six calls have been made: the seventh is over the day's calls.
    expect(() =>
      ledger.reserve({ workspaceId: g.workspaceId, funding: 'free', tokens: 100, microUsd: 0 }),
    ).toThrow(expect.objectContaining({ reason: 'user-cap' }));
  });

  it('lets a guest queue two runs at once and refuses a third', async () => {
    const t = await setup({ SWARM_ROLE: 'api' });
    const g = await t.guest();
    const made = async (name: string) =>
      (await t.ask(g, 'POST', '/api/projects', fixtureInput({ name }))).json().id as string;
    const [first, second, third] = [await made('One'), await made('Two'), await made('Three')];
    const run = (id: string) => t.ask(g, 'POST', `/api/projects/${id}/run`, {});
    expect((await run(first!)).statusCode).toBe(202);
    expect((await run(second!)).statusCode).toBe(202);
    const refused = await run(third!);
    expect(refused.statusCode).toBe(429);
    expect(refused.json().error.code).toBe('RUN_IN_PROGRESS');
  });
});

describe('new guests are limited by address', () => {
  it('lets one address make ten an hour (here three), another address its own, and the hour pass', async () => {
    let at = Date.parse('2026-11-07T10:00:00Z');
    const t = await setup({ PUBLIC_GUESTS_PER_IP_PER_HOUR: '3' }, { now: () => at });
    for (let i = 0; i < 3; i += 1) expect((await t.start('198.51.100.10')).statusCode).toBe(200);
    const refused = await t.start('198.51.100.10');
    expect(refused.statusCode).toBe(429);
    expect(refused.json().error.code).toBe('RATE_LIMITED');
    expect(t.context.users.count()).toBe(3);
    // Another address is not held by it.
    expect((await t.start('198.51.100.11')).statusCode).toBe(200);
    // The refusal is counted and recorded without the address.
    expect(t.context.ledger.blockedByReason(1)['guest-rate-limited']).toBe(1);
    expect(t.audit()).toContain('public.guest.refused');
    const stored = JSON.stringify(
      t.repository.asSystem(() =>
        t.repository.extend((db) => db.prepare('SELECT id, ip_hash FROM signup_log').all()),
      ),
    );
    expect(stored).not.toContain('198.51.100');
    // An hour later it may make more.
    at += HOUR + 60_000;
    expect((await t.start('198.51.100.10')).statusCode).toBe(200);
  });

  it('holds all new guests together to an hourly total, and leaves the sign-up allowance alone', async () => {
    const t = await setup({
      PUBLIC_GUESTS_PER_HOUR: '2',
      PUBLIC_SIGNUPS_PER_IP_PER_DAY: '1',
      PUBLIC_SIGNUPS_PER_HOUR: '1',
    });
    expect((await t.start('198.51.100.1')).statusCode).toBe(200);
    expect((await t.start('198.51.100.2')).statusCode).toBe(200);
    expect((await t.start('198.51.100.3')).statusCode).toBe(429);
    // Guests were made from three addresses, and not one of them used a sign-up.
    expect(t.context.signups.allows('198.51.100.1')).toBe(true);
    const person = await t.h.signIn({
      provider: 'google',
      subject: 'g-first',
      email: 'first@example.com',
      ip: '198.51.100.1',
    });
    expect(person.cookie).toMatch(/swarm_session=/u);
  });
});

describe('the kill switch and the owner’s key', () => {
  it('turns the free tier off and on without a sign-in, tells a guest what to do, and never calls the model while it is off', async () => {
    const t = await setup();
    const g = await t.guest();
    await expect(t.call(g.workspaceId)).resolves.toEqual({ ok: true });
    const used = t.foundry.seen.length;

    const off = await t.owner('POST', '/api/ops/free-tier/off');
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json()).toEqual({ freeTier: 'off' });
    expect((await t.ask(g, 'GET', '/api/usage')).json().free).toMatchObject({
      available: false,
      reason: 'disabled',
    });
    expect((await t.inject({ method: 'GET', url: '/api/public/session' })).json().freeTier).toEqual(
      {
        available: false,
        reason: 'disabled',
      },
    );
    await expect(t.call(g.workspaceId)).rejects.toMatchObject({
      statusCode: 429,
      code: 'FREE_TIER_DISABLED',
    });
    expect(t.foundry.seen).toHaveLength(used);
    // New guests can still start: the switch is about the model.
    expect((await t.start('203.0.113.99')).statusCode).toBe(200);

    const on = await t.owner('POST', '/api/ops/free-tier/on');
    expect(on.json()).toEqual({ freeTier: 'on' });
    await expect(t.call(g.workspaceId)).resolves.toEqual({ ok: true });
    expect(t.audit()).toEqual(
      expect.arrayContaining(['public.ops.free-tier.off', 'public.ops.free-tier.on']),
    );
  });

  it('closes and opens the door to new guests, and reads the usage', async () => {
    const t = await setup();
    const g = await t.guest();
    await t.call(g.workspaceId);
    expect((await t.owner('POST', '/api/ops/signups/off')).json()).toEqual({ signups: 'off' });
    expect((await t.start('203.0.113.60')).statusCode).toBe(403);
    // A guest that is already in keeps working.
    expect((await t.ask(g, 'GET', '/api/account')).statusCode).toBe(200);
    expect((await t.owner('POST', '/api/ops/signups/on')).json()).toEqual({ signups: 'on' });
    expect((await t.start('203.0.113.60')).statusCode).toBe(200);

    const usage = await t.owner('GET', '/api/ops/usage');
    expect(usage.statusCode, usage.body).toBe(200);
    const view = usage.json();
    expect(view.today.global.calls).toBe(1);
    expect(view.today.limits).toEqual({ tokens: 2_000_000, costUsd: 5 });
    expect(view.switches).toMatchObject({ freeTierRuntime: true, signups: true });
    expect(view.topUsers[0]).toMatchObject({ emailMasked: 'guest', calls: 1 });
  });

  it('refuses a wrong key, a missing key and a key in the address, and the key is in no log, answer or record', async () => {
    const t = await setup();
    expect(
      (await t.owner('POST', '/api/ops/free-tier/off', 'not-the-key-0000000000000000')).statusCode,
    ).toBe(401);
    expect((await t.owner('POST', '/api/ops/free-tier/on', null)).statusCode).toBe(401);
    expect((await t.owner('GET', '/api/ops/usage', 'x')).statusCode).toBe(401);
    // Only a header counts: the key in an address is not read.
    const inAddress = await t.inject({
      method: 'POST',
      url: `/api/ops/free-tier/on?key=${OWNER_KEY}`,
    });
    expect(inAddress.statusCode).toBe(401);
    expect(t.context.settings.flag('free_tier_enabled', true)).toBe(true);
    await t.owner('POST', '/api/ops/free-tier/off');
    await t.owner('POST', '/api/ops/free-tier/on');
    const everything = [
      t.logs.join(''),
      t.answers.join('\n'),
      JSON.stringify(t.repository.asSystem(() => t.repository.audit.list({ limit: 500 }))),
    ].join('\n');
    expect(everything).not.toContain(OWNER_KEY);

    // Without a configured key there is nothing to knock on.
    const none = await setup({ PUBLIC_OWNER_KEY_SHA256: '' });
    expect((await none.owner('POST', '/api/ops/free-tier/off')).statusCode).toBe(404);
    expect((await none.owner('GET', '/api/ops/usage')).statusCode).toBe(404);
  });
});

describe('guest data does not stay', () => {
  it('is deleted after a day without use, with everything that was the guest’s, and not before', async () => {
    let at = Date.parse('2026-11-07T10:00:00Z');
    const t = await setup({}, { now: () => at });
    const used = await t.guest('203.0.113.1');
    const idle = await t.guest('203.0.113.2');
    const person = await t.h.signIn({
      provider: 'google',
      subject: 'g-keeps',
      email: 'keeps@example.com',
    });
    const made = await t.ask(used, 'POST', '/api/projects', fixtureInput({ name: 'Kept a while' }));
    expect(made.statusCode, made.body).toBe(201);
    await t.ask(idle, 'POST', '/api/projects', fixtureInput({ name: 'Left behind' }));

    // The first guest is used ten minutes in, and so is a guest that is still there.
    at += 10 * 60_000;
    expect((await t.ask(used, 'GET', '/api/account')).statusCode).toBe(200);
    at += 24 * HOUR - 5 * 60_000;
    t.edition.housekeeping();
    // The one nobody used is past its day; the one that was used ten minutes in has a few minutes left.
    expect(t.context.users.get(idle.userId)).toBeNull();
    expect(t.context.users.get(used.userId)).not.toBeNull();
    // Nothing of the idle guest is left, and a person who signed in is not a guest and is not touched.
    const left = t.repository.asSystem(() =>
      t.repository.extend((db) => ({
        projects: db
          .prepare('SELECT COUNT(*) AS n FROM projects WHERE tenant_id = ?')
          .get(idle.workspaceId)?.n,
        members: db
          .prepare('SELECT COUNT(*) AS n FROM workspace_members WHERE tenant_id = ?')
          .get(idle.workspaceId)?.n,
        sessions: db
          .prepare('SELECT COUNT(*) AS n FROM sessions WHERE tenant_id = ?')
          .get(idle.workspaceId)?.n,
      })),
    );
    expect(left).toEqual({ projects: 0, members: 0, sessions: 0 });
    expect(t.context.users.find('google', 'g-keeps')).not.toBeNull();
    expect(person.cookie).toMatch(/swarm_session=/u);

    at += 15 * 60_000;
    t.edition.housekeeping();
    expect(t.context.users.get(used.userId)).toBeNull();
    expect(t.context.users.find('google', 'g-keeps')).not.toBeNull();
    const records = t.repository.asSystem(() => t.repository.audit.list({ limit: 500 }));
    const purged = records.filter((event) => event.action === 'public.guest.purged');
    expect(purged).toHaveLength(2);
    // The record says that it happened, with a count, and names no one.
    expect(JSON.stringify(purged)).not.toContain('guest.invalid');
  });

  it('is deleted at once when the guest says so, and the session ends with it', async () => {
    const t = await setup();
    const g = await t.guest();
    await t.ask(g, 'POST', '/api/projects', fixtureInput({ name: 'Mine' }));
    const wrong = await t.ask(g, 'DELETE', '/api/account', { confirm: 'yes' });
    expect(wrong.statusCode).toBe(400);
    const gone = await t.ask(g, 'DELETE', '/api/account', { confirm: 'delete my account' });
    expect(gone.statusCode).toBe(204);
    expect(String(gone.headers['set-cookie'])).toContain('Max-Age=0');
    expect((await t.ask(g, 'GET', '/api/account')).statusCode).toBe(401);
    expect(t.context.users.get(g.userId)).toBeNull();
    // Nothing is kept for a guest: there is no one to recognise.
    const kept = t.repository.asSystem(() =>
      t.repository.extend((db) => db.prepare('SELECT COUNT(*) AS n FROM deleted_accounts').get()),
    );
    expect(Number(kept?.n)).toBe(0);
  });
});
