import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  checkProblem,
  checkSentence,
  checkVerdict,
  firstProblem,
} from '../../shared/provider-check.js';
import type { CheckStage, DeploymentCheck, ProviderCheck } from '../../shared/types.js';
import { AppError } from '../src/errors.js';
import { checkDeployment, stagesFor, summarizeChecks } from '../src/models/check.js';
import type { JsonOptions, ModelGateway } from '../src/models/client.js';
import { ModelReplyError, type ReplyDiagnostics } from '../src/models/diagnostics.js';

// What a connection check says is derived from what one tiny request ended in, and is read by the page,
// the scripts and the status in one way: these tests hold both halves.

const OK: CheckStage = { state: 'ok', detail: null };
const UNKNOWN: CheckStage = { state: 'unknown', detail: null };
const failed = (detail: string): CheckStage => ({ state: 'failed', detail });

function deployment(parts: Partial<DeploymentCheck> = {}): DeploymentCheck {
  return {
    deployment: 'swarm-chat',
    reachable: OK,
    authenticated: OK,
    deploymentFound: OK,
    structuredOutput: { state: 'ok', detail: 'strict JSON schema' },
    structuredMode: 'json_schema',
    code: null,
    latencyMs: 120,
    ...parts,
  };
}

const states = (found: ReturnType<typeof stagesFor>) =>
  [
    found.stages.reachable,
    found.stages.authenticated,
    found.stages.deploymentFound,
    found.stages.structuredOutput,
  ].map((stage) => stage.state);

describe('what one failed request says about each of the four things', () => {
  it.each([
    ['MODEL_UNREACHABLE', ['failed', 'unknown', 'unknown', 'unknown']],
    ['MODEL_TIMEOUT', ['failed', 'unknown', 'unknown', 'unknown']],
    ['MODEL_AUTH', ['ok', 'failed', 'unknown', 'unknown']],
    ['MODEL_NOT_FOUND', ['ok', 'unknown', 'failed', 'unknown']],
    ['MODEL_RATE_LIMIT', ['ok', 'ok', 'ok', 'unknown']],
    ['MODEL_REFUSED', ['ok', 'ok', 'ok', 'unknown']],
    ['MODEL_TRUNCATED', ['ok', 'ok', 'ok', 'failed']],
    ['MODEL_OUTPUT_INVALID', ['ok', 'ok', 'ok', 'failed']],
    ['MODEL_PARAMETER_UNSUPPORTED', ['ok', 'ok', 'ok', 'failed']],
    ['MODEL_PROTOCOL', ['failed', 'unknown', 'unknown', 'unknown']],
    ['MODEL_HTTP_ERROR', ['failed', 'unknown', 'unknown', 'unknown']],
    ['MODEL_CALL_BUDGET', ['unknown', 'unknown', 'unknown', 'unknown']],
  ])('%s: %j', (code, expected) => {
    const found = stagesFor(new AppError(502, code, 'An app-made message.'));
    expect(found.code).toBe(code);
    expect(states(found)).toEqual(expected);
  });

  it('is unknown throughout for an error that is not one of the app’s', () => {
    const found = stagesFor(new TypeError('a bug'));
    expect(found.code).toBeNull();
    expect(states(found)).toEqual(['unknown', 'unknown', 'unknown', 'unknown']);
    expect(found.stages.structuredOutput.detail).toBe('the check could not be completed');
  });

  it('puts the counts of a cut-off reply in the finding, and never a word of the reply', () => {
    const diagnostics: ReplyDiagnostics = {
      role: null,
      finishReason: 'length',
      outputTokens: 3_048,
      reasoningTokens: 3_000,
      maxOutputTokens: 3_048,
      effort: 'minimal',
      retried: true,
    };
    const found = stagesFor(
      new ModelReplyError(502, 'MODEL_TRUNCATED', 'REPLY-CANARY', diagnostics),
    );
    expect(found.stages.structuredOutput.detail).toBe(
      'a tiny request was cut off at its limit, asked again once; 3,048 of 3,048 output tokens, 3,000 of them hidden reasoning; reasoning effort minimal',
    );
    expect(JSON.stringify(found)).not.toContain('CANARY');
  });

  it('says which kind of check a whole reply failed, in fixed words', () => {
    const diagnostics: ReplyDiagnostics = {
      role: null,
      finishReason: 'stop',
      outputTokens: 5,
      reasoningTokens: 0,
      maxOutputTokens: 1_524,
      effort: 'minimal',
      rejection: 'schema',
    };
    const found = stagesFor(
      new ModelReplyError(502, 'MODEL_OUTPUT_INVALID', 'REPLY-CANARY', diagnostics),
    );
    expect(found.stages.structuredOutput.detail).toBe(
      'the reply was complete but it did not match the schema',
    );
  });
});

