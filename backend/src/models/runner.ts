import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError, throwIfAborted } from '../errors.js';
import { annotate, inSpan, signals } from '../telemetry/signals.js';
import { fingerprint, type CacheScope, type TaskCache } from './cache.js';
import type { CallGate, CallTicket, ModelCallRoute } from './call.js';
import type { ModelGateway, ModelUsageSink } from './client.js';
import {
  NO_COST,
  UNKNOWN_COST,
  addCosts,
  estimateCostUsd,
  estimateTokens,
  type CostEstimate,
  type OperationBudget,
  type PriceTable,
  type Reservation,
} from './cost.js';
import type { Route, RouteRequest, Router } from './router.js';
import type { SafetyFinding } from './safety.js';
import {
  runStructuredTask,
  type StructuredTask,
  type TaskObserver,
  type TaskOutcome,
} from './task.js';

/**
 * A structured task, with what the runner needs to route, cache and account for it. Everything added
 * to `StructuredTask` is optional, so a task written for `runStructuredTask` runs here unchanged.
 */
export interface RunnableTask<T> extends StructuredTask<T> {
  /**
   * Whose answer this is. Without it nothing is cached: an answer is never shared across a boundary
   * the runner was not told about.
   */
  tenantId?: string;
  /** Changes when the schema or its checks change in a way the name does not say. Default: a hash of the schema. */
  schemaVersion?: string;
  requiresReasoning?: boolean;
  /** How long a person is willing to wait for this step; a short budget lowers the time limit and the retries. */
  latencyBudgetMs?: number;
  /** The most one call of this task may cost, estimated. Needs a price for the deployment. */
  costCeilingUsd?: number;
  /** The data zone this task's text may be sent to. Only a deployment declared in it can serve the task. */
  dataZone?: string;
}

export interface RunUsage {
  calls: number;
  repairCalls: number;
  /** What the provider reported. */
  inputTokens: number;
  outputTokens: number;
  /** False when a call that succeeded reported none: the totals are then a floor, not a count. */
  reported: boolean;
}

export interface RunOutcome<T> extends TaskOutcome<T> {
  /** The deployment that answered, or the last one asked. Null when no model was asked. */
  deployment: string | null;
  usage: RunUsage;
  /** An ESTIMATE from the operator's price table. `unknown` when a deployment has no price; never a guess. */
  cost: CostEstimate;
  /** `hit`: served from the cache and no model was asked. `off`: the cache was not used for this task. */
  cache: 'hit' | 'miss' | 'off';
  /** What the provider's content safety said about the calls: blocks, and detections that let a call through. */
  safety: readonly SafetyFinding[];
}

export interface TaskBudgets {
  /** An operation's own allowance of tokens and estimated dollars, held to before every call is made. */
  operation?: OperationBudget | null;
  /** A project's budget, asked before every call, for a gateway that does not ask it itself. */
  project?: Pick<ModelUsageSink, 'admit'> | null;
}

export interface TaskRunnerDeps {
  /** Null: no model is configured, and every task is answered by its rules. */
  gateway: ModelGateway | null;
  router: Router;
  budgets?: TaskBudgets;
  /** Off unless given, and unused for a task that names no tenant. */
  cache?: TaskCache | null;
  observer?: TaskObserver | null;
  /** For the estimated cost of what was used. Without a price table every cost is unknown. */
  prices?: PriceTable;
  /** `redacted`: the span of a task carries the size and a hash of what was sent, never the text. */
  traceContent?: 'off' | 'redacted';
  /** How long a deployment that is missing or throttled is passed over. */
  cooldownMs?: number;
  now?: () => number;
}

export interface TaskRunner {
  run<T>(task: RunnableTask<T>): Promise<RunOutcome<T>>;
}

/** What a deployment can fail with that another deployment might not. */
const FAILOVER_CODES: ReadonlySet<string> = new Set([
  'MODEL_NOT_FOUND',
  'MODEL_RATE_LIMIT',
  'MODEL_TIMEOUT',
  'MODEL_HTTP_ERROR',
]);
/** What says a deployment should not be asked again for a while. */
const COOLDOWN_CODES: ReadonlySet<string> = new Set(['MODEL_NOT_FOUND', 'MODEL_RATE_LIMIT']);
/** The system text the client adds to every request, which the router should count. */
const BOUNDARY_CHARS = 2_000;

const codeOf = (error: unknown): string => (error instanceof AppError ? error.code : '');

function contextChars(task: Pick<StructuredTask<unknown>, 'instructions' | 'data'>): number {
  try {
    return BOUNDARY_CHARS + task.instructions.length + (JSON.stringify(task.data)?.length ?? 0);
  } catch {
    return BOUNDARY_CHARS + task.instructions.length;
  }
}

