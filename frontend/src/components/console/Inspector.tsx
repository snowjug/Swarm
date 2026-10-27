import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { FileText, RefreshCw, Search } from 'lucide-react';
import type { EvidenceMatch, ProjectDetail } from '../../../../shared/types';
import { api, errorMessage } from '../../api';
import { actionLabel, platformNames } from '../../lib/console';
import { signed } from '../../lib/format';
import type { Inspection } from '../../lib/graph';
import { EmptyPanel, Modal, Notice, Spinner } from '../ui';
import { Citations } from './Citations';

function EvidenceBrowser({
  project,
  initialQuery,
  onInspect,
}: {
  project: ProjectDetail;
  initialQuery: string;
  onInspect: (selection: Inspection) => void;
}) {
  const [draft, setDraft] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [matches, setMatches] = useState<EvidenceMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setMatches([]);
    void api.evidence(project.id, query, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) {
          setMatches(result.matches);
          setLoading(false);
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setError(errorMessage(error));
          setLoading(false);
        }
      },
    );
    return () => controller.abort();
  }, [project.id, query, revision]);
  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draft.trim() === query) setRevision((old) => old + 1);
    else setQuery(draft.trim());
  };
  return (
    <div className="view-stack">
      <p className="field-help">
        Source excerpts are evidence. Simulated memories and fictional proxy statements are not
        source facts. An empty search browses available excerpts; an exact source ID retrieves that
        chunk.
      </p>
      <form className="evidence-search" onSubmit={search}>
        <label className="search-field">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={draft}
            maxLength={1_000}
            aria-label="Search source evidence"
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Search text, S1, or leave empty to browse…"
          />
        </label>
        <button className="button button-secondary button-small" type="submit" disabled={loading}>
          Search
        </button>
      </form>
      <div className="document-shortcuts" role="group" aria-label="Original documents">
        {project.documents.map((document) => (
          <button
            className="source-chip"
            type="button"
            key={document.id}
            onClick={() => onInspect({ kind: 'document', id: document.id })}
          >
            <FileText size={12} />
            {document.name}
          </button>
        ))}
      </div>
      {loading && (
        <div className="inline-pending">
          <Spinner /> Retrieving stored evidence…
        </div>
      )}
      {error && (
        <Notice
          tone="error"
          action={
            <button
              className="icon-button"
              type="button"
              aria-label="Retry evidence search"
              onClick={() => setRevision((old) => old + 1)}
            >
              <RefreshCw size={15} />
            </button>
          }
        >
          {error}
        </Notice>
      )}
      {!loading && !error && !matches.length && (
        <EmptyPanel title="No stored excerpts matched">
          Try another term or clear the search to browse. Sources may not have been indexed yet.
        </EmptyPanel>
      )}
      {matches.map((match) => (
        <article className="evidence-chunk" key={match.id}>
          <div className="section-heading">
            <strong className="mono">{match.id}</strong>
            <button
              className="text-button"
              type="button"
              onClick={() => onInspect({ kind: 'document', id: match.documentId })}
            >
              {match.documentName}
            </button>
          </div>
          <p className="preserve-text">{match.text}</p>
          <small className="mono muted">
            CHARACTERS {match.start}–{match.end}
          </small>
        </article>
      ))}
    </div>
  );
}

