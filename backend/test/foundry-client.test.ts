import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AppError } from '../src/errors.js';
import { CapabilityMemory } from '../src/models/capabilities.js';
import { ModelClient, type ModelUsageSink } from '../src/models/client.js';
import { ModelRefusedError } from '../src/models/safety.js';
import type { ModelCallEvent, ModelObserver, ModelRejectEvent } from '../src/models/telemetry.js';
import { testConfig } from './fixtures.js';
import { FAKE_FOUNDRY_KEY, startFakeFoundry, type FakeFoundry } from './support/fake-foundry.js';

// Everything the Foundry provider does on the wire, proved against the in-process fake of the Azure
// OpenAI v1 endpoint. Nothing here reaches Azure; what is asserted is what the fake received.

const answer = z.object({ answer: z.string().min(1).max(40) });
const signal = () => new AbortController().signal;

let fake: FakeFoundry;
beforeAll(async () => {
  fake = await startFakeFoundry({
    deployments: {
      'fast-dep': {},
      'plain-dep': { jsonSchema: false },
      'deep-dep': { temperature: false, reasoningEffort: true },
      'tiny-dep': { maxContextChars: 2_000 },
    },
    fallbackReply: () => ({ answer: 'ok' }),
  });
});
afterEach(() => fake.reset());
afterAll(async () => fake.close());

interface Observed {
  calls: ModelCallEvent[];
  rejects: ModelRejectEvent[];
}

function made(
  options: {
    model?: string;
    auth?: 'key' | 'entra';
    capabilities?: CapabilityMemory;
    maxCalls?: number;
    usage?: ModelUsageSink;
  } = {},
) {
  const config = testConfig(
    fake.environment({ AI_MODEL: options.model ?? 'fast-dep' }, options.auth ?? 'key'),
  ).provider;
  const seen: Observed = { calls: [], rejects: [] };
  const observer: ModelObserver = {
    onCall: (event) => seen.calls.push(event),
    onReject: (event) => seen.rejects.push(event),
  };
  const client = new ModelClient(
    config,
    options.usage ?? (() => undefined),
    undefined,
    options.maxCalls ?? 16,
    {
      observer,
      tokens: options.auth === 'entra' ? fake.tokens : null,
      capabilities: options.capabilities ?? new CapabilityMemory(),
    },
  );
  return { client, config, seen };
}

const body = (index = 0) => fake.requests[index]!.body!;
const format = (index = 0) => body(index).response_format!;

describe('credentials', () => {
  it('signs in with the bearer token of the Entra provider, and sends no key', async () => {
    const { client } = made({ auth: 'entra' });
    await client.json(answer, 'Return JSON.', {}, signal());
    const [request] = fake.requests;
    expect(request?.credential).toBe('bearer');
    expect(request?.headers.authorization).toBe(`Bearer ${fake.token}`);
    expect(request?.headers['api-key']).toBeUndefined();
    expect(request?.path).toBe('/openai/v1/chat/completions');
  });

  it('uses the api-key header, and no bearer, when a key was chosen', async () => {
    const { client } = made({ auth: 'key' });
    await client.json(answer, 'Return JSON.', {}, signal());
    expect(fake.requests[0]).toMatchObject({ credential: 'api-key', status: 200 });
    expect(fake.requests[0]?.headers['api-key']).toBe(FAKE_FOUNDRY_KEY);
    expect(fake.requests[0]?.headers.authorization).toBeUndefined();
  });

  it('turns a rejected credential into MODEL_AUTH and repeats neither the token nor the provider text', async () => {
    const { client } = made({ auth: 'entra' });
    const wrong = new ModelClient(
      { ...testConfig(fake.environment({}, 'entra')).provider },
      () => undefined,
      undefined,
      16,
      { tokens: { getToken: async () => 'not-the-fake-token-canary' } },
    );
    const failure = await wrong.json(answer, 'Return JSON.', {}, signal()).catch((e: unknown) => e);
    expect(failure).toMatchObject({ code: 'MODEL_AUTH' });
    expect(String((failure as Error).message)).not.toContain('not-the-fake-token');
    expect(fake.requests).toHaveLength(1);
    await expect(client.json(answer, 'Return JSON.', {}, signal())).resolves.toBeDefined();
  });

  it('keeps the credential, and the untrusted data, out of every part of the request but where they belong', async () => {
    const { client } = made({ auth: 'key' });
    await client.json(answer, 'Return JSON.', { note: 'UNTRUSTED-CANARY-TEXT' }, signal());
    const [request] = fake.requests;
    expect(request?.rawBody).not.toContain(FAKE_FOUNDRY_KEY);
    const system = request?.body?.messages?.find((message) => message.role === 'system');
    expect(system?.content).not.toContain('UNTRUSTED-CANARY-TEXT');
    expect(JSON.stringify(request?.body?.response_format)).not.toContain('UNTRUSTED-CANARY-TEXT');
    expect(request?.data).toEqual({ note: 'UNTRUSTED-CANARY-TEXT' });
  });
});

