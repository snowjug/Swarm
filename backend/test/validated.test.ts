import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { modelGraph } from '../src/agents/model.js';
import { AppError } from '../src/errors.js';
import { ModelClient, type JsonOptions, type ModelGateway } from '../src/models/client.js';
import { jsonValidated } from '../src/models/validated.js';
import { Repository } from '../src/storage/repository.js';
import { fixtureInput, testConfig } from './fixtures.js';
import { chatCompletion } from './support/model-brain.js';

const schemaOf = (parse: (value: unknown) => unknown) =>
  ({
    safeParse: (value: unknown) => ({ success: true, data: parse(value) }),
  }) as unknown as z.ZodType<{
    n: number;
  }>;

const mustBePositive = (value: { n: number }): void => {
  if (value.n <= 0) throw new AppError(502, 'MODEL_OUTPUT_INVALID', 'n must be positive.');
};

describe('jsonValidated', () => {
  it('hands the validator to the gateway so it can drive a bounded repair', async () => {
    let received: JsonOptions<{ n: number }> | undefined;
    const gateway: ModelGateway = {
      async json<T>(
        _schema: z.ZodType<T>,
        _i: string,
        _d: unknown,
        _s: AbortSignal,
        _m?: number,
        options?: JsonOptions<T>,
      ): Promise<T> {
        received = options as JsonOptions<{ n: number }>;
        return { n: 1 } as T;
      },
    };
    await jsonValidated(
      gateway,
      schemaOf((v) => v),
      'x',
      {},
      new AbortController().signal,
      100,
      mustBePositive,
    );
    expect(received?.validate).toBe(mustBePositive);
    // No repair count is sent unless the call site asks for one, so the client's default applies.
    expect(received).not.toHaveProperty('repairs');
  });

  it('passes the number of corrective retries a call site asks for', async () => {
    let received: JsonOptions<{ n: number }> | undefined;
    const gateway: ModelGateway = {
      async json<T>(
        _schema: z.ZodType<T>,
        _i: string,
        _d: unknown,
        _s: AbortSignal,
        _m?: number,
        options?: JsonOptions<T>,
      ): Promise<T> {
        received = options as JsonOptions<{ n: number }>;
        return { n: 1 } as T;
      },
    };
    await jsonValidated(
      gateway,
      schemaOf((v) => v),
      'x',
      {},
      new AbortController().signal,
      100,
      mustBePositive,
      3,
    );
    expect(received).toMatchObject({ validate: mustBePositive, repairs: 3 });
  });

  it('still enforces the validator when a gateway ignores the hook', async () => {
    const careless: ModelGateway = {
      async json<T>(): Promise<T> {
        return { n: -1 } as T;
      },
    };
    await expect(
      jsonValidated(
        careless,
        schemaOf((v) => v),
        'x',
        {},
        new AbortController().signal,
        undefined,
        mustBePositive,
      ),
    ).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
  });

  it('returns the value untouched when it is valid and propagates gateway failures', async () => {
    const good: ModelGateway = {
      async json<T>(): Promise<T> {
        return { n: 5 } as T;
      },
    };
    await expect(
      jsonValidated(
        good,
        schemaOf((v) => v),
        'x',
        {},
        new AbortController().signal,
        undefined,
        mustBePositive,
      ),
    ).resolves.toEqual({ n: 5 });
    const failing: ModelGateway = {
      async json<T>(): Promise<T> {
        throw new AppError(503, 'MODEL_NOT_CONFIGURED', 'nope');
      },
    };
    await expect(
      jsonValidated(
        failing,
        schemaOf((v) => v),
        'x',
        {},
        new AbortController().signal,
        undefined,
        mustBePositive,
      ),
    ).rejects.toMatchObject({ code: 'MODEL_NOT_CONFIGURED' });
  });
});

describe('repair at a real call site (source-graph extraction)', () => {
  const config = testConfig({
    AI_PROVIDER: 'openai',
    AI_MODEL: 'fixture-model',
    OPENAI_API_KEY: 'test-placeholder-only',
  });
  const graph = (citation: string) => ({
    nodes: [
      {
        id: 'n1',
        label: 'Transit',
        kind: 'topic',
        summary: 'Proposed transit pilot described in the source.',
        quote: 'The City Transit Office proposes a six-month electric bus pilot',
        weight: 1,
        sourceIds: [citation],
      },
      {
        id: 'n2',
        label: 'Community',
        kind: 'group',
        summary: 'Fictional community groups described in the source.',
        quote: 'Neighborhood groups ask for accessible stops and clear information',
        weight: 0.5,
        sourceIds: ['S1'],
      },
    ],
    edges: [{ source: 'n1', target: 'n2', label: 'discussed by', weight: 0.7, sourceIds: ['S1'] }],
  });

  it('corrects an invented citation with one corrective retry instead of failing the stage', async () => {
    const repository = new Repository(':memory:');
    try {
      const project = repository.create(fixtureInput());
      const bodies: Array<{ messages: Array<{ role: string; content: string }> }> = [];
      const replies = [graph('S999'), graph('S1')];
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return chatCompletion(replies[bodies.length - 1]);
      });
      const client = new ModelClient(config.provider, () => undefined, fetcher, 5);
      const result = await modelGraph(
        client,
        project,
        repository.chunks(project.id),
        new AbortController().signal,
      );
      expect(result.method).toBe('llm');
      expect(result.nodes[0]?.sourceIds).toEqual(['S1']);
      expect(fetcher).toHaveBeenCalledTimes(2);
      const repair = bodies[1]!.messages.at(-1)!.content;
      expect(repair).toContain('rejected by the server');
      expect(repair).toContain('valid passage IDs: S1');
      expect(repair).not.toContain('S999');
    } finally {
      repository.close();
    }
  });

  it('gives up after the bounded number of repairs and never echoes the model’s invented text', async () => {
    const repository = new Repository(':memory:');
    try {
      const project = repository.create(fixtureInput());
      const fetcher = vi
        .fn<typeof fetch>()
        .mockImplementation(async () => chatCompletion(graph('S999')));
      const client = new ModelClient(config.provider, () => undefined, fetcher, 10);
      const failure = await modelGraph(
        client,
        project,
        repository.chunks(project.id),
        new AbortController().signal,
      ).catch((error: unknown) => error);
      expect(failure).toMatchObject({ code: 'MODEL_OUTPUT_INVALID', statusCode: 502 });
      expect((failure as Error).message).not.toContain('S999');
      // The first reply plus at most two repairs, and no silent local fallback.
      expect(fetcher).toHaveBeenCalledTimes(3);
    } finally {
      repository.close();
    }
  });
});
