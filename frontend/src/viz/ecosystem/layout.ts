import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import type { SimulationNodeDatum } from 'd3-force';

export interface LayoutNodeInput {
  id: string;
  cluster: string;
  /** 0 to 1: how much the node matters, which is its size. */
  weight: number;
}

export interface LayoutEdgeInput {
  from: string;
  to: string;
  strength: number;
}

export interface LayoutInput {
  nodes: readonly LayoutNodeInput[];
  edges: readonly LayoutEdgeInput[];
  width: number;
  height: number;
  /** The largest size of a node, in pixels per unit of weight: the layout uses it when the canvas has the room. */
  scale?: number;
  /** The smallest size it will shrink to when the canvas is crowded. */
  minScale?: number;
  /** Room kept free at the edges (for controls and labels). */
  inset?: { top?: number; right?: number; bottom?: number; left?: number };
}

export interface ClusterInfo {
  id: string;
  x: number;
  y: number;
  radius: number;
  ids: string[];
}

export interface Layout {
  positions: Map<string, { x: number; y: number }>;
  radii: Map<string, number>;
  clusters: ClusterInfo[];
  /** The size the nodes were drawn at. */
  scale: number;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/** The size of a node in pixels, from how much it matters. */
export function radiusOf(weight: number, scale = 1): number {
  return (7 + 15 * Math.sqrt(clamp(weight, 0, 1))) * scale;
}

/** A small deterministic generator: the same map is drawn every time, so that it can be learned. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4_294_967_296;
  };
}

function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

interface Body extends SimulationNodeDatum {
  id: string;
  cluster: string;
  radius: number;
  ax: number;
  ay: number;
}

interface Solved {
  positions: Map<string, { x: number; y: number }>;
  radii: Map<string, number>;
  clusters: ClusterInfo[];
  /** The box the nodes fill, before it is fitted to the canvas. */
  width: number;
  height: number;
  scale: number;
}

interface ClusterBody extends SimulationNodeDatum {
  id: string;
  radius: number;
  x: number;
  y: number;
}

/**
 * Where each group sits: a circle for each, sized by what it holds, pushed apart so that none touches another
 * and pulled together by the relations between their members and by a weak pull to the middle. The result is a
 * compact arrangement in which the large groups are near the centre, whatever the number of groups.
 */
function placeClusters(
  groups: ReadonlyMap<string, readonly LayoutNodeInput[]>,
  order: readonly string[],
  scale: number,
  edges: readonly LayoutEdgeInput[],
  centre: { x: number; y: number },
  aspect: number,
): Map<string, { x: number; y: number; radius: number }> {
  const clusterOf = new Map<string, string>();
  for (const [key, members] of groups) for (const node of members) clusterOf.set(node.id, key);
  const bodies: ClusterBody[] = order.map((key, index) => {
    const members = groups.get(key)!;
    const radius =
      Math.sqrt(
        members.reduce((sum, node) => sum + (radiusOf(node.weight, scale) + 6 * scale) ** 2, 0),
      ) *
        1.18 +
      12 * scale;
    const angle = index * 2.399963;
    const reach = (index === 0 ? 0 : 34 + 46 * Math.sqrt(index)) * scale;
    return {
      id: key,
      radius,
      x: centre.x + Math.cos(angle) * reach,
      y: centre.y + Math.sin(angle) * reach * 0.8,
    };
  });
  const between = new Map<string, number>();
  for (const edge of edges) {
    const a = clusterOf.get(edge.from);
    const b = clusterOf.get(edge.to);
    if (!a || !b || a === b) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    between.set(key, (between.get(key) ?? 0) + clamp(edge.strength, 0, 1));
  }
  const links = [...between].map(([key, weight]) => {
    const [source, target] = key.split('|') as [string, string];
    return { source, target, weight };
  });
  const byId = new Map(bodies.map((body) => [body.id, body]));
  forceSimulation<ClusterBody>(bodies)
    .stop()
    .randomSource(generator(104729))
    .force(
      'link',
      forceLink<ClusterBody, (typeof links)[number]>(links)
        .id((body) => body.id)
        .distance(
          (link) =>
            (byId.get(link.source as unknown as string)?.radius ?? 40) +
            (byId.get(link.target as unknown as string)?.radius ?? 40) +
            26 * scale,
        )
        .strength((link) => Math.min(0.22, 0.03 + link.weight * 0.035)),
    )
    .force(
      'collide',
      forceCollide<ClusterBody>()
        .radius((body) => body.radius + 14 * scale)
        .strength(1)
        .iterations(3),
    )
    .force('x', forceX<ClusterBody>(centre.x).strength(0.05 / aspect))
    .force('y', forceY<ClusterBody>(centre.y).strength(0.05 * aspect))
    .tick(280);
  return new Map(bodies.map((body) => [body.id, { x: body.x, y: body.y, radius: body.radius }]));
}