describe('strict structured output', () => {
  it('asks for a json_schema made from the zod schema, closed and fully required, with the deployment as model', async () => {
    const { client } = made({ model: 'fast-dep' });
    const schema = z.object({
      answer: z.string().trim().min(2).max(80),
      confidence: z.number().min(0).max(1),
      tags: z.array(z.enum(['a', 'b'])).max(3),
    });
    fake.script({ kind: 'reply', value: { answer: 'fine', confidence: 0.5, tags: ['a'] } });
    await expect(
      client.json(schema, 'Return JSON.', {}, signal(), 900, {
        route: { task: 'actor-proposal.v1', deployment: 'fast-dep' },
      }),
    ).resolves.toEqual({ answer: 'fine', confidence: 0.5, tags: ['a'] });
    expect(body()).toMatchObject({ model: 'fast-dep', max_completion_tokens: 900 });
    expect(format()).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'actor-proposal_v1', strict: true },
    });
    const sent = format().json_schema!.schema as Record<string, unknown>;
    expect(sent).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['answer', 'confidence', 'tags'],
    });
    expect(JSON.stringify(sent)).not.toMatch(/minLength|maxLength|minimum|maximum|maxItems/u);
    // What a strict schema cannot say is left to the zod schema, and said to the model in words.
    expect(JSON.stringify(sent)).toContain('2 to 80 characters');
    expect(fake.problems).toEqual([]);
  });

  it('turns an optional property into one that may be null, and back: the reply is judged as the zod schema says', async () => {
    const { client } = made();
    const schema = z.object({
      answer: z.string().min(1),
      notes: z.array(z.string()).optional(),
      score: z.number().default(7),
      nested: z.object({ detail: z.string().optional(), size: z.number() }),
    });
    fake.script({
      kind: 'reply',
      value: { answer: 'ok', notes: null, score: null, nested: { detail: null, size: 3 } },
    });
    const value = await client.json(schema, 'Return JSON.', {}, signal());
    expect(value).toEqual({ answer: 'ok', score: 7, nested: { size: 3 } });
    expect('notes' in value).toBe(false);
    const sent = format().json_schema!.schema as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(sent.required).toEqual(['answer', 'notes', 'score', 'nested']);
    expect(JSON.stringify(sent.properties.notes)).toContain('null');
    expect(fake.problems).toEqual([]);
  });

  it('keeps a null that the schema itself allows, and rejects one it does not', async () => {
    const { client } = made();
    const schema = z.object({ label: z.string().nullable(), count: z.number() });
    fake.script(
      { kind: 'reply', value: { label: null, count: 1 } },
      // A deployment that breaks its own strict schema: the null is for a property that is not optional.
      { kind: 'text', text: '{"label":"x","count":null}' },
      { kind: 'text', text: '{"label":"x","count":null}' },
    );
    await expect(client.json(schema, 'Return JSON.', {}, signal())).resolves.toEqual({
      label: null,
      count: 1,
    });
    await expect(
      client.json(schema, 'Return JSON.', {}, signal(), 500, { repairs: 1 }),
    ).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
  });

  it('asks for plain JSON, without trying, when the schema is one strict mode cannot say', async () => {
    const { client } = made();
    const free = z.object({ answer: z.string(), extra: z.record(z.string(), z.number()) });
    fake.script({ kind: 'text', text: '{"answer":"a","extra":{"x":1}}' });
    await client.json(free, 'Return JSON.', {}, signal());
    expect(fake.requests).toHaveLength(1);
    expect(format()).toEqual({ type: 'json_object' });
  });

  it('does not read a fenced reply as JSON: a Foundry reply is one JSON document or it is not used', async () => {
    const { client, seen } = made();
    fake.script(
      { kind: 'text', text: '```json\n{"answer":"fenced"}\n```' },
      { kind: 'reply', value: { answer: 'fixed' } },
    );
    await expect(client.json(answer, 'Return JSON.', {}, signal())).resolves.toEqual({
      answer: 'fixed',
    });
    expect(fake.requests).toHaveLength(2);
    expect(seen.rejects).toEqual([
      expect.objectContaining({ reason: 'not_json', repair: false, deployment: 'fast-dep' }),
    ]);
  });

  it('still validates every reply with zod and the server check, and corrects once', async () => {
    const { client, seen } = made();
    const checked = vi.fn((value: { answer: string }) => {
      if (value.answer === 'bad') throw new AppError(502, 'MODEL_OUTPUT_INVALID', 'answer is bad');
    });
    fake.script(
      { kind: 'reply', value: { answer: 'bad' } },
      { kind: 'reply', value: { answer: 'good' } },
    );
    await expect(
      client.json(answer, 'Return JSON.', {}, signal(), 500, { validate: checked }),
    ).resolves.toEqual({ answer: 'good' });
    const repair = fake.requests[1]!.body!.messages!.at(-1)!;
    expect(repair.content).toContain('answer is bad');
    expect(seen.rejects).toEqual([expect.objectContaining({ reason: 'validation' })]);
  });
});

