import type {
  Agent,
  AgentAction,
  KnowledgeGraph,
  SimulationSettings,
} from '../../../shared/types.js';
import { clamp, makeSnapshot, randomSource } from './state.js';

export function createLocalAgents(graph: KnowledgeGraph, settings: SimulationSettings): Agent[] {
  if (!graph.nodes.length) throw new Error('A source graph is required before persona creation.');
  const random = randomSource(settings.seed);
  return Array.from({ length: settings.agentCount }, (_, index): Agent => {
    const topic = graph.nodes[index % graph.nodes.length];
    const secondary = graph.nodes[Math.floor(random() * graph.nodes.length)];
    if (!topic || !secondary) throw new Error('The topic assignment is inconsistent.');
    const initialOpinion = clamp(
      -0.8 + (1.6 * index) / (settings.agentCount - 1) + (random() - 0.5) * 0.12,
    );
    const role =
      initialOpinion > 0.2
        ? 'Synthetic advocate'
        : initialOpinion < -0.2
          ? 'Synthetic skeptic'
          : 'Synthetic observer';
    return {
      id: `agent-${index + 1}`,
      name: `${topic.label} ${String(index + 1).padStart(2, '0')}`,
      role,
      persona: `Fictional stakeholder proxy interested in ${topic.label.toLowerCase()} and ${secondary.label.toLowerCase()}. Inclination and openness are assigned by the seeded baseline, not inferred as a real person's beliefs.`,
      topicIds: [...new Set([topic.id, secondary.id])],
      initialOpinion,
      opinion: initialOpinion,
      influence: 0.5 + topic.weight * 0.7 + random() * 0.3,
      openness: 0.18 + random() * 0.44,
      memory: [],
      sourceIds: [...new Set([...topic.sourceIds, ...secondary.sourceIds])].slice(0, 6),
    };
  });
}

export function localRound(
  agents: Agent[],
  settings: SimulationSettings,
  round: number,
): { agents: Agent[]; snapshot: ReturnType<typeof makeSnapshot> } {
  const random = randomSource(settings.seed + round * 9_973);
  const intervention = settings.intervention?.round === round ? settings.intervention : null;
  const actions: AgentAction[] = [];
  const next = agents.map((agent): Agent => {
    const candidates = agents.filter((peer) => peer.id !== agent.id);
    const peers =
      settings.network === 'broadcast'
        ? candidates.sort((left, right) => right.influence - left.influence).slice(0, 4)
        : candidates
            .filter((peer) => Math.abs(peer.opinion - agent.opinion) <= 0.95)
            .sort((left, right) => {
              const affinity = (peer: Agent): number =>
                peer.topicIds.filter((id) => agent.topicIds.includes(id)).length * 2 +
                peer.influence * 0.25 -
                Math.abs(peer.opinion - agent.opinion);
              return affinity(right) - affinity(left) || left.id.localeCompare(right.id);
            })
            .slice(0, 5);
    const totalWeight = peers.reduce((sum, peer) => sum + peer.influence, 0);
    const peerMean = totalWeight
      ? peers.reduce((sum, peer) => sum + peer.opinion * peer.influence, 0) / totalWeight
      : agent.opinion;
    const socialChange = agent.openness * (peerMean - agent.opinion);
    const eventChange = intervention
      ? intervention.strength * (intervention.stance - agent.opinion) * 0.6
      : 0;
    const opinion = clamp(agent.opinion + socialChange + eventChange + (random() - 0.5) * 0.04);
    const content =
      `Rule-based state update: inclination ${agent.opinion.toFixed(3)} to ${opinion.toFixed(3)} ` +
      `after ${peers.length} peer exposures.` +
      (intervention ? ` Scheduled intervention applied: ${intervention.label}` : '');
    actions.push({
      id: `round-${round}-${agent.id}`,
      round,
      agentId: agent.id,
      type: Math.abs(opinion - agent.opinion) >= 0.005 ? 'update' : 'observe',
      content,
      opinion,
      peerIds: peers.map((peer) => peer.id),
      sourceIds: agent.sourceIds,
    });
    return {
      ...agent,
      opinion,
      memory: [...agent.memory, content].slice(-4),
    };
  });
  return { agents: next, snapshot: makeSnapshot(round, next, actions, intervention) };
}
