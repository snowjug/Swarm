import {
  forwardRef,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { cx } from '../../design/cx';
import { useReducedMotion } from '../../design/motion';
import { IconButton } from '../../design/ui';
import {
  clusterColour,
  clusterLabel,
  DIRECTION_LABEL,
  directionColor,
  stanceColor,
  stanceWord,
} from '../palette';
import { PositionField, edgePath, type Point } from './field';
import {
  placeClusterLabels,
  visibleLabels,
  type ClusterLabelSpot,
  type LabelSide,
  type View,
} from './labels';
import { layoutEcosystem, nearestInDirection, radiusOf, type Layout } from './layout';
import { DIRECTED, RELATION_LABEL, neighbourhood, type EcoEdge, type EcoNode } from './model';
import './Ecosystem.css';

export interface EcosystemHandle {
  fit: () => void;
  zoomBy: (factor: number) => void;
}

export interface Covered {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export interface EcosystemProps {
  nodes: readonly EcoNode[];
  edges: readonly EcoEdge[];
  /** What the whole picture is, for a screen reader. */
  label: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Colour nodes by what they are expected to suffer (`direction`), or by a number such as a stance (`value`). */
  mode?: 'direction' | 'value';
  valueFor?: (id: string) => number | null;
  valueScale?: number;
  /** With a node selected, everything not joined to it recedes and the view moves to its neighbourhood. */
  focus?: boolean;
  hiddenClusters?: ReadonlySet<string>;
  /** Nodes that stand out (those that acted in the round shown). */
  emphasis?: ReadonlySet<string>;
  pulses?: readonly { id: string; key: string }[];
  flows?: readonly { from: string; to: string; key: string }[];
  /** Places nobody was found for: drawn as empty slots that a person can fill. */
  ghosts?: readonly { id: string; label: string; cluster: string }[];
  onGhost?: (id: string) => void;
  ghostLabel?: (label: string) => string;
  labels?: 'auto' | 'all' | 'none';
  /** A slow idle drift, so the picture is alive when nothing is happening. */
  drift?: boolean;
  clusters?: boolean;
  tooltip?: (node: EcoNode) => ReactNode;
  describe?: (node: EcoNode) => string;
  className?: string;
  controls?: boolean;
  zoomLabels?: { in: string; out: string; fit: string; group: string };
  /** Room kept free at the edges of the canvas when the nodes are laid out. */
  inset?: Covered;
  /** The part of the canvas that something floats over right now: the view keeps everything clear of it. */
  covered?: Covered;
  /** Nodes that are new since the last picture arrive from the middle of their cluster. */
  emerge?: boolean;
  children?: ReactNode;
}

const OPACITY = { high: 1, medium: 0.82, low: 0.6 } as const;
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 3;

function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

interface Camera {
  x: number;
  y: number;
  k: number;
  vx: number;
  vy: number;
  vk: number;
  tx: number;
  ty: number;
  tk: number;
}

const clampZoom = (value: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));

/**
 * The spatial picture of who is in play. Nodes gather in clusters by kind; a node's size is how much it
 * weighs, its colour what it is expected to suffer (or, in a run, where it stands), a dashed ring marks an
 * indirect effect and its opacity how sure Swarm is of it. Lines are the relations between parties.
 *
 * Positions come from a layout that is the same every time, and one loop writes every node, line and halo
 * straight to the elements, so a node given a new place glides there with its lines attached, and the view
 * moves with the same spring. It is a real group of buttons: arrow keys move between nodes, Enter opens one,
 * Escape lets go. Nothing here needs a pointer; the scene that uses it offers the same parties as a list.
 */
export const Ecosystem = forwardRef<EcosystemHandle, EcosystemProps>(
  function Ecosystem(props, forwarded) {
    const {
      nodes,
      edges,
      selectedId,
      onSelect,
      mode = 'direction',
      valueFor,
      valueScale = 0.5,
      focus = false,
      hiddenClusters,
      emphasis,
      pulses = [],
      flows = [],
      ghosts = [],
      onGhost,
      ghostLabel = (label) => `Add ${label}`,
      labels = 'auto',
      drift = true,
      clusters: showClusters = true,
      controls = true,
      inset,
      emerge = true,
    } = props;
    const reduced = useReducedMotion();
    const uid = useId().replace(/:/g, '');
    const host = useRef<HTMLDivElement>(null);
    const svg = useRef<SVGSVGElement>(null);
    const [size, setSize] = useState({ width: 720, height: 480 });
    // Until the canvas has been measured the picture is not laid out: laying it out for a guess would draw it at the
    // wrong size and then glide it to the right one.
    const [measured, setMeasured] = useState(false);
    const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);
    const [tabStop, setTabStop] = useState<string | null>(null);
    const [zoomed, setZoomed] = useState(false);
    // Where the camera is going, for deciding which names fit on the screen: it follows a drag or a wheel only
    // once they pause, so a name does not come and go under a hand that is still moving.
    const [view, setView] = useState<View>({ k: 1, x: 0, y: 0 });
    const settledView = useDeferredValue(view);

    const nodeEls = useRef(new Map<string, SVGGElement>());
    const hitEls = useRef(new Map<string, SVGCircleElement>());
    const lineEls = useRef(new Map<string, SVGPathElement>());
    const headEls = useRef(new Map<string, SVGPathElement>());
    const haloEls = useRef(new Map<string, SVGCircleElement>());
    const clusterTextEls = useRef(new Map<string, SVGTextElement>());
    const tagEls = useRef(new Map<string, SVGGElement>());
    const viewport = useRef<SVGGElement>(null);
    const field = useRef(new PositionField());
    const frame = useRef(0);
    const running = useRef(false);
    const visible = useRef(true);
    const last = useRef(0);
    const clock = useRef(0);
    const known = useRef(new Set<string>());
    const camera = useRef<Camera>({ x: 0, y: 0, k: 1, vx: 0, vy: 0, vk: 0, tx: 0, ty: 0, tk: 1 });
    const live = useRef({
      nodes: [] as EcoNode[],
      edges: [] as EcoEdge[],
      layout: null as Layout | null,
      drift,
      reduced,
      scale: 1,
      width: 720,
      height: 480,
      covered: {} as Covered,
      spots: new Map<string, ClusterLabelSpot>(),
      sides: new Map<string, LabelSide>(),
    });

    // ---- Size ------------------------------------------------------------------------------------------
    useLayoutEffect(() => {
      const element = host.current;
      if (!element) return undefined;
      const measure = () => {
        const box = element.getBoundingClientRect();
        if (box.width < 40 || box.height < 40) return;
        setMeasured(true);
        setSize((old) =>
          Math.abs(old.width - box.width) < 12 && Math.abs(old.height - box.height) < 12
            ? old
            : { width: Math.round(box.width), height: Math.round(box.height) },
        );
      };
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
    }, []);

    // The nodes are as large as the canvas lets them be: a large screen is not a small picture in a big room.
    const maxScale = size.width < 560 ? 1.15 : size.width < 1500 ? 1.9 : 2.5;
    const minScale = size.width < 560 ? 0.72 : 0.8;
    const ghostNodes = useMemo<EcoNode[]>(
      () =>
        ghosts.map((ghost) => ({
          id: ghost.id,
          label: ghost.label,
          category: 'other',
          categoryLabel: ghost.label,
          cluster: ghost.cluster,
          weight: 0.2,
          kind: 'cohort',
          direct: null,
          direction: 'unclear',
          confidence: 'low',
          evidenceCount: 0,
          ghost: true,
        })),
      [ghosts],
    );
    const all = useMemo(() => [...nodes, ...ghostNodes], [nodes, ghostNodes]);
    const byId = useMemo(() => new Map(all.map((node) => [node.id, node])), [all]);
    const liveEdges = useMemo(
      () => edges.filter((edge) => byId.has(edge.from) && byId.has(edge.to)),
      [edges, byId],
    );

    const signature = useMemo(
      () =>
        `${all.map((node) => `${node.id}:${node.cluster}:${node.weight.toFixed(2)}`).join('|')}#${liveEdges
          .map((edge) => `${edge.id}:${edge.strength.toFixed(2)}`)
          .join(
            '|',
          )}#${size.width}x${size.height}#${maxScale}#${inset?.top ?? 0},${inset?.right ?? 0},${inset?.bottom ?? 0},${inset?.left ?? 0}`,
      [
        all,
        liveEdges,
        size.width,
        size.height,
        maxScale,
        inset?.top,
        inset?.right,
        inset?.bottom,
        inset?.left,
      ],
    );

    const layout = useMemo(
      () =>
        layoutEcosystem({
          nodes: all.map((node) => ({ id: node.id, cluster: node.cluster, weight: node.weight })),
          edges: liveEdges.map((edge) => ({
            from: edge.from,
            to: edge.to,
            strength: edge.strength,
          })),
          width: size.width,
          height: size.height,
          scale: maxScale,
          minScale,
          inset: { top: 32, right: 32, bottom: 52, left: 32, ...inset },
        }),
      // The signature carries everything the layout reads.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [signature],
    );

    const clusterSpots = useMemo(
      () =>
        placeClusterLabels(
          all,
          layout,
          clusterLabel,
          {
            left: 8,
            top: Math.max((inset?.top ?? 32) - 24, 8),
            right: size.width - 8,
            bottom: size.height - Math.max((inset?.bottom ?? 52) - 28, 8),
          },
          settledView,
        ),
      [all, layout, size.width, size.height, inset?.top, inset?.bottom, settledView],
    );
    const shownLabels = useMemo(() => {
      if (labels === 'none') return new Map<string, LabelSide>();
      if (labels === 'all')
        return new Map<string, LabelSide>(all.map((node) => [node.id, 'below']));
      return visibleLabels(
        all,
        layout,
        showClusters ? [...clusterSpots.values()].map((spot) => spot.box) : [],
        { left: 6, right: size.width - 6 },
        settledView,
      );
    }, [all, layout, labels, clusterSpots, showClusters, size.width, settledView]);

    // ---- One loop paints every node, line, halo and the view -------------------------------------------------
    const paint = useCallback(() => {
      const state = live.current;
      const laid = state.layout;
      if (!laid) return;
      const t = clock.current;
      const cam = camera.current;
      const ik = 1 / cam.k;
      const spots = new Map<string, Point>();
      const amplitude = state.drift && !state.reduced ? 1.6 : 0;
      for (const node of state.nodes) {
        const base = field.current.get(node.id);
        if (!base) continue;
        const phase = (hash(node.id) % 628) / 100;
        const point = {
          x: base.x + Math.sin(t * 0.55 + phase) * amplitude,
          y: base.y + Math.cos(t * 0.47 + phase * 1.3) * amplitude,
        };
        spots.set(node.id, point);
        nodeEls.current
          .get(node.id)
          ?.setAttribute('transform', `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)})`);
        // A name keeps its size on the screen whatever the zoom: it is moved and scaled against the view.
        const tag = tagEls.current.get(node.id);
        if (tag) {
          const side = state.sides.get(node.id) ?? 'below';
          const r = laid.radii.get(node.id) ?? 8;
          const tx = side === 'right' ? r + 7 * ik : side === 'left' ? -(r + 7 * ik) : 0;
          const ty = side === 'below' ? r + 15 * ik : side === 'above' ? -(r + 7 * ik) : 4 * ik;
          tag.setAttribute(
            'transform',
            `translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${ik.toFixed(4)})`,
          );
        }
      }
      for (const edge of state.edges) {
        const from = spots.get(edge.from);
        const to = spots.get(edge.to);
        const line = lineEls.current.get(edge.id);
        if (!from || !to || !line) continue;
        const fromRadius = laid.radii.get(edge.from) ?? 8;
        const toRadius = laid.radii.get(edge.to) ?? 8;
        const bow = (hash(edge.id) % 2 === 0 ? 1 : -1) * 0.09;
        line.setAttribute('d', edgePath(from, to, fromRadius, toRadius, bow));
        const head = headEls.current.get(edge.id);
        if (head) {
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const distance = Math.hypot(dx, dy) || 1;
          const ux = dx / distance;
          const uy = dy / distance;
          const mx = (from.x + to.x) / 2 - uy * distance * bow;
          const my = (from.y + to.y) / 2 + ux * distance * bow;
          const tipX = to.x - ux * (toRadius + 4);
          const tipY = to.y - uy * (toRadius + 4);
          const length = Math.hypot(tipX - mx, tipY - my) || 1;
          const hx = (tipX - mx) / length;
          const hy = (tipY - my) / length;
          head.setAttribute(
            'd',
            `M${tipX.toFixed(1)} ${tipY.toFixed(1)}L${(tipX - hx * 7 - hy * 3.4).toFixed(1)} ${(tipY - hy * 7 + hx * 3.4).toFixed(1)}L${(tipX - hx * 7 + hy * 3.4).toFixed(1)} ${(tipY - hy * 7 - hx * 3.4).toFixed(1)}Z`,
          );
        }
      }
      for (const cluster of laid.clusters) {
        const halo = haloEls.current.get(cluster.id);
        if (!halo) continue;
        const members = cluster.ids
          .map((id) => ({ id, point: spots.get(id) }))
          .filter((entry): entry is { id: string; point: Point } => Boolean(entry.point));
        if (members.length === 0) continue;
        const x = members.reduce((sum, entry) => sum + entry.point.x, 0) / members.length;
        const y = members.reduce((sum, entry) => sum + entry.point.y, 0) / members.length;
        const reach = Math.max(
          ...members.map(
            (entry) =>
              Math.hypot(entry.point.x - x, entry.point.y - y) + (laid.radii.get(entry.id) ?? 8),
          ),
        );
        const radius = reach + 22 * state.scale;
        halo.setAttribute('cx', x.toFixed(1));
        halo.setAttribute('cy', y.toFixed(1));
        halo.setAttribute('r', radius.toFixed(1));
        const text = clusterTextEls.current.get(cluster.id);
        if (text) {
          // A group's name is the same size on the screen at any zoom, placed in pixels from the group's middle.
          const spot = state.spots.get(cluster.id);
          const at = {
            x: x + (spot?.dx ?? 0) * ik,
            y: y + (spot?.dy ?? -(radius * cam.k + 8)) * ik,
          };
          text.setAttribute(
            'transform',
            `translate(${at.x.toFixed(1)} ${at.y.toFixed(1)}) scale(${ik.toFixed(4)})`,
          );
        }
      }
      viewport.current?.setAttribute(
        'transform',
        `translate(${cam.x.toFixed(2)} ${cam.y.toFixed(2)}) scale(${cam.k.toFixed(4)})`,
      );
    }, []);

    const loop = useCallback(
      (now: number) => {
        frame.current = 0;
        if (!visible.current) {
          running.current = false;
          return;
        }
        // A frame's own timestamp can come before the moment the loop was started: time never runs backwards here.
        const dt = Math.min(Math.max((now - last.current) / 1000, 0), 1 / 30);
        last.current = now;
        clock.current += dt;
        const nodesMoving = field.current.step(dt);
        const cam = camera.current;
        let cameraMoving = false;
        const pairs: ['x' | 'y' | 'k', 'vx' | 'vy' | 'vk', 'tx' | 'ty' | 'tk'][] = [
          ['x', 'vx', 'tx'],
          ['y', 'vy', 'ty'],
          ['k', 'vk', 'tk'],
        ];
        for (const [axis, velocityKey, targetKey] of pairs) {
          const acceleration = -190 * (cam[axis] - cam[targetKey]) - 28 * cam[velocityKey];
          cam[velocityKey] += acceleration * dt;
          cam[axis] += cam[velocityKey] * dt;
          if (Math.abs(cam[axis] - cam[targetKey]) < 0.002 && Math.abs(cam[velocityKey]) < 0.02) {
            cam[axis] = cam[targetKey];
            cam[velocityKey] = 0;
          } else cameraMoving = true;
        }
        paint();
        const idleDrift = live.current.drift && !live.current.reduced;
        if (nodesMoving || cameraMoving || idleDrift) frame.current = requestAnimationFrame(loop);
        else running.current = false;
      },
      [paint],
    );

    const start = useCallback(() => {
      if (running.current || !visible.current) return;
      running.current = true;
      last.current = performance.now();
      frame.current = requestAnimationFrame(loop);
    }, [loop]);

    // The loop sleeps while the picture is scrolled out of view or the tab is hidden.
    useEffect(() => {
      const element = host.current;
      if (!element || typeof IntersectionObserver === 'undefined') return undefined;
      const observer = new IntersectionObserver(([entry]) => {
        visible.current = entry?.isIntersecting ?? true;
        if (visible.current) start();
      });
      observer.observe(element);
      return () => observer.disconnect();
    }, [start]);

    // A new layout: nodes that are new start in the middle of their cluster and spring out.
    useLayoutEffect(() => {
      if (!measured) return;
      live.current = {
        ...live.current,
        nodes: all,
        edges: liveEdges,
        layout,
        drift,
        reduced,
        scale: layout.scale,
        spots: clusterSpots,
        sides: shownLabels,
        width: size.width,
        height: size.height,
      };
      const centre = new Map(
        layout.clusters.map((cluster) => [cluster.id, { x: cluster.x, y: cluster.y }]),
      );
      const clusterOf = new Map(all.map((node) => [node.id, node.cluster]));
      const first = known.current.size === 0;
      field.current.setTargets(layout.positions, (id) =>
        emerge && !reduced && !first ? centre.get(clusterOf.get(id) ?? '') : undefined,
      );
      known.current = new Set(layout.positions.keys());
      if (reduced || first) field.current.snap();
      paint();
      start();
    }, [
      measured,
      all,
      liveEdges,
      layout,
      clusterSpots,
      shownLabels,
      drift,
      reduced,
      size.width,
      size.height,
      emerge,
      paint,
      start,
    ]);

    useEffect(() => {
      const element = host.current;
      return () => {
        if (frame.current) cancelAnimationFrame(frame.current);
        frame.current = 0;
        running.current = false;
        void element;
      };
    }, []);

    // ---- Selection and the view ---------------------------------------------------------------------------
    const around = useMemo(
      () => (selectedId ? neighbourhood(selectedId, liveEdges) : null),
      [selectedId, liveEdges],
    );

    const publishView = useCallback(() => {
      const cam = camera.current;
      const next: View = {
        k: Math.round(cam.tk * 100) / 100,
        x: Math.round(cam.tx),
        y: Math.round(cam.ty),
      };
      setView((old) => (old.k === next.k && old.x === next.x && old.y === next.y ? old : next));
    }, []);

    const moveCamera = useCallback(
      (x: number, y: number, k: number, immediate = false) => {
        const cam = camera.current;
        const zoomKept = Math.abs(clampZoom(k) - cam.tk) < 1e-6;
        cam.tx = x;
        cam.ty = y;
        cam.tk = clampZoom(k);
        if (immediate || live.current.reduced) {
          cam.x = cam.tx;
          cam.y = cam.ty;
          cam.k = cam.tk;
          cam.vx = cam.vy = cam.vk = 0;
          paint();
        }
        const zoomedNow = cam.tk > 1.04 || cam.tk < 0.96;
        setZoomed((old) => (old === zoomedNow ? old : zoomedNow));
        // A hand dragging the picture only slides it: the names are looked at again when it lets go.
        if (!(immediate && zoomKept)) publishView();
        start();
      },
      [paint, start, publishView],
    );

    const fitTo = useCallback(
      (ids: ReadonlySet<string> | null) => {
        const state = live.current;
        const laid = state.layout;
        if (!laid) return;
        const cover = { left: 0, right: 0, top: 0, bottom: 0, ...props.covered };
        const focusing = Boolean(ids && ids.size > 0);
        // What is left to see in: the canvas less what floats over it, and less the room the layout kept free.
        const top = Math.max(cover.top, props.inset?.top ?? 32);
        const bottom = Math.max(cover.bottom, props.inset?.bottom ?? 52);
        const free = {
          x: cover.left,
          y: top,
          width: Math.max(state.width - cover.left - cover.right, 160),
          height: Math.max(state.height - top - bottom, 160),
        };
        const ofIds = focusing ? ids! : new Set(laid.positions.keys());
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const id of ofIds) {
          const point = laid.positions.get(id);
          if (!point) continue;
          const radius = laid.radii.get(id) ?? 8;
          minX = Math.min(minX, point.x - radius - 36);
          maxX = Math.max(maxX, point.x + radius + 36);
          minY = Math.min(minY, point.y - radius - 36);
          maxY = Math.max(maxY, point.y + radius + 40);
        }
        if (!Number.isFinite(minX)) return;
        const midX = (minX + maxX) / 2;
        const midY = (minY + maxY) / 2;
        const natural = Math.min(free.width / (maxX - minX), free.height / (maxY - minY));
        if (!focusing) {
          // Everything, as it was drawn, unless something floats over it: then no larger than that leaves room for.
          if (cover.left + cover.right + cover.top + cover.bottom === 0) {
            moveCamera(0, 0, 1);
            return;
          }
          const k = clampZoom(Math.min(1, natural));
          moveCamera(free.x + free.width / 2 - midX * k, free.y + free.height / 2 - midY * k, k);
          return;
        }
        const k = clampZoom(Math.min(2.1, Math.max(0.9, natural)));
        moveCamera(free.x + free.width / 2 - midX * k, free.y + free.height / 2 - midY * k, k);
      },
      // `covered` is read when the view moves, not when it is merely re-rendered.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [
        moveCamera,
        props.covered?.right,
        props.covered?.left,
        props.covered?.top,
        props.covered?.bottom,
        props.inset?.top,
        props.inset?.bottom,
      ],
    );

    useEffect(() => {
      live.current.covered = props.covered ?? {};
      if (focus && around) fitTo(around.nodes);
      else fitTo(null);
      // The view moves when the selection, the mode, the covered part or the picture itself changes.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focus, selectedId, fitTo, layout]);

    const zoomBy = useCallback(
      (factor: number) => {
        const cam = camera.current;
        const k = clampZoom(cam.tk * factor);
        const cx = live.current.width / 2;
        const cy = live.current.height / 2;
        moveCamera(cx - ((cx - cam.tx) / cam.tk) * k, cy - ((cy - cam.ty) / cam.tk) * k, k);
      },
      [moveCamera],
    );

    useImperativeHandle(forwarded, () => ({ fit: () => fitTo(null), zoomBy }), [fitTo, zoomBy]);

    // Ctrl or ⌘ with the wheel zooms; a plain wheel scrolls the page, which a map must never take from a person.
    useEffect(() => {
      const element = host.current;
      if (!element) return undefined;
      const wheel = (event: WheelEvent) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        const cam = camera.current;
        const box = element.getBoundingClientRect();
        const px = event.clientX - box.left;
        const py = event.clientY - box.top;
        const k = clampZoom(cam.tk * Math.exp(-event.deltaY * 0.0022));
        moveCamera(px - ((px - cam.tx) / cam.tk) * k, py - ((py - cam.ty) / cam.tk) * k, k, true);
      };
      element.addEventListener('wheel', wheel, { passive: false });
      return () => element.removeEventListener('wheel', wheel);
    }, [moveCamera]);

    // Dragging the background pans (a mouse or pen; a finger scrolls the page); a plain click lets go.
    const drag = useRef<{
      id: number;
      x: number;
      y: number;
      cx: number;
      cy: number;
      moved: boolean;
    } | null>(null);
    const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
      if (event.pointerType === 'touch' || (event.target as Element).closest('.sw-eco__node'))
        return;
      drag.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        cx: camera.current.tx,
        cy: camera.current.ty,
        moved: false,
      };
    };
    const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
      const state = drag.current;
      if (!state || state.id !== event.pointerId) return;
      const dx = event.clientX - state.x;
      const dy = event.clientY - state.y;
      if (!state.moved && Math.hypot(dx, dy) < 5) return;
      if (!state.moved) event.currentTarget.setPointerCapture(event.pointerId);
      state.moved = true;
      moveCamera(state.cx + dx, state.cy + dy, camera.current.tk, true);
    };
    const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
      const state = drag.current;
      drag.current = null;
      if (state?.moved) publishView();
      if (state && !state.moved && !(event.target as Element).closest('.sw-eco__node'))
        onSelect(null);
    };

    // ---- The tooltip is placed where the node is on screen when it is hovered or focused ---------------------
    const showTip = useCallback((id: string) => {
      const element = hitEls.current.get(id);
      const box = host.current?.getBoundingClientRect();
      const at = element?.getBoundingClientRect();
      if (!element || !box || !at) return;
      setTip({ id, x: at.left + at.width / 2 - box.left, y: at.top - box.top - 4 });
    }, []);
    const hideTip = useCallback((id: string) => setTip((old) => (old?.id === id ? null : old)), []);

    // ---- Keyboard: arrows move between nodes, Enter opens, Escape lets go ------------------------------------
    const visibleNodes = useMemo(
      () => all.filter((node) => !hiddenClusters?.has(node.cluster)),
      [all, hiddenClusters],
    );
    const stop =
      tabStop && visibleNodes.some((node) => node.id === tabStop)
        ? tabStop
        : (visibleNodes[0]?.id ?? null);
    const ARROWS: Record<string, 'left' | 'right' | 'up' | 'down'> = {
      ArrowLeft: 'left',
      ArrowRight: 'right',
      ArrowUp: 'up',
      ArrowDown: 'down',
    };
    const choose = (node: EcoNode) => {
      if (node.ghost) onGhost?.(node.id);
      else onSelect(selectedId === node.id ? null : node.id);
    };
    const onNodeKey = (event: ReactKeyboardEvent<SVGCircleElement>, node: EcoNode) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        choose(node);
        return;
      }
      if (event.key === 'Escape') {
        if (selectedId) {
          event.stopPropagation();
          onSelect(null);
        }
        return;
      }
      const direction = ARROWS[event.key];
      if (!direction) return;
      event.preventDefault();
      const from = field.current.get(node.id);
      if (!from) return;
      const candidates = visibleNodes
        .filter((other) => other.id !== node.id)
        .map((other) => ({ id: other.id, ...(field.current.get(other.id) ?? { x: 0, y: 0 }) }));
      const next = nearestInDirection(from, candidates, direction);
      if (next) {
        setTabStop(next);
        hitEls.current.get(next)?.focus();
      }
    };

    const describe =
      props.describe ??
      ((node: EcoNode) =>
        `${node.label}, ${node.categoryLabel}, ${DIRECTION_LABEL[node.direction].toLowerCase()}`);
    const fillOf = (node: EcoNode): string => {
      if (node.ghost) return 'var(--ink-3)';
      if (mode === 'value') {
        const value = valueFor?.(node.id) ?? node.value ?? null;
        return value === null ? 'var(--c-neutral)' : stanceColor(value, valueScale);
      }
      return directionColor(node.direction, node.cluster);
    };

    // The selected party is already told in full beside the picture: its tooltip would only repeat it.
    const tipNode = tip && tip.id !== selectedId ? byId.get(tip.id) : undefined;
    const tipValue = tipNode && mode === 'value' ? (valueFor?.(tipNode.id) ?? null) : null;
    const zoomLabels = props.zoomLabels ?? {
      group: 'View',
      in: 'Zoom in',
      out: 'Zoom out',
      fit: 'Fit everything',
    };
    const clusterIds = layout.clusters.map((cluster) => cluster.id);

    return (
      <div
        ref={host}
        className={cx('sw-eco', props.className)}
        data-focus={focus && around ? 'on' : undefined}
        data-mode={mode}
        data-zoomed={zoomed ? 'true' : undefined}
      >
        <svg
          ref={svg}
          className="sw-eco__svg"
          viewBox={`0 0 ${size.width} ${size.height}`}
          role="group"
          aria-label={props.label}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            if (drag.current?.moved) publishView();
            drag.current = null;
          }}
        >
          <defs>
            <radialGradient id={`${uid}-sheen`} cx="34%" cy="28%" r="78%">
              <stop className="sw-eco__sheen-hi" offset="0%" stopColor="white" />
              <stop offset="55%" stopColor="white" stopOpacity="0" />
              <stop className="sw-eco__sheen-lo" offset="100%" stopColor="black" />
            </radialGradient>
            {clusterIds.map((id) => (
              <radialGradient key={id} id={`${uid}-halo-${id}`} cx="50%" cy="50%" r="50%">
                <stop
                  offset="0%"
                  style={{ stopColor: clusterColour(id) }}
                  className="sw-eco__halo-in"
                />
                <stop
                  offset="100%"
                  style={{ stopColor: clusterColour(id) }}
                  className="sw-eco__halo-out"
                />
              </radialGradient>
            ))}
          </defs>
          <g ref={viewport}>
            {showClusters && (
              <g className="sw-eco__clusters" aria-hidden="true">
                {clusterIds.map((id) => (
                  <g
                    key={id}
                    className={cx('sw-eco__cluster', hiddenClusters?.has(id) && 'is-off')}
                    style={{ '--cluster': clusterColour(id) } as CSSProperties}
                  >
                    <circle
                      ref={(el) =>
                        void (el ? haloEls.current.set(id, el) : haloEls.current.delete(id))
                      }
                      fill={`url(#${uid}-halo-${id})`}
                    />
                    <text
                      ref={(el) =>
                        void (el
                          ? clusterTextEls.current.set(id, el)
                          : clusterTextEls.current.delete(id))
                      }
                      textAnchor="middle"
                    >
                      <tspan className="sw-eco__pip">●</tspan>
                      <tspan dx="5">{clusterLabel(id)}</tspan>
                    </text>
                  </g>
                ))}
              </g>
            )}
            <g className="sw-eco__edges" aria-hidden="true">
              {liveEdges.map((edge) => {
                const from = byId.get(edge.from);
                const to = byId.get(edge.to);
                const off = Boolean(
                  hiddenClusters?.has(from?.cluster ?? '') ||
                  hiddenClusters?.has(to?.cluster ?? ''),
                );
                const joined = around?.edges.has(edge.id) ?? false;
                const dim = focus && around ? !joined : false;
                const hot = tip ? tip.id === edge.from || tip.id === edge.to : false;
                return (
                  <g
                    key={edge.id}
                    className={cx(
                      'sw-eco__edge',
                      joined && 'is-joined',
                      dim && 'is-dim',
                      off && 'is-off',
                      hot && 'is-hot',
                    )}
                    data-type={edge.type}
                    style={
                      {
                        '--w': (0.9 + edge.strength * 2).toFixed(2),
                        '--o': (0.22 + edge.strength * 0.38).toFixed(2),
                      } as CSSProperties
                    }
                  >
                    <title>{`${from?.label ?? edge.from} ${RELATION_LABEL[edge.type]} ${to?.label ?? edge.to}`}</title>
                    <path
                      ref={(el) =>
                        void (el
                          ? lineEls.current.set(edge.id, el)
                          : lineEls.current.delete(edge.id))
                      }
                      className="sw-eco__line"
                    />
                    {DIRECTED.has(edge.type) && (
                      <path
                        ref={(el) =>
                          void (el
                            ? headEls.current.set(edge.id, el)
                            : headEls.current.delete(edge.id))
                        }
                        className="sw-eco__head"
                      />
                    )}
                  </g>
                );
              })}
            </g>
            <g className="sw-eco__flows" aria-hidden="true">
              {flows.map((flow) => {
                const from = layout.positions.get(flow.from);
                const to = layout.positions.get(flow.to);
                if (!from || !to) return null;
                const path = edgePath(
                  from,
                  to,
                  layout.radii.get(flow.from) ?? 8,
                  layout.radii.get(flow.to) ?? 8,
                  0.18,
                );
                if (!path) return null;
                return (
                  <g key={flow.key} className="sw-eco__flow">
                    <path d={path} pathLength={1} />
                    {!reduced && (
                      <circle r="3.6" opacity="0">
                        <animateMotion
                          dur="1.1s"
                          path={path}
                          fill="freeze"
                          calcMode="spline"
                          keySplines="0.16 1 0.3 1"
                          keyTimes="0;1"
                        />
                        <animate
                          attributeName="opacity"
                          values="0;1;1;0"
                          keyTimes="0;0.1;0.82;1"
                          dur="1.1s"
                          fill="freeze"
                        />
                      </circle>
                    )}
                  </g>
                );
              })}
            </g>
            <g className="sw-eco__nodes">
              {all.map((node, index) => {
                const radius = layout.radii.get(node.id) ?? radiusOf(node.weight, layout.scale);
                const selected = selectedId === node.id;
                const off = hiddenClusters?.has(node.cluster) ?? false;
                const dim = focus && around ? !around.nodes.has(node.id) : false;
                const side = shownLabels.get(node.id) ?? 'below';
                const showLabel =
                  shownLabels.has(node.id) ||
                  selected ||
                  tip?.id === node.id ||
                  (focus && around ? around.nodes.has(node.id) : false) ||
                  (emphasis?.has(node.id) ?? false);
                const members =
                  node.kind === 'cohort' && !node.ghost
                    ? Math.min(7, Math.max(3, Math.round(Math.sqrt(node.members ?? 6))))
                    : 0;
                return (
                  <g
                    key={node.id}
                    ref={(el) =>
                      void (el ? nodeEls.current.set(node.id, el) : nodeEls.current.delete(node.id))
                    }
                    className={cx(
                      'sw-eco__node',
                      node.ghost && 'sw-eco__ghost',
                      selected && 'is-selected',
                      dim && 'is-dim',
                      off && 'is-off',
                      emphasis?.has(node.id) && 'is-emphasis',
                      node.status === 'proposed' && 'is-proposed',
                    )}
                    data-id={node.id}
                    data-kind={node.kind}
                    data-confidence={node.confidence}
                    data-direct={node.direct === null ? undefined : String(node.direct)}
                    aria-hidden={off || undefined}
                  >
                    <g
                      className="sw-eco__body"
                      style={
                        {
                          '--fill': fillOf(node),
                          '--delay': `${Math.min(index * 22, 400)}ms`,
                          '--o': OPACITY[node.confidence],
                        } as CSSProperties
                      }
                    >
                      {!node.ghost && (
                        <>
                          <circle className="sw-eco__aura sw-eco__aura--2" r={radius * 2.1} />
                          <circle className="sw-eco__aura" r={radius * 1.55} />
                        </>
                      )}
                      <circle className="sw-eco__ring" r={radius + 5} />
                      <circle className="sw-eco__core" r={radius} />
                      {!node.ghost && (
                        <circle className="sw-eco__sheen" r={radius} fill={`url(#${uid}-sheen)`} />
                      )}
                      {members > 0 && (
                        <g className="sw-eco__members">
                          {Array.from({ length: members }, (_, at) => {
                            const angle = (at / members) * Math.PI * 2 - Math.PI / 2;
                            return (
                              <circle
                                key={at}
                                cx={Math.cos(angle) * (radius + 10)}
                                cy={Math.sin(angle) * (radius + 10)}
                                r="1.8"
                              />
                            );
                          })}
                        </g>
                      )}
                      {node.ghost && (
                        <path
                          className="sw-eco__plus"
                          d={`M${-radius * 0.42} 0H${radius * 0.42}M0 ${-radius * 0.42}V${radius * 0.42}`}
                        />
                      )}
                      {node.status === 'proposed' && (
                        <circle
                          className="sw-eco__flag"
                          cx={radius * 0.74}
                          cy={-radius * 0.74}
                          r="4"
                        />
                      )}
                      {pulses
                        .filter((entry) => entry.id === node.id)
                        .map((entry) => (
                          <circle key={entry.key} className="sw-eco__pulse" r={radius} />
                        ))}
                      <g
                        className="sw-eco__tag"
                        ref={(el) =>
                          void (el
                            ? tagEls.current.set(node.id, el)
                            : tagEls.current.delete(node.id))
                        }
                      >
                        <text
                          className="sw-eco__label"
                          textAnchor={
                            side === 'right' ? 'start' : side === 'left' ? 'end' : 'middle'
                          }
                          data-visible={showLabel || undefined}
                        >
                          {node.label.length > 24 ? `${node.label.slice(0, 23)}…` : node.label}
                        </text>
                      </g>
                    </g>
                    <circle
                      ref={(el) =>
                        void (el ? hitEls.current.set(node.id, el) : hitEls.current.delete(node.id))
                      }
                      className="sw-eco__hit"
                      r={Math.max(radius + 7, 22)}
                      role="button"
                      tabIndex={off ? -1 : stop === node.id ? 0 : -1}
                      aria-label={node.ghost ? ghostLabel(node.label) : describe(node)}
                      aria-pressed={node.ghost ? undefined : selected}
                      data-stk-focus={`node:${node.id}`}
                      onClick={() => choose(node)}
                      onKeyDown={(event) => onNodeKey(event, node)}
                      onPointerEnter={(event) => event.pointerType !== 'touch' && showTip(node.id)}
                      onPointerLeave={() => hideTip(node.id)}
                      onFocus={(event) => {
                        setTabStop(node.id);
                        if (event.currentTarget.matches(':focus-visible')) showTip(node.id);
                      }}
                      onBlur={() => hideTip(node.id)}
                    />
                  </g>
                );
              })}
            </g>
          </g>
        </svg>

        {tipNode && tip && (
          <div
            className="sw-eco__tip sw-glass sw-glass--overlay"
            style={{
              // Kept in what is left to see: not under a panel that floats over the picture.
              left: Math.min(
                Math.max(tip.x, (props.covered?.left ?? 0) + 110),
                Math.max(size.width - (props.covered?.right ?? 0) - 110, 110),
              ),
              top: Math.max(tip.y, 56),
            }}
            role="presentation"
          >
            {props.tooltip ? (
              props.tooltip(tipNode)
            ) : (
              <>
                <strong>{tipNode.label}</strong>
                <span>
                  {tipNode.categoryLabel} · {DIRECTION_LABEL[tipNode.direction]}
                  {tipValue !== null ? ` · ${stanceWord(tipValue, valueScale)}` : ''}
                </span>
              </>
            )}
          </div>
        )}

        {controls && (
          <div className="sw-eco__controls sw-glass" role="group" aria-label={zoomLabels.group}>
            <IconButton label={zoomLabels.in} size="sm" onClick={() => zoomBy(1.25)}>
              <Plus size={16} aria-hidden="true" />
            </IconButton>
            <IconButton label={zoomLabels.out} size="sm" onClick={() => zoomBy(0.8)}>
              <Minus size={16} aria-hidden="true" />
            </IconButton>
            <IconButton label={zoomLabels.fit} size="sm" onClick={() => fitTo(null)}>
              <Maximize2 size={15} aria-hidden="true" />
            </IconButton>
          </div>
        )}
        {props.children}
      </div>
    );
  },
);