describe('a deployment that refuses a parameter', () => {
  it('is asked again as plain JSON, once, and the refusal is remembered for the deployment', async () => {
    const capabilities = new CapabilityMemory();
    const { client } = made({ model: 'plain-dep', capabilities });
    fake.script({ kind: 'reply', value: { answer: 'one' } });
    await expect(client.json(answer, 'Return JSON.', {}, signal())).resolves.toEqual({
      answer: 'one',
    });
    expect(
      fake.requests.map((request) => [request.status, request.body?.response_format?.type]),
    ).toEqual([
      [400, 'json_schema'],
      [200, 'json_object'],
    ]);
    expect(capabilities.get('plain-dep')).toEqual({ jsonSchema: false });

    // Another client of the same process does not ask again; another deployment is not affected.
    fake.reset();
    const second = made({ model: 'plain-dep', capabilities }).client;
    await second.json(answer, 'Return JSON.', {}, signal());
    expect(fake.requests).toHaveLength(1);
    expect(format()).toEqual({ type: 'json_object' });
    fake.reset();
    await made({ model: 'fast-dep', capabilities }).client.json(
      answer,
      'Return JSON.',
      {},
      signal(),
    );
    expect(format().type).toBe('json_schema');
  });

  it('counts the second round trip as a call, asks the budget again, and does not use up a repair', async () => {
    const admit = vi.fn();
    const usage = Object.assign(vi.fn(), { admit }) as ModelUsageSink;
    const { client, seen } = made({ model: 'plain-dep', usage });
    await client.json(answer, 'Return JSON.', {}, signal(), 500, { repairs: 0 });
    expect(admit).toHaveBeenCalledTimes(2);
    expect(seen.calls.map((event) => [event.ok, event.errorCode, event.structured])).toEqual([
      [false, 'MODEL_PARAMETER_UNSUPPORTED', 'json_schema'],
      [true, null, 'json_object'],
    ]);
    const limited = made({ model: 'plain-dep', maxCalls: 1 }).client;
    await expect(limited.json(answer, 'Return JSON.', {}, signal())).rejects.toMatchObject({
      code: 'MODEL_CALL_BUDGET',
    });
  });

  it('does not downgrade for the whole deployment on an ambiguous 400: only that schema is remembered', async () => {
    const capabilities = new CapabilityMemory();
    const { client } = made({ capabilities });
    const other = z.object({ answer: z.string().min(1).max(40), note: z.string().optional() });
    fake.script(
      { kind: 'status', status: 400, code: 'BadRequest' },
      { kind: 'reply', value: { answer: 'plain' } },
    );
    await client.json(answer, 'Return JSON.', {}, signal(), 500, { route: { task: 'one.v1' } });
    expect(capabilities.get('fast-dep')).toEqual({});
    // The same schema goes straight to plain JSON; the deployment still takes strict output for others,
    // even one with the same name, because the refusal is of that schema and not of its name.
    fake.reset();
    await client.json(answer, 'Return JSON.', {}, signal(), 500, { route: { task: 'one.v1' } });
    expect(fake.requests.map((request) => request.body?.response_format?.type)).toEqual([
      'json_object',
    ]);
    fake.reset();
    fake.script({ kind: 'reply', value: { answer: 'strict', note: null } });
    await client.json(other, 'Return JSON.', {}, signal(), 500, { route: { task: 'one.v1' } });
    expect(format().type).toBe('json_schema');
  });

  it('is not remembered when the plain request fails too: the 400 was about something else', async () => {
    const capabilities = new CapabilityMemory();
    const { client } = made({ capabilities });
    fake.script(
      { kind: 'status', status: 400, code: 'BadRequest' },
      { kind: 'status', status: 400, code: 'BadRequest' },
    );
    await expect(client.json(answer, 'Return JSON.', {}, signal())).rejects.toMatchObject({
      code: 'MODEL_HTTP_ERROR',
    });
    expect(fake.requests).toHaveLength(2);
    expect(capabilities.snapshot()).toEqual({});
    fake.reset();
    await client.json(answer, 'Return JSON.', {}, signal());
    expect(format().type).toBe('json_schema');
  });

  it('leaves out a temperature it does not take, and a reasoning effort it does take is kept', async () => {
    const capabilities = new CapabilityMemory();
    const { client } = made({ model: 'deep-dep', capabilities });
    fake.script({ kind: 'reply', value: { answer: 'ok' } });
    await client.json(answer, 'Return JSON.', {}, signal(), 800, {
      route: { deployment: 'deep-dep', temperature: 0.2, reasoningEffort: 'low' },
    });
    expect(fake.requests.map((request) => request.status)).toEqual([400, 200]);
    expect(body(0)).toMatchObject({ temperature: 0.2, reasoning_effort: 'low' });
    expect(body(1).temperature).toBeUndefined();
    expect(body(1).reasoning_effort).toBe('low');
    expect(capabilities.get('deep-dep')).toEqual({ temperature: false });
  });

  it('leaves out a reasoning effort it does not take', async () => {
    const { client } = made({ model: 'fast-dep' });
    fake.script({ kind: 'reply', value: { answer: 'ok' } });
    await client.json(answer, 'Return JSON.', {}, signal(), 800, {
      route: { reasoningEffort: 'high' },
    });
    expect(fake.requests.map((request) => request.status)).toEqual([400, 200]);
    expect(body(1).reasoning_effort).toBeUndefined();
  });

  it('gives up when a refusal is for something else, and says which parameter, without echoing the provider', async () => {
    const { client } = made({ model: 'fast-dep' });
    fake.script(
      { kind: 'status', status: 400, code: 'unsupported_value', param: 'temperature' },
      {
        kind: 'status',
        status: 400,
        code: 'unsupported_parameter',
        param: 'max_completion_tokens',
      },
    );
    const failure = await client
      .json(answer, 'Return JSON.', {}, signal(), 800, {
        route: { temperature: 0.2, reasoningEffort: 'low' },
      })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'MODEL_PARAMETER_UNSUPPORTED' });
    expect((failure as Error).message).toContain('(max_completion_tokens)');
    expect((failure as Error).message).not.toContain('PROVIDER_FREE_TEXT');
    // The effort was refused by the deployment, the temperature by the script, the last was not ours to leave out.
    expect(fake.requests).toHaveLength(3);
  });
});

