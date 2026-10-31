import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { buildApp } from '../src/app.js';
import type { ServerConfig } from '../src/config.js';
import { AppError } from '../src/errors.js';
import { ModelClient, type ModelGateway, type ModelUsageSink } from '../src/models/client.js';
import type { ModelFactory } from '../src/models/factory.js';
import { ModelSectionRegenerator } from '../src/studio/regenerate.js';
import { LedgerService } from '../src/grounding/service.js';
import { StudioService } from '../src/studio/service.js';
import { fixtureInput, testConfig } from './fixtures.js';
import { scriptedFetcher } from './support/model-brain.js';

// A project that has used its model budget gets no further model call, by whatever way a model is
// reached. The client is tested on its own, then each of the five places that make one is shown to
// hold the budget of its own project, and then a whole run is stopped by it and carried on.

type Application = Awaited<ReturnType<typeof buildApp>>;
const applications: Application[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

const modelEnvironment = {
  AI_PROVIDER: 'openai',
  AI_MODEL: 'fixture-model',
  OPENAI_API_KEY: 'test-placeholder-only',
};
const answer = z.object({ answer: z.string() });
const signal = () => new AbortController().signal;
const provider = () => testConfig(modelEnvironment).provider;
const completion = (content: string) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 20, completion_tokens: 10 },
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
const refusal = () => new AppError(429, 'PROJECT_BUDGET', 'The budget is used.');

/** A sink that lets `allowed` calls through and refuses the rest, counting how often it was asked. */
function sink(allowed: number) {
  let asked = 0;
  const record = vi.fn();
  const admit = vi.fn(() => {
    asked += 1;
    if (asked > allowed) throw refusal();
  });
  return Object.assign(record, { admit }) satisfies ModelUsageSink;
}

describe('a model client that its sink can hold back', () => {
  it('is asked before every call, and sends nothing once refused', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => completion('{"answer":"ok"}'));
    const usage = sink(1);
    const client = new ModelClient(provider(), usage, fetcher);
    await client.json(answer, 'Return JSON.', {}, signal());
    await expect(client.json(answer, 'Return JSON.', {}, signal())).rejects.toMatchObject({
      code: 'PROJECT_BUDGET',
      statusCode: 429,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(usage.admit).toHaveBeenCalledTimes(2);
    expect(usage).toHaveBeenCalledTimes(1);
  });

  it('is asked again before a repair, and a refusal there is the refusal, not a failed answer', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(completion('{"answer": 7}'))
      .mockResolvedValue(completion('{"answer":"fixed"}'));
    const refusedRepair = sink(1);
    await expect(
      new ModelClient(provider(), refusedRepair, fetcher).json(
        answer,
        'Return JSON.',
        {},
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'PROJECT_BUDGET' });
    expect(fetcher).toHaveBeenCalledTimes(1);

    fetcher.mockClear();
    fetcher
      .mockResolvedValueOnce(completion('{"answer": 7}'))
      .mockResolvedValue(completion('{"answer":"fixed"}'));
    const allowedRepair = sink(2);
    expect(
      await new ModelClient(provider(), allowedRepair, fetcher).json(
        answer,
        'Return JSON.',
        {},
        signal(),
      ),
    ).toEqual({ answer: 'fixed' });
    expect(allowedRepair.admit).toHaveBeenCalledTimes(2);
  });

  it('makes calls as it always did when the sink holds nothing back', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => completion('{"answer":"ok"}'));
    const plain = vi.fn();
    const client = new ModelClient(provider(), plain, fetcher);
    await client.json(answer, 'Return JSON.', {}, signal());
    await client.json(answer, 'Return JSON.', {}, signal());
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(plain).toHaveBeenCalledTimes(2);
  });
});

/** A factory whose models stop at once, so that what is left to look at is the sink each was made with. */
function recording() {
  const sinks: ModelUsageSink[] = [];
  const stop = new AppError(500, 'TEST_STOP', 'The test model stops here.');
  const gateway: ModelGateway = {
    json: () => Promise.reject(stop),
  };
  const factory: ModelFactory = (onUsage) => {
    sinks.push(onUsage);
    return gateway;
  };
  return { sinks, factory };
}

