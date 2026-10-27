import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ExternalLink, FlaskConical, History, Plus, RefreshCw, X } from 'lucide-react';
import type { ProjectDetail } from '../../shared/types';
import { ConsoleWorkspace } from './components/console/ConsoleWorkspace';
import { EntryConsole } from './components/console/EntryConsole';
import { HistoryDrawer } from './components/console/HistoryDrawer';
import { EmptyPanel, Notice, Spinner } from './components/ui';
import { useConsole } from './hooks/useConsole';
import { sourceLink } from './lib/format';

export default function App() {
  const console = useConsole();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [comparisonProject, setComparisonProject] = useState<string | null>(null);
  const [creation, setCreation] = useState<{ key: number; project?: ProjectDetail }>({ key: 0 });
  const main = useRef<HTMLElement>(null);
  const didNavigate = useRef(false);
  const project =
    console.detail.id === console.selectedId && console.detail.data?.id === console.selectedId
      ? console.detail.data
      : null;
  const source = sourceLink(console.config.data?.sourceUrl);
  const busy = Boolean(console.operation);
  const newProject = (initialProject?: ProjectDetail) => {
    if (busy) return;
    console.selectProject(null);
    setComparisonProject(null);
    setCreation((old) => ({ key: old.key + 1, project: initialProject }));
  };

  useEffect(() => {
    const pop = () => {
      setComparisonProject(null);
      setCreation((old) => ({ key: old.key + 1 }));
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  useEffect(() => {
    if (!didNavigate.current) {
      didNavigate.current = true;
      return;
    }
    main.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [console.selectedId, creation.key]);

  const actionError = console.actionError?.id === console.selectedId ? console.actionError : null;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to console
      </a>
      <header className="app-header">
        <div className="header-brand">
          {console.selectedId && (
            <button
              className="icon-button"
              type="button"
              aria-label="Back to entry console"
              onClick={() => newProject()}
              disabled={busy}
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <button
            className="brand-button"
            type="button"
            onClick={() => newProject()}
            disabled={busy}
          >
            <span className="brand-mark">
              <FlaskConical size={18} aria-hidden="true" />
            </span>
            <strong>Swarm Lab</strong>
            <span className="mono">/ CONSOLE</span>
          </button>
        </div>
        <div className="header-actions">
          <span className="single-user-label mono">LOCAL · SINGLE USER</span>
          <button
            className="button button-secondary button-small"
            type="button"
            onClick={() => setHistoryOpen(true)}
          >
            <History size={14} aria-hidden="true" /> History
            {console.history.data && (
              <span className="header-counter">{console.history.data.total}</span>
            )}
          </button>
          {console.selectedId && (
            <button
              className="button button-black button-small"
              type="button"
              disabled={busy}
              onClick={() => newProject()}
            >
              <Plus size={14} /> New
            </button>
          )}
        </div>
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        ref={main}
        className={`main-content ${console.selectedId ? 'project-content' : 'entry-content'}`}
      >
        {console.config.loading && !console.config.data && (
          <div className="inline-pending">
            <Spinner /> Reading server readiness…
          </div>
        )}
        {console.config.error && (
          <Notice
            tone="error"
            title="Server configuration unavailable"
            action={
              <button
                className="button button-secondary button-small"
                type="button"
                disabled={console.config.loading}
                onClick={() => void console.loadConfig()}
              >
                <RefreshCw size={13} /> Retry config
              </button>
            }
          >
            {console.config.error} Creation and model assistance remain unavailable until current
            capabilities can be read.
          </Notice>
        )}
        {actionError && (
          <Notice
            tone="error"
            title="Operation not confirmed"
            action={
              <button
                className="icon-button"
                type="button"
                aria-label="Dismiss operation error"
                onClick={console.dismissError}
              >
                <X size={15} />
              </button>
            }
          >
            {actionError.message} The latest persisted project state is refreshed before a retry.
          </Notice>
        )}
        {console.selectedId ? (
          <>
            {console.detail.error && (
              <Notice
                tone="error"
                title="Project refresh failed"
                action={
                  <button
                    className="button button-secondary button-small"
                    type="button"
                    onClick={console.refresh}
                    disabled={console.detail.loading}
                  >
                    <RefreshCw size={13} /> Retry refresh
                  </button>
                }
              >
                {console.detail.error}{' '}
                {project
                  ? 'Showing the last loaded record. Automatic polling stopped; retry to reconnect.'
                  : 'Retry this project or choose another from History.'}
              </Notice>
            )}
            {project ? (
              <ConsoleWorkspace
                key={project.id}
                project={project}
                config={console.config.error ? null : console.config.data}
                busy={busy}
                refreshing={console.detail.loading}
                onRefresh={() => {
                  console.refresh();
                  void console.loadHistory();
                }}
                onRun={(step) => console.execute(project.id, step)}
                onCancel={() => console.cancel(project.id)}
                onPause={async () => {
                  await console.pause(project.id);
                }}
                onResume={async () => {
                  await console.resume(project.id);
                }}
                onIntervention={async (value) => {
                  await console.updateIntervention(project.id, value);
                }}
                onBranch={async (input) => {
                  await console.branch(project.id, input);
                }}
                onSelectProject={console.selectProject}
                projects={console.history.data?.projects ?? []}
                comparisonRequested={comparisonProject === project.id}
                onCloseComparison={() => setComparisonProject(null)}
                onSave={async (input) => {
                  await console.saveEnvironment(project.id, input);
                }}
                onDuplicate={() => newProject(project)}
                onSurvey={(record) => console.recordSurvey(project.id, record)}
              />
            ) : console.detail.loading ? (
              <div className="project-loading">
                <Spinner label="Loading project" />
                <span>Opening persisted project…</span>
              </div>
            ) : !console.detail.error ? (
              <EmptyPanel title="No project record loaded">
                Refresh or open History to choose a saved project.
              </EmptyPanel>
            ) : null}
          </>
        ) : (
          <EntryConsole
            key={creation.key}
            config={console.config.error ? null : console.config.data}
            initialProject={creation.project}
            busy={busy}
            onSubmit={console.create}
            onHistory={() => setHistoryOpen(true)}
          />
        )}
      </main>
      <footer className="app-footer">
        <span>
          Swarm Lab · {console.config.data ? `v${console.config.data.version}` : 'version unknown'}{' '}
          · Fictional scenarios, not forecasts.
        </span>
        <span>
          Local single-user tool. Do not expose this server publicly. No provider secrets are stored
          in this UI.
        </span>
        <span>
          AGPL-3.0
          {source && (
            <>
              {' '}
              ·{' '}
              <a href={source} target="_blank" rel="noreferrer">
                Source <ExternalLink size={11} />
              </a>
            </>
          )}
        </span>
      </footer>
      {historyOpen && (
        <HistoryDrawer
          projects={console.history.data?.projects ?? []}
          total={console.history.data?.total ?? 0}
          loading={console.history.loading}
          error={console.history.error}
          selectedId={console.selectedId}
          busy={busy}
          onClose={() => setHistoryOpen(false)}
          onSelect={(id) => {
            setComparisonProject(null);
            console.selectProject(id);
          }}
          whatIf={Boolean(console.config.data?.capabilities.whatIf && !console.config.error)}
          onCompare={(id) => {
            setComparisonProject(id);
            console.selectProject(id);
          }}
          onRefresh={() => void console.loadHistory()}
          onDelete={console.remove}
        />
      )}
    </div>
  );
}
