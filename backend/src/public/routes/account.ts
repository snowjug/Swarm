import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  deleteAccountSchema,
  type AccountView,
  type FreeTierReason,
  type PublicSession,
  type PublicStatus,
} from '../../../../shared/public.js';
import { readCookie, serializeCookie } from '../../auth/cookies.js';
import { principalOf } from '../../auth/guard.js';
import { AppError } from '../../errors.js';
import type { PublicContext } from '../context.js';
import { legalText } from '../legal.js';
import { storageBytes } from '../storage/quota.js';

/** `a***@example.com`: enough for a person to recognise their own address, and for no one else to learn it. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

export interface AccountDeps {
  /** Stops what is running for these projects, and waits a moment for it to end. Best effort. */
  stopWork(projectIds: string[]): Promise<void>;
  /** Why the free tier cannot be used by anyone right now, or null. */
  freeTierReason(): FreeTierReason | null;
  /** The next UTC midnight, when the day's limits start again. */
  resetsAt(): string;
}

const legalParams = z.object({ doc: z.enum(['terms', 'privacy']) });

/** The routes of the public edition that are about the account and the site, not about a model. */
export function accountRoutes(
  app: FastifyInstance,
  context: PublicContext,
  deps: AccountDeps,
): void {
  const { pub, config, repository, users } = context;
  const secure = pub.secureCookies;

  /** Who is signed in, if anyone, without refusing the request: the page asks before it knows. */
  const peek = (request: FastifyRequest) => {
    const token = readCookie(request.headers.cookie, context.sessionCookie);
    const found = token ? repository.sessions.find(token, context.lifetime.idleMs) : null;
    if (!found) return null;
    const user = users.get(found.principal.id);
    if (!user || user.disabled || user.workspaceId !== found.principal.tenantId) return null;
    return { user, session: found.info };
  };

  const freeTier = () => {
    const reason = deps.freeTierReason();
    return { available: reason === null, reason };
  };

  app.get('/api/public/session', async (request) => {
    const who = peek(request);
    const answer: PublicSession = {
      edition: 'public',
      signedIn: who !== null,
      providers: [...context.providers.values()].map((provider) => ({
        id: provider.id,
        label: provider.label,
      })),
      signupsOpen: context.signupsOpen(),
      bot: context.bot ? { kind: 'turnstile', siteKey: context.bot.siteKey } : null,
      freeTier: freeTier(),
      byokEnabled: pub.byok.enabled,
      retentionDays: pub.deletedAccountRetentionDays,
      legal: { terms: '/legal/terms', privacy: '/legal/privacy' },
      user: who
        ? {
            emailMasked: maskEmail(who.user.email),
            provider: who.user.provider,
            isAdmin: context.isAdmin(who.user.email),
            createdAt: new Date(who.user.createdAt).toISOString(),
          }
        : null,
      session: who
        ? {
            idleExpiresAt: new Date(who.session.idleExpiresAt).toISOString(),
            expiresAt: new Date(who.session.expiresAt).toISOString(),
          }
        : null,
    };
    return answer;
  });

  app.get('/api/public/status', async () => {
    const reason = deps.freeTierReason();
    const maintenance = context.settings.get('maintenance_message');
    const answer: PublicStatus = {
      status: maintenance
        ? 'maintenance'
        : repository.ping()
          ? reason === null
            ? 'ok'
            : 'degraded'
          : 'degraded',
      freeTier: { available: reason === null, reason, resetsAt: deps.resetsAt() },
      byokEnabled: pub.byok.enabled,
      signupsOpen: context.signupsOpen(),
      message: maintenance,
      checkedAt: new Date(context.now()).toISOString(),
    };
    return answer;
  });

  app.get('/api/public/legal/:doc', async (request) => {
    const { doc } = legalParams.parse(request.params);
    return legalText(doc, context.options.legalDirectory, {
      retentionDays: pub.deletedAccountRetentionDays,
    });
  });

  app.get('/api/account', async (request) => {
    const principal = principalOf(request);
    const user = users.get(principal.id);
    if (!user) throw new AppError(401, 'SIGN_IN_REQUIRED', 'Sign in to continue.');
    const view: AccountView = {
      emailMasked: maskEmail(user.email),
      provider: user.provider,
      createdAt: new Date(user.createdAt).toISOString(),
      isAdmin: principal.platformAdmin,
      projects: { count: repository.count(principal.tenantId), limit: pub.maxProjects },
      storage: {
        usedBytes: repository.extend((database) => storageBytes(database, principal.tenantId)),
        limitBytes: pub.storageQuotaBytes,
      },
    };
    return view;
  });

  app.delete(
    '/api/account',
    { config: { rateLimit: { max: 5 * config.rateLimitScale, timeWindow: '1 hour' } } },
    async (request, reply) => {
      deleteAccountSchema.parse(request.body);
      const principal = principalOf(request);
      const projectIds = repository
        .list(1_000, 0, principal.tenantId)
        .projects.map((project) => project.id);
      await deps.stopWork(projectIds);
      // The deletion and the record that it happened are one unit: both, or neither.
      const report = repository.atomic(() => {
        const result = users.delete(principal.id);
        if (result) {
          context.audit('public.account.deleted', principal.id, {
            projects: result.projects,
            retainedCounter: result.retainedCounter,
          });
        }
        return result;
      });
      if (!report) throw new AppError(404, 'NOT_AVAILABLE', 'This account no longer exists.');
      context.keys.forget(principal.tenantId);
      return reply
        .header('set-cookie', serializeCookie(context.sessionCookie, '', { maxAge: 0, secure }))
        .code(204)
        .send();
    },
  );
}
