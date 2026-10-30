import type { z } from 'zod';
import type { ActorContext } from '../src/agents/actor.js';
import { AppError } from '../src/errors.js';
import type { JsonOptions, ModelGateway, ModelUsage } from '../src/models/client.js';
import {
  actorBrain,
  entailmentBrain,
  isActorCall,
  isEntailmentCall,
} from './support/model-brain.js';

export const modelEnvironment = {
  AI_PROVIDER: 'openai',
  AI_MODEL: 'fixture-model',
  OPENAI_API_KEY: 'test-placeholder-only',
};

export const ontology = {
  entityTypes: [
    { name: 'Organization', description: 'An organization described by the supplied text.' },
    { name: 'Community', description: 'A source-described stakeholder group.' },
  ],
  relationshipTypes: [
    { name: 'informs', description: 'A source-grounded information relationship.' },
  ],
};

export const graph = {
  nodes: [
    {
      id: 'n1',
      label: 'Transit Office',
      kind: 'organization',
      entityType: 'Organization',
      summary: 'A fictional office described in the transit notes.',
      quote: 'The City Transit Office proposes a six-month electric bus pilot',
      weight: 1,
      sourceIds: ['S1'],
    },
    {
      id: 'n2',
      label: 'Community',
      kind: 'group',
      entityType: 'Community',
      summary: 'A fictional community described in the transit notes.',
      quote: 'Neighborhood groups ask for accessible stops and clear information',
      weight: 0.5,
      sourceIds: ['S1'],
    },
  ],
  edges: [{ source: 'n1', target: 'n2', label: 'informs', weight: 0.7, sourceIds: ['S1'] }],
};

export const personas = {
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

export const prepared = {
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

/**
 * A scripted model double for orchestration tests. Setup calls (ontology, graph, personas, ...) are
 * answered from the script in order. Per-actor simulation calls run in parallel, so they are answered
 * from the caller's own context by `actorBrain` instead of by position. Every answer is validated
 * against the caller's real schema and semantic validator, the trusted/untrusted split of each
 * request is recorded, and usage is reported so token accounting can be asserted. It is NOT
 * evidence about any live model's behavior.
 */
export class ScriptedProvider {
  readonly calls: { instructions: string; data: unknown; actor: boolean; entailment: boolean }[] =
    [];
  /** Fires with the global call index before the call is answered. */
  onCall: ((index: number) => void) | null = null;
  /** Fires with the 0-based count of actor calls so far. */
  onActorCall: ((actorIndex: number) => void) | null = null;
  /** Replaces the default actor behavior, for example to return hostile output. */
  actorOverride: ((context: ActorContext, actorIndex: number) => unknown) | null = null;
  /** While set, every actor call waits for it: a test holds a worker in the middle of a round. */
  gate: Promise<void> | null = null;
  private scripted = 0;
  private actors = 0;

  constructor(private readonly outputs: unknown[]) {}

  get actorCalls(): { instructions: string; data: ActorContext }[] {
    return this.calls.filter((call) => call.actor) as {
      instructions: string;
      data: ActorContext;
    }[];
  }

  get setupCalls(): { instructions: string; data: unknown }[] {
    return this.calls.filter((call) => !call.actor && !call.entailment);
  }

  readonly factory = (onUsage: (usage: ModelUsage) => void): ModelGateway => ({
    json: async <T>(
      schema: z.ZodType<T>,
      instructions: string,
      data: unknown,
      _signal?: AbortSignal,
      _maxTokens?: number,
      options?: JsonOptions<T>,
    ): Promise<T> => {
      const actor = isActorCall(instructions);
      const entailment = isEntailmentCall(instructions);
      const index = this.calls.push({ instructions, data, actor, entailment }) - 1;
      this.onCall?.(index);
      let raw: unknown;
      if (actor) {
        const actorIndex = this.actors++;
        this.onActorCall?.(actorIndex);
        if (this.gate) await this.gate;
        raw = this.actorOverride
          ? this.actorOverride(data as ActorContext, actorIndex)
          : actorBrain(data as ActorContext);
      } else if (entailment) {
        raw = entailmentBrain(data);
      } else {
        raw = this.outputs[this.scripted++];
      }
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        throw new AppError(
          502,
          'MODEL_OUTPUT_INVALID',
          'The model output did not match the contract.',
        );
      }
      options?.validate?.(parsed.data);
      onUsage({ inputTokens: 100, outputTokens: 20 });
      return parsed.data;
    },
  });
}
