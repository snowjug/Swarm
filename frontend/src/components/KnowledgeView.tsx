import { useId, useMemo, useState } from 'react';
import { ArrowUpRight, GitBranch, Network, ZoomIn } from 'lucide-react';
import type { KnowledgeGraph } from '../../../shared/types';
import { EmptyPanel, Notice, SourceLinks } from './ui';

const nodeColors = {
  topic: '#72d9c0',
  person: '#b4a0f1',
  organization: '#e7bf7a',
  group: '#80b9e5',
};

export function KnowledgeView({
  graph,
  onSource,
}: {
  graph: KnowledgeGraph | null;
  onSource: (id: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const graphTitleId = useId();
  const layout = useMemo(() => {
    const nodes = graph?.nodes ?? [];
    return nodes.map((node, index) => {
      const angle = index * 2.3999632297 - Math.PI / 2;
      const radius =
        nodes.length <= 1 ? 0 : 45 + Math.sqrt(index / Math.max(1, nodes.length - 1)) * 153;
      return {
        ...node,
        x: 330 + Math.cos(angle) * radius * 1.32,
        y: 230 + Math.sin(angle) * radius,
      };
    });
  }, [graph]);
  if (!graph || !graph.nodes.length) {
    return (
      <EmptyPanel
        title="The context is still taking shape"
        icon={<Network size={27} aria-hidden="true" />}
      >
        A knowledge map appears after the knowledge stage. Run the experiment to extract topics from
        your sources.
      </EmptyPanel>
    );
  }
  const selected = graph.nodes.find((node) => node.id === selectedId) ?? graph.nodes[0];
  const relatedEdges = selected
    ? graph.edges.filter((edge) => edge.source === selected.id || edge.target === selected.id)
    : [];
  const positionById = new Map(layout.map((node) => [node.id, node]));
  const lexical = graph.method === 'lexical';
  return (
    <div className="view-stack">
      <div className="section-heading">
        <div>
          <span className="eyebrow">MAPPING THE CONTEXT</span>
          <h2>Connections worth a closer look.</h2>
        </div>
        <span className={`method-tag ${!lexical ? 'method-tag-violet' : ''}`}>
          <GitBranch size={13} aria-hidden="true" />{' '}
          {lexical ? 'LEXICAL EXTRACTION · NOT AI' : 'MODEL-EXTRACTED'}
        </span>
      </div>
      <Notice title={lexical ? 'Topics, not established facts' : 'Model-inferred relationships'}>
        {lexical
          ? 'Local nodes are frequent topics. Edges indicate co-occurrence in source text, not verified semantic relationships or established facts.'
          : 'Nodes and relationships were extracted by a language model. Treat them as fallible interpretations and inspect the source excerpts.'}
      </Notice>
      <div className="knowledge-layout">
        <div className="card graph-card">
          <div className="card-toolbar">
            <span>
              <Network size={15} aria-hidden="true" /> SOURCE MAP
            </span>
            <span>
              {graph.nodes.length} nodes <span className="toolbar-divider">/</span>{' '}
              {graph.edges.length} connections
            </span>
          </div>
          <svg
            viewBox="0 0 660 460"
            className="knowledge-svg"
            role="group"
            aria-labelledby={graphTitleId}
          >
            <title id={graphTitleId}>
              {lexical
                ? 'Interactive frequent-topic co-occurrence map'
                : 'Interactive model-extracted knowledge map'}
              . Select a node for context and sources.
            </title>
            <defs>
              <pattern
                id={`${graphTitleId}-dots`}
                width="23"
                height="23"
                patternUnits="userSpaceOnUse"
              >
                <circle cx="1" cy="1" r=".7" fill="#394b4c" />
              </pattern>
            </defs>
            <rect width="660" height="460" fill={`url(#${graphTitleId}-dots)`} opacity=".5" />
            {graph.edges.map((edge, index) => {
              const from = positionById.get(edge.source);
              const to = positionById.get(edge.target);
              if (!from || !to) return null;
              const highlighted =
                selected && (edge.source === selected.id || edge.target === selected.id);
              return (
                <line
                  key={`${edge.source}-${edge.target}-${index}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={highlighted ? '#69c4b0' : '#41595a'}
                  strokeOpacity={highlighted ? 0.55 : 0.22}
                  strokeWidth={Math.max(0.7, Math.min(2.8, edge.weight * 2))}
                >
                  <title>
                    {from.label} — {edge.label} — {to.label}
                  </title>
                </line>
              );
            })}
            {layout.map((node) => {
              const active = selected?.id === node.id;
              const radius = 9 + Math.min(11, Math.max(0, node.weight * 5));
              return (
                <g
                  className={`graph-node ${active ? 'graph-node-selected' : ''}`}
                  key={node.id}
                  transform={`translate(${node.x} ${node.y})`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={active}
                  aria-label={`${node.label}, ${node.kind}. Inspect sources.`}
                  onClick={() => setSelectedId(node.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedId(node.id);
                    }
                  }}
                >
                  <title>{node.label}</title>
                  <circle
                    r={radius + 9}
                    fill={nodeColors[node.kind]}
                    opacity={active ? '.12' : '.035'}
                  />
                  <circle
                    className="node-focus-ring"
                    r={radius + 7}
                    fill="none"
                    stroke={nodeColors[node.kind]}
                    strokeWidth="1.2"
                    opacity={active ? '.7' : '0'}
                  />
                  <circle
                    r={radius}
                    fill="#122624"
                    stroke={nodeColors[node.kind]}
                    strokeWidth={active ? 2 : 1}
                  />
                  <circle r="3" fill={nodeColors[node.kind]} />
                  <text
                    y={radius + 19}
                    textAnchor="middle"
                    fill={active ? '#edfaf5' : '#a6bab4'}
                    fontSize="10.5"
                    fontWeight={active ? 600 : 400}
                  >
                    {node.label.length > 24 ? `${node.label.slice(0, 23)}…` : node.label}
                  </text>
                </g>
              );
            })}
          </svg>
          <div className="graph-footer">
            <span>
              <ZoomIn size={13} aria-hidden="true" /> Select a node to inspect its context
            </span>
            <span>Abstract layout · not geographic</span>
          </div>
        </div>
        <aside className="card node-detail" aria-label="Selected knowledge node" aria-live="polite">
          {selected && (
            <>
              <span className="eyebrow">{selected.kind.toUpperCase()}</span>
              <h3>{selected.label}</h3>
              <p className="plain-text">{selected.summary}</p>
              <SourceLinks ids={selected.sourceIds} onOpen={onSource} />
              <div className="node-connections">
                <h4>
                  {lexical ? 'Co-occurs with' : 'Connected context'}{' '}
                  <span>{relatedEdges.length}</span>
                </h4>
                {relatedEdges.length ? (
                  relatedEdges.map((edge, index) => {
                    const otherId = edge.source === selected.id ? edge.target : edge.source;
                    const other = graph.nodes.find((node) => node.id === otherId);
                    return (
                      <div className="connection-row" key={`${otherId}-${index}`}>
                        <button
                          className="text-button"
                          type="button"
                          onClick={() => setSelectedId(otherId)}
                        >
                          {other?.label ?? otherId}
                          <ArrowUpRight size={13} aria-hidden="true" />
                        </button>
                        <small>{edge.label}</small>
                        <SourceLinks ids={edge.sourceIds} onOpen={onSource} />
                      </div>
                    );
                  })
                ) : (
                  <p className="muted">No recorded connections for this node.</p>
                )}
              </div>
            </>
          )}
        </aside>
      </div>
      {graph.notes.length > 0 && (
        <div className="card method-notes">
          <h3>Method notes</h3>
          <ul>
            {graph.notes.map((note, index) => (
              <li className="plain-text" key={index}>
                {note}
              </li>
            ))}
          </ul>
        </div>
      )}
      <details className="card graph-text-list">
        <summary>Accessible node list and sources</summary>
        <div className="graph-node-list">
          {graph.nodes.map((node) => (
            <div key={node.id}>
              <button type="button" className="text-button" onClick={() => setSelectedId(node.id)}>
                {node.label}
              </button>
              <p>{node.summary}</p>
              <SourceLinks ids={node.sourceIds} onOpen={onSource} />
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
