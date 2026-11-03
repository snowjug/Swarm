import type { ServerConfig } from '../config.js';
import { TaskCache } from './cache.js';
import { CapabilityMemory } from './capabilities.js';
import { ModelClient, type ModelGateway, type ModelUsageSink } from './client.js';
import { budgetLimit, OperationBudget } from './cost.js';
import { entraTokenProvider, type TokenProvider } from './entra.js';
import type { RoutingConfig } from './routing-config.js';
import { createRouter, type Router } from './router.js';
import { createTaskRunner, type TaskRunner } from './runner.js';
import type { TaskObserver } from './task.js';
import type { ProviderTelemetry } from './telemetry.js';

export type ModelFactory = (
  onUsage: ModelUsageSink,
  options?: { maxCalls: number },
) => ModelGateway;

/**
 * Builds the production model factory. One Entra token provider, one telemetry collector and one
 * memory of what the deployments refuse are shared by every client, so tokens are cached once, every
 * real round trip is counted, and a deployment that does not take a parameter is found out once.
 */
export function createModelFactory(
  config: ServerConfig,
  telemetry: ProviderTelemetry,
  tokens: TokenProvider | null = config.provider.auth === 'entra'
    ? entraTokenProvider({ managedIdentityClientId: config.provider.managedIdentityClientId })
    : null,
): ModelFactory {
  const capabilities = new CapabilityMemory();
  telemetry.usePrices(config.routing.prices);
  return (onUsage, options) =>
    new ModelClient(config.provider, onUsage, undefined, options?.maxCalls ?? 16, {
      tokens,
      observer: telemetry,
      capabilities,
    });
}

interface Shared {
  router: Router;
  cache: TaskCache | null;
}

// The router and the cache belong to a configuration: one per process, in the way the configuration is.
const shared = new WeakMap<RoutingConfig, Shared>();

function sharedFor(routing: RoutingConfig): Shared {
  let found = shared.get(routing);
  if (!found) {
    found = {
      router: createRouter(routing),
      cache:
        routing.cache.mode === 'tenant'
          ? new TaskCache({ maxEntries: routing.cache.maxEntries, ttlMs: routing.cache.ttlMs })
          : null,
    };
    shared.set(routing, found);
  }
  return found;
}

/** The allowance an operation gets by configuration; null when neither a token nor a dollar limit is set. */
export function newOperationBudget(
  config: ServerConfig,
  limits: { tokens?: number; usd?: number } = {},
): OperationBudget | null {
  // Checked before they are compared with 0: a limit that is not a number must not read as none.
  const tokens = budgetLimit('token', limits.tokens ?? config.routing.operationBudget.tokens);
  const usd = budgetLimit('dollar', limits.usd ?? config.routing.operationBudget.usd);
  return tokens > 0 || usd > 0
    ? new OperationBudget({ tokens, usd, prices: config.routing.prices })
    : null;
}

export interface TaskRunnerOptions {
  /** The project's sink: it records what each call used, and refuses a call once the project's budget is. */
  onUsage: ModelUsageSink;
  /** The most provider calls of the operation, repairs and retries included. Default 16, as for any client. */
  maxCalls?: number;
  /** The operation's own allowance. Default: from configuration. Null: none. */
  budget?: OperationBudget | null;
  observer?: TaskObserver | null;
}

/**
 * The runner for one operation (one research run, one stage): routed by the configuration, held to
 * the project's budget and to an allowance of its own, cached when MODEL_CACHE=tenant, and counted.
 * With no model configured every task is answered by its rules, as `runStructuredTask(null, …)` does.
 */
export function taskRunnerFor(
  config: ServerConfig,
  createModel: ModelFactory,
  options: TaskRunnerOptions,
): TaskRunner {
  const { router, cache } = sharedFor(config.routing);
  return createTaskRunner({
    gateway: config.provider.configured
      ? createModel(options.onUsage, { maxCalls: options.maxCalls ?? 16 })
      : null,
    router,
    budgets: {
      operation: options.budget === undefined ? newOperationBudget(config) : options.budget,
      project: options.onUsage,
    },
    cache,
    observer: options.observer ?? null,
    prices: config.routing.prices,
    traceContent: config.routing.traceContent,
  });
}
