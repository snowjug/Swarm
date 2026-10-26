import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { Maximize2, Minus, Plus, RotateCcw, ScanSearch } from 'lucide-react';
import type { ProjectDetail } from '../../../../shared/types';
import { layoutGraph } from '../../lib/graph';
import type { GraphInput, GraphPoint, Inspection } from '../../lib/graph';
import { EmptyPanel } from '../ui';

const palette = [
  '#6087bb',
  '#b77b59',
  '#7d9b66',
  '#a684b9',
  '#c8a348',
  '#5b9a99',
  '#b76c81',
  '#8390a1',
];
const initialTransform = { x: 500, y: 350, k: 1 };
const clamp = (value: number) => Math.max(0.3, Math.min(3.5, value));
function fitGraph(nodes: GraphPoint[]) {
  if (!nodes.length) return initialTransform;
  const xs = nodes.map((node) => node.x ?? 0);
  const ys = nodes.map((node) => node.y ?? 0);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const k = Math.min(1.4, 820 / Math.max(100, right - left), 530 / Math.max(100, bottom - top));
  return { k, x: 500 - ((left + right) / 2) * k, y: 350 - ((top + bottom) / 2) * k };
}

export function GraphCanvas({
  project,
  onInspect,
}: {
  project: ProjectDetail;
  onInspect: (selection: Inspection) => void;
}) {
  const [overlays, setOverlays] = useState(true);
  const [edgeLabels, setEdgeLabels] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [transform, setTransform] = useState(initialTransform);
  const [selected, setSelected] = useState('');
  const svg = useRef<SVGSVGElement>(null);
  const fitted = useRef(false);
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
    () => layoutGraph(JSON.parse(signature) as GraphInput, overlays),
    [signature, overlays],
  );
  const sourceTypes = [
    ...new Set(graph.nodes.filter((node) => node.layer === 'source').map((node) => node.type)),
  ].sort();
  const colors = new Map(
    sourceTypes.map((type, index) => [type, palette[index % palette.length]!]),
  );
  colors.set('SIMULATED actor', '#20242b');
  colors.set('SIMULATED memory', '#d87937');
  const types = [...new Set(graph.nodes.map((node) => node.type))];
  const visible = graph.nodes.filter((node) => !hidden.has(node.type));
  const visibleIds = new Set(visible.map((node) => node.id));
  const lines = graph.links.filter(
    (line) =>
      visibleIds.has((line.source as GraphPoint).id) &&
      visibleIds.has((line.target as GraphPoint).id),
  );

  useEffect(() => {
    if (!fitted.current && graph.nodes.length) {
      setTransform(fitGraph(graph.nodes));
      fitted.current = true;
    }
  }, [graph]);

  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const x = ((event.clientX - rect.left) * 1000) / rect.width;
      const y = ((event.clientY - rect.top) * 700) / rect.height;
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
      return { k, x: 500 - ((500 - old.x) * k) / old.k, y: 350 - ((350 - old.y) * k) / old.k };
    });
  const open = (node: GraphPoint) => {
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
    if (!start || start.pointer !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setTransform((old) => ({
      ...old,
      x: start.tx + ((event.clientX - start.x) * 1000) / rect.width,
      y: start.ty + ((event.clientY - start.y) * 700) / rect.height,
    }));
  };
  const graphKeys = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === '+' || event.key === '=') zoom(1.2);
    else if (event.key === '-') zoom(1 / 1.2);
    else if (event.key.toLowerCase() === 'r') setTransform(fitGraph(graph.nodes));
    else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      const offsets: Record<string, [number, number]> = {
        ArrowUp: [0, 30],
        ArrowDown: [0, -30],
        ArrowLeft: [30, 0],
        ArrowRight: [-30, 0],
      };
      const [x, y] = offsets[event.key]!;
      setTransform((old) => ({ ...old, x: old.x + x, y: old.y + y }));
    } else return;
    event.preventDefault();
  };

  return (
    <section className="graph-panel" aria-label="Interactive source graph and simulated overlays">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">KNOWLEDGE + MEMORY</span>
          <h2>
            {project.graph?.method === 'lexical'
              ? 'Lexical topic map'
              : project.graph?.method === 'llm'
                ? 'Source-grounded graph'
                : 'Graph workspace'}
          </h2>
        </div>
        <span className="mono muted">
          {project.graph?.nodes.length ?? 0} N · {project.graph?.edges.length ?? 0} E
        </span>
      </div>
      <div className="graph-controls">
        <label>
          <input
            type="checkbox"
            checked={overlays}
            onChange={(event) => {
              fitted.current = false;
              setOverlays(event.target.checked);
            }}
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
            type="button"
            className="icon-button"
            aria-label="Zoom out"
            onClick={() => zoom(1 / 1.25)}
          >
            <Minus size={15} />
          </button>
          <span className="mono">{Math.round(transform.k * 100)}%</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Zoom in"
            onClick={() => zoom(1.25)}
          >
            <Plus size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Reset graph pan and zoom to fit recorded nodes"
            onClick={() => setTransform(fitGraph(graph.nodes))}
          >
            <RotateCcw size={15} />
          </button>
        </div>
      </div>
      <div className="graph-surface">
        <svg
          ref={svg}
          viewBox="0 0 1000 700"
          role="group"
          aria-label="Graph. Drag background to pan, scroll to zoom. Keyboard: arrows pan, plus/minus zoom, R resets. Select a node to inspect."
          tabIndex={0}
          onKeyDown={graphKeys}
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
              <circle cx="1" cy="1" r="0.8" fill="#dfe2e6" />
            </pattern>
          </defs>
          <rect width="1000" height="700" fill={`url(#${pattern})`} />
          <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
            {lines.map((line) => {
              const source = line.source as GraphPoint;
              const target = line.target as GraphPoint;
              const inspect = () => {
                if (line.evidenceIndex !== undefined)
                  onInspect({ kind: 'edge', index: line.evidenceIndex });
                else if (line.memoryId) onInspect({ kind: 'memory', id: line.memoryId });
              };
              return (
                <g
                  key={line.id}
                  data-graph-item=""
                  className={`graph-edge ${line.simulated ? 'simulated' : ''}`}
                  onClick={inspect}
                  role={line.evidenceIndex !== undefined || line.memoryId ? 'button' : undefined}
                  aria-label={`${line.simulated ? 'Simulated' : 'Source'} relationship: ${source.label} — ${line.label} — ${target.label}`}
                  tabIndex={line.evidenceIndex !== undefined ? 0 : undefined}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      inspect();
                    }
                  }}
                >
                  <line
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    className="edge-hit"
                  />
                  <line
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    className="edge-line"
                  />
                  {edgeLabels && (
                    <text
                      x={((source.x ?? 0) + (target.x ?? 0)) / 2}
                      y={((source.y ?? 0) + (target.y ?? 0)) / 2 - 4}
                    >
                      {line.label}
                    </text>
                  )}
                </g>
              );
            })}
            {visible.map((node) => (
              <g
                key={node.id}
                data-graph-item=""
                transform={`translate(${node.x},${node.y})`}
                className={`graph-node ${node.layer} ${selected === node.id ? 'selected' : ''}`}
                role="button"
                tabIndex={0}
                aria-label={`${node.layer === 'source' ? 'Source' : 'Simulated'} ${node.type}: ${node.label}. Inspect.`}
                onClick={() => open(node)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    open(node);
                  }
                }}
              >
                <title>
                  {node.label} · {node.type}
                </title>
                {node.layer === 'actor' ? (
                  <rect
                    x={-node.radius}
                    y={-node.radius}
                    width={node.radius * 2}
                    height={node.radius * 2}
                    rx={3}
                    fill={colors.get(node.type)}
                  />
                ) : node.layer === 'memory' ? (
                  <polygon
                    points={`0,${-node.radius - 2} ${node.radius + 2},0 0,${node.radius + 2} ${-node.radius - 2},0`}
                    fill={colors.get(node.type)}
                  />
                ) : (
                  <circle r={node.radius} fill={colors.get(node.type)} />
                )}
                {(node.layer !== 'memory' || transform.k >= 1.2 || selected === node.id) && (
                  <text y={node.radius + 15} textAnchor="middle">
                    {node.label.length > 32 ? `${node.label.slice(0, 30)}…` : node.label}
                  </text>
                )}
              </g>
            ))}
          </g>
        </svg>
        {!graph.nodes.length && (
          <div className="graph-empty">
            <EmptyPanel title="No graph output recorded" icon={<ScanSearch size={28} />}>
              Graph Build creates the source map. Nodes appear only when the API returns actual
              graph data.
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
        <span className="graph-pan-hint mono">
          <Maximize2 size={11} /> DRAG TO PAN · SCROLL TO ZOOM
        </span>
      </div>
      <div className="graph-legend" aria-label="Filter graph node types">
        {types.map((type) => (
          <button
            key={type}
            type="button"
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
      {!!graph.nodes.length && (
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
              <option key={node.id} value={node.id}>
                {node.type} / {node.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="graph-caption">
        Solid circles / lines: source graph with citations. Squares, diamonds and dashed links:{' '}
        <strong>SIMULATED assumptions / recorded memory, not source facts.</strong>
        {overlays &&
          !!project.console?.memories.length &&
          ` Showing latest ${graph.shownMemories} of ${project.console.memories.length} recorded memories; all remain inspectable in Simulation.`}
        {!project.console && ' This quick run did not record guided platform memory overlays.'}
      </p>
    </section>
  );
}
