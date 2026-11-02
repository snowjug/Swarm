import { m } from 'motion/react';
import { Building2, Hash, User, Users, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ChipButton, Disclosure, IconButton } from '../../design/ui';
import { SPRING, useReducedMotion } from '../../design/motion';
import { useGroundActions, useGroundData } from './context';
import { vars } from './css';
import {
  KIND_LABELS,
  type GraphEdge,
  type GraphNode,
  type GraphView,
  type NodeKind,
} from './graphModel';
import { documentColour, plural } from './model';

const KIND_ICONS: Record<NodeKind, LucideIcon> = {
  topic: Hash,
  person: User,
  organization: Building2,
  group: Users,
};

export function KindIcon({ kind, size = 14 }: { kind: NodeKind; size?: number }) {
  const Icon = KIND_ICONS[kind];
  return <Icon size={size} aria-hidden="true" />;
}

/** Passages as chips that open them: an id the record cannot place still opens, to say so. */
function PassageChips({ ids }: { ids: readonly string[] }) {
  const { passages } = useGroundData();
  const actions = useGroundActions();
  if (ids.length === 0) return <p className="sw-ground-panel__none">No passage is cited.</p>;
  return (
    <ul className="sw-ground-panel__chips" role="list">
      {ids.map((id) => {
        const known = passages.index ? passages.index.byId.has(id) : true;
        return (
          <li key={id}>
            <ChipButton
              size="sm"
              className="sw-ground-panel__passage"
              data-known={known}
              onClick={() => actions.openPassage(id)}
              onPointerEnter={(event) =>
                event.pointerType === 'mouse' && actions.hover({ passage: id })
              }
              onPointerLeave={(event) => event.pointerType === 'mouse' && actions.hover(null)}
            >
              {id}
            </ChipButton>
          </li>
        );
      })}
    </ul>
  );
}

