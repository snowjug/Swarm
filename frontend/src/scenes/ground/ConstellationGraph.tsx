import { AnimatePresence } from 'motion/react';
import { Maximize2, Minus, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import {
  Chip,
  ChipButton,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Slider,
  Switch,
} from '../../design/ui';
import { useReducedMotion } from '../../design/motion';
import { useElementSize } from '../../hooks/useElementSize';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { NodePanel, KindIcon } from './NodePanel';
import { TopicFinder } from './TopicFinder';
import { useGroundActions, useGroundData, useGroundLit } from './context';
import { vars } from './css';
import {
  cycleGraphNode,
  curvePath,
  keyboardOrder,
  linkRanks,
  ringArcs,
  screenX,
  screenY,
  visibleEdgeIndexes,
  visibleLabelIds,
  visibleNodeIds,
  weightRange,
  type GraphFilter,
  type GraphNode,
  type GraphView,
  type LabelCandidate,
} from './graphModel';
import { documentColour } from './model';
import { useGraphViewport } from './useGraphViewport';
import './graph.css';

const PANEL_WIDTH = 328;

const shorten = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** The graph, drawn on the page and not in a box: a constellation of what the sources talk about. */
export function ConstellationGraph() {
  const { graph } = useGroundData();
  return graph ? <Canvas view={graph} /> : null;
}

function Canvas({ view }: { view: GraphView }) {
  const { documents, passages } = useGroundData();
  const actions = useGroundActions();
  const { lit, selection } = useGroundLit();
  const reduced = useReducedMotion();
  const wide = useMediaQuery('(min-width: 56rem)');
  // On a phone the caption is a line of its own above the controls (graph.css), and the drawing is fitted below it.
  const phone = useMediaQuery('(max-width: 40rem)');
  const { ref: surface, width, height } = useElementSize<HTMLDivElement>();
  const svg = useRef<SVGSVGElement>(null);
  const nodeRefs = useRef(new Map<string, SVGGElement>());
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    moved: boolean;
  } | null>(null);
  const suppress = useRef(false);

  const [hiddenTypes, setHiddenTypes] = useState<ReadonlySet<string>>(new Set());
  const range = useMemo(() => weightRange(view), [view]);
  const [minWeight, setMinWeight] = useState(0);
  const [linkNames, setLinkNames] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [finder, setFinder] = useState(false);

  const filter = useMemo<GraphFilter>(() => ({ hiddenTypes, minWeight }), [hiddenTypes, minWeight]);
  const visibleIds = useMemo(() => visibleNodeIds(view, filter), [view, filter]);
  const visibleEdges = useMemo(
    () => visibleEdgeIndexes(view, visibleIds, filter),
    [view, visibleIds, filter],
  );
  const shown = useMemo(
    () => view.nodes.filter((node) => visibleIds.has(node.id)),
    [view.nodes, visibleIds],
  );
  const order = useMemo(() => keyboardOrder(shown), [shown]);

  const ranks = useMemo(() => linkRanks(view.edges.map((edge) => edge.weight)), [view.edges]);
  const typeRow = view.types.length > 1;
  const selected = selection.node ? (view.byId.get(selection.node) ?? null) : null;
  const selectedEdge =
    selection.edge !== null
      ? (view.edges.find((edge) => edge.index === selection.edge) ?? null)
      : null;
  const panelOpen = Boolean(selected || selectedEdge);
  // Where the card floats over the graph, the drawing is fitted into what is left, so that nothing it covers is
  // lost; where the card sits below the graph (a narrow page), the graph keeps all of its space.
  const room = wide && panelOpen ? PANEL_WIDTH + 28 : 0;
  const inset = useMemo(
    () => ({
      x: wide ? 64 : 34,
      top: wide ? 64 : phone ? 84 : 56,
      bottom: (wide ? 84 : 92) + (typeRow ? 36 : 0),
      right: room,
    }),
    [wide, phone, typeRow, room],
  );
  const { viewport, set, fit, zoomBy, zoomNow, panBy, nudge, zoomed } = useGraphViewport({
    nodes: shown,
    width,
    height,
    inset,
    reduced,
  });

  const colourOf = useMemo(() => {
    const map = new Map(documents.map((doc) => [doc.id, documentColour(doc.index)]));
    return (id: string) => map.get(id) ?? 'var(--ink-3)';
  }, [documents]);

  const rovingId = active && visibleIds.has(active) ? active : (order[0] ?? null);

  // A topic chosen from anywhere (the finder, a passage, the keyboard) is brought into the clear if it is off
  // the page or under the card that opens for it. Only a change of the chosen topic moves the view, not the
  // view itself, so what the effect reads of the view it reads from here.
  const latest = useRef({ viewport, width, height, wide, nudge });
  latest.current = { viewport, width, height, wide, nudge };
  const chosen = selected?.id ?? null;
  useEffect(() => {
    const now = latest.current;
    const node = chosen ? view.byId.get(chosen) : null;
    if (!node || now.width <= 0) return;
    const at = { x: screenX(node, now.viewport), y: screenY(node, now.viewport) };
    const right = now.width - (now.wide ? PANEL_WIDTH + 40 : 36);
    let dx = 0;
    let dy = 0;
    if (at.x > right) dx = right - at.x;
    if (at.x < 36) dx = 36 - at.x;
    if (at.y < 56) dy = 56 - at.y;
    if (at.y > now.height - 100) dy = now.height - 100 - at.y;
    if (dx !== 0 || dy !== 0) now.nudge(dx, dy);
  }, [chosen, view]);

  // Closing the card hands the focus back to the topic it was about, so that the keyboard keeps its place.
  const wasOpen = useRef<string | null>(null);
  useEffect(() => {
    const id = selected?.id ?? null;
    if (id) wasOpen.current = id;
    else if (wasOpen.current && !panelOpen) {
      const back = wasOpen.current;
      wasOpen.current = null;
      const active = document.activeElement;
      if (!active || active === document.body || !document.body.contains(active)) {
        requestAnimationFrame(() => nodeRefs.current.get(back)?.focus({ preventScroll: true }));
      }
    }
  }, [selected?.id, panelOpen]);

  // Zoom with the wheel only when it is asked for (Ctrl or Command, or a trackpad pinch): the page scrolls otherwise.
  useEffect(() => {
    const element = svg.current;
    if (!element) return undefined;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const box = element.getBoundingClientRect();
      zoomNow(Math.exp(-event.deltaY * 0.0022), event.clientX - box.left, event.clientY - box.top);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [zoomNow]);

  // ---- Where everything is on the screen ---------------------------------------------------------------
  const places = useMemo(
    () =>
      new Map(
        view.nodes.map(
          (node) => [node.id, { x: screenX(node, viewport), y: screenY(node, viewport) }] as const,
        ),
      ),
    [view.nodes, viewport],
  );

  const shownLabels = useMemo(() => {
    const candidates: LabelCandidate[] = shown.map((node) => {
      const at = places.get(node.id)!;
      return {
        id: node.id,
        x: at.x,
        y: at.y,
        radius: node.radius,
        text: shorten(node.label, 24),
        rank: 1 - node.weight,
      };
    });
    // A few names at rest, the heaviest topics: the rest are named when they are pointed at, so that the picture reads.
    const named = new Set(
      [...shown]
        .sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label))
        .slice(0, phone ? 5 : wide ? 8 : 6)
        .map((node) => node.id),
    );
    return new Set([...visibleLabelIds(candidates, width)].filter((id) => named.has(id)));
  }, [shown, places, width, phone, wide]);

  const edgeFocus = selectedEdge?.index ?? null;
  const emphasised = (id: string) => lit.nodes.has(id) || lit.related.has(id);

  // ---- Hands and keys --------------------------------------------------------------------------------
  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || (event.target as Element).closest('[data-graph-item]')) return;
    if (event.pointerType === 'touch' && !zoomed) return;
    drag.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      vx: viewport.x,
      vy: viewport.y,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) < 4) return;
    start.moved = true;
    set({ ...viewport, x: start.vx + dx, y: start.vy + dy });
  };
  const endDrag = () => {
    if (drag.current?.moved) suppress.current = true;
    drag.current = null;
  };

  const choose = (node: GraphNode) => {
    setActive(node.id);
    actions.selectNode(node.id);
  };

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const focusedId =
      (event.target as Element).closest('[data-node-id]')?.getAttribute('data-node-id') ?? null;
    const current =
      (focusedId && view.byId.get(focusedId)) ||
      (rovingId ? view.byId.get(rovingId) : null) ||
      null;
    if (event.key === '[' || event.key === ']') {
      event.preventDefault();
      const next = cycleGraphNode(order, current?.id ?? '', event.key === ']' ? 1 : -1);
      if (next) {
        setActive(next);
        nodeRefs.current.get(next)?.focus();
      }
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && current && focusedId) {
      event.preventDefault();
      choose(current);
      return;
    }
    if (event.key === 'Escape') {
      if (panelOpen) {
        event.preventDefault();
        actions.selectNode(null);
      }
      return;
    }
    if (event.key === '+' || event.key === '=') zoomBy(1.25);
    else if (event.key === '-' || event.key === '_') zoomBy(1 / 1.25);
    else if (event.key.toLowerCase() === 'r') fit();
    else {
      const moves: Record<string, [number, number]> = {
        ArrowUp: [0, 36],
        ArrowDown: [0, -36],
        ArrowLeft: [36, 0],
        ArrowRight: [-36, 0],
      };
      const move = moves[event.key];
      if (!move) return;
      panBy(move[0], move[1]);
    }
    event.preventDefault();
  };

  const toggleType = (type: string) =>
    setHiddenTypes((old) => {
      const next = new Set(old);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });

  const documentsCiting = (documentId: string) =>
    view.nodes.filter((node) => node.documentIds.includes(documentId)).length;
  const hasRings = view.nodes.some((node) => node.shares.length > 0);
  // Which document each topic rests on is known once the passages are; until then the row that says it keeps its room.
  const citedPending = !hasRings && passages.loading;

  const caption =
    view.method === 'llm'
      ? 'Extracted by a model · may be incomplete'
      : 'Shared passages, not meaning';

  return (
    <div className="sw-ground-graph" data-has-panel={panelOpen} id="ground-graph">
      <div className="sw-ground-graph__surface" ref={surface} data-zoomed={zoomed || undefined}>
        <svg
          ref={svg}
          className="sw-ground-graph__svg"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="group"
          aria-label={`Source graph: ${view.nodes.length} ${view.method === 'llm' ? 'entities' : 'topics'}, ${view.edges.length} links. Press [ and ] to move between them, Enter to open one, arrow keys to pan, plus and minus to zoom, R to fit, Escape to close.`}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onClick={(event) => {
            if (suppress.current) {
              suppress.current = false;
              return;
            }
            if (!(event.target as Element).closest('[data-graph-item]')) actions.selectNode(null);
          }}
        >
          <defs>
            <radialGradient id="sw-ground-glow">
              <stop offset="0" style={{ stopColor: 'var(--accent)', stopOpacity: 0.32 }} />
              <stop offset="1" style={{ stopColor: 'var(--accent)', stopOpacity: 0 }} />
            </radialGradient>
          </defs>
          <g className="sw-ground-graph__edges">
            {view.edges.map((edge) => {
              const from = places.get(edge.source);
              const to = places.get(edge.target);
              if (!from || !to) return null;
              const on = visibleEdges.has(edge.index);
              const isLit = lit.edges.has(edge.index) || edgeFocus === edge.index;
              const d = curvePath(from.x, from.y, to.x, to.y, edge.index % 2 ? 0.1 : -0.1);
              return (
                <g
                  key={edge.index}
                  data-graph-item=""
                  className="sw-ground-edge"
                  data-hidden={!on || undefined}
                  data-lit={lit.active && isLit ? '' : undefined}
                  data-dim={lit.active && !isLit ? '' : undefined}
                  style={vars({
                    '--w': edge.weight,
                    '--r': (ranks[view.edges.indexOf(edge)] ?? 0).toFixed(2),
                    '--i': edge.index,
                  })}
                  onPointerEnter={(event) =>
                    event.pointerType === 'mouse' && actions.hover({ edge: edge.index })
                  }
                  onPointerLeave={(event) => event.pointerType === 'mouse' && actions.hover(null)}
                  onClick={() => on && actions.selectEdge(edge.index)}
                >
                  <path className="sw-ground-edge__hit" d={d} />
                  <path className="sw-ground-edge__line" d={d} pathLength={1} />
                  {on && (edgeFocus === edge.index || (linkNames && !(lit.active && !isLit))) && (
                    <text
                      className="sw-ground-edge__name"
                      x={(from.x + to.x) / 2}
                      y={(from.y + to.y) / 2 - 6}
                      textAnchor="middle"
                    >
                      {shorten(edge.label, 28)}
                    </text>
                  )}
                </g>
              );
            })}
          </g>

          <g className="sw-ground-graph__nodes">
            {view.nodes.map((node) => {
              const at = places.get(node.id);
              if (!at) return null;
              const on = visibleIds.has(node.id);
              const isSelected = selected?.id === node.id;
              const isLit = emphasised(node.id);
              const radius = node.radius;
              // The ring of a small topic would be too thin to read: it keeps one quiet ring, and the key tells the rest.
              const rings = radius >= 17 ? ringArcs(node.shares, radius - 1.6) : [];
              const ringsKey = node.shares.map((share) => share.documentId).join('+');
              return (
                <g
                  key={node.id}
                  ref={(element) => {
                    if (element) nodeRefs.current.set(node.id, element);
                    else nodeRefs.current.delete(node.id);
                  }}
                  data-graph-item=""
                  data-node-id={node.id}
                  className="sw-ground-node"
                  data-hidden={!on || undefined}
                  data-selected={isSelected || undefined}
                  data-lit={lit.active && isLit ? '' : undefined}
                  data-dim={lit.active && !isLit ? '' : undefined}
                  data-kind={node.kind}
                  transform={`translate(${at.x.toFixed(1)},${at.y.toFixed(1)})`}
                  style={vars({ '--i': node.index })}
                  role="button"
                  tabIndex={on && rovingId === node.id ? 0 : -1}
                  aria-hidden={!on || undefined}
                  aria-pressed={isSelected}
                  aria-label={`${node.label}, ${node.type}${
                    node.documentIds.length > 0
                      ? `, cited in ${node.documentIds.length} of ${documents.length} documents`
                      : ''
                  }`}
                  onClick={() => on && choose(node)}
                  onPointerEnter={(event) =>
                    event.pointerType === 'mouse' && actions.hover({ node: node.id })
                  }
                  onPointerLeave={(event) => event.pointerType === 'mouse' && actions.hover(null)}
                  onFocus={() => {
                    setActive(node.id);
                    actions.hover({ node: node.id });
                  }}
                  onBlur={() => actions.hover(null)}
                >
                  <circle className="sw-ground-node__hit" r={radius + 12} />
                  <g className="sw-ground-node__body">
                    <circle className="sw-ground-node__glow" r={radius * 2.1} />
                    <circle className="sw-ground-node__halo" r={radius + 6} />
                    <circle className="sw-ground-node__disc" r={radius} />
                    <g className="sw-ground-node__rings" key={ringsKey}>
                      {rings.length === 0 && (
                        <circle className="sw-ground-node__ring" r={radius - 1.6} />
                      )}
                      {rings.map((ring) =>
                        ring.full ? (
                          <circle
                            key={ring.documentId}
                            className="sw-ground-node__ring"
                            r={radius - 1.6}
                            style={{ stroke: colourOf(ring.documentId) }}
                          />
                        ) : (
                          <path
                            key={ring.documentId}
                            className="sw-ground-node__ring"
                            d={ring.d}
                            style={{ stroke: colourOf(ring.documentId) }}
                          />
                        ),
                      )}
                    </g>
                    {node.kind !== 'topic' && (
                      <g className="sw-ground-node__glyph" transform="translate(-7,-7)">
                        <KindIcon kind={node.kind} size={14} />
                      </g>
                    )}
                  </g>
                  <circle className="sw-ground-node__focus" r={radius + 5} />
                </g>
              );
            })}
          </g>

          <g className="sw-ground-graph__labels" aria-hidden="true">
            {shown.map((node) => {
              const at = places.get(node.id);
              if (!at) return null;
              const requested = selected?.id === node.id || lit.nodes.has(node.id);
              if (!requested && !shownLabels.has(node.id)) return null;
              const text = shorten(node.label, 24);
              const half = Math.min(width / 2 - 8, text.length * 3.7 + 4);
              const x = Math.max(half, Math.min(width - half, at.x));
              return (
                <text
                  key={node.id}
                  className="sw-ground-graph__label"
                  data-on={requested || undefined}
                  data-dim={lit.active && !emphasised(node.id) ? '' : undefined}
                  x={x}
                  y={at.y + node.radius + 16}
                  textAnchor="middle"
                >
                  {text}
                </text>
              );
            })}
          </g>
        </svg>
      </div>

      <div className="sw-ground-graph__top">
        <p className="sw-ground-graph__caption">{caption}</p>
        <div className="sw-ground-graph__tools sw-glass" role="toolbar" aria-label="Graph">
          <Popover open={finder} onOpenChange={setFinder}>
            <PopoverTrigger asChild>
              <IconButton label="Find a topic" size="sm">
                <Search size={17} aria-hidden="true" />
              </IconButton>
            </PopoverTrigger>
            <PopoverContent
              width="20rem"
              align="end"
              className="sw-ground-find"
              aria-label="Find a topic"
            >
              <TopicFinder
                view={view}
                visible={visibleIds}
                onChoose={(node) => {
                  setFinder(false);
                  choose(node);
                  requestAnimationFrame(() => nodeRefs.current.get(node.id)?.focus());
                }}
              />
            </PopoverContent>
          </Popover>
          <IconButton label="Zoom out" size="sm" shortcut="−" onClick={() => zoomBy(1 / 1.3)}>
            <Minus size={17} aria-hidden="true" />
          </IconButton>
          <IconButton label="Zoom in" size="sm" shortcut="+" onClick={() => zoomBy(1.3)}>
            <Plus size={17} aria-hidden="true" />
          </IconButton>
          <IconButton label="Fit to view" size="sm" shortcut="R" onClick={fit}>
            <Maximize2 size={16} aria-hidden="true" />
          </IconButton>
          <Popover>
            <PopoverTrigger asChild>
              <IconButton label="Graph options" size="sm">
                <SlidersHorizontal size={16} aria-hidden="true" />
              </IconButton>
            </PopoverTrigger>
            <PopoverContent width="18rem" align="end" aria-label="Graph options">
              <div className="sw-ground-options">
                <div className="sw-ground-options__row">
                  <span className="sw-ground-options__label" id="ground-link-strength">
                    Links shown
                  </span>
                  <span className="sw-ground-options__value num">
                    {visibleEdges.size} of {view.edges.length}
                  </span>
                </div>
                <Slider
                  label="Weakest link shown"
                  min={0}
                  max={Math.max(range.max, 0.01)}
                  step={0.05}
                  value={minWeight}
                  valueText={`${visibleEdges.size} of ${view.edges.length} links`}
                  disabled={view.edges.length === 0}
                  onValueChange={setMinWeight}
                />
                <Switch
                  label="Name the links"
                  checked={linkNames}
                  onChange={(event) => setLinkNames(event.target.checked)}
                />
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="sw-ground-graph__legend" role="group" aria-label="Filter by document">
        {(hasRings || citedPending) && (
          <ul className="sw-ground-legend" role="list" data-pending={citedPending || undefined}>
            <li className="sw-ground-legend__label" aria-hidden="true">
              Cited in
            </li>
            {documents.map((doc) => {
              const cites = documentsCiting(doc.id);
              const pressed = selection.pinnedDocument === doc.id;
              return (
                <li key={doc.id} style={vars({ '--doc': documentColour(doc.index) })}>
                  <ChipButton
                    size="sm"
                    pressed={pressed}
                    disabled={cites === 0}
                    className="sw-ground-legend__chip"
                    title={`${doc.name}: ${cites} cite${cites === 1 ? 's' : ''} it`}
                    aria-label={`${doc.id}: ${doc.name}, cited by ${cites} ${view.method === 'llm' ? 'entities' : 'topics'}`}
                    onClick={() => actions.pinDocument(pressed ? null : doc.id)}
                    onPointerEnter={(event) =>
                      event.pointerType === 'mouse' && actions.hover({ document: doc.id })
                    }
                    onPointerLeave={(event) => event.pointerType === 'mouse' && actions.hover(null)}
                  >
                    <i aria-hidden="true" />
                    {doc.id}
                  </ChipButton>
                </li>
              );
            })}
          </ul>
        )}
        {view.types.length > 1 && (
          <ul
            className="sw-ground-legend sw-ground-legend--types"
            role="list"
            aria-label="Show by type"
          >
            {view.types.map((info) => (
              <li key={info.type}>
                <ChipButton
                  size="sm"
                  pressed={!hiddenTypes.has(info.type)}
                  icon={<KindIcon kind={info.kind} size={13} />}
                  onClick={() => toggleType(info.type)}
                >
                  {info.type}
                  <span className="num sw-ground-legend__count">{info.count}</span>
                </ChipButton>
              </li>
            ))}
          </ul>
        )}
        {shown.length === 0 && (
          <Chip tone="caution" size="sm">
            Every type is hidden
          </Chip>
        )}
      </div>

      <AnimatePresence initial={false}>
        {panelOpen && <NodePanel key="panel" view={view} node={selected} edge={selectedEdge} />}
      </AnimatePresence>
      <p className="sr-only" role="status">
        {selected ? `${selected.label} selected.` : ''}
      </p>
    </div>
  );
}
