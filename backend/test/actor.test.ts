import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import {
  ACTOR_CONCURRENCY,
  MAX_OPINION_SHIFT,
  actorCallBudget,
  actorRound,
  buildActorContext,
  createKnowledgeIndex,
  validateDecision,
  type ActorContext,
  type ActorRoundInput,
} from '../src/agents/actor.js';
import { AppError, throwIfAborted } from '../src/errors.js';
import { createLimiter } from '../src/limiter.js';
import { ModelClient, type JsonOptions, type ModelGateway } from '../src/models/client.js';
import type { ActorDecision } from '../src/models/schemas.js';
import type { Agent, AgentAction, EvidenceChunk } from '../../shared/types.js';
import { testConfig } from './fixtures.js';
import { actorBrain, chatCompletion } from './support/model-brain.js';

function agent(index: number, overrides: Partial<Agent> = {}): Agent {
  return {
    id: `agent-${index}`,
    name: `Proxy ${index}`,
    role: 'Synthetic stakeholder',
    persona: `Fictional persona ${index}, assumed interests only.`,
    topicIds: ['n1'],
    initialOpinion: 0,
    opinion: 0,
    influence: 1,
    openness: 0.5,
    memory: [],
    sourceIds: ['S1'],
    ...overrides,
  };
}

function chunk(id: string, text: string): EvidenceChunk {
  return { id, documentId: 'D1', documentName: 'notes.md', text, start: 0, end: text.length };
}

function action(agentId: string, round: number, overrides: Partial<AgentAction> = {}): AgentAction {
  return {
    id: `round-${round}-${agentId}`,
    round,
    agentId,
    type: 'post',
    content: `Public statement by ${agentId}.`,
    opinion: 0,
    peerIds: [],
    sourceIds: [],
    rationale: `Hidden rationale of ${agentId}`,
    confidence: 0.5,
    ...overrides,
  };
}

const QUESTION = 'Should the library change its opening hours?';
const CHUNKS = [
  chunk('S1', 'The library proposes longer opening hours on weekday evenings.'),
  chunk('S2', 'The council funds staffing but not extra utilities.'),
];

const unusedModel: ModelGateway = {
  json: async () => {
    throw new Error('The model must not be called in this test.');
  },
};

function roundInput(overrides: Partial<ActorRoundInput> = {}): ActorRoundInput {
  return {
    model: unusedModel,
    question: QUESTION,
    agents: [agent(1), agent(2), agent(3), agent(4)],
    previousActions: [],
    knowledge: createKnowledgeIndex(CHUNKS, QUESTION),
    round: 1,
    totalRounds: 3,
    platform: { id: 'plaza', label: 'Info Plaza', network: 'broadcast' },
    simulatedMinute: 60,
    seedPosts: [],
    intervention: null,
    limit: createLimiter(ACTOR_CONCURRENCY),
    signal: new AbortController().signal,
    ...overrides,
  };
}

/** Behaves like a real model client for typing and validation, answering from the actor's own context. */
function gateway(
  reply: (context: ActorContext) => unknown = (context) => actorBrain(context),
  observe?: (context: ActorContext) => void,
): ModelGateway {
  return {
    async json<T>(
      schema: z.ZodType<T>,
      _instructions: string,
      data: unknown,
      _signal: AbortSignal,
      _maxTokens?: number,
      options?: JsonOptions<T>,
    ): Promise<T> {
      const context = data as ActorContext;
      observe?.(context);
      const parsed = schema.parse(reply(context));
      options?.validate?.(parsed);
      return parsed;
    },
  };
}

