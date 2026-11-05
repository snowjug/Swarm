import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AppError } from '../src/errors.js';
import type { CallReport } from '../src/models/call.js';
import { CapabilityMemory } from '../src/models/capabilities.js';
import { ModelClient, type ModelUsageSink } from '../src/models/client.js';
import { createModelFactory } from '../src/models/factory.js';
import { ModelRefusedError } from '../src/models/safety.js';
import {
  ProviderTelemetry,
  type ModelCallEvent,
  type ModelObserver,
  type ModelRejectEvent,
} from '../src/models/telemetry.js';
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
      'picky-dep': { jsonSchema: false, temperature: false },
      'tiny-dep': { maxContextChars: 2_000 },
      // A chat model that is not a reasoning one: it refuses an effort by name, or as Azure says it.
      'classic-dep': { reasoningEffort: false },
      'vague-dep': { reasoningEffort: 'unrecognized' },
      // An o-series deployment: it takes an effort, but not the lowest.
      'o-dep': { temperature: false, minimalEffort: false },
      // What gpt-5-mini does: thinking is counted against the limit, and more of it the higher the effort.
      'think-dep': {
        temperature: false,
        thinks: { default: 3_000, medium: 3_000, low: 600, minimal: 80 },
      },
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
    // The room for thinking is part of what is asked for, and a structured answer is asked at a low effort.
    expect(body()).toMatchObject({
      model: 'fast-dep',
      max_completion_tokens: 900 + 1_000,
      reasoning_effort: 'low',
    });
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

  it('is given the nulls a constrained model would write: a natural reply that leaves an optional property out still passes', async () => {
    const { client } = made();
    const schema = z.object({
      answer: z.string().min(1),
      notes: z.array(z.string()).optional(),
      nested: z.object({ detail: z.string().optional(), size: z.number() }).optional(),
    });
    fake.script({ kind: 'reply', value: { answer: 'ok' } });
    await expect(client.json(schema, 'Return JSON.', {}, signal())).resolves.toEqual({
      answer: 'ok',
    });
    // A reply that breaks the schema for another reason is still refused by the fake, and listed.
    fake.script({ kind: 'reply', value: { answer: 7 } });
    await expect(client.json(schema, 'Return JSON.', {}, signal())).rejects.toMatchObject({
      code: 'MODEL_HTTP_ERROR',
    });
    expect(fake.problems).toEqual([expect.stringContaining('#.answer')]);
  });

  it('reads the null of an optional property as absent before the schema looks, so a coercing schema does not make it 0', async () => {
    const { client } = made();
    const schema = z.object({
      answer: z.string().min(1),
      score: z.coerce.number().optional(),
      urgent: z.coerce.boolean().default(true),
      label: z.coerce.string().optional(),
    });
    // What a constrained model writes for what it has nothing to say about: null. Coerced as it came,
    // that would be 0, false and the text "null".
    fake.script({
      kind: 'reply',
      value: { answer: 'ok', score: null, urgent: null, label: null },
    });
    const empty = await client.json(schema, 'Return JSON.', {}, signal());
    expect(empty).toEqual({ answer: 'ok', urgent: true });
    expect('score' in empty).toBe(false);
    expect('label' in empty).toBe(false);
    // A value is still a value, and is coerced as the schema says.
    fake.script({
      kind: 'reply',
      value: { answer: 'ok', score: 3, urgent: false, label: 'x' },
    });
    await expect(client.json(schema, 'Return JSON.', {}, signal())).resolves.toEqual({
      answer: 'ok',
      score: 3,
      urgent: false,
      label: 'x',
    });
  });

  it('still accepts a reply that the schema passes only as it came', async () => {
    const { client } = made();
    // `note` is optional in one variant and may be null in the other: dropping its null suits the
    // first and breaks the second, which takes it as it came.
    const schema = z.object({
      pick: z.union([
        z.object({ kind: z.literal('a'), note: z.string().optional() }),
        z.object({ kind: z.literal('b'), note: z.string().nullable() }),
      ]),
    });
    fake.script({ kind: 'reply', value: { pick: { kind: 'b', note: null } } });
    await expect(client.json(schema, 'Return JSON.', {}, signal())).resolves.toEqual({
      pick: { kind: 'b', note: null },
    });
    expect(fake.requests).toHaveLength(1);
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

  it('is found out once per process: the clients of one factory share what a deployment refused', async () => {
    const config = testConfig(fake.environment({ AI_MODEL: 'plain-dep' }));
    const factory = createModelFactory(config, new ProviderTelemetry(config.provider));
    await factory(() => undefined).json(answer, 'Return JSON.', {}, signal());
    expect(fake.requests).toHaveLength(2);
    fake.reset();
    await factory(() => undefined).json(answer, 'Return JSON.', {}, signal());
    expect(fake.requests.map((request) => request.body?.response_format?.type)).toEqual([
      'json_object',
    ]);
    // Another process, another factory: nothing is assumed from this one.
    fake.reset();
    const other = createModelFactory(config, new ProviderTelemetry(config.provider));
    await other(() => undefined).json(answer, 'Return JSON.', {}, signal());
    expect(fake.requests).toHaveLength(2);
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
    // The route names the effort, as a router does for a deployment it knows takes one, so that the 400
    // that names no parameter can only be about the structured output.
    const route = { task: 'one.v1', reasoningEffort: 'low' } as const;
    fake.script(
      { kind: 'status', status: 400, code: 'BadRequest' },
      { kind: 'reply', value: { answer: 'plain' } },
    );
    await client.json(answer, 'Return JSON.', {}, signal(), 500, { route });
    expect(capabilities.get('fast-dep')).toEqual({});
    // The same schema goes straight to plain JSON; the deployment still takes strict output for others,
    // even one with the same name, because the refusal is of that schema and not of its name.
    fake.reset();
    await client.json(answer, 'Return JSON.', {}, signal(), 500, { route });
    expect(fake.requests.map((request) => request.body?.response_format?.type)).toEqual([
      'json_object',
    ]);
    fake.reset();
    fake.script({ kind: 'reply', value: { answer: 'strict', note: null } });
    await client.json(other, 'Return JSON.', {}, signal(), 500, { route });
    expect(format().type).toBe('json_schema');
  });

  it('is not remembered when the plain request fails too: the 400 was about something else', async () => {
    const capabilities = new CapabilityMemory();
    const { client } = made({ capabilities });
    const route = { reasoningEffort: 'low' } as const;
    fake.script(
      { kind: 'status', status: 400, code: 'BadRequest' },
      { kind: 'status', status: 400, code: 'BadRequest' },
    );
    await expect(
      client.json(answer, 'Return JSON.', {}, signal(), 500, { route }),
    ).rejects.toMatchObject({ code: 'MODEL_HTTP_ERROR' });
    expect(fake.requests).toHaveLength(2);
    expect(capabilities.snapshot()).toEqual({});
    fake.reset();
    await client.json(answer, 'Return JSON.', {}, signal(), 500, { route });
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
    const { client } = made({ model: 'classic-dep' });
    fake.script({ kind: 'reply', value: { answer: 'ok' } });
    await client.json(answer, 'Return JSON.', {}, signal(), 800, {
      route: { reasoningEffort: 'high' },
    });
    expect(fake.requests.map((request) => request.status)).toEqual([400, 200]);
    expect(body(1).reasoning_effort).toBeUndefined();
  });

  it('is found out once even when it refuses several things: the next operation sends one request', async () => {
    const capabilities = new CapabilityMemory();
    const route = { deployment: 'picky-dep', temperature: 0.2 } as const;
    const operate = async (maxCalls: number) => {
      fake.reset();
      const { client, seen } = made({ model: 'picky-dep', capabilities, maxCalls });
      await client.json(answer, 'Return JSON.', {}, signal(), 800, { route });
      return { statuses: fake.requests.map((request) => request.status), seen };
    };
    // The first operation is refused strict output, then the temperature, and then goes through.
    const first = await operate(16);
    expect(first.statuses).toEqual([400, 400, 200]);
    expect(first.seen.calls.map((event) => event.ok)).toEqual([false, false, true]);
    expect(capabilities.get('picky-dep')).toEqual({ jsonSchema: false, temperature: false });
    // Nothing that is known to be refused is sent again, so one call is all that an operation needs,
    // however often it is made: no round trip is lost to a refusal, and no slot of the call cap.
    for (let operation = 0; operation < 3; operation += 1) {
      const next = await operate(1);
      expect(next.statuses).toEqual([200]);
      expect(next.seen.calls.map((event) => event.ok)).toEqual([true]);
      expect(format()).toEqual({ type: 'json_object' });
      expect(body().temperature).toBeUndefined();
    }
    expect(capabilities.get('picky-dep')).toEqual({ jsonSchema: false, temperature: false });
  });

  it('gives up when a refusal is for something else, and says which parameter, without echoing the provider', async () => {
    const { client } = made({ model: 'classic-dep' });
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

describe('output that thinking can use up', () => {
  // A reasoning deployment spends hidden tokens thinking before it writes, and counts them against the
  // limit of the reply. `think-dep` does what gpt-5-mini does: 3,000 at its default effort, 600 at `low`.
  const sizes = () => fake.requests.map((request) => request.body?.max_completion_tokens);
  const efforts = () => fake.requests.map((request) => request.body?.reasoning_effort);
  const long = z.object({ items: z.array(z.string().min(1).max(100)).min(1) });

  it('does not let a tiny request be cut off: it is given room to think, and asked to think little', async () => {
    // The connection check asked for 50 tokens. At its default effort a reasoning deployment spends far more
    // than that thinking about it, so the reply ended at the limit with no JSON in it, and so did the retry.
    const { client, seen } = made({ model: 'think-dep' });
    fake.script({ kind: 'reply', value: { answer: 'ok' } });
    await expect(client.json(answer, 'Return JSON.', {}, signal(), 50)).resolves.toEqual({
      answer: 'ok',
    });
    expect(fake.requests).toHaveLength(1);
    expect(body()).toMatchObject({ max_completion_tokens: 50 + 1_000, reasoning_effort: 'low' });
    expect(seen.calls[0]).toMatchObject({
      ok: true,
      finishReason: 'stop',
      effort: 'low',
      maxOutputTokens: 1_050,
      reasoningTokens: 600,
    });
  });

  it('gives a task that writes a good deal room for what it writes as well as for its thinking', async () => {
    // About 1,500 tokens of answer in a budget of 1,800, as the research planner's: the 600 tokens spent
    // thinking at `low` do not fit under 1,800 with it, and do under 1,800 and the room made for them.
    const { client } = made({ model: 'think-dep' });
    const items = Array.from({ length: 60 }, (_, index) => `item ${index} ${'x'.repeat(88)}`);
    fake.script({ kind: 'reply', value: { items } });
    await expect(client.json(long, 'Return JSON.', {}, signal(), 1_800)).resolves.toEqual({
      items,
    });
    expect(fake.requests).toHaveLength(1);
    expect(sizes()).toEqual([2_800]);
  });

  it('asks again, once, with twice the room and less thinking, when a reply ends at its limit', async () => {
    const { client, seen } = made({ model: 'think-dep' });
    const report: CallReport = {};
    // The route names a medium effort, which thinks 3,000 tokens: more than the room made for it.
    fake.script(
      { kind: 'reply', value: { answer: 'ok' } },
      { kind: 'reply', value: { answer: 'ok' } },
    );
    await expect(
      client.json(answer, 'Return JSON.', {}, signal(), 500, {
        route: { reasoningEffort: 'medium' },
        report,
      }),
    ).resolves.toEqual({ answer: 'ok' });
    expect(sizes()).toEqual([500 + 2_000, (500 + 2_000) * 2]);
    expect(efforts()).toEqual(['medium', 'low']);
    expect(seen.calls.map((event) => [event.ok, event.repair, event.finishReason])).toEqual([
      [false, false, 'length'],
      [true, false, 'stop'],
    ]);
    // What the cut-off reply cost is on record: all of its tokens went on thinking, and none was an answer.
    expect(seen.calls[0]).toMatchObject({
      errorCode: 'MODEL_TRUNCATED',
      outputTokens: 2_500,
      reasoningTokens: 2_500,
      effort: 'medium',
      maxOutputTokens: 2_500,
    });
    expect(seen.calls[1]).toMatchObject({ effort: 'low', maxOutputTokens: 5_000 });
    // A cut-off reply was never read, so it is not a correction round.
    expect(report.repairs).toBe(0);
  });

  it('does not use up the correction on a reply that was cut off: the reply that is read is still corrected', async () => {
    // What the live pilot did: the first reply was cut off, the second was whole but was refused by the
    // server's own check, and there was no correction left for it, so the step ended in rules.
    const { client, seen } = made({ model: 'fast-dep' });
    fake.script(
      { kind: 'truncated' },
      { kind: 'reply', value: { answer: 'wrong' } },
      { kind: 'reply', value: { answer: 'right' } },
    );
    const validate = (value: { answer: string }): void => {
      if (value.answer === 'wrong')
        throw new AppError(502, 'MODEL_OUTPUT_INVALID', 'The answer must be right.');
    };
    await expect(
      client.json(answer, 'Return JSON.', {}, signal(), 500, { repairs: 1, validate }),
    ).resolves.toEqual({ answer: 'right' });
    expect(fake.requests).toHaveLength(3);
    expect(seen.calls.map((event) => [event.ok, event.repair])).toEqual([
      [false, false],
      [true, false],
      [true, true],
    ]);
    expect(fake.requests[2]?.body?.messages?.at(-1)?.content).toContain(
      'The answer must be right.',
    );
  });

  it('fails as truncated when the second reply is cut off too, and has counted the tokens of both', async () => {
    const usage = vi.fn();
    const { client } = made({ usage });
    fake.script(
      { kind: 'truncated', usage: { prompt: 40, completion: 1_500, reasoning: 1_500 } },
      { kind: 'truncated', usage: { prompt: 40, completion: 3_000, reasoning: 2_900 } },
    );
    await expect(client.json(answer, 'Return JSON.', {}, signal(), 500)).rejects.toMatchObject({
      code: 'MODEL_TRUNCATED',
    });
    expect(fake.requests).toHaveLength(2);
    expect(usage.mock.calls).toEqual([
      [{ inputTokens: 40, outputTokens: 1_500 }],
      [{ inputTokens: 40, outputTokens: 3_000 }],
    ]);
  });

  it('never accepts a reply that ended at its limit, even one that parses as the answer', async () => {
    const { client } = made();
    fake.respond(() => ({ kind: 'truncated', partial: '{"answer":"looks whole"}' }));
    await expect(client.json(answer, 'Return JSON.', {}, signal(), 500)).rejects.toMatchObject({
      code: 'MODEL_TRUNCATED',
    });
    expect(fake.requests).toHaveLength(2);
  });

  it('asks the project before the retry, so a project that has used its budget does not get it', async () => {
    let asked = 0;
    const usage = Object.assign(vi.fn(), {
      admit: () => {
        asked += 1;
        if (asked > 1) throw new AppError(429, 'PROJECT_BUDGET', 'The budget is used.');
      },
    }) as ModelUsageSink;
    const { client } = made({ usage });
    fake.script({ kind: 'truncated' }, { kind: 'reply', value: { answer: 'ok' } });
    await expect(client.json(answer, 'Return JSON.', {}, signal(), 500)).rejects.toMatchObject({
      code: 'PROJECT_BUDGET',
    });
    expect(fake.requests).toHaveLength(1);
  });

  it('counts the retry against the call cap of the operation', async () => {
    const { client } = made({ maxCalls: 1 });
    fake.script({ kind: 'truncated' }, { kind: 'reply', value: { answer: 'ok' } });
    await expect(client.json(answer, 'Return JSON.', {}, signal(), 500)).rejects.toMatchObject({
      code: 'MODEL_CALL_BUDGET',
    });
    expect(fake.requests).toHaveLength(1);
  });

  it('makes the room for an effort a route names, unless the route says it has made it', async () => {
    const { client } = made({ model: 'deep-dep' });
    await client.json(answer, 'Return JSON.', {}, signal(), 800, {
      route: { reasoningEffort: 'high' },
    });
    await client.json(answer, 'Return JSON.', {}, signal(), 800, {
      route: { reasoningEffort: 'high', roomForReasoning: true },
    });
    expect(sizes()).toEqual([800 + 4_000, 800]);
  });

  it('asks a deployment that takes no effort without one, once, and gives it no room it has no use for', async () => {
    const capabilities = new CapabilityMemory();
    const { client } = made({ model: 'classic-dep', capabilities });
    await client.json(answer, 'Return JSON.', {}, signal(), 800);
    expect(efforts()).toEqual(['low', undefined]);
    expect(capabilities.get('classic-dep')).toEqual({ reasoningEffort: false });
    fake.reset();
    await client.json(answer, 'Return JSON.', {}, signal(), 800);
    expect(fake.requests).toHaveLength(1);
    expect(body().reasoning_effort).toBeUndefined();
    expect(sizes()).toEqual([800]);
  });

  it('blames a refusal that names no parameter on the effort it added, and keeps the strict output', async () => {
    // Azure says only that it does not recognise the argument. Blaming the structured output for it,
    // as an ambiguous refusal was, would give up strict JSON for a deployment that takes it.
    const capabilities = new CapabilityMemory();
    const { client } = made({ model: 'vague-dep', capabilities });
    await client.json(answer, 'Return JSON.', {}, signal(), 800);
    expect(
      fake.requests.map((request) => [
        request.status,
        request.body?.response_format?.type,
        request.body?.reasoning_effort,
      ]),
    ).toEqual([
      [400, 'json_schema', 'low'],
      [200, 'json_schema', undefined],
    ]);
    expect(capabilities.get('vague-dep')).toEqual({ reasoningEffort: false });
    expect(capabilities.isSchemaRefused('vague-dep', 'anything')).toBe(false);
  });

  it('puts the effort back when a second vague refusal shows it was not the cause, and remembers no error', async () => {
    const capabilities = new CapabilityMemory();
    const { client } = made({ model: 'fast-dep', capabilities });
    fake.script(
      { kind: 'status', status: 400, code: 'BadRequest' },
      { kind: 'status', status: 400, code: 'BadRequest' },
      { kind: 'reply', value: { answer: 'plain' } },
    );
    await client.json(answer, 'Return JSON.', {}, signal(), 500);
    expect(
      fake.requests.map((request) => [
        request.body?.response_format?.type,
        request.body?.reasoning_effort,
      ]),
    ).toEqual([
      ['json_schema', 'low'],
      ['json_schema', undefined],
      ['json_object', 'low'],
    ]);
    expect(capabilities.get('fast-dep')).toEqual({});
  });

  it('is not led in circles by refusals that keep naming nothing: it stops after the adjustments it allows', async () => {
    const { client } = made({ model: 'fast-dep' });
    fake.respond(() => ({ kind: 'status', status: 400, code: 'BadRequest' }));
    await expect(client.json(answer, 'Return JSON.', {}, signal(), 500)).rejects.toMatchObject({
      code: 'MODEL_HTTP_ERROR',
    });
    expect(fake.requests).toHaveLength(3);
  });

  it('asks a deployment that does not take the lowest effort at the next one up, and remembers it', async () => {
    const capabilities = new CapabilityMemory();
    const { client } = made({ model: 'o-dep', capabilities });
    const route = { reasoningEffort: 'minimal' } as const;
    await client.json(answer, 'Return JSON.', {}, signal(), 800, { route });
    expect(efforts()).toEqual(['minimal', 'low']);
    expect(capabilities.get('o-dep')).toEqual({ minimalEffort: false });
    // It is asked at `low` from then on, and a cut-off reply cannot be asked again at less than that.
    fake.reset();
    fake.script({ kind: 'truncated' }, { kind: 'reply', value: { answer: 'ok' } });
    await client.json(answer, 'Return JSON.', {}, signal(), 800, { route });
    expect(efforts()).toEqual(['low', 'low']);
    expect(sizes()).toEqual([1_800, 3_600]);
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

  it('is a block, not a protocol error, when the blocked reply has no content at all', async () => {
    const { client } = made();
    fake.respond(() => ({ kind: 'filter-output', categories: ['hate'], partial: null }));
    const failure = await client
      .json(answer, 'Return JSON.', {}, signal())
      .catch((error: unknown) => error);
    expect(fake.requests[0]?.status).toBe(200);
    expect(failure).toBeInstanceOf(ModelRefusedError);
    expect((failure as ModelRefusedError).findings).toEqual([
      { class: 'blocked_output', action: 'blocked', category: 'hate' },
    ]);
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

  it('stops waiting out a throttle when it is cancelled, ends its ticket, and says so', async () => {
    const { client } = made();
    const controller = new AbortController();
    const ended: boolean[] = [];
    fake.respond(() => ({ kind: 'status', status: 429, retryAfterSeconds: 8 }));
    const pending = client.json(answer, 'Return JSON.', {}, controller.signal, 500, {
      gate: {
        begin: () => ({ end: (event) => void ended.push(event.ok) }),
      },
    });
    await vi.waitFor(() => expect(fake.requests).toHaveLength(1));
    const asked = performance.now();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'RUN_CANCELLED' });
    expect(performance.now() - asked).toBeLessThan(2_000);
    expect(fake.requests).toHaveLength(1);
    expect(ended).toEqual([false]);
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

describe('what the process remembers about the deployments that refused it', () => {
  it('keeps everything a deployment refused, so each thing is found out once', () => {
    const memory = new CapabilityMemory();
    memory.refused('d', { jsonSchema: false });
    memory.refused('d', { temperature: false });
    expect(memory.get('d')).toEqual({ jsonSchema: false, temperature: false });
    memory.refused('d', { reasoningEffort: false });
    expect(memory.get('d')).toEqual({
      jsonSchema: false,
      temperature: false,
      reasoningEffort: false,
    });
    expect(memory.snapshot()).toEqual({ d: memory.get('d') });
    expect(memory.get('another')).toEqual({});
  });

  it('forgets what it has not been reminded of for the time it is believed, and starts again from nothing', () => {
    let now = 0;
    const memory = new CapabilityMemory({ ttlMs: 1_000, now: () => now });
    memory.refused('d', { jsonSchema: false });
    now = 900;
    memory.refused('d', { temperature: false });
    // A new refusal renews the whole entry: they are one deployment's, and are found out together.
    now = 1_500;
    expect(memory.get('d')).toEqual({ jsonSchema: false, temperature: false });
    now = 2_000;
    expect(memory.get('d')).toEqual({});
    memory.refused('d', { reasoningEffort: false });
    expect(memory.get('d')).toEqual({ reasoningEffort: false });
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
    // 700 to write, and the 1,000 tokens of room to think that the low effort it is asked at is given.
    expect(log).toEqual([
      'begin plain-dep 1700',
      'end false ~true',
      'begin plain-dep 1700',
      'end true 30',
      'begin plain-dep 1700',
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
    // A reply that ended at its limit is asked for again with twice the room, thinking included.
    expect(log[0]).toBe('begin fast-dep 1500');
    expect(log[2]).toBe('begin fast-dep 3000');
    expect(log[1]).toMatch(/^end false \d+$/u);
  });
});
