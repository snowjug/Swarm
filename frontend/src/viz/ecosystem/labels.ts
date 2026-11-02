import type { Layout } from './layout';

export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const touches = (a: Box, b: Box): boolean =>
  a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

const touchesCircle = (
  box: Box,
  circle: { x: number; y: number; r: number },
  margin = 0,
): boolean =>
  circle.x + circle.r + margin > box.x0 &&
  circle.x - circle.r - margin < box.x1 &&
  circle.y + circle.r + margin > box.y0 &&
  circle.y - circle.r - margin < box.y1;

export type LabelSide = 'below' | 'above' | 'right' | 'left';

const SIDES: readonly LabelSide[] = ['below', 'above', 'right', 'left'];

/** Where the camera is looking: a zoom and where the picture sits on the canvas, in pixels. */
export interface View {
  k: number;
  x: number;
  y: number;
}

const IDENTITY: View = { k: 1, x: 0, y: 0 };

/** The part of the canvas a name may stand in: what is left once what floats over the picture is taken away. */
export interface Bounds {
  left: number;
  right: number;
  top?: number;
  bottom?: number;
}

/** A line in the picture's own units: a relation that a name should keep off. */
export interface Segment {
  from: { x: number; y: number };
  to: { x: number; y: number };
}

/** How wide a name stands on the screen, in pixels: the characters it shows, and a little air. A heavier name is wider. */
const widthOf = (label: string, bold = false): number =>
  Math.min(label.length, 24) * (bold ? 7.1 : 6.6) + 10;

/** The room a name takes on each side of its node, and how far from the node's edge it starts. */
const SIDE_SPACE: Record<LabelSide, { height: number; gap: number }> = {
  below: { height: 18, gap: 3 },
  above: { height: 18, gap: 3 },
  right: { height: 20, gap: 4 },
  left: { height: 20, gap: 4 },
};

/**
 * The box a name of this width fills on one side of a node, on the screen. A name is the same size at any zoom:
 * only the distance from the node, which is the node's size on the screen, changes with it.
 */
function boxOf(
  point: { x: number; y: number },
  radius: number,
  width: number,
  side: LabelSide,
): Box {
  const { height, gap } = SIDE_SPACE[side];
  switch (side) {
    case 'above':
      return {
        x0: point.x - width / 2,
        x1: point.x + width / 2,
        y0: point.y - radius - gap - height,
        y1: point.y - radius - gap,
      };
    case 'right':
      return {
        x0: point.x + radius + gap,
        x1: point.x + radius + gap + width,
        y0: point.y - height / 2,
        y1: point.y + height / 2,
      };
    case 'left':
      return {
        x0: point.x - radius - gap - width,
        x1: point.x - radius - gap,
        y0: point.y - height / 2,
        y1: point.y + height / 2,
      };
    default:
      return {
        x0: point.x - width / 2,
        x1: point.x + width / 2,
        y0: point.y + radius + gap,
        y1: point.y + radius + gap + height,
      };
  }
}

function nameBox(
  point: { x: number; y: number },
  radius: number,
  label: string,
  side: LabelSide = 'below',
  bold = false,
): Box {
  return boxOf(point, radius, widthOf(label, bold), side);
}

/** Every node as a circle on the screen: where the camera has put it, and as large as the camera makes it. */
function circlesOnScreen(
  nodes: readonly { id: string }[],
  layout: Layout,
  view: View,
): { id: string; x: number; y: number; r: number }[] {
  return nodes.flatMap((node) => {
    const point = layout.positions.get(node.id);
    if (!point) return [];
    return [
      {
        id: node.id,
        x: point.x * view.k + view.x,
        y: point.y * view.k + view.y,
        r: (layout.radii.get(node.id) ?? 8) * view.k,
      },
    ];
  });
}

/** Whether a straight line crosses a box (relations are drawn as gentle curves: a chord is near enough). */
function crosses(box: Box, a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  if (Math.max(a.x, b.x) < box.x0 || Math.min(a.x, b.x) > box.x1) return false;
  if (Math.max(a.y, b.y) < box.y0 || Math.min(a.y, b.y) > box.y1) return false;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // With all four corners on one side of the line, it passes by.
  const side = (x: number, y: number) => dx * (y - a.y) - dy * (x - a.x);
  const corners = [
    side(box.x0, box.y0),
    side(box.x1, box.y0),
    side(box.x0, box.y1),
    side(box.x1, box.y1),
  ];
  return !(corners.every((value) => value > 0) || corners.every((value) => value < 0));
}

