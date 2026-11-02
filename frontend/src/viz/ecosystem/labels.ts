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

export interface ClusterLabelSpot {
  /** From the middle of the group to the middle of the baseline of its name, in pixels on the screen. */
  dx: number;
  dy: number;
  /** Where the name stands on the screen, for the view it was placed for. */
  box: Box;
}

/**
 * Where each group's name goes: above or below the group, on whichever side nothing is in the way, with the
 * largest groups choosing first. A name never sits over a node, over another group's name, or off the canvas.
 * It is worked out on the screen, where the camera has put the picture (`view`), because that is where the name
 * is drawn: the same size at any zoom.
 */
export function placeClusterLabels(
  nodes: readonly { id: string; label: string }[],
  layout: Layout,
  nameOf: (cluster: string) => string,
  canvas: { left: number; top: number; right: number; bottom: number },
  view: View = IDENTITY,
): Map<string, ClusterLabelSpot> {
  const circles = circlesOnScreen(nodes, layout, view);
  const byId = new Map(circles.map((circle) => [circle.id, circle]));
  const names = nodes.flatMap((node) => {
    const circle = byId.get(node.id);
    return circle ? [nameBox(circle, circle.r, node.label)] : [];
  });
  const placed: Box[] = [];
  const spots = new Map<string, ClusterLabelSpot>();
  const ordered = [...layout.clusters].sort(
    (a, b) => b.ids.length - a.ids.length || a.id.localeCompare(b.id),
  );
  for (const cluster of ordered) {
    const text = nameOf(cluster.id);
    // The name, and the dot in the group's colour that stands before it.
    const width = text.length * 8.4 + 26;
    const reach = cluster.radius * view.k;
    const centre = { x: cluster.x * view.k + view.x, y: cluster.y * view.k + view.y };
    const candidates: { dx: number; dy: number }[] = [
      { dx: 0, dy: -(reach + 8) },
      { dx: 0, dy: reach + 20 },
      { dx: -reach * 0.55, dy: -(reach * 0.78 + 8) },
      { dx: reach * 0.55, dy: -(reach * 0.78 + 8) },
      { dx: -reach * 0.55, dy: reach * 0.78 + 20 },
      { dx: reach * 0.55, dy: reach * 0.78 + 20 },
      { dx: 0, dy: -(reach + 26) },
      { dx: 0, dy: reach + 38 },
      // Beside the group, where the canvas is wide enough for the name to stand clear of it.
      { dx: -(reach + width / 2 + 4), dy: 0 },
      { dx: reach + width / 2 + 4, dy: 0 },
    ];
    let best: { score: number; spot: ClusterLabelSpot } | null = null;
    for (const candidate of candidates) {
      // A name near the edge of the canvas slides inward, as far as it must, rather than leaving it.
      const middle = centre.x + candidate.dx;
      const over = Math.max(0, canvas.left - (middle - width / 2));
      const under = Math.max(0, middle + width / 2 - canvas.right);
      const dx = candidate.dx + over - under;
      const x = centre.x + dx;
      const y = centre.y + candidate.dy;
      const box: Box = { x0: x - width / 2, x1: x + width / 2, y0: y - 13, y1: y + 5 };
      let score = 0;
      for (const circle of circles) if (touchesCircle(box, circle, 3)) score += 4;
      for (const name of names) if (touches(box, name)) score += 2;
      for (const other of placed) if (touches(box, other)) score += 6;
      if (
        box.x0 < canvas.left ||
        box.x1 > canvas.right ||
        box.y0 < canvas.top ||
        box.y1 > canvas.bottom
      )
        score += 8;
      if (!best || score < best.score) best = { score, spot: { dx, dy: candidate.dy, box } };
      if (score === 0) break;
    }
    if (best) {
      placed.push(best.spot.box);
      spots.set(cluster.id, best.spot);
    }
  }
  return spots;
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
  canvas?: { left: number; right: number },
  view: View = IDENTITY,
): Map<string, LabelSide> {
  const circles = circlesOnScreen(nodes, layout, view);
  const where = new Map(circles.map((circle) => [circle.id, circle]));
  const placed: Box[] = [...obstacles];
  const shown = new Map<string, LabelSide>();
  const ordered = [...nodes].sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
  for (const node of ordered) {
    const circle = where.get(node.id);
    if (!circle) continue;
    for (const side of SIDES) {
      const box = nameBox(circle, circle.r, node.label, side);
      if (canvas && (box.x0 < canvas.left || box.x1 > canvas.right)) continue;
      if (placed.some((other) => touches(box, other))) continue;
      if (circles.some((other) => other.id !== node.id && touchesCircle(box, other))) continue;
      placed.push(box);
      shown.set(node.id, side);
      break;
    }
  }
  return shown;
}
