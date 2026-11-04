import type { z } from 'zod';
import { AppError, throwIfAborted } from '../errors.js';
import type { CallReport } from './call.js';
import type { ModelGateway } from './client.js';
import { traceTask } from './task-telemetry.js';

/**
 * The jobs a model is asked to do. A deployment may serve several roles; the role is what a router
 * uses to choose a deployment, a temperature and a budget, so a task names its role and never a model.
 */
export const MODEL_ROLES = [
  'research-planner',
  'extraction',
  'actor',
  'scenario',
  'critic',
  'synthesis',
] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];

/** `model`: a reply that passed the schema and every check. `fallback`: the rules answer was used instead. */
export type TaskSource = 'model' | 'fallback';

/**
 * Why a rules answer was used in place of a model's. It is safe to store and to show: the code is a
 * class of failure and the detail is fixed text for that class. Nothing the model said is in it.
 */
export interface TaskFailure {
  code: string;
  detail: string;
}

export interface TaskEvent {
  role: ModelRole;
  name: string;
  source: TaskSource;
  failureCode: string | null;
  latencyMs: number;
}

export interface TaskObserver {
  onTask(event: TaskEvent): void;
}

export interface StructuredTask<T> {
  role: ModelRole;
  /** A versioned name such as `actor-proposal.v1`: it is what logs, metrics and caches are keyed by. */
  name: string;
  /** Every reply is checked against it. A reply that does not pass is never used. */
  schema: z.ZodType<T>;
  /** Trusted instructions. Anything that came from a source belongs in `data`, never here. */
  instructions: string;
  /** Untrusted data: the gateway labels it as such. */
  data: unknown;
  signal: AbortSignal;
  maxTokens?: number;
  /** Server-side checks of references, bounds and uniqueness. Throw `MODEL_OUTPUT_INVALID` to reject. */
  validate?: (value: T) => void;
  /**
   * The answer rules give for the same input. It is what runs when no model is configured and what
   * stands in when a model cannot be used. It must pass `schema` and `validate` itself.
   */
  fallback: () => T;
}

export interface TaskOutcome<T> {
  value: T;
  source: TaskSource;
  /** Set only when a model was asked and its answer could not be used. Null when rules ran by design. */
  failure: TaskFailure | null;
}

/** One correction round after the first reply, as the product rule says: retry once, then fall back. */
export const TASK_REPAIRS = 1;

/** A person or a safety rule said no. Answering from rules would hide that, so it is never a fallback. */
const NEVER_FALLBACK = new Set(['MODEL_REFUSED', 'RUN_CANCELLED', 'CLIENT_DISCONNECTED']);

const DETAIL: Record<string, string> = {
  MODEL_OUTPUT_INVALID:
    'The model replied, but its answer did not pass validation, so rules were used.',
  MODEL_TIMEOUT: 'The model did not answer in time, so rules were used.',
  MODEL_UNREACHABLE: 'The model could not be reached, so rules were used.',
  MODEL_RATE_LIMIT: 'The model was rate limited, so rules were used.',
  MODEL_AUTH: 'The model rejected the server’s credentials, so rules were used.',
  MODEL_NOT_FOUND: 'The model deployment was not found, so rules were used.',
  MODEL_CALL_BUDGET: 'The model budget for this step was reached, so rules were used.',
  MODEL_TOKEN_BUDGET: 'The model token budget for this operation was reached, so rules were used.',
  MODEL_COST_BUDGET:
    'The estimated model cost limit for this operation was reached, so rules were used.',
  PROJECT_BUDGET: 'The project’s model budget was used, so rules were used.',
  MODEL_ROUTE_UNAVAILABLE:
    'No configured model deployment could serve this step, so rules were used.',
  MODEL_PARAMETER_UNSUPPORTED:
    'The model deployment refused a request setting, so rules were used.',
  MODEL_HTTP_ERROR: 'The model service returned an error, so rules were used.',
  MODEL_TRUNCATED: 'The model’s answer was cut short, so rules were used.',
  MODEL_CONTEXT_LIMIT: 'The request was too large for the model, so rules were used.',
};
const GENERIC_DETAIL = 'The model could not be used for this step, so rules were used.';