describe('what the provider says about safety', () => {
  const refused = async (step: Parameters<FakeFoundry['script']>[0]) => {
    const { client, seen } = made();
    fake.script(step);
    const failure = await client
      .json(answer, 'Return JSON.', {}, signal(), 500, { repairs: 2 })
      .catch((error: unknown) => error);
    return { failure, seen };
  };

  it('classifies a model refusal, and does not ask again', async () => {
    const { failure, seen } = await refused({ kind: 'refusal' });
    expect(failure).toBeInstanceOf(ModelRefusedError);
    expect(failure).toMatchObject({ code: 'MODEL_REFUSED', statusCode: 422 });
    expect((failure as ModelRefusedError).findings).toEqual([
      { class: 'refusal', action: 'blocked', category: null },
    ]);
    expect(fake.requests).toHaveLength(1);
    expect(seen.calls[0]).toMatchObject({ ok: false, errorCode: 'MODEL_REFUSED' });
  });

  it('classifies a blocked prompt (HTTP 400), naming the categories and never the provider text', async () => {
    const { failure } = await refused({ kind: 'filter-prompt', categories: ['jailbreak', 'hate'] });
    expect(failure).toMatchObject({ code: 'MODEL_REFUSED' });
    expect((failure as ModelRefusedError).findings.map((f) => [f.class, f.category])).toEqual([
      ['jailbreak', 'jailbreak'],
      ['blocked_input', 'hate'],
    ]);
    expect((failure as Error).message).toContain('(flagged: jailbreak, hate)');
    expect((failure as Error).message).not.toContain('PROVIDER_FREE_TEXT');
    expect(fake.requests).toHaveLength(1);
  });

  it('classifies a blocked answer, and never reads the partial content that came with it', async () => {
    const { failure } = await refused({
      kind: 'filter-output',
      categories: ['violence'],
      partial: '{"answer":"partial but valid"}',
    });
    expect(failure).toMatchObject({ code: 'MODEL_REFUSED' });
    expect((failure as ModelRefusedError).findings).toEqual([
      { class: 'blocked_output', action: 'blocked', category: 'violence' },
    ]);
    expect((failure as Error).message).toContain('blocked this answer');
    expect(fake.requests).toHaveLength(1);
  });

  it('treats a bare finish_reason of content_filter as a block, too', async () => {
    const { client } = made();
    fake.respond(() => ({ kind: 'filter-output', categories: [] }));
    await expect(client.json(answer, 'Return JSON.', {}, signal())).rejects.toMatchObject({
      code: 'MODEL_REFUSED',
    });
  });

  it('hands a detection that did not block to the caller as a signal, and judges the reply as any other', async () => {
    const { client, seen } = made();
    fake.script({ kind: 'detected', category: 'indirect_attack', value: { answer: 'fine' } });
    await expect(client.json(answer, 'Return JSON.', {}, signal())).resolves.toEqual({
      answer: 'fine',
    });
    expect(seen.calls[0]).toMatchObject({
      ok: true,
      safety: [{ class: 'indirect_attack', action: 'detected', category: 'indirect_attack' }],
    });
  });

  it('reads clean annotations as nothing at all', async () => {
    const { client, seen } = made();
    await client.json(answer, 'Return JSON.', {}, signal());
    expect(seen.calls[0]?.safety).toEqual([]);
  });
});