export interface ClusterLabelSpot {
  /** From the middle of the group to the middle of the baseline of its name, in pixels on the screen. */
  dx: number;
  dy: number;
  /** Where the name stands on the screen, for the view it was placed for. */
  box: Box;
}

export interface ClusterLabelOptions {
  /** Rectangles on the screen that a name must stay out of (what floats over the picture). */
  avoid?: readonly Box[];
  /** Relations, in the picture's units: a name prefers a place that no line runs through. */
  segments?: readonly Segment[];
  /**
   * A name that has no place of its own is left out, instead of being written over a node, another name or the
   * edge of the canvas. Without it the least bad place is taken.
   */
  strict?: boolean;
}

/** The gap between a group and its name, and from one line of names to the next. */
const GAP = 10;

/**
 * Where each group's name goes: above or below the group, on whichever side nothing is in the way, with the
 * largest groups choosing first. A name stands close to the group's own nodes (their edge, not the soft light
 * around them), never sits over a node, another group's name or what floats over the picture, and does not leave
 * the canvas. It is worked out on the screen, where the camera has put the picture (`view`), because that is where
 * the name is drawn: the same size at any zoom.
 */
export function placeClusterLabels(
  nodes: readonly { id: string; label: string }[],
  layout: Layout,
  nameOf: (cluster: string) => string,
  canvas: { left: number; top: number; right: number; bottom: number },
  view: View = IDENTITY,
  options: ClusterLabelOptions = {},
): Map<string, ClusterLabelSpot> {
  const circles = circlesOnScreen(nodes, layout, view);
  const byId = new Map(circles.map((circle) => [circle.id, circle]));
  const names = nodes.flatMap((node) => {
    const circle = byId.get(node.id);
    return circle ? [nameBox(circle, circle.r, node.label)] : [];
  });
  const lines = (options.segments ?? []).map((segment) => ({
    from: { x: segment.from.x * view.k + view.x, y: segment.from.y * view.k + view.y },
    to: { x: segment.to.x * view.k + view.x, y: segment.to.y * view.k + view.y },
  }));
  const avoid = options.avoid ?? [];
  const placed: Box[] = [];
  const spots = new Map<string, ClusterLabelSpot>();
  const ordered = [...layout.clusters].sort(
    (a, b) => b.ids.length - a.ids.length || a.id.localeCompare(b.id),
  );
  for (const cluster of ordered) {
    const members = cluster.ids.flatMap((id) => {
      const circle = byId.get(id);
      return circle ? [circle] : [];
    });
    if (members.length === 0) continue;
    // The name, and the dot in the group's colour that stands before it.
    const width = nameOf(cluster.id).length * 8.4 + 26;
    const centre = { x: cluster.x * view.k + view.x, y: cluster.y * view.k + view.y };
    const hull = {
      x0: Math.min(...members.map((circle) => circle.x - circle.r)),
      x1: Math.max(...members.map((circle) => circle.x + circle.r)),
      y0: Math.min(...members.map((circle) => circle.y - circle.r)),
      y1: Math.max(...members.map((circle) => circle.y + circle.r)),
    };
    const middle = (hull.x0 + hull.x1) / 2;
    const level = (hull.y0 + hull.y1) / 2 + 4;
    const above = hull.y0 - GAP;
    const below = hull.y1 + GAP + 12;
    // In the order a person would look for it: over the group, under it, then beside it.
    const candidates: { x: number; y: number }[] = [
      { x: middle, y: above },
      { x: hull.x0 + width / 2, y: above },
      { x: hull.x1 - width / 2, y: above },
      { x: middle, y: below },
      { x: hull.x0 + width / 2, y: below },
      { x: hull.x1 - width / 2, y: below },
      { x: middle, y: above - 18 },
      { x: middle, y: below + 18 },
      { x: hull.x0 - GAP - width / 2, y: level },
      { x: hull.x1 + GAP + width / 2, y: level },
    ];
    let best: { score: number; hard: number; spot: ClusterLabelSpot } | null = null;
    candidates.forEach((candidate, rank) => {
      // A name near the edge of the canvas slides inward, as far as it must, rather than leaving it.
      const over = Math.max(0, canvas.left - (candidate.x - width / 2));
      const under = Math.max(0, candidate.x + width / 2 - canvas.right);
      const x = candidate.x + over - under;
      const y = candidate.y;
      const box: Box = { x0: x - width / 2, x1: x + width / 2, y0: y - 13, y1: y + 5 };
      let hard = 0;
      for (const circle of circles) if (touchesCircle(box, circle, 3)) hard += 1;
      for (const other of placed) if (touches(box, other)) hard += 1;
      for (const block of avoid) if (touches(box, block)) hard += 1;
      if (box.x0 < canvas.left || box.x1 > canvas.right) hard += 1;
      if (box.y0 < canvas.top || box.y1 > canvas.bottom) hard += 1;
      let soft = 0;
      for (const name of names) if (touches(box, name)) soft += 1;
      for (const line of lines) if (crosses(box, line.from, line.to)) soft += 0.4;
      const score = hard * 100 + soft * 4 + rank * 0.6;
      if (!best || score < best.score) {
        best = { score, hard, spot: { dx: x - centre.x, dy: y - centre.y, box } };
      }
    });
    const chosen = best as { score: number; hard: number; spot: ClusterLabelSpot } | null;
    if (!chosen || (options.strict && chosen.hard > 0)) continue;
    placed.push(chosen.spot.box);
    spots.set(cluster.id, chosen.spot);
  }
  return spots;
}

