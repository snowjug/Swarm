import type { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify';
import { AppError } from '../errors.js';
import type { PublicContext } from './context.js';
import { WindowLimiter } from './limits.js';
import { storageBytes } from './storage/quota.js';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const HOUR = 3_600_000;

type Kind = 'create' | 'store' | 'fetch' | 'extract' | 'model';

/**
 * The routes that cost something: a project made, text stored, a page read from the web, a file read, and work done by a
 * model. Each has a limit of its own for an account and for an address, besides the limit on every change an account
 * makes. A route that is missing from here is still held by that general limit and by the free tier's caps; one that
 * is listed is held by a tighter one.
 */
const KIND_OF: Readonly<Record<string, Kind>> = {
  'POST /api/projects': 'create',
  'POST /api/projects/:id/evidence/documents': 'store',
  'POST /api/projects/:id/research/sources': 'store',
  'POST /api/evidence/url': 'fetch',
  'POST /api/documents/extract': 'extract',
  'POST /api/projects/:id/run': 'model',
  'POST /api/projects/:id/steps/:step': 'model',
  'POST /api/projects/:id/chat': 'model',
  'POST /api/projects/:id/analysis': 'model',
  'POST /api/projects/:id/surveys': 'model',
  'POST /api/projects/:id/research': 'model',
  'POST /api/projects/:id/critiques/run': 'model',
  'POST /api/projects/:id/actors/generate': 'model',
  'POST /api/projects/:id/stakeholders/discover': 'model',
  'POST /api/projects/:id/stakeholders/propose': 'model',
  'POST /api/projects/:id/stakeholders/add-missing': 'model',
  'POST /api/projects/:id/stakeholders/:participantId/regenerate': 'model',
  'POST /api/projects/:id/constraints/propose': 'model',
  'POST /api/projects/:id/constraints/counterfactuals': 'model',
  'POST /api/projects/:id/studio/sections/:sectionId/regenerate': 'model',
  'POST /api/projects/:id/studio/sections/:sectionId/proposal': 'model',
  'POST /api/projects/:id/brief': 'model',
  'POST /api/scenario/parse': 'model',
};

export const RATED_ROUTES: ReadonlyMap<string, string> = new Map(Object.entries(KIND_OF));

const WAIT_WORDS = (milliseconds: number): string => {
  const minutes = Math.max(1, Math.ceil(milliseconds / 60_000));
  return `You are doing that a lot. Wait ${minutes === 1 ? 'a minute' : `${minutes} minutes`}, then try again.`;
};

/**
 * What stops one account, or one address, from taking the service down or filling it: a limit on how fast things can be
 * changed, tighter ones on what costs the most, and a quota on projects and on stored text for each workspace. It runs
 * after the guard, so it knows who is asking. Everything is in this process, which with the public edition's one
 * replica is exact. A refusal is a plain 429 (or a plain quota message) that says how long to wait or what to delete,
 * and is recorded as a security event with counts and words only.
 */
export function createAbuseHook(context: PublicContext) {
  const { pub, config, repository } = context;
  const scale = config.rateLimitScale;
  const { rates } = pub;
  const make = (max: number, windowMs: number) =>
    new WindowLimiter(Math.max(1, Math.round(max * scale)), windowMs, context.now);

  const writes = make(rates.writesPer5Min, 5 * 60_000);
  const perAccount: Record<Kind, WindowLimiter> = {
    create: make(rates.createPerHour, HOUR),
    store: make(rates.storePerHour, HOUR),
    fetch: make(rates.fetchPerHour, HOUR),
    extract: make(rates.extractPerHour, HOUR),
    model: make(rates.modelPerHour, HOUR),
  };
  const perAddress: Record<Kind, WindowLimiter> = {
    create: make(rates.createPerHour * 3, HOUR),
    store: make(rates.storePerHour * 3, HOUR),
    fetch: make(rates.fetchPerHour * 3, HOUR),
    extract: make(rates.extractPerHour * 3, HOUR),
    model: make(rates.modelPerHour * 3, HOUR),
  };

  /** Written once in a while for an account and a kind, so that a person hammering a button cannot fill the log. */
  const note = (
    action: string,
    actor: string,
    kind: string,
    detail: Record<string, string> = {},
  ): void => context.auditOnce(action, actor, kind, detail);

  return function abuseHook(
    request: FastifyRequest,
    reply: FastifyReply,
    done: HookHandlerDoneFunction,
  ): void {
    const principal = request.principal;
    const url = request.routeOptions.url;
    if (!principal || !url || !url.startsWith('/api') || !UNSAFE.has(request.method)) {
      done();
      return;
    }
    const route = `${request.method} ${url}`;
    const kind = KIND_OF[route];
    const checks: { limiter: WindowLimiter; key: string; kind: string; scope: string }[] = [];
    if (kind) {
      checks.push(
        { limiter: perAccount[kind], key: principal.id, kind, scope: 'account' },
        { limiter: perAddress[kind], key: request.ip, kind, scope: 'address' },
      );
    }
    checks.push({ limiter: writes, key: principal.id, kind: 'writes', scope: 'account' });

    // Nothing is counted for a request that is refused, here or by a quota below, so a person who is turned away by the
    // address, or told that their workspace is full, is not also spending the limits of their own account.
    const over = checks.find((check) => check.limiter.retryAfterMs(check.key) > 0);
    if (over) {
      const wait = over.limiter.retryAfterMs(over.key);
      context.ledger.recordBlocked('rate-limited');
      note('public.rate.limited', principal.id, over.kind, { scope: over.scope });
      reply.header('retry-after', String(Math.max(1, Math.ceil(wait / 1_000))));
      done(new AppError(429, 'RATE_LIMITED', WAIT_WORDS(wait)));
      return;
    }

    // What a workspace may hold. Taking things away is never refused: it is how a workspace gets under its limits.
    if (kind === 'create' || kind === 'store') {
      try {
        if (kind === 'create' && repository.count(principal.tenantId) >= pub.maxProjects) {
          note('public.quota.refused', principal.id, 'projects', {});
          done(
            new AppError(
              409,
              'PROJECT_LIMIT',
              `You can keep ${pub.maxProjects} projects. Delete one you no longer need, then try again.`,
            ),
          );
          return;
        }
        const used = repository.extend((database) => storageBytes(database, principal.tenantId));
        if (used >= pub.storageQuotaBytes) {
          note('public.quota.refused', principal.id, 'storage', {});
          const megabytes = (bytes: number): string => (bytes / 1_000_000).toFixed(1);
          done(
            new AppError(
              413,
              'STORAGE_LIMIT',
              `Your workspace is full (${megabytes(used)} of ${megabytes(pub.storageQuotaBytes)} MB). Delete a project you no longer need, then try again.`,
            ),
          );
          return;
        }
      } catch (error) {
        done(error as Error);
        return;
      }
    }
    for (const check of checks) check.limiter.allow(check.key);
    done();
  };
}
