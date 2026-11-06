import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from '../../src/errors.js';
import { loadConfig } from '../../src/config.js';
import { createModelFactory } from '../../src/models/factory.js';
import { ProviderTelemetry } from '../../src/models/telemetry.js';
import { runWithFunding } from '../../src/public/funding.js';
import { fixtureInput } from '../fixtures.js';
import { FakeFoundry, foundryEnvironment } from '../support/public-foundry.js';
import { publicApp, publicEnvironment, type PublicHarness } from '../support/public-idp.js';

const csrf = { 'x-swarm-csrf': '1', 'content-type': 'application/json' };

const model = foundryEnvironment;

const open: PublicHarness[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((made) => made.close()));
});

async function setup(environment: Record<string, string> = {}, foundry = new FakeFoundry()) {
  const h = await publicApp(
    { ...model, ...environment },
    { public: { modelFetcher: foundry.fetch } },
  );
  open.push(h);
  const alice = await h.signIn({
    provider: 'google',
    subject: 'g-alice',
    email: 'alice@example.com',
  });
  const bob = await h.signIn({ provider: 'github', subject: '2002', email: 'bob@example.com' });
  const user = (provider: 'google' | 'github', subject: string) =>
    h.built.repository.asSystem(() =>
      h.built.publicEdition!.context.users.find(provider, subject)!,
    );
  const a = user('google', 'g-alice');
  const b = user('github', '2002');
  const factory = createModelFactory(
    h.config,
    new ProviderTelemetry(h.config.provider),
    null,
    h.built.publicEdition!.funding,
  );
  const schema = z.object({ ok: z.boolean() });
  /** One model call, made for a workspace on the free tier, as a request or a run would make it. */
  const call = (
    workspaceId: string,
    role: 'extraction' | 'actor' | 'synthesis' | null = 'extraction',
  ) =>
    runWithFunding({ workspaceId, funding: 'free', byok: null }, () =>
      factory(() => undefined).json(
        schema,
        'Say ok.',
        { question: 'q' },
        new AbortController().signal,
        4_000,
        role ? { route: { role } } : {},
      ),
    );
  const ledger = h.built.publicEdition!.context.ledger;
  return { h, foundry, alice, bob, a, b, call, ledger, factory, schema };
}