/**
 * The groups come out of the packing as a compact heap whatever the canvas is. On a canvas that is much wider
 * than the heap (or much taller) they are drawn apart along the long side, part of the way to its shape, so that
 * the picture fills the screen it is on and the nodes can be larger. Only ever moves groups further apart.
 */
function spreadToCanvas(
  anchors: Map<string, { x: number; y: number; radius: number }>,
  centre: { x: number; y: number },
  canvasAspect: number,
): void {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const anchor of anchors.values()) {
    minX = Math.min(minX, anchor.x - anchor.radius);
    maxX = Math.max(maxX, anchor.x + anchor.radius);
    minY = Math.min(minY, anchor.y - anchor.radius);
    maxY = Math.max(maxY, anchor.y + anchor.radius);
  }
  const heap = (maxX - minX) / Math.max(maxY - minY, 1);
  const wanted = clamp(canvasAspect, 0.45, 2.4);
  const ratio = wanted / Math.max(heap, 0.01);
  const alongX = ratio >= 1;
  const stretch = clamp(1 + ((alongX ? ratio : 1 / ratio) - 1) * 0.6, 1, 1.7);
  if (stretch <= 1.001) return;
  for (const anchor of anchors.values()) {
    if (alongX) anchor.x = centre.x + (anchor.x - centre.x) * stretch;
    else anchor.y = centre.y + (anchor.y - centre.y) * stretch;
  }
}

