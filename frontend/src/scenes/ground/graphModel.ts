import type { ContradictionRecord } from '../../../../shared/evidence';
import type { KnowledgeGraph, KnowledgeNode } from '../../../../shared/types';
import { layoutGraph } from '../../lib/graph';
import { findPassage, uniquePassageIds, type PassageIndex } from './passages';

export type NodeKind = KnowledgeNode['kind'];

export const KIND_LABELS: Record<NodeKind, string> = {
  topic: 'Topic',
  person: 'Person',
  organization: 'Organisation',
  group: 'Group',
};

export interface NodeShare {
  documentId: string;
  count: number;
  /** Of the passages that cite the node, the share that sit in this document: 0..1. */
  share: number;
}

export interface GraphNode {
  id: string;
  index: number;
  label: string;
  kind: NodeKind;
  /** The ontology's name for it where the graph has one; otherwise the kind. */
  type: string;
  summary: string;
  weight: number;
  quote: string | null;
  sourceIds: string[];
  /** The documents that cite it, in the order the project lists them. */
  documentIds: string[];
  shares: NodeShare[];
  /** Layout position, in the layout's own units. */
  x: number;
  y: number;
  /** Drawn radius in pixels. */
  radius: number;
}

export interface GraphEdge {
  index: number;
  source: string;
  target: string;
  label: string;
  weight: number;
  sourceIds: string[];
  documentIds: string[];
}

export interface TypeInfo {
  type: string;
  kind: NodeKind;
  count: number;
}

