import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  HookHandlerDoneFunction,
} from 'fastify';
import { z } from 'zod';
import type { PublicGuard } from '../auth/guard.js';
import type { ServerConfig } from '../config.js';
import { AppError } from '../errors.js';
import type { FundingSource } from '../models/factory.js';
import type { InteractionService } from '../orchestration/interaction.js';
import type { Orchestrator } from '../orchestration/runner.js';
import type { Repository } from '../storage/repository.js';
import { enterScope } from '../storage/scope.js';
import { createContext, type PublicContext, type PublicEditionOptions } from './context.js';
import { enterFunding, runWithFunding, type FundingContext } from './funding.js';
import { createPublicGuard } from './guard.js';
import { publicFundingSource } from './models.js';
import { accountRoutes } from './routes/account.js';
import { createAbuseHook } from './abuse.js';
import { authRoutes } from './routes/auth.js';
import { byokRoutes } from './routes/byok.js';
import { publicProviderRoutes } from './routes/provider.js';
import { nextResetAt, usageRoutes } from './routes/usage.js';
import { byokOf } from './byok/provider.js';

export type { PublicEditionOptions } from './context.js';

export interface PublicEdition {
  context: PublicContext;
  /** Plugged into `registerAuth`. */
  guard: PublicGuard;
  /** Plugged into the model factory: how each model is reached and paid for. */
  funding: FundingSource;
  /**
   * The first `onRequest` hook: gives the request a row-security scope that nothing is yet allowed to read, which the
   * guard fills in with the caller's workspace once the caller is known.
   */
  scopeHook(request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction): void;
  /** An `onRequest` hook that runs after the guard: says what pays for the model calls of this request. */
  fundingHook(request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction): void;
  /** An `onRequest` hook that runs after the funding one: rate limits and quotas, per account and per address. */
  abuseHook(request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction): void;
  /** Hands over what the edition needs of the services that were made after it (the queue, the interaction service). */
  attach(services: { jobs: Orchestrator; interaction: InteractionService }): void;
  /** Registers the routes that belong to this edition. Needs `attach` first. */
  registerRoutes(app: FastifyInstance): void;
  /** Runs the housekeeping now: it also runs every ten minutes. Deletes the guests that nobody has used for a day. */
  housekeeping(): void;
  /** Stops what the edition runs in the background. */
  close(): void;
}

