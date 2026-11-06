import type { Span } from '@opentelemetry/api';
import type { z } from 'zod';
import type { ProviderName } from '../../../shared/types.js';
import { AppError, publicFailure } from '../errors.js';
import { safeAttributes } from '../telemetry/attributes.js';
import { annotate, failSpan, signals, tracer } from '../telemetry/signals.js';
import type { CallReport } from './call.js';
import type { JsonOptions, ModelGateway } from './client.js';
import type { ModelRole, TaskFailure, TaskSource } from './task.js';

/**
 * What the product tells its operators about each structured model task, once per invocation: a
 * `swarm.model.task` span and a `swarm.model.task.duration` measurement (and, when rules stood in for
 * a model, a `swarm.model.fallbacks` count), by task, role, provider kind and how the task ended.
 *
 * Everything a record carries is an enumeration or a number. The task is named from the closed list
 * below, and any other name is recorded as `other`, so that a name cannot be a place for text, an id
 * or an address; the role, the provider kind and the outcome are closed lists as well; and the names
 * still pass through the allow-list of `telemetry/attributes.ts`. No prompt, reply, id or address has
 * a parameter to go in. With telemetry off nothing is recorded and nothing is paid for, and nothing
 * here ever throws into the work it observes: a record that fails is not made.
 *
 * Three places record a task, and none of them nests in another: `runStructuredTask` (a task with a
 * rules answer of its own), the task runner (the same, routed, held to a budget and cached) and
 * `tracedGateway` (a call that asks the model for JSON and handles a failure itself).
 */

/**
 * The structured tasks of the product, by name, and the role that does each. A task that is not here is
 * recorded as `other` until it is added: `telemetry-model.test.ts` fails if the code names a task that
 * this list does not, or this list names one that the code does not.
 */
export const MODEL_TASKS = {
  // Research and the question
  'research-plan.v1': 'research-planner',
  'scenario-frame.v1': 'scenario',
  // The sources: what they say and how it fits together
  'ontology.v1': 'extraction',
  'source-graph.v1': 'extraction',
  // The people and the limits of the decision
  'participant-proposal.v1': 'actor',
  'participant-regeneration.v1': 'actor',
  'key-actor-refinement.v1': 'actor',
  'stakeholder-proposal.v1': 'actor',
  'constraint-proposal.v1': 'scenario',
  // Checking and challenging
  'critic-review.v1': 'critic',
  'claim-entailment.v1': 'critic',
  // The guided simulation and its report
  'environment-seeds.v1': 'scenario',
  'proxy-interview.v1': 'actor',
  'report-plan.v1': 'synthesis',
  'report-summary.v1': 'synthesis',
  'report-chapter.v1': 'synthesis',
  'chapter-regeneration.v1': 'synthesis',
  'followup-answer.v1': 'synthesis',
  // The baseline simulation, which asks a model once for each agent in each round
  'baseline-graph.v1': 'extraction',
  'baseline-personas.v1': 'actor',
  'baseline-report.v1': 'synthesis',
  'agent-decision.v1': 'actor',
} as const satisfies Record<string, ModelRole>;

export type ModelTaskName = keyof typeof MODEL_TASKS;

const OTHER = 'other';

/** How a task ended. `fell-back` is a model that was asked and could not be used; rules by design are `ok`. */
export const TASK_OUTCOMES = [
  'ok',
  'corrected',
  'fell-back',
  'refused',
  'failed',
  'cancelled',
] as const;
export type TaskOutcomeKind = (typeof TASK_OUTCOMES)[number];

// Written as records, so that a role or a provider kind that is added breaks the build here.
const ROLES: Record<ModelRole, true> = {
  'research-planner': true,
  extraction: true,
  actor: true,
  scenario: true,
  critic: true,
  synthesis: true,
};
const PROVIDERS: Record<ProviderName, true> = {
  none: true,
  ollama: true,
  openai: true,
  azure: true,
  foundry: true,
  gemini: true,
};

const known = (list: object, value: unknown): value is string =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(list, value);

/** The name a task is recorded under: its own when it is on the closed list, `other` when it is not. */
export const taskNameOf = (name: string): ModelTaskName | typeof OTHER =>
  known(MODEL_TASKS, name) ? (name as ModelTaskName) : OTHER;

const roleOf = (role: string): ModelRole | typeof OTHER =>
  known(ROLES, role) ? (role as ModelRole) : OTHER;

const providerOf = (provider: string | undefined): string | null =>
  provider === undefined ? null : known(PROVIDERS, provider) ? provider : OTHER;

export interface TaskLabel {
  role: ModelRole;
  /** The task's own name. Anything that is not on the closed list is recorded as `other`. */
  name: string;
  /** The kind of provider that answers it, `none` when no model is configured; absent when it is not known. */
  provider: ProviderName | undefined;
  /** The task's cancellation: a task that ends while it is aborted ended cancelled. */
  signal?: AbortSignal;
}

/**
 * What a prompt and a reply measure, for the span of a task when `TELEMETRY_TRACE_CONTENT=redacted`: two
 * sizes and the start of a hash of the input. Derived from content, so never recorded by default, and
 * never the text.
 */
export interface ContentSizes {
  inputChars: number;
  outputChars: number;
  /** The first 16 hexadecimal characters of a SHA-256; anything else is not recorded. */
  inputHash: string | null;
}