export interface GraphView {
  method: KnowledgeGraph['method'];
  notes: string[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  types: TypeInfo[];
  byId: Map<string, GraphNode>;
  neighbours: Map<string, Set<string>>;
  edgesOf: Map<string, number[]>;
}

export interface Placement {
  id: string;
  x: number;
  y: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

/** Bigger for what the sources lean on more; a floor so that the smallest is still a thing to touch. */
export const nodeRadius = (weight: number): number => 11 + 10 * Math.sqrt(clamp01(weight));

/**
 * A node with few links is pushed far out by the layout's repulsion, and fitting the whole drawing then makes
 * the rest of it small. A node that sits far beyond the rest (by the usual fence: past the upper quartile by
 * one and a half times the spread) is drawn back to just outside the cluster, in the same direction, so that
 * every node stays on the page and the cluster fills it.
 */
export function tameOutliers(placements: readonly Placement[]): Placement[] {
  if (placements.length < 4) return [...placements];
  const middle = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const half = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? (sorted[half] ?? 0)
      : ((sorted[half - 1] ?? 0) + (sorted[half] ?? 0)) / 2;
  };
  const cx = middle(placements.map((place) => place.x));
  const cy = middle(placements.map((place) => place.y));
  const distance = (place: Placement) => Math.hypot(place.x - cx, place.y - cy);
  const sorted = placements.map(distance).sort((a, b) => a - b);
  const quartile = (share: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0;
  const fence = quartile(0.75) + 1.5 * (quartile(0.75) - quartile(0.25));
  const inliers = sorted.filter((d) => d <= fence);
  const edge = inliers.at(-1) ?? 0;
  return placements.map((place) => {
    const d = distance(place);
    if (d <= fence || d === 0) return place;
    const eased = edge * 1.12 + (d - fence) * 0.02;
    return {
      id: place.id,
      x: cx + ((place.x - cx) / d) * eased,
      y: cy + ((place.y - cy) / d) * eased,
    };
  });
}

/**
 * Where each node goes: the engine's own deterministic force layout (220 steps from the project's seed),
 * so that the same graph is always drawn the same way. Positions are in the layout's units.
 */
export function layoutPlacements(graph: KnowledgeGraph, seed: number): Placement[] {
  const laid = layoutGraph({ graph, agents: [], memories: [], seed }, false);
  return tameOutliers(
    laid.nodes.map((node) => ({ id: node.referenceId, x: node.x ?? 0, y: node.y ?? 0 })),
  );
}

function sharesOf(
  sourceIds: readonly string[],
  passages: PassageIndex | null,
  documentOrder: readonly string[],
): NodeShare[] {
  const counts = new Map<string, number>();
  for (const id of sourceIds) {
    const passage = findPassage(passages, id);
    if (passage) counts.set(passage.documentId, (counts.get(passage.documentId) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const rank = (id: string) => {
    const at = documentOrder.indexOf(id);
    return at < 0 ? Number.MAX_SAFE_INTEGER : at;
  };
  return [...counts.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([documentId, count]) => ({ documentId, count, share: total ? count / total : 0 }));
}

export function buildGraphView(
  graph: KnowledgeGraph,
  placements: readonly Placement[],
  passages: PassageIndex | null,
  documentOrder: readonly string[],
): GraphView {
  const at = new Map(placements.map((placement) => [placement.id, placement]));
  const nodes: GraphNode[] = graph.nodes.map((node, index) => {
    const sourceIds = uniquePassageIds(node.sourceIds);
    const shares = sharesOf(sourceIds, passages, documentOrder);
    const place = at.get(node.id);
    return {
      id: node.id,
      index,
      label: node.label,
      kind: node.kind,
      type: node.entityType?.trim() || KIND_LABELS[node.kind],
      summary: node.summary,
      weight: clamp01(node.weight),
      quote: node.quote?.trim() || null,
      sourceIds,
      documentIds: shares.map((share) => share.documentId),
      shares,
      x: place?.x ?? 0,
      y: place?.y ?? 0,
      radius: nodeRadius(node.weight),
    };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges: GraphEdge[] = [];
  const neighbours = new Map<string, Set<string>>();
  const edgesOf = new Map<string, number[]>();
  graph.edges.forEach((edge, index) => {
    if (!byId.has(edge.source) || !byId.has(edge.target)) return;
    const sourceIds = uniquePassageIds(edge.sourceIds);
    edges.push({
      index,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      weight: clamp01(edge.weight),
      sourceIds,
      documentIds: sharesOf(sourceIds, passages, documentOrder).map((share) => share.documentId),
    });
    for (const [from, to] of [
      [edge.source, edge.target],
      [edge.target, edge.source],
    ] as const) {
      (neighbours.get(from) ?? neighbours.set(from, new Set()).get(from)!).add(to);
      (edgesOf.get(from) ?? edgesOf.set(from, []).get(from)!).push(index);
    }
  });
  const types = new Map<string, TypeInfo>();
  for (const node of nodes) {
    const known = types.get(node.type);
    if (known) known.count += 1;
    else types.set(node.type, { type: node.type, kind: node.kind, count: 1 });
  }
  return {
    method: graph.method,
    notes: graph.notes,
    nodes,
    edges,
    types: [...types.values()].sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    byId,
    neighbours,
    edgesOf,
  };
}

// ---- The view of it: fitted, panned, zoomed ----------------------------------------------------------

export interface Viewport {
  /** Pixels per layout unit. */
  k: number;
  x: number;
  y: number;
  /** How much wider than tall the layout is drawn, so that a wide space is used. */
  stretch: number;
}

export const ZOOM_MIN = 0.35;
export const ZOOM_MAX = 7;

export const clampZoom = (k: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, k));

export interface Inset {
  x: number;
  top: number;
  bottom: number;
  /** Extra room kept clear on the right, for a card that floats over the graph. */
  right?: number;
}

/** Fits the nodes into a space of `width` × `height` pixels, leaving room for their size and labels. */
export function fitViewport(
  nodes: readonly Pick<GraphNode, 'x' | 'y' | 'radius'>[],
  width: number,
  height: number,
  inset: Inset = { x: 56, top: 44, bottom: 64 },
): Viewport {
  if (nodes.length === 0 || width <= 0 || height <= 0)
    return { k: 1, x: width / 2, y: height / 2, stretch: 1 };
  const xs = nodes.map((node) => node.x);
  const ys = nodes.map((node) => node.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const boxWidth = Math.max(60, right - left);
  const boxHeight = Math.max(60, bottom - top);
  const clearRight = inset.right ?? 0;
  const roomWidth = Math.max(80, width - 2 * inset.x - clearRight);
  const roomHeight = Math.max(80, height - inset.top - inset.bottom);
  // A wide space gets a wider drawing, up to a point, so that a graph is not a column in the middle of it. A
  // graph of a few nodes is not stretched, and is kept close: two topics are not spread across the room.
  const few = nodes.length <= 4;
  const stretch = few
    ? 1
    : Math.min(1.9, Math.max(1, roomWidth / roomHeight / (boxWidth / boxHeight)));
  const reach = few ? 120 * nodes.length : Number.POSITIVE_INFINITY;
  const k = Math.min(
    4.2,
    roomWidth / (boxWidth * stretch),
    roomHeight / boxHeight,
    reach / Math.max(boxWidth * stretch, boxHeight),
  );
  return {
    k,
    stretch,
    x: inset.x + roomWidth / 2 - ((left + right) / 2) * stretch * k,
    y: inset.top + roomHeight / 2 - ((top + bottom) / 2) * k,
  };
}

export const screenX = (node: Pick<GraphNode, 'x'>, view: Viewport): number =>
  node.x * view.stretch * view.k + view.x;
export const screenY = (node: Pick<GraphNode, 'y'>, view: Viewport): number =>
  node.y * view.k + view.y;

/** Zooms about a point of the space (the pointer, or its centre) so that the point stays where it is. */
export function zoomAbout(view: Viewport, factor: number, px: number, py: number): Viewport {
  const k = clampZoom(view.k * factor);
  const ratio = k / view.k;
  return { ...view, k, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio };
}

// ---- Links drawn as curves --------------------------------------------------------------------------

/** A gentle curve between two points; `bend` bows it, and its sign says to which side. */
export function curvePath(ax: number, ay: number, bx: number, by: number, bend: number): string {
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const cx = mx - dy * bend;
  const cy = my + dx * bend;
  return `M${ax.toFixed(1)},${ay.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${bx.toFixed(1)},${by.toFixed(1)}`;
}

/** The ring around a topic: one arc for each document that cites it, in its length. */
export function ringArcs(
  shares: readonly NodeShare[],
  radius: number,
  gap = 2.4,
): { documentId: string; d: string; full: boolean }[] {
  if (shares.length === 0) return [];
  if (shares.length === 1) return [{ documentId: shares[0]!.documentId, d: '', full: true }];
  const turn = Math.PI * 2;
  const usable = turn - shares.length * (gap / radius);
  let angle = -Math.PI / 2;
  return shares.map((share) => {
    const start = angle + gap / radius / 2;
    const end = start + usable * share.share;
    angle += usable * share.share + gap / radius;
    const large = end - start > Math.PI ? 1 : 0;
    const point = (theta: number) =>
      `${(Math.cos(theta) * radius).toFixed(2)},${(Math.sin(theta) * radius).toFixed(2)}`;
    return {
      documentId: share.documentId,
      d: `M${point(start)} A${radius},${radius} 0 ${large} 1 ${point(end)}`,
      full: false,
    };
  });
}

// ---- Filtering and highlighting --------------------------------------------------------------------

export interface GraphFilter {
  hiddenTypes: ReadonlySet<string>;
  /** Links weaker than this are left out; 0 keeps them all. */
  minWeight: number;
}

export const NO_GRAPH_FILTER: GraphFilter = { hiddenTypes: new Set(), minWeight: 0 };

export function visibleNodeIds(view: GraphView, filter: GraphFilter): Set<string> {
  return new Set(
    view.nodes.filter((node) => !filter.hiddenTypes.has(node.type)).map((node) => node.id),
  );
}

export function visibleEdgeIndexes(
  view: GraphView,
  visible: ReadonlySet<string>,
  filter: GraphFilter,
): Set<number> {
  return new Set(
    view.edges
      .filter(
        (edge) =>
          visible.has(edge.source) && visible.has(edge.target) && edge.weight >= filter.minWeight,
      )
      .map((edge) => edge.index),
  );
}

/** The strongest and weakest link weights, to bound the slider that leaves the weak ones out. */
export function weightRange(view: GraphView): { min: number; max: number } {
  if (view.edges.length === 0) return { min: 0, max: 1 };
  const weights = view.edges.map((edge) => edge.weight);
  return { min: Math.min(...weights), max: Math.max(...weights) };
}

/** What a hover, a focus or a selection points at, as the things that should light up with it. */
export interface Focus {
  node?: string | null;
  edge?: number | null;
  passage?: string | null;
  document?: string | null;
  conflict?: string | null;
}

export interface Lit {
  active: boolean;
  nodes: Set<string>;
  /** Next to a lit node: lit more quietly. */
  related: Set<string>;
  edges: Set<number>;
  passages: Set<string>;
  documents: Set<string>;
  conflicts: Set<string>;
}

export const NO_LIT: Lit = {
  active: false,
  nodes: new Set(),
  related: new Set(),
  edges: new Set(),
  passages: new Set(),
  documents: new Set(),
  conflicts: new Set(),
};

/**
 * Where the things that rest on one another meet. A topic rests on the passages it cites, a passage sits in
 * a document, two passages can conflict: point at one and the others it depends on or is touched by light up.
 */
export function deriveLit(
  focus: Focus,
  view: GraphView | null,
  passages: PassageIndex | null,
  conflicts: readonly ContradictionRecord[],
): Lit {
  const lit: Lit = {
    active: false,
    nodes: new Set(),
    related: new Set(),
    edges: new Set(),
    passages: new Set(),
    documents: new Set(),
    conflicts: new Set(),
  };
  const addPassage = (id: string) => {
    lit.passages.add(id);
    const passage = findPassage(passages, id);
    if (passage) lit.documents.add(passage.documentId);
  };
  const addNodesCiting = (ids: ReadonlySet<string>) => {
    for (const node of view?.nodes ?? [])
      if (node.sourceIds.some((id) => ids.has(id))) lit.nodes.add(node.id);
  };
  const addConflictsTouching = (ids: ReadonlySet<string>) => {
    for (const conflict of conflicts) {
      if (ids.has(conflict.left.passageId) || ids.has(conflict.right.passageId))
        lit.conflicts.add(conflict.id);
    }
  };

  if (focus.node && view?.byId.has(focus.node)) {
    const node = view.byId.get(focus.node)!;
    lit.active = true;
    lit.nodes.add(node.id);
    for (const other of view.neighbours.get(node.id) ?? []) lit.related.add(other);
    for (const index of view.edgesOf.get(node.id) ?? []) lit.edges.add(index);
    for (const id of node.sourceIds) addPassage(id);
    addConflictsTouching(lit.passages);
  } else if (focus.edge !== null && focus.edge !== undefined && view) {
    const edge = view.edges.find((item) => item.index === focus.edge);
    if (edge) {
      lit.active = true;
      lit.nodes.add(edge.source).add(edge.target);
      lit.edges.add(edge.index);
      for (const id of edge.sourceIds) addPassage(id);
      addConflictsTouching(lit.passages);
    }
  } else if (focus.conflict) {
    const conflict = conflicts.find((item) => item.id === focus.conflict);
    if (conflict) {
      lit.active = true;
      lit.conflicts.add(conflict.id);
      addPassage(conflict.left.passageId);
      addPassage(conflict.right.passageId);
      lit.documents.add(conflict.left.documentId).add(conflict.right.documentId);
      addNodesCiting(lit.passages);
    }
  } else if (focus.passage) {
    lit.active = true;
    addPassage(focus.passage);
    addNodesCiting(lit.passages);
    addConflictsTouching(lit.passages);
  } else if (focus.document) {
    lit.active = true;
    lit.documents.add(focus.document);
    for (const passage of passages?.byDocument.get(focus.document) ?? [])
      lit.passages.add(passage.id);
    addNodesCiting(lit.passages);
    addConflictsTouching(lit.passages);
  }
  return lit;
}

/** Nodes in the order a keyboard moves through them: by weight, strongest first, then by name. */
export function keyboardOrder(nodes: readonly GraphNode[]): string[] {
  return [...nodes]
    .sort(
      (a, b) => b.weight - a.weight || a.label.localeCompare(b.label) || a.id.localeCompare(b.id),
    )
    .map((node) => node.id);
}

/** Labels that will not collide, as the engine's own rule chooses them. Re-exported for the canvas. */
export { cycleGraphNode, visibleLabelIds } from '../../lib/graph';
export type { LabelCandidate } from '../../lib/graph';
