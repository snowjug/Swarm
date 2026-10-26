import type { Agent, AgentAction, Intervention, RoundSnapshot } from '../../../shared/types.js';

export function clamp(value: number, minimum = -1, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function randomSource(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function mean(values: number[]): number {
  if (!values.length) throw new Error('Cannot compute an empty population mean.');
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function makeSnapshot(
  round: number,
  agents: Agent[],
  actions: AgentAction[],
  intervention: Intervention | null,
): RoundSnapshot {
  const opinions = agents.map((agent) => agent.opinion);
  const meanOpinion = mean(opinions);
  const support = opinions.filter((opinion) => opinion >= 0.2).length;
  const opposition = opinions.filter((opinion) => opinion <= -0.2).length;
  return {
    round,
    meanOpinion,
    supportShare: support / agents.length,
    oppositionShare: opposition / agents.length,
    undecidedShare: (agents.length - support - opposition) / agents.length,
    polarization: clamp(
      Math.sqrt(mean(opinions.map((opinion) => (opinion - meanOpinion) ** 2))),
      0,
      1,
    ),
    activityCount: actions.filter((action) => action.type !== 'observe').length,
    interactions: actions.reduce((sum, action) => sum + action.peerIds.length, 0),
    opinions: agents.map((agent) => ({ agentId: agent.id, opinion: agent.opinion })),
    actions,
    intervention,
  };
}