function DocumentChips({ ids }: { ids: readonly string[] }) {
  const { documents } = useGroundData();
  const actions = useGroundActions();
  if (ids.length === 0) return null;
  return (
    <ul className="sw-ground-panel__docs" role="list">
      {ids.map((id) => {
        const doc = documents.find((item) => item.id === id);
        if (!doc) return null;
        return (
          <li key={id}>
            <button
              type="button"
              className="sw-ground-panel__doc"
              style={vars({ '--doc': documentColour(doc.index) })}
              onClick={() => actions.openDocument(id)}
              onPointerEnter={(event) =>
                event.pointerType === 'mouse' && actions.hover({ document: id })
              }
              onPointerLeave={(event) => event.pointerType === 'mouse' && actions.hover(null)}
            >
              <i aria-hidden="true" />
              <span>{doc.name}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function NodeBody({ node, view }: { node: GraphNode; view: GraphView }) {
  const { mode, documents, project } = useGroundData();
  const actions = useGroundActions();
  const edges = (view.edgesOf.get(node.id) ?? [])
    .map((index) => view.edges.find((edge) => edge.index === index))
    .filter((edge): edge is GraphEdge => Boolean(edge))
    .sort((a, b) => b.weight - a.weight);
  const model = view.method === 'llm';
  return (
    <>
      <p className="sw-ground-panel__kind">
        <KindIcon kind={node.kind} />
        {node.type}
        {node.documentIds.length > 0 && (
          <span className="sw-ground-panel__spread num">
            · in {node.documentIds.length} of {plural(documents.length, 'source')}
          </span>
        )}
      </p>
      <h2 className="sw-ground-panel__title">{node.label}</h2>
      <p className="sw-ground-panel__summary">{node.summary}</p>
      {node.quote && (
        <figure className="sw-ground-quote">
          <blockquote>{node.quote}</blockquote>
          <figcaption>
            {node.sourceIds.length > 0
              ? `Quote checked character for character against ${node.sourceIds.join(', ')}`
              : 'No cited passage was recorded for it'}
          </figcaption>
        </figure>
      )}
      <section className="sw-ground-panel__block" aria-label="Passages">
        <h3 className="sw-eyebrow">Passages</h3>
        <PassageChips ids={node.sourceIds} />
      </section>
      {node.documentIds.length > 0 && (
        <section className="sw-ground-panel__block" aria-label="Cited in">
          <h3 className="sw-eyebrow">Cited in</h3>
          <DocumentChips ids={node.documentIds} />
        </section>
      )}
      {node.sourceIds.length === 0 && (
        <p className="sw-ground-panel__none">
          {model ? 'The model gave no citation for it.' : 'No citation was recorded for it.'}
        </p>
      )}
      {edges.length > 0 && (
        <Disclosure
          summary={`Linked to ${plural(edges.length, 'topic', model ? 'entities' : 'topics')}`}
        >
          <ul className="sw-ground-panel__links" role="list">
            {edges.map((edge) => {
              const otherId = edge.source === node.id ? edge.target : edge.source;
              const other = view.byId.get(otherId);
              return (
                <li key={edge.index}>
                  <button type="button" onClick={() => actions.selectEdge(edge.index)}>
                    <span className="sw-ground-panel__link-name">{other?.label ?? otherId}</span>
                    <span className="sw-ground-panel__link-kind">{edge.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Disclosure>
      )}
      {mode === 'advanced' && (
        <dl className="sw-ground-panel__facts num">
          <div>
            <dt>Node</dt>
            <dd>{node.id}</dd>
          </div>
          <div>
            <dt>Weight</dt>
            <dd>{node.weight.toFixed(2)}</dd>
          </div>
          <div>
            <dt>Method</dt>
            <dd>{project.graph?.method ?? view.method}</dd>
          </div>
        </dl>
      )}
    </>
  );
}

function EdgeBody({ edge, view }: { edge: GraphEdge; view: GraphView }) {
  const { mode } = useGroundData();
  const actions = useGroundActions();
  const from = view.byId.get(edge.source);
  const to = view.byId.get(edge.target);
  return (
    <>
      <p className="sw-ground-panel__kind">{view.method === 'llm' ? 'Link' : 'Shared passages'}</p>
      <h2 className="sw-ground-panel__title">
        <button
          type="button"
          className="sw-ground-panel__end"
          onClick={() => actions.selectNode(edge.source)}
        >
          {from?.label ?? edge.source}
        </button>
        <span className="sw-ground-panel__arrow" aria-hidden="true">
          ↔
        </span>
        <button
          type="button"
          className="sw-ground-panel__end"
          onClick={() => actions.selectNode(edge.target)}
        >
          {to?.label ?? edge.target}
        </button>
      </h2>
      <p className="sw-ground-panel__summary">{edge.label}</p>
      <section className="sw-ground-panel__block" aria-label="Passages">
        <h3 className="sw-eyebrow">Passages</h3>
        <PassageChips ids={edge.sourceIds} />
      </section>
      {edge.documentIds.length > 0 && (
        <section className="sw-ground-panel__block" aria-label="Cited in">
          <h3 className="sw-eyebrow">Cited in</h3>
          <DocumentChips ids={edge.documentIds} />
        </section>
      )}
      {mode === 'advanced' && (
        <dl className="sw-ground-panel__facts num">
          <div>
            <dt>Weight</dt>
            <dd>{edge.weight.toFixed(2)}</dd>
          </div>
        </dl>
      )}
    </>
  );
}

/**
 * What a topic or a link rests on, beside the graph it was chosen in: what it says, the quotation the server
 * checked, the passages it cites and the documents they sit in. It floats over the graph's edge (and sits
 * below it on a phone) and closes with Escape or its own button.
 */
export function NodePanel({
  view,
  node,
  edge,
}: {
  view: GraphView;
  node: GraphNode | null;
  edge: GraphEdge | null;
}) {
  const actions = useGroundActions();
  const reduced = useReducedMotion();
  return (
    <m.aside
      className="sw-ground-panel sw-glass sw-glass--overlay"
      role="region"
      aria-label={node ? `${node.label}: details` : 'Link: details'}
      initial={reduced ? false : { opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.14 } }}
      transition={SPRING.snappy}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          actions.selectNode(null);
        }
      }}
    >
      <div className="sw-ground-panel__close">
        <IconButton label="Close" size="sm" onClick={() => actions.selectNode(null)}>
          <X size={16} aria-hidden="true" />
        </IconButton>
      </div>
      {node ? (
        <NodeBody node={node} view={view} />
      ) : edge ? (
        <EdgeBody edge={edge} view={view} />
      ) : null}
      <p className="sr-only">{node ? KIND_LABELS[node.kind] : ''}</p>
    </m.aside>
  );
}
