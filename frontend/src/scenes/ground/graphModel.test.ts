import { describe, expect, it } from 'vitest';
import type { KnowledgeGraph } from '../../../../shared/types';
import { conflictRecord, evidenceRef } from '../../test/ledger';
import {
  NO_GRAPH_FILTER,
  buildGraphView,
  curvePath,
  deriveLit,
  fitViewport,
  keyboardOrder,
  layoutPlacements,
  linkRanks,
  nodeRadius,
  ringArcs,
  screenX,
  screenY,
  tameOutliers,
  visibleEdgeIndexes,
  visibleNodeIds,
  zoomAbout,
} from './graphModel';
import { indexPassages } from './passages';

const graph: KnowledgeGraph = {
  method: 'lexical',
  notes: [],
  nodes: [
    {
      id: 'a',
      label: 'Assistant',
      kind: 'topic',
      summary: '',
      weight: 1,
      sourceIds: ['S1', 'S2', 'S3'],
    },
    { id: 'b', label: 'Pilot', kind: 'topic', summary: '', weight: 0.5, sourceIds: ['S3'] },
    {
      id: 'c',
      label: 'Regulator',
      kind: 'organization',
      entityType: 'Body',
      summary: '',
      weight: 0.2,
      sourceIds: ['S9'],
    },
  ],
  edges: [
    { source: 'a', target: 'b', label: 'co-occurs with', weight: 0.7, sourceIds: ['S3'] },
    { source: 'b', target: 'c', label: 'co-occurs with', weight: 0.2, sourceIds: ['S3'] },
    { source: 'a', target: 'gone', label: 'x', weight: 0.5, sourceIds: [] },
  ],
};

const passages = indexPassages(
  ['S1', 'S2', 'S3'].map((id, i) => ({
    id,
    documentId: i < 2 ? 'D1' : 'D2',
    documentName: i < 2 ? 'one.md' : 'two.md',
    start: 0,
    end: 10,
    text: '',
  })),
);

const place = layoutPlacements(graph, 42);

describe('layoutPlacements', () => {
  it('places every node, and the same graph the same way every time', () => {
    expect(place).toHaveLength(3);
    expect(layoutPlacements(graph, 42)).toEqual(place);
  });
});

describe('tameOutliers', () => {
  const cluster = Array.from({ length: 8 }, (_, i) => ({
    id: `n${i}`,
    x: Math.cos(i) * 40,
    y: Math.sin(i) * 40,
  }));

  it('draws a node that is far from the rest back to just outside the cluster, in the same direction', () => {
    const far = { id: 'far', x: 900, y: 0 };
    const [moved] = tameOutliers([...cluster, far]).slice(-1);
    expect(moved!.x).toBeLessThan(120);
    expect(moved!.x).toBeGreaterThan(40);
    expect(Math.abs(moved!.y)).toBeLessThan(10);
  });

  it('leaves a compact drawing, and a graph too small to have outliers, as it is', () => {
    expect(tameOutliers(cluster)).toEqual(cluster);
    expect(tameOutliers(cluster.slice(0, 3))).toEqual(cluster.slice(0, 3));
  });
});

describe('buildGraphView', () => {
  const view = buildGraphView(graph, place, passages, ['D1', 'D2']);

  it('says which documents cite each topic, and how much each contributes', () => {
    const assistant = view.byId.get('a')!;
    expect(assistant.documentIds).toEqual(['D1', 'D2']);
    expect(assistant.shares.map((share) => share.count)).toEqual([2, 1]);
    expect(assistant.shares.reduce((sum, share) => sum + share.share, 0)).toBeCloseTo(1);
  });

  it('draws a citation it cannot place as nothing, not as a document', () => {
    expect(view.byId.get('c')!.documentIds).toEqual([]);
  });

  it('leaves out a link to a node that is not in the graph, and knows who is next to whom', () => {
    expect(view.edges).toHaveLength(2);
    expect([...(view.neighbours.get('b') ?? [])].sort()).toEqual(['a', 'c']);
  });

  it('names a node by its ontology type where there is one, otherwise by its kind', () => {
    expect(view.byId.get('c')!.type).toBe('Body');
    expect(view.byId.get('a')!.type).toBe('Topic');
    expect(view.types.map((info) => info.type).sort()).toEqual(['Body', 'Topic']);
  });

  it('draws bigger what the sources lean on more', () => {
    expect(nodeRadius(1)).toBeGreaterThan(nodeRadius(0.2));
  });

  it('ranks the links among one another, so that a picture of nearly equal weights still has strong and faint ones', () => {
    expect(linkRanks([])).toEqual([]);
    const ranks = linkRanks([0.9, 0.91, 0.92, 0.93, 0.94]);
    expect(ranks[0]).toBe(0);
    expect(ranks[4]).toBe(1);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(linkRanks([0.5])).toEqual([0]);
  });

  it('puts the strongest topic first for the keyboard', () => {
    expect(keyboardOrder(view.nodes)[0]).toBe('a');
  });

  it('can be filtered by type and by how strong a link is', () => {
    const visible = visibleNodeIds(view, { hiddenTypes: new Set(['Body']), minWeight: 0 });
    expect([...visible].sort()).toEqual(['a', 'b']);
    expect(
      visibleEdgeIndexes(view, visible, { hiddenTypes: new Set(['Body']), minWeight: 0 }),
    ).toEqual(new Set([0]));
    const all = visibleNodeIds(view, NO_GRAPH_FILTER);
    expect(visibleEdgeIndexes(view, all, { hiddenTypes: new Set(), minWeight: 0.5 })).toEqual(
      new Set([0]),
    );
  });
});

