import { ArrowRight, FileText, Search } from 'lucide-react';
import type { ConsoleStep, ExecutionStep } from '../../../../shared/guided';
import type { ProjectDetail } from '../../../../shared/types';
import { isGuided, stepStatus } from '../../lib/console';
import type { Inspection } from '../../lib/graph';
import { EmptyPanel, Notice } from '../ui';
import { RunStepButton, StageStatus } from './StageControls';

export function KnowledgeStage({
  project,
  busy,
  onRun,
  onNavigate,
  onInspect,
}: {
  project: ProjectDetail;
  busy: boolean;
  onRun: (step: ExecutionStep) => void;
  onNavigate: (step: ConsoleStep) => void;
  onInspect: (selection: Inspection) => void;
}) {
  const guided = isGuided(project);
  const ready = stepStatus(project, 'knowledge') === 'ready';
  const ontology = project.console?.ontology;
  const graph = project.graph;
  const citedNodes = graph?.nodes.filter((node) => node.sourceIds.length > 0).length ?? 0;
  return (
    <div className="stage-content view-stack">
      <div>
        <span className="eyebrow">01 / GRAPH BUILD</span>
        <h2>Establish the source layer</h2>
        <p className="stage-intro">
          Inspect what was extracted before introducing fictional actors or simulation assumptions.
        </p>
      </div>
      <StageStatus project={project} step="knowledge" />
      {graph?.method === 'lexical' || project.mode === 'local' ? (
        <Notice title="Local lexical extraction">
          Topics and relationships come from lexical matching and co-occurrence. This is not
          semantic AI extraction or AI GraphRAG. Graph citations point to your actual source
          excerpts.
        </Notice>
      ) : (
        <Notice title="Model-assisted extraction">
          A real configured provider extracts bounded entities and relations from your source
          context. Extraction may be incomplete or incorrect; inspect citations.
        </Notice>
      )}
      <div className="stats-grid">
        <div>
          <span className="mono">SOURCE FILES</span>
          <strong>{project.documents.length}</strong>
        </div>
        <div>
          <span className="mono">NODES</span>
          <strong>{graph?.nodes.length ?? 0}</strong>
        </div>
        <div>
          <span className="mono">RELATIONSHIPS</span>
          <strong>{graph?.edges.length ?? 0}</strong>
        </div>
        <div>
          <span className="mono">CITED NODES</span>
          <strong>{citedNodes}</strong>
        </div>
      </div>
      <section className="stage-card">
        <div className="section-heading">
          <h3>Recorded ontology</h3>
          <span className="mono muted">
            {ontology
              ? `${ontology.entityTypes.length} ENTITY / ${ontology.relationshipTypes.length} RELATION TYPES`
              : 'NO RECORD'}
          </span>
        </div>
        {ontology ? (
          <>
            <h4 className="subsection-label">Entity types</h4>
            <div className="ontology-list">
              {ontology.entityTypes.map((type) => (
                <div key={type.name}>
                  <strong>{type.name}</strong>
                  <p>{type.description}</p>
                </div>
              ))}
            </div>
            <h4 className="subsection-label">Relationship types</h4>
            <div className="ontology-list">
              {ontology.relationshipTypes.map((type) => (
                <div key={type.name}>
                  <strong>{type.name}</strong>
                  <p>{type.description}</p>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="field-help">
            {guided
              ? 'The ontology appears only after the API records it during Graph Build.'
              : 'Quick runs did not persist a guided ontology. Existing graph kinds and edge labels remain inspectable; no ontology has been reconstructed.'}
          </p>
        )}
      </section>
      {!!graph?.notes.length && (
        <section className="stage-card">
          <h3>Extraction notes</h3>
          <ul className="plain-list">
            {graph.notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </section>
      )}
      <section className="stage-card">
        <div className="section-heading">
          <h3>Source inspection</h3>
          <button
            className="text-button"
            type="button"
            onClick={() => onInspect({ kind: 'sources' })}
          >
            <Search size={13} /> Browse evidence
          </button>
        </div>
        {project.documents.map((document) => (
          <button
            className="document-row"
            key={document.id}
            type="button"
            onClick={() => onInspect({ kind: 'document', id: document.id })}
          >
            <FileText size={16} aria-hidden="true" />
            <span>
              <strong>{document.name}</strong>
              <small>
                {document.content.length.toLocaleString()} characters
                {document.pageCount ? ` · ${document.pageCount} extracted pages` : ''}
              </small>
            </span>
            <ArrowRight size={14} />
          </button>
        ))}
        {!project.documents.length && (
          <EmptyPanel title="No source documents recorded">
            This historical project contains no readable source text.
          </EmptyPanel>
        )}
      </section>
      <div className="stage-actions">
        <RunStepButton
          project={project}
          step="knowledge"
          busy={busy}
          onRun={onRun}
          label="Build source graph"
        />
        {ready && project.console?.steps.environment === 'pending' && (
          <RunStepButton
            project={project}
            step="environment"
            busy={busy}
            onRun={onRun}
            label="Prepare environment"
          />
        )}
        {ready && project.console?.steps.environment !== 'pending' && (
          <button
            className="button button-primary"
            type="button"
            onClick={() => onNavigate('environment')}
          >
            Inspect environment <ArrowRight size={15} />
          </button>
        )}
      </div>
      {guided && !ready && (
        <p className="field-help">
          Environment preparation is locked until Graph Build is ready. No later stage runs
          automatically.
        </p>
      )}
    </div>
  );
}
