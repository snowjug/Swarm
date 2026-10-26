import { afterEach, describe, expect, it } from 'vitest';
import { environmentUpdateSchema, surveyInputSchema } from '../../shared/guided.js';
import { buildApp } from '../src/app.js';
import { fixtureInput, testConfig } from './fixtures.js';

const applications: Awaited<ReturnType<typeof buildApp>>[] = [];
async function setup() {
  const instance = await buildApp({ config: testConfig() });
  applications.push(instance);
  return instance;
}
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

describe('persisted guided console workflow', () => {
  it('runs genuinely separate gated stages, editable preparation, independent worlds and a source-linked report', async () => {
    const { app, repository, jobs, interaction } = await setup();
    const created = repository.create(fixtureInput({ workflow: 'guided' }));
    expect(created.console?.steps.knowledge).toBe('pending');
    expect(() => jobs.enqueueStep(created.id, 'simulation')).toThrow('Complete environment');
    expect(() => jobs.enqueue(created.id)).toThrow('guided stage controls');
    jobs.enqueueStep(created.id, 'knowledge');
    await jobs.idle();
    const knowledge = repository.get(created.id);
    expect(knowledge.status).toBe('ready');
    expect(knowledge.console?.steps).toMatchObject({
      knowledge: 'ready',
      environment: 'pending',
      simulation: 'pending',
    });
    expect(knowledge.console?.ontology?.entityTypes[0]?.name).toBe('Topic');
    expect(knowledge.graph?.method).toBe('lexical');
    expect(knowledge.agents).toEqual([]);
    expect(knowledge.rounds).toEqual([]);
    expect(knowledge.report).toBeNull();
    jobs.enqueueStep(created.id, 'environment');
    await jobs.idle();
    const prepared = repository.get(created.id);
    expect(prepared.agents).toHaveLength(6);
    expect(prepared.console?.environment?.platforms).toEqual(['plaza', 'community']);
    const edit = environmentUpdateSchema.parse({
      rounds: 3,
      minutesPerRound: 30,
      platforms: ['plaza', 'community'],
      initialPosts: [
        {
          id: 'P1',
          text: 'Assume a transit funding announcement only in the broadcast plaza.',
          platform: 'plaza',
          stance: 1,
          strength: 1,
          sourceIds: ['S1'],
        },
      ],
      agents: prepared.agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        role: agent.role,
        persona: agent.persona,
        initialOpinion: agent.initialOpinion,
        influence: agent.influence,
        openness: agent.openness,
      })),
    });
    const saved = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${created.id}/environment`,
      payload: edit,
    });
    expect(saved.statusCode, saved.body).toBe(200);
    jobs.enqueueStep(created.id, 'simulation');
    await jobs.idle();
    const simulated = repository.get(created.id);
    expect(simulated.status).toBe('ready');
    expect(simulated.console?.steps).toMatchObject({ simulation: 'ready', report: 'pending' });
    expect(simulated.report).toBeNull();
    expect(simulated.rounds).toHaveLength(3);
    const worlds = simulated.console!.platforms;
    expect(worlds).toHaveLength(2);
    expect(
      worlds.every((world) => world.status === 'completed' && world.elapsedMinutes === 90),
    ).toBe(true);
    expect(worlds[0]!.rounds.at(-1)!.meanOpinion).not.toBe(worlds[1]!.rounds.at(-1)!.meanOpinion);
    expect(simulated.console!.memories).toHaveLength(6 * 3 * 2 + 1);
    expect(new Set(simulated.console!.memories.map((memory) => memory.id)).size).toBe(
      simulated.console!.memories.length,
    );
    for (const agent of simulated.agents) {
      const values = worlds.map(
        (world) => world.agents.find((proxy) => proxy.id === agent.id)!.opinion,
      );
      expect(agent.opinion).toBeCloseTo((values[0]! + values[1]!) / 2, 12);
    }
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/projects/${created.id}/environment`,
          payload: edit,
        })
      ).statusCode,
    ).toBe(409);
    jobs.enqueueStep(created.id, 'report');
    await jobs.idle();
    const result = repository.get(created.id);
    expect(result.status).toBe('completed');
    expect(result.console?.steps).toMatchObject({ report: 'ready', interaction: 'ready' });
    expect(
      result.report?.sections.some(
        (section) => section.title === 'Platform comparison and time horizon',
      ),
    ).toBe(true);
    expect(result.console?.reportPlan?.completedSections).toBe(result.report?.sections.length);
    expect(result.execution?.modelCalls).toBe(0);
    expect(result.console?.traces.every((trace) => trace.status === 'completed')).toBe(true);
    const memory = result.console!.memories.find((item) => item.kind === 'action')!;
    const found = await app.inject(
      `/api/projects/${created.id}/memories?query=${encodeURIComponent(memory.id)}`,
    );
    expect(found.json()).toMatchObject({ memories: [{ id: memory.id }] });
    const survey = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.id}/surveys`,
      payload: {
        kind: 'state',
        question: 'Inspect recorded positions, not generated opinions.',
        agentIds: ['agent-1', 'agent-2'],
      },
    });
    expect(survey.statusCode).toBe(202);
    await interaction.idle();
    const record = repository.get(created.id).console!.surveys[0]!;
    expect(record.status).toBe('completed');
    expect(record.responses).toHaveLength(2);
    expect(record.responses.every((response) => response.answer === null)).toBe(true);
    expect(record.responses[0]!.opinion).toBe(result.agents[0]!.opinion);
    const generated = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.id}/surveys`,
      payload: {
        kind: 'interview',
        question: 'What do you think about the scenario?',
        agentIds: ['agent-1'],
      },
    });
    expect(generated.statusCode).toBe(409);
    expect(generated.json()).toMatchObject({ error: { code: 'MODEL_REQUIRED' } });
    expect(
      (await app.inject(`/api/projects/${created.id}/export?format=json`)).json(),
    ).toMatchObject({ schemaVersion: 2 });
  });

  it('keeps legacy projects readable and prevents misleading guided actions on them', async () => {
    const { app, repository, jobs } = await setup();
    const legacy = repository.create(fixtureInput());
    expect(legacy.workflow).toBe('quick');
    expect(legacy.console).toBeNull();
    const step = await app.inject({
      method: 'POST',
      url: `/api/projects/${legacy.id}/steps/knowledge`,
    });
    expect(step.statusCode).toBe(409);
    jobs.enqueue(legacy.id);
    await jobs.idle();
    expect(repository.get(legacy.id).status).toBe('completed');
    expect(
      (await app.inject(`/api/projects/${legacy.id}/export?format=json`)).json(),
    ).toMatchObject({ schemaVersion: 1 });
  });

  it('cancels a queued stage without losing its completed upstream graph, then retries that stage only', async () => {
    const { repository, jobs } = await setup();
    const project = repository.create(fixtureInput({ workflow: 'guided' }));
    jobs.enqueueStep(project.id, 'knowledge');
    await jobs.idle();
    const graph = repository.get(project.id).graph;
    jobs.enqueueStep(project.id, 'environment');
    jobs.cancel(project.id);
    await jobs.idle();
    expect(repository.get(project.id)).toMatchObject({
      status: 'cancelled',
      graph,
      console: { steps: { knowledge: 'ready', environment: 'cancelled', simulation: 'pending' } },
    });
    jobs.enqueueStep(project.id, 'environment');
    await jobs.idle();
    const retried = repository.get(project.id);
    expect(retried.status).toBe('ready');
    expect(retried.graph).toEqual(graph);
    expect(retried.agents).toHaveLength(6);
    expect(retried.rounds).toEqual([]);
    expect(retried.report).toBeNull();
  });

  it('recovers interrupted stage and survey state without claiming completion', async () => {
    const { repository } = await setup();
    const project = repository.create(fixtureInput({ workflow: 'guided' }));
    const state = project.console!;
    repository.update(project.id, {
      status: 'running',
      console: { ...state, steps: { ...state.steps, knowledge: 'running' } },
    });
    repository.recoverInterrupted();
    expect(repository.get(project.id)).toMatchObject({
      status: 'failed',
      console: { steps: { knowledge: 'failed', environment: 'pending' } },
    });
  });

  it('enforces actual survey target uniqueness, selection limits and environment bounds', () => {
    const invalid = environmentUpdateSchema.safeParse({ rounds: 3, minutesPerRound: 0 });
    expect(invalid.success).toBe(false);
    const request = {
      kind: 'state',
      question: 'Inspect the recorded state',
      agentIds: ['agent-1', 'agent-2'],
    };
    expect(surveyInputSchema.safeParse(request).success).toBe(true);
    expect(
      surveyInputSchema.safeParse({ ...request, agentIds: ['agent-1', 'agent-1'] }).success,
    ).toBe(false);
    expect(
      surveyInputSchema.safeParse({
        ...request,
        agentIds: Array.from({ length: 6 }, (_, index) => `agent-${index + 1}`),
      }).success,
    ).toBe(false);
  });
});