describe('making the check of one deployment', () => {
  const signal = () => new AbortController().signal;
  const gateway = (
    behave: (options: JsonOptions<unknown> | undefined) => unknown,
  ): ModelGateway => ({
    json: async (_schema, _instructions, _data, _signal, _max, options) =>
      behave(options as JsonOptions<unknown> | undefined) as never,
  });
  const target = { deployment: 'swarm-chat', route: { role: 'actor' as const } };

  it('asks for the fixed word as strict JSON, with room, and reports all four confirmed', async () => {
    let seen: { max: unknown; options: unknown; schema: unknown } | null = null;
    const model: ModelGateway = {
      json: async (schema, _instructions, _data, _signal, max, options) => {
        seen = { max, options, schema };
        if (options) options.report = Object.assign(options.report ?? {}, {});
        if (options?.report) options.report.structured = 'json_schema';
        return { status: 'ok' } as never;
      },
    };
    const result = await checkDeployment(model, target, { signal: signal(), credentials: true });
    expect(result).toMatchObject({
      deployment: 'swarm-chat',
      reachable: { state: 'ok' },
      authenticated: { state: 'ok', detail: null },
      deploymentFound: { state: 'ok' },
      structuredOutput: { state: 'ok', detail: 'strict JSON schema' },
      structuredMode: 'json_schema',
      code: null,
    });
    expect(seen).toMatchObject({
      max: 1_024,
      options: { repairs: 0, route: { role: 'actor', task: 'connectivity-check' } },
    });
    const shape = (seen as unknown as { schema: z.ZodType }).schema;
    expect(shape.safeParse({ status: 'ok' }).success).toBe(true);
    expect(shape.safeParse({ status: 'fine' }).success).toBe(false);
  });

  it('says so when strict output was refused and plain JSON was what worked', async () => {
    const model = gateway((options) => {
      if (options?.report) options.report.structured = 'json_object';
      return { status: 'ok' };
    });
    const result = await checkDeployment(model, target, { signal: signal(), credentials: true });
    expect(result.structuredMode).toBe('json_object');
    expect(result.structuredOutput.detail).toBe(
      'plain JSON: the deployment refused a strict schema',
    );
  });

  it('has nothing to be refused by when the provider uses no credentials', async () => {
    const model = gateway(() => ({ status: 'ok' }));
    const result = await checkDeployment(model, target, { signal: signal(), credentials: false });
    expect(result.authenticated).toEqual({ state: 'ok', detail: 'no credentials are used' });
  });

  it('turns what the request ends in into a finding, and keeps the code', async () => {
    const model = gateway(() => {
      throw new AppError(502, 'MODEL_AUTH', 'The provider rejected the API key.');
    });
    const result = await checkDeployment(model, target, { signal: signal(), credentials: true });
    expect(result).toMatchObject({
      code: 'MODEL_AUTH',
      authenticated: { state: 'failed', detail: 'The provider rejected the API key.' },
      structuredMode: null,
    });
  });

  it('throws when the person went away, which is not a finding', async () => {
    const controller = new AbortController();
    controller.abort();
    const model = gateway(() => {
      throw new AppError(409, 'RUN_CANCELLED', 'The operation was cancelled.');
    });
    await expect(
      checkDeployment(model, target, { signal: controller.signal, credentials: true }),
    ).rejects.toMatchObject({ code: 'RUN_CANCELLED' });
  });

  it('says a time limit that ran out is the provider not answering in time', async () => {
    const timed = AbortSignal.timeout(1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(timed.aborted).toBe(true);
    const model = gateway(() => {
      throw new AppError(409, 'RUN_CANCELLED', 'The operation was cancelled.');
    });
    const result = await checkDeployment(model, target, { signal: timed, credentials: true });
    expect(result).toMatchObject({
      code: 'MODEL_TIMEOUT',
      reachable: { state: 'failed', detail: 'the provider did not answer in time' },
    });
  });
});

describe('what several checks add up to', () => {
  it('is connected when the first three are confirmed everywhere, and passes when the fourth is too', () => {
    expect(summarizeChecks([deployment(), deployment({ deployment: 'b' })])).toMatchObject({
      connected: true,
      ok: true,
    });
    expect(
      summarizeChecks([deployment(), deployment({ structuredOutput: failed('cut off') })]),
    ).toMatchObject({ connected: true, ok: false });
    expect(summarizeChecks([deployment(), deployment({ authenticated: UNKNOWN })])).toMatchObject({
      connected: false,
      ok: false,
    });
    expect(summarizeChecks([deployment({ reachable: failed('no') })])).toMatchObject({
      connected: false,
      ok: false,
    });
  });
});

describe('how a check is read', () => {
  const check = (...deployments: DeploymentCheck[]): ProviderCheck =>
    summarizeChecks(deployments, '2026-01-01T00:00:00.000Z');

  it('calls a pass a pass, and has no problem to give to a script', () => {
    const passed = check(deployment());
    expect(checkVerdict(passed)).toBe('verified');
    expect(checkSentence(passed)).toContain('Connection verified');
    expect(checkProblem(passed)).toBeNull();
    expect(firstProblem(passed.deployments)).toBeNull();
  });

  it('never calls a working connection a failed one: what failed is structured output', () => {
    const cut = check(
      deployment({ structuredOutput: failed('a tiny request was cut off at its limit') }),
    );
    expect(checkVerdict(cut)).toBe('structured-failed');
    const sentence = checkSentence(cut);
    expect(sentence).toBe(
      'Connected, but structured output is not working. Deployment “swarm-chat”: structured output (a tiny request was cut off at its limit).',
    );
    expect(sentence).not.toContain('check failed');
    expect(checkProblem(cut)).toBe(sentence);
  });

  it('says which of the first three failed, when the connection did', () => {
    const rejected = check(
      deployment({
        authenticated: failed('The provider rejected the API key.'),
        deploymentFound: UNKNOWN,
        structuredOutput: UNKNOWN,
      }),
    );
    expect(checkVerdict(rejected)).toBe('not-connected');
    expect(checkSentence(rejected)).toBe(
      'Connection check failed: Deployment “swarm-chat”: authenticated (The provider rejected the API key).',
    );
  });

  it('puts a failure before an unknown, whichever stage it is', () => {
    const mixed = check(
      deployment({ authenticated: UNKNOWN, structuredOutput: failed('refused') }),
      deployment({ deployment: 'b', deploymentFound: failed('not there') }),
    );
    expect(firstProblem(mixed.deployments)).toMatchObject({
      deployment: 'b',
      stage: 'deploymentFound',
      state: 'failed',
    });
    expect(checkVerdict(mixed)).toBe('not-connected');
  });

  it('says what could not be confirmed, when nothing failed', () => {
    const throttled = check(
      deployment({ structuredOutput: { state: 'unknown', detail: 'not tested: rate limiting' } }),
    );
    expect(checkVerdict(throttled)).toBe('unconfirmed');
    expect(checkSentence(throttled)).toBe(
      'Connected, but the check could not confirm everything. Deployment “swarm-chat”: structured output (not tested: rate limiting).',
    );
  });

  it('does not call it connected when any of the first three is not confirmed, failed or not', () => {
    // Nothing failed, and nothing was confirmed either: that is not a connection.
    const nothing = check(
      deployment({
        reachable: UNKNOWN,
        authenticated: UNKNOWN,
        deploymentFound: UNKNOWN,
        structuredOutput: UNKNOWN,
      }),
    );
    expect(nothing.connected).toBe(false);
    expect(checkVerdict(nothing)).toBe('not-connected');
    expect(checkSentence(nothing)).toContain('Connection check failed');
    const unsure = check(deployment({ authenticated: UNKNOWN }));
    expect(checkVerdict(unsure)).toBe('not-connected');
  });

  it('has nothing to say of a server that sent no check', () => {
    expect(checkProblem(undefined)).toBeNull();
    expect(checkProblem(null)).toBeNull();
  });
});