/** A hash of the schema's JSON form, so that a changed schema never reads an old answer. */
function schemaVersionOf(task: Pick<RunnableTask<unknown>, 'schemaVersion' | 'schema'>): string {
  if (task.schemaVersion) return task.schemaVersion;
  try {
    const form = JSON.stringify(
      z.toJSONSchema(task.schema, { io: 'input', unrepresentable: 'any' }),
    );
    return createHash('sha256').update(form).digest('hex').slice(0, 16);
  } catch {
    return 'unversioned';
  }
}

function callRoute(
  task: Pick<StructuredTask<unknown>, 'role' | 'name'>,
  route: Route,
): ModelCallRoute {
  return {
    role: task.role,
    task: task.name,
    deployment: route.deployment,
    temperature: route.temperature,
    reasoningEffort: route.reasoningEffort,
    timeoutMs: route.timeoutMs,
    retry: route.retry,
    strictSchema: route.strictSchema,
  };
}

export function createTaskRunner(deps: TaskRunnerDeps): TaskRunner {
  const prices = deps.prices ?? [];
  const now = deps.now ?? Date.now;
  const cooldownMs = deps.cooldownMs ?? 30_000;
  const passedOver = new Map<string, number>();

  const available = (): ReadonlySet<string> | undefined => {
    if (passedOver.size === 0) return undefined;
    const stamp = now();
    for (const [name, until] of passedOver) if (until <= stamp) passedOver.delete(name);
    if (passedOver.size === 0) return undefined;
    return new Set(deps.router.deployments().filter((name) => !passedOver.has(name)));
  };

  async function execute<T>(task: RunnableTask<T>): Promise<RunOutcome<T>> {
    const started = performance.now();
    const usage: RunUsage = {
      calls: 0,
      repairCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      reported: true,
    };
    const safety: SafetyFinding[] = [];
    let cost: CostEstimate = NO_COST;
    let deployment: string | null = null;
    let began = 0;
    const open = new Set<Reservation>();

    const finish = (outcome: TaskOutcome<T>, cache: RunOutcome<T>['cache']): RunOutcome<T> => {
      signals.modelTask({
        role: task.role,
        task: task.name,
        source: outcome.source,
        deployment,
        failureCode: outcome.failure?.code ?? null,
        durationMs: performance.now() - started,
      });
      return {
        ...outcome,
        deployment,
        usage: { ...usage },
        cost,
        cache,
        safety: [...new Map(safety.map((finding) => [JSON.stringify(finding), finding])).values()],
      };
    };

    throwIfAborted(task.signal);
    if (!deps.gateway) return finish(await runStructuredTask(null, task, deps.observer), 'off');

    const request: RouteRequest = {
      role: task.role,
      contextChars: contextChars(task),
      requiresReasoning: task.requiresReasoning,
      latencyBudgetMs: task.latencyBudgetMs,
      costCeilingUsd: task.costCeilingUsd,
      dataZone: task.dataZone,
      maxTokens: task.maxTokens,
    };
    let route: Route;
    try {
      route = deps.router.route({ ...request, available: available() });
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      // No deployment may serve this task (a zone, a ceiling, a size, an outage): rules answer it,
      // and the failure says why. Nothing is sent anywhere.
      const refusal: ModelGateway = { json: () => Promise.reject(error) };
      return finish(await runStructuredTask(refusal, task, deps.observer), 'off');
    }
    deployment = route.deployment;

    let scope: CacheScope | null = null;
    let input: string | null = null;
    if (deps.cache && task.tenantId) {
      input = fingerprint(task.instructions, task.data);
      scope = {
        tenantId: task.tenantId,
        role: task.role,
        taskName: task.name,
        schemaVersion: schemaVersionOf(task),
        deployment: route.deployment,
      };
    }
    let cache: RunOutcome<T>['cache'] = 'off';
    if (deps.cache && scope && input) {
      const cached = deps.cache.get(scope, input);
      if (cached !== undefined) {
        let hit: { value: T } | null = null;
        try {
          // The checks run again: they may depend on more than the data that was hashed.
          const value = task.schema.parse(cached);
          task.validate?.(value);
          hit = { value };
        } catch {
          deps.cache.delete(scope, input);
        }
        if (hit) {
          throwIfAborted(task.signal);
          signals.modelCache({ hit: true, role: task.role, task: task.name });
          deps.observer?.onTask({
            role: task.role,
            name: task.name,
            source: 'model',
            failureCode: null,
            latencyMs: performance.now() - started,
          });
          return finish({ value: hit.value, source: 'model', failure: null }, 'hit');
        }
      }
      signals.modelCache({ hit: false, role: task.role, task: task.name });
      cache = 'miss';
    }

    const gate: CallGate = {
      begin(call): CallTicket {
        deps.budgets?.project?.admit?.();
        const reservation = deps.budgets?.operation?.reserve({
          deployment: call.deployment,
          inputTokens: estimateTokens(call.inputChars),
          maxOutputTokens: call.maxOutputTokens,
        });
        if (reservation) open.add(reservation);
        began += 1;
        return {
          end(event, estimate) {
            usage.calls += 1;
            if (event.repair) usage.repairCalls += 1;
            safety.push(...(event.safety ?? []));
            const name = event.deployment ?? call.deployment;
            deployment = name;
            if (event.tokensReported) {
              usage.inputTokens += event.inputTokens;
              usage.outputTokens += event.outputTokens;
              cost = addCosts(cost, estimateCostUsd(event, name, prices));
            } else if (event.ok) {
              usage.reported = false;
              cost = addCosts(cost, UNKNOWN_COST);
            }
            // A call whose usage the provider did not give is charged at its estimate: a limit
            // that only counted reported tokens could be passed by a provider that reports none.
            reservation?.settle(
              event.tokensReported
                ? { inputTokens: event.inputTokens, outputTokens: event.outputTokens }
                : event.ok
                  ? estimate
                  : null,
            );
            if (reservation) open.delete(reservation);
          },
        };
      },
    };

    const tried = new Set<string>();
    let current = route;
    const routed: ModelGateway = {
      async json(schema, instructions, data, signal, _maxTokens, options) {
        for (;;) {
          tried.add(current.deployment);
          const before = began;
          try {
            const value = await deps.gateway!.json(
              schema,
              instructions,
              data,
              signal,
              current.maxTokens,
              { ...options, route: callRoute(task, current), gate },
            );
            if (began === before) {
              // A gateway that never asked the gate was not held by it: what it used is charged at an
              // estimate, so that an allowance cannot be passed by the way a model is reached.
              const used = {
                inputTokens: estimateTokens(contextChars(task)),
                outputTokens: estimateTokens(JSON.stringify(value)?.length ?? 0),
              };
              deps.budgets?.operation?.charge(current.deployment, used);
              usage.calls += 1;
              usage.reported = false;
              cost = addCosts(cost, UNKNOWN_COST);
            }
            return value;
          } catch (error) {
            const code = codeOf(error);
            if (COOLDOWN_CODES.has(code)) passedOver.set(current.deployment, now() + cooldownMs);
            // One more deployment is tried, once, and only for what another deployment might not do.
            if (!FAILOVER_CODES.has(code) || tried.size > 1 || signal.aborted) throw error;
            let next: Route;
            try {
              const candidates = [...(available() ?? deps.router.deployments(task.role))];
              next = deps.router.route({
                ...request,
                available: candidates.filter((name) => !tried.has(name)),
              });
            } catch {
              throw error;
            }
            current = next;
            deployment = next.deployment;
          }
        }
      },
    };

    try {
      const outcome = await runStructuredTask(
        routed,
        { ...task, maxTokens: route.maxTokens },
        deps.observer,
      );
      if (deps.cache && scope && input && outcome.source === 'model' && !outcome.failure) {
        scope.deployment = current.deployment;
        deps.cache.set(scope, input, outcome.value);
      }
      return finish(outcome, cache);
    } catch (error) {
      if (error instanceof AppError && error.code === 'MODEL_REFUSED') {
        signals.modelTask({
          role: task.role,
          task: task.name,
          source: 'refused',
          deployment,
          failureCode: error.code,
          durationMs: performance.now() - started,
        });
      }
      throw error;
    } finally {
      for (const reservation of open) reservation.settle(null);
    }
  }

  return {
    run: <T>(task: RunnableTask<T>): Promise<RunOutcome<T>> =>
      inSpan(
        'swarm.model.task',
        { 'swarm.model.role': task.role, 'swarm.model.task': task.name },
        async (span) => {
          const outcome = await execute(task);
          annotate(span, {
            'swarm.model.source': outcome.source,
            ...(outcome.deployment ? { 'swarm.model.name': outcome.deployment } : {}),
            ...(outcome.failure ? { 'swarm.error.code': outcome.failure.code } : {}),
          });
          if (deps.traceContent === 'redacted') {
            const hash = fingerprint(task.instructions, task.data);
            annotate(span, {
              'swarm.model.input_chars': contextChars(task) - BOUNDARY_CHARS,
              'swarm.model.output_chars': JSON.stringify(outcome.value)?.length ?? 0,
              ...(hash ? { 'swarm.model.input_hash': hash.slice(0, 16) } : {}),
            });
          }
          return outcome;
        },
      ),
  };
}
