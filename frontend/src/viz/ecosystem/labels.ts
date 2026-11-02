import type { Layout } from './layout';

interface Box {
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

/**
 * The box a node's name would fill on the screen, on one side of its node. A name is the same size at any zoom:
 * only the distance from the node, which is the node's size on the screen, changes with it.
 */
function nameBox(
  point: { x: number; y: number },
  radius: number,
  label: string,
  side: LabelSide = 'below',
): Box {
  const width = Math.min(label.length, 24) * 6.6 + 10;
  const height = 21;
  switch (side) {
    case 'above':
      return {
        x0: point.x - width / 2,
        x1: point.x + width / 2,
        y0: point.y - radius - height,
        y1: point.y - radius - 3,
      };
    case 'right':
      return {
        x0: point.x + radius + 4,
        x1: point.x + radius + 4 + width,
        y0: point.y - 10,
        y1: point.y + 10,
      };
    case 'left':
      return {
        x0: point.x - radius - 4 - width,
        x1: point.x - radius - 4,
        y0: point.y - 10,
        y1: point.y + 10,
      };
    default:
      return {
        x0: point.x - width / 2,
        x1: point.x + width / 2,
        y0: point.y + radius + 3,
        y1: point.y + radius + height,
      };
  }
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

export interface VisibleLabelOptions {
  /** At most this many names are drawn: on a small canvas the heaviest nodes are named and the rest are left to be pointed at. */
  limit?: number;
  /** Nodes that are not named but are in the way all the same (the empty places where nobody was found). */
  solid?: readonly { id: string }[];
}

/**
 * The names that fit without touching, and the side of its node each goes on: below where there is room, then
 * above, then beside. The heaviest nodes choose first, and a name is never over another name, over a group's
 * name, or over a node. A node that is left out is named when it is hovered or selected.
 *
 * A name keeps the same size on the screen whatever the zoom, and the nodes do not: zoomed out they stand closer
 * and fewer names fit, zoomed in they stand apart and more do. So what fits is worked out on the screen, where the
 * camera has put the picture (`view`), and not in the picture's own units. The group names in `obstacles` are
 * already on the screen.
 */
export function visibleLabels(
  nodes: readonly { id: string; label: string; weight: number }[],
  layout: Layout,
  obstacles: readonly Box[] = [],
  canvas?: Bounds,
  view: View = IDENTITY,
  options: VisibleLabelOptions = {},
): Map<string, LabelSide> {
  const circles = circlesOnScreen([...nodes, ...(options.solid ?? [])], layout, view);
  const where = new Map(circles.map((circle) => [circle.id, circle]));
  const placed: Box[] = [...obstacles];
  const shown = new Map<string, LabelSide>();
  const ordered = [...nodes].sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
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
      shown.set(node.id, side);
      break;
    }
  }
  return shown;
}