describe('everything else a provider can do', () => {
  it('retries a throttle as the route says, and then reports the rate limit', async () => {
    const { client } = made();
    fake.respond(() => ({ kind: 'status', status: 429, retryAfterSeconds: 0 }));
    await expect(
      client.json(answer, 'Return JSON.', {}, signal(), 500, {
        route: { retry: { transient: 0, throttle: 1 } },
      }),
    ).rejects.toMatchObject({ code: 'MODEL_RATE_LIMIT' });
    expect(fake.requests).toHaveLength(2);
  });

  it('does not retry a server error when the route allows none', async () => {
    const { client } = made();
    fake.respond(() => ({ kind: 'status', status: 503 }));
    await expect(
      client.json(answer, 'Return JSON.', {}, signal(), 500, {
        route: { retry: { transient: 0, throttle: 0 } },
      }),
    ).rejects.toMatchObject({ code: 'MODEL_HTTP_ERROR' });
    expect(fake.requests).toHaveLength(1);
  });

  it('names a deployment that does not exist, without the provider text', async () => {
    const { client } = made();
    const failure = await client
      .json(answer, 'Return JSON.', {}, signal(), 500, { route: { deployment: 'missing-dep' } })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'MODEL_NOT_FOUND' });
    expect((failure as Error).message).toContain('"missing-dep"');
    expect((failure as Error).message).not.toContain('PROVIDER_FREE_TEXT');
  });

  it('reports a request that is too long for the deployment', async () => {
    const { client } = made({ model: 'tiny-dep' });
    await expect(
      client.json(answer, 'Return JSON.', { text: 'x'.repeat(3_000) }, signal()),
    ).rejects.toMatchObject({ code: 'MODEL_CONTEXT_LIMIT' });
  });

  it('times out at the route’s limit, not the provider’s', async () => {
    const { client } = made();
    fake.script({ kind: 'hang' });
    const failure = await client
      .json(answer, 'Return JSON.', {}, signal(), 500, { route: { timeoutMs: 120 } })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'MODEL_TIMEOUT' });
  });

  it('stops at once when it is cancelled mid-flight, and says so', async () => {
    const { client } = made();
    const controller = new AbortController();
    fake.script({ kind: 'slow', ms: 5_000, then: { kind: 'reply', value: { answer: 'late' } } });
    const pending = client.json(answer, 'Return JSON.', {}, controller.signal);
    await vi.waitFor(() => expect(fake.requests).toHaveLength(1));
    controller.abort(new AppError(409, 'RUN_CANCELLED', 'Cancelled for testing.'));
    await expect(pending).rejects.toMatchObject({ code: 'RUN_CANCELLED' });
    expect(fake.requests).toHaveLength(1);
  });

  it('reports usage as the provider gave it, and says when it gave none', async () => {
    const { client, seen } = made();
    fake.script(
      { kind: 'reply', value: { answer: 'a' }, usage: { prompt: 120, completion: 30 } },
      { kind: 'reply', value: { answer: 'b' }, usage: null },
    );
    await client.json(answer, 'Return JSON.', {}, signal());
    await client.json(answer, 'Return JSON.', {}, signal());
    expect(
      seen.calls.map((event) => [event.inputTokens, event.outputTokens, event.tokensReported]),
    ).toEqual([
      [120, 30, true],
      [0, 0, false],
    ]);
  });
});

