/**
 * Positions that move to where they are told with a spring, so that a node that has a new place glides to
 * it and one that is redirected mid-way keeps its momentum. Pure and stepped by the caller, which makes it
 * testable and lets one loop drive every node and every edge.
 */
export interface Point {
  x: number;
  y: number;
}

interface Body extends Point {
  vx: number;
  vy: number;
}

export class PositionField {
  private readonly bodies = new Map<string, Body>();
  private readonly targets = new Map<string, Point>();

  constructor(
    private readonly stiffness = 150,
    private readonly damping = 24,
  ) {}

  /** New ids start at `spawn` (or at their target), ids that are gone are forgotten. */
  setTargets(targets: ReadonlyMap<string, Point>, spawn?: (id: string) => Point | undefined): void {
    this.targets.clear();
    for (const [id, point] of targets) {
      this.targets.set(id, { ...point });
      if (!this.bodies.has(id)) {
        const start = spawn?.(id) ?? point;
        this.bodies.set(id, { x: start.x, y: start.y, vx: 0, vy: 0 });
      }
    }
    for (const id of [...this.bodies.keys()]) if (!this.targets.has(id)) this.bodies.delete(id);
  }

  /** Puts every body on its target at once. */
  snap(): void {
    for (const [id, target] of this.targets) {
      this.bodies.set(id, { x: target.x, y: target.y, vx: 0, vy: 0 });
    }
  }

  /** Advances by `dt` seconds. Returns whether anything is still moving. */
  step(dt: number): boolean {
    const h = Math.min(Math.max(dt, 0), 1 / 30);
    let moving = false;
    for (const [id, body] of this.bodies) {
      const target = this.targets.get(id);
      if (!target) continue;
      const ax = -this.stiffness * (body.x - target.x) - this.damping * body.vx;
      const ay = -this.stiffness * (body.y - target.y) - this.damping * body.vy;
      body.vx += ax * h;
      body.vy += ay * h;
      body.x += body.vx * h;
      body.y += body.vy * h;
      if (
        Math.abs(body.x - target.x) < 0.05 &&
        Math.abs(body.y - target.y) < 0.05 &&
        Math.abs(body.vx) < 0.05 &&
        Math.abs(body.vy) < 0.05
      ) {
        body.x = target.x;
        body.y = target.y;
        body.vx = 0;
        body.vy = 0;
      } else {
        moving = true;
      }
    }
    return moving;
  }

  get(id: string): Point | undefined {
    const body = this.bodies.get(id);
    return body ? { x: body.x, y: body.y } : undefined;
  }

  ids(): IterableIterator<string> {
    return this.bodies.keys();
  }
}

/** The path of a relation: from the edge of one node to the edge of the other, bowed a little. */
export function edgePath(
  from: Point,
  to: Point,
  fromRadius: number,
  toRadius: number,
  bow: number,
): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return '';
  const ux = dx / distance;
  const uy = dy / distance;
  const sx = from.x + ux * (fromRadius + 3);
  const sy = from.y + uy * (fromRadius + 3);
  const ex = to.x - ux * (toRadius + 4);
  const ey = to.y - uy * (toRadius + 4);
  const mx = (sx + ex) / 2 - uy * distance * bow;
  const my = (sy + ey) / 2 + ux * distance * bow;
  return `M${sx.toFixed(1)} ${sy.toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
}