/** A node as the allocation of names sees it. */
export interface NamedNode {
  id: string;
  label: string;
  weight: number;
  /**
   * A key party is always given a name: its place is chosen before any other's (a group's name or a cohort's), and
   * is found however crowded the picture is, by moving the name along its node or off it, with a line to join them.
   */
  key?: boolean;
}

/** Where a name stands: on a side of its node, and moved along or away from that side when its own place is taken. */
export interface NamePlace {
  side: LabelSide;
  /** Pixels on the screen from where a name on that side would stand. */
  dx: number;
  dy: number;
  /** How wide the name is on the screen, in pixels. */
  width: number;
  /** Where the name stands on the screen, for the view it was placed for. */
  box: Box;
  /** A name that stands off its node is joined to it by a short line. */
  leader: boolean;
}

/** A name this far from the edge of its node (or more) is joined to it: nearer, it is plainly the node's. */
const LEADER_FROM = 9;
/** Where the line that joins a name to its node starts, past the ring that is drawn round the node. */
const LEADER_START = 7;

const shifted = (box: Box, dx: number, dy: number): Box => ({
  x0: box.x0 + dx,
  x1: box.x1 + dx,
  y0: box.y0 + dy,
  y1: box.y1 + dy,
});

/**
 * The short line that joins a name to its node, in pixels from the node's middle: from past the node's ring to the
 * nearest point of the name. A name that is close to its node needs none.
 */
export function leaderOf(
  place: Pick<NamePlace, 'side' | 'dx' | 'dy' | 'width'>,
  radius: number,
): { x0: number; y0: number; x1: number; y1: number } | null {
  const box = shifted(boxOf({ x: 0, y: 0 }, radius, place.width, place.side), place.dx, place.dy);
  const x = Math.min(Math.max(0, box.x0), box.x1);
  const y = Math.min(Math.max(0, box.y0), box.y1);
  const distance = Math.hypot(x, y);
  if (distance - radius < LEADER_FROM || distance === 0) return null;
  const from = radius + LEADER_START;
  if (distance <= from) return null;
  return { x0: (x / distance) * from, y0: (y / distance) * from, x1: x, y1: y };
}

/** The directions a name may stand in from its node, in the order a person would look for it, and what each costs. */
const DIRECTIONS: readonly { angle: number; cost: number }[] = [
  { angle: 90, cost: 0 },
  { angle: 270, cost: 1 },
  { angle: 0, cost: 2 },
  { angle: 180, cost: 2.2 },
  { angle: 75, cost: 2.4 },
  { angle: 105, cost: 2.4 },
  { angle: 60, cost: 3 },
  { angle: 120, cost: 3 },
  { angle: 285, cost: 3.2 },
  { angle: 255, cost: 3.2 },
  { angle: 15, cost: 3.4 },
  { angle: 165, cost: 3.4 },
  { angle: 300, cost: 3.6 },
  { angle: 240, cost: 3.6 },
  { angle: 30, cost: 4 },
  { angle: 150, cost: 4 },
  { angle: 345, cost: 4.2 },
  { angle: 195, cost: 4.2 },
  { angle: 330, cost: 4.6 },
  { angle: 210, cost: 4.6 },
];