/** One pass of the layout at one node scale. */
function solve(
  input: LayoutInput,
  groups: ReadonlyMap<string, readonly LayoutNodeInput[]>,
  order: readonly string[],
  scale: number,
): Solved {
  const cx =
    (input.width - (input.inset?.left ?? 0) - (input.inset?.right ?? 0)) / 2 +
    (input.inset?.left ?? 0);
  const cy =
    (input.height - (input.inset?.top ?? 0) - (input.inset?.bottom ?? 0)) / 2 +
    (input.inset?.top ?? 0);
  const areaWidth = input.width - (input.inset?.left ?? 0) - (input.inset?.right ?? 0);
  const areaHeight = input.height - (input.inset?.top ?? 0) - (input.inset?.bottom ?? 0);
  const aspect = clamp(areaWidth / Math.max(areaHeight, 1), 1, 2.4);
  const anchors = placeClusters(groups, order, scale, input.edges, { x: cx, y: cy }, aspect);
  spreadToCanvas(anchors, { x: cx, y: cy }, areaWidth / Math.max(areaHeight, 1));

  const bodies: Body[] = input.nodes.map((node) => {
    const anchor = anchors.get(node.cluster)!;
    const random = generator(hash(node.id));
    const angle = random() * Math.PI * 2;
    const spread = 10 + random() * Math.max(anchor.radius * 0.6, 20);
    return {
      id: node.id,
      cluster: node.cluster,
      radius: radiusOf(node.weight, scale),
      ax: anchor.x,
      ay: anchor.y,
      x: anchor.x + Math.cos(angle) * spread,
      y: anchor.y + Math.sin(angle) * spread,
    };
  });
  const byId = new Map(bodies.map((body) => [body.id, body]));
  const links = input.edges
    .filter((edge) => byId.has(edge.from) && byId.has(edge.to) && edge.from !== edge.to)
    .map((edge) => ({ source: edge.from, target: edge.to, strength: clamp(edge.strength, 0, 1) }));

  forceSimulation<Body>(bodies)
    .stop()
    .randomSource(generator(7919))
    .force(
      'link',
      forceLink<Body, (typeof links)[number]>(links)
        .id((body) => body.id)
        .distance((link) => (44 + (1 - link.strength) * 60) * scale)
        .strength((link) => 0.02 + link.strength * 0.08),
    )
    .force(
      'charge',
      forceManyBody<Body>()
        .strength((body) => -(10 + body.radius * 2.4))
        .distanceMax(200 * scale),
    )
    .force(
      'collide',
      forceCollide<Body>()
        .radius((body) => body.radius + 7 * scale)
        .strength(0.95)
        .iterations(2),
    )
    .force('x', forceX<Body>((body) => body.ax).strength(0.22))
    .force('y', forceY<Body>((body) => body.ay).strength(0.22))
    .tick(300);

  // Settle any overlap the forces left.
  for (let pass = 0; pass < 80; pass += 1) {
    let moved = false;
    for (let a = 0; a < bodies.length; a += 1) {
      for (let b = a + 1; b < bodies.length; b += 1) {
        const p = bodies[a]!;
        const q = bodies[b]!;
        const dx = q.x! - p.x!;
        const dy = q.y! - p.y!;
        const gap = p.radius + q.radius + 12 * scale;
        const distance = Math.hypot(dx, dy) || 0.001;
        if (distance < gap) {
          const push = (gap - distance) / 2;
          const ux = dx / distance;
          const uy = dy / distance;
          p.x! -= ux * push;
          p.y! -= uy * push;
          q.x! += ux * push;
          q.y! += uy * push;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const body of bodies) {
    minX = Math.min(minX, body.x! - body.radius);
    maxX = Math.max(maxX, body.x! + body.radius);
    minY = Math.min(minY, body.y! - body.radius);
    maxY = Math.max(maxY, body.y! + body.radius);
  }
  const positions = new Map<string, { x: number; y: number }>();
  const radii = new Map<string, number>();
  const mx = (minX + maxX) / 2;
  const my = (minY + maxY) / 2;
  for (const body of bodies) {
    positions.set(body.id, { x: body.x! - mx, y: body.y! - my });
    radii.set(body.id, body.radius);
  }
  const clusters: ClusterInfo[] = order.map((key) => {
    const members = groups.get(key)!;
    const x = members.reduce((sum, node) => sum + positions.get(node.id)!.x, 0) / members.length;
    const y = members.reduce((sum, node) => sum + positions.get(node.id)!.y, 0) / members.length;
    const reach = Math.max(
      ...members.map(
        (node) =>
          Math.hypot(positions.get(node.id)!.x - x, positions.get(node.id)!.y - y) +
          radii.get(node.id)!,
      ),
    );
    return { id: key, x, y, radius: reach + 22 * scale, ids: members.map((node) => node.id) };
  });
  return { positions, radii, clusters, width: maxX - minX, height: maxY - minY, scale };
}

/**
 * Places a set of nodes so that kinds gather, strong relations draw close, and nothing overlaps. Groups are
 * packed first, then each node is settled inside its group by a force simulation run to rest in one go from a
 * start that depends only on the ids: the same set on the same canvas always gives the same picture, and a
 * map that has been looked at once is recognised the next time. The nodes are as large as the canvas allows,
 * up to `scale` (or as small as `minScale` when it is crowded). Positions are in pixels from the top left.
 */
export function layoutEcosystem(input: LayoutInput): Layout {
  const { width, height } = input;
  const maxScale = input.scale ?? 1;
  const minScale = Math.min(input.minScale ?? maxScale * 0.55, maxScale);
  const inset = { top: 0, right: 0, bottom: 0, left: 0, ...input.inset };
  const area = {
    left: inset.left,
    top: inset.top,
    width: Math.max(width - inset.left - inset.right, 1),
    height: Math.max(height - inset.top - inset.bottom, 1),
  };
  const positions = new Map<string, { x: number; y: number }>();
  const radii = new Map<string, number>();
  if (input.nodes.length === 0) return { positions, radii, clusters: [], scale: maxScale };

  const groups = new Map<string, LayoutNodeInput[]>();
  for (const node of input.nodes) {
    const list = groups.get(node.cluster);
    if (list) list.push(node);
    else groups.set(node.cluster, [node]);
  }
  const order = [...groups.keys()].sort(
    (left, right) =>
      groups.get(right)!.length - groups.get(left)!.length || left.localeCompare(right),
  );

  // The largest scale at which the picture fits the canvas as it is drawn, found by halving the range.
  const margin = 18;
  const fits = (solved: Solved): boolean =>
    solved.width <= area.width - margin * 2 && solved.height <= area.height - margin * 2;
  let best = solve(input, groups, order, minScale);
  if (maxScale > minScale) {
    const top = solve(input, groups, order, maxScale);
    if (fits(top)) best = top;
    else {
      let low = minScale;
      let high = maxScale;
      for (let step = 0; step < 4; step += 1) {
        const mid = (low + high) / 2;
        const solved = solve(input, groups, order, mid);
        if (fits(solved)) {
          best = solved;
          low = mid;
        } else high = mid;
      }
    }
  }

  // Fit what is left into the canvas: only ever shrinks, and only as far as is needed.
  const fit = clamp(
    Math.min(
      (area.width - margin * 2) / Math.max(best.width, 1),
      (area.height - margin * 2) / Math.max(best.height, 1),
    ),
    0.5,
    1,
  );
  const cx = area.left + area.width / 2;
  const cy = area.top + area.height / 2;
  for (const [id, point] of best.positions) {
    const radius = best.radii.get(id)!;
    const x = clamp(
      cx + point.x * fit,
      area.left + radius + 2,
      area.left + area.width - radius - 2,
    );
    const y = clamp(cy + point.y * fit, area.top + radius + 2, area.top + area.height - radius - 2);
    positions.set(id, { x, y });
    radii.set(id, radius);
  }
  // Shrinking can bring nodes into contact: push them apart again, within the canvas.
  const ids = [...positions.keys()];
  for (let pass = 0; pass < 60; pass += 1) {
    let moved = false;
    for (let a = 0; a < ids.length; a += 1) {
      for (let b = a + 1; b < ids.length; b += 1) {
        const p = positions.get(ids[a]!)!;
        const q = positions.get(ids[b]!)!;
        const gap = radii.get(ids[a]!)! + radii.get(ids[b]!)! + 2;
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const distance = Math.hypot(dx, dy) || 0.001;
        if (distance < gap) {
          const push = (gap - distance) / 2;
          p.x -= (dx / distance) * push;
          p.y -= (dy / distance) * push;
          q.x += (dx / distance) * push;
          q.y += (dy / distance) * push;
          moved = true;
        }
      }
    }
    for (const id of ids) {
      const p = positions.get(id)!;
      const r = radii.get(id)!;
      p.x = clamp(p.x, area.left + r + 2, area.left + area.width - r - 2);
      p.y = clamp(p.y, area.top + r + 2, area.top + area.height - r - 2);
    }
    if (!moved) break;
  }

  const clusters: ClusterInfo[] = order.map((key) => {
    const members = groups.get(key)!;
    const x = members.reduce((sum, node) => sum + positions.get(node.id)!.x, 0) / members.length;
    const y = members.reduce((sum, node) => sum + positions.get(node.id)!.y, 0) / members.length;
    const reach = Math.max(
      ...members.map(
        (node) =>
          Math.hypot(positions.get(node.id)!.x - x, positions.get(node.id)!.y - y) +
          radii.get(node.id)!,
      ),
    );
    return { id: key, x, y, radius: reach + 22 * best.scale, ids: members.map((node) => node.id) };
  });
  return { positions, radii, clusters, scale: best.scale };
}

/** The node nearest to `from` in a direction, or null: how arrow keys move between nodes. */
export function nearestInDirection(
  from: { x: number; y: number },
  candidates: readonly { id: string; x: number; y: number }[],
  direction: 'left' | 'right' | 'up' | 'down',
): string | null {
  let best: { id: string; score: number } | null = null;
  for (const candidate of candidates) {
    const dx = candidate.x - from.x;
    const dy = candidate.y - from.y;
    const along =
      direction === 'right' ? dx : direction === 'left' ? -dx : direction === 'down' ? dy : -dy;
    if (along <= 1) continue;
    const across = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
    // Only what lies within a cone of the way the key points: a node beside you is not "below" you.
    if (across > along * 2.5) continue;
    const score = along + across * 2.2;
    if (!best || score < best.score) best = { id: candidate.id, score };
  }
  return best?.id ?? null;
}