export const taskFailure = (code: string): TaskFailure => ({
  code,
  detail: DETAIL[code] ?? GENERIC_DETAIL,
});

function checked<T>(task: StructuredTask<T>, value: T): T {
  const parsed = task.schema.parse(value);
  task.validate?.(parsed);
  return parsed;
}

/**
 * Runs one structured model task under the product's output policy: the reply is validated against
 * a strict schema and the server's own checks; one correction round is allowed; and when the reply
 * still cannot be accepted, or the model cannot be used, the rules answer is returned and the reason
 * is recorded without any of the model's words. A reply that fails is never repaired by hand and
 * never read by pattern: it is either valid or it is not used.
 *
 * Cancellation and a refusal are the two things that are never answered from rules.
 *
 * Every invocation is recorded for the operators, once: a span, a duration and how it ended (see
 * `task-telemetry.ts`). The task runner records its own and runs `executeStructuredTask` instead.
 */
export async function runStructuredTask<T>(
  model: ModelGateway | null,
  task: StructuredTask<T>,
  observer?: TaskObserver | null,
): Promise<TaskOutcome<T>> {
  return traceTask(
    {
      role: task.role,
      name: task.name,
      provider: model ? model.provider : 'none',
      signal: task.signal,
    },
    (report) => executeStructuredTask(model, task, observer, report),
    (outcome) => ({ source: outcome.source, failure: outcome.failure }),
  );
}

/**
 * `runStructuredTask` without the record of the task, for code that makes its own, as the task runner
 * does. `report` is what the call tells back about itself: the deployment and the correction rounds.
 */
export async function executeStructuredTask<T>(
  model: ModelGateway | null,
  task: StructuredTask<T>,
  observer?: TaskObserver | null,
  report?: CallReport,
): Promise<TaskOutcome<T>> {
  const started = performance.now();
  const finish = (outcome: TaskOutcome<T>): TaskOutcome<T> => {
    observer?.onTask({
      role: task.role,
      name: task.name,
      source: outcome.source,
      failureCode: outcome.failure?.code ?? null,
      latencyMs: performance.now() - started,
    });
    return outcome;
  };
  const rules = (failure: TaskFailure | null): TaskOutcome<T> => {
    let value: T;
    try {
      value = checked(task, task.fallback());
    } catch (cause) {
      throw new AppError(
        500,
        'FALLBACK_INVALID',
        'The rules answer for this step did not pass its own checks.',
        { cause },
      );
    }
    return finish({ value, source: 'fallback', failure });
  };

  throwIfAborted(task.signal);
  if (!model) return rules(null);
  try {
    const value = await model.json(
      task.schema,
      task.instructions,
      task.data,
      task.signal,
      task.maxTokens,
      {
        repairs: TASK_REPAIRS,
        // The role and the name tell the provider's client which task this is, so that its calls are counted by role.
        route: { role: task.role, task: task.name },
        ...(task.validate ? { validate: task.validate } : {}),
        ...(report ? { report } : {}),
      },
    );
    // The gateway is asked to check, and is checked again: a double or a new provider must not be able to skip it.
    return finish({ value: checked(task, value), source: 'model', failure: null });
  } catch (error) {
    throwIfAborted(task.signal);
    const code = error instanceof AppError ? error.code : 'MODEL_UNEXPECTED';
    if (NEVER_FALLBACK.has(code)) throw error;
    // A reply that parsed but failed our own checks is reported as invalid output, whatever threw it.
    return rules(
      taskFailure(
        code === 'MODEL_UNEXPECTED' && isValidation(error) ? 'MODEL_OUTPUT_INVALID' : code,
      ),
    );
  }
}

const isValidation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'issues' in error;
