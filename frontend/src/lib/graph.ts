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

/** Labels are drawn at a fixed 12 px, so these describe their box on screen whatever the zoom. */
const LABEL_CHARACTER_PX = 7.4;
const LABEL_HEIGHT_PX = 15;
const LABEL_PADDING_PX = 6;
const LABEL_BELOW_NODE_PX = 2;

/** How far a label is kept from the left and right edges of the panel (the existing clamp). */
function labelHalfSpan(text: string, panelWidth: number): number {
  return Math.min(panelWidth / 2 - 8, text.length * 6 + 6);
}

/** The screen x at which a label is centred: under its node, kept inside the panel. */
export function labelCenterX(nodeX: number, text: string, panelWidth: number): number {
  const half = labelHalfSpan(text, panelWidth);
  return Math.max(half, Math.min(panelWidth - half, nodeX));
}

export interface LabelCandidate {
  id: string;
  /** The node's position on screen, in CSS pixels. */
  x: number;
  y: number;
  /** The drawn radius of the node on screen. */
  radius: number;
  /** The text that will be drawn. */
  text: string;
  /** Lower ranks are placed first and keep their label when two would overlap. */
  rank: number;
}

export interface LabelBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Where a label's text is drawn on screen. */
export function labelBox(candidate: LabelCandidate, panelWidth: number): LabelBox {
  const centre = labelCenterX(candidate.x, candidate.text, panelWidth);
  const half = (candidate.text.length * LABEL_CHARACTER_PX) / 2 + LABEL_PADDING_PX / 2;
  const top = candidate.y + candidate.radius + LABEL_BELOW_NODE_PX;
  return { left: centre - half, right: centre + half, top, bottom: top + LABEL_HEIGHT_PX };
}

const overlaps = (a: LabelBox, b: LabelBox): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * Which labels to draw so that none overlaps another. A graph fitted into a small panel is shrunk
 * while its labels stay 12 px, so with a dozen or more nodes they pile up and cannot be read. Labels
 * are placed in rank order and one is skipped when its box would touch a label already placed. A
 * skipped label is not lost: its node keeps its accessible name, tooltip and place in the "Inspect
 * node" list, and zooming in spreads the nodes so more labels fit. The result does not depend on the
 * order the candidates are given in.
 */
export function visibleLabelIds(
  candidates: readonly LabelCandidate[],
  panelWidth: number,
): Set<string> {
  const placed: LabelBox[] = [];
  const shown = new Set<string>();
  const ordered = [...candidates].sort(
    (left, right) => left.rank - right.rank || left.id.localeCompare(right.id),
  );
  for (const candidate of ordered) {
    const box = labelBox(candidate, panelWidth);
    if (placed.some((other) => overlaps(box, other))) continue;
    placed.push(box);
    shown.add(candidate.id);
  }
  return shown;
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
