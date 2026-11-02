import './SwarmField.css';
import { useEffect, useRef } from 'react';
import { useReducedMotion } from '../motion';
import { useThemeName } from '../useThemeName';

interface Point {
  /** Where it rests when nothing pulls it. */
  hx: number;
  hy: number;
  x: number;
  y: number;
  phase: number;
  speed: number;
  radius: number;
  tone: 0 | 1 | 2 | 3;
  /** Where on the gathering ring it goes to when the swarm gathers, in turns. */
  slot: number;
}

const TWO_PI = Math.PI * 2;

/** A small deterministic generator: the field looks the same each time, so it never feels random. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function readColours(): string[] {
  const style = getComputedStyle(document.documentElement);
  // A token that cannot be read (a page without the stylesheet) falls back to a named colour, never to a literal of ours.
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return [
    token('--ink-3', 'gray'),
    token('--accent', 'slateblue'),
    token('--c-favor', 'teal'),
    token('--c-against', 'chocolate'),
  ];
}

/**
 * Swarm's own signature: a loose constellation of points drifting on the first screen. It is identity,
 * not data. When `gather` is set (the question is being written) the points draw toward a ring around
 * `anchor`, the way the product gathers around a question. It reacts to the pointer, stops for reduced
 * motion (one still frame), pauses with the tab, and never takes the pointer from what is above it.
 */
export function SwarmField({
  gather = false,
  anchor,
  density = 1,
}: {
  gather?: boolean;
  /** The element the swarm gathers around. */
  anchor?: React.RefObject<HTMLElement | null>;
  density?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  const theme = useThemeName();
  const gatherRef = useRef(gather);
  gatherRef.current = gather;

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return undefined;
    const surface = element;
    const g = context;
    const colours = readColours();

    let width = 0;
    let height = 0;
    let points: Point[] = [];
    let frame = 0;
    let pull = 0;
    let last = performance.now();
    const pointer = { x: -9999, y: -9999, active: false };

    const build = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = surface.clientWidth;
      height = surface.clientHeight;
      surface.width = Math.round(width * ratio);
      surface.height = Math.round(height * ratio);
      g.setTransform(ratio, 0, 0, ratio, 0, 0);
      const random = lcg(20240611);
      const count = Math.round(Math.min(96, Math.max(34, (width * height) / 19000)) * density);
      points = Array.from({ length: count }, (_, index) => {
        const tone = random();
        return {
          hx: random() * width,
          hy: random() * height,
          x: 0,
          y: 0,
          phase: random() * TWO_PI,
          speed: 0.18 + random() * 0.32,
          radius: 0.9 + random() * 1.7,
          tone: tone > 0.93 ? 3 : tone > 0.86 ? 2 : tone > 0.76 ? 1 : 0,
          slot: index / count,
        };
      });
      for (const point of points) {
        point.x = point.hx;
        point.y = point.hy;
      }
    };

    const draw = (time: number, still: boolean) => {
      const dt = Math.min((time - last) / 1000, 0.05);
      last = time;
      const target = gatherRef.current ? 1 : 0;
      pull += (target - pull) * Math.min(1, dt * 2.4);

      const box = anchor?.current?.getBoundingClientRect();
      const host = surface.getBoundingClientRect();
      const cx = box ? box.left + box.width / 2 - host.left : width / 2;
      const cy = box ? box.top + box.height / 2 - host.top : height / 2;
      const rx = box ? box.width / 2 + 54 : Math.min(width, height) * 0.3;
      const ry = box ? box.height / 2 + 54 : Math.min(width, height) * 0.2;

      g.clearRect(0, 0, width, height);
      const t = still ? 0 : time / 1000;
      for (const point of points) {
        const driftX = Math.cos(t * point.speed + point.phase) * 22;
        const driftY = Math.sin(t * point.speed * 0.8 + point.phase * 1.3) * 18;
        const angle = point.slot * TWO_PI + t * 0.05;
        const ringX = cx + Math.cos(angle) * rx * (0.96 + 0.08 * Math.sin(point.phase));
        const ringY = cy + Math.sin(angle) * ry * (0.96 + 0.08 * Math.cos(point.phase));
        let tx = point.hx + driftX + (ringX - point.hx - driftX) * pull * 0.85;
        let ty = point.hy + driftY + (ringY - point.hy - driftY) * pull * 0.85;
        if (pointer.active) {
          const dx = tx - pointer.x;
          const dy = ty - pointer.y;
          const distance = Math.hypot(dx, dy);
          if (distance < 130 && distance > 0.1) {
            const push = ((130 - distance) / 130) ** 2 * 26;
            tx += (dx / distance) * push;
            ty += (dy / distance) * push;
          }
        }
        point.x += (tx - point.x) * Math.min(1, dt * 5);
        point.y += (ty - point.y) * Math.min(1, dt * 5);
      }

      const reach = 118;
      g.lineWidth = 1;
      for (let a = 0; a < points.length; a += 1) {
        const p = points[a]!;
        for (let b = a + 1; b < points.length; b += 1) {
          const q = points[b]!;
          const dx = p.x - q.x;
          const dy = p.y - q.y;
          if (dx > reach || dx < -reach || dy > reach || dy < -reach) continue;
          const distance = Math.hypot(dx, dy);
          if (distance > reach) continue;
          const alpha = (1 - distance / reach) * (0.16 + pull * 0.14);
          g.globalAlpha = alpha;
          g.strokeStyle = colours[0]!;
          g.beginPath();
          g.moveTo(p.x, p.y);
          g.lineTo(q.x, q.y);
          g.stroke();
        }
      }
      for (const point of points) {
        g.globalAlpha = point.tone === 0 ? 0.5 : 0.85;
        g.fillStyle = colours[point.tone]!;
        g.beginPath();
        g.arc(point.x, point.y, point.radius + (point.tone === 0 ? 0 : 0.5), 0, TWO_PI);
        g.fill();
      }
      g.globalAlpha = 1;
    };

    const loop = (time: number) => {
      draw(time, false);
      frame = requestAnimationFrame(loop);
    };

    const onPointer = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const box = surface.getBoundingClientRect();
      pointer.x = event.clientX - box.left;
      pointer.y = event.clientY - box.top;
      pointer.active = true;
    };
    const onLeave = () => {
      pointer.active = false;
    };

    build();
    const observer = new ResizeObserver(() => {
      build();
      if (reduced) draw(performance.now(), true);
    });
    observer.observe(surface);
    window.addEventListener('pointermove', onPointer, { passive: true });
    document.addEventListener('pointerleave', onLeave);

    if (reduced) draw(performance.now(), true);
    else frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('pointermove', onPointer);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, [reduced, theme, anchor, density]);

  return <canvas ref={canvas} className="sw-swarm" aria-hidden="true" />;
}