export function Inspector({
  project,
  selection,
  onInspect,
  onClose,
}: {
  project: ProjectDetail;
  selection: Inspection;
  onInspect: (selection: Inspection) => void;
  onClose: () => void;
}) {
  let title = 'Record inspector';
  let content;
  if (selection.kind === 'sources' || selection.kind === 'source') {
    const query = selection.kind === 'sources' ? (selection.query ?? '') : selection.id;
    title = selection.kind === 'source' ? `Source excerpt · ${selection.id}` : 'Sources & evidence';
    content = (
      <EvidenceBrowser key={query} project={project} initialQuery={query} onInspect={onInspect} />
    );
  } else if (selection.kind === 'document') {
    const document = project.documents.find((item) => item.id === selection.id);
    title = document?.name ?? 'Document not recorded';
    content = document ? (
      <div className="view-stack">
        <div className="record-meta mono">
          {document.content.length.toLocaleString()} CHARACTERS
          {document.pageCount ? ` · ${document.pageCount} EXTRACTED PAGES` : ''}
        </div>
        <p className="field-help">
          Original supplied / extracted text. PDF extraction does not perform OCR.
        </p>
        <div className="document-text preserve-text">{document.content}</div>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => onInspect({ kind: 'sources' })}
        >
          Browse indexed excerpts
        </button>
      </div>
    ) : (
      <Notice tone="warning">This document ID is not present in the loaded project.</Notice>
    );
  } else if (selection.kind === 'node') {
    const node = project.graph?.nodes.find((item) => item.id === selection.id);
    const relationships =
      project.graph?.edges
        .map((edge, index) => ({ edge, index }))
        .filter(({ edge }) => edge.source === selection.id || edge.target === selection.id) ?? [];
    title = node?.label ?? 'Node not recorded';
    content = node ? (
      <div className="view-stack">
        <span className="method-tag">
          {project.graph?.method === 'lexical' ? 'LEXICAL SOURCE TOPIC' : 'EXTRACTED SOURCE ENTITY'}{' '}
          · {node.entityType ?? node.kind}
        </span>
        <p className="preserve-text">{node.summary}</p>
        <dl className="record-grid">
          <dt>Node ID</dt>
          <dd className="mono">{node.id}</dd>
          <dt>Recorded weight</dt>
          <dd>{node.weight}</dd>
          <dt>Kind</dt>
          <dd>{node.kind}</dd>
        </dl>
        <Citations sourceIds={node.sourceIds} onInspect={onInspect} />
        {!node.sourceIds.length && (
          <Notice tone="warning">No source citations were recorded for this node.</Notice>
        )}
        <details className="record-details">
          <summary>Recorded source relationships ({relationships.length})</summary>
          {relationships.map(({ edge, index }) => (
            <button
              className="document-row"
              type="button"
              key={index}
              onClick={() => onInspect({ kind: 'edge', index })}
            >
              <span className="preserve-text">
                {project.graph?.nodes.find((item) => item.id === edge.source)?.label ?? edge.source}
                {' → '}
                {edge.label}
                {' → '}
                {project.graph?.nodes.find((item) => item.id === edge.target)?.label ?? edge.target}
              </span>
            </button>
          ))}
          {!relationships.length && (
            <p className="field-help">No source relationships were recorded for this node.</p>
          )}
        </details>
      </div>
    ) : (
      <Notice tone="warning">This node is not present in the loaded graph.</Notice>
    );
  } else if (selection.kind === 'edge') {
    const edge = project.graph?.edges[selection.index];
    title = 'Source relationship';
    content = edge ? (
      <div className="view-stack">
        <span className="method-tag">
          {project.graph?.method === 'lexical' ? 'LEXICAL CO-OCCURRENCE' : 'EXTRACTED RELATIONSHIP'}
        </span>
        <h3>
          {project.graph?.nodes.find((node) => node.id === edge.source)?.label ?? edge.source} →{' '}
          {project.graph?.nodes.find((node) => node.id === edge.target)?.label ?? edge.target}
        </h3>
        <p>{edge.label}</p>
        <small className="mono">RECORDED WEIGHT {edge.weight}</small>
        <Citations sourceIds={edge.sourceIds} onInspect={onInspect} />
        {!edge.sourceIds.length && (
          <Notice tone="warning">No citations were recorded for this relationship.</Notice>
        )}
      </div>
    ) : (
      <Notice tone="warning">This relationship is no longer present in the loaded graph.</Notice>
    );
  } else if (selection.kind === 'agent') {
    const agent = project.agents.find((item) => item.id === selection.id);
    title = agent?.name ?? 'Proxy not recorded';
    content = agent ? (
      <div className="view-stack">
        <Notice tone="warning" title="FICTIONAL PROXY">
          An assumed simulation persona, not a real person. Context citations do not establish that
          this person or their opinions exist.
        </Notice>
        <h3>{agent.role}</h3>
        <p className="preserve-text">{agent.persona}</p>
        <dl className="record-grid">
          <dt>ID</dt>
          <dd className="mono">{agent.id}</dd>
          <dt>Initial inclination</dt>
          <dd>{signed(agent.initialOpinion)}</dd>
          <dt>Recorded position</dt>
          <dd>{signed(agent.opinion)}</dd>
          <dt>Influence / openness</dt>
          <dd>
            {agent.influence.toFixed(2)} / {agent.openness.toFixed(2)}
          </dd>
        </dl>
        {project.console?.platforms.map((platform) => {
          const state = platform.agents.find((item) => item.id === agent.id);
          return state ? (
            <div className="record-meta" key={platform.platform}>
              {platformNames[platform.platform]} · recorded position {signed(state.opinion)} · round{' '}
              {platform.currentRound}
            </div>
          ) : null;
        })}
        <Citations sourceIds={agent.sourceIds} onInspect={onInspect} />
        {!!agent.memory.length && (
          <details className="record-details">
            <summary>Stored proxy memory text ({agent.memory.length})</summary>
            {agent.memory.map((text, index) => (
              <p className="preserve-text" key={index}>
                {text}
              </p>
            ))}
          </details>
        )}
      </div>
    ) : (
      <Notice tone="warning">This fictional proxy is not present in the loaded project.</Notice>
    );
  } else if (selection.kind === 'memory') {
    const memory = project.console?.memories.find((item) => item.id === selection.id);
    title = `Simulated memory · ${selection.id}`;
    content = memory ? (
      <div className="view-stack">
        <Notice tone="warning" title="SIMULATED RECORD, NOT SOURCE EVIDENCE">
          {project.mode === 'local'
            ? 'Local update / observe records are rule-engine state changes, not social posts or a person speaking.'
            : 'This is a fictional action / seed recorded by the scenario engine, not a real-world event.'}
        </Notice>
        <dl className="record-grid">
          <dt>Platform</dt>
          <dd>{platformNames[memory.platform]}</dd>
          <dt>Action</dt>
          <dd>{actionLabel(memory.actionType, project.mode === 'local')}</dd>
          <dt>Round / scenario minute</dt>
          <dd>
            {memory.round} / {memory.simulatedMinute}
          </dd>
          <dt>Proxy</dt>
          <dd>
            {project.agents.find((agent) => agent.id === memory.agentId)?.name ??
              memory.agentId ??
              'Initial input'}
          </dd>
          <dt>Numeric position</dt>
          <dd>{memory.opinion === null ? 'Not recorded' : signed(memory.opinion)}</dd>
        </dl>
        <p className="preserve-text">{memory.text}</p>
        {!!memory.peerIds.length && (
          <div>
            <h4>Recorded peer context</h4>
            <div className="source-links">
              {memory.peerIds.map((id) => (
                <button
                  className="source-chip memory-chip"
                  type="button"
                  key={id}
                  onClick={() => onInspect({ kind: 'agent', id })}
                >
                  {project.agents.find((agent) => agent.id === id)?.name ?? id}
                </button>
              ))}
            </div>
          </div>
        )}
        <Citations sourceIds={memory.sourceIds} onInspect={onInspect} />
      </div>
    ) : (
      <Notice tone="warning">
        This memory ID is not present in the loaded guided record. Historical quick runs did not
        persist guided memory records.
      </Notice>
    );
  } else if (selection.kind === 'interview') {
    const interview = project.console?.interviews.find((item) => item.id === selection.id);
    title = `Fictional interview · ${selection.id}`;
    content = interview ? (
      <div className="view-stack">
        <Notice tone="warning">
          Recorded model-generated role-play, not real-person testimony or hidden reasoning.
        </Notice>
        <h3>
          {project.agents.find((agent) => agent.id === interview.agentId)?.name ??
            interview.agentId}
        </h3>
        <h4>{interview.question}</h4>
        <p className="preserve-text">{interview.answer}</p>
        <Citations
          sourceIds={interview.sourceIds}
          memoryIds={interview.memoryIds}
          onInspect={onInspect}
        />
      </div>
    ) : (
      <Notice tone="warning">No interview with this ID was recorded in the loaded project.</Notice>
    );
  }
  return (
    <Modal title={title} onClose={onClose}>
      {content}
    </Modal>
  );
}
