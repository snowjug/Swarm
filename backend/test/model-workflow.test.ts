import { setImmediate as yieldToLoop } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { modelGraph } from '../src/agents/model.js';
import { buildApp } from '../src/app.js';
import { AppError } from '../src/errors.js';
import { ModelClient, type ModelGateway } from '../src/models/client.js';
import { Repository } from '../src/storage/repository.js';
import { fixtureInput, testConfig } from './fixtures.js';

type Application = Awaited<ReturnType<typeof buildApp>>;
const applications: Application[] = [];
const modelEnvironment = {
  AI_PROVIDER: 'openai',
  AI_MODEL: 'fixture-model',
  OPENAI_API_KEY: 'test-placeholder-only',
};
const graphFixture = {
  nodes: [
    {
      id: 'n1',
      label: 'Transit',
      kind: 'topic',
      summary: 'Proposed transit pilot described in the source.',
      weight: 1,
      sourceIds: ['S1'],
    },
    {
      id: 'n2',
      label: 'Community',
      kind: 'group',
      summary: 'Fictional community groups described in the source.',
      weight: 0.5,
      sourceIds: ['S1'],
    },
  ],
  edges: [{ source: 'n1', target: 'n2', label: 'discussed by', weight: 0.7, sourceIds: ['S1'] }],
};

afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

function scriptedGateway(values: unknown[]): ModelGateway {
  let index = 0;
  return {
    async json<T>(schema: z.ZodType<T>): Promise<T> {
      return schema.parse(values[index++]);
    },
  };
}

describe('model-assisted pipeline (explicit test fixtures, not live AI verification)', () => {
  it('makes the actual adapter calls for graph, personas, decisions and report and persists provider usage', async () => {
    const config = testConfig(modelEnvironment);
    const personas = {
      agents: Array.from({ length: 4 }, (_, index) => ({
        id: `agent-${index + 1}`,
        name: `Fictional member ${index + 1}`,
        role: 'Synthetic stakeholder',
        persona:
          'An explicitly fictional stakeholder proxy with assumed interests in transit policy.',
        topicIds: ['n1'],
        initialOpinion: (index - 1.5) / 2,
        influence: 1,
        openness: 0.5,
        sourceIds: ['S1'],
      })),
    };
    const decisions = Array.from({ length: 3 }, (_, round) => ({
      decisions: personas.agents.map((agent, index) => ({
        agentId: agent.id,
        opinion: (index - 1) / 3,
        type: 'post',
        content: `Fixture simulated statement for round ${round + 1}.`,
        peerIds: [`agent-${((index + 1) % 4) + 1}`],
        sourceIds: ['S1'],
      })),
    }));
    const report = {
      title: 'Fixture conditional scenario report',
      executiveSummary:
        'This fixture describes conditional simulated outcomes, not a verified forecast or real stakeholder beliefs.',
      sections: ['Evidence', 'Trajectory', 'Next experiments'].map((title) => ({
        title,
        body: 'Recorded simulation metrics should be reviewed against the supplied scenario assumptions and source evidence.',
        sourceIds: ['S1'],
      })),
      limitations: ['Test fixture only; not a live provider evaluation.'],
    };
    const outputs = [graphFixture, personas, ...decisions, report];
    let index = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              { message: { content: JSON.stringify(outputs[index++]) }, finish_reason: 'stop' },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
        ),
    );
    const instance = await buildApp({
      config,
      modelFactory: (onUsage) => new ModelClient(config.provider, onUsage, fetcher),
    });
    applications.push(instance);
    const project = instance.repository.create(
      fixtureInput({ settings: { mode: 'llm', agentCount: 4, rounds: 3 } }),
    );
    instance.jobs.enqueue(project.id);
    await instance.jobs.idle();
    const result = instance.repository.get(project.id);
    expect(result.error).toBeNull();
    expect(result.status).toBe('completed');
    expect(result.graph!.method).toBe('llm');
    expect(result.report!.generatedBy).toBe('llm');
    expect(result.rounds).toHaveLength(3);
    expect(result.execution).toMatchObject({ modelCalls: 6, inputTokens: 60, outputTokens: 30 });
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(result.report!.metrics.totalInteractions).toBe(12);
    expect(
      result.report!.limitations.some((limitation) =>
        limitation.includes('not a calibrated forecast'),
      ),
    ).toBe(true);
  });

  it('persists provider failure explicitly, without falling back to local graph/report', async () => {
    const config = testConfig(modelEnvironment);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('PRIVATE_PROVIDER_PAYLOAD', { status: 401 }));
    const instance = await buildApp({
      config,
      modelFactory: (onUsage) => new ModelClient(config.provider, onUsage, fetcher),
    });
    applications.push(instance);
    const project = instance.repository.create(
      fixtureInput({ settings: { mode: 'llm', agentCount: 4, rounds: 3 } }),
    );
    instance.jobs.enqueue(project.id);
    await instance.jobs.idle();
    const result = instance.repository.get(project.id);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('HTTP 401');
    expect(result.error).not.toContain('PRIVATE_PROVIDER_PAYLOAD');
    expect(result.graph).toBeNull();
    expect(result.report).toBeNull();
    expect(result.rounds).toEqual([]);
  });

  it('rejects model citations to evidence it was not given', async () => {
    const repository = new Repository(':memory:');
    try {
      const project = repository.create(fixtureInput());
      const invalid = {
        ...graphFixture,
        nodes: graphFixture.nodes.map((node) => ({ ...node, sourceIds: ['S999'] })),
      };
      await expect(
        modelGraph(
          scriptedGateway([invalid]),
          project,
          repository.chunks(project.id),
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
    } finally {
      repository.close();
    }
  });

  it('bounds the queue and handles queued and in-flight cancellation without overwriting a new run', async () => {
    const waiting: ModelGateway = {
      async json<T>(
        _schema: z.ZodType<T>,
        _instructions: string,
        _data: unknown,
        signal: AbortSignal,
      ): Promise<T> {
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
    };
    const instance = await buildApp({
      config: testConfig(modelEnvironment),
      modelFactory: () => waiting,
    });
    applications.push(instance);
    const projects = Array.from({ length: 5 }, () =>
      instance.repository.create(
        fixtureInput({ settings: { mode: 'llm', agentCount: 4, rounds: 3 } }),
      ),
    );
    const first = projects[0]!;
    instance.jobs.enqueue(first.id);
    await yieldToLoop();
    expect(instance.jobs.state().active).toBe(first.id);
    for (const project of projects.slice(1, 4)) instance.jobs.enqueue(project.id);
    expect(instance.jobs.state().pending).toBe(3);
    expect(() => instance.jobs.enqueue(projects[4]!.id)).toThrow('queue is full');
    expect(() => instance.jobs.enqueue(first.id)).toThrow('active or stopping');
    const deletion = await instance.app.inject({
      method: 'DELETE',
      url: `/api/projects/${first.id}`,
    });
    expect(deletion.statusCode).toBe(409);
    for (const project of projects.slice(1, 4)) instance.jobs.cancel(project.id);
    instance.jobs.cancel(first.id);
    expect(() => instance.jobs.enqueue(first.id)).toThrow(AppError);
    await instance.jobs.idle();
    expect(instance.repository.get(first.id).status).toBe('cancelled');
    expect(instance.repository.get(first.id).report).toBeNull();
    expect(instance.jobs.state()).toEqual({ active: null, pending: 0 });
  });
});
