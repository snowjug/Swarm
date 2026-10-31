import { afterEach, describe, expect, it } from 'vitest';
import { environmentUpdateSchema, personaEditSchema } from '../../shared/guided.js';
import { actorFixture, FIXTURE_TIME, stakeholderSetFixture } from '../../shared/lab-fixtures.js';
import { actorSetSchema, type Actor, type ActorSet } from '../../shared/stakeholders.js';
import type { KnowledgeGraph } from '../../shared/types.js';
import { buildApp } from '../src/app.js';
import { ModelClient } from '../src/models/client.js';
import { generateActors } from '../src/stakeholders/actors.js';
import { agentsFromActors, MAX_AGENTS, MIN_AGENTS } from '../src/stakeholders/agents.js';
import { agentSchema } from '../src/storage/codec.js';
import { fixtureInput, testConfig } from './fixtures.js';
import { scriptedFetcher } from './support/model-brain.js';

type Application = Awaited<ReturnType<typeof buildApp>>;
const applications: Application[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

const graph: KnowledgeGraph = {
  method: 'lexical',
  nodes: [
    {
      id: 'topic-1',
      label: 'Fees',
      kind: 'topic',
      summary: 'Fees and notice periods.',
      weight: 1,
      sourceIds: ['S1'],
    },
    {
      id: 'topic-2',
      label: 'Providers',
      kind: 'topic',
      summary: 'Rival providers and terms.',
      weight: 0.6,
      sourceIds: ['S1'],
    },
    {
      id: 'topic-3',
      label: 'Notice',
      kind: 'topic',
      summary: 'Regulator notice rules.',
      weight: 0.3,
      sourceIds: ['S1'],
    },
  ],
  edges: [],
  notes: [],
};

const setOf = (actors: Actor[]): ActorSet =>
  actorSetSchema.parse({
    actors,
    relations: [],
    generatedAt: FIXTURE_TIME,
    mode: 'rules',
    stakeholderRevision: 1,
  });

const keyActor = (id: string, category: Actor['category'], overrides: Partial<Actor> = {}): Actor =>
  actorFixture(id, category, { kind: 'key', size: 1, sampleSize: 1, ...overrides });

const withReach = (actor: Actor, influence: number, authority: number): Actor => {
  actor.traits.influence.value = influence;
  actor.traits.authority.value = authority;
  return actor;
};

/** The actors the real pipeline makes from the sample stakeholders: priors, roles and goals included. */
const madeActors = (): Promise<ActorSet> => {
  const stakeholders = stakeholderSetFixture();
  return generateActors({
    stakeholders: stakeholders.stakeholders,
    relations: stakeholders.relations,
    scenario: null,
    stakeholderRevision: 2,
    now: () => new Date(FIXTURE_TIME),
  });
};

describe('agents made from actors', () => {
  it('makes one agent of each key actor, most influential first, and says what each is', () => {
    const set = setOf([
      withReach(keyActor('regulator', 'regulator'), 0.7, 0.9),
      withReach(keyActor('provider', 'decision-maker'), 0.8, 0.9),
      withReach(keyActor('analyst', 'influencer'), 0.7, 0.2),
      withReach(keyActor('rival', 'competitor'), 0.5, 0.6),
      actorFixture('subscribers', 'end-user', { size: 900, sampleSize: 20 }),
    ]);
    const made = agentsFromActors(set, graph, { mode: 'local' });
    expect(made.keyActors).toBe(4);
    expect(made.representatives).toBe(0);
    expect(made.omitted).toEqual([]);
    expect(made.agents.map((agent) => agent.id)).toEqual([
      'agent-1',
      'agent-2',
      'agent-3',
      'agent-4',
    ]);
    // Influence plus authority: a decision maker and a regulator lead, a competitor and an influencer follow.
    expect(made.agents.map((agent) => agent.name)).toEqual([
      'Provider',
      'Regulator',
      'Rival',
      'Analyst',
    ]);
  });

  it('copies what an actor has onto its agent: role, goals, constraints, stance, influence, openness, sources', () => {
    const provider = keyActor('provider', 'decision-maker', {
      role: 'Decision maker: decides the change',
      objectives: ['One', 'Two', 'Three', 'Four'],
      constraints: ['Budget', 'Time'],
      evidence: [
        {
          passageId: 'S2',
          documentId: 'D1',
          documentName: 'a.md',
          start: 0,
          end: 5,
          quote: 'quote one',
          contentHash: 'h',
          role: 'supports',
        },
        {
          passageId: 'S2',
          documentId: 'D1',
          documentName: 'a.md',
          start: 0,
          end: 5,
          quote: 'quote two',
          contentHash: 'h',
          role: 'supports',
        },
        {
          passageId: 'S5',
          documentId: 'D1',
          documentName: 'a.md',
          start: 0,
          end: 5,
          quote: 'quote three',
          contentHash: 'h',
          role: 'supports',
        },
      ],
    });
    provider.traits.priorStance.value = -0.4;
    provider.traits.influence.value = 0.8;
    provider.traits.authority.value = 0.9;
    provider.traits.openness.value = 0.3;
    const set = setOf([
      provider,
      keyActor('b', 'regulator'),
      keyActor('c', 'regulator'),
      keyActor('d', 'regulator'),
    ]);
    const agent = agentsFromActors(set, graph, { mode: 'local' }).agents.find(
      (candidate) => candidate.name === 'Provider',
    )!;
    expect(agent).toMatchObject({
      role: 'Decision maker: decides the change',
      goals: ['One', 'Two', 'Three'],
      constraints: ['Budget', 'Time'],
      initialOpinion: -0.4,
      opinion: -0.4,
      openness: 0.3,
      memory: [],
      sourceIds: ['S2', 'S5'],
    });
    // 0.2 + 1.6 * (0.7 * 0.8 + 0.3 * 0.9) = 1.528
    expect(agent.influence).toBeCloseTo(1.528, 3);
    expect(agent.persona).toContain('Fictional proxy for Provider (decision maker)');
    expect(agent.persona).toContain('Starts against toward the change (inclination -0.40)');
    expect(agent.persona).toContain('Wants: One; Two; Three; Four.');
    expect(agent.persona).toContain('not the beliefs of any real person or group');
  });

  it('adds a clearly named representative of each of the largest cohorts to reach four agents', () => {
    const set = setOf([
      keyActor('provider', 'decision-maker'),
      actorFixture('small-group', 'end-user', { size: 50, sampleSize: 20 }),
      actorFixture('large-group', 'cost-bearer', { size: 5_000, sampleSize: 20 }),
      actorFixture('middle-group', 'beneficiary', { size: 400, sampleSize: 20 }),
      actorFixture('last-group', 'operations', { size: 10, sampleSize: 10 }),
    ]);
    const made = agentsFromActors(set, graph, { mode: 'local' });
    expect(made.keyActors).toBe(1);
    expect(made.representatives).toBe(3);
    expect(made.agents.map((agent) => agent.name)).toEqual([
      'Provider',
      'Large group (cohort representative)',
      'Middle group (cohort representative)',
      'Small group (cohort representative)',
    ]);
    expect(made.agents).toHaveLength(MIN_AGENTS);
  });

  it('adds more members of the cohorts, spread around their values, when representatives are not enough', () => {
    const a = actorFixture('group-a', 'end-user', { size: 900, sampleSize: 20 });
    const b = actorFixture('group-b', 'cost-bearer', { size: 100, sampleSize: 20 });
    a.traits.priorStance.value = 0.2;
    a.traits.priorStance.spread = 0.1;
    b.traits.priorStance.value = -0.5;
    const made = agentsFromActors(setOf([a, b]), graph, { mode: 'local' });
    expect(made.agents.map((agent) => agent.name)).toEqual([
      'Group a (cohort representative)',
      'Group b (cohort representative)',
      'Group a (cohort member 2)',
      'Group b (cohort member 2)',
    ]);
    // Member 2 sits one spread above its cohort's value: a cohort is a spread of views, not one.
    expect(made.agents.map((agent) => agent.initialOpinion)).toEqual([0.2, -0.5, 0.3, -0.4]);
    expect(new Set(made.agents.map((agent) => agent.id)).size).toBe(4);
  });

  it('says plainly when the actors cannot make four agents, and what to do', () => {
    const set = setOf([keyActor('provider', 'decision-maker'), keyActor('regulator', 'regulator')]);
    expect(() => agentsFromActors(set, graph, { mode: 'local' })).toThrowError(
      /needs at least 4 agents and these actors give only 2/u,
    );
    try {
      agentsFromActors(set, graph, { mode: 'local' });
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 409, code: 'ACTORS_TOO_FEW' });
    }
    const one = setOf([
      keyActor('provider', 'decision-maker'),
      actorFixture('lone', 'end-user', { size: 1, sampleSize: 1 }),
    ]);
    expect(() => agentsFromActors(one, graph, { mode: 'local' })).toThrowError(/give only 2/u);
  });

  it('keeps to the number of agents a run can have, and says which key actors did not fit', () => {
    const keys = Array.from({ length: 12 }, (_, index) =>
      keyActor(`key-${String(index).padStart(2, '0')}`, 'regulator'),
    );
    const local = agentsFromActors(setOf(keys), graph, { mode: 'local' });
    expect(local.agents).toHaveLength(12);
    const model = agentsFromActors(setOf(keys), graph, { mode: 'llm' });
    expect(model.agents).toHaveLength(MAX_AGENTS.llm);
    expect(model.omitted).toHaveLength(2);
    const many = Array.from({ length: 30 }, (_, index) =>
      keyActor(`many-${String(index).padStart(2, '0')}`, 'regulator'),
    );
    expect(agentsFromActors(setOf(many), graph, { mode: 'local' }).agents).toHaveLength(
      MAX_AGENTS.local,
    );
  });

  it('makes agents the engine and the editor accept, whatever the actors are called', () => {
    const set = setOf([
      keyActor('it', 'operations', { name: 'IT', role: 'Op' }),
      keyActor('long', 'regulator', { name: 'N'.repeat(120), role: 'R'.repeat(200) }),
      keyActor('plain', 'competitor'),
      actorFixture('crowd', 'end-user', { name: 'A'.repeat(118), size: 100, sampleSize: 20 }),
    ]);
    const { agents } = agentsFromActors(set, graph, { mode: 'local' });
    for (const agent of agents) {
      agentSchema.parse(agent);
      personaEditSchema.parse({
        id: agent.id,
        name: agent.name,
        role: agent.role,
        persona: agent.persona,
        initialOpinion: agent.initialOpinion,
        influence: agent.influence,
        openness: agent.openness,
      });
      expect(agent.influence).toBeGreaterThanOrEqual(0.1);
      expect(agent.influence).toBeLessThanOrEqual(2);
      expect(agent.persona.length).toBeLessThanOrEqual(700);
      expect(agent.topicIds.length).toBeGreaterThan(0);
      for (const id of agent.topicIds) expect(graph.nodes.map((node) => node.id)).toContain(id);
    }
    expect(agents.find((agent) => agent.name.startsWith('IT'))?.name).toBe('IT (actor)');
  });

  it('is the same every time, and ties topics to what the actor is about', () => {
    const set = setOf([
      keyActor('provider', 'decision-maker', {
        name: 'Rival providers',
        role: 'Rival providers set terms',
      }),
      keyActor('b', 'regulator'),
      keyActor('c', 'regulator'),
      keyActor('d', 'regulator'),
    ]);
    const first = agentsFromActors(set, graph, { mode: 'local' });
    expect(agentsFromActors(set, graph, { mode: 'local' })).toEqual(first);
    expect(first.agents.find((agent) => agent.name === 'Rival providers')?.topicIds[0]).toBe(
      'topic-2',
    );
  });
});

