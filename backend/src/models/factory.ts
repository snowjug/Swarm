import type { ServerConfig, ProviderConfig } from '../config.js';
import { AppError } from '../errors.js';
import { TaskCache } from './cache.js';
import { CapabilityMemory } from './capabilities.js';
import {
  ModelClient,
  type ModelClientDeps,
  type ModelGateway,
  type ModelUsageSink,
} from './client.js';
import { budgetLimit, OperationBudget } from './cost.js';
import { entraTokenProvider, type TokenProvider } from './entra.js';
import { cappedGateway, refusingGateway, rewordedGateway } from './gateways.js';
import type { RoutingConfig } from './routing-config.js';
import { createRouter, type Router } from './router.js';
import { createTaskRunner, type TaskRunner } from './runner.js';
import type { SpendGate } from './spend.js';
import type { ModelRole, TaskObserver } from './task.js';
import type { ModelObserver, ProviderTelemetry } from './telemetry.js';

export interface ModelFactory {
  (onUsage: ModelUsageSink, options?: { maxCalls: number }): ModelGateway;
  /**
   * What a task is routed by, and the provider it is reached through, when the model being made now is not the
   * operator's (a person's own key in the public edition); null when it is. A pilot's factory has none.
   */
  own?: () => { provider: ProviderConfig; routing: RoutingConfig } | null;
}

/**
 * How one model is to be reached and paid for, decided at the moment it is made. A pilot never decides: every model is
 * the operator's, reached as configured. The public edition decides from who is asking: the operator's deployment under
 * the free tier's gate, or the person's own provider and key.
 */
export interface ModelFunding {
  /** Where the model is reached and with what credentials. */
  provider: ProviderConfig;
  /** Test hook: the `fetch` to use. */
  fetcher?: typeof fetch;
  /** Asked before every round trip. */
  spend?: SpendGate | null;
  /** Holds each call to at most this many output tokens, by the role of the task. */
  outputCap?: ((role: ModelRole | null) => number) | null;
  /** The routing of the tasks made with this model, when it is not the operator's: a person's provider names its own models. */
  routing?: RoutingConfig;
  /** What is known of the models this funding reaches, apart from the operator's: neither can teach the other a refusal. */
  capabilities?: CapabilityMemory;
  /** Counts the round trips apart from the operator's counters. */
  observer?: ModelObserver | null;
  /** How this provider's refusals read (see `ModelClientDeps.failure`). */
  failure?: ModelClientDeps['failure'];
  /** Changes how a failure of a call reads, never whether there is one (see `rewordedGateway`). */
  reword?: ((error: unknown) => unknown) | null;
}

/** What decides, or the reason that nothing may be made. */
export type FundingSource = () => ModelFunding | AppError;

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
  funding?: FundingSource,
): ModelFactory {
  const capabilities = new CapabilityMemory(
    // In the public edition every deployment is a non-reasoning one (start-up refuses any other), so none is sent an
    // effort, and the first call to it is not a request that is bound to be refused. A pilot keeps learning it from a
    // refusal, as it always has.
    config.edition === 'public'
      ? {
          declared: Object.fromEntries(
            [
              config.routing.defaultDeployment,
              config.routing.fallbackDeployment,
              ...Object.values(config.routing.roles),
            ]
              .filter((name): name is string => Boolean(name))
              .filter((name) => config.routing.profiles[name]?.reasoning !== true)
              .map((name) => [name, { reasoningEffort: false }]),
          ),
        }
      : {},
  );
  telemetry.usePrices(config.routing.prices);
  const factory: ModelFactory = (onUsage, options) => {
    const decided = funding?.();
    if (decided instanceof AppError) return refusingGateway(decided);
    const client = new ModelClient(
      decided?.provider ?? config.provider,
      onUsage,
      decided?.fetcher,
      options?.maxCalls ?? 16,
      {
        tokens,
        observer: decided?.observer === undefined ? telemetry : decided.observer,
        capabilities: decided?.capabilities ?? capabilities,
        ...(decided?.spend ? { spend: decided.spend } : {}),
        ...(decided?.failure ? { failure: decided.failure } : {}),
      },
    );
    const capped = decided?.outputCap ? cappedGateway(client, decided.outputCap) : client;
    return decided?.reword ? rewordedGateway(capped, decided.reword) : capped;
  };
  if (funding) {
    factory.own = () => {
      const decided = funding();
      return decided instanceof AppError || !decided.routing
        ? null
        : { provider: decided.provider, routing: decided.routing };
    };
  }
  return factory;
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
  // A person's own provider names its own models and has its own limits: tasks are routed by those, not the operator's.
  const own = createModel.own?.() ?? null;
  const routing = own?.routing ?? config.routing;
  const { router, cache } = sharedFor(routing);
  return createTaskRunner({
    gateway:
      own || config.provider.configured
        ? createModel(options.onUsage, { maxCalls: options.maxCalls ?? 16 })
        : null,
    provider: (own?.provider ?? config.provider).name,
    router,
    budgets: {
      operation:
        options.budget === undefined
          ? newOperationBudget(own ? { ...config, routing } : config)
          : options.budget,
      project: options.onUsage,
    },
    cache,
    observer: options.observer ?? null,
    prices: routing.prices,
    traceContent: routing.traceContent,
  });
}
