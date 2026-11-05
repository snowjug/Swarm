import { z } from 'zod';
import type { CheckStage, DeploymentCheck, ProviderCheck } from '../../../shared/types.js';
import { AppError } from '../errors.js';
import type { CallReport, ModelCallRoute } from './call.js';
import type { ModelGateway } from './client.js';
import { failureClause, ModelReplyError } from './diagnostics.js';

/**
 * The connection check: one tiny request that is made so that it cannot fail for a reason that is not a
 * finding. It asks for one fixed word as strict JSON, at the lowest reasoning effort and with room to
 * finish (the client adds room to think on top of this), so a reasoning deployment that spends its limit
 * thinking cannot cut it off: a live pilot's check asked for 50 tokens and was cut off by the model's own
 * thinking, and said "failed" while the chip said "connected". The one retry of a cut-off reply applies.
 *
 * What it reports is four separate answers per deployment: reached, signed in to, deployment found, and
 * structured output. Each is `ok`, `failed` or `unknown` (not far enough to say), and each says why in
 * fixed words or counts: nothing the provider wrote is shown.
 */
export const checkSchema = z.object({ status: z.enum(['ok']) });
export const CHECK_PROMPT =
  'Connectivity check. Reply with the JSON object {"status":"ok"} and nothing else.';
/** What the check is allowed to write, thinking aside: a hundred times what it needs. */
export const CHECK_ANSWER_TOKENS = 1_024;
export const CHECK_TASK = 'connectivity-check';

export interface CheckTarget {
  /** The deployment asked, or null for a provider that has none. */
  deployment: string | null;
  /** How the call is routed; the check adds its own effort and room. */
  route: ModelCallRoute;
}

const ok = (detail: string | null = null): CheckStage => ({ state: 'ok', detail });
const failed = (detail: string): CheckStage => ({ state: 'failed', detail });
const unknown = (detail: string | null = null): CheckStage => ({ state: 'unknown', detail });
const NOT_REACHED = 'not checked: the provider was not reached';

type Stages = Pick<
  DeploymentCheck,
  'reachable' | 'authenticated' | 'deploymentFound' | 'structuredOutput'
>;

/** The provider answered, signed the request in and found the deployment; what was asked of it is the rest. */
const answered = (structuredOutput: CheckStage): Stages => ({
  reachable: ok(),
  authenticated: ok(),
  deploymentFound: ok(),
  structuredOutput,
});

const REJECTIONS = {
  not_json: 'it was not one JSON object',
  schema: 'it did not match the schema',
  validation: 'it failed the server’s checks',
  injection_echo: 'it repeated an instruction',
} as const;