// ---------------------------------------------------------------------------------------------
// In the Environment stage of a project
// ---------------------------------------------------------------------------------------------

async function world(settings: Record<string, unknown> = {}, environment?: Record<string, string>) {
  const instance = await buildApp({ config: testConfig(environment ?? {}) });
  applications.push(instance);
  const project = instance.repository.create(
    fixtureInput({
      workflow: 'guided',
      settings: {
        mode: 'local',
        agentCount: 6,
        rounds: 4,
        seed: 42,
        network: 'community',
        ...settings,
      },
    }),
  );
  return { ...instance, project };
}

async function step(
  instance: Awaited<ReturnType<typeof world>>,
  name: 'knowledge' | 'environment' | 'simulation',
) {
  instance.jobs.enqueueStep(instance.project.id, name);
  await instance.jobs.idle();
  return instance.repository.get(instance.project.id);
}

describe('the Environment stage of a project with actors', () => {
  it('prepares the agents from the actors, keeps the agent count consistent, and runs the engine on them', async () => {
    const instance = await world();
    await step(instance, 'knowledge');
    instance.repository.artifacts.put(instance.project.id, 'actors', 'default', await madeActors());
    const prepared = await step(instance, 'environment');
    expect(prepared.error).toBeNull();
    expect(prepared.console?.steps.environment).toBe('ready');
    // Influence plus authority: the provider, then the regulator, then the rival; then one subscriber.
    expect(prepared.agents.map((agent) => agent.name)).toEqual([
      'Provider',
      'Regulator',
      'Rival provider',
      'Subscribers (cohort representative)',
    ]);
    expect(prepared.agents).toHaveLength(4);
    expect(prepared.agentCount).toBe(4);
    expect(prepared.settings.agentCount).toBe(4);
    expect(prepared.agents.every((agent) => agent.persona.includes('Fictional proxy'))).toBe(true);
    const trace = prepared.console?.traces.find((item) =>
      item.name.startsWith('Fictional persona preparation'),
    );
    expect(trace).toMatchObject({
      name: 'Fictional persona preparation from approved actors',
      kind: 'review',
      status: 'completed',
    });
    expect(prepared.events.map((event) => event.message).join(' ')).toContain(
      'Agents made from approved actors: 3 key actors and 1 cohort representatives',
    );

    const edit = environmentUpdateSchema.parse({
      rounds: 3,
      minutesPerRound: 30,
      platforms: ['plaza', 'community'],
      initialPosts: [],
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
    const saved = await instance.app.inject({
      method: 'PATCH',
      url: `/api/projects/${instance.project.id}/environment`,
      payload: edit,
    });
    expect(saved.statusCode, saved.body).toBe(200);

    const simulated = await step(instance, 'simulation');
    expect(simulated.console?.steps.simulation).toBe('ready');
    expect(simulated.rounds).toHaveLength(3);
    expect(simulated.rounds[0]?.opinions).toHaveLength(4);
  });

  it('leaves a project with no actors exactly as it was', async () => {
    const instance = await world();
    await step(instance, 'knowledge');
    const prepared = await step(instance, 'environment');
    expect(prepared.agents).toHaveLength(6);
    expect(prepared.agentCount).toBe(6);
    expect(prepared.agents.every((agent) => agent.role.startsWith('Synthetic'))).toBe(true);
    const trace = prepared.console?.traces.find((item) =>
      item.name.startsWith('Fictional persona preparation'),
    );
    expect(trace?.name).toBe('Fictional persona preparation');
    expect(prepared.events.map((event) => event.message).join(' ')).not.toContain(
      'approved actors',
    );
  });

  it('fails the stage with the reason, and nothing half-made, when the actors cannot make four agents', async () => {
    const instance = await world();
    await step(instance, 'knowledge');
    instance.repository.artifacts.put(
      instance.project.id,
      'actors',
      'default',
      setOf([keyActor('provider', 'decision-maker'), keyActor('regulator', 'regulator')]),
    );
    const failed = await step(instance, 'environment');
    expect(failed.console?.steps.environment).toBe('failed');
    expect(failed.agents).toEqual([]);
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('needs at least 4 agents');
  });

  it('runs a model-assisted simulation on the actors, without asking a model to invent the population', async () => {
    const config = testConfig({
      AI_PROVIDER: 'openai',
      AI_MODEL: 'fixture-model',
      OPENAI_API_KEY: 'test-placeholder-only',
    });
    const ontology = {
      entityTypes: [
        { name: 'Organization', description: 'An organization described by the text.' },
      ],
      relationshipTypes: [{ name: 'informs', description: 'A source-grounded relationship.' }],
    };
    const sourceGraph = {
      nodes: [
        {
          id: 'n1',
          label: 'Transit Office',
          kind: 'organization',
          entityType: 'Organization',
          summary: 'A fictional office.',
          quote: 'The City Transit Office proposes a six-month electric bus pilot',
          weight: 1,
          sourceIds: ['S1'],
        },
        {
          id: 'n2',
          label: 'Community',
          kind: 'group',
          entityType: 'Organization',
          summary: 'A fictional community.',
          quote: 'Neighborhood groups ask for accessible stops and clear information',
          weight: 0.5,
          sourceIds: ['S1'],
        },
      ],
      edges: [{ source: 'n1', target: 'n2', label: 'informs', weight: 0.7, sourceIds: ['S1'] }],
    };
    const prepared = {
      minutesPerRound: 60,
      initialPosts: [
        {
          text: 'An assumed starting point, not measured opinion.',
          platform: 'both',
          stance: 0,
          strength: 0,
          sourceIds: ['S1'],
        },
      ],
    };
    // Only three setup answers: the ontology, the graph and the environment. No persona call is made.
    const { fetcher, seen, contexts } = scriptedFetcher([ontology, sourceGraph, prepared]);
    const instance = await buildApp({
      config,
      modelFactory: (onUsage, options) =>
        new ModelClient(config.provider, onUsage, fetcher, options?.maxCalls),
    });
    applications.push(instance);
    const project = instance.repository.create(
      fixtureInput({ workflow: 'guided', settings: { mode: 'llm', agentCount: 4, rounds: 3 } }),
    );
    const handle = { ...instance, project };
    await step(handle, 'knowledge');
    instance.repository.artifacts.put(project.id, 'actors', 'default', await madeActors());
    const environment = await step(handle, 'environment');
    expect(environment.error).toBeNull();
    expect(seen.scripted).toBe(3);
    expect(environment.agents).toHaveLength(4);
    const simulated = await step(handle, 'simulation');
    expect(simulated.error).toBeNull();
    expect(seen.actor).toBe(4 * 2 * 3);
    const speakers = new Map(contexts.map((context) => [context.self.id, context.self]));
    expect(speakers.size).toBe(4);
    const regulator = [...speakers.values()].find((self) => self.name === 'Regulator')!;
    expect(regulator.role).toBe('Regulator: Affected by, or able to act on, the proposed change');
    expect(regulator.persona).toContain('Fictional proxy for Regulator');
    expect(regulator.goals).toEqual([
      'Uphold the rules and protect those they oversee.',
      'Affected by, or able to act on, the proposed change.',
    ]);
    expect(regulator.openness).toBe(0.2);
    expect(simulated.execution?.modelCalls).toBe(3 + 4 * 2 * 3);
  });
});
