import { describe, expect, it } from 'vitest';
import { projectFixture } from '../test/project';
import { cycleGraphNode, labelBox, labelCenterX, layoutGraph, visibleLabelIds } from './graph';
import type { GraphPoint, LabelBox, LabelCandidate } from './graph';

describe('source graph and recorded simulation overlays', () => {
  it('cycles the roving node in both directions, wrapping without creating edge stops', () => {
    const ids = ['source:topic-1', 'actor:agent-1', 'memory:M-1'];
    expect(cycleGraphNode(ids, 'source:topic-1', 1)).toBe('actor:agent-1');
    expect(cycleGraphNode(ids, 'source:topic-1', -1)).toBe('memory:M-1');
    expect(cycleGraphNode(ids, 'memory:M-1', 1)).toBe('source:topic-1');
    expect(cycleGraphNode(ids, 'removed', 1)).toBe('source:topic-1');
    expect(cycleGraphNode([], '', 1)).toBeNull();
  });
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

// Captured from the live demo (a real model graph of 13 source nodes and 6 simulated actors in a
// panel of about 700 px): fitting everything into the panel shrinks the layout while labels stay
// 12 px, so labels overlapped (4 collisions at 1440x900, 14 at 390x844) where the audit allows none.
describe('label decluttering', () => {
  const PANEL = 700;
  const candidate = (
    id: string,
    x: number,
    y: number,
    text: string,
    rank = 0,
    radius = 10,
  ): LabelCandidate => ({ id, x, y, radius, text, rank });
  const touching = (a: LabelBox, b: LabelBox): boolean =>
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

  it('draws every label when the nodes are far enough apart', () => {
    const spread = [
      candidate('a', 100, 80, 'Larkholm Island Council'),
      candidate('b', 400, 80, 'Battery-Electric Ferry'),
      candidate('c', 100, 300, 'Harbour Business Council'),
      candidate('d', 400, 300, 'Green Tide Alliance'),
    ];
    expect(visibleLabelIds(spread, PANEL)).toEqual(new Set(['a', 'b', 'c', 'd']));
    expect(visibleLabelIds([], PANEL)).toEqual(new Set());
  });

  it('keeps the higher-ranked label when two would overlap, whatever order they arrive in', () => {
    const heavy = candidate('heavy', 300, 200, 'Diesel Ferry MV Gannet', 1);
    const light = candidate('light', 312, 206, 'Battery-Electric Ferry', 5);
    expect(visibleLabelIds([heavy, light], PANEL)).toEqual(new Set(['heavy']));
    expect(visibleLabelIds([light, heavy], PANEL)).toEqual(new Set(['heavy']));
    expect(
      visibleLabelIds(
        [candidate('b', 300, 200, 'Same', 2), candidate('a', 300, 200, 'Same', 2)],
        PANEL,
      ),
    ).toEqual(new Set(['a']));
  });

  it('draws a label that sits above another one only if the boxes are clear', () => {
    const upper = candidate('upper', 300, 100, 'Winter Service Timetable');
    const clearBelow = candidate('below', 300, 100 + 10 + 2 + 15 + 10 + 4, 'Fare Increase', 1);
    const tooClose = candidate('close', 300, 108, 'Clean Coasts Fund', 2);
    expect(visibleLabelIds([upper, clearBelow, tooClose], PANEL)).toEqual(
      new Set(['upper', 'below']),
    );
  });

  it('keeps labels inside the panel, as the drawn clamp does', () => {
    const edge = candidate('edge', 2, 50, 'Larkholm Residents’ Association');
    const box = labelBox(edge, PANEL);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(labelCenterX(2, edge.text, PANEL)).toBeGreaterThan(2);
    expect(
      labelBox(candidate('right', PANEL - 2, 50, 'Harbour Business Council'), PANEL).right,
    ).toBeLessThanOrEqual(PANEL);
  });

  it('never draws overlapping labels, and skips one only because a higher-ranked label is in the way', () => {
    let seed = 20261028;
    const random = (): number => {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    let skipped = 0;
    for (let round = 0; round < 250; round += 1) {
      const count = 3 + Math.floor(random() * 38);
      const crowded = round % 2 === 0;
      const candidates = Array.from({ length: count }, (_, index) =>
        candidate(
          `n${index}`,
          20 + random() * (crowded ? 260 : 640),
          20 + random() * (crowded ? 180 : 500),
          'x'.repeat(8 + Math.floor(random() * 18)),
          Math.floor(random() * 20),
          6 + random() * 10,
        ),
      );
      const shown = visibleLabelIds(candidates, PANEL);
      const boxes = new Map(candidates.map((item) => [item.id, labelBox(item, PANEL)]));
      const drawn = candidates.filter((item) => shown.has(item.id));
      for (let a = 0; a < drawn.length; a += 1)
        for (let b = a + 1; b < drawn.length; b += 1)
          expect(touching(boxes.get(drawn[a]!.id)!, boxes.get(drawn[b]!.id)!)).toBe(false);
      for (const item of candidates.filter((entry) => !shown.has(entry.id))) {
        skipped += 1;
        const blocker = drawn.find(
          (other) =>
            touching(boxes.get(item.id)!, boxes.get(other.id)!) &&
            (other.rank < item.rank || (other.rank === item.rank && other.id < item.id)),
        );
        expect(
          blocker,
          `${item.id} was skipped without a higher-ranked label in its way`,
        ).toBeDefined();
      }
      // The first-ranked label is always drawn.
      const first = [...candidates].sort((l, r) => l.rank - r.rank || l.id.localeCompare(r.id))[0]!;
      expect(shown.has(first.id)).toBe(true);
    }
    expect(skipped).toBeGreaterThan(500);
  });
});