describe('the free tier is held to its caps before a call is made', () => {
  it('makes the call on the operator’s non-reasoning deployment, held to the output cap of its role', async () => {
    const t = await setup();
    await expect(t.call(t.a.workspaceId, 'extraction')).resolves.toEqual({ ok: true });
    // The deployment is declared as one that does not reason, so the first call is not a request bound to be refused.
    expect(t.foundry.seen).toHaveLength(1);
    const real = t.foundry.seen;
    expect(real[0]!.body).not.toHaveProperty('reasoning_effort');
    expect(real[0]!.body.model).toBe('gpt-4.1-mini');
    expect(real[0]!.url).toContain('free-tier.openai.azure.com');
    expect(Number(real[0]!.body.max_completion_tokens)).toBeLessThanOrEqual(1_500);
    await expect(t.call(t.a.workspaceId, 'synthesis')).resolves.toEqual({ ok: true });
    expect(Number(t.foundry.seen.at(-1)!.body.max_completion_tokens)).toBeLessThanOrEqual(2_000);
    await expect(t.call(t.a.workspaceId, null)).resolves.toEqual({ ok: true });
    expect(Number(t.foundry.seen.at(-1)!.body.max_completion_tokens)).toBeLessThanOrEqual(2_000);
    expect(t.foundry.seen.some((entry) => 'reasoning_effort' in entry.body)).toBe(false);
  });

  it('counts the tokens the provider reported, hidden reasoning included', async () => {
    const t = await setup();
    t.foundry.reply = () =>
      t.foundry.ok({ prompt_tokens: 300, completion_tokens: 700, reasoning: 600 });
    await t.call(t.a.workspaceId);
    const mine = t.ledger.userState(t.a.workspaceId).free;
    expect(mine).toMatchObject({
      calls: 1,
      inputTokens: 300,
      outputTokens: 700,
      reasoningTokens: 600,
      reservedTokens: 0,
      reservedCalls: 0,
    });
    expect(mine.microUsd).toBe(Math.round(300 * 0.4 + 700 * 1.6));
    expect(t.ledger.globalState()).toMatchObject({ calls: 1, inputTokens: 300, outputTokens: 700 });
  });

  it('charges a reply that was cut off for what it used, and asks once more with room', async () => {
    const t = await setup();
    t.foundry.reply = (call) =>
      call <= 1
        ? t.foundry.ok(
            { prompt_tokens: 200, completion_tokens: 900, reasoning: 0 },
            '{"ok":',
            'length',
          )
        : t.foundry.ok();
    await expect(t.call(t.a.workspaceId)).resolves.toEqual({ ok: true });
    const mine = t.ledger.userState(t.a.workspaceId).free;
    expect(mine.calls).toBe(2);
    expect(mine.outputTokens).toBe(900 + 80);
    expect(mine.reservedTokens).toBe(0);
  });

  it('refuses a person who has used the day’s tokens, with a message that says what to do, and sends nothing', async () => {
    const t = await setup({ FREE_USER_DAILY_TOKENS: '3000', FREE_USER_DAILY_CALLS: '100' });
    let refused: unknown = null;
    let sent = 0;
    for (let i = 0; i < 10 && !refused; i++) {
      try {
        await t.call(t.a.workspaceId);
        sent += 1;
      } catch (error) {
        refused = error;
      }
    }
    expect(refused).toBeInstanceOf(AppError);
    expect(refused).toMatchObject({ statusCode: 429, code: 'FREE_TIER_USER_CAP' });
    expect(String((refused as Error).message)).toBe(
      'You have used today’s free runs. They come back at 00:00 UTC, or you can use your own key now.',
    );
    expect(t.foundry.seen).toHaveLength(sent);
    // Never past the cap, with what the calls really used or with what was held for them.
    const state = t.ledger.userState(t.a.workspaceId).free;
    expect(state.inputTokens + state.outputTokens + state.reservedTokens).toBeLessThanOrEqual(
      3_000,
    );
    // Somebody else on the same day is not held to it.
    await expect(t.call(t.b.workspaceId)).resolves.toEqual({ ok: true });
  });

  it('refuses everyone when the free tier as a whole is used up, and says so, and does not spend', async () => {
    // A run is taken to cost 5,000 tokens here, so the tier counts as used up when less than that is left of its 12,000.
    const t = await setup({
      FREE_GLOBAL_DAILY_TOKENS: '12000',
      FREE_USER_DAILY_TOKENS: '100000',
      FREE_USER_LIFETIME_TOKENS: '1000000',
      FREE_TOKENS_PER_RUN: '5000',
    });
    t.foundry.reply = () =>
      t.foundry.ok({ prompt_tokens: 600, completion_tokens: 400, reasoning: 0 });
    const before = (await t.h.app.inject({ method: 'GET', url: '/api/public/session' })).json();
    expect(before.freeTier).toEqual({ available: true, reason: null });
    let refused: unknown = null;
    let sent = 0;
    for (let i = 0; i < 40 && !refused; i++) {
      try {
        await t.call(i % 2 ? t.a.workspaceId : t.b.workspaceId);
        sent += 1;
      } catch (error) {
        refused = error;
      }
    }
    expect(sent).toBeGreaterThan(3);
    expect(refused).toMatchObject({ statusCode: 429, code: 'FREE_TIER_GLOBAL_CAP' });
    expect(String((refused as Error).message)).toBe(
      'The free tier is used up for today. Bring your own key, or come back tomorrow.',
    );
    expect(t.foundry.seen).toHaveLength(sent);
    const used = t.ledger.globalState();
    expect(used.inputTokens + used.outputTokens + used.reservedTokens).toBeLessThanOrEqual(12_000);
    const session = (await t.h.app.inject({ method: 'GET', url: '/api/public/session' })).json();
    expect(session.freeTier).toEqual({ available: false, reason: 'global-cap' });
    const status = (await t.h.app.inject({ method: 'GET', url: '/api/public/status' })).json();
    expect(status).toMatchObject({
      status: 'degraded',
      freeTier: { available: false, reason: 'global-cap' },
    });
    const usage = (
      await t.h.app.inject({
        method: 'GET',
        url: '/api/usage',
        headers: { cookie: t.alice.cookie },
      })
    ).json();
    expect(usage.free).toMatchObject({ available: false, reason: 'global-cap' });
    expect(usage.free.today.runsLeft).toBe(0);
  });

  it('refuses a person at their lifetime allowance', async () => {
    const t = await setup({ FREE_USER_LIFETIME_TOKENS: '2500', FREE_USER_DAILY_TOKENS: '100000' });
    let refused: unknown = null;
    for (let i = 0; i < 10 && !refused; i++) {
      try {
        await t.call(t.a.workspaceId);
      } catch (error) {
        refused = error;
      }
    }
    expect(refused).toMatchObject({ code: 'FREE_TIER_LIFETIME_CAP' });
    expect(String((refused as Error).message)).toBe(
      'You have used the free allowance for this account. Bring your own key to keep going.',
    );
  });

  it('never lets concurrent calls pass a cap, however they interleave', async () => {
    const t = await setup({
      FREE_GLOBAL_DAILY_TOKENS: '20000',
      FREE_USER_DAILY_TOKENS: '1000000',
      FREE_USER_LIFETIME_TOKENS: '10000000',
      FREE_USER_DAILY_CALLS: '1000',
      FREE_USER_CONCURRENT_CALLS: '50',
    });
    const overshoots: string[] = [];
    t.foundry.inspect = () => {
      const g = t.ledger.globalState();
      const held = g.inputTokens + g.outputTokens + g.reservedTokens;
      if (held > 20_000) overshoots.push(`held ${held} when a call was sent`);
    };
    t.foundry.reply = async () => {
      await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 15)));
      return t.foundry.ok({ prompt_tokens: 150, completion_tokens: 250, reasoning: 100 });
    };
    // Calls arrive spread over a few tens of milliseconds, so that some are settled while others are being let in.
    const results = await Promise.allSettled(
      Array.from({ length: 120 }, async (_, i) => {
        await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 40)));
        return t.call(i % 2 ? t.a.workspaceId : t.b.workspaceId, i % 3 ? 'actor' : 'extraction');
      }),
    );
    const done = results.filter((result) => result.status === 'fulfilled').length;
    const refused = results.filter(
      (result) =>
        result.status === 'rejected' &&
        ['FREE_TIER_GLOBAL_CAP', 'FREE_TIER_CONCURRENT'].includes((result.reason as AppError).code),
    ).length;
    expect(done + refused).toBe(120);
    expect(done).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
    const g = t.ledger.globalState();
    expect(g.inputTokens + g.outputTokens).toBeLessThanOrEqual(20_000);
    expect(g.inputTokens + g.outputTokens).toBe(done * 400);
    expect(g.reservedTokens).toBe(0);
    expect(g.reservedCalls).toBe(0);
    expect(overshoots).toEqual([]);
    for (const user of [t.a, t.b]) {
      const mine = t.ledger.userState(user.workspaceId).free;
      expect(mine.reservedTokens).toBe(0);
      expect(mine.reservedCalls).toBe(0);
    }
  });

  it('charges a call that was sent and never answered at its worst case, and one that never left at nothing', async () => {
    const t = await setup();
    const controller = new AbortController();
    t.foundry.reply = () => new Promise<Response>(() => undefined);
    const pending = runWithFunding(
      { workspaceId: t.a.workspaceId, funding: 'free', byok: null },
      () =>
        t
          .factory(() => undefined)
          .json(t.schema, 'Say ok.', { question: 'q' }, controller.signal, 4_000, {
            route: { role: 'extraction' },
          }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(t.foundry.seen).toHaveLength(1);
    controller.abort(new AppError(499, 'RUN_CANCELLED', 'cancelled'));
    await expect(pending).rejects.toBeDefined();
    const g = t.ledger.globalState();
    expect(g.reservedTokens).toBe(0);
    // Abandoned after it was sent: the provider may be billing for all of it, so it is counted as all of it.
    expect(g.inputTokens + g.outputTokens).toBeGreaterThan(1_000);
    expect(t.ledger.userState(t.a.workspaceId).free.calls).toBe(1);
    // A call that was stopped before it left is not charged.
    const stopped = new AbortController();
    stopped.abort(new AppError(499, 'RUN_CANCELLED', 'cancelled'));
    await expect(
      runWithFunding({ workspaceId: t.b.workspaceId, funding: 'free', byok: null }, () =>
        t
          .factory(() => undefined)
          .json(t.schema, 'Say ok.', { question: 'q' }, stopped.signal, 4_000),
      ),
    ).rejects.toBeDefined();
    expect(t.foundry.seen).toHaveLength(1);
    expect(t.ledger.userState(t.b.workspaceId).free.calls).toBe(0);
    expect(t.ledger.userState(t.b.workspaceId).free.reservedTokens).toBe(0);
  });

  it('makes no model at all for code that is not acting for a signed-in person', async () => {
    const t = await setup();
    const before = t.foundry.seen.length;
    await expect(
      t.factory(() => undefined).json(t.schema, 'x', {}, new AbortController().signal, 100),
    ).rejects.toMatchObject({ code: 'NO_FUNDING_CONTEXT' });
    expect(t.foundry.seen.length).toBe(before);
  });
});

