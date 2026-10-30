import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { Minus, Plus, RotateCcw, ScanSearch } from 'lucide-react';
import type { ProjectDetail } from '../../../../shared/types';
import { cycleGraphNode, labelCenterX, layoutGraph, visibleLabelIds } from '../../lib/graph';
import type { GraphInput, GraphPoint, Inspection, LabelCandidate } from '../../lib/graph';
import { useElementSize } from '../../hooks/useElementSize';
import { EmptyPanel } from '../ui';
import { GraphRoundControl } from './GraphRoundControl';

const palette = [
  'var(--graph-1)',
  'var(--graph-2)',
  'var(--graph-3)',
  'var(--graph-4)',
  'var(--graph-5)',
  'var(--graph-6)',
  'var(--graph-7)',
  'var(--graph-8)',
];
interface Transform {
  x: number;
  y: number;
  k: number;
}
const clamp = (value: number) => Math.max(0.08, Math.min(4, value));
function fit(nodes: GraphPoint[], width: number, height: number): Transform {
  if (!nodes.length) return { x: width / 2, y: height / 2, k: 1 };
  const xs = nodes.map((node) => node.x ?? 0);
  const ys = nodes.map((node) => node.y ?? 0);
  const left = Math.min(...xs),
    right = Math.max(...xs),
    top = Math.min(...ys),
    bottom = Math.max(...ys);
  const k = Math.min(
    1.6,
    Math.max(40, width - 120) / Math.max(100, right - left),
    Math.max(40, height - 90) / Math.max(100, bottom - top),
  );
  return { k, x: width / 2 - ((left + right) * k) / 2, y: height / 2 - ((top + bottom) * k) / 2 };
}
const shortLabel = (label: string, maximum: number) =>
  label.length > maximum ? `${label.slice(0, maximum - 1)}…` : label;