async function world() {
  const { sinks, factory } = recording();
  const config = testConfig(modelEnvironment);
  const instance = await buildApp({ config, modelFactory: factory });
  applications.push(instance);
  return { ...instance, config, sinks };
}

/** The sink must hold the budget of the project it was made for, and of no other. */
function expectHoldsOnlyItsProject(
  repository: Application['repository'],
  made: ModelUsageSink | undefined,
  own: string,
  other: string,
): void {
  expect(made?.admit, 'the model was made with a sink that can refuse').toBeTypeOf('function');
  expect(() => made!.admit!()).not.toThrow();
  repository.usage.setLimits(other, { callLimit: 1, tokenLimit: null });
  repository.usage.record(other, 1, 1);
  expect(() => made!.admit!(), 'another project’s budget is not this one’s').not.toThrow();
  repository.usage.setLimits(own, { callLimit: 1, tokenLimit: null });
  repository.usage.record(own, 1, 1);
  expect(() => made!.admit!()).toThrowError(expect.objectContaining({ code: 'PROJECT_BUDGET' }));
}

const begun = (repository: Application['repository'], id: string, config: ServerConfig) =>
  repository.update(id, {
    execution: {
      provider: config.provider.name === 'none' ? 'openai' : config.provider.name,
      model: config.provider.model,
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
    },
  });

/**
 * A finished guided experiment that the local engine wrote, turned into the model-assisted project a
 * model run would have left: it has a report, agents and a studio document to speak to.
 */
async function finished(instance: Awaited<ReturnType<typeof world>>) {
  const { repository, jobs, config } = instance;
  const project = repository.create(fixtureInput({ workflow: 'guided' }));
  for (const step of ['knowledge', 'environment', 'simulation', 'report'] as const) {
    jobs.enqueueStep(project.id, step);
    await jobs.idle();
  }
  repository.update(project.id, { mode: 'llm' });
  begun(repository, project.id, config);
  return project.id;
}

describe('every place that makes a model holds the budget of its own project', () => {
  it('a quick run', async () => {
    const instance = await world();
    const { repository, jobs, sinks } = instance;
    const own = repository.create(
      fixtureInput({ settings: { mode: 'llm', agentCount: 4, rounds: 3 } }),
    );
    const other = repository.create(fixtureInput());
    jobs.enqueue(own.id);
    await jobs.idle();
    expect(sinks).toHaveLength(1);
    expectHoldsOnlyItsProject(repository, sinks[0], own.id, other.id);
  });

  it('a stage of a guided run', async () => {
    const instance = await world();
    const { repository, jobs, sinks } = instance;
    const own = repository.create(
      fixtureInput({ workflow: 'guided', settings: { mode: 'llm', agentCount: 4, rounds: 3 } }),
    );
    const other = repository.create(fixtureInput());
    jobs.enqueueStep(own.id, 'knowledge');
    await jobs.idle();
    expect(sinks).toHaveLength(1);
    expectHoldsOnlyItsProject(repository, sinks[0], own.id, other.id);
  });

  it('an answer from the analyst or an actor', async () => {
    const instance = await world();
    const { repository, interaction, sinks } = instance;
    const own = await finished(instance);
    const other = repository.create(fixtureInput()).id;
    sinks.length = 0;
    await expect(
      interaction.reply(own, 'report', 'What does the City Transit Office propose?', signal()),
    ).rejects.toBeDefined();
    expect(sinks).toHaveLength(1);
    expectHoldsOnlyItsProject(repository, sinks[0], own, other);
  });

  it('a generated interview in a survey', async () => {
    const instance = await world();
    const { repository, interaction, sinks } = instance;
    const own = await finished(instance);
    const other = repository.create(fixtureInput()).id;
    sinks.length = 0;
    interaction.startSurvey(own, {
      kind: 'interview',
      question: 'Describe this fictional transit scenario.',
      agentIds: [repository.get(own).agents[0]!.id],
    });
    await interaction.idle();
    expect(sinks).toHaveLength(1);
    expectHoldsOnlyItsProject(repository, sinks[0], own, other);
  });

  it('a chapter written again in the report studio', async () => {
    const instance = await world();
    const { repository, config, sinks } = instance;
    const own = await finished(instance);
    const other = repository.create(fixtureInput()).id;
    const ledger = new LedgerService(repository);
    new StudioService(repository, ledger).start(own, { confirm: false }, 'author');
    const section = repository.studio
      .get(own)!
      .sections.find((candidate) => /^S\d/u.test(candidate.id))!;
    sinks.length = 0;
    const { factory } = recording();
    const captured: ModelUsageSink[] = [];
    const regenerator = new ModelSectionRegenerator(repository, config, (onUsage, options) => {
      captured.push(onUsage);
      return factory(onUsage, options);
    });
    await expect(
      regenerator.run({
        project: repository.get(own),
        section,
        instruction: null,
        signal: signal(),
        nextStatement: 1,
      }),
    ).rejects.toBeDefined();
    expect(captured).toHaveLength(1);
    expectHoldsOnlyItsProject(repository, captured[0], own, other);
  });

  it('and counts a regeneration’s calls both in the budget and in its own proposal', async () => {
    const instance = await world();
    const { repository } = instance;
    const own = await finished(instance);
    const seen: number[] = [];
    const sinkFor = repository.modelUse(own, (usage) => seen.push(usage.inputTokens));
    sinkFor({ inputTokens: 7, outputTokens: 3 });
    expect(seen).toEqual([7]);
    expect(repository.usage.get(own)).toMatchObject({ calls: 1, inputTokens: 7, outputTokens: 3 });
    expect(repository.get(own).execution).toMatchObject({ modelCalls: 1 });
  });
});

