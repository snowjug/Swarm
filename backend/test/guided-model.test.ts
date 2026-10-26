import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { buildApp } from '../src/app.js';
import { AppError } from '../src/errors.js';
import { ModelClient, type ModelGateway } from '../src/models/client.js';
import { fixtureInput, testConfig } from './fixtures.js';

type Application = Awaited<ReturnType<typeof buildApp>>;
const applications: Application[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});
const environment = {
  AI_PROVIDER: 'openai',
  AI_MODEL: 'fixture-model',
  OPENAI_API_KEY: 'test-placeholder-only',
};
const ontology = {
  entityTypes: [
    { name: 'Organization', description: 'An organization described by the supplied text.' },
    { name: 'Community', description: 'A source-described stakeholder group.' },
  ],
  relationshipTypes: [
    { name: 'informs', description: 'A source-grounded information relationship.' },
  ],
};
const graph = {
  nodes: [
    {
      id: 'n1',
      label: 'Transit Office',
      kind: 'organization',
      entityType: 'Organization',
      summary: 'A fictional office described in the transit notes.',
      weight: 1,
      sourceIds: ['S1'],
    },
    {
      id: 'n2',
      label: 'Community',
      kind: 'group',
      entityType: 'Community',
      summary: 'A fictional community described in the transit notes.',
      weight: 0.5,
      sourceIds: ['S1'],
    },
  ],
  edges: [{ source: 'n1', target: 'n2', label: 'informs', weight: 0.7, sourceIds: ['S1'] }],
};
const personas = {
  agents: Array.from({ length: 4 }, (_, index) => ({
    id: `agent-${index + 1}`,
    name: `Fictional proxy ${index + 1}`,
    role: 'Synthetic stakeholder',
    persona:
      'An explicitly fictional stakeholder proxy with assumed interests in the transit proposal.',
    topicIds: ['n1'],
    initialOpinion: (index - 1.5) / 2,
    influence: 1,
    openness: 0.5,
    sourceIds: ['S1'],
  })),
};
const prepared = {
  minutesPerRound: 60,
  initialPosts: [
    {
      text: 'This is an assumed starting point for discussion, not measured public opinion.',
      platform: 'both',
      stance: 0,
      strength: 0,
      sourceIds: ['S1'],
    },
  ],
};
const interview = {
  answer:
    "As an explicitly fictional proxy, I can describe only this recorded scenario, not a real person's beliefs.",
  sourceIds: ['S1'],
  memoryIds: [],
};
const plan = {
  title: 'Conditional transit scenario',
  sections: ['Evidence and assumptions', 'Recorded trajectories', 'Limitations and controls'],
  evidenceQueries: ['transit service proposal'],
  interviewAgentIds: ['agent-1', 'agent-4'],
  interviewQuestion: 'How did this fictional transit discussion unfold?',
};
const summary = {
  summary:
    'This is a conditional comparison of two recorded synthetic contexts. It does not establish calibrated probabilities or real-world stakeholder beliefs.',
};
const chapter = {
  body: 'Recorded platform inclinations differ under their assumed interaction structures. Review the source text and compare controlled scenarios before drawing conclusions.',
  sourceIds: ['S1'],
  memoryIds: [],
  interviewIds: ['I1'],
};

function decisions(platform: 'plaza' | 'community') {
  return {
    decisions: personas.agents.map((agent, index) => ({
      agentId: agent.id,
      opinion: (platform === 'plaza' ? 0.4 : -0.6) + index * 0.1,
      type: 'post',
      content: 'Transit service proposal is discussed in this fictional scenario.',
      peerIds: [`agent-${((index + 1) % 4) + 1}`],
      sourceIds: ['S1'],
    })),
  };
}