describe('the gate that an operation’s own allowance is held by', () => {
  const gateFor = (log: string[], refuseAt = Number.POSITIVE_INFINITY) => ({
    begin: vi.fn((request: { deployment: string; inputChars: number; maxOutputTokens: number }) => {
      log.push(`begin ${request.deployment} ${request.maxOutputTokens}`);
      if (log.filter((line) => line.startsWith('begin')).length >= refuseAt) {
        throw new AppError(429, 'MODEL_TOKEN_BUDGET', 'stop');
      }
      return {
        end: vi.fn(
          (event: ModelCallEvent, estimate: { inputTokens: number; outputTokens: number }) => {
            log.push(
              `end ${event.ok} ${event.tokensReported ? event.inputTokens : `~${estimate.inputTokens > 0}`}`,
            );
          },
        ),
      };
    }),
  });

  it('is asked before every round trip, repairs and refused parameters included, and told what each used', async () => {
    const log: string[] = [];
    const { client } = made({ model: 'plain-dep' });
    const used = { prompt: 30, completion: 5 };
    fake.script(
      { kind: 'reply', value: { answer: '' }, usage: used },
      { kind: 'reply', value: { answer: 'ok' }, usage: used },
    );
    await client.json(answer, 'Return JSON.', {}, signal(), 700, { gate: gateFor(log) });
    expect(log).toEqual([
      'begin plain-dep 700',
      'end false ~true',
      'begin plain-dep 700',
      'end true 30',
      'begin plain-dep 700',
      'end true 30',
    ]);
  });

  it('stops the call before the request when it refuses, even the correction round', async () => {
    const log: string[] = [];
    const { client } = made();
    fake.script({ kind: 'reply', value: { answer: '' } });
    await expect(
      client.json(answer, 'Return JSON.', {}, signal(), 500, { gate: gateFor(log, 2) }),
    ).rejects.toMatchObject({ code: 'MODEL_TOKEN_BUDGET' });
    expect(fake.requests).toHaveLength(1);
  });

  it('ends the ticket of a call that failed, with the tokens a truncated reply used', async () => {
    const log: string[] = [];
    const { client } = made();
    fake.script({ kind: 'truncated' }, { kind: 'reply', value: { answer: 'ok' } });
    await client.json(answer, 'Return JSON.', {}, signal(), 500, { gate: gateFor(log) });
    expect(log[0]).toBe('begin fast-dep 500');
    expect(log[2]).toBe('begin fast-dep 1000');
    expect(log[1]).toMatch(/^end false \d+$/u);
  });
});
