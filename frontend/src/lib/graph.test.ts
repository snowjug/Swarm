import { describe, expect, it } from 'vitest';
import { projectFixture } from '../test/project';
import { layoutGraph } from './graph';
import type { GraphPoint } from './graph';

describe('source graph and recorded simulation overlays', () => {
  it('retains source IDs, lays out real graph data, and does not mutate API records', () => {
    const project = projectFixture();
    const before = JSON.stringify(project);
    const graph = layoutGraph(
      {
        graph: project.graph,
        agents: project.agents,
        memories: [],
        seed: 42,
      },
      false,
    );
    expect(graph.nodes).toHaveLength(2);
    expect(graph.links).toHaveLength(1);
    expect(graph.nodes[0]!.referenceId).toBe('topic-1');
    expect(graph.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(
      true,
    );
    expect(graph.links[0]!.evidenceIndex).toBe(0);
    expect(graph.links[0]!.simulated).toBe(false);
    expect(JSON.stringify(project)).toBe(before);
  });

  it('only makes memory nodes and peer links from actual memory records', () => {
    const project = projectFixture();
    const input = {
      graph: project.graph,
      agents: project.agents,
      seed: 42,
      memories: [
        {
          id: 'memory-test',
          platform: 'plaza' as const,
          round: 1,
          simulatedMinute: 10,
          kind: 'action' as const,
          agentId: 'agent-1',
          actionType: 'update' as const,
          text: 'Synthetic state transition for testing.',
          opinion: 0.3,
          peerIds: ['agent-1', 'unrecorded-agent'],
          sourceIds: ['S1'],
        },
      ],
    };
    const graph = layoutGraph(input, true);
    expect(graph.nodes.filter((node) => node.layer === 'memory')).toHaveLength(1);
    expect(graph.nodes.find((node) => node.layer === 'memory')!.referenceId).toBe('memory-test');
    const peers = graph.links.filter((link) => link.label === 'recorded peer context');
    expect(peers).toHaveLength(1);
    expect((peers[0]!.target as GraphPoint).referenceId).toBe('agent-1');
    expect(
      graph.links.filter((link) => link.simulated).every((link) => link.label !== 'co-occurs'),
    ).toBe(true);
    expect(layoutGraph(input, false).nodes.every((node) => node.layer === 'source')).toBe(true);
  });

  it('bounds visible overlays without fabricating or losing the total record', () => {
    const project = projectFixture();
    const memories = Array.from({ length: 60 }, (_, index) => ({
      id: `memory-${index}`,
      platform: 'community' as const,
      round: index + 1,
      simulatedMinute: (index + 1) * 10,
      kind: 'action' as const,
      agentId: 'agent-1',
      actionType: 'observe' as const,
      text: 'Test record.',
      opinion: null,
      peerIds: [],
      sourceIds: ['S1'],
    }));
    const graph = layoutGraph(
      { graph: project.graph, agents: project.agents, memories, seed: 42 },
      true,
    );
    expect(graph.shownMemories).toBe(48);
    expect(memories).toHaveLength(60);
    expect(graph.nodes.some((node) => node.referenceId === 'memory-0')).toBe(false);
    expect(graph.nodes.some((node) => node.referenceId === 'memory-59')).toBe(true);
  });
});