const projectParams = z.object({ id: z.uuid() });
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function createPublicEdition(input: {
  config: ServerConfig;
  repository: Repository;
  options?: PublicEditionOptions;
}): PublicEdition {
  const { config, repository } = input;
  const context = createContext(config, repository, input.options ?? {});
  const { pub } = context;
  // The repository must have been opened with this edition's storage, or its isolation is not in force.
  const ready = repository.asSystem(() =>
    repository.extend((database) => {
      try {
        database.prepare('SELECT 1 FROM public_users LIMIT 1').all();
        return true;
      } catch {
        return false;
      }
    }),
  );
  if (!ready) {
    throw new Error(
      'The public edition needs a repository opened with its storage (publicEditionStorage).',
    );
  }
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  let services: { jobs: Orchestrator; interaction: InteractionService } | null = null;

  // Housekeeping of what the edition keeps: expired sign-ins, old sign-up records, old days of usage, reservations that
  // a crashed process left, the counters of accounts that were deleted long ago, and the guests that nobody has used for
  // the retention period (with everything that was theirs).
  const purgeGuests = (): void => {
    const before = context.now() - pub.guests.retentionHours * 3_600_000;
    repository.asSystem(() => {
      for (const id of context.users.inactiveGuests(before)) {
        repository.atomic(() => {
          const report = context.users.delete(id);
          if (report) context.audit('public.guest.purged', 'system', { projects: report.projects });
        });
      }
    });
  };
  const housekeeping = (): void => {
    context.logins.purge();
    context.signups.purge();
    context.users.purgeDeleted();
    context.ledger.sweep(60 * 60_000);
    context.ledger.prune();
    purgeGuests();
  };
  const purge = setInterval(() => {
    try {
      housekeeping();
    } catch {
      // Housekeeping is retried at the next tick; it never takes a request down.
    }
  }, 10 * 60_000);
  purge.unref();

  const guard = createPublicGuard(context);
  const funding = publicFundingSource(context);

  /** One workspace holds at most this many runs at once, whatever pays for them: a guest's limit, or a person's. */
  const admit = (projectId: string): void => {
    let limit = pub.free.userConcurrentRuns;
    const active = repository.extend((database) => {
      const owner = database.prepare('SELECT tenant_id FROM projects WHERE id = ?').get(projectId);
      if (!owner) return 0;
      const tenant = String(owner.tenant_id);
      if (context.isGuestWorkspace(tenant)) limit = pub.free.guest.concurrentRuns;
      return Number(
        database
          .prepare(
            `SELECT COUNT(*) AS n FROM jobs j JOIN projects p ON p.id = j.project_id
              WHERE p.tenant_id = ? AND j.project_id <> ?
                AND j.state IN ('queued', 'running', 'retrying', 'cancelling')`,
          )
          .get(tenant, projectId)?.n ?? 0,
      );
    });
    if (active >= limit) {
      context.ledger.recordBlocked('runs-in-progress');
      throw new AppError(
        429,
        'RUN_IN_PROGRESS',
        'A run is already in progress in your workspace. Wait for it to finish, or stop it, then start this one.',
      );
    }
  };

  return {
    context,
    guard: context.options.wrapGuard ? context.options.wrapGuard(guard) : guard,
    funding,
    scopeHook(_request, _reply, done) {
      enterScope({ tenant: null, system: false }, done);
    },
    abuseHook: createAbuseHook(context),
    housekeeping,
    fundingHook(request, _reply, done) {
      const principal = request.principal;
      if (!principal) {
        done();
        return;
      }
      // What the page said about a key of its own was taken out of the request when it arrived (`takeByokHeaders`).
      const said = byokOf(request);
      if (said.kind === 'invalid') {
        done(
          new AppError(
            400,
            'INVALID_INPUT',
            said.about === 'key'
              ? 'The key you sent is not in a form this server reads. Copy it again from AI Studio.'
              : said.about === 'model'
                ? 'The model you sent is not a model name.'
                : 'That provider is not one this server can use.',
          ),
        );
        return;
      }
      let byok: FundingContext['byok'] = null;
      if (said.kind === 'ok') {
        if (!pub.byok.enabled) {
          // The key check says "switched off" in its own words. Anything else that carries a key is refused, so that a key
          // is never taken silently as a request for the free tier.
          if (request.routeOptions.url !== '/api/byok/connect') {
            done(
              new AppError(
                403,
                'NOT_AVAILABLE',
                'Using your own key is switched off on this site.',
              ),
            );
            return;
          }
        } else {
          // A key is sent over an encrypted connection or not at all, so that nothing between the person and this server
          // can read it. Behind the platform's proxy the protocol is the one it reports.
          if (pub.secureCookies && request.protocol !== 'https') {
            done(
              new AppError(
                400,
                'INSECURE_TRANSPORT',
                'Your key was not used: this connection is not encrypted. Open the site over https.',
              ),
            );
            return;
          }
          byok = said.byok;
          context.keys.put(principal.tenantId, said.byok.key, said.byok.model);
        }
      }
      const mode = byok ? 'byok' : 'free';
      // A request that changes a project may start model work on it: the project remembers what pays for it (the word
      // only, never a key), so that a run is never moved onto the owner's credits by the key going away. A project that
      // is working keeps what it began with: a later request cannot move a queued or running run to another payer.
      const id = UNSAFE.has(request.method) ? projectParams.safeParse(request.params) : null;
      if (
        id?.success &&
        !(services?.jobs.isBusy(id.data.id) || services?.interaction.isBusy(id.data.id))
      ) {
        try {
          context.projectFunding.set(id.data.id, mode);
        } catch {
          // The project is gone, or was never this caller's; the guard has already settled that.
        }
      }
      const ours: FundingContext = { workspaceId: principal.tenantId, funding: mode, byok };
      enterFunding(ours, done);
    },
    attach(attached) {
      services = attached;
      // A run is paid for as the project says, in the workspace that owns it, whenever and wherever it is picked up.
      // A run on its person's own key finds the key in memory; if it is gone the run has no model, and it does not
      // use the free tier instead.
      attached.jobs.wrapRuns((job, run) => {
        const owner = repository.asSystem(() => repository.ownership(job.projectId));
        if (!owner) return run();
        const marker = context.projectFunding.get(job.projectId) ?? 'free';
        const ours: FundingContext = {
          workspaceId: owner.tenantId,
          funding: marker,
          byok: marker === 'byok' ? context.keys.get(owner.tenantId) : null,
        };
        return runWithFunding(ours, run);
      });
      repository.jobs.setAdmission(admit);
    },
    registerRoutes(app) {
      if (!services) throw new Error('The public edition was not given its services.');
      const { jobs, interaction } = services;
      authRoutes(app, context);
      accountRoutes(app, context, {
        async stopWork(projectIds) {
          for (const id of projectIds) {
            if (jobs.isBusy(id)) {
              try {
                jobs.cancel(id);
              } catch {
                // Already stopping, or finished: the wait below is what matters.
              }
            }
          }
          const deadline = Date.now() + 5_000;
          while (
            Date.now() < deadline &&
            projectIds.some((id) => jobs.isBusy(id) || interaction.isBusy(id))
          ) {
            await sleep(100);
          }
        },
        freeTierReason: () => context.freeReason(),
        resetsAt: () => nextResetAt(context.now()),
      });
      usageRoutes(app, context);
      byokRoutes(app, context);
      publicProviderRoutes(app, context, config.rateLimitScale);
    },
    close() {
      clearInterval(purge);
      // A key is memory for a run's length: nothing of it outlives the process, and nothing outlives the edition.
      context.keys.forgetAll();
    },
  };
}
