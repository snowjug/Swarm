import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force';
import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';
import type { SimulationMemory } from '../../../shared/guided';
import type { Agent, KnowledgeGraph } from '../../../shared/types';

export type Inspection =
  | { kind: 'sources'; query?: string }
  | { kind: 'source' | 'document' | 'node' | 'agent' | 'memory' | 'interview'; id: string }
  | { kind: 'edge'; index: number };

export interface GraphInput {
  graph: KnowledgeGraph | null;
  agents: Pick<Agent, 'id' | 'name' | 'topicIds'>[];
  memories: SimulationMemory[];
  seed: number;
}

export interface GraphPoint extends SimulationNodeDatum {
  id: string;
  label: string;
  type: string;
  layer: 'source' | 'actor' | 'memory';
  referenceId: string;
  radius: number;
}

export interface GraphLine extends SimulationLinkDatum<GraphPoint> {
  id: string;
  label: string;
  simulated: boolean;
  evidenceIndex?: number;
  memoryId?: string;
}

export function cycleGraphNode(ids: string[], currentId: string, direction: -1 | 1): string | null {
  if (!ids.length) return null;
  const index = ids.indexOf(currentId);
  if (index < 0) return direction === 1 ? ids[0]! : ids.at(-1)!;
  return ids[(index + direction + ids.length) % ids.length]!;
}

export function recordedMemories(input: GraphInput, round?: number) {
  return input.memories.filter((memory) => round === undefined || memory.round <= round);
}

export function layoutGraph(input: GraphInput, overlays: boolean, round?: number) {
  const nodes: GraphPoint[] = (input.graph?.nodes ?? []).map((node) => ({
    id: `source:${node.id}`,
    label: node.label,
    type: node.entityType ?? node.kind,
    layer: 'source',
    referenceId: node.id,
    radius: 7 + Math.min(9, Math.sqrt(Math.max(0, node.weight)) * 3),
  }));
  const links: GraphLine[] = (input.graph?.edges ?? []).map((edge, index) => ({
    id: `edge:${index}`,
    source: `source:${edge.source}`,
    target: `source:${edge.target}`,
    label: edge.label,
    simulated: false,
    evidenceIndex: index,
  }));
  const eligibleMemories = recordedMemories(input, round);
  const memories = eligibleMemories.slice(-48);
  if (overlays) {
    for (const agent of input.agents) {
      nodes.push({
        id: `actor:${agent.id}`,
        label: agent.name,
        type: 'SIMULATED actor',
        layer: 'actor',
        referenceId: agent.id,
        radius: 11,
      });
      for (const topicId of agent.topicIds)
        links.push({
          id: `interest:${agent.id}:${topicId}`,
          source: `actor:${agent.id}`,
          target: `source:${topicId}`,
          label: 'assumed interest',
          simulated: true,
        });
    }
    for (const memory of memories) {
      nodes.push({
        id: `memory:${memory.id}`,
        label: `${memory.platform === 'plaza' ? 'Plaza' : 'Community'} R${memory.round} · ${memory.actionType}`,
        type: 'SIMULATED memory',
        layer: 'memory',
        referenceId: memory.id,
        radius: 6,
      });
      if (memory.agentId)
        links.push({
          id: `author:${memory.id}`,
          source: `actor:${memory.agentId}`,
          target: `memory:${memory.id}`,
          label: 'recorded action',
          simulated: true,
          memoryId: memory.id,
        });
      for (const peerId of memory.peerIds)
        links.push({
          id: `peer:${memory.id}:${peerId}`,
          source: `memory:${memory.id}`,
          target: `actor:${peerId}`,
          label: 'recorded peer context',
          simulated: true,
          memoryId: memory.id,
        });
    }
  }
  const ids = new Set(nodes.map((node) => node.id));
  const validLinks = links.filter(
    (link) => ids.has(String(link.source)) && ids.has(String(link.target)),
  );
  let seed = input.seed >>> 0;
  const random = () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4_294_967_296;
  };
  const simulation = forceSimulation(nodes)
    .stop()
    .randomSource(random)
    .force(
      'link',
      forceLink<GraphPoint, GraphLine>(validLinks)
        .id((node) => node.id)
        .distance((link) => (link.simulated ? 65 : 110))
        .strength(0.25),
    )
    .force('charge', forceManyBody().strength(-140))
    .force(
      'collide',
      forceCollide<GraphPoint>().radius((node) => node.radius + 13),
    )
    .force('center', forceCenter(0, 0));
  simulation.tick(220);
  simulation.stop();
  return {
    nodes,
    links: validLinks,
    shownMemories: overlays ? memories.length : 0,
    eligibleMemories: eligibleMemories.length,
  };
}