/** How far past its side's own gap a name may be moved off its node, and what that costs. */
const DISTANCES: readonly { extra: number; cost: number }[] = [
  { extra: 0, cost: 0 },
  { extra: 8, cost: 4 },
  { extra: 16, cost: 8 },
  { extra: 26, cost: 13 },
  { extra: 38, cost: 20 },
];

/** The distance from a point to a segment. */
function distanceToSegment(
  point: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t =
    length === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

export interface KeyNameOptions {
  /** Relations, in the picture's units: a name prefers a place that no line runs through. */
  segments?: readonly Segment[];
  /** Rectangles on the screen that a name keeps out of: what floats over the picture, or a group's name already put there. */
  avoid?: readonly Box[];
}

const screenLines = (segments: readonly Segment[] | undefined, view: View) =>
  (segments ?? []).map((segment) => ({
    from: { x: segment.from.x * view.k + view.x, y: segment.from.y * view.k + view.y },
    to: { x: segment.to.x * view.k + view.x, y: segment.to.y * view.k + view.y },
  }));

/**
 * Where the name of each key party goes. A key party is the one the page counts ("4 key") and the one a person
 * looks for first, so it is named before anything else is: its place is chosen first, and it is never left without
 * one. It goes below its node, then above, then beside it; where those are taken (a crowd, the edge of the canvas,
 * another key's name) it slides along the node, and then stands off it with a short line to join them. It never
 * stands over another name or off the canvas, and keeps off other nodes where there is any place that does.
 */
export function placeKeyNames(
  nodes: readonly NamedNode[],
  layout: Layout,
  canvas: Bounds,
  view: View = IDENTITY,
  options: KeyNameOptions = {},
): Map<string, NamePlace> {
  const circles = circlesOnScreen(nodes, layout, view);
  const where = new Map(circles.map((circle) => [circle.id, circle]));
  const lines = screenLines(options.segments, view);
  const bounds = {
    left: canvas.left,
    right: canvas.right,
    top: canvas.top ?? Number.NEGATIVE_INFINITY,
    bottom: canvas.bottom ?? Number.POSITIVE_INFINITY,
  };
  const placed: Box[] = [...(options.avoid ?? [])];
  const places = new Map<string, NamePlace>();
  const keys = nodes
    .filter((node) => node.key)
    .sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
  for (const node of keys) {
    const circle = where.get(node.id);
    if (!circle) continue;
    // A party that the camera has put off the canvas has nowhere to be named.
    if (
      circle.x + circle.r < bounds.left ||
      circle.x - circle.r > bounds.right ||
      circle.y + circle.r < bounds.top ||
      circle.y - circle.r > bounds.bottom
    ) {
      continue;
    }
    const width = widthOf(node.label, true);
    const others = circles.filter((other) => other.id !== node.id);
    let best: { score: number; place: NamePlace } | null = null;
    for (const direction of DIRECTIONS) {
      const radians = (direction.angle * Math.PI) / 180;
      const ux = Math.cos(radians);
      const uy = Math.sin(radians);
      const side: LabelSide =
        Math.abs(uy) >= Math.abs(ux) - 1e-9
          ? uy > 0
            ? 'below'
            : 'above'
          : ux > 0
            ? 'right'
            : 'left';
      const { height, gap } = SIDE_SPACE[side];
      const own = boxOf(circle, circle.r, width, side);
      for (const distance of DISTANCES) {
        const support = (Math.abs(ux) * width) / 2 + (Math.abs(uy) * height) / 2;
        const reach = circle.r + gap + distance.extra + support;
        const cx = circle.x + ux * reach;
        const cy = circle.y + uy * reach;
        const box: Box = {
          x0: cx - width / 2,
          x1: cx + width / 2,
          y0: cy - height / 2,
          y1: cy + height / 2,
        };
        const dx = cx - (own.x0 + own.x1) / 2;
        const dy = cy - (own.y0 + own.y1) / 2;
        let score = direction.cost + distance.cost;
        const over =
          Math.max(0, bounds.left - box.x0) +
          Math.max(0, box.x1 - bounds.right) +
          Math.max(0, bounds.top - box.y0) +
          Math.max(0, box.y1 - bounds.bottom);
        if (over > 0) score += 5000 + over;
        for (const other of placed) if (touches(box, other)) score += 800;
        for (const other of others) if (touchesCircle(box, other, 1)) score += 150;
        for (const line of lines) if (crosses(box, line.from, line.to)) score += 1.6;
        const place: NamePlace = { side, dx, dy, width, box, leader: false };
        const join = leaderOf(place, circle.r);
        if (join) {
          place.leader = true;
          const end = {
            x: circle.x + join.x1,
            y: circle.y + join.y1,
          };
          const start = { x: circle.x + join.x0, y: circle.y + join.y0 };
          for (const other of others) {
            if (distanceToSegment(other, start, end) < other.r + 1) score += 40;
          }
        }
        if (!best || score < best.score) best = { score, place };
      }
    }
    if (!best) continue;
    placed.push(best.place.box);
    places.set(node.id, best.place);
  }
  return places;
}

export interface VisibleLabelOptions {
  /**
   * At most this many names are drawn: on a small canvas the heaviest nodes are named and the rest are left to be
   * pointed at. The key parties are named first and count against it, so that it is the cohorts that are left out;
   * it is never less than the number of key parties.
   */
  limit?: number;
  /** The key parties' names, if they have been put already (so that a group's name could keep clear of them). */
  keys?: ReadonlyMap<string, NamePlace>;
  /** Relations, in the picture's units, for the names of key parties to keep off. */
  segments?: readonly Segment[];
}

/**
 * The names that fit without touching, and where each goes. The key parties are named first, wherever it takes (see
 * `placeKeyNames`). The others go below their node where there is room, then above, then beside it, the heaviest
 * choosing first, and a name is never over another name, over a group's name, or over a node. A node that is left
 * out is named when it is hovered or selected.
 *
 * A name keeps the same size on the screen whatever the zoom, and the nodes do not: zoomed out they stand closer
 * and fewer names fit, zoomed in they stand apart and more do. So what fits is worked out on the screen, where the
 * camera has put the picture (`view`), and not in the picture's own units. The group names in `obstacles` are
 * already on the screen.
 */
export function placeNames(
  nodes: readonly NamedNode[],
  layout: Layout,
  obstacles: readonly Box[] = [],
  canvas?: Bounds,
  view: View = IDENTITY,
  options: VisibleLabelOptions = {},
): Map<string, NamePlace> {
  const circles = circlesOnScreen(nodes, layout, view);
  const where = new Map(circles.map((circle) => [circle.id, circle]));
  const keys =
    options.keys ??
    placeKeyNames(
      nodes,
      layout,
      canvas ?? { left: Number.NEGATIVE_INFINITY, right: Number.POSITIVE_INFINITY },
      view,
      { avoid: obstacles, ...(options.segments ? { segments: options.segments } : {}) },
    );
  const placed: Box[] = [...obstacles, ...[...keys.values()].map((place) => place.box)];
  const shown = new Map<string, NamePlace>(keys);
  const ordered = nodes
    .filter((node) => !keys.has(node.id))
    .sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
  const limit = Math.max(options.limit ?? Number.POSITIVE_INFINITY, keys.size);
  for (const node of ordered) {
    if (shown.size >= limit) break;
    const circle = where.get(node.id);
    if (!circle) continue;
    for (const side of SIDES) {
      const box = nameBox(circle, circle.r, node.label, side);
      if (canvas && (box.x0 < canvas.left || box.x1 > canvas.right)) continue;
      if (canvas?.top !== undefined && box.y0 < canvas.top) continue;
      if (canvas?.bottom !== undefined && box.y1 > canvas.bottom) continue;
      if (placed.some((other) => touches(box, other))) continue;
      if (circles.some((other) => other.id !== node.id && touchesCircle(box, other))) continue;
      placed.push(box);
      shown.set(node.id, { side, dx: 0, dy: 0, width: widthOf(node.label), box, leader: false });
      break;
    }
  }
  return shown;
}

/** The side of its node each name goes on: `placeNames` for those who only need to know that. */
export function visibleLabels(
  nodes: readonly NamedNode[],
  layout: Layout,
  obstacles: readonly Box[] = [],
  canvas?: Bounds,
  view: View = IDENTITY,
  options: VisibleLabelOptions = {},
): Map<string, LabelSide> {
  const places = placeNames(nodes, layout, obstacles, canvas, view, options);
  return new Map([...places].map(([id, place]) => [id, place.side]));
}