describe('createKnowledgeIndex', () => {
  it('gives each proxy its own cited passages first, then relevant ones, within a small budget', () => {
    const long = 'x'.repeat(1_000);
    const chunks = ['S1', 'S2', 'S3', 'S4', 'S5'].map((id) => chunk(id, `${id} library ${long}`));
    const items = createKnowledgeIndex(chunks, QUESTION)(agent(1, { sourceIds: ['S4', 'S2'] }));
    expect(items.map((item) => item.id).slice(0, 2)).toEqual(['S4', 'S2']);
    expect(items.length).toBeLessThanOrEqual(3);
    for (const item of items) expect(item.text.length).toBeLessThanOrEqual(700);
    expect(items.reduce((sum, item) => sum + item.text.length, 0)).toBeLessThanOrEqual(2_400);
  });

  it('ignores citations that are not real passages and never repeats a passage', () => {
    const items = createKnowledgeIndex(
      CHUNKS,
      QUESTION,
    )(agent(1, { sourceIds: ['S1', 'S1', 'S404'] }));
    const ids = items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('S404');
    expect(ids[0]).toBe('S1');
  });

  it('is stable for repeated lookups of the same proxy', () => {
    const lookup = createKnowledgeIndex(CHUNKS, QUESTION);
    const proxy = agent(1);
    expect(lookup(proxy)).toBe(lookup(proxy));
  });
});