/** What one failed request says about each of the four things. Only fixed words, counts and app-made messages. */
export function stagesFor(error: unknown): { stages: Stages; code: string | null } {
  if (!(error instanceof AppError)) {
    return {
      code: null,
      stages: {
        reachable: unknown(),
        authenticated: unknown(),
        deploymentFound: unknown(),
        structuredOutput: unknown('the check could not be completed'),
      },
    };
  }
  const { code } = error;
  switch (code) {
    case 'MODEL_UNREACHABLE':
    case 'MODEL_TIMEOUT':
      return {
        code,
        stages: {
          reachable: failed(
            code === 'MODEL_TIMEOUT'
              ? 'the provider did not answer in time'
              : 'the endpoint could not be reached: check the endpoint, TLS and network',
          ),
          authenticated: unknown(NOT_REACHED),
          deploymentFound: unknown(NOT_REACHED),
          structuredOutput: unknown(NOT_REACHED),
        },
      };
    case 'MODEL_AUTH':
      return {
        code,
        stages: {
          reachable: ok(),
          authenticated: failed(error.message),
          deploymentFound: unknown('not checked: the provider did not accept the credentials'),
          structuredOutput: unknown('not checked: the provider did not accept the credentials'),
        },
      };
    case 'MODEL_NOT_FOUND':
      return {
        code,
        stages: {
          reachable: ok(),
          authenticated: unknown('not confirmed: the provider said only that nothing was found'),
          deploymentFound: failed(error.message),
          structuredOutput: unknown('not checked: there is no such deployment'),
        },
      };
    case 'MODEL_RATE_LIMIT':
      return {
        code,
        stages: answered(unknown('not tested: the provider is rate limiting requests')),
      };
    case 'MODEL_REFUSED':
      return {
        code,
        stages: answered(unknown('not tested: the provider declined the check request')),
      };
    case 'MODEL_TRUNCATED': {
      const counts =
        error instanceof ModelReplyError
          ? failureClause(error.diagnostics)
          : 'cut off at its limit';
      return {
        code,
        stages: answered(failed(`a tiny request was ${counts}`)),
      };
    }
    case 'MODEL_OUTPUT_INVALID': {
      const why =
        error instanceof ModelReplyError && error.diagnostics.rejection
          ? REJECTIONS[error.diagnostics.rejection]
          : 'it was not the JSON asked for';
      return { code, stages: answered(failed(`the reply was complete but ${why}`)) };
    }
    case 'MODEL_PARAMETER_UNSUPPORTED':
      return { code, stages: answered(failed(error.message)) };
    case 'MODEL_PROTOCOL':
      return {
        code,
        stages: {
          reachable: failed('the endpoint answered, but not with the OpenAI chat completions API'),
          authenticated: unknown(NOT_REACHED),
          deploymentFound: unknown(NOT_REACHED),
          structuredOutput: unknown(NOT_REACHED),
        },
      };
    case 'MODEL_HTTP_ERROR':
      // An error status is the provider answering, and it is not a provider that can be used.
      return {
        code,
        stages: {
          reachable: failed(error.message),
          authenticated: unknown(NOT_REACHED),
          deploymentFound: unknown(NOT_REACHED),
          structuredOutput: unknown(NOT_REACHED),
        },
      };
    default:
      return {
        code,
        stages: {
          reachable: unknown(),
          authenticated: unknown(),
          deploymentFound: unknown(),
          structuredOutput: unknown(error.message),
        },
      };
  }
}

/** Whether a signal ended because its time ran out, as against because someone aborted it. */
const timedOut = (signal: AbortSignal): boolean =>
  signal.aborted && signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError';

/**
 * Makes the check of one deployment. A person going away is not a finding and is thrown; anything else the
 * request ends in is a result, so that a check that ran always says what it found.
 */
export async function checkDeployment(
  model: ModelGateway,
  target: CheckTarget,
  options: { signal: AbortSignal; credentials: boolean },
): Promise<DeploymentCheck> {
  const report: CallReport = {};
  const started = performance.now();
  const finished = (stages: Stages, code: string | null): DeploymentCheck => ({
    deployment: target.deployment,
    // A provider that needs no credentials has nothing to be refused by.
    ...stages,
    authenticated:
      !options.credentials && stages.authenticated.state === 'ok'
        ? ok('no credentials are used')
        : stages.authenticated,
    structuredMode: report.structured ?? null,
    code,
    latencyMs: Math.round(performance.now() - started),
  });
  try {
    await model.json(
      checkSchema,
      CHECK_PROMPT,
      { purpose: CHECK_TASK },
      options.signal,
      CHECK_ANSWER_TOKENS,
      { repairs: 0, route: { ...target.route, task: CHECK_TASK }, report },
    );
  } catch (error) {
    if (error instanceof AppError && error.code === 'RUN_CANCELLED') {
      // The check's own time limit is a finding (the provider did not answer); a person who went away is not.
      if (!timedOut(options.signal)) throw error;
      const found = stagesFor(new AppError(504, 'MODEL_TIMEOUT', 'The model request timed out.'));
      return finished(found.stages, found.code);
    }
    const found = stagesFor(error);
    return finished(found.stages, found.code);
  }
  const mode =
    report.structured === 'json_object'
      ? 'plain JSON: the deployment refused a strict schema'
      : 'strict JSON schema';
  return finished(answered(ok(mode)), null);
}

/** The four answers of every deployment, and whether they add up to a connection and to a pass. */
export function summarizeChecks(
  deployments: DeploymentCheck[],
  checkedAt = new Date().toISOString(),
): ProviderCheck {
  const connected = deployments.every(
    (one) =>
      one.reachable.state === 'ok' &&
      one.authenticated.state === 'ok' &&
      one.deploymentFound.state === 'ok',
  );
  return {
    checkedAt,
    connected,
    ok: connected && deployments.every((one) => one.structuredOutput.state === 'ok'),
    deployments,
  };
}