describe('a whole run that meets the budget', () => {
  const graphFixture = {
    nodes: [
      {
        id: 'n1',
        label: 'Transit',
        kind: 'topic',
        summary: 'Proposed transit pilot described in the source.',
        quote: 'The City Transit Office proposes a six-month electric bus pilot',
        weight: 1,
        sourceIds: ['S1'],
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
  };
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

  it('stops at the limit with no request beyond it, says why, keeps what was done, and carries on when the limit is lifted', async () => {
    const config = testConfig(modelEnvironment);
    // The first attempt reads the sources and writes the actors, and is stopped before the first
    // round. The second, with the limit lifted, writes the whole thing again.
    const { fetcher } = scriptedFetcher([graphFixture, personas, graphFixture, personas, report]);
    const instance = await buildApp({
      config,
      modelFactory: (onUsage, options) =>
        new ModelClient(config.provider, onUsage, fetcher, options?.maxCalls),
    });
    applications.push(instance);
    const { repository, jobs } = instance;
    const project = repository.create(
      fixtureInput({ settings: { mode: 'llm', agentCount: 4, rounds: 3 } }),
    );
    repository.usage.setLimits(project.id, { callLimit: 2, tokenLimit: null });

    jobs.enqueue(project.id);
    await jobs.idle();
    const stopped = repository.get(project.id);
    expect(stopped.status).toBe('failed');
    expect(stopped.error).toContain('used its model budget (2 of 2 model calls)');
    expect(stopped.error).toContain('workspace owner or administrator');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(repository.usage.get(project.id)).toMatchObject({
      calls: 2,
      inputTokens: 20,
      outputTokens: 10,
    });
    expect(stopped.graph?.nodes.length).toBeGreaterThan(0);
    const refusals = repository.audit
      .list({ projectId: project.id, limit: 500 })
      .filter((entry) => entry.action === 'model.budget.exhausted');
    expect(refusals).toHaveLength(1);
    expect(refusals[0]?.detail).toMatchObject({ calls: 2, callLimit: 2 });

    // A person with the standing to do it lifts the limit, and the run is tried again.
    repository.usage.setLimits(project.id, { callLimit: 0, tokenLimit: null });
    jobs.enqueue(project.id);
    await jobs.idle();
    const done = repository.get(project.id);
    expect(done.error).toBeNull();
    expect(done.status).toBe('completed');
    // What the project has used is the whole of it, both attempts: the budget does not start again.
    expect(repository.usage.get(project.id).calls).toBe(2 + 2 + 1 + 4 * 3);
  });
});