/** What a finished task says about itself. */
export interface TaskReading {
  /** Who answered: a model, or rules (which stood in for a model, or were chosen). */
  source: TaskSource;
  /** Why rules stood in for a model that was asked; null when a model answered or rules were chosen. */
  failure: TaskFailure | null;
  /** Made only when sizes of the content may be recorded. */
  content?: () => ContentSizes;
}

const CANCELLATION_CODES: ReadonlySet<string> = new Set(['RUN_CANCELLED', 'CLIENT_DISCONNECTED']);
const HASH_PREFIX = /^[0-9a-f]{16}$/u;
const size = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;

function outcomeOfReading(reading: TaskReading, repairs: number): TaskOutcomeKind {
  if (reading.failure) return 'fell-back';
  if (reading.source === 'fallback') return 'ok';
  return repairs > 0 ? 'corrected' : 'ok';
}

function outcomeOfError(error: unknown, signal: AbortSignal | undefined): TaskOutcomeKind {
  const code = error instanceof AppError ? error.code : '';
  if (signal?.aborted || CANCELLATION_CODES.has(code)) return 'cancelled';
  return code === 'MODEL_REFUSED' || code === 'BYOK_BLOCKED' ? 'refused' : 'failed';
}

/** Runs a recorder that must not be able to stop the work: one that fails is not made. */
function quietly(record: () => void): void {
  try {
    record();
  } catch {
    // A record that could not be made is not worth a failed request.
  }
}

/**
 * Runs `work` as one structured task, and records how it went: a span that is active while it runs, a
 * duration, and the outcome. What `work` returns or throws is passed on untouched. `read` says who
 * answered and why rules stood in, from what `work` returned; `work` is given an empty `CallReport` to
 * put in the options of its model call, which is how the deployment and the correction rounds come back.
 */
export async function traceTask<T>(
  label: TaskLabel,
  work: (report: CallReport) => Promise<T>,
  read: (value: T) => TaskReading,
): Promise<T> {
  const started = performance.now();
  const report: CallReport = {};
  const role = roleOf(label.role);
  const task = taskNameOf(label.name);
  const provider = providerOf(label.provider);

  const conclude = (
    span: Span,
    ended: {
      outcome: TaskOutcomeKind;
      source: TaskSource | 'refused' | null;
      failureCode: string | null;
      content?: TaskReading['content'];
    },
  ): void => {
    const deployment = report.deployment ?? null;
    quietly(() =>
      signals.modelTask({
        role,
        task,
        provider,
        outcome: ended.outcome,
        source: ended.source,
        deployment,
        failureCode: ended.failureCode,
        durationMs: performance.now() - started,
      }),
    );
    quietly(() => {
      annotate(span, {
        'swarm.model.task_outcome': ended.outcome,
        ...(ended.source ? { 'swarm.model.source': ended.source } : {}),
        ...(deployment ? { 'swarm.model.name': deployment } : {}),
        ...(ended.failureCode ? { 'swarm.error.code': ended.failureCode } : {}),
      });
      if (ended.outcome === 'failed') failSpan(span);
    });
    // Apart from the rest: a size that cannot be worked out costs the span its sizes and nothing else.
    quietly(() => {
      const sizes = ended.content?.();
      if (!sizes) return;
      annotate(span, {
        'swarm.model.input_chars': size(sizes.inputChars),
        'swarm.model.output_chars': size(sizes.outputChars),
        ...(sizes.inputHash && HASH_PREFIX.test(sizes.inputHash)
          ? { 'swarm.model.input_hash': sizes.inputHash }
          : {}),
      });
    });
  };

  return tracer().startActiveSpan(
    'swarm.model.task',
    {
      attributes: safeAttributes({
        'swarm.model.role': role,
        'swarm.model.task': task,
        ...(provider ? { 'swarm.model.provider': provider } : {}),
      }),
    },
    async (span) => {
      let value: T;
      try {
        value = await work(report);
      } catch (error) {
        const outcome = outcomeOfError(error, label.signal);
        conclude(span, {
          outcome,
          source: outcome === 'refused' ? 'refused' : null,
          failureCode: publicFailure(error).code,
        });
        quietly(() => span.end());
        throw error;
      }
      let reading: TaskReading = { source: 'model', failure: null };
      quietly(() => {
        reading = read(value);
      });
      conclude(span, {
        outcome: outcomeOfReading(reading, report.repairs ?? 0),
        source: reading.source,
        failureCode: reading.failure?.code ?? null,
        ...(reading.content ? { content: reading.content } : {}),
      });
      quietly(() => span.end());
      return value;
    },
  );
}

/**
 * A gateway that records each call of the model as one task, for code that asks the model for JSON and
 * handles a failure itself. It changes nothing about the call: the same arguments go through, and what
 * comes back, or is thrown, comes back as it is. It names the call for the provider and for the
 * measurements of the calls (the role), which is all that otherwise tells one task's calls from another's.
 */
export function tracedGateway(model: ModelGateway, name: ModelTaskName): ModelGateway {
  const role = MODEL_TASKS[name];
  return {
    ...(model.provider === undefined ? {} : { provider: model.provider }),
    json: <T>(
      schema: z.ZodType<T>,
      instructions: string,
      data: unknown,
      signal: AbortSignal,
      maxTokens?: number,
      options: JsonOptions<T> = {},
    ): Promise<T> =>
      traceTask(
        { role, name, provider: model.provider, signal },
        (report) =>
          model.json(schema, instructions, data, signal, maxTokens, {
            ...options,
            route: { role, task: name, ...options.route },
            report,
          }),
        () => ({ source: 'model', failure: null }),
      ),
  };
}
