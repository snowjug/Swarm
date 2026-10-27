import type { z } from 'zod';
import { AppError } from '../src/errors.js';
import type { ModelGateway, ModelUsage } from '../src/models/client.js';

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

export function decisions(platform: 'plaza' | 'community') {
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

export function simulationOutputs(rounds: number): unknown[] {
  return Array.from({ length: rounds }, () => [decisions('plaza'), decisions('community')]).flat();
}

/**
 * A scripted model double for orchestration tests. It validates every scripted answer against the
 * caller's real schema, records the trusted/untrusted split of each request, and reports usage so
 * token accounting can be asserted. It is NOT evidence about any live model's behavior.
 */
export class ScriptedProvider {
  readonly calls: { instructions: string; data: unknown }[] = [];
  onCall: ((index: number) => void) | null = null;

  constructor(private readonly outputs: unknown[]) {}

  readonly factory = (onUsage: (usage: ModelUsage) => void): ModelGateway => ({
    json: async <T>(schema: z.ZodType<T>, instructions: string, data: unknown): Promise<T> => {
      const index = this.calls.push({ instructions, data }) - 1;
      this.onCall?.(index);
      const parsed = schema.safeParse(this.outputs[index]);
      if (!parsed.success) {
        throw new AppError(
          502,
          'MODEL_OUTPUT_INVALID',
          'The model output did not match the contract.',
        );
      }
      onUsage({ inputTokens: 100, outputTokens: 20 });
      return parsed.data;
    },
  });
}
