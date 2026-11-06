import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  HookHandlerDoneFunction,
} from 'fastify';
import type { FreeTierReason } from '../../../shared/public.js';
import type { ServerConfig } from '../config.js';
import type { Orchestrator } from '../orchestration/runner.js';
import type { InteractionService } from '../orchestration/interaction.js';
import type { PublicGuard } from '../auth/guard.js';
import type { Repository } from '../storage/repository.js';
import { enterScope } from '../storage/scope.js';
import { createContext, type PublicContext, type PublicEditionOptions } from './context.js';
import { createPublicGuard } from './guard.js';
import { accountRoutes } from './routes/account.js';
import { authRoutes } from './routes/auth.js';

export type { PublicEditionOptions } from './context.js';

export interface PublicEdition {
  context: PublicContext;
  /** Plugged into `registerAuth`. */
  guard: PublicGuard;
  /**
   * The first `onRequest` hook: gives the request a row-security scope that nothing is yet allowed to read, which the
   * guard fills in with the caller's workspace once the caller is known.
   */
  scopeHook(request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction): void;
  /** Registers the routes that belong to this edition. */
  registerRoutes(app: FastifyInstance): void;
  /** Stops what the edition runs in the background. */
  close(): void;
}

/** The next UTC midnight, when the day's limits start again. */
export const nextResetAt = (now: number): string => {
  const at = new Date(now);
  return new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1),
  ).toISOString();
};

export function createPublicEdition(input: {
  config: ServerConfig;
  repository: Repository;
  jobs: Orchestrator;
  interaction: InteractionService;
  options?: PublicEditionOptions;
}): PublicEdition {
  const { config, repository, jobs, interaction } = input;
  const context = createContext(config, repository, input.options ?? {});
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

  const freeTierReason = (): FreeTierReason | null => {
    if (!context.pub.free.enabled || !config.provider.configured) return 'disabled';
    if (!context.settings.flag('free_tier_enabled', true)) return 'disabled';
    return null;
  };

  // Housekeeping of what the edition keeps: expired sign-ins, old sign-up records, deleted accounts' counters.
  const purge = setInterval(() => {
    try {
      context.logins.purge();
      context.signups.purge();
      context.users.purgeDeleted();
    } catch {
      // Housekeeping is retried at the next tick; it never takes a request down.
    }
  }, 10 * 60_000);
  purge.unref();

  const guard = createPublicGuard(context);
  return {
    context,
    guard: context.options.wrapGuard ? context.options.wrapGuard(guard) : guard,
    scopeHook(_request, _reply, done) {
      enterScope({ tenant: null, system: false }, done);
    },
    registerRoutes(app) {
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
        freeTierReason,
        resetsAt: () => nextResetAt(context.now()),
      });
    },
    close() {
      clearInterval(purge);
    },
  };
}
