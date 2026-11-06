import type { z } from 'zod';
import {
  MODEL_FAILURE_CODES,
  RULES_USED,
  withoutRulesUsed,
  type ModelFailureCode,
  type ProposalStop,
} from '../../../shared/model-failure.js';
import { AppError, throwIfAborted } from '../errors.js';
import type { CallReport } from './call.js';
import type { ModelGateway } from './client.js';
import { failureClause, ModelReplyError } from './diagnostics.js';
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
const NEVER_FALLBACK = new Set([
  'MODEL_REFUSED',
  'BYOK_BLOCKED',
  'RUN_CANCELLED',
  'CLIENT_DISCONNECTED',
]);

/** What each class of failure says went wrong, without saying what was done about it. */
const CAUSE: Record<Exclude<ModelFailureCode, 'MODEL_UNEXPECTED'>, string> = {
  MODEL_OUTPUT_INVALID: 'The model replied, but its answer did not pass validation',
  MODEL_TIMEOUT: 'The model did not answer in time',
  MODEL_UNREACHABLE: 'The model could not be reached',
  MODEL_RATE_LIMIT: 'The model was rate limited',
  MODEL_AUTH: 'The model rejected the server’s credentials',
  MODEL_NOT_FOUND: 'The model deployment was not found',
  MODEL_CALL_BUDGET: 'The model budget for this step was reached',
  MODEL_TOKEN_BUDGET: 'The model token budget for this operation was reached',
  MODEL_COST_BUDGET: 'The estimated model cost limit for this operation was reached',
  PROJECT_BUDGET: 'The project’s model budget was used',
  MODEL_ROUTE_UNAVAILABLE: 'No configured model deployment could serve this step',
  MODEL_PARAMETER_UNSUPPORTED: 'The model deployment refused a request setting',
  MODEL_HTTP_ERROR: 'The model service returned an error',
  MODEL_TRUNCATED: 'The model’s answer was cut short',
  MODEL_CONTEXT_LIMIT: 'The request was too large for the model',
  FREE_TIER_USER_CAP: 'Today’s free runs are used up',
  FREE_TIER_GLOBAL_CAP: 'The free tier is used up for today',
  FREE_TIER_LIFETIME_CAP: 'This account has used its free allowance',
  FREE_TIER_DISABLED: 'The free tier is switched off right now',
  FREE_TIER_CONCURRENT: 'A run is already using the free tier',
  BYOK_KEY_NEEDED: 'Your own key is not saved, so it is needed again',
  BYOK_KEY_REJECTED: 'Google did not accept your key',
  BYOK_RATE_LIMITED: 'Your Google quota is used up for the moment',
  BYOK_QUOTA: 'Your Google quota or billing does not allow this',
  BYOK_REGION: 'Google does not offer this service where it is asked from',
  BYOK_MODEL_NOT_FOUND: 'The model you chose is not available to your key',
  BYOK_BLOCKED: 'Google blocked this request for safety reasons',
};
const GENERIC_CAUSE = 'The model could not be used for this step';
const DETAIL: Record<string, string> = Object.fromEntries(
  Object.entries(CAUSE).map(([code, cause]) => [code, `${cause}${RULES_USED}`]),
);
const GENERIC_DETAIL = `${GENERIC_CAUSE}${RULES_USED}`;
/** What a stored failure may hold; `proposalInfoSchema` and the others limit it to this. */
const MAX_DETAIL = 300;

/**
 * The failure of a step the model could not do, as it may be stored and shown: fixed text for the class
 * of failure, and, when the client knows what the reply looked like, a clause of counts and closed-set
 * words about it (a cut-off reply and a whole one that was refused read differently). Nothing the model
 * said, and nothing a person put in the data, is ever in it.
 */
export const taskFailure = (code: string, error?: unknown): TaskFailure => {
  const base = DETAIL[code] ?? GENERIC_DETAIL;
  if (!(error instanceof ModelReplyError)) return { code, detail: base };
  const detail = `${base} (${failureClause(error.diagnostics)})`;
  return { code, detail: detail.length <= MAX_DETAIL ? detail : base };
};

const KNOWN_CODES: ReadonlySet<string> = new Set(MODEL_FAILURE_CODES);
/** The class a failure is recorded and shown under: its own when it has fixed wording, else `MODEL_UNEXPECTED`. */
export const modelFailureCode = (code: string): ModelFailureCode =>
  KNOWN_CODES.has(code) ? (code as ModelFailureCode) : 'MODEL_UNEXPECTED';

/** Failures that asking again as the model was asked cannot cure: the deployment, the credentials, the budget or the size of the request. */
const NOT_CURED_BY_ASKING_AGAIN: ReadonlySet<string> = new Set<ModelFailureCode>([
  'MODEL_AUTH',
  'MODEL_NOT_FOUND',
  'MODEL_ROUTE_UNAVAILABLE',
  'MODEL_PARAMETER_UNSUPPORTED',
  'PROJECT_BUDGET',
  'MODEL_TOKEN_BUDGET',
  'MODEL_COST_BUDGET',
  'MODEL_CONTEXT_LIMIT',
  'FREE_TIER_USER_CAP',
  'FREE_TIER_GLOBAL_CAP',
  'FREE_TIER_LIFETIME_CAP',
  'FREE_TIER_DISABLED',
  'BYOK_KEY_NEEDED',
  'BYOK_KEY_REJECTED',
  'BYOK_QUOTA',
  'BYOK_REGION',
  'BYOK_MODEL_NOT_FOUND',
  'BYOK_BLOCKED',
]);

/**
 * What a step answers when its model could not be used and a person is to choose: the failure as it is told
 * when nothing was done about it (what failed, and not that rules were used), and whether asking again may help.
 */
export const stopOf = (failure: TaskFailure): ProposalStop => {
  const code = modelFailureCode(failure.code);
  return {
    code,
    detail: withoutRulesUsed(failure.detail).slice(0, MAX_DETAIL),
    retryable: !NOT_CURED_BY_ASKING_AGAIN.has(code),
  };
};

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
        error,
      ),
    );
  }
}

const isValidation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'issues' in error;
