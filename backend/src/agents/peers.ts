import type { Agent } from '../../../shared/types.js';

export type Network = 'broadcast' | 'community';

/** How many peers an agent is exposed to per round under each network structure. */
export const PEER_LIMIT: Record<Network, number> = { broadcast: 4, community: 5 };

const COMMUNITY_REACH = 0.95;

/**
 * Peers ordered by how likely this agent is to be exposed to them. Broadcast favors high-influence
 * voices; community favors shared topics, influence and similar views, and ignores distant ones.
 */
export function rankPeers(agent: Agent, agents: readonly Agent[], network: Network): Agent[] {
  const candidates = agents.filter((peer) => peer.id !== agent.id);
  if (network === 'broadcast') {
    return candidates.sort((left, right) => right.influence - left.influence);
  }
  const affinity = (peer: Agent): number =>
    peer.topicIds.filter((id) => agent.topicIds.includes(id)).length * 2 +
    peer.influence * 0.25 -
    Math.abs(peer.opinion - agent.opinion);
  return candidates
    .filter((peer) => Math.abs(peer.opinion - agent.opinion) <= COMMUNITY_REACH)
    .sort((left, right) => affinity(right) - affinity(left) || left.id.localeCompare(right.id));
}

export function selectPeers(agent: Agent, agents: readonly Agent[], network: Network): Agent[] {
  return rankPeers(agent, agents, network).slice(0, PEER_LIMIT[network]);
}
