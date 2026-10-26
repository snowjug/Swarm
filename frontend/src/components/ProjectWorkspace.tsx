import { useEffect, useId, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  Copy,
  Download,
  FileJson,
  FileText,
  Play,
  RefreshCw,
  Square,
  Trash2,
} from 'lucide-react';
import type { ProjectDetail } from '../../../shared/types';
import { api, errorMessage } from '../api';
import type { Mutation } from '../hooks/useWorkbench';
import { canRun, dateTime, isActive } from '../lib/format';
import { AgentsView } from './AgentsView';
import { EvidenceView } from './EvidenceView';
import { InterviewView } from './InterviewView';
import { KnowledgeView } from './KnowledgeView';
import { ReportView } from './ReportView';
import { RoundsView } from './RoundsView';
import { RunOverview } from './RunOverview';
import { Modal, Notice, Spinner, StatusBadge, Tabs } from './ui';

type View = 'overview' | 'knowledge' | 'agents' | 'rounds' | 'report' | 'evidence' | 'interview';

export function ProjectWorkspace({
  project,
  loading,
  mutation,
  onBack,
  onRefresh,
  onDuplicate,
  onAction,
}: {
  project: ProjectDetail;
  loading: boolean;
  mutation: Mutation | null;
  onBack: () => void;
  onRefresh: () => void;
  onDuplicate: (project: ProjectDetail) => void;
  onAction: (kind: 'run' | 'cancel' | 'delete', id: string) => Promise<boolean>;
}) {
  const [view, setView] = useState<View>('overview');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<{
    query: string;
    documentId?: string;
    revision: number;
  }>({ query: '', revision: 0 });
  const [target, setTarget] = useState('report');
  const exportController = useRef<AbortController | null>(null);
  const exportLock = useRef(false);
  const exportMenu = useRef<HTMLDetailsElement>(null);
  const tabId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const active = isActive(project.status);
  const busy = Boolean(mutation);
  const ownBusy = mutation?.id === project.id;

  useEffect(() => () => exportController.current?.abort(), []);

  const openSource = (id: string) => {
    setEvidence((old) => ({ query: id, revision: old.revision + 1 }));
    setView('evidence');
    requestAnimationFrame(() => panelRef.current?.focus());
  };
  const openDocument = (documentId: string) => {
    setEvidence((old) => ({ query: '', documentId, revision: old.revision + 1 }));
    setView('evidence');
    requestAnimationFrame(() => panelRef.current?.focus());
  };
  const openInterview = (id: string) => {
    setTarget(id);
    setView('interview');
    requestAnimationFrame(() => panelRef.current?.focus());
  };
  const exportProject = async (format: 'markdown' | 'json') => {
    if (exportLock.current) return;
    exportLock.current = true;
    if (exportMenu.current) exportMenu.current.open = false;
    const controller = new AbortController();
    exportController.current = controller;
    setExporting(true);
    setExportError(null);
    setExportSuccess(null);
    try {
      const blob = await api.export(project.id, format, controller.signal);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      const filename = Array.from(project.name, (character) =>
        character.charCodeAt(0) < 32 || /[<>:"/\\|?*]/u.test(character) ? '-' : character,
      )
        .join('')
        .slice(0, 80);
      anchor.download = `${filename || 'swarm-lab'}.${format === 'markdown' ? 'md' : 'json'}`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setExportSuccess(
        `${format === 'markdown' ? 'Markdown' : 'JSON'} download requested. Check your browser’s downloads.`,
      );
    } catch (error) {
      if (!controller.signal.aborted) setExportError(errorMessage(error));
    } finally {
      exportLock.current = false;
      if (!controller.signal.aborted) setExporting(false);
    }
  };
  const tabs: { id: View; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'knowledge', label: 'Knowledge', count: project.graph?.nodes.length ?? 0 },
    { id: 'agents', label: 'Agents', count: project.agents.length },
    { id: 'rounds', label: 'Rounds', count: project.rounds.length },
    { id: 'report', label: 'Report' },
    { id: 'evidence', label: 'Evidence' },
    { id: 'interview', label: project.mode === 'local' ? 'Evidence inspector' : 'AI interviews' },
  ];
  return (
    <div className="project-page page-enter">
      <div className="page-back-row">
        <button className="text-button" type="button" onClick={onBack}>
          <ArrowLeft size={15} aria-hidden="true" /> Lab overview
        </button>
        <span className="project-id" title={project.id}>
          EXPERIMENT {project.id.slice(0, 8).toUpperCase()}
        </span>
      </div>
      <header className="project-heading">
        <div className="project-title-block">
          <div className="project-title-meta">
            <StatusBadge status={project.status} />
            <span
              className={project.mode === 'local' ? 'engine-label' : 'engine-label text-violet'}
            >
              {project.mode === 'local' ? 'RULES-BASED · NOT AI' : 'MODEL-ASSISTED'}
            </span>
          </div>
          <h1>{project.name}</h1>
          <p className="project-question">{project.question}</p>
          <span className="project-created">
            Created {dateTime(project.createdAt)} <span>·</span> Updated{' '}
            {dateTime(project.updatedAt)}
          </span>
        </div>
        <div className="project-actions">
          <button
            className="icon-button bordered"
            type="button"
            onClick={onRefresh}
            disabled={loading || ownBusy}
            aria-label="Refresh selected experiment"
            title="Refresh experiment"
          >
            <RefreshCw size={16} className={loading ? 'spin' : ''} aria-hidden="true" />
          </button>
          <details
            className="export-menu"
            ref={exportMenu}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && exportMenu.current) {
                exportMenu.current.open = false;
                exportMenu.current.querySelector('summary')?.focus();
              }
            }}
          >
            <summary className="button button-secondary">
              {exporting ? (
                <Spinner label="Preparing export" />
              ) : (
                <Download size={15} aria-hidden="true" />
              )}{' '}
              Export <ChevronDown size={13} aria-hidden="true" />
            </summary>
            <div className="export-options">
              <button
                type="button"
                disabled={exporting}
                onClick={() => void exportProject('markdown')}
              >
                <FileText size={15} aria-hidden="true" /> Markdown (.md)
              </button>
              <button type="button" disabled={exporting} onClick={() => void exportProject('json')}>
                <FileJson size={15} aria-hidden="true" /> Full data (.json)
              </button>
            </div>
          </details>
          <button
            className="icon-button bordered"
            type="button"
            onClick={() => onDuplicate(project)}
            disabled={busy}
            aria-label="Duplicate source inputs and settings"
            title="Duplicate inputs"
          >
            <Copy size={16} aria-hidden="true" />
          </button>
          {!active && (
            <button
              className="icon-button bordered danger-hover"
              type="button"
              onClick={() => setDeleteOpen(true)}
              disabled={busy}
              aria-label="Delete experiment"
              title="Delete experiment"
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          )}
          {canRun(project.status) && (
            <button
              className="button button-primary"
              type="button"
              disabled={busy}
              onClick={() => void onAction('run', project.id)}
            >
              {ownBusy ? (
                <Spinner label="Starting experiment" />
              ) : (
                <Play size={15} aria-hidden="true" />
              )}
              {project.status === 'draft' ? 'Run experiment' : 'Retry run'}
            </button>
          )}
          {active && (
            <button
              className="button button-secondary cancel-button"
              type="button"
              disabled={busy}
              onClick={() => void onAction('cancel', project.id)}
            >
              {ownBusy ? (
                <Spinner label="Requesting cancellation" />
              ) : (
                <Square size={13} aria-hidden="true" />
              )}{' '}
              Cancel run
            </button>
          )}
        </div>
      </header>
      {project.status === 'failed' && (
        <Notice tone="error" title="The run did not finish">
          {project.error || 'The backend did not provide further details.'} Recorded partial outputs
          remain available. Check the server or provider, then retry this run.
        </Notice>
      )}
      {project.status === 'cancelled' && (
        <Notice tone="warning" title="Run cancelled">
          Any recorded partial outputs remain visible. Retry starts a fresh run using these inputs
          and settings.
        </Notice>
      )}
      {project.status === 'completed' && (
        <div className="completion-note">
          <span className="status-dot" /> Completed inputs and results are read-only. Duplicate
          inputs to explore another run.
        </div>
      )}
      {exportError && (
        <Notice tone="error" title="Export failed">
          {exportError} Open Export and choose a format to retry.
        </Notice>
      )}
      {exportSuccess && <Notice tone="success">{exportSuccess}</Notice>}
      <Tabs tabs={tabs} value={view} onChange={setView} id={tabId} />
      <div
        ref={panelRef}
        tabIndex={-1}
        id={`${tabId}-panel`}
        role="tabpanel"
        aria-labelledby={`${tabId}-tab-${view}`}
        className="project-tab-panel"
      >
        {view === 'overview' && (
          <RunOverview
            project={project}
            onDocument={openDocument}
            onRounds={() => setView('rounds')}
            onReport={() => setView('report')}
          />
        )}
        {view === 'knowledge' && <KnowledgeView graph={project.graph} onSource={openSource} />}
        {view === 'agents' && (
          <AgentsView project={project} onSource={openSource} onInterview={openInterview} />
        )}
        {view === 'rounds' && <RoundsView project={project} onSource={openSource} />}
        {view === 'report' && <ReportView report={project.report} onSource={openSource} />}
        {view === 'evidence' && (
          <EvidenceView
            key={`${project.id}-${evidence.revision}`}
            projectId={project.id}
            documents={project.documents}
            initialQuery={evidence.query}
            initialDocumentId={evidence.documentId}
          />
        )}
        {view === 'interview' && (
          <InterviewView
            project={project}
            target={target}
            onTarget={setTarget}
            onSource={openSource}
          />
        )}
      </div>
      {deleteOpen && (
        <Modal
          title="Delete this experiment?"
          onClose={() => {
            if (!busy) setDeleteOpen(false);
          }}
        >
          <p className="modal-copy">
            “{project.name}” and its source documents, results, and conversations will be removed
            from this machine. This cannot be undone.
          </p>
          <div className="modal-actions">
            <button
              className="button button-secondary"
              type="button"
              disabled={busy}
              onClick={() => setDeleteOpen(false)}
            >
              Keep experiment
            </button>
            <button
              className="button button-danger"
              type="button"
              disabled={busy}
              onClick={() =>
                void onAction('delete', project.id).then((success) => {
                  if (!success) setDeleteOpen(false);
                })
              }
            >
              {ownBusy ? (
                <Spinner label="Deleting experiment" />
              ) : (
                <Trash2 size={15} aria-hidden="true" />
              )}{' '}
              Delete experiment
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
