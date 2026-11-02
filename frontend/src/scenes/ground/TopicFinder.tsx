import { useMemo, useState } from 'react';
import { Input } from '../../design/ui';
import { vars } from './css';
import { useGroundData } from './context';
import type { GraphNode, GraphView } from './graphModel';
import { documentColour } from './model';
import { KindIcon } from './NodePanel';

/** Every topic in a list that can be searched and walked with the keyboard: the graph without the pointer. */
export function TopicFinder({
  view,
  visible,
  onChoose,
}: {
  view: GraphView;
  visible: ReadonlySet<string>;
  onChoose: (node: GraphNode) => void;
}) {
  const { documents } = useGroundData();
  const [query, setQuery] = useState('');
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...view.nodes]
      .filter((node) => !needle || node.label.toLowerCase().includes(needle))
      .sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label));
  }, [view.nodes, query]);
  const colour = (id: string) => {
    const doc = documents.find((item) => item.id === id);
    return doc ? documentColour(doc.index) : 'var(--ink-3)';
  };
  return (
    <div className="sw-ground-find__body">
      <Input
        type="search"
        value={query}
        aria-label="Find in the graph"
        placeholder={view.method === 'llm' ? 'Find an entity' : 'Find a topic'}
        autoComplete="off"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          const first = matches.find((node) => visible.has(node.id));
          if (event.key === 'Enter' && first) {
            event.preventDefault();
            onChoose(first);
          }
        }}
      />
      <ul className="sw-ground-find__list" role="list">
        {matches.map((node) => {
          const shown = visible.has(node.id);
          return (
            <li key={node.id}>
              <button type="button" disabled={!shown} onClick={() => onChoose(node)}>
                <KindIcon kind={node.kind} size={14} />
                <span className="sw-ground-find__name">{node.label}</span>
                {!shown && <span className="sw-ground-find__hidden">hidden</span>}
                <span className="sw-ground-find__dots" aria-hidden="true">
                  {node.documentIds.map((id) => (
                    <i key={id} style={vars({ '--doc': colour(id) })} />
                  ))}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {matches.length === 0 && <p className="sw-ground-find__none">Nothing matches.</p>}
    </div>
  );
}
