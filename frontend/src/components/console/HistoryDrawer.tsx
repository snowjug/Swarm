import { useState } from 'react';
import { ArrowUpRight, RefreshCw, Search, Trash2 } from 'lucide-react';
import type { ProjectSummary } from '../../../../shared/types';
import { dateTime } from '../../lib/format';
import { errorMessage } from '../../api';
import { historyStatus } from '../../lib/whatIf';
import { EmptyPanel, Modal, Notice, Spinner, StatusBadge } from '../ui';

export function HistoryDrawer({
  projects,
  total,
  loading,
  error,
  selectedId,
  busy,
  onClose,
  onSelect,
  onRefresh,
  onDelete,
  whatIf = false,
  onCompare,
}: {
  projects: ProjectSummary[];
  total: number;
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  busy: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onDelete: (id: string) => Promise<void>;
  whatIf?: boolean;
  onCompare?: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const filtered = projects.filter((project) =>
    `${project.name} ${project.question} ${project.id}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Modal title={`Project history · ${total}`} onClose={onClose}>
      <div className="history-toolbar">
        <label className="search-field">
          <Search size={15} aria-hidden="true" />
          <input
            aria-label="Search saved projects"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects…"
          />
        </label>
        <button
          className="icon-button"
          type="button"
          onClick={onRefresh}
          disabled={loading}
          aria-label="Refresh history"
        >
          <RefreshCw size={16} aria-hidden="true" />
        </button>
      </div>
      {error && (
        <Notice tone="error">
          {error}{' '}
          <button className="text-button" type="button" onClick={onRefresh}>
            Retry history
          </button>
        </Notice>
      )}
      {failure && <Notice tone="error">{failure}</Notice>}
      {loading && (
        <div className="inline-pending">
          <Spinner /> Loading saved project records…
        </div>
      )}
      {!loading && !filtered.length && (
        <EmptyPanel title={query ? 'No matching projects' : 'No saved projects yet'}>
          Build a graph to create a persistent project on this server.
        </EmptyPanel>
      )}
      <div className="history-list">
        {filtered.map((project) => (
          <article
            className={`history-item ${selectedId === project.id ? 'selected' : ''} ${project.parentId ? 'history-branch' : ''}`}
            key={project.id}
          >
            <div className="section-heading">
              <span className="eyebrow">
                {project.workflow === 'guided' ? 'GUIDED' : 'LEGACY QUICK RUN'}
              </span>
              <StatusBadge status={historyStatus(project)} />
            </div>
            {project.parentId && (
              <p className="branch-history-badge">
                Branch of{' '}
                {projects.find((item) => item.id === project.parentId)?.name ??
                  `unavailable parent (${project.parentId})`}
              </p>
            )}
            <button
              className="history-open"
              type="button"
              onClick={() => {
                onSelect(project.id);
                onClose();
              }}
            >
              <strong>{project.name}</strong>
              <ArrowUpRight size={16} aria-hidden="true" />
            </button>
            <p>{project.question}</p>
            <div className="section-heading">
              <span className="mono muted">
                {dateTime(project.updatedAt)} · {project.mode === 'llm' ? 'MODEL' : 'LOCAL'}
              </span>
              {whatIf &&
                project.workflow === 'guided' &&
                project.currentRound >= 1 &&
                onCompare && (
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => {
                      onCompare(project.id);
                      onClose();
                    }}
                  >
                    Compare
                  </button>
                )}
              <button
                className="icon-button danger-text"
                type="button"
                disabled={busy || ['queued', 'running'].includes(project.status)}
                aria-label={`Delete ${project.name}`}
                onClick={() => {
                  setDeleting(project.id);
                  setFailure(null);
                }}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </div>
            {deleting === project.id && (
              <div className="delete-confirm">
                <p>Permanently delete this project, its evidence, conversations and outputs?</p>
                <button
                  className="button button-danger button-small"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void onDelete(project.id).then(
                      () => setDeleting(null),
                      (error: unknown) => setFailure(errorMessage(error)),
                    );
                  }}
                >
                  {busy ? 'Deleting…' : 'Delete permanently'}
                </button>
                <button
                  className="text-button"
                  type="button"
                  disabled={busy}
                  onClick={() => setDeleting(null)}
                >
                  Keep project
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
      <p className="field-help">
        Stored on this local server, not in your browser. Busy projects cannot be deleted.
      </p>
    </Modal>
  );
}
