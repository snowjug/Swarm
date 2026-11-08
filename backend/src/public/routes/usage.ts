import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AdminSwitches, AdminUsageView, UsageView } from '../../../../shared/public.js';
import { principalOf } from '../../auth/guard.js';
import { AppError } from '../../errors.js';
import type { PublicContext } from '../context.js';
import { currentFunding } from '../funding.js';
import { maskEmail } from './account.js';

const sameHash = (left: string, right: string): boolean => {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
};

const enabledBody = z.object({ enabled: z.boolean() }).strict();
const disableBody = z.object({ disabled: z.boolean() }).strict();
const adminQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).default(14),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const opsQuery = z.object({ key: z.string().min(16).max(200).optional() });

/** The next UTC midnight, when a day's limits start again. */
export const nextResetAt = (now: number): string => {
  const at = new Date(now);
  return new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1),
  ).toISOString();
};

/** What a person may see of their own use, the administrator's view of everyone's, and the switches. */
export function usageRoutes(app: FastifyInstance, context: PublicContext): void {
  const { pub, config, ledger, settings, users, repository } = context;

  const switches = (): AdminSwitches => ({
    freeTierEnv: pub.free.enabled && config.provider.configured,
    freeTierRuntime: settings.flag('free_tier_enabled', true),
    signups: context.signupsOpen(),
  });

  app.get('/api/usage', async (request) => {
    const principal = principalOf(request);
    const funding = currentFunding();
    const mine = ledger.userState(principal.tenantId);
    const reason = context.freeReason(principal.tenantId);
    const free = pub.free;
    // A guest is held to a tighter set of limits than a person who signed in, and the meter shows the ones that apply.
    const limits = ledger.limitsFor(principal.tenantId);
    const tokensPerRun = context.runSizeFor(principal.tenantId);
    const used = mine.free.inputTokens + mine.free.outputTokens;
    const everyone = ledger.globalState();
    const left = Math.max(
      0,
      Math.min(
        limits.userDailyTokens - used - mine.free.reservedTokens,
        limits.userLifetimeTokens - mine.lifetimeTokens - mine.lifetimeReserved,
        free.globalDailyTokens -
          everyone.inputTokens -
          everyone.outputTokens -
          everyone.reservedTokens,
      ),
    );
    const view: UsageView = {
      funding: funding?.funding ?? 'free',
      free: {
        available: reason === null,
        reason,
        resetsAt: nextResetAt(context.now()),
        today: {
          calls: mine.free.calls,
          callLimit: limits.userDailyCalls,
          tokens: used,
          tokenLimit: limits.userDailyTokens,
          runsLeft: reason === null ? Math.floor(left / tokensPerRun) : 0,
          tokensPerRun,
        },
        lifetime: { tokens: mine.lifetimeTokens, limit: limits.userLifetimeTokens },
        inFlight: { calls: mine.free.reservedCalls, limit: limits.userConcurrentCalls },
      },
      byok: {
        enabled: pub.byok.enabled,
        today: { calls: mine.byok.calls, tokens: mine.byok.inputTokens + mine.byok.outputTokens },
      },
    };
    return view;
  });

  /** The administrator's view of everyone's use. Also read by the owner's key, with no sign-in. */
  const adminUsageView = (days: number): AdminUsageView => {
    const today = ledger.globalState();
    const top = ledger.topWorkspaces(days, 10).map((row) => {
      const user = users.getByWorkspace(row.workspaceId);
      return {
        id: user?.id ?? 'deleted',
        emailMasked: user
          ? user.provider === 'guest'
            ? 'guest'
            : maskEmail(user.email)
          : 'deleted account',
        tokens: row.tokens,
        calls: row.calls,
        disabled: user?.disabled ?? false,
      };
    });
    return {
      days: ledger.days(days).map((row) => ({
        day: row.day,
        calls: row.calls,
        tokens: row.tokens,
        reasoningTokens: row.reasoningTokens,
        costUsd: row.microUsd / 1_000_000,
        blocked: row.blocked,
      })),
      topUsers: top,
      blocked: { byReason: ledger.blockedByReason(days) },
      switches: switches(),
      today: {
        global: {
          calls: today.calls,
          tokens: today.inputTokens + today.outputTokens,
          costUsd: today.microUsd / 1_000_000,
        },
        limits: { tokens: pub.free.globalDailyTokens, costUsd: pub.free.globalDailyCostUsd },
      },
    };
  };

  app.get('/api/admin/usage', async (request) => {
    const { days } = adminQuery.parse(request.query);
    return adminUsageView(days);
  });

  app.post('/api/admin/free-tier', async (request) => {
    const { enabled } = enabledBody.parse(request.body);
    settings.setFlag('free_tier_enabled', enabled);
    context.audit('public.admin.free-tier', principalOf(request).id, { enabled });
    return switches();
  });

  app.post('/api/admin/signups', async (request) => {
    const { enabled } = enabledBody.parse(request.body);
    settings.setFlag('signups_enabled', enabled);
    context.audit('public.admin.signups', principalOf(request).id, { enabled });
    return switches();
  });

  app.post('/api/admin/users/:id/disable', async (request) => {
    const { id } = z.object({ id: z.string().min(3).max(300) }).parse(request.params);
    const { disabled } = disableBody.parse(request.body);
    const admin = principalOf(request);
    // By identifier as the usage view lists it, or `email:` and the address, to find an account by what it was reported as.
    const targets = id.startsWith('email:')
      ? users.byEmail(decodeURIComponent(id.slice('email:'.length)))
      : [users.get(id)].filter((user) => user !== null);
    if (targets.length === 0) throw new AppError(404, 'NOT_AVAILABLE', 'No such account.');
    if (targets.some((user) => user.id === admin.id)) {
      throw new AppError(
        409,
        'NOT_AVAILABLE',
        'An administrator cannot switch their own account off.',
      );
    }
    for (const user of targets) {
      users.setDisabled(user.id, disabled, disabled ? 'admin' : null);
      context.audit('public.admin.user', admin.id, { target: user.id, disabled });
    }
    return { accounts: targets.map((user) => ({ id: user.id, disabled })) };
  });

  app.get('/api/admin/audit', async (request) => {
    const { limit } = adminQuery.parse(request.query);
    const events = repository.asSystem(() => repository.audit.list({ limit: 500 }));
    return {
      events: events
        .filter((event) => event.action.startsWith('public.'))
        .slice(-limit)
        .map((event) => ({
          at: event.at,
          action: event.action,
          actor: event.actor,
          detail: event.detail,
        })),
    };
  });

  // The owner's key, with no sign-in: turns the free tier or new visitors on or off, and reads the usage. It is compared by
  // hash, in constant time, and is read from a header only (never from an address, which is logged by proxies).
  const ownerKeyOffered = (request: FastifyRequest): string | null => {
    const value = request.headers['x-swarm-owner-key'];
    return typeof value === 'string' && value.length > 0 ? value : null;
  };
  const ownerOnly = (request: FastifyRequest): void => {
    if (!pub.ownerKeySha256) throw new AppError(404, 'NOT_AVAILABLE', 'This is not available.');
    const given = ownerKeyOffered(request);
    const offered = given ? createHash('sha256').update(given).digest('hex') : '';
    if (!offered || !sameHash(offered, pub.ownerKeySha256)) {
      throw new AppError(401, 'SIGN_IN_REQUIRED', 'This is not allowed.');
    }
  };
  const ownerLimit = {
    config: { rateLimit: { max: 20 * config.rateLimitScale, timeWindow: '1 minute' } },
  };

  app.post('/api/ops/free-tier/on', ownerLimit, async (request) => {
    ownerOnly(request);
    settings.setFlag('free_tier_enabled', true);
    context.audit('public.ops.free-tier.on', 'owner');
    return { freeTier: 'on' };
  });

  for (const state of ['on', 'off'] as const) {
    app.post(`/api/ops/signups/${state}`, ownerLimit, async (request) => {
      ownerOnly(request);
      settings.setFlag('signups_enabled', state === 'on');
      context.audit(`public.ops.signups.${state}`, 'owner');
      return { signups: state };
    });
  }

  app.get('/api/ops/usage', ownerLimit, async (request) => {
    ownerOnly(request);
    return adminUsageView(adminQuery.parse(request.query).days);
  });

  // The budget automation: it can switch the free tier off, and nothing else. Its key is compared by hash, in constant time.
  // The owner's key can switch it off too, from a header, and is the only way to switch it back on without signing in.
  app.post(
    '/api/ops/free-tier/off',
    { config: { rateLimit: { max: 10 * config.rateLimitScale, timeWindow: '1 minute' } } },
    async (request) => {
      if (ownerKeyOffered(request)) {
        ownerOnly(request);
        settings.setFlag('free_tier_enabled', false);
        context.audit('public.ops.free-tier.off', 'owner');
        return { freeTier: 'off' };
      }
      if (!pub.opsKeySha256) throw new AppError(404, 'NOT_AVAILABLE', 'This is not available.');
      const header = /^Bearer (.{16,200})$/u.exec(String(request.headers.authorization ?? ''))?.[1];
      const given = header ?? opsQuery.safeParse(request.query).data?.key;
      const offered = given ? createHash('sha256').update(given).digest('hex') : '';
      if (!offered || !sameHash(offered, pub.opsKeySha256)) {
        throw new AppError(401, 'SIGN_IN_REQUIRED', 'This is not allowed.');
      }
      settings.setFlag('free_tier_enabled', false);
      context.audit('public.ops.free-tier.off', 'ops');
      return { freeTier: 'off' };
    },
  );
}