describe('buildActorContext: what one proxy may see', () => {
  const private1 = 'PRIVATE-MEMORY-OF-1';
  const private2 = 'PRIVATE-MEMORY-OF-2';
  const agents = [
    agent(1, {
      memory: [private1],
      persona: 'PERSONA-ONE fictional proxy persona.',
      goals: ['GOAL-ONE'],
    }),
    agent(2, {
      memory: [private2],
      persona: 'PERSONA-TWO fictional proxy persona.',
      goals: ['GOAL-TWO'],
    }),
    agent(3, { memory: ['PRIVATE-MEMORY-OF-3'], persona: 'PERSONA-THREE fictional persona.' }),
  ];

  it('includes the proxy’s own persona, goals and memory but never another proxy’s private state', () => {
    const input = roundInput({
      agents,
      round: 2,
      previousActions: [action('agent-2', 1), action('agent-3', 1)],
    });
    const json = JSON.stringify(buildActorContext(agents[0]!, input));
    expect(json).toContain(private1);
    expect(json).toContain('PERSONA-ONE');
    expect(json).toContain('GOAL-ONE');
    for (const hidden of [
      private2,
      'PRIVATE-MEMORY-OF-3',
      'PERSONA-TWO',
      'PERSONA-THREE',
      'GOAL-TWO',
    ]) {
      expect(json).not.toContain(hidden);
    }
  });

  it('shows peers’ public statements only, never their rationale or confidence', () => {
    const input = roundInput({
      agents,
      round: 2,
      previousActions: [action('agent-2', 1), action('agent-3', 1)],
    });
    const context = buildActorContext(agents[0]!, input);
    expect(context.observations.map((item) => item.peerId).sort()).toEqual(['agent-2', 'agent-3']);
    const json = JSON.stringify(context);
    expect(json).not.toContain('Hidden rationale');
    expect(json).not.toContain('confidence');
    expect(json).toContain('Public statement by agent-2.');
  });

  it('treats silence as invisible: an "observe" decision is not something others can see', () => {
    const input = roundInput({
      agents,
      round: 2,
      previousActions: [action('agent-2', 1, { type: 'observe' }), action('agent-3', 1)],
    });
    const context = buildActorContext(agents[0]!, input);
    expect(context.observations.map((item) => item.peerId)).toEqual(['agent-3']);
  });

  it('shows only the platform seed posts in round one, and they cannot be replied to', () => {
    const input = roundInput({
      agents,
      round: 1,
      seedPosts: [
        {
          id: 'P1',
          text: 'Seed post about evening hours.',
          platform: 'both',
          stance: 0,
          strength: 0.2,
          sourceIds: ['S1'],
        },
      ],
      previousActions: [action('agent-2', 0)],
    });
    const context = buildActorContext(agents[0]!, input);
    expect(context.observations).toEqual([
      expect.objectContaining({ peerId: null, kind: 'seed', author: 'Platform seed post' }),
    ]);
  });

  it('applies the platform network rules to who is heard', () => {
    const crowd = Array.from({ length: 8 }, (_, index) =>
      agent(index + 1, { influence: 0.5 + index * 0.1 }),
    );
    const previousActions = crowd.map((member) => action(member.id, 1));
    const plaza = buildActorContext(
      crowd[0]!,
      roundInput({ agents: crowd, round: 2, previousActions }),
    );
    expect(plaza.observations).toHaveLength(4);
    expect(plaza.observations.map((item) => item.peerId)).toEqual([
      'agent-8',
      'agent-7',
      'agent-6',
      'agent-5',
    ]);
    const community = buildActorContext(
      crowd[0]!,
      roundInput({
        agents: crowd,
        round: 2,
        previousActions,
        platform: { id: 'community', label: 'Topic Community', network: 'community' },
      }),
    );
    expect(community.observations).toHaveLength(5);
  });

  it('bounds untrusted text: long statements are excerpted and memory is the last four entries', () => {
    const noisy = agent(1, { memory: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'] });
    const input = roundInput({
      agents: [noisy, agent(2)],
      round: 2,
      previousActions: [action('agent-2', 1, { content: 'y'.repeat(5_000) })],
    });
    const context = buildActorContext(noisy, input);
    expect(context.memory).toEqual(['m3', 'm4', 'm5', 'm6']);
    expect(context.observations[0]!.content.length).toBeLessThanOrEqual(500);
  });

  it('describes the scheduled event only when one applies', () => {
    const intervention = {
      round: 2,
      label: 'Assumed council announcement',
      stance: 0.8,
      strength: 0.5,
    };
    expect(buildActorContext(agents[0]!, roundInput({ agents })).event).toBeNull();
    expect(buildActorContext(agents[0]!, roundInput({ agents, intervention })).event).toEqual({
      label: intervention.label,
      stance: 0.8,
      strength: 0.5,
    });
  });

  it('tells the proxy which platform it is on and the per-round limit on changing its mind', () => {
    const context = buildActorContext(agents[0]!, roundInput({ agents }));
    expect(context.platform).toMatchObject({
      id: 'plaza',
      network: 'broadcast',
      label: 'Info Plaza',
    });
    expect(context.maxOpinionShift).toBe(MAX_OPINION_SHIFT);
    expect(context.self).toMatchObject({ id: 'agent-1', opinion: 0, openness: 0.5 });
  });
});

describe('validateDecision', () => {
  const heard = [agent(1), agent(2), agent(3)];
  const context = buildActorContext(
    heard[0]!,
    roundInput({
      agents: heard,
      round: 2,
      previousActions: [action('agent-2', 1), action('agent-3', 1)],
    }),
  );
  const known = context.knowledge[0]!.id;
  const decision = (overrides: Partial<ActorDecision> = {}): ActorDecision => ({
    opinion: 0.1,
    type: 'reply',
    content: 'A reply in the proxy’s voice.',
    peerIds: ['agent-2'],
    sourceIds: [known],
    rationale: 'Because of the visible post.',
    confidence: 0.5,
    ...overrides,
  });

  it('accepts a decision that stays within what the proxy saw and knows', () => {
    expect(() => validateDecision(decision(), context)).not.toThrow();
    expect(() =>
      validateDecision(decision({ type: 'observe', peerIds: [] }), context),
    ).not.toThrow();
  });

  it.each([
    ['duplicate peers', { peerIds: ['agent-2', 'agent-2'] }, /distinct/],
    ['an unseen peer', { peerIds: ['agent-9'] }, /observations/],
    ['itself', { peerIds: ['agent-1'] }, /observations/],
    ['a reply with no peer', { peerIds: [] }, /at least one observed peer/],
    ['an unknown passage', { sourceIds: ['S404'] }, /knowledge/],
    ['a jump beyond the per-round limit', { opinion: 0.6 }, /within 0\.5/],
  ])('rejects %s with a reason the model can act on', (_name, override, reason) => {
    expect(() => validateDecision(decision(override), context)).toThrow(AppError);
    expect(() => validateDecision(decision(override), context)).toThrow(reason);
  });

  it('allows a move of exactly the limit', () => {
    expect(() => validateDecision(decision({ opinion: MAX_OPINION_SHIFT }), context)).not.toThrow();
  });

  it('refuses a reply when nothing was visible, and says to post or observe instead', () => {
    const alone = buildActorContext(heard[0]!, roundInput({ agents: heard, round: 2 }));
    expect(() => validateDecision(decision({ peerIds: [] }), alone)).toThrow(/post.*observe/);
  });

  it('never lets a seed post be cited as a peer', () => {
    const seeded = buildActorContext(
      heard[0]!,
      roundInput({
        agents: heard,
        seedPosts: [
          {
            id: 'P1',
            text: 'Seed post about evening hours.',
            platform: 'both',
            stance: 0,
            strength: 0,
            sourceIds: [],
          },
        ],
      }),
    );
    expect(() => validateDecision(decision({ peerIds: ['P1'] }), seeded)).toThrow(AppError);
  });
});

describe('actorRound', () => {
  it('records one decision per proxy, with its own private memory and a stated reason', async () => {
    const result = await actorRound(
      roundInput({
        model: gateway((context) => ({
          ...actorBrain(context),
          rationale: `PRIVATE-REASON-${context.self.id}`,
        })),
      }),
    );
    expect(result.agents).toHaveLength(4);
    expect(result.snapshot.actions).toHaveLength(4);
    for (const member of result.agents) {
      expect(member.memory).toHaveLength(1);
      expect(member.memory[0]).toContain(`PRIVATE-REASON-${member.id}`);
      for (const other of result.agents.filter((candidate) => candidate.id !== member.id)) {
        expect(member.memory.join(' ')).not.toContain(`PRIVATE-REASON-${other.id}`);
      }
    }
    expect(result.snapshot.actions.every((item) => item.rationale && item.confidence === 0.6)).toBe(
      true,
    );
    expect(result.snapshot.opinions.map((item) => item.agentId)).toEqual([
      'agent-1',
      'agent-2',
      'agent-3',
      'agent-4',
    ]);
  });

  it('does not leak one proxy’s reason or memory to another in the next round', async () => {
    const contexts: ActorContext[] = [];
    const model = gateway(
      (context) => ({ ...actorBrain(context), rationale: `PRIVATE-REASON-${context.self.id}` }),
      (context) => contexts.push(context),
    );
    const first = await actorRound(roundInput({ model }));
    contexts.length = 0;
    await actorRound(
      roundInput({
        model,
        agents: first.agents,
        previousActions: first.snapshot.actions,
        round: 2,
      }),
    );
    expect(contexts).toHaveLength(4);
    for (const context of contexts) {
      const json = JSON.stringify(context);
      expect(json).toContain(`PRIVATE-REASON-${context.self.id}`);
      for (const other of ['agent-1', 'agent-2', 'agent-3', 'agent-4'].filter(
        (id) => id !== context.self.id,
      )) {
        expect(json).not.toContain(`PRIVATE-REASON-${other}`);
      }
    }
  });

  it('keeps every opinion inside the allowed range', async () => {
    const result = await actorRound(
      roundInput({
        agents: [agent(1, { opinion: 0.9 }), agent(2, { opinion: -0.9 }), agent(3), agent(4)],
        model: gateway((context) => ({
          ...actorBrain(context),
          opinion: Math.min(
            1,
            Math.max(-1, context.self.opinion + (context.self.opinion >= 0 ? 0.5 : -0.5)),
          ),
        })),
      }),
    );
    for (const member of result.agents) {
      expect(member.opinion).toBeGreaterThanOrEqual(-1);
      expect(member.opinion).toBeLessThanOrEqual(1);
    }
  });

  it('never runs more calls at once than the shared concurrency cap', async () => {
    let active = 0;
    let peak = 0;
    const model: ModelGateway = {
      async json<T>(schema: z.ZodType<T>, _i: string, data: unknown): Promise<T> {
        active += 1;
        peak = Math.max(peak, active);
        await sleep(3);
        active -= 1;
        return schema.parse(actorBrain(data as ActorContext));
      },
    };
    const agents = Array.from({ length: 10 }, (_, index) => agent(index + 1));
    await actorRound(roundInput({ model, agents, limit: createLimiter(3) }));
    expect(peak).toBe(3);
  });

  it('reports the first real failure, aborts in-flight siblings and never starts queued calls', async () => {
    let started = 0;
    let aborted = 0;
    const onFailure = vi.fn();
    const failure = new AppError(502, 'MODEL_TEST_FAILURE', 'Provider failed.');
    const model: ModelGateway = {
      async json<T>(
        _schema: z.ZodType<T>,
        _i: string,
        _d: unknown,
        signal: AbortSignal,
      ): Promise<T> {
        started += 1;
        if (started === 1) throw failure;
        return new Promise<T>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              aborted += 1;
              reject(signal.reason);
            },
            { once: true },
          );
        });
      },
    };
    const agents = Array.from({ length: 10 }, (_, index) => agent(index + 1));
    await expect(
      actorRound(roundInput({ model, agents, limit: createLimiter(3), onFailure })),
    ).rejects.toBe(failure);
    expect(started).toBe(3);
    expect(aborted).toBe(2);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith(failure);
  });

  it('stops when the run is cancelled, without starting more calls', async () => {
    const controller = new AbortController();
    const paused = new AppError(409, 'RUN_PAUSED', 'Paused.');
    let started = 0;
    const model: ModelGateway = {
      async json<T>(
        schema: z.ZodType<T>,
        _i: string,
        data: unknown,
        signal: AbortSignal,
      ): Promise<T> {
        started += 1;
        if (started === 2) controller.abort(paused);
        try {
          await sleep(2, undefined, { signal });
        } catch (error) {
          // The real client maps an aborted request to the run's cancellation reason the same way.
          throwIfAborted(signal);
          throw error;
        }
        return schema.parse(actorBrain(data as ActorContext));
      },
    };
    const agents = Array.from({ length: 8 }, (_, index) => agent(index + 1));
    await expect(
      actorRound(roundInput({ model, agents, limit: createLimiter(2), signal: controller.signal })),
    ).rejects.toMatchObject({ code: 'RUN_PAUSED' });
    expect(started).toBeLessThanOrEqual(3);
  });

  it('repairs a decision that cites a peer the proxy never saw, using the real model client', async () => {
    const config = testConfig({
      AI_PROVIDER: 'openai',
      AI_MODEL: 'fixture-model',
      OPENAI_API_KEY: 'test-placeholder-only',
    });
    const bodies: Array<{ messages: Array<{ role: string; content: string }> }> = [];
    let firstOnly = true;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as (typeof bodies)[number];
      bodies.push(body);
      const user = body.messages.find((message) => message.role === 'user')!.content;
      const context = (JSON.parse(user) as { untrustedScenarioData: ActorContext })
        .untrustedScenarioData;
      const honest = actorBrain(context);
      if (firstOnly && context.self.id === 'agent-1') {
        firstOnly = false;
        return chatCompletion({ ...honest, type: 'reply', peerIds: ['agent-77'] });
      }
      return chatCompletion(honest);
    });
    const client = new ModelClient(config.provider, () => undefined, fetcher, 20);
    const result = await actorRound(roundInput({ model: client }));
    expect(result.snapshot.actions).toHaveLength(4);
    // 4 proxies plus exactly one repair round trip for the invalid reply.
    expect(fetcher).toHaveBeenCalledTimes(5);
    const repair = bodies.find((body) =>
      body.messages.some((message) => message.content.includes('rejected by the server')),
    );
    expect(repair).toBeDefined();
    expect(JSON.stringify(repair)).toContain('peerIds');
  });
});

describe('actorCallBudget', () => {
  it('scales with the real workload and leaves headroom for bounded repairs', () => {
    expect(actorCallBudget(4, 2, 10)).toBe(132);
    expect(actorCallBudget(6, 2, 8)).toBe(156);
    // The largest model-assisted run the settings schema allows: 10 proxies, 10 rounds, both platforms.
    expect(actorCallBudget(10, 2, 10)).toBe(312);
    for (const [agents, platforms, rounds] of [
      [4, 1, 3],
      [6, 2, 8],
      [10, 2, 10],
    ] as const) {
      expect(actorCallBudget(agents, platforms, rounds)).toBeGreaterThan(
        agents * platforms * rounds,
      );
    }
  });

  it('grows monotonically with every dimension', () => {
    expect(actorCallBudget(5, 2, 6)).toBeGreaterThan(actorCallBudget(4, 2, 6));
    expect(actorCallBudget(4, 2, 7)).toBeGreaterThan(actorCallBudget(4, 2, 6));
    expect(actorCallBudget(4, 2, 6)).toBeGreaterThan(actorCallBudget(4, 1, 6));
  });
});