describe('fitViewport and zoomAbout', () => {
  const nodes = [
    { x: -100, y: -50, radius: 12 },
    { x: 100, y: 50, radius: 12 },
  ];

  it('fits every node inside the space', () => {
    const view = fitViewport(nodes, 800, 500);
    for (const node of nodes) {
      const x = screenX(node, view);
      const y = screenY(node, view);
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(800);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(500);
    }
  });

  it('keeps clear the room it is told to, so that a card over the graph covers nothing', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      x: (i % 4) * 80,
      y: Math.floor(i / 4) * 80,
      radius: 12,
    }));
    const open = fitViewport(many, 800, 500, { x: 56, top: 44, bottom: 64, right: 300 });
    for (const node of many) expect(screenX(node, open)).toBeLessThan(800 - 300);
    expect(open.k).toBeLessThan(fitViewport(many, 800, 500).k);
  });

  it('draws a wide space wider, and a tall one not at all', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      x: (i % 4) * 60,
      y: Math.floor(i / 4) * 60,
      radius: 12,
    }));
    expect(fitViewport(many, 1000, 400).stretch).toBeGreaterThan(1);
    expect(fitViewport(many, 300, 600).stretch).toBe(1);
  });

  it('keeps a graph of a few nodes close together instead of spreading it across the room', () => {
    const pair = fitViewport(nodes, 1200, 600);
    expect(pair.stretch).toBe(1);
    const apart = screenX(nodes[1]!, pair) - screenX(nodes[0]!, pair);
    expect(apart).toBeLessThan(300);
    expect(apart).toBeGreaterThan(40);
  });

  it('keeps the point it zooms about where it is', () => {
    const view = fitViewport(nodes, 800, 500);
    const next = zoomAbout(view, 1.5, 300, 200);
    expect(300 - (300 - next.x) / (next.k / view.k)).toBeCloseTo(view.x);
    expect(next.k).toBeCloseTo(view.k * 1.5);
  });
});

describe('ringArcs', () => {
  it('is a whole ring for one document and one arc each for several, none touching', () => {
    expect(ringArcs([{ documentId: 'D1', count: 3, share: 1 }], 12)).toEqual([
      { documentId: 'D1', d: '', full: true },
    ]);
    const arcs = ringArcs(
      [
        { documentId: 'D1', count: 2, share: 2 / 3 },
        { documentId: 'D2', count: 1, share: 1 / 3 },
      ],
      12,
    );
    expect(arcs).toHaveLength(2);
    expect(arcs.every((arc) => arc.d.startsWith('M') && !arc.full)).toBe(true);
    expect(ringArcs([], 12)).toEqual([]);
  });

  it('bows a link to the side its sign says', () => {
    expect(curvePath(0, 0, 100, 0, 0.1)).not.toBe(curvePath(0, 0, 100, 0, -0.1));
  });
});

describe('deriveLit', () => {
  const view = buildGraphView(graph, place, passages, ['D1', 'D2']);
  const conflicts = [
    conflictRecord({
      id: 'X1',
      left: evidenceRef({ passageId: 'S1', documentId: 'D1', role: 'contradicts' }),
      right: evidenceRef({ passageId: 'S3', documentId: 'D2', role: 'contradicts' }),
    }),
  ];

  it('lights a topic’s passages, their documents and the conflicts that touch them', () => {
    const lit = deriveLit({ node: 'b' }, view, passages, conflicts);
    expect(lit.active).toBe(true);
    expect([...lit.passages]).toEqual(['S3']);
    expect([...lit.documents]).toEqual(['D2']);
    expect([...lit.conflicts]).toEqual(['X1']);
    expect([...lit.related].sort()).toEqual(['a', 'c']);
  });

  it('lights the topics that rest on a passage', () => {
    const lit = deriveLit({ passage: 'S3' }, view, passages, conflicts);
    expect([...lit.nodes].sort()).toEqual(['a', 'b']);
  });

  it('lights both sides of a conflict and what rests on them', () => {
    const lit = deriveLit({ conflict: 'X1' }, view, passages, conflicts);
    expect([...lit.documents].sort()).toEqual(['D1', 'D2']);
    expect([...lit.nodes].sort()).toEqual(['a', 'b']);
  });

  it('lights a whole document’s passages and the topics that cite any of them', () => {
    const lit = deriveLit({ document: 'D1' }, view, passages, conflicts);
    expect([...lit.passages].sort()).toEqual(['S1', 'S2']);
    expect([...lit.nodes]).toEqual(['a']);
  });

  it('lights nothing when nothing is pointed at, or when what is pointed at is not there', () => {
    expect(deriveLit({}, view, passages, conflicts).active).toBe(false);
    expect(deriveLit({ node: 'zzz' }, view, passages, conflicts).active).toBe(false);
    expect(deriveLit({ node: 'a' }, null, null, []).active).toBe(false);
  });
});
