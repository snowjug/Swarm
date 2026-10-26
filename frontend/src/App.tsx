import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  FlaskConical,
  Menu,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { ProjectDetail } from '../../shared/types';
import { CreateExperiment } from './components/CreateExperiment';
import { Overview } from './components/Overview';
import { ProjectWorkspace } from './components/ProjectWorkspace';
import { Sidebar } from './components/Sidebar';
import { EmptyPanel, Notice, Spinner } from './components/ui';
import { useMediaQuery } from './hooks/useMediaQuery';
import { useWorkbench } from './hooks/useWorkbench';
import { sourceLink } from './lib/format';

interface Creation {
  id: number;
  starter: boolean;
  project?: ProjectDetail;
}

export default function App() {
  const workbench = useWorkbench();
  const [creation, setCreation] = useState<Creation | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const narrow = useMediaQuery('(max-width: 900px)');
  const creationCounter = useRef(0);
  const menuRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const navigated = useRef(false);
  const closeSidebar = () => {
    setSidebarOpen(false);
    menuRef.current?.focus();
  };
  const showHome = () => {
    setCreation(null);
    workbench.selectProject(null);
  };
  const showNew = (starter = false, project?: ProjectDetail) => {
    if (workbench.mutation) return;
    workbench.selectProject(null);
    setCreation({ id: ++creationCounter.current, starter, project });
    window.scrollTo({ top: 0 });
  };
  const chooseProject = (id: string) => {
    setCreation(null);
    workbench.selectProject(id);
    window.scrollTo({ top: 0 });
  };

  useEffect(() => {
    const handlePop = () => setCreation(null);
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, []);

  useEffect(() => {
    if (!navigated.current) {
      navigated.current = true;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [creation?.id, workbench.selectedId]);

  useEffect(() => {
    if (!sidebarOpen || !narrow) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const first = document.querySelector<HTMLElement>('#experiment-sidebar .brand-button');
    first?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [sidebarOpen, narrow]);

  const configSource = sourceLink(workbench.config.data?.sourceUrl);
  const projects = workbench.history.data?.projects ?? [];
  const visibleActionError =
    workbench.actionError?.id === workbench.selectedId ? workbench.actionError : null;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <Sidebar
        projects={projects}
        total={workbench.history.data?.total ?? 0}
        selectedId={workbench.selectedId}
        loading={workbench.history.loading}
        error={workbench.history.error}
        config={workbench.config.data}
        open={sidebarOpen}
        mobile={narrow}
        onClose={closeSidebar}
        onHome={showHome}
        onNew={() => showNew()}
        onSelect={chooseProject}
        onRefresh={() => void workbench.loadHistory()}
      />
      <div className="main-shell" inert={sidebarOpen && narrow ? true : undefined}>
        <header className="topbar">
          <div className="topbar-location">
            <button
              ref={menuRef}
              className="icon-button mobile-only"
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open experiment navigation"
              aria-controls="experiment-sidebar"
              aria-expanded={sidebarOpen}
            >
              <Menu size={21} aria-hidden="true" />
            </button>
            <FlaskConical size={17} aria-hidden="true" />
            <span>Workspace</span>
            <span className="topbar-slash">/</span>
            <strong>
              {creation
                ? 'New experiment'
                : workbench.selectedId
                  ? 'Experiment notebook'
                  : 'Overview'}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="private-label">
              <ShieldCheck size={14} aria-hidden="true" /> SINGLE-USER · LOCAL-FIRST
            </span>
            <span className="version-label">
              {workbench.config.data ? `v${workbench.config.data.version}` : 'SWARM LAB'}
            </span>
          </div>
        </header>
        <main id="main-content" ref={mainRef} tabIndex={-1} className="main-content">
          {workbench.config.error && (
            <Notice
              tone="error"
              title="Backend configuration unavailable"
              action={
                <button
                  className="button button-secondary button-small"
                  type="button"
                  onClick={() => void workbench.loadConfig()}
                  disabled={workbench.config.loading}
                >
                  <RefreshCw size={13} aria-hidden="true" /> Retry
                </button>
              }
            >
              {workbench.config.error} Model mode stays disabled until configuration is available.
            </Notice>
          )}
          {visibleActionError && (
            <Notice
              tone="error"
              title="Project operation failed"
              action={
                <button
                  className="icon-button"
                  type="button"
                  onClick={workbench.dismissActionError}
                  aria-label="Dismiss operation error"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              }
            >
              {visibleActionError.message} Refresh the selected experiment to confirm its latest
              state before retrying.
            </Notice>
          )}
          {creation ? (
            <CreateExperiment
              key={creation.id}
              config={workbench.config.error ? null : workbench.config.data}
              initialProject={creation.project}
              useStarter={creation.starter}
              busy={Boolean(workbench.mutation)}
              onBack={showHome}
              onSubmit={async (input, start) => {
                await workbench.createProject(input, start);
                setCreation(null);
                window.scrollTo({ top: 0 });
              }}
            />
          ) : workbench.selectedId ? (
            <>
              {workbench.detail.error && (
                <Notice
                  tone="error"
                  title="Could not refresh this experiment"
                  action={
                    <button
                      className="button button-secondary button-small"
                      type="button"
                      onClick={workbench.refreshProject}
                    >
                      <RefreshCw size={13} aria-hidden="true" /> Retry refresh
                    </button>
                  }
                >
                  {workbench.detail.error}{' '}
                  {workbench.detail.data
                    ? 'The last loaded state is shown. Automatic updates have stopped; retry to reconnect.'
                    : 'Choose another experiment or retry this request.'}
                </Notice>
              )}
              {workbench.detail.data ? (
                <ProjectWorkspace
                  key={workbench.detail.data.id}
                  project={workbench.detail.data}
                  loading={workbench.detail.loading}
                  mutation={workbench.mutation}
                  onBack={showHome}
                  onRefresh={() => {
                    workbench.refreshProject();
                    void workbench.loadHistory();
                  }}
                  onDuplicate={(project) => showNew(false, project)}
                  onAction={workbench.actOnProject}
                />
              ) : workbench.detail.loading ? (
                <div className="loading-panel project-loading">
                  <Spinner label="Loading selected experiment" />
                  <h2>Opening the notebook…</h2>
                  <p>Retrieving the latest saved state from your local server.</p>
                </div>
              ) : (
                <EmptyPanel
                  title="This notebook is unavailable"
                  action={
                    <button className="button button-secondary" type="button" onClick={showHome}>
                      <ArrowLeft size={15} aria-hidden="true" /> Back to lab
                    </button>
                  }
                >
                  The experiment could not be loaded. It may have been deleted or the backend may be
                  offline. Your other experiments remain in the history.
                </EmptyPanel>
              )}
            </>
          ) : (
            <Overview
              projects={projects}
              loading={workbench.history.loading}
              historyError={workbench.history.error}
              onRefresh={() => void workbench.loadHistory()}
              onNew={() => showNew()}
              onStarter={() => showNew(true)}
              onSelect={chooseProject}
            />
          )}
        </main>
        <footer className="app-footer">
          <div>
            <strong>
              swarm<span>lab</span>
            </strong>
            <span>An independent implementation · Concept reference: MiroFish</span>
          </div>
          <div>
            <span>AGPL-3.0-only</span>
            {configSource ? (
              <a href={configSource} target="_blank" rel="noopener noreferrer">
                Project source <ArrowUpRight size={12} aria-hidden="true" />
              </a>
            ) : (
              <span className="footer-source-unset">Source URL not configured</span>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