describe('model-guided console (explicit HTTP fixtures, not live inference)', () => {
  it('supports 20 actual adapter calls for ten dual-platform rounds, chapter generation, tools and async interviews', async () => {
    const config = testConfig(environment);
    const outputs: unknown[] = [ontology, graph, personas, prepared];
    for (let round = 1; round <= 10; round += 1)
      outputs.push(decisions('plaza'), decisions('community'));
    outputs.push(
      plan,
      interview,
      interview,
      summary,
      chapter,
      chapter,
      chapter,
      interview,
      interview,
    );
    let cursor = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              { message: { content: JSON.stringify(outputs[cursor++]) }, finish_reason: 'stop' },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
        ),
    );
    const budgets: number[] = [];
    const instance = await buildApp({
      config,
      modelFactory: (onUsage, options) => {
        budgets.push(options?.maxCalls || 16);
        return new ModelClient(config.provider, onUsage, fetcher, options?.maxCalls);
      },
    });
    applications.push(instance);
    const project = instance.repository.create(
      fixtureInput({
        workflow: 'guided',
        settings: { mode: 'llm', agentCount: 4, rounds: 10 },
      }),
    );
    for (const step of ['knowledge', 'environment', 'simulation', 'report'] as const) {
      instance.jobs.enqueueStep(project.id, step);
      await instance.jobs.idle();
      const result = instance.repository.get(project.id);
      expect(result.error, `${step} error`).toBeNull();
      expect(result.console?.steps[step]).toBe('ready');
    }
    const result = instance.repository.get(project.id);
    expect(result.status).toBe('completed');
    expect(budgets).toEqual([16, 16, 24, 16]);
    expect(result.execution).toMatchObject({ modelCalls: 31, inputTokens: 310, outputTokens: 155 });
    expect(result.console?.platforms.map((world) => world.rounds.length)).toEqual([10, 10]);
    expect(result.console?.reportPlan?.completedSections).toBe(3);
    expect(result.console?.interviews).toHaveLength(2);
    expect(result.report?.sections).toHaveLength(3);
    expect(result.console?.traces.map((trace) => trace.name)).toEqual(
      expect.arrayContaining([
        'Ontology definition',
        'Source graph construction',
        'Local source and memory search',
        'Recorded timeline reconstruction',
        'Fictional proxy interview',
      ]),
    );
    const body = await instance.app.inject(`/api/projects/${project.id}/export?format=markdown`);
    expect(body.body).toContain('Generated fictional interviews');
    expect(body.body).toContain('I1');
    const survey = instance.interaction.startSurvey(project.id, {
      kind: 'interview',
      question: 'Describe this fictional transit scenario.',
      agentIds: ['agent-1', 'agent-2'],
    });
    await instance.interaction.idle();
    const recorded = instance.repository
      .get(project.id)
      .console!.surveys.find((item) => item.id === survey.id)!;
    expect(recorded.status).toBe('completed');
    expect(recorded.responses).toHaveLength(2);
    expect(
      recorded.responses.every((response) => response.answer?.includes('fictional proxy')),
    ).toBe(true);
    expect(instance.repository.get(project.id).execution?.modelCalls).toBe(33);
    expect(fetcher).toHaveBeenCalledTimes(33);
    fetcher.mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          const requestSignal = options?.signal;
          if (!requestSignal) throw new Error('Model requests must carry an abort signal.');
          const abort = () => reject(new DOMException('Fixture request aborted.', 'AbortError'));
          if (requestSignal.aborted) abort();
          else requestSignal.addEventListener('abort', abort, { once: true });
        }),
    );
    const cancelled = instance.interaction.startSurvey(project.id, {
      kind: 'interview',
      question: 'Cancel this in-flight fictional interview.',
      agentIds: ['agent-1'],
    });
    instance.interaction.cancelSurvey(project.id, cancelled.id);
    await instance.interaction.idle();
    const afterCancellation = instance.repository.get(project.id);
    expect(afterCancellation.status).toBe('completed');
    expect(
      afterCancellation.console?.surveys.find((item) => item.id === cancelled.id)?.status,
    ).toBe('cancelled');
    expect(afterCancellation.execution?.modelCalls).toBe(33);
  });

  it('stops the sibling platform request on failure and never persists a partial combined round as complete', async () => {
    let siblingAborted = false;
    const gateway: ModelGateway = {
      async json<T>(
        schema: z.ZodType<T>,
        instructions: string,
        data: unknown,
        signal: AbortSignal,
      ): Promise<T> {
        if (instructions.startsWith('Define a small ontology')) return schema.parse(ontology);
        if (instructions.startsWith('Extract a source-grounded graph under'))
          return schema.parse(graph);
        if (instructions.startsWith('Construct exactly')) return schema.parse(personas);
        if (instructions.startsWith('Prepare initial scenario')) return schema.parse(prepared);
        const context = z
          .object({ scenarioContext: z.object({ platform: z.enum(['plaza', 'community']) }) })
          .parse(data);
        if (context.scenarioContext.platform === 'plaza')
          throw new AppError(502, 'MODEL_TEST_FAILURE', 'A fixture provider failure.');
        return new Promise<T>((_resolve, reject) => {
          const abort = () => {
            siblingAborted = true;
            reject(signal.reason);
          };
          if (signal.aborted) abort();
          else signal.addEventListener('abort', abort, { once: true });
        });
      },
    };
    const instance = await buildApp({
      config: testConfig(environment),
      modelFactory: () => gateway,
    });
    applications.push(instance);
    const project = instance.repository.create(
      fixtureInput({ workflow: 'guided', settings: { mode: 'llm', agentCount: 4, rounds: 3 } }),
    );
    for (const step of ['knowledge', 'environment', 'simulation'] as const) {
      instance.jobs.enqueueStep(project.id, step);
      await instance.jobs.idle();
    }
    const result = instance.repository.get(project.id);
    expect(result.status).toBe('failed');
    expect(result.console?.steps).toMatchObject({
      knowledge: 'ready',
      environment: 'ready',
      simulation: 'failed',
      report: 'pending',
    });
    expect(result.rounds).toEqual([]);
    expect(result.report).toBeNull();
    expect(result.console?.platforms.every((world) => world.status === 'failed')).toBe(true);
    expect(siblingAborted).toBe(true);
  });
});