describe('the kill switch', () => {
  it('turns the free tier off at once for everyone, by the administrator, and back on', async () => {
    const t = await setup({ PUBLIC_ADMIN_EMAILS: 'admin@example.com' });
    const admin = await t.h.signIn({
      provider: 'google',
      subject: 'g-admin',
      email: 'admin@example.com',
    });
    await expect(t.call(t.a.workspaceId)).resolves.toEqual({ ok: true });
    const off = await t.h.app.inject({
      method: 'POST',
      url: '/api/admin/free-tier',
      headers: { cookie: admin.cookie, ...csrf },
      payload: { enabled: false },
    });
    expect(off.statusCode).toBe(200);
    expect(off.json()).toMatchObject({ freeTierRuntime: false, freeTierEnv: true });
    const before = t.foundry.seen.length;
    await expect(t.call(t.a.workspaceId)).rejects.toMatchObject({
      statusCode: 429,
      code: 'FREE_TIER_DISABLED',
    });
    await expect(t.call(t.b.workspaceId)).rejects.toMatchObject({ code: 'FREE_TIER_DISABLED' });
    expect(t.foundry.seen.length).toBe(before);
    const session = (await t.h.app.inject({ method: 'GET', url: '/api/public/session' })).json();
    expect(session.freeTier).toEqual({ available: false, reason: 'disabled' });
    await expect(t.call(t.a.workspaceId)).rejects.toThrow(
      'The free tier is switched off right now. You can still use your own key.',
    );
    const on = await t.h.app.inject({
      method: 'POST',
      url: '/api/admin/free-tier',
      headers: { cookie: admin.cookie, ...csrf },
      payload: { enabled: true },
    });
    expect(on.json().freeTierRuntime).toBe(true);
    await expect(t.call(t.a.workspaceId)).resolves.toEqual({ ok: true });
    // Only an administrator may.
    const stranger = await t.h.app.inject({
      method: 'POST',
      url: '/api/admin/free-tier',
      headers: { cookie: t.alice.cookie, ...csrf },
      payload: { enabled: false },
    });
    expect(stranger.statusCode).toBe(403);
  });

  it('is switched off by the environment, which the run-time switch cannot undo', async () => {
    const t = await setup({ FREE_TIER_ENABLED: 'false', PUBLIC_ADMIN_EMAILS: 'admin@example.com' });
    const admin = await t.h.signIn({
      provider: 'google',
      subject: 'g-admin',
      email: 'admin@example.com',
    });
    await expect(t.call(t.a.workspaceId)).rejects.toMatchObject({ code: 'FREE_TIER_DISABLED' });
    await t.h.app.inject({
      method: 'POST',
      url: '/api/admin/free-tier',
      headers: { cookie: admin.cookie, ...csrf },
      payload: { enabled: true },
    });
    await expect(t.call(t.a.workspaceId)).rejects.toMatchObject({ code: 'FREE_TIER_DISABLED' });
  });

  it('is switched off by the budget automation with its key, and by nothing else, and can only be turned off', async () => {
    const key = 'budget-key-0123456789-abcdef';
    const { createHash } = await import('node:crypto');
    const t = await setup({
      PUBLIC_OPS_KEY_SHA256: createHash('sha256').update(key).digest('hex'),
    });
    const url = '/api/ops/free-tier/off';
    expect((await t.h.app.inject({ method: 'POST', url })).statusCode).toBe(401);
    expect(
      (
        await t.h.app.inject({
          method: 'POST',
          url,
          headers: { authorization: 'Bearer not-the-key-not-the-key' },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await t.h.app.inject({ method: 'POST', url: `${url}?key=not-the-key-not-the-key` }))
        .statusCode,
    ).toBe(401);
    await expect(t.call(t.a.workspaceId)).resolves.toEqual({ ok: true });
    // Azure's action group sends a JSON body and cannot set a header, so the key may come in the query.
    const off = await t.h.app.inject({
      method: 'POST',
      url: `${url}?key=${key}`,
      headers: { 'content-type': 'application/json' },
      payload: { schemaId: 'azureMonitorCommonAlertSchema' },
    });
    expect(off.statusCode).toBe(200);
    expect(off.json()).toEqual({ freeTier: 'off' });
    await expect(t.call(t.a.workspaceId)).rejects.toMatchObject({ code: 'FREE_TIER_DISABLED' });
    const audit = t.h.built.repository.asSystem(() =>
      t.h.built.repository.audit.list({ limit: 100 }),
    );
    expect(audit.some((event) => event.action === 'public.ops.free-tier.off')).toBe(true);
    expect(JSON.stringify(audit)).not.toContain(key);
    // Without a configured key the endpoint is not there.
    const none = await setup();
    expect((await none.h.app.inject({ method: 'POST', url: `${url}?key=${key}` })).statusCode).toBe(
      404,
    );
  });
});

describe('what a person is shown of their own use', () => {
  it('says how many free runs are left today, and how many tokens and calls were used', async () => {
    const t = await setup({ FREE_TOKENS_PER_RUN: '5000', FREE_USER_DAILY_TOKENS: '60000' });
    const fresh = (
      await t.h.app.inject({
        method: 'GET',
        url: '/api/usage',
        headers: { cookie: t.alice.cookie },
      })
    ).json();
    expect(fresh).toMatchObject({
      funding: 'free',
      free: {
        available: true,
        reason: null,
        today: {
          calls: 0,
          callLimit: 40,
          tokens: 0,
          tokenLimit: 60_000,
          runsLeft: 12,
          tokensPerRun: 5_000,
        },
        lifetime: { tokens: 0, limit: 300_000 },
        inFlight: { calls: 0, limit: 3 },
      },
      byok: { enabled: true, today: { calls: 0, tokens: 0 } },
    });
    expect(new Date(fresh.free.resetsAt).getUTCHours()).toBe(0);
    await t.call(t.a.workspaceId);
    const used = (
      await t.h.app.inject({
        method: 'GET',
        url: '/api/usage',
        headers: { cookie: t.alice.cookie },
      })
    ).json();
    expect(used.free.today).toMatchObject({ calls: 1, tokens: 200 });
    expect(used.free.lifetime.tokens).toBe(200);
    // Bob sees nothing of Alice's use.
    const other = (
      await t.h.app.inject({ method: 'GET', url: '/api/usage', headers: { cookie: t.bob.cookie } })
    ).json();
    expect(other.free.today.tokens).toBe(0);
    expect((await t.h.app.inject({ method: 'GET', url: '/api/usage' })).statusCode).toBe(401);
  });

  it('shows the administrator spend by day, the top accounts, and what was refused, and nobody else', async () => {
    const t = await setup({
      PUBLIC_ADMIN_EMAILS: 'admin@example.com',
      FREE_USER_DAILY_TOKENS: '4000',
    });
    const admin = await t.h.signIn({
      provider: 'google',
      subject: 'g-admin',
      email: 'admin@example.com',
    });
    await t.call(t.a.workspaceId);
    await t.call(t.b.workspaceId);
    // Alice goes on until she is refused; the refusals are what the page counts.
    for (let i = 0; i < 20; i++) await t.call(t.a.workspaceId).catch(() => undefined);
    const view = (
      await t.h.app.inject({
        method: 'GET',
        url: '/api/admin/usage?days=7',
        headers: { cookie: admin.cookie },
      })
    ).json();
    expect(view.days[0]).toMatchObject({ calls: expect.any(Number), tokens: expect.any(Number) });
    expect(view.days[0].tokens).toBeGreaterThan(0);
    expect(view.topUsers[0]).toMatchObject({ emailMasked: 'a***@example.com' });
    expect(view.blocked.byReason['user-cap']).toBeGreaterThan(0);
    expect(view.switches).toEqual({ freeTierEnv: true, freeTierRuntime: true, signups: true });
    expect(view.today.limits).toEqual({ tokens: 2_000_000, costUsd: 5 });
    expect(JSON.stringify(view)).not.toContain('alice@example.com');
    expect(
      (
        await t.h.app.inject({
          method: 'GET',
          url: '/api/admin/usage',
          headers: { cookie: t.alice.cookie },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('can switch an account off, and sign-ups off, and says what it did', async () => {
    const t = await setup({ PUBLIC_ADMIN_EMAILS: 'admin@example.com' });
    const admin = await t.h.signIn({
      provider: 'google',
      subject: 'g-admin',
      email: 'admin@example.com',
    });
    const off = await t.h.app.inject({
      method: 'POST',
      url: `/api/admin/users/${t.b.id}/disable`,
      headers: { cookie: admin.cookie, ...csrf },
      payload: { disabled: true },
    });
    expect(off.json()).toEqual({ accounts: [{ id: t.b.id, disabled: true }] });
    expect(
      (
        await t.h.app.inject({
          method: 'GET',
          url: '/api/account',
          headers: { cookie: t.bob.cookie },
        })
      ).statusCode,
    ).toBe(401);
    const byAddress = await t.h.app.inject({
      method: 'POST',
      url: `/api/admin/users/${encodeURIComponent('email:bob@example.com')}/disable`,
      headers: { cookie: admin.cookie, ...csrf },
      payload: { disabled: false },
    });
    expect(byAddress.json().accounts).toHaveLength(1);
    const self = await t.h.app.inject({
      method: 'POST',
      url: `/api/admin/users/${t.h.built.repository.asSystem(() => t.h.built.publicEdition!.context.users.find('google', 'g-admin')!.id)}/disable`,
      headers: { cookie: admin.cookie, ...csrf },
      payload: { disabled: true },
    });
    expect(self.statusCode).toBe(409);
    expect(
      (
        await t.h.app.inject({
          method: 'POST',
          url: '/api/admin/signups',
          headers: { cookie: admin.cookie, ...csrf },
          payload: { enabled: false },
        })
      ).json().signups,
    ).toBe(false);
    const events = (
      await t.h.app.inject({
        method: 'GET',
        url: '/api/admin/audit',
        headers: { cookie: admin.cookie },
      })
    ).json().events as { action: string }[];
    expect(events.map((event) => event.action)).toEqual(
      expect.arrayContaining(['public.admin.user', 'public.admin.signups']),
    );
    expect(JSON.stringify(events)).not.toContain('@example.com');
  });
});

describe('one run at a time', () => {
  it('lets a workspace queue one run and refuses a second until the first is done', async () => {
    const t = await setup({ SWARM_ROLE: 'api' });
    const made = async (name: string) => {
      const response = await t.h.app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: { cookie: t.alice.cookie, ...csrf },
        payload: fixtureInput({ name }),
      });
      return response.json().id as string;
    };
    const first = await made('First');
    const second = await made('Second');
    const run = (id: string, cookie = t.alice.cookie) =>
      t.h.app.inject({
        method: 'POST',
        url: `/api/projects/${id}/run`,
        headers: { cookie, ...csrf },
        payload: {},
      });
    expect((await run(first)).statusCode).toBe(202);
    const refused = await run(second);
    expect(refused.statusCode).toBe(429);
    expect(refused.json().error.code).toBe('RUN_IN_PROGRESS');
    // Another person is not held by it.
    const bobs = (
      await t.h.app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: { cookie: t.bob.cookie, ...csrf },
        payload: fixtureInput({ name: 'Bob' }),
      })
    ).json().id as string;
    expect((await run(bobs, t.bob.cookie)).statusCode).toBe(202);
    // Stopping the first frees the place.
    await t.h.app.inject({
      method: 'POST',
      url: `/api/projects/${first}/cancel`,
      headers: { cookie: t.alice.cookie, ...csrf },
      payload: {},
    });
    for (let i = 0; i < 50; i++) {
      if ((await run(second)).statusCode === 202) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('the place was not freed');
  });
});

describe('what a stranger is told about the model, and what one project may spend', () => {
  it('tells each person their own use, and nothing of the operator’s deployment or of anyone else', async () => {
    const t = await setup();
    await t.call(t.a.workspaceId);
    await t.call(t.a.workspaceId);
    const mine = (
      await t.h.app.inject({
        method: 'GET',
        url: '/api/provider/status',
        headers: { cookie: t.alice.cookie },
      })
    ).json();
    expect(mine).toMatchObject({
      mode: 'real-model',
      configured: true,
      connectivity: 'ok',
      lastError: null,
      auth: 'none',
      counters: { calls: 2, inputTokens: 240, outputTokens: 160 },
    });
    const text = JSON.stringify(mine);
    expect(text).not.toContain('gpt-4.1-mini');
    expect(text).not.toContain('free-tier.openai.azure.com');
    const others = (
      await t.h.app.inject({
        method: 'GET',
        url: '/api/provider/status',
        headers: { cookie: t.bob.cookie },
      })
    ).json();
    expect(others.counters).toMatchObject({ calls: 0, inputTokens: 0, outputTokens: 0 });
    expect((await t.h.app.inject({ method: 'GET', url: '/api/provider/status' })).statusCode).toBe(
      401,
    );
  });

  it('says why the free tier cannot be used, and makes no model call to check', async () => {
    // A run is taken to cost 3,000 of the 6,000 a person has in a day.
    const t = await setup({ FREE_USER_DAILY_TOKENS: '6000', FREE_TOKENS_PER_RUN: '3000' });
    t.foundry.reply = () =>
      t.foundry.ok({ prompt_tokens: 600, completion_tokens: 400, reasoning: 0 });
    for (let i = 0; i < 8; i++) await t.call(t.a.workspaceId).catch(() => undefined);
    const sent = t.foundry.seen.length;
    const checked = await t.h.app.inject({
      method: 'POST',
      url: '/api/provider/check',
      headers: { cookie: t.alice.cookie, ...csrf },
      payload: {},
    });
    expect(checked.statusCode).toBe(200);
    expect(checked.json()).toMatchObject({
      connectivity: 'failing',
      lastError: { code: 'FREE_TIER_USER_CAP' },
    });
    expect(t.foundry.seen.length).toBe(sent);
    // Somebody who has not used theirs is told it is fine, with no call either.
    const fine = (
      await t.h.app.inject({
        method: 'POST',
        url: '/api/provider/check',
        headers: { cookie: t.bob.cookie, ...csrf },
        payload: {},
      })
    ).json();
    expect(fine).toMatchObject({ connectivity: 'ok', lastError: null });
    expect(t.foundry.seen.length).toBe(sent);
  });

  it('keeps the deployment name and set-up notes out of the configuration a page reads', async () => {
    const t = await setup();
    const config = (
      await t.h.app.inject({
        method: 'GET',
        url: '/api/config',
        headers: { cookie: t.alice.cookie },
      })
    ).json();
    expect(config.provider).toEqual({
      name: 'foundry',
      model: null,
      configured: true,
      reason: '',
      auth: 'none',
    });
    expect(config.capabilities).toMatchObject({
      modelAssisted: true,
      authentication: 'public-session',
    });
    expect(JSON.stringify(config)).not.toContain('gpt-4.1-mini');
  });

  it('holds every project to a model limit, and will not start without one', () => {
    const environment = { ...publicEnvironment, ...model };
    expect(loadConfig(environment).modelBudget).toEqual({ callLimit: 300, tokenLimit: 400_000 });
    expect(
      loadConfig({
        ...environment,
        PROJECT_MODEL_CALL_LIMIT: '50',
        PROJECT_MODEL_TOKEN_LIMIT: '90000',
      }).modelBudget,
    ).toEqual({ callLimit: 50, tokenLimit: 90_000 });
    expect(() => loadConfig({ ...environment, PROJECT_MODEL_CALL_LIMIT: '0' })).toThrow(
      /PROJECT_MODEL_CALL_LIMIT/u,
    );
    expect(() => loadConfig({ ...environment, PROJECT_MODEL_TOKEN_LIMIT: '0' })).toThrow(
      /PROJECT_MODEL_TOKEN_LIMIT/u,
    );
    // A pilot is as it was: no limit unless it is given one.
    expect(loadConfig({}).modelBudget).toEqual({ callLimit: 0, tokenLimit: 0 });
  });
});