export function GraphCanvas({
  project,
  onInspect,
  evolution = false,
}: {
  project: ProjectDetail;
  onInspect: (selection: Inspection) => void;
  evolution?: boolean;
}) {
  const [overlays, setOverlays] = useState(true);
  const [edgeLabels, setEdgeLabels] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [transform, setTransform] = useState<Transform>({ x: 160, y: 210, k: 1 });
  const [selected, setSelected] = useState('');
  const [activeId, setActiveId] = useState('');
  const [highlighted, setHighlighted] = useState('');
  const [round, setRound] = useState<number | null>(null);
  const completed = project.rounds.length;
  const selectedRound = Math.min(round ?? completed, completed);
  const changeRound = useCallback((value: number) => setRound(value), []);
  const { ref: surface, width, height } = useElementSize<HTMLDivElement>();
  const svg = useRef<SVGSVGElement>(null);
  const nodeRefs = useRef(new Map<string, SVGGElement>());
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; pointer: number } | null>(
    null,
  );
  const pattern = useId().replace(/:/gu, '');
  const signature = JSON.stringify({
    graph: project.graph,
    agents: project.agents.map(({ id, name, topicIds }) => ({ id, name, topicIds })),
    memories: project.console?.memories ?? [],
    seed: project.settings.seed,
  } satisfies GraphInput);
  const graph = useMemo(
    () =>
      layoutGraph(
        JSON.parse(signature) as GraphInput,
        overlays,
        evolution ? selectedRound : undefined,
      ),
    [signature, overlays, evolution, selectedRound],
  );
  const sourceTypes = [
    ...new Set(graph.nodes.filter((node) => node.layer === 'source').map((node) => node.type)),
  ].sort();
  const colors = new Map(
    sourceTypes.map((type, index) => [type, palette[index % palette.length]!]),
  );
  colors.set('SIMULATED actor', 'var(--graph-actor)');
  colors.set('SIMULATED memory', 'var(--graph-memory)');
  const types = [...new Set(graph.nodes.map((node) => node.type))];
  const visible = graph.nodes.filter((node) => !hidden.has(node.type));
  const activeNode = visible.find((node) => node.id === activeId) ?? visible[0];
  const visibleIds = new Set(visible.map((node) => node.id));
  const lines = graph.links.filter(
    (line) =>
      visibleIds.has((line.source as GraphPoint).id) &&
      visibleIds.has((line.target as GraphPoint).id),
  );
  useLayoutEffect(() => {
    setTransform(fit(graph.nodes, width, height));
  }, [graph, width, height]);
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const x = event.clientX - rect.left,
        y = event.clientY - rect.top;
      setTransform((old) => {
        const k = clamp(old.k * Math.exp(-event.deltaY * 0.001));
        return { k, x: x - ((x - old.x) * k) / old.k, y: y - ((y - old.y) * k) / old.k };
      });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  const zoom = (amount: number) =>
    setTransform((old) => {
      const k = clamp(old.k * amount);
      return {
        k,
        x: width / 2 - ((width / 2 - old.x) * k) / old.k,
        y: height / 2 - ((height / 2 - old.y) * k) / old.k,
      };
    });
  const open = (node: GraphPoint) => {
    setActiveId(node.id);
    setSelected(node.id);
    onInspect({
      kind: node.layer === 'source' ? 'node' : node.layer === 'actor' ? 'agent' : 'memory',
      id: node.referenceId,
    });
  };
  const pointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || (event.target as Element).closest('[data-graph-item]')) return;
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      tx: transform.x,
      ty: transform.y,
      pointer: event.pointerId,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const start = drag.current;
    if (start?.pointer === event.pointerId)
      setTransform((old) => ({
        ...old,
        x: start.tx + event.clientX - start.x,
        y: start.ty + event.clientY - start.y,
      }));
  };
  const keys = (event: KeyboardEvent<SVGSVGElement>) => {
    const focusedId = (event.target as Element)
      .closest('[data-node-id]')
      ?.getAttribute('data-node-id');
    const current = visible.find((node) => node.id === focusedId) ?? activeNode;
    if (event.key === '[' || event.key === ']') {
      event.preventDefault();
      const next = cycleGraphNode(
        visible.map((node) => node.id),
        current?.id ?? '',
        event.key === ']' ? 1 : -1,
      );
      if (next) {
        setActiveId(next);
        nodeRefs.current.get(next)?.focus();
      }
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      if (current) {
        event.preventDefault();
        open(current);
      }
      return;
    }
    if (event.key === '+' || event.key === '=') zoom(1.2);
    else if (event.key === '-') zoom(1 / 1.2);
    else if (event.key.toLowerCase() === 'r') setTransform(fit(graph.nodes, width, height));
    else {
      const offsets: Record<string, [number, number]> = {
        ArrowUp: [0, 30],
        ArrowDown: [0, -30],
        ArrowLeft: [30, 0],
        ArrowRight: [-30, 0],
      };
      const offset = offsets[event.key];
      if (!offset) return;
      setTransform((old) => ({ ...old, x: old.x + offset[0], y: old.y + offset[1] }));
    }
    event.preventDefault();
  };
  const fontSize = 12 / transform.k;
  const labelTextFor = (node: GraphPoint) =>
    shortLabel(
      node.label,
      Math.min(node.layer === 'memory' ? 22 : 25, Math.max(8, Math.floor((width - 20) / 12))),
    );
  // Labels stay 12 px while the graph is fitted into the panel, so a dozen nodes would pile up.
  // Memory labels appear only on request; the others are drawn only where they do not overlap,
  // source entities before simulated actors. A hidden label stays in the "Inspect node" list.
  const shownLabels = visibleLabelIds(
    visible
      .filter((node) => node.layer !== 'memory')
      .map((node): LabelCandidate => ({
        id: node.id,
        x: transform.x + (node.x ?? 0) * transform.k,
        y: transform.y + (node.y ?? 0) * transform.k,
        radius: Math.max(node.radius * transform.k, 6),
        text: labelTextFor(node),
        rank: (node.layer === 'source' ? 0 : 1000) - node.radius,
      })),
    width,
  );
  return (
    <section className="graph-panel" aria-label="Interactive source graph and simulated overlays">
      <div className="panel-heading">
        <h2>
          {project.graph?.method === 'lexical'
            ? 'Lexical topic map'
            : project.graph
              ? 'Source-grounded graph'
              : 'Graph workspace'}
        </h2>
        <span className="mono">
          {project.graph?.nodes.length ?? 0} N · {project.graph?.edges.length ?? 0} E
        </span>
      </div>
      <div className="graph-controls">
        <label>
          <input
            type="checkbox"
            checked={overlays}
            onChange={(event) => setOverlays(event.target.checked)}
          />{' '}
          Simulated overlays
        </label>
        <label>
          <input
            type="checkbox"
            checked={edgeLabels}
            onChange={(event) => setEdgeLabels(event.target.checked)}
          />{' '}
          Edge labels
        </label>
        <div className="graph-zoom">
          <button
            className="icon-button"
            type="button"
            aria-label="Zoom out"
            onClick={() => zoom(1 / 1.25)}
          >
            <Minus size={18} />
          </button>
          <span className="mono">{Math.round(transform.k * 100)}%</span>
          <button
            className="icon-button"
            type="button"
            aria-label="Zoom in"
            onClick={() => zoom(1.25)}
          >
            <Plus size={18} />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Reset graph to fit all recorded nodes"
            onClick={() => setTransform(fit(graph.nodes, width, height))}
          >
            <RotateCcw size={18} />
          </button>
        </div>
      </div>
      <div className="graph-surface" ref={surface}>
        <svg
          ref={svg}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          role="group"
          aria-label="Graph. Use [ and ] to cycle nodes, Enter or Space to inspect. Drag or use arrow keys to pan; plus/minus zoom and R resets. Control or Command plus scroll zooms; ordinary scrolling moves the page. Inspect node provides an equivalent keyboard list."
          tabIndex={activeNode ? -1 : 0}
          onKeyDown={keys}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        >
          <defs>
            <pattern id={pattern} width="25" height="25" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r=".8" fill="var(--graph-dot)" />
            </pattern>
          </defs>
          <rect width={width} height={height} fill={`url(#${pattern})`} />
          <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
            {lines.map((line) => {
              const source = line.source as GraphPoint,
                target = line.target as GraphPoint;
              const inspect = () => {
                if (line.evidenceIndex !== undefined)
                  onInspect({ kind: 'edge', index: line.evidenceIndex });
                else if (line.memoryId) onInspect({ kind: 'memory', id: line.memoryId });
              };
              const interactive = line.evidenceIndex !== undefined || Boolean(line.memoryId);
              return (
                <g
                  key={line.id}
                  data-graph-item=""
                  className={`graph-edge ${line.simulated ? 'simulated' : ''}`}
                  aria-hidden="true"
                  onClick={interactive ? inspect : undefined}
                >
                  <line
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    className="edge-hit"
                    strokeWidth={24 / transform.k}
                  />
                  <line
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    className="edge-line"
                    vectorEffect="non-scaling-stroke"
                  />
                  {edgeLabels && (
                    <text
                      x={((source.x ?? 0) + (target.x ?? 0)) / 2}
                      y={((source.y ?? 0) + (target.y ?? 0)) / 2 - 4 / transform.k}
                      fontSize={fontSize}
                    >
                      {shortLabel(line.label, 24)}
                    </text>
                  )}
                </g>
              );
            })}
            {visible.map((node) => {
              const radius = Math.max(node.radius, 6 / transform.k);
              const label = labelTextFor(node);
              return (
                <g
                  key={node.id}
                  data-graph-item=""
                  data-node-id={node.id}
                  ref={(element) => {
                    if (element) nodeRefs.current.set(node.id, element);
                    else nodeRefs.current.delete(node.id);
                  }}
                  transform={`translate(${node.x},${node.y})`}
                  className={`graph-node ${node.layer} ${selected === node.id ? 'selected' : ''}`}
                  role="button"
                  tabIndex={activeNode?.id === node.id ? 0 : -1}
                  aria-label={`${label}, ${node.layer === 'source' ? 'source' : 'simulated'} ${node.type}. Inspect ${node.label}.`}
                  onClick={() => open(node)}
                  onMouseEnter={() => setHighlighted(node.id)}
                  onMouseLeave={() => setHighlighted('')}
                  onFocus={() => {
                    setActiveId(node.id);
                    setHighlighted(node.id);
                  }}
                  onBlur={() => setHighlighted('')}
                >
                  <title>
                    {node.label} · {node.type}
                  </title>
                  <circle
                    r={Math.max(radius, 12 / transform.k)}
                    fill="transparent"
                    className="node-hit"
                  />
                  {node.layer === 'actor' ? (
                    <rect
                      x={-radius}
                      y={-radius}
                      width={radius * 2}
                      height={radius * 2}
                      rx={2 / transform.k}
                      fill={colors.get(node.type)}
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : node.layer === 'memory' ? (
                    <polygon
                      points={`0,${-radius} ${radius},0 0,${radius} ${-radius},0`}
                      fill={colors.get(node.type)}
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : (
                    <circle
                      r={radius}
                      fill={colors.get(node.type)}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                </g>
              );
            })}
            {/*
              Labels are drawn after every node, in one layer of their own. Inside a node's group a later
              node's shape was painted over an earlier node's label, so in a crowded graph a name could
              be cut in half by a marker. The nodes carry the accessible names; these are decoration.
            */}
            <g className="graph-labels" aria-hidden="true">
              {visible.map((node) => {
                const requested = node.id === selected || node.id === highlighted;
                if (!requested && (node.layer === 'memory' || !shownLabels.has(node.id))) {
                  return null;
                }
                const radius = Math.max(node.radius, 6 / transform.k);
                const label = labelTextFor(node);
                const screenX = transform.x + (node.x ?? 0) * transform.k;
                const labelX = (labelCenterX(screenX, label, width) - screenX) / transform.k;
                return (
                  <text
                    key={node.id}
                    className={`graph-label ${node.layer}`}
                    x={(node.x ?? 0) + labelX}
                    y={(node.y ?? 0) + radius + 14 / transform.k}
                    textAnchor="middle"
                    fontSize={fontSize}
                  >
                    {label}
                  </text>
                );
              })}
            </g>
          </g>
        </svg>
        {!graph.nodes.length && (
          <div className="graph-empty">
            <EmptyPanel title="No graph output recorded" icon={<ScanSearch size={28} />}>
              Graph nodes appear only when returned by the API.
            </EmptyPanel>
          </div>
        )}
        {!!graph.nodes.length && !visible.length && (
          <div className="graph-empty">
            <p>All node types are filtered out.</p>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => setHidden(new Set())}
            >
              Show all types
            </button>
          </div>
        )}
      </div>
      {evolution && (
        <GraphRoundControl round={selectedRound} completed={completed} onChange={changeRound} />
      )}
      <div className="graph-legend" role="group" aria-label="Filter graph node types">
        {types.map((type) => (
          <button
            type="button"
            key={type}
            aria-pressed={!hidden.has(type)}
            className={hidden.has(type) ? 'muted-filter' : ''}
            onClick={() =>
              setHidden((old) => {
                const next = new Set(old);
                if (next.has(type)) next.delete(type);
                else next.add(type);
                return next;
              })
            }
          >
            <span
              className={`legend-shape ${type.startsWith('SIMULATED') ? 'simulated' : ''}`}
              style={{ background: colors.get(type) }}
            />
            {type}{' '}
            <span className="mono">{graph.nodes.filter((node) => node.type === type).length}</span>
          </button>
        ))}
      </div>
      <label className="graph-accessible-select">
        Inspect node
        <select
          value={selected && visibleIds.has(selected) ? selected : ''}
          onChange={(event) => {
            const node = visible.find((item) => item.id === event.target.value);
            if (node) open(node);
          }}
        >
          <option value="">Choose a visible node…</option>
          {visible.map((node) => (
            <option value={node.id} key={node.id}>
              {node.type} / {node.label}
            </option>
          ))}
        </select>
      </label>
      <p className="graph-caption">
        Solid circles / lines: static source graph with citations. Squares, diamonds and dashed
        links: <strong>SIMULATED assumptions and saved memory, not source evidence.</strong>
        {overlays &&
          ` Showing latest ${graph.shownMemories} of ${graph.eligibleMemories} eligible saved memories${evolution ? ` through round ${selectedRound}` : ''}.`}{' '}
        Memory labels appear only on selection, hover or keyboard focus. Use +/− or Ctrl/⌘ + scroll
        to zoom. Keyboard: [ and ] cycle nodes; Enter or Space inspects; arrow keys pan; R resets.
      </p>
    </section>
  );
}
